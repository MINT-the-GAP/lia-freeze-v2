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
const statePromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'marker-state.ts'));

function highlight(overrides = {}) {
  return {
    id: 4,
    kind: 'user',
    color: 'red',
    anchor: { sp: '0/1/2', so: 0, ep: '0/1/2', eo: 3 },
    rects: [{ x: 10, y: 20, w: 30, h: 12 }],
    scope: 'S1',
    slide: 'SLIDE_2',
    ...overrides,
  };
}

test('captures the live keyed marker instance as a validated deep copy', async () => {
  const { captureMarkerState } = await statePromise;
  const source = highlight();
  const registry = {
    instances: {
      stale: { __alive: false, HL: [highlight({ id: 1 })], nextId: 2 },
      'course::Title': { __alive: true, HL: [source], nextId: 12 },
    },
  };

  const captured = captureMarkerState([registry, registry]);
  assert.deepEqual(captured, {
    v: 1,
    i: [{
      k: 'course::Title',
      h: [{ ...source, rects: [] }],
      n: 12,
    }],
  });
  assert.notEqual(captured.i[0].h[0], source);
  assert.notEqual(captured.i[0].h[0].anchor, source.anchor);
  assert.notEqual(captured.i[0].h[0].rects, source.rects);
  assert.deepEqual(source.rects, [{ x: 10, y: 20, w: 30, h: 12 }]);
});

test('restores main/Proposals through the public API and advances nextId', async () => {
  const { restoreMarkerState } = await statePromise;
  const instance = { __alive: true, HL: [], nextId: 1, state: {} };
  let calls = 0;
  const registry = {
    instances: { 'course::Title': instance },
    setHighlights(value) {
      calls += 1;
      instance.HL = value;
    },
  };
  const source = highlight({ id: 9 });

  assert.equal(restoreMarkerState([registry], {
    v: 1,
    i: [{ k: 'course::Title', h: [source], n: 3 }],
  }), true);
  assert.equal(calls, 1);
  assert.deepEqual(instance.HL, [source]);
  assert.notEqual(instance.HL[0], source);
  assert.equal(instance.nextId, 10);
});

test('restores the public 0.0.1 tag by assigning its concrete instance', async () => {
  const { restoreMarkerState } = await statePromise;
  const tagInstance = { __alive: true, HL: [], nextId: 1, state: {} };
  const registry = { instances: { 'tag-course::Title': tagInstance } };
  const state = {
    v: 1,
    i: [{ k: 'tag-course::Title', h: [highlight({ color: 'blue' })], n: 8 }],
  };

  assert.equal(restoreMarkerState([registry], state), true);
  assert.equal(tagInstance.HL.length, 1);
  assert.equal(tagInstance.HL[0].color, 'blue');
  assert.equal(tagInstance.nextId, 8);
});

test('synchronizes restored prefill keys so delayed template scans cannot duplicate them', async () => {
  const { restoreMarkerState } = await statePromise;
  const instance = { __alive: true, HL: [], nextId: 1, state: {} };
  const registry = { instances: { course: instance } };
  const prefill = highlight({ kind: 'prefill', color: 'yellow', id: 7 });

  assert.equal(restoreMarkerState([registry], {
    v: 1,
    i: [{ k: 'course', h: [prefill], n: 8 }],
  }), true);
  assert.deepEqual([...instance.__prefillKeys], [
    'P|yellow|S1|SLIDE_2|0/1/2|0|0/1/2|3',
  ]);
});

test('matches multiple frames by document key and accepts legacy array links', async () => {
  const { restoreMarkerState } = await statePromise;
  const first = { __alive: true, HL: [], state: {} };
  const second = { __alive: true, HL: [], state: {} };
  const registry = { instances: { A: first, B: second } };

  assert.equal(restoreMarkerState([registry], {
    v: 1,
    i: [
      { k: 'B', h: [highlight({ id: 2, color: 'green' })], n: 3 },
      { k: 'A', h: [highlight({ id: 5, color: 'orange' })], n: 6 },
    ],
  }), true);
  assert.equal(first.HL[0].color, 'orange');
  assert.equal(second.HL[0].color, 'green');

  const legacy = { instances: { only: { __alive: true, HL: [], state: {} } } };
  assert.equal(restoreMarkerState([legacy], [highlight({ color: 'pink' })]), true);
  assert.equal(legacy.instances.only.HL[0].color, 'pink');
});

test('matches the same course after the shared-link fragment changes', async () => {
  const { restoreMarkerState } = await statePromise;
  const other = { __alive: true, HL: [], state: {} };
  const course = { __alive: true, HL: [], state: {} };
  const registry = {
    instances: {
      'https://example.test/other.md#submission=teacher::Other': other,
      'https://example.test/course.md#submission=teacher::Course': course,
    },
  };

  assert.equal(restoreMarkerState([registry], {
    v: 1,
    i: [{
      k: 'https://example.test/course.md#submission=student::Course',
      h: [highlight({ color: 'blue' })],
      n: 5,
    }],
  }), true);
  assert.equal(course.HL[0].color, 'blue');
  assert.deepEqual(other.HL, []);
});

test('rejects malformed URL data and deactivates every marker tool', async () => {
  const {
    deactivateMarkerRegistries,
    sanitizeMarkerHighlights,
  } = await statePromise;
  assert.deepEqual(sanitizeMarkerHighlights([
    highlight(),
    highlight({ color: 'purple' }),
    { id: 1, kind: 'user' },
  ]), [highlight()]);
  const unique = sanitizeMarkerHighlights([
    highlight({ id: 2 }),
    highlight({ id: 2, color: 'blue' }),
    highlight({ id: Number.MAX_SAFE_INTEGER, color: 'green' }),
    highlight({ anchor: { sp: 'foo', so: 0, ep: '0/1', eo: 1 } }),
    highlight({ anchor: { sp: '////', so: 0, ep: '0/1', eo: 1 } }),
  ]);
  assert.deepEqual(unique.map(item => item.id), [2, 1, 3]);
  assert.deepEqual(unique.map(item => item.color), ['red', 'blue', 'green']);

  const safeBoundary = sanitizeMarkerHighlights([
    highlight({ id: Number.MAX_SAFE_INTEGER - 1 }),
    highlight({ id: Number.MAX_SAFE_INTEGER - 1, color: 'blue' }),
    highlight({ id: Number.MAX_SAFE_INTEGER - 1, color: 'green' }),
  ]);
  assert.deepEqual(safeBoundary.map(item => item.id), [
    Number.MAX_SAFE_INTEGER - 1,
    1,
    2,
  ]);
  assert.ok(safeBoundary.every(item => Number.isSafeInteger(item.id)));

  const a = { state: { active: true, panelOpen: true, tool: 'mark' } };
  const b = { state: { active: true, panelOpen: true, tool: 'explain' } };
  assert.equal(deactivateMarkerRegistries([
    { instances: { a, b } },
  ]), true);
  assert.equal(a.state.active, false);
  assert.equal(a.state.panelOpen, false);
  assert.equal(b.state.active, false);
  assert.equal(b.state.panelOpen, false);
});
