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

const repoRoot = path.resolve(__dirname, '..', '..');
const annotationPromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'annotation-state.ts'));
const codecPromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'codec.ts'));

function pathItem(overrides = {}) {
  return {
    kind: 'path',
    tool: 'pen',
    color: '#ff0000',
    width: 3,
    alpha: 1,
    baseW: 1000,
    points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
    ...overrides,
  };
}

function rawState(slides = {}, visible = true) {
  return {
    version: 'lia-annotation-freeze-v1',
    ui: { visible },
    slides,
  };
}

function slide(items) {
  return { items, redo: [] };
}

function denseZigZag(count = 1500) {
  return Array.from({ length: count }, (_, index) => ({
    x: index / 2000,
    y: index % 2 === 0 ? 0.1 : 0.115,
  }));
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
  return Math.max(...points.map(point => {
    let minimum = Infinity;
    for (let index = 1; index < polyline.length; index++) {
      minimum = Math.min(minimum, pointSegmentDistance(point, polyline[index - 1], polyline[index]));
    }
    return minimum;
  }));
}

function sampleAnnotationStroke(points, steps = 8) {
  if (points.length <= 1) return points.slice();
  if (points.length === 2) return points.slice();
  const output = [points[0]];
  const firstMidpoint = [
    (points[0][0] + points[1][0]) / 2,
    (points[0][1] + points[1][1]) / 2,
  ];
  output.push(firstMidpoint);
  let start = firstMidpoint;
  for (let index = 1; index < points.length - 1; index++) {
    const control = points[index];
    const end = [
      (points[index][0] + points[index + 1][0]) / 2,
      (points[index][1] + points[index + 1][1]) / 2,
    ];
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const inverse = 1 - t;
      output.push([
        inverse * inverse * start[0] + 2 * inverse * t * control[0] + t * t * end[0],
        inverse * inverse * start[1] + 2 * inverse * t * control[1] + t * t * end[1],
      ]);
    }
    start = end;
  }
  output.push(points.at(-1));
  return output;
}

function firstTuple(compact, slideIndex = 0, itemIndex = 0) {
  return compact.s[slideIndex][1][itemIndex];
}

test('roundtrips ordered pen, eraser and dot paths with styles and visibility', async () => {
  const {
    compactAnnotationFreezeState,
    expandAnnotationFreezeStateForRestore,
    ANNOTATION_COMPACT_VERSION,
  } = await annotationPromise;
  const source = rawState({
    '#1': slide([
      pathItem({ points: [{ x: 0.1111, y: 0.2222 }] }),
      pathItem({
        tool: 'eraser', color: '#000000', width: 18, alpha: 1, baseW: 1366,
        points: [{ x: 0.2, y: 0.3 }, { x: 0.25, y: 0.35 }],
      }),
    ]),
    '#12': slide([pathItem({
      color: 'rgba(12, 34, 56, 0.7)', width: 4.25, alpha: 0.65, baseW: 1920,
      points: [{ x: 0, y: 0 }, { x: 0.1, y: 0.2 }, { x: 0.2, y: 0.25 }],
    })]),
  }, false);

  const compact = compactAnnotationFreezeState(source);
  assert.equal(compact.v, ANNOTATION_COMPACT_VERSION);
  assert.equal(compact.u, 0);
  assert.deepEqual(compact.s.map(entry => entry[0]), [1, 12]);
  assert.equal(compact.c.length, 3);

  const expanded = expandAnnotationFreezeStateForRestore(compact);
  assert.equal(expanded.ui.visible, false);
  assert.deepEqual(expanded.slides['#1'].items.map(item => item.tool), ['pen', 'eraser']);
  assert.equal(expanded.slides['#1'].items[0].points.length, 1, 'a one-point path remains a dot');
  assert.deepEqual(
    expanded.slides['#12'].items[0],
    {
      kind: 'path', tool: 'pen', color: 'rgba(12, 34, 56, 0.7)',
      width: 4.25, alpha: 0.65, baseW: 1920,
      points: [{ x: 0, y: 0 }, { x: 0.1, y: 0.2 }, { x: 0.2, y: 0.25 }],
    },
  );
  assert.deepEqual(expanded.slides['#12'].redo, []);
});

