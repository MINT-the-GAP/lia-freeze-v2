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
const statePromise = loadTypeScriptModule(
  path.join(repoRoot, 'src', 'orthography-state.ts')
);

test('captures only serializable Orthography fields', async () => {
  const { captureOrthographyStates } = await statePromise;
  const runtime = {
    uid: '17',
    liveValue: 'Der Apfel ist rot.',
    solved: false,
    tries: 2.9,
  };
  runtime.cfg = runtime;

  assert.deepEqual(captureOrthographyStates({
    getAllStates: () => ({ '17': runtime }),
  }), {
    '17': {
      liveValue: 'Der Apfel ist rot.',
      solved: false,
      tries: 2,
    },
  });
});

test('restores value, solved flag and gated attempt count', async () => {
  const { restoreOrthographyStates } = await statePromise;
  const runtime = {};
  let syncCalls = 0;
  const api = {
    getAllStates: () => runtime,
    setState(uid, value) {
      syncCalls += 1;
      runtime[uid] ??= {};
      runtime[uid].liveValue = value;
    },
  };

  assert.equal(restoreOrthographyStates(api, {
    '42': {
      liveValue: 'Die richtige Lösung.',
      solved: true,
      tries: 3,
    },
  }), true);
  assert.deepEqual(runtime['42'], {
    liveValue: 'Die richtige Lösung.',
    solved: true,
    tries: 3,
  });
  assert.equal(syncCalls, 2);
});

test('restores legacy raw and string Orthography snapshots', async () => {
  const { restoreOrthographyStates } = await statePromise;
  const runtime = {};
  const api = {
    getAllStates: () => runtime,
    setState(uid, value) {
      runtime[uid] ??= {};
      runtime[uid].liveValue = value;
    },
  };

  restoreOrthographyStates(api, {
    oldRaw: { liveValue: null, start: 'Starttext', solved: false, tries: 1 },
    oldString: 'Direkter Text',
  });

  assert.deepEqual(runtime.oldRaw, {
    liveValue: 'Starttext',
    solved: false,
    tries: 1,
  });
  assert.deepEqual(runtime.oldString, {
    liveValue: 'Direkter Text',
  });
});
