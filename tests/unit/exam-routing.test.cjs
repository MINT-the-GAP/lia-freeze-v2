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
  return import('data:text/javascript;base64,' + Buffer.from(compiled, 'utf8').toString('base64'));
}

const modulePromise = loadTypeScriptModule(
  path.resolve(__dirname, '..', '..', 'src', 'exam-routing.ts'),
);
const evaluationPromise = loadTypeScriptModule(
  path.resolve(__dirname, '..', '..', 'src', 'evaluation.ts'),
);

test('indexes every real H1-H6 section while ignoring fences and comments', async () => {
  const { parseExamHeadingIndex } = await modulePromise;
  const fence = String.fromCharCode(96).repeat(3);
  const headings = parseExamHeadingIndex([
    '<!--',
    '# Header metadata example',
    fence,
    '### Macro code example',
    fence,
    '-->',
    '# Before',
    '## Exam',
    '### First task',
    '<!-- #### Commented task -->',
    fence,
    '##### Fenced example',
    fence,
    '###### Submission ###',
  ].join('\n'));

  assert.deepEqual(headings, [
    { h: '#1', t: 'Before' },
    { h: '#2', t: 'Exam' },
    { h: '#3', t: 'First task' },
    { h: '#4', t: 'Submission' },
  ]);
});

test('matches LiaScript title fragments without stripping punctuation or diacritics', async () => {
  const {
    liaSectionTitleHash,
    resolveLiaSectionHash,
  } = await modulePromise;
  const headings = [
    { h: '#1', t: 'Vor dem Exam' },
    { h: '#2', t: 'Lösung & A-B' },
    { h: '#3', t: 'Lösung & A B' },
  ];

  assert.equal(liaSectionTitleHash(headings[1].t), '#lösung-&-a-b');
  assert.equal(liaSectionTitleHash('**Prüfung**'), null);
  assert.equal(liaSectionTitleHash('[Kapitel](https://example.org)'), null);
  assert.equal(liaSectionTitleHash('A--B'), null);
  assert.equal(liaSectionTitleHash('Hi :-)'), null);
  assert.equal(resolveLiaSectionHash('#05', headings), '#5');
  assert.equal(resolveLiaSectionHash('#0', headings), null);
  assert.equal(resolveLiaSectionHash('#999', headings), '#999');
  assert.equal(resolveLiaSectionHash('#' + '9'.repeat(400), headings), null);
  assert.equal(resolveLiaSectionHash('#L%C3%B6sung-%26-A-B', headings), '#2');
  assert.equal(resolveLiaSectionHash('#losung-%26-a-b', headings), null);
  assert.equal(resolveLiaSectionHash('#unknown', headings), null);
});

test('keeps @Exam numbering aligned around comments and unequal fences', async () => {
  const { parseExamHeadingIndex, resolveLiaSectionHash } = await modulePromise;
  const { parseExamConfig } = await evaluationPromise;
  const fence3 = String.fromCharCode(96).repeat(3);
  const fence4 = String.fromCharCode(96).repeat(4);
  const markdown = [
    '# Before',
    fence4 + ' markdown',
    '### Fenced heading',
    fence3,
    '## Still fenced',
    fence4,
    '<!-- ### Commented heading -->',
    '## Exam',
    '@Exam(30)',
  ].join('\n');

  const headings = parseExamHeadingIndex(markdown);
  assert.deepEqual(headings, [
    { h: '#1', t: 'Before' },
    { h: '#2', t: 'Exam' },
  ]);
  assert.equal(parseExamConfig(markdown).triggerHash, '#2');
  assert.equal(resolveLiaSectionHash('#exam', headings), '#2');
});