test('uses a 1/1000 relative grid and iterative Douglas-Peucker without losing bends', async () => {
  const {
    quantizeAnnotationPathPoints,
    simplifyAnnotationPointsDouglasPeucker,
    ANNOTATION_POINT_SCALE,
  } = await annotationPromise;
  assert.equal(ANNOTATION_POINT_SCALE, 1000);

  const line = Array.from({ length: 101 }, (_, index) => ({ x: index / 100, y: index / 100 }));
  assert.deepEqual(quantizeAnnotationPathPoints(line, 1000), [[0, 0], [1000, 1000]]);
  assert.deepEqual(
    simplifyAnnotationPointsDouglasPeucker([[0, 0], [10, 0], [10, 10]], 1),
    [[0, 0], [10, 0], [10, 10]],
  );

  const longLine = Array.from({ length: 20_000 }, (_, index) => [index, index]);
  assert.deepEqual(
    simplifyAnnotationPointsDouglasPeucker(longLine, 1),
    [[0, 0], [19_999, 19_999]],
  );
  const adversarial = Array.from({ length: 20_000 }, (_, index) => [index, index % 2 ? 10 : 0]);
  const bounded = simplifyAnnotationPointsDouglasPeucker(adversarial, 1);
  assert.deepEqual(bounded[0], adversarial[0]);
  assert.deepEqual(bounded.at(-1), adversarial.at(-1));
});

test('keeps sine and arc geometry within 3.2 pixels after the complete pipeline', async () => {
  const { quantizeAnnotationPathPoints, ANNOTATION_POINT_SCALE } = await annotationPromise;
  const baseW = 1920;
  const pixelPaths = [
    Array.from({ length: 721 }, (_, index) => {
      const x = index * 2;
      return [x, 400 + 90 * Math.sin(x / 90)];
    }),
    Array.from({ length: 721 }, (_, index) => {
      const angle = -Math.PI * 0.85 + index * (Math.PI * 1.7 / 720);
      return [700 + 260 * Math.cos(angle), 520 + 260 * Math.sin(angle)];
    }),
  ];

  for (const pixels of pixelPaths) {
    const relative = pixels.map(([x, y]) => ({ x: x / baseW, y: y / baseW }));
    const quantized = quantizeAnnotationPathPoints(relative, baseW);
    const restoredPixels = quantized.map(([x, y]) => [
      x / ANNOTATION_POINT_SCALE * baseW,
      y / ANNOTATION_POINT_SCALE * baseW,
    ]);
    assert.ok(maximumPolylineDeviation(pixels, restoredPixels) <= 3.2);
    assert.ok(
      maximumPolylineDeviation(
        sampleAnnotationStroke(pixels),
        sampleAnnotationStroke(restoredPixels),
      ) <= 3.2,
      'the upstream quadratic Bezier rendering must remain visually faithful',
    );
  }
});

test('stores dense point deltas as strict binary VarUint/base64url and shrinks the state', async () => {
  const { compactAnnotationFreezeState, expandAnnotationFreezeStateForRestore } = await annotationPromise;
  const source = rawState({ '#1': slide([pathItem({ points: denseZigZag() })]) });
  const compact = compactAnnotationFreezeState(source);
  const token = firstTuple(compact).at(-1);
  assert.match(token, /^b:[A-Za-z0-9_-]+$/);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(source).length / 3);
  const expanded = expandAnnotationFreezeStateForRestore(compact);
  assert.ok(expanded.slides['#1'].items[0].points.length > 1000);
});

test('decodes legacy af2 base36 tokens and raw freeze-v1 links', async () => {
  const { expandAnnotationFreezeStateForRestore } = await annotationPromise;
  const legacy = {
    v: 'af2',
    c: ['#ff0000'],
    s: [[1, [[0, 0, 2, '0.0.k.k']]]],
  };
  const expanded = expandAnnotationFreezeStateForRestore(legacy);
  assert.deepEqual(expanded.slides['#1'].items[0].points, [
    { x: 0, y: 0 },
    { x: 0.01, y: 0.01 },
  ]);

  const raw = rawState({ '#2': slide([pathItem()]) });
  assert.deepEqual(expandAnnotationFreezeStateForRestore(raw), raw);
});

