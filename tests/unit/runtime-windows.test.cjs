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
const windowsPromise = loadTypeScriptModule(
  path.join(repoRoot, 'src', 'runtime-windows.ts')
);

function runtime(name) {
  return { name, document: {}, frames: [], parent: null };
}

test('enumerates current, root, nested and sibling same-origin frames once', async () => {
  const { sameOriginRuntimeWindows } = await windowsPromise;
  const root = runtime('root');
  const content = runtime('content');
  const nested = runtime('nested');
  const sibling = runtime('sibling');
  root.parent = root;
  content.parent = root;
  nested.parent = content;
  sibling.parent = root;
  root.frames = [content, sibling];
  content.frames = [nested];

  assert.deepEqual(
    sameOriginRuntimeWindows(content).map(item => item.name),
    ['content', 'root', 'nested', 'sibling']
  );
});

test('ignores an inaccessible cross-origin child without losing local frames', async () => {
  const { sameOriginRuntimeWindows } = await windowsPromise;
  const root = runtime('root');
  const local = runtime('local');
  const foreign = runtime('foreign');
  Object.defineProperty(foreign, 'document', {
    get() { throw new Error('cross origin'); },
  });
  root.parent = root;
  local.parent = root;
  foreign.parent = root;
  root.frames = [foreign, local];

  assert.deepEqual(
    sameOriginRuntimeWindows(root).map(item => item.name),
    ['root', 'local']
  );
});
