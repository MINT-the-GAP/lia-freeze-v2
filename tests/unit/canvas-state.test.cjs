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
const canvasPromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'canvas-state.ts'));
const codecPromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'codec.ts'));

function rawState(overrides = {}) {
  return {
    v: 'cvf1',
    u: '3_2',
    w: 480,
    h: 180,
    bg: { m: 'none' },
    it: [],
    ...overrides,
  };
}

function denseZigZag(count = 900) {
  return Array.from({ length: count }, (_, index) => [
    index * 2.25,
    index % 2 === 0 ? 9 : 13.5,
  ]);
}

function allStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach(entry => allStrings(entry, output));
  else if (value && typeof value === 'object') Object.values(value).forEach(entry => allStrings(entry, output));
  return output;
}

function pointSegmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const projection = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy),
  ));
  return Math.hypot(
    point[0] - (start[0] + projection * dx),
    point[1] - (start[1] + projection * dy),
  );
}

function maximumPolylineDeviation(points, polyline) {
  assert.ok(polyline.length >= 2, 'the simplified path needs at least one segment');
  return Math.max(...points.map(point => {
    let minimum = Infinity;
    for (let index = 1; index < polyline.length; index++) {
      minimum = Math.min(minimum, pointSegmentDistance(point, polyline[index - 1], polyline[index]));
    }
    return minimum;
  }));
}

function compactItems(compactState) {
  const value = compactState[6];
  if (value === 0) return [];
  return Array.isArray(value[0]) ? value : [value];
}

function replaceFirstBinaryToken(value, replacement) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index++) {
    if (typeof value[index] === 'string' && value[index].startsWith('b')) {
      value[index] = replacement;
      return true;
    }
    if (Array.isArray(value[index]) && replaceFirstBinaryToken(value[index], replacement)) return true;
  }
  return false;
}

function truncatedBinaryPathWithCount(count) {
  const bytes = [];
  const pushVarUint = input => {
    let value = input;
    while (value >= 0x80) {
      bytes.push((value % 0x80) + 0x80);
      value = Math.floor(value / 0x80);
    }
    bytes.push(value);
  };
  pushVarUint(3 * 2);
  pushVarUint(count * 2);
  return 'b' + Buffer.from(bytes).toString('base64url');
}

test('roundtrips pen, eraser, point, rectangle, background, colors and styles', async () => {
  const { compactCanvasStates, expandCanvasStatesForRestore, CANVAS_COMPACT_VERSION } = await canvasPromise;
  const source = rawState({
    bg: { m: 'grid', s: 23.47, ox: 1.12, oy: 2.34, c: 'rgba(10,20,30,0.65)', lw: 1.125 },
    it: [
      { k: 'p', c: '#ff0000', a: 0.75, w: 2.35, p: [[0, 0], [3, 2], [6, 4], [9, 8]] },
      { k: 'e', c: '#000000', a: 1, w: 9.5, p: [[4, 5], [8, 9], [12, 10]] },
      { k: 'p', c: 'rgb(12, 34, 56)', a: 0, w: 1.25, p: [[17, 19]] },
      { k: 'r', f: 'rgba(255,117,0,0.28)', x: 11.2, y: 13.7, w: 22.6, h: 30.1 },
    ],
  });

  const compact = compactCanvasStates([source]);
  assert.equal(compact[0][0], CANVAS_COMPACT_VERSION);
  assert.equal(compact[0][1], 3 * 64 + 2, 'standard UID must be numerically packed');

  const [expanded] = expandCanvasStatesForRestore(compact);
  assert.equal(expanded.v, 'cvf1');
  assert.equal(expanded.u, source.u);
  assert.deepEqual(expanded.bg, source.bg);
  assert.deepEqual(expanded.it.map(item => item.k), ['p', 'e', 'p', 'r']);
  assert.equal(expanded.it[0].c, '#ff0000');
  assert.equal(expanded.it[0].a, 0.75);
  assert.equal(expanded.it[0].w, 2.35);
  assert.equal(expanded.it[2].c, 'rgb(12, 34, 56)');
  assert.equal(expanded.it[2].a, 0, 'fully transparent alpha must not become one');
  assert.equal(expanded.it[2].p.length, 2, 'a collapsed short stroke must remain a visible round-cap dot');
  assert.deepEqual(expanded.it[2].p[0], expanded.it[2].p[1]);
  assert.equal(expanded.it[3].f, 'rgba(255,117,0,0.28)');

  for (const item of expanded.it) {
    if (Array.isArray(item.p)) {
      for (const [x, y] of item.p) {
        assert.equal(Number.isInteger(x / 2.25), true);
        assert.equal(Number.isInteger(y / 2.25), true);
      }
    }
  }
});

