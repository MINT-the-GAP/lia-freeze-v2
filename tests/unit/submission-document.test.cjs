const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

function loadTypeScriptModule(fileName) {
  const source = readFileSync(fileName, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ES2020,
    },
    fileName,
  }).outputText;
  const encoded = Buffer.from(compiled, 'utf8').toString('base64');
  return import('data:text/javascript;base64,' + encoded);
}

const repoRoot = path.resolve(__dirname, '..', '..');
const documentPromise = loadTypeScriptModule(
  path.join(repoRoot, 'src', 'submission-document.ts'),
);
const codecPromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'codec.ts'));

test('parses only the leading header version and the first visible H1', async () => {
  const { parseCourseDocumentIdentity } = await documentPromise;
  const fence = String.fromCharCode(96).repeat(3);
  const markdown = [
    '\uFEFF  <!--',
    'author: Test',
    'version:   2026.07-proposal ',
    '# hidden header example',
    '-->',
    fence + 'markdown',
    '# Fenced fake title',
    fence,
    '<!--',
    '# Commented fake title',
    '-->',
    '## Introduction',
    '# Echter Kurs mit Umlauten: Größe ###',
    'version: 99.0.0',
  ].join('\n');

  assert.deepEqual(parseCourseDocumentIdentity(markdown), {
    title: 'Echter Kurs mit Umlauten: Größe',
    courseVersion: '2026.07-proposal',
  });
});

test('does not claim a body or non-leading comment version as course metadata', async () => {
  const { parseCourseDocumentIdentity } = await documentPromise;
  const markdown = [
    '# Kurs ohne LiaScript-Kopf',
    '<!--',
    'version: 8.8.8',
    '-->',
    'version: 9.9.9',
  ].join('\n');

  assert.deepEqual(parseCourseDocumentIdentity(markdown), {
    title: 'Kurs ohne LiaScript-Kopf',
    courseVersion: '',
  });
});

test('builds and reads normalized, deterministic version-1 metadata', async () => {
  const {
    buildSubmissionDocumentMetadata,
    readSubmissionDocumentMetadata,
  } = await documentPromise;
  const createdAt = Date.UTC(2026, 6, 26, 12, 34);

  const metadata = buildSubmissionDocumentMetadata({
    title: '  Kurs \n mit   Aufgaben ',
    courseVersion: ' 1.2.3   Proposal ',
  }, createdAt);

  assert.deepEqual(metadata, {
    v: 1,
    at: createdAt,
    title: 'Kurs mit Aufgaben',
    courseVersion: '1.2.3 Proposal',
  });
  assert.deepEqual(readSubmissionDocumentMetadata({
    ...metadata,
    ignoredFutureField: true,
  }), metadata);

  const bounded = buildSubmissionDocumentMetadata({
    title: 'T'.repeat(1_050),
    courseVersion: 'V'.repeat(350),
  }, createdAt);
  assert.equal(bounded.title.length, 1_000);
  assert.equal(bounded.courseVersion.length, 300);
});

test('rejects malformed metadata transactionally and accepts omitted optional fields', async () => {
  const { readSubmissionDocumentMetadata } = await documentPromise;
  const validAt = Date.UTC(2026, 6, 26, 12, 34);
  const malformed = [
    undefined,
    null,
    [],
    { v: 2, at: validAt },
    { v: 1, at: -1 },
    { v: 1, at: 1.5 },
    { v: 1, at: Number.NaN },
    { v: 1, at: 8_640_000_000_000_001 },
    { v: 1, at: validAt, title: null },
    { v: 1, at: validAt, title: 'x'.repeat(1_001) },
    { v: 1, at: validAt, courseVersion: {} },
    { v: 1, at: validAt, courseVersion: 'x'.repeat(301) },
  ];

  for (const value of malformed) {
    assert.equal(readSubmissionDocumentMetadata(value), null);
  }
  assert.deepEqual(readSubmissionDocumentMetadata({ v: 1, at: validAt }), {
    v: 1,
    at: validAt,
  });
});

test('creates a localized pure print-header model from frozen values', async () => {
  const {
    buildPrintableSubmissionHeaderModel,
    buildSubmissionDocumentMetadata,
  } = await documentPromise;
  const createdAt = Date.UTC(2026, 6, 26, 12, 34);
  const doc = buildSubmissionDocumentMetadata({
    title: 'Koordinaten & Brüche',
    courseVersion: '3.4.5',
  }, createdAt);

  const model = buildPrintableSubmissionHeaderModel({
    n: '  Ada   Lovelace ',
    doc,
  }, {
    locale: 'de-DE',
    timeZone: 'UTC',
  });

  assert.equal(model.name, 'Ada Lovelace');
  assert.match(model.date, /26\.07\.2026/);
  assert.match(model.date, /12:34/);
  assert.equal(model.version, '3.4.5');
  assert.equal(model.title, 'Koordinaten & Brüche');
  assert.equal(model.metadataStatus, 'frozen');
});

test('uses honest legacy and missing-value labels instead of current-course guesses', async () => {
  const {
    buildPrintableSubmissionHeaderModel,
    PRINTABLE_VALUE_NOT_PROVIDED,
    PRINTABLE_VALUE_NOT_STORED,
  } = await documentPromise;
  const validAt = Date.UTC(2026, 6, 26, 12, 34);

  assert.deepEqual(buildPrintableSubmissionHeaderModel({ n: 'Ada' }), {
    name: 'Ada',
    date: PRINTABLE_VALUE_NOT_STORED,
    version: PRINTABLE_VALUE_NOT_STORED,
    title: PRINTABLE_VALUE_NOT_STORED,
    metadataStatus: 'legacy',
  });

  const incomplete = buildPrintableSubmissionHeaderModel({
    doc: { v: 1, at: validAt },
  }, {
    locale: 'de-DE',
    timeZone: 'UTC',
  });
  assert.equal(incomplete.name, PRINTABLE_VALUE_NOT_PROVIDED);
  assert.equal(incomplete.version, PRINTABLE_VALUE_NOT_PROVIDED);
  assert.equal(incomplete.title, PRINTABLE_VALUE_NOT_PROVIDED);
  assert.equal(incomplete.metadataStatus, 'frozen');
});

test('preserves document metadata through the existing token codec and old payloads', async () => {
  const {
    buildPrintableSubmissionHeaderModel,
    buildSubmissionDocumentMetadata,
  } = await documentPromise;
  const { decodeToken, encodeToken } = await codecPromise;
  const payload = {
    v: 'sf-mini-ti-4',
    sh: '#2',
    s: [{ h: '#1' }, { h: '#2' }],
    n: 'Ada',
    doc: buildSubmissionDocumentMetadata({
      title: 'Freeze-Test',
      courseVersion: '1.0.0',
    }, Date.UTC(2026, 6, 26, 12, 34)),
  };

  const encoded = await encodeToken(payload);
  assert.deepEqual(await decodeToken(encoded.token), payload);

  const legacy = {
    v: 'sf-mini-ti-4',
    sh: '#1',
    s: [{ h: '#1' }],
    n: 'Legacy',
  };
  const legacyEncoded = await encodeToken(legacy);
  const legacyDecoded = await decodeToken(legacyEncoded.token);
  assert.deepEqual(legacyDecoded, legacy);
  assert.equal(
    buildPrintableSubmissionHeaderModel(legacyDecoded).metadataStatus,
    'legacy',
  );
});
