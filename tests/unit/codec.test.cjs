const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
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
const codecPromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'codec.ts'));
const FOUR_MIB = 4 * 1024 * 1024;
const TOKEN_LIMIT = 6_000_000;

function plainToken(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

test('keeps existing small plain UTF-8 tokens compatible', async () => {
  const { decodeToken, encodeToken } = await codecPromise;
  const payload = { answer: 'Größe ✓', values: [1, 2, 3] };

  assert.deepEqual(await decodeToken(plainToken(payload)), payload);

  const encoded = await encodeToken(payload);
  assert.equal(encoded.mode, 'plain');
  assert.deepEqual(await decodeToken(encoded.token), payload);
});

test('keeps small gzip tokens compatible', async () => {
  const { decodeToken, encodeToken } = await codecPromise;
  const payload = {
    kind: 'coordinate',
    repeated: 'abc123-'.repeat(4_000),
  };

  const encoded = await encodeToken(payload);
  assert.equal(encoded.mode, 'gzip');
  assert.deepEqual(await decodeToken(encoded.token), payload);
});

test('rejects an oversized token before calling atob', async () => {
  const { decodeToken } = await codecPromise;
  const originalAtob = globalThis.atob;
  let atobCalls = 0;
  globalThis.atob = () => {
    atobCalls += 1;
    throw new Error('atob must not run');
  };

  try {
    await assert.rejects(
      decodeToken('A'.repeat(TOKEN_LIMIT + 1)),
      /maximum size of 6,000,000 characters/
    );
    assert.equal(atobCalls, 0);
  } finally {
    globalThis.atob = originalAtob;
  }
});

test('rejects encode input above 4 MiB by UTF-8 byte length', async () => {
  const { encodeToken } = await codecPromise;
  // The character count stays well below 4 MiB, while each euro sign uses
  // three UTF-8 bytes and the surrounding JSON pushes it over the limit.
  const payload = { text: '€'.repeat(Math.floor(FOUR_MIB / 3)) };

  await assert.rejects(
    encodeToken(payload),
    /maximum UTF-8 size of 4 MiB/
  );
});

test('rejects a plain decoded JSON payload above 4 MiB', async () => {
  const { decodeToken } = await codecPromise;
  const payload = { text: 'x'.repeat(FOUR_MIB) };
  const token = plainToken(payload);

  assert.ok(token.length < TOKEN_LIMIT);
  await assert.rejects(
    decodeToken(token),
    /maximum UTF-8 size of 4 MiB/
  );
});

test('aborts gzip decoding when streamed output exceeds 4 MiB', async () => {
  const { decodeToken } = await codecPromise;
  const json = JSON.stringify({ text: 'x'.repeat(FOUR_MIB) });
  const compressed = gzipSync(Buffer.from(json, 'utf8')).toString('base64url');
  const token = 'gz:' + compressed;

  assert.ok(token.length < 10_000, 'fixture must remain a highly compressed token');
  await assert.rejects(
    decodeToken(token),
    /maximum UTF-8 size of 4 MiB/
  );
});