test('grows stale responsive dimensions to include every stored stroke point', async () => {
  const { compactCanvasStates, expandCanvasStatesForRestore } = await canvasPromise;
  const source = rawState({
    w: 379,
    h: 291,
    it: [{
      k: 'p',
      c: '#fff',
      a: 1,
      w: 3,
      p: [[279, 281.25], [780.75, 92.25]],
    }],
  });
  const compact = compactCanvasStates([source]);
  assert.equal(compact[0][2], 783, 'new links store the complete extent');
  compact[0][2] = 379;
  const [expanded] = expandCanvasStatesForRestore(compact);
  assert.equal(expanded.w, 783);
  assert.equal(expanded.h, 291);
  assert.equal(expanded.it[0].p.at(-1)[0], 780.75);
});

test('uses the legacy 2.25px quantization, filters straight paths and keeps bends', async () => {
  const {
    quantizeCanvasPathPoints,
    simplifyCanvasPointsDouglasPeucker,
    CANVAS_GRID_STEP_PX,
  } = await canvasPromise;

  assert.equal(CANVAS_GRID_STEP_PX, 2.25);
  const line = Array.from({ length: 101 }, (_, index) => [index * 2, index * 2]);
  const quantized = quantizeCanvasPathPoints(line);
  assert.deepEqual(quantized, [[0, 0], [89, 89]]);

  const bend = simplifyCanvasPointsDouglasPeucker([[0, 0], [10, 0], [10, 10]]);
  assert.deepEqual(bend, [[0, 0], [10, 0], [10, 10]]);

  const longLine = Array.from({ length: 20_000 }, (_, index) => [index, index]);
  assert.deepEqual(
    simplifyCanvasPointsDouglasPeucker(longLine),
    [[0, 0], [19_999, 19_999]],
    'iterative Douglas-Peucker must handle long paths without recursion overflow',
  );

  const adversarial = Array.from({ length: 20_000 }, (_, index) => [index, index % 2 ? 10 : 0]);
  const bounded = simplifyCanvasPointsDouglasPeucker(adversarial);
  assert.deepEqual(bounded[0], adversarial[0]);
  assert.deepEqual(bounded.at(-1), adversarial.at(-1));
  assert.ok(bounded.length >= 2, 'the DP work budget must fall back without dropping the path');
});

test('keeps smooth sine and circular-arc geometry within 3.2px after quantization and DP', async () => {
  const { quantizeCanvasPathPoints, CANVAS_GRID_STEP_PX } = await canvasPromise;
  const paths = [
    Array.from({ length: 721 }, (_, index) => {
      const x = index * 0.5;
      return [x, 60 + 32 * Math.sin(x / 27)];
    }),
    Array.from({ length: 721 }, (_, index) => {
      const angle = -Math.PI * 0.85 + index * (Math.PI * 1.7 / 720);
      return [120 + 83 * Math.cos(angle), 105 + 83 * Math.sin(angle)];
    }),
  ];

  for (const source of paths) {
    const quantized = quantizeCanvasPathPoints(source);
    assert.ok(quantized && quantized.length >= 2);
    const restored = quantized.map(([x, y]) => [
      x * CANVAS_GRID_STEP_PX,
      y * CANVAS_GRID_STEP_PX,
    ]);
    assert.ok(
      maximumPolylineDeviation(source, restored) <= 3.2,
      'the complete minimum-distance, quantization and DP pipeline must remain visually faithful',
    );
  }
});

