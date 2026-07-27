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
const statePromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'mathe-state.ts'));

test('captures exact circle and non-square rectangle geometry compactly', async () => {
  const { captureMatheStates } = await statePromise;
  const widgets = {
    circle: {
      state: [true, false, true, false, false, true, false, false],
      meta: {
        kind: 'circle',
        parts: 8,
        solved: true,
        revealed: false,
        locked: true,
        ready: true,
      },
    },
    rect: {
      state: [true, false, false, true, false, true],
      dims: { rows: 2, cols: 3 },
      meta: {
        kind: 'rect',
        rows: 2,
        cols: 3,
        solved: false,
        revealed: true,
        locked: true,
        ready: true,
      },
    },
  };
  const api = {
    getAllWidgets: () => ({
      circle: { state: widgets.circle.state, meta: { kind: 'circle' } },
      rect: { state: widgets.rect.state, meta: { kind: 'rect' } },
    }),
  };

  assert.deepEqual(captureMatheStates(api, { widgets }), {
    v: 1,
    w: {
      circle: { k: 'c', n: 8, a: [0, 2, 5], f: 5 },
      rect: { k: 'r', r: 2, c: 3, a: [0, 3, 5], f: 6 },
    },
  });
});

test('captures the documented 0.0.2 runtime without getAllWidgets', async () => {
  const { captureMatheStates } = await statePromise;
  const widgets = {
    oldTag: {
      state: [false, true, false, true],
      dims: { rows: 1, cols: 4 },
      meta: { kind: 'rect', locked: false, ready: true },
    },
  };

  assert.deepEqual(captureMatheStates(undefined, { widgets }), {
    v: 1,
    w: {
      oldTag: { k: 'r', r: 1, c: 4, a: [1, 3], f: 0 },
    },
  });
});

test('uses DOM dimensions when the public snapshot omits rectangle geometry', async () => {
  const { captureMatheStates } = await statePromise;
  const api = {
    getAllWidgets: () => ({
      rect: {
        state: [true, false, true, false, false, false],
        meta: { kind: 'rect', ready: true },
      },
    }),
  };

  assert.deepEqual(captureMatheStates(api, undefined, {
    rect: { kind: 'rect', rows: 3, cols: 2 },
  }).w.rect, {
    k: 'r',
    r: 3,
    c: 2,
    a: [0, 2],
    f: 0,
  });
});

test('restores geometry, selections, status flags and template DOM synchronization', async () => {
  const { restoreMatheStates } = await statePromise;
  const widgets = {};
  const calls = [];
  const store = {
    getWidget(uid, kind = '') {
      widgets[uid] ??= { state: [], meta: { kind } };
      if (kind) widgets[uid].meta.kind = kind;
      return widgets[uid];
    },
    setCircleParts(uid, parts) {
      calls.push(['circle', uid, parts]);
      const widget = this.getWidget(uid, 'circle');
      widget.state = Array(parts).fill(false);
      widget.meta.parts = parts;
      return widget.state;
    },
    setRectDims(uid, rows, cols) {
      calls.push(['rect', uid, rows, cols]);
      const widget = this.getWidget(uid, 'rect');
      widget.state = Array(rows * cols).fill(false);
      widget.dims = { rows, cols };
      return widget.state;
    },
    refreshNodes(uid) { calls.push(['nodes', uid]); },
    syncInputs(uid, force) { calls.push(['inputs', uid, force]); },
    syncDomState(uid) { calls.push(['dom', uid]); },
    render(uid) { calls.push(['render', uid]); return true; },
  };

  assert.equal(restoreMatheStates(store, {
    v: 1,
    w: {
      circle: { k: 'c', n: 5, a: [0, 3], f: 5 },
      rect: { k: 'r', r: 2, c: 3, a: [1, 4], f: 6 },
    },
  }), true);

  assert.deepEqual(widgets.circle.state, [true, false, false, true, false]);
  assert.deepEqual(widgets.circle.meta, {
    kind: 'circle',
    parts: 5,
    solved: true,
    revealed: false,
    locked: true,
  });
  assert.deepEqual(widgets.rect.state, [false, true, false, false, true, false]);
  assert.deepEqual(widgets.rect.dims, { rows: 2, cols: 3 });
  assert.deepEqual(widgets.rect.meta, {
    kind: 'rect',
    rows: 2,
    cols: 3,
    solved: false,
    revealed: true,
    locked: true,
  });
  assert.ok(calls.some(call => call[0] === 'render' && call[1] === 'circle'));
  assert.ok(calls.some(call => call[0] === 'render' && call[1] === 'rect'));
  assert.ok(calls.some(call => call[0] === 'inputs' && call[2] === true));
});

test('accepts legacy raw snapshots and rejects malformed active indexes', async () => {
  const { restoreMatheStates } = await statePromise;
  const widgets = {};
  const store = {
    getWidget(uid, kind = '') {
      widgets[uid] ??= { state: [], meta: { kind } };
      return widgets[uid];
    },
  };

  assert.equal(restoreMatheStates(store, {
    legacy: {
      state: [true, false, false, true, false, false],
      meta: {
        kind: 'rect',
        solved: false,
        revealed: false,
        locked: false,
        ready: true,
      },
    },
  }), true);
  assert.deepEqual(widgets.legacy.dims, { rows: 3, cols: 2 });
  assert.deepEqual(widgets.legacy.state, [true, false, false, true, false, false]);

  restoreMatheStates(store, {
    v: 1,
    w: {
      safe: { k: 'c', n: 3, a: [-1, 0, 0, 99, '2'], f: 0 },
    },
  });
  assert.deepEqual(widgets.safe.state, [true, false, true]);
});

test('keeps live mount readiness instead of restoring lifecycle state', async () => {
  const { restoreMatheStates } = await statePromise;
  const widget = {
    state: [false],
    meta: { kind: 'circle', ready: true },
  };
  const store = { getWidget: () => widget };

  restoreMatheStates(store, {
    v: 1,
    w: {
      current: { k: 'c', n: 2, a: [0], f: 13 },
    },
  });
  assert.equal(widget.meta.ready, true);
  assert.deepEqual(widget.state, [true, false]);
});

test('reports a missing or late V3 store so the caller can retry', async () => {
  const { restoreMatheStates } = await statePromise;
  assert.equal(restoreMatheStates(undefined, { v: 1, w: {} }), false);
  assert.equal(restoreMatheStates({}, { v: 1, w: {} }), false);
});

test('isolates a broken UID and asks the scheduler to retry it', async () => {
  const { restoreMatheStates } = await statePromise;
  const widgets = {};
  const store = {
    getWidget(uid, kind = '') {
      if (uid === 'late') throw new Error('not mounted yet');
      widgets[uid] ??= { state: [], meta: { kind } };
      return widgets[uid];
    },
  };

  assert.equal(restoreMatheStates(store, {
    v: 1,
    w: {
      ready: { k: 'c', n: 2, a: [1], f: 0 },
      late: { k: 'r', r: 2, c: 2, a: [0], f: 0 },
    },
  }), false);
  assert.deepEqual(widgets.ready.state, [false, true]);
});