test('keeps literal colors and hidden-without-ink state observable', async () => {
  const { compactAnnotationFreezeState, expandAnnotationFreezeStateForRestore } = await annotationPromise;
  const hidden = compactAnnotationFreezeState(rawState({}, false));
  assert.deepEqual(hidden, { v: 'af2', u: 0 });
  assert.equal(expandAnnotationFreezeStateForRestore(hidden).ui.visible, false);

  const colors = ['#ffffff', '#000000', 'var(--authored-color)'];
  const state = rawState({ '#1': slide(colors.map(color => pathItem({ color }))) });
  const expanded = expandAnnotationFreezeStateForRestore(compactAnnotationFreezeState(state));
  assert.deepEqual(expanded.slides['#1'].items.map(item => item.color), colors);
});

test('merge carries lifecycle-missing slides while explicit clear remains authoritative', async () => {
  const {
    compactAnnotationFreezeState,
    expandAnnotationFreezeStateForRestore,
    mergeAnnotationFreezeStates,
  } = await annotationPromise;
  const previous = compactAnnotationFreezeState(rawState({
    '#1': slide([pathItem()]),
    '#2': slide([pathItem({ color: '#0055ff' })]),
  }));
  const current = compactAnnotationFreezeState(rawState({
    '#2': slide([pathItem({ color: '#00ff00' })]),
  }));

  const carried = expandAnnotationFreezeStateForRestore(
    mergeAnnotationFreezeStates(previous, current),
  );
  assert.deepEqual(Object.keys(carried.slides), ['#1', '#2']);
  assert.equal(carried.slides['#2'].items[0].color, '#00ff00');

  const clearedSlide = expandAnnotationFreezeStateForRestore(
    mergeAnnotationFreezeStates(previous, current, { acceptEmptyChanges: true }),
  );
  assert.deepEqual(Object.keys(clearedSlide.slides), ['#2']);
  assert.equal(
    mergeAnnotationFreezeStates(previous, null, { acceptEmptyChanges: true }),
    null,
    'an explicit clear-all must not resurrect accumulated ink',
  );
});

test('transactionally rejects malformed envelopes, tuples, styles, colors and point streams', async () => {
  const { compactAnnotationFreezeState, expandAnnotationFreezeStateForRestore } = await annotationPromise;
  const base = compactAnnotationFreezeState(rawState({ '#1': slide([pathItem()]) }));
  const malformed = [];

  const extraEnvelope = structuredClone(base);
  extraEnvelope.future = 1;
  malformed.push(extraEnvelope);

  const badTool = structuredClone(base);
  firstTuple(badTool)[0] = 2;
  malformed.push(badTool);

  const badColor = structuredClone(base);
  firstTuple(badColor)[1] = 999;
  malformed.push(badColor);

  const badAlpha = structuredClone(base);
  const tuple = firstTuple(badAlpha);
  tuple.splice(2, tuple.length - 2, 3, 2, 1000, tuple.at(-1));
  malformed.push(badAlpha);

  const oddBinary = structuredClone(base);
  firstTuple(oddBinary)[firstTuple(oddBinary).length - 1] = 'b:AA';
  malformed.push(oddBinary);

  const duplicateSlide = structuredClone(base);
  duplicateSlide.s.push(structuredClone(duplicateSlide.s[0]));
  malformed.push(duplicateSlide);

  for (const value of malformed) {
    assert.equal(expandAnnotationFreezeStateForRestore(value), null);
  }
});

test('capture limits throw instead of falling back to a raw oversized URL payload', async () => {
  const { compactAnnotationFreezeState, AnnotationStateLimitError } = await annotationPromise;
  const source = rawState({ '#1': slide([pathItem({ color: 'x'.repeat(257) })]) });
  assert.throws(() => compactAnnotationFreezeState(source), AnnotationStateLimitError);
});

test('whole snapshot still uses the existing Blob stream and adaptive gzip exactly once', async () => {
  const { compactAnnotationFreezeState } = await annotationPromise;
  const { encodeToken, decodeToken } = await codecPromise;
  const annot = compactAnnotationFreezeState(rawState({
    '#1': slide([pathItem({ points: denseZigZag(3000) })]),
  }));
  const payload = { v: 'sf-mini-ti-4', sh: '#1', s: [{ h: '#1' }], annot };
  const encoded = await encodeToken(payload);
  assert.equal(encoded.mode, 'gzip');
  assert.deepEqual(await decodeToken(encoded.token), payload);
});