test('selects binary delta/zigzag/varint paths when they are shorter', async () => {
  const { compactCanvasStates, expandCanvasStatesForRestore } = await canvasPromise;
  const source = rawState({
    it: [{ k: 'p', c: '#0055ff', a: 1, w: 2, p: denseZigZag() }],
  });
  const compact = compactCanvasStates([source]);
  const binaryTokens = allStrings(compact).filter(value => value.startsWith('b'));
  assert.ok(binaryTokens.length > 0, 'a dense small-delta path should use binary varints');
  binaryTokens.forEach(token => assert.match(token.slice(1), /^[A-Za-z0-9_-]+$/));

  const [expanded] = expandCanvasStatesForRestore(compact);
  assert.equal(expanded.it.length, 1);
  assert.ok(expanded.it[0].p.length > 400, 'zigzag bends must survive Douglas-Peucker');
  assert.ok(JSON.stringify(compact).length < JSON.stringify(source).length / 3);
});

test('path runs are present in the payload and break at every adjacent style change', async () => {
  const { compactCanvasStates, expandCanvasStatesForRestore } = await canvasPromise;
  const source = rawState({
    it: [
      { k: 'p', c: '#000000', a: 1, w: 2, p: denseZigZag(80) },
      { k: 'p', c: '#000000', a: 1, w: 2, p: denseZigZag(70).map(([x, y]) => [x, y + 30]) },
      { k: 'p', c: '#ff0000', a: 1, w: 2, p: denseZigZag(60).map(([x, y]) => [x, y + 60]) },
      { k: 'p', c: '#ff0000', a: 1, w: 3, p: denseZigZag(50).map(([x, y]) => [x, y + 90]) },
      { k: 'p', c: '#ff0000', a: 0.5, w: 3, p: denseZigZag(40).map(([x, y]) => [x, y + 120]) },
    ],
  });
  const compact = compactCanvasStates([source]);
  const items = compactItems(compact[0]);
  assert.equal(items.length, 4, 'only the first two paths may collapse into one run tuple');
  const runTokens = items
    .map(item => item.at(-1))
    .filter(token => typeof token === 'string' && token.includes('~'));
  assert.equal(runTokens.length, 1, 'the compact payload must contain an actual path-run token');
  assert.equal(runTokens[0].split('~').length, 2);
  assert.equal(items[0][2], 200);
  assert.notEqual(items[0][1], items[1][1], 'the adjacent color really differs');
  assert.equal(items[1][2], 200, 'a color change must terminate the run');
  assert.equal(items[2][2], 300, 'a width change must terminate the run');
  assert.equal(items[3][3], 500, 'an alpha change must terminate the run');

  const [expanded] = expandCanvasStatesForRestore(compact);
  assert.deepEqual(expanded.it.map(item => item.k), ['p', 'p', 'p', 'p', 'p']);
  assert.deepEqual(
    expanded.it.map(item => [item.c, item.w, item.a]),
    [
      ['#000000', 2, 1],
      ['#000000', 2, 1],
      ['#ff0000', 2, 1],
      ['#ff0000', 3, 1],
      ['#ff0000', 3, 0.5],
    ],
  );
});

test('preserves the semantic default-theme color marker through compact and expand', async () => {
  const { compactCanvasStates, expandCanvasStatesForRestore, CANVAS_COMPACT_VERSION } = await canvasPromise;
  const source = rawState({
    it: [{
      k: 'p', c: '#202020', ck: 'default', a: 1, w: 2,
      p: [[0, 0], [20, 10], [40, 0]],
    }],
  });

  const compact = compactCanvasStates([source]);
  assert.equal(compact[0][0], CANVAS_COMPACT_VERSION, 'the marker must not force a raw-state fallback');
  const [expanded] = expandCanvasStatesForRestore(compact);
  assert.equal(expanded.it[0].ck, 'default');
  assert.equal(expanded.it[0].c, '#202020', 'the captured color remains a literal fallback');
});

