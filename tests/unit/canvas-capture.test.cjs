const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { parseHTML } = require('linkedom');
const repoRoot = path.resolve(__dirname, '..', '..');
const compiled = new Map();
function compile(name) {
  if (!compiled.has(name)) {
    const fileName = path.join(repoRoot, 'src', name + '.ts');
    compiled.set(name, ts.transpileModule(readFileSync(fileName, 'utf8'), {
      fileName, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText);
  }
  return compiled.get(name);
}
function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}
function stroke(x = 25, overrides = {}) {
  return { kind: 'path', tool: 'pen', color: '#ff0000', alpha: 1, width: 3,
    points: [{ x, y: 25 }, { x: x + 30, y: 40 }], ...overrides };
}
function liveState(overrides = {}) {
  return { v: 'cvl1', ITEMS: [stroke()], REDO: [],
    VIEW: { panX: 0, panY: 0, scale: 1, minScale: 0.25, maxScale: 8 },
    bgMode: 'none', bgStep: 24, wrapW: 600, canvasH: 400, ...overrides };
}
function harness({ mode = 'live', uids = ['c1', 'c2'] } = {}) {
  const { document, window } = parseHTML('<html><body></body></html>');
  const counters = { raster: 0, geometry: 0, compact: 0, btoa: 0, pixels: 0 };
  const records = new Map(), exports = [], active = new Set(), pairs = new Map(), failures = new Map();
  let listed = uids.slice();
  window.getComputedStyle = () => ({ color: '#000000', getPropertyValue: () => '' });
  const originalCreate = document.createElement.bind(document);
  document.createElement = name => {
    const element = originalCreate(name);
    if (name === 'canvas') element.getContext = () => ({
      fillStyle: '#000000',
      getImageData() { counters.pixels++; throw new Error('Pixel reads are forbidden in this test'); },
    });
    return element;
  };
  for (const uid of uids) {
    const pair = document.createElement('span');
    pair.className = 'lia-canvas-pair';
    pair.innerHTML = '<span class="lia-canvas-mount"><canvas class="lia-draw"></canvas></span>';
    pair.querySelector('.lia-canvas-mount').dataset.uid = uid;
    Object.defineProperties(pair.querySelector('canvas'), {
      clientWidth: { value: 600 }, clientHeight: { value: 400 },
    });
    document.body.appendChild(pair);
    pairs.set(uid, pair);
    records.set(uid, { uid, revision: 1, state: freezeDeep(liveState()) });
  }
  const api = {
    collectCanvasPairsFromRoot: () => listed.map(uid => pairs.get(uid)).filter(Boolean),
    getCanvasUidFromPair: pair => pair.querySelector('.lia-canvas-mount').dataset.uid,
    exportAllCanvasFreezeStatesFromRoot() {
      counters.raster++;
      return listed.map(uid => ({ v: 'cvf1', u: uid, w: 600, h: 400, bg: { m: 'none' },
        it: [{ k: 'p', c: '#ff0000', a: 1, w: 3, p: [[25, 25], [55, 40]] }] }));
    },
  };
  if (mode === 'live') Object.assign(api, {
    listCanvasLiveStateRevisions: () => listed.filter(uid => records.has(uid))
      .map(uid => ({ uid, revision: records.get(uid).revision })),
    exportCanvasLiveStateByUID(uid) {
      exports.push(uid);
      if (failures.has(uid)) throw failures.get(uid);
      return records.get(uid) || null;
    },
    getCanvasLiveActivityByUID: uid => ({
      uid, revision: records.get(uid)?.revision || 0,
      active: active.has(uid), operations: active.has(uid) ? ['draw'] : [],
    }),
  });
  if (mode === 'legacy-store') {
    for (const [uid, record] of records) records.set(uid, { ...record, state: structuredClone(record.state) });
    api.getCanvasStoreEntry = uid => {
      exports.push(uid);
      return records.get(uid)?.state || null;
    };
  }
  window.__LIA_CANVAS_OCR__ = { freeze: api };
  const context = vm.createContext({
    window, document, console, structuredClone, URL, URLSearchParams,
    setTimeout: () => 1, clearTimeout() {},
    btoa(value) { counters.btoa++; return Buffer.from(value, 'binary').toString('base64'); },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
  });
  function execute(name, requireModule) {
    const module = { exports: {} };
    const fn = vm.runInContext('(function(require,module,exports){\n' + compile(name) + '\n})', context);
    fn(requireModule, module, module.exports);
    return module.exports;
  }
  const canvas = execute('canvas-state', name => { throw new Error('Unexpected import: ' + name); });
  const instrumentedCanvas = { ...canvas };
  for (const [name, counter] of [
    ['buildFullCanvasFreezeState', 'geometry'], ['compactCanvasStates', 'compact'],
  ]) instrumentedCanvas[name] = (...args) => {
    counters[counter]++;
    return canvas[name](...args);
  };
  const snapshot = execute('snapshot', name => {
    if (name === './canvas-state') return instrumentedCanvas;
    if (name === './runtime-windows') return { sameOriginRuntimeWindows: () => [window] };
    if (name === './url') return { getCurrentHash: () => '#1' };
    if (name === './port') return { loadNativeState: async () => ({}), sendRestoreEvent() {} };
    return {};
  });
  return {
    snapshot, canvas, counters, exports, records, active, failures, api, window,
    update(uid, overrides) {
      const previous = records.get(uid);
      records.set(uid, { uid, revision: (previous?.revision || 0) + 1,
        state: freezeDeep(liveState({ ...previous?.state, ...overrides })) });
    },
    unmount(uid) { listed = listed.filter(value => value !== uid); pairs.get(uid)?.remove(); },
    finalStates() { return canvas.expandCanvasStatesForRestore(snapshot.captureCanvasForSubmission()); },
  };
}
function assertNoAutomaticEncoding(h) {
  assert.equal(h.counters.raster, 0, 'automatic capture must never invoke the raster export API');
  assert.equal(h.counters.pixels, 0, 'automatic capture must never read pixels');
  assert.equal(h.counters.geometry, 0, 'automatic capture must not project all world geometry');
  assert.equal(h.counters.compact, 0, 'automatic capture must not compact Canvas states');
  assert.equal(h.counters.btoa, 0, 'automatic capture must not encode path tokens');
}
test('automatic Canvas capture exports only changed revisions and reuses unchanged snapshots', () => {
  const h = harness();
  const first = h.snapshot.captureCanvasProgress();
  assert.deepEqual(h.exports, ['c1', 'c2']);
  const second = h.snapshot.captureCanvasProgress();
  assert.deepEqual(h.exports, ['c1', 'c2']);
  assert.equal(second.length, first.length);
  for (let index = 0; index < first.length; index++) assert.equal(second[index], first[index]);
  h.update('c1', { ITEMS: [stroke(), stroke(100)] });
  h.snapshot.captureCanvasProgress({ dirtyUIDs: new Set(['c1']) });
  h.snapshot.captureCanvasProgress({ dirtyUIDs: new Set(['c1']) });
  assert.deepEqual(h.exports, ['c1', 'c2', 'c1'], 'pointerup plus change with the same revision is captured once');
  assertNoAutomaticEncoding(h);
});
test('automatic capture skips active drawings and resumes when the activity ends', () => {
  const h = harness();
  h.active.add('c1');
  h.snapshot.captureCanvasProgress();
  assert.deepEqual(h.exports, ['c2']);
  h.update('c1', { ITEMS: [stroke(150)] });
  h.snapshot.captureCanvasProgress({ dirtyUIDs: new Set(['c1']) });
  assert.deepEqual(h.exports, ['c2'], 'a paused but still pressed pen remains active');
  h.active.delete('c1');
  h.snapshot.captureCanvasProgress();
  assert.deepEqual(h.exports, ['c2', 'c1']);
  assertNoAutomaticEncoding(h);
});
test('immediate submission reads the final pointer endpoint before any delayed change event', () => {
  const h = harness({ uids: ['c1'] });
  h.snapshot.captureCanvasProgress();
  h.update('c1', { ITEMS: [stroke(25, { points: [{ x: 25, y: 25 }, { x: 330, y: 240 }] })] });
  const [state] = h.finalStates();
  assert.equal(state.u, 'c1');
  assert.ok(Math.abs(state.it[0].p.at(-1)[0] - 330) <= 2.25);
  assert.ok(Math.abs(state.it[0].p.at(-1)[1] - 240) <= 2.25);
  assert.equal(h.counters.raster, 0);
});
test('immediate submission treats a cleared Canvas as authoritative without an autosave', () => {
  const h = harness({ uids: ['c1'] });
  h.snapshot.captureCanvasProgress();
  h.update('c1', { ITEMS: [] });
  const [state] = h.finalStates();
  assert.equal(state.u, 'c1');
  assert.equal(state.e, 1);
  assert.equal(state.it.length, 0, 'clearing cannot resurrect an earlier drawing');
});
test('submission refreshes known unmounted UIDs and preserves other slides', () => {
  const h = harness();
  h.snapshot.captureCanvasProgress();
  h.update('c1', { ITEMS: [stroke(25), stroke(220)] });
  h.unmount('c1');
  const states = h.finalStates();
  assert.equal(states.length, 2);
  assert.equal(states.find(state => state.u === 'c1').it.length, 2);
  assert.equal(states.find(state => state.u === 'c2').it.length, 1);
});
test('submission may synchronously capture points already received by an active Canvas', () => {
  const h = harness({ uids: ['c1'] });
  h.active.add('c1');
  h.update('c1', { ITEMS: [stroke(90)] });
  const [state] = h.finalStates();
  assert.equal(state.it.length, 1);
  assert.ok(Math.abs(state.it[0].p[0][0] - 90) <= 2.25);
});
test('submission preserves eraser order, pan/zoom, offscreen content and calculation review', () => {
  const h = harness({ uids: ['c1'] });
  const review = { v: 'cr1', lines: ['1 + 1 = 2'], state: 'ready', checks: [] };
  h.update('c1', {
    ITEMS: [stroke(400), stroke(420, { tool: 'eraser', width: 12 })],
    VIEW: { panX: 10, panY: 20, scale: 2, minScale: 0.25, maxScale: 8 },
    calculationReviewFreeze: review,
  });
  h.snapshot.captureCanvasProgress();
  assertNoAutomaticEncoding(h);
  const [state] = h.finalStates();
  assert.equal(state.it[0].k, 'p');
  assert.equal(state.it[1].k, 'e');
  assert.ok(state.w > 600, 'offscreen strokes expand the saved viewport');
  assert.ok(Math.abs(state.it[0].p[0][0] - 810) <= 2.25);
  assert.equal(JSON.stringify(state.cr), JSON.stringify(review));
});
test('legacy store capture stays raster-free and reads an unmounted final mutation', () => {
  const h = harness({ mode: 'legacy-store', uids: ['c1'] });
  h.snapshot.captureCanvasProgress();
  assertNoAutomaticEncoding(h);
  h.records.get('c1').state.ITEMS.push(stroke(180));
  h.unmount('c1');
  const [state] = h.finalStates();
  assert.equal(state.it.length, 2);
});
test('legacy export-only APIs are used exclusively for final submission', () => {
  const h = harness({ mode: 'legacy-export', uids: ['c1'] });
  h.snapshot.captureCanvasProgress();
  h.snapshot.captureCanvasProgress({ dirtyUIDs: new Set(['c1']) });
  assertNoAutomaticEncoding(h);
  const [state] = h.finalStates();
  assert.equal(h.counters.raster, 1);
  assert.equal(state.u, 'c1');
  assert.equal(state.it.length, 1);
});
test('a replacement Canvas API with the same UID and revision cannot reuse a previous runtime snapshot', () => {
  const h = harness({ uids: ['c1'] });
  h.snapshot.captureCanvasProgress();
  const replacement = { uid: 'c1', revision: 1, state: freezeDeep(liveState({ ITEMS: [stroke(240)] })) };
  let replacements = 0;
  h.window.__LIA_CANVAS_OCR__.freeze = {
    ...h.api, exportCanvasLiveStateByUID() { replacements++; return replacement; },
  };
  h.snapshot.captureCanvasProgress();
  assert.equal(replacements, 1);
  const [state] = h.finalStates();
  assert.ok(Math.abs(state.it[0].p[0][0] - 240) <= 2.25);
});
test('submission rejects an oversized current Canvas and permits recovery after clear', () => {
  const h = harness({ uids: ['c1'] });
  h.snapshot.captureCanvasProgress();
  h.update('c1', { ITEMS: [stroke(200000)] });
  assert.throws(() => h.snapshot.captureCanvasForSubmission(), /Canvas|canvas|limit|range|geometry/i);
  h.update('c1', { ITEMS: [] });
  const [state] = h.finalStates();
  assert.equal(state.e, 1);
  assert.equal(state.it.length, 0);
});
test('a failing current live export cannot silently submit the previously cached drawing', () => {
  const h = harness({ uids: ['c1'] });
  h.snapshot.captureCanvasProgress();
  h.update('c1', { ITEMS: [stroke(200)] });
  h.failures.set('c1', new Error('Canvas live export unavailable'));
  assert.throws(() => h.snapshot.captureCanvasForSubmission(), /Canvas|canvas|unavailable/);
  h.failures.delete('c1');
  const [state] = h.finalStates();
  assert.ok(Math.abs(state.it[0].p[0][0] - 200) <= 2.25);
});

test('legacy snapshots are detached and unchanged entries are reused until an observed edit', () => {
  const h = harness({ mode: 'legacy-store', uids: ['c1'] });
  const [first] = h.snapshot.captureCanvasProgress();
  const source = h.records.get('c1').state;
  source.ITEMS[0].points[0].x = 300;
  const [unchanged] = h.snapshot.captureCanvasProgress();
  assert.equal(unchanged, first);
  assert.equal(first.ITEMS[0].points[0].x, 25, 'a mutable Store must not modify an older captured snapshot');
  const [changed] = h.snapshot.captureCanvasProgress({ dirtyUIDs: new Set(['c1']) });
  assert.notEqual(changed, first);
  assert.equal(changed.ITEMS[0].points[0].x, 300);
  assertNoAutomaticEncoding(h);
});
for (const mode of ['live', 'legacy-store']) {
  test(mode + ' captures a dirty UID unmounted before its first autosave', () => {
    const h = harness({ mode, uids: ['c1'] });
    h.unmount('c1');
    h.snapshot.captureCanvasProgress({ dirtyUIDs: new Set(['c1']) });
    const [state] = h.finalStates();
    assert.ok(state, 'a slide change before the debounce fires must not lose the first stroke');
    assert.equal(state.u, 'c1');
    assert.equal(state.it.length, 1);
  });
}
test('an earlier failed UID that becomes unavailable still blocks submission and can recover', () => {
  const h = harness({ uids: ['c1'] });
  const record = h.records.get('c1');
  h.failures.set('c1', new Error('Canvas c1 is unavailable'));
  assert.throws(() => h.snapshot.captureCanvasProgress(), /Canvas|canvas|unavailable/);
  h.unmount('c1');
  h.failures.clear();
  h.records.delete('c1');
  assert.throws(() => h.snapshot.captureCanvasForSubmission(), /Canvas|canvas|unavailable/);
  h.records.set('c1', record);
  const [state] = h.finalStates();
  assert.equal(state.u, 'c1');
  assert.equal(state.it.length, 1);
});
test('a failed multi-Canvas capture retains successful and failed UIDs across unmounting', () => {
  const h = harness();
  h.failures.set('c2', new Error('Canvas c2 is unavailable'));
  assert.throws(() => h.snapshot.captureCanvasProgress(), /Canvas|canvas|unavailable/);
  h.unmount('c1');
  h.unmount('c2');
  assert.throws(() => h.snapshot.captureCanvasForSubmission(), /Canvas|canvas|unavailable/);
  h.failures.clear();
  const states = h.finalStates();
  assert.equal(states.length, 2);
  assert.ok(states.some(state => state.u === 'c1'));
  assert.ok(states.some(state => state.u === 'c2'));
});


test('a transient final export failure can recover without changing the drawing revision', () => {
  const h = harness({ uids: ['c1'] });
  h.snapshot.captureCanvasProgress();
  h.failures.set('c1', new Error('temporary export failure'));
  assert.throws(() => h.snapshot.captureCanvasForSubmission(), /temporary export failure/);
  h.failures.delete('c1');
  assert.equal(h.finalStates().length, 1);
});

test('a Canvas first observed while active remains known after immediate unmount', () => {
  const h = harness({ uids: ['c1'] });
  h.active.add('c1');
  h.snapshot.captureCanvasProgress();
  assert.deepEqual(h.exports, []);
  h.unmount('c1');
  h.active.delete('c1');
  assert.equal(h.finalStates().length, 1);
});


test('recovering one Canvas cannot erase an unresolved error for another UID', () => {
  const h = harness();
  h.failures.set('c1', new Error('first missing drawing'));
  assert.throws(() => h.snapshot.captureCanvasProgress(), /first missing drawing/);
  h.unmount('c1');
  h.records.delete('c1');
  h.failures.delete('c1');
  h.failures.set('c2', new Error('second temporary failure'));
  assert.throws(() => h.snapshot.captureCanvasProgress(), /second temporary failure/);
  h.failures.delete('c2');
  h.snapshot.captureCanvasProgress();
  assert.throws(() => h.snapshot.captureCanvasForSubmission(), /first missing drawing/);
});


test('a legacy getter hidden while mounted is retried by UID after slide change', () => {
  const h = harness({ mode: 'legacy-store', uids: ['c1'] });
  const getter = h.api.getCanvasStoreEntry;
  h.api.getCanvasStoreEntry = () => null;
  assert.equal(h.snapshot.captureCanvasProgress().length, 0);
  h.unmount('c1');
  h.api.getCanvasStoreEntry = getter;
  assert.equal(h.finalStates().length, 1);
});

test('a temporary legacy Store failure recovers on the same UID', () => {
  const h = harness({ mode: 'legacy-store', uids: ['c1'] });
  const getter = h.api.getCanvasStoreEntry;
  h.api.getCanvasStoreEntry = () => { throw new Error('temporarily unavailable'); };
  assert.throws(() => h.snapshot.captureCanvasProgress(), /Canvas "c1"/);
  h.api.getCanvasStoreEntry = getter;
  assert.equal(h.finalStates().length, 1);
});


test('final live projection retains the current Canvas grid and selection accent', () => {
  const h = harness({ uids: ['c1'] });
  h.window.getComputedStyle = () => ({ color: '#000', getPropertyValue: name => name === '--canvas-accent' ? '#ff0000' : '' });
  h.update('c1', { bgMode: 'grid', ITEMS: [
    stroke(), { kind: 'rect', x0: 20, y0: 20, x1: 60, y1: 60, alpha: 0.28 },
  ] });
  h.snapshot.captureCanvasProgress();
  assertNoAutomaticEncoding(h);
  const state = h.finalStates()[0];
  assert.equal(state.bg.c, 'rgba(255,0,0,0.65)');
  assert.equal(state.it[1].f, 'rgba(255,0,0,0.28)');
});
