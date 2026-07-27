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
  return import(
    'data:text/javascript;base64,' + Buffer.from(compiled, 'utf8').toString('base64')
  );
}

const repoRoot = path.resolve(__dirname, '..', '..');
const sendModePromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'send-mode.ts'));

test('uses strict stable keys for deferred Send tasks', async () => {
  const {
    makeDeferredSendTaskKey,
    parseDeferredSendTaskKey,
  } = await sendModePromise;

  assert.equal(makeDeferredSendTaskKey('#12', 0), '#12::send::0');
  assert.deepEqual(parseDeferredSendTaskKey('#12::send::34'), {
    hash: '#12',
    taskIndex: 34,
  });
  assert.equal(makeDeferredSendTaskKey('12', 0), '');
  assert.equal(makeDeferredSendTaskKey('#12', -1), '');
  assert.equal(parseDeferredSendTaskKey('#12::send::-1'), null);
  assert.equal(parseDeferredSendTaskKey('#12::send::1<script>'), null);
});

test('preserves native and marker solution controls only during Send review', async () => {
  const { isDeferredSendReviewControl } = await sendModePromise;
  const makeElement = (review, control) => ({
    ownerDocument: {
      body: {
        classList: {
          contains: name => review && name === 'lia-send-review',
        },
      },
    },
    closest: selector => {
      if (selector !== '.lia-quiz__resolve,.hlq-proxy [data-hlq-act="solve"]') return null;
      return control === 'native' || control === 'marker' ? {} : null;
    },
  });

  assert.equal(isDeferredSendReviewControl(makeElement(true, 'native')), true);
  assert.equal(isDeferredSendReviewControl(makeElement(true, 'marker')), true);
  assert.equal(isDeferredSendReviewControl(makeElement(true, 'other')), false);
  assert.equal(isDeferredSendReviewControl(makeElement(false, 'native')), false);
});

test('counts only learner Check clicks, keeps input logging separate, and resets cleanly', async () => {
  const {
    configureDeferredSendMode,
    getDeferredSendCheckCounts,
    getDeferredSendTasks,
    setDeferredSendPhase,
  } = await sendModePromise;

  const listeners = {};
  const classNames = new Set();
  const classList = {
    add: name => classNames.add(name),
    remove: name => classNames.delete(name),
    contains: name => classNames.has(name),
  };
  const body = { classList };
  const document = {
    body,
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    getElementById() { return null; },
    querySelectorAll() { return []; },
    createElement() {
      return {
        className: '',
        id: '',
        textContent: '',
        setAttribute() {},
      };
    },
  };
  class FakeMutationObserver {
    observe() {}
  }
  const runtimeWindow = {
    document,
    MutationObserver: FakeMutationObserver,
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
  };

  const roots = [];
  const makeQuiz = () => {
    let status = null;
    const attributes = {};
    const control = {
      appendChild(element) {
        status = element;
      },
    };
    const root = {
      nodeType: 1,
      ownerDocument: document,
      querySelector(selector) {
        if (selector === '.lia-send-status') return status;
        if (selector === '.lia-quiz__control') return control;
        return null;
      },
      setAttribute(name, value) {
        attributes[name] = value;
      },
    };
    const button = {
      nodeType: 1,
      closest(selector) {
        if (selector === '.lia-quiz__check') return button;
        if (selector === '.lia-quiz') return root;
        return null;
      },
    };
    const input = {
      nodeType: 1,
      closest(selector) {
        return selector === '.lia-quiz' ? root : null;
      },
    };
    roots.push(root);
    return { root, button, input, get status() { return status; }, attributes };
  };
  const first = makeQuiz();
  const second = makeQuiz();
  const host = {
    contains: root => roots.includes(root),
    querySelectorAll: selector => selector === '.lia-quiz' ? roots : [],
  };
  let logged = 0;
  const context = {
    getHash: () => '#7',
    getRuntimeWindows: () => [runtimeWindow],
    getContentHost: () => host,
    onLogged: () => { logged += 1; },
  };
  const eventFor = target => ({
    target,
    cancelable: true,
    preventDefault() {},
    stopImmediatePropagation() {},
  });

  configureDeferredSendMode(context);
  setDeferredSendPhase('collect');
  listeners.input(eventFor(second.input));
  listeners.click(eventFor(first.button));
  listeners.click(eventFor(first.button));

  assert.deepEqual(getDeferredSendTasks(), [
    { hash: '#7', taskIndex: 0 },
    { hash: '#7', taskIndex: 1 },
  ]);
  assert.deepEqual(getDeferredSendCheckCounts(), {
    version: 1,
    items: [{ hash: '#7', taskIndex: 0, count: 2 }],
  });
  assert.equal(logged, 2);
  assert.match(first.status.textContent, /Prüfen-Klicks: 2/);

  setDeferredSendPhase('grading');
  listeners.click(eventFor(first.button));
  setDeferredSendPhase('review');
  listeners.click(eventFor(first.button));
  assert.equal(getDeferredSendCheckCounts().items[0].count, 2);

  configureDeferredSendMode(context);
  assert.deepEqual(getDeferredSendTasks(), []);
  assert.deepEqual(getDeferredSendCheckCounts(), { version: 1, items: [] });
});