test('keeps raw cvf1 states for unknown future fields or items', async () => {
  const { compactCanvasStates, expandCanvasStatesForRestore } = await canvasPromise;
  const futureItem = rawState({ it: [{ k: 'future-path', payload: [1, 2, 3] }] });
  const futureState = rawState({ future: true });

  assert.strictEqual(compactCanvasStates([futureItem])[0], futureItem);
  assert.strictEqual(compactCanvasStates([futureState])[0], futureState);
  assert.strictEqual(expandCanvasStatesForRestore([futureItem])[0], futureItem);
});

test('validates raw cvf1 legacy states before handing them to the renderer', async () => {
  const { expandCanvasStatesForRestore } = await canvasPromise;
  const safe = rawState({
    it: [{ k: 'p', c: '#000000', a: 1, w: 2, p: [[0.01, 0.02], [20.03, 30.04]] }],
  });
  assert.strictEqual(expandCanvasStatesForRestore([safe])[0], safe);
  assert.deepEqual(expandCanvasStatesForRestore([rawState({ w: 50_000 })]), []);
  assert.deepEqual(expandCanvasStatesForRestore([
    rawState({ it: [{ k: 'p', c: '#000000', a: 1, w: 2, p: [[0, 0], [Infinity, 2]] }] }),
  ]), []);
  assert.deepEqual(expandCanvasStatesForRestore([rawState({ w: '480' })]), []);
  assert.deepEqual(expandCanvasStatesForRestore([
    rawState({ it: [{ k: 'p', c: '#000000', a: true, w: 2, p: [[0, 0], [10, 2]] }] }),
  ]), []);
  assert.deepEqual(expandCanvasStatesForRestore([
    rawState({ it: [{ k: 'p', c: '#000000', a: 1, w: 2 }] }),
  ]), []);
});

test('strictly rejects malformed cvq1 tuple shapes, UIDs, numbers and color indexes', async () => {
  const { compactCanvasStates, expandCanvasStateForRestore } = await canvasPromise;
  const base = compactCanvasStates([rawState({
    it: [{ k: 'p', c: '#000000', a: 1, w: 2, p: [[0, 0], [20, 20]] }],
  })])[0];
  const malformed = [];

  const trailing = structuredClone(base);
  trailing.push(0, 0);
  malformed.push(['trailing tuple fields', trailing]);

  const emptyUid = structuredClone(base);
  emptyUid[1] = '';
  malformed.push(['empty UID', emptyUid]);

  const invalidPackedUid = structuredClone(base);
  invalidPackedUid[1] = 1;
  malformed.push(['out-of-range packed UID', invalidPackedUid]);

  const coercedWidth = structuredClone(base);
  coercedWidth[2] = '480';
  malformed.push(['string canvas width', coercedWidth]);

  const invalidColor = structuredClone(base);
  compactItems(invalidColor)[0][1] = 999;
  malformed.push(['out-of-range color index', invalidColor]);

  for (const [label, value] of malformed) {
    assert.equal(expandCanvasStateForRestore(value), null, label);
  }
});

test('merge carries unmounted slides but an explicit clear replaces old ink', async () => {
  const { compactCanvasStates, expandCanvasStatesForRestore, mergeCanvasStates } = await canvasPromise;
  const drawn = compactCanvasStates([
    rawState({ u: '1_0', it: [{ k: 'p', c: '#000000', a: 1, w: 2, p: [[0, 0], [20, 20]] }] }),
  ]);
  const otherSlide = compactCanvasStates([
    rawState({ u: '2_0', it: [{ k: 'p', c: '#ff0000', a: 1, w: 2, p: [[0, 0], [30, 10]] }] }),
  ]);

  const carried = mergeCanvasStates(drawn, otherSlide);
  assert.deepEqual(expandCanvasStatesForRestore(carried).map(state => state.u), ['2_0', '1_0']);

  const cleared = compactCanvasStates([
    rawState({ u: '1_0', e: 1, w: 0, h: 0, it: [] }),
  ]);
  const lifecycleCapture = expandCanvasStatesForRestore(mergeCanvasStates(carried, cleared));
  assert.ok(
    lifecycleCapture.find(state => state.u === '1_0').it.length > 0,
    'a transient empty mount must not erase accumulated ink',
  );

  const afterClear = expandCanvasStatesForRestore(
    mergeCanvasStates(carried, cleared, { acceptEmptyChanges: true }),
  );
  const clearedState = afterClear.find(state => state.u === '1_0');
  assert.equal(clearedState.e, 1);
  assert.deepEqual(clearedState.it, []);
});

test('rejects malformed binary paths without partially rendering the state', async () => {
  const { compactCanvasStates, expandCanvasStateForRestore } = await canvasPromise;
  const compact = structuredClone(compactCanvasStates([
    rawState({ it: [{ k: 'p', c: '#000000', a: 1, w: 2, p: denseZigZag() }] }),
  ])[0]);
  assert.equal(replaceFirstBinaryToken(compact, 'bAQ'), true);
  assert.equal(expandCanvasStateForRestore(compact), null);
});

test('a malformed state cannot consume the shared point budget of following canvases', async () => {
  const { compactCanvasStates, expandCanvasStatesForRestore } = await canvasPromise;
  const valid = compactCanvasStates([
    rawState({ it: [{ k: 'p', c: '#000000', a: 1, w: 2, p: [[0, 0], [20, 20]] }] }),
  ])[0];
  const malformed = [structuredClone(valid), structuredClone(valid)];
  for (const state of malformed) {
    const item = compactItems(state)[0];
    item[item.length - 1] = truncatedBinaryPathWithCount(200_000);
  }

  const expanded = expandCanvasStatesForRestore([...malformed, valid]);
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].u, '3_2');
});

test('whole snapshot still uses the existing Blob/stream gzip codec', async () => {
  const { compactCanvasStates } = await canvasPromise;
  const { encodeToken, decodeToken } = await codecPromise;
  const canvas = compactCanvasStates([
    rawState({ it: [{ k: 'p', c: '#000000', a: 1, w: 2, p: denseZigZag(1500) }] }),
  ]);
  const payload = { v: 'sf-mini-ti-4', sh: '#1', s: [{ h: '#1', canvas }] };
  const encoded = await encodeToken(payload);
  assert.equal(encoded.mode, 'gzip');
  assert.deepEqual(await decodeToken(encoded.token), payload);
});


test('rebuilds a cropped export with the complete resized Canvas viewport', async () => {
  const {
    buildFullCanvasFreezeState,
    compactCanvasStates,
    expandCanvasStateForRestore,
  } = await canvasPromise;
  const cropped = rawState({
    u: '22_0',
    w: 190,
    h: 29,
    it: [{ k: 'p', c: '#000', a: 1, w: 3, p: [[10, 8], [180, 12]] }],
  });
  const entry = {
    VIEW: { panX: 0, panY: 0, scale: 1 },
    ITEMS: [
      {
        kind: 'path',
        tool: 'pen',
        color: '#000',
        alpha: 1,
        width: 3,
        points: [{ x: 20, y: 62 }, { x: 170, y: 68 }],
      },
      {
        kind: 'path',
        tool: 'pen',
        color: '#000',
        alpha: 1,
        width: 3,
        points: [{ x: 20, y: 382 }, { x: 170, y: 390 }],
      },
    ],
    bgMode: 'none',
    bgStep: 24,
    wrapW: 190,
    canvasH: 425,
  };

  const full = buildFullCanvasFreezeState(cropped, '22_0', entry, {
    width: 190,
    height: 425,
  });
  assert.equal(full.w, 190);
  assert.equal(full.h, 425);
  assert.equal(full.it.length, 2);
  assert.ok(full.it[0].p.every(point => point[1] < 100));
  assert.ok(full.it[1].p.every(point => point[1] > 350));

  const restored = expandCanvasStateForRestore(compactCanvasStates([full])[0]);
  assert.equal(restored.w, 190);
  assert.equal(restored.h, 425);
  assert.equal(restored.it.length, 2);
  assert.ok(Math.max(...restored.it[1].p.map(point => point[1])) > 385);
});

test('keeps offscreen Store content by shifting the full Canvas origin', async () => {
  const { buildFullCanvasFreezeState } = await canvasPromise;
  const entry = {
    VIEW: { panX: 0, panY: 0, scale: 1 },
    ITEMS: [{
      kind: 'path',
      tool: 'eraser',
      color: '#ffffff',
      alpha: 0.75,
      width: 4,
      points: [{ x: -20, y: -15 }, { x: 220, y: 450 }],
    }],
    bgMode: 'grid',
    bgStep: 25,
    wrapW: 190,
    canvasH: 425,
  };
  const full = buildFullCanvasFreezeState(
    rawState({ u: '22_0', bg: { m: 'grid', c: '#123456', lw: 1 } }),
    '22_0',
    entry,
    { width: 190, height: 425 },
  );

  assert.ok(full.w > 190);
  assert.ok(full.h > 425);
  assert.ok(full.it[0].p.every(point => point[0] >= 0 && point[1] >= 0));
  assert.equal(
    Math.round(full.it[0].p[1][0] - full.it[0].p[0][0]),
    240,
  );
  assert.equal(full.bg.m, 'grid');
  assert.ok(full.bg.ox >= 0 && full.bg.ox < full.bg.s);
  assert.ok(full.bg.oy >= 0 && full.bg.oy < full.bg.s);
});

test('preserves a real single-point pen mark across compact restore', async () => {
  const {
    buildFullCanvasFreezeState,
    compactCanvasStates,
    expandCanvasStateForRestore,
  } = await canvasPromise;
  const full = buildFullCanvasFreezeState(
    rawState({ u: '22_0', w: 0, h: 0, e: 1 }),
    '22_0',
    {
      VIEW: { panX: 0, panY: 0, scale: 1 },
      ITEMS: [{
        kind: 'path',
        tool: 'pen',
        color: '#000000',
        alpha: 1,
        width: 3,
        points: [{ x: 100, y: 300 }],
      }],
      bgMode: 'none',
      bgStep: 24,
      wrapW: 190,
      canvasH: 425,
    },
    { width: 190, height: 425 },
  );
  assert.equal(full.e, undefined);
  assert.equal(full.it[0].p.length, 1);

  const restored = expandCanvasStateForRestore(compactCanvasStates([full])[0]);
  assert.equal(restored.w, 190);
  assert.equal(restored.h, 425);
  assert.equal(restored.it.length, 1);
  assert.equal(restored.it[0].p.length, 2);
  assert.deepEqual(restored.it[0].p[0], restored.it[0].p[1]);
});

test('falls back transactionally for malformed or future Canvas Store entries', async () => {
  const { buildFullCanvasFreezeState } = await canvasPromise;
  const raw = rawState({ u: '22_0' });
  assert.equal(buildFullCanvasFreezeState(raw, '22_0', {
    VIEW: { panX: 0, panY: 0, scale: 0 },
    ITEMS: [],
    wrapW: 190,
    canvasH: 425,
  }), null);
  assert.equal(buildFullCanvasFreezeState(raw, '22_0', {
    VIEW: { panX: 0, panY: 0, scale: 1 },
    ITEMS: [{ kind: 'future-shape' }],
    wrapW: 190,
    canvasH: 425,
  }), null);
});
