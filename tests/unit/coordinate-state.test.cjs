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
  path.join(repoRoot, 'src', 'coordinate-state.ts')
);
const codecPromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'codec.ts'));

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function livePoint(x, y, moves = []) {
  return {
    X: () => x,
    Y: () => y,
    moveTo(position, duration) {
      moves.push([position.slice(), duration]);
      x = position[0];
      y = position[1];
    },
  };
}

function assertJsonOnly(value) {
  if (value === null) return;
  if (Array.isArray(value)) {
    value.forEach(assertJsonOnly);
    return;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    assert.ok(prototype === Object.prototype || prototype === null);
    Object.values(value).forEach(assertJsonOnly);
    return;
  }
  assert.ok(
    typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
  );
  if (typeof value === 'number') assert.equal(Number.isFinite(value), true);
}

test('captures a compact JSON projection without live boards, DOM nodes or functions', async () => {
  const { captureCoordinateStates } = await statePromise;
  const liveBoard = {
    [Symbol.toStringTag]: 'JXG.Board',
    containerObj: { isConnected: true },
    update() {},
  };
  const liveNode = {
    [Symbol.toStringTag]: 'HTMLDivElement',
    id: 'board-main',
  };
  const rawBoardState = {
    bbox: [-10.123456789, 8, 12, -6],
    exportBBox: [-11, 9, 13, -7],
    width: 640.126,
    height: '480.5',
    maxStartWidth: 900,
    axisMode: 'cartesian',
    liveBoard,
    liveNode,
    onResize() {},
  };
  const runtime = {
    __coord: {
      getBoardStateStore: () => ({ main: rawBoardState }),
    },
    __boards: { main: liveBoard },
  };

  const captured = captureCoordinateStates([runtime]);

  assert.deepEqual(plain(captured), {
    v: 1,
    b: {
      main: {
        bbox: [-10.12345679, 8, 12, -6],
        exportBBox: [-11, 9, 13, -7],
        width: 640.13,
        height: 480.5,
        maxStartWidth: 900,
        axisMode: 'cartesian',
      },
    },
  });
  assertJsonOnly(captured);
  assert.doesNotThrow(() => JSON.stringify(captured));
  assert.equal(JSON.stringify(captured).includes('containerObj'), false);
  assert.equal(rawBoardState.width, 640.126);
});

test('flushes each connected DGS board before projecting its construction state', async () => {
  const { captureCoordinateStates } = await statePromise;
  const calls = [];
  const connected = { containerObj: { isConnected: true } };
  const broken = { containerObj: { isConnected: true } };
  const disconnected = { containerObj: { isConnected: false } };
  const runtime = {
    __coord: {},
    __boards: { ready: connected, broken, gone: disconnected },
    __dgsConstructionStates: {},
    __persistDgsBoardState(boardId, recordHistory) {
      calls.push([boardId, recordHistory]);
      if (boardId === 'broken') throw new Error('stale board');
      this.__dgsConstructionStates[boardId] = {
        boardId,
        records: [{ type: 'point', x: 1, y: 2 }],
      };
    },
  };

  const captured = captureCoordinateStates([runtime]);

  assert.deepEqual(calls, [
    ['ready', false],
    ['broken', false],
  ]);
  assert.deepEqual(plain(captured.d), {
    ready: {
      boardId: 'ready',
      records: [{ type: 'point', x: 1, y: 2 }],
    },
  });
});

test('captures Points, PointGraph reveals and both solution-lock stores', async () => {
  const { captureCoordinateStates } = await statePromise;
  const runtime = {
    __coord: {},
    __pointStates: {
      main: {
        A: { x: 1.23456789, y: '2.5', fixed: 1, showName: false },
        B: { x: -3, y: 4, fixed: false },
        invalid: { x: Number.NaN, y: 5, fixed: true },
      },
    },
    __pointGraphStates: {
      main: {
        targetA: {
          visible: 1,
          name: 'f',
          color: '#336699',
          graph: { remove() {} },
        },
        invalid: null,
      },
    },
    __pointOnGraphLocks: {
      one: true,
      ignored: false,
    },
    __pointsOnGraphLocks: {
      many: 1,
      ignored: 0,
    },
  };

  assert.deepEqual(plain(captureCoordinateStates([runtime])), {
    v: 1,
    p: {
      main: {
        A: { x: 1.234568, y: 2.5, fixed: true, showName: false },
        B: { x: -3, y: 4, fixed: false },
      },
    },
    g: {
      main: {
        targetA: { visible: true, name: 'f', color: '#336699' },
      },
    },
    q: {
      o: { one: 1 },
      m: { many: 1 },
    },
  });
});

test('captures DGS, Schar, Regression, Table, PlotInput and Slider state compactly', async () => {
  const { captureCoordinateStates } = await statePromise;
  const board = { containerObj: { isConnected: true } };
  const regressionPanel = {
    style: { transform: 'scale(0.8)' },
    querySelector: () => ({ style: { display: 'inline-flex' } }),
  };
  const runtime = {
    __coord: {},
    __boards: { main: board },
    __dgsConstructionStates: {
      main: {
        boardId: 'main',
        records: [{ type: 'segment', ids: ['A', 'B'] }],
      },
    },
    __liaScharStateStore: {
      'family::main': {
        values: { a: 1 },
        panelScale: 0.6,
      },
    },
    __scharEntries: {
      live: {
        uid: 'family',
        boardId: 'main',
        values: { a: 2.25, bad: Number.NaN },
        panelScale: 0.72,
        panelMinimized: true,
        termVisible: true,
      },
    },
    __liaRegressionSnapshots: {},
    __liaRegressionStates: {
      live: {
        boardId: 'main',
        board,
        drawColor: '#123456',
        strokes: [{
          color: '#654321',
          width: 4,
          points: [{ x: 0, y: 1 }, { x: 2, y: 3 }],
        }],
        regressionPoints: [{ key: 'P1', x: 1, y: 2 }],
        autoCreatedPointsData: [{ key: 'A1', x: 3, y: 4 }],
        analysisSeq: 7,
        analysisEntries: [{
          id: 'analysis-1',
          title: 'Linear',
          color: '#abcdef',
          model: { m: 2, n: 1, bad: Number.NaN },
          classProbabilities: { linear: 0.9 },
          linkedModels: { quadratic: { a: 1, c: 2, d: 3 } },
          panel: regressionPanel,
        }],
      },
    },
    __tableStates: {
      table1: {
        values: [{ x: 'old', y: 'old' }],
        cellWidths: { x0: 120, bad: -1 },
      },
    },
    __pointStates: {
      main: {
        P_1: { x: 0, y: 1, fixed: true },
      },
    },
    getTableData: () => ({
      values: [{ x: '0', y: '1' }, { x: '2', y: '4' }],
      boardId: 'main',
      pointPrefix: 'P',
    }),
    __plotInputStates: {
      plot1: { raw: 'sin(x)', boardId: 'main', graph: { board } },
      draft: { raw: 'x^2', boardId: 'main' },
    },
    __sliderEntries: {
      sliderKey: {
        uid: 'slider1',
        boardId: 'main',
        name: 'a',
        slider: {
          board,
          Value: () => 2.3456789,
          point1: livePoint(-4.11111119, -3),
          point2: livePoint(4, -3),
        },
      },
    },
  };

  const captured = plain(captureCoordinateStates([runtime]));

  assert.deepEqual(captured.d.main.records, [
    { type: 'segment', ids: ['A', 'B'] },
  ]);
  assert.deepEqual(captured.s['family::main'], {
    values: { a: 2.25 },
    panelScale: 0.72,
    panelMinimized: true,
    termVisible: true,
  });
  assert.deepEqual(captured.t, {
    table1: {
      v: [{ x: '0', y: '1' }, { x: '2', y: '4' }],
      w: { x0: 120 },
    },
  });
  assert.deepEqual(captured.x, {
    plot1: { r: 'sin(x)', p: 1 },
    draft: { r: 'x^2', p: 0 },
  });
  assert.deepEqual(captured.z, {
    sliderKey: {
      u: 'slider1',
      b: 'main',
      n: 'a',
      v: 2.345679,
      p: [{ x: -4.111111, y: -3 }, { x: 4, y: -3 }],
    },
  });
  const regression = captured.r['board:main'];
  assert.equal(regression.revision, 1);
  assert.equal(regression.boardId, 'main');
  assert.deepEqual(regression.drawingHistory, {
    strokes: [{
      color: '#654321',
      width: 4,
      points: [{ x: 0, y: 1 }, { x: 2, y: 3 }],
    }],
    undoActions: [],
    redoActions: [],
  });
  assert.deepEqual(regression.regressionPoints, [
    { key: 'P1', x: 1, y: 2 },
  ]);
  assert.deepEqual(regression.analyses, [{
    id: 'analysis-1',
    classKey: 'linear',
    title: 'Linear',
    color: '#abcdef',
    model: { m: 2, n: 1 },
    overlayScale: 0.8,
    minimized: true,
    order: 1,
    classProbabilities: { linear: 0.9 },
    linkedModels: { quadratic: { a: 1, c: 2, d: 3 } },
  }]);
  assertJsonOnly(captured);
});

test('restores only fixed table-created points idempotently through the Proposal hook', async () => {
  const { captureCoordinateStates, restoreCoordinateStates } = await statePromise;
  const board = {
    containerObj: { isConnected: true },
    update() {},
  };
  const pointSpecs = [];
  const createdPoints = [];
  const runtime = {
    __boards: { main: board },
    __points: { main: {} },
    __tableStates: {
      table1: { boardId: 'main', pointPrefix: 'P' },
    },
    setTableValues(uid, values) {
      this.__tableStates[uid].values = values.map(value => ({ ...value }));
      return true;
    },
    restorePointFromSpec(spec) {
      pointSpecs.push(spec);
      const name = spec.split(';')[1];
      const state = this.__pointStates.main[name];
      if (!this.__points.main[name]) {
        const point = { board, x: state.x, y: state.y };
        this.__points.main[name] = point;
        createdPoints.push(point);
      }
      return this.__points.main[name];
    },
  };
  const frozen = {
    v: 1,
    p: {
      main: {
        P_1: { x: 1.25, y: -2.5, fixed: true },
        P_2: { x: 7, y: 6, fixed: false },
      },
    },
    t: {
      table1: {
        v: [{ x: '9', y: '8' }, { x: '3', y: '4' }],
      },
    },
  };

  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.deepEqual(pointSpecs, ['main;P_1', 'main;P_1']);
  assert.equal(createdPoints.length, 1);
  assert.deepEqual(
    { x: createdPoints[0].x, y: createdPoints[0].y },
    { x: 1.25, y: -2.5 }
  );
  assert.equal(runtime.__points.main.P_2, undefined);
  assert.deepEqual(plain(captureCoordinateStates([runtime]).t.table1), {
    v: [{ x: '9', y: '8' }, { x: '3', y: '4' }],
  });
});

test('retries late table points without rebuilding an already restored table root', async () => {
  const { restoreCoordinateStates } = await statePromise;
  const root = { isConnected: true, dataset: { spec: 'table-spec' } };
  const board = { containerObj: { isConnected: false }, update() {} };
  let tableWrites = 0;
  let pointAttempts = 0;
  let pointReady = false;
  const runtime = {
    document: { getElementById: () => root },
    __boards: { main: board },
    __tableStates: { table1: { boardId: 'main', pointPrefix: 'P' } },
    setTableValues(uid, values) {
      tableWrites += 1;
      this.__tableStates[uid].values = values.map(value => ({ ...value }));
      return true;
    },
    restorePointFromSpec() {
      pointAttempts += 1;
      return pointReady ? {} : null;
    },
  };
  const frozen = {
    v: 1,
    p: { main: { P_1: { x: 1, y: 2, fixed: true } } },
    t: { table1: { v: [{ x: '1', y: '2' }] } },
  };

  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  board.containerObj.isConnected = true;
  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  pointReady = true;
  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.equal(tableWrites, 1);
  assert.equal(pointAttempts, 2);
});

test('late-mount refresh runs Regression before DGS without resetting other widgets', async () => {
  const { refreshCoordinateLateMounts } = await statePromise;
  const order = [];
  let dgsCalls = 0;
  let externalCalls = 0;
  let sliderCalls = 0;
  let scharCalls = 0;
  const restoreFlags = [];
  const runtime = {
    __bootstrapRegression() {
      restoreFlags.push(this.__liaFreezeCoordinateRestoreActive);
      order.push('regression');
    },
    __bootstrapDGS() {
      restoreFlags.push(this.__liaFreezeCoordinateRestoreActive);
      dgsCalls += 1;
      order.push('dgs');
    },
    __bootstrapSliders() {
      sliderCalls += 1;
    },
    __coord: {
      runExternalBootstraps() {
        externalCalls += 1;
      },
    },
    __bootstrapScharen() {
      scharCalls += 1;
    },
  };

  assert.equal(refreshCoordinateLateMounts([
    runtime,
    {},
    { __bootstrapDGS() { throw new Error('stale'); } },
  ]), 2);
  assert.deepEqual(order, ['regression', 'dgs']);
  assert.equal(dgsCalls, 1);
  assert.equal(externalCalls, 0);
  assert.equal(sliderCalls, 0);
  assert.equal(scharCalls, 0);
  assert.deepEqual(restoreFlags, [true, true]);
  assert.equal(runtime.__liaFreezeCoordinateRestoreActive, undefined);
});

test('initial restore uses individual Proposal bootstraps when the aggregate hook is absent', async () => {
  const { restoreCoordinateStates } = await statePromise;
  const order = [];
  const restoreFlags = [];
  const runtime = {
    __bootstrapPlotInputs() { order.push('plot'); },
    __bootstrapScharen() { order.push('schar'); },
    __bootstrapRegression() {
      restoreFlags.push(this.__liaFreezeCoordinateRestoreActive);
      order.push('regression');
    },
    __bootstrapDGS() {
      restoreFlags.push(this.__liaFreezeCoordinateRestoreActive);
      order.push('dgs');
    },
    __bootstrapTables() { order.push('table'); },
  };

  assert.equal(restoreCoordinateStates([runtime], {
    v: 1,
    t: { table1: { v: [] } },
  }), true);
  assert.deepEqual(order, ['plot', 'schar', 'regression', 'dgs', 'table']);
  assert.deepEqual(restoreFlags, [true, true]);
  assert.equal(runtime.__liaFreezeCoordinateRestoreActive, undefined);
});

test('a late anchor on the same board does not rerun the board-replacement bootstrap list', async () => {
  const { restoreCoordinateStates } = await statePromise;
  const board = { containerObj: { isConnected: true }, update() {} };
  let externalCalls = 0;
  let viewportCalls = 0;
  const externalRestoreFlags = [];
  const runtime = {
    __boards: { main: board },
    __coord: {
      runExternalBootstraps() {
        externalCalls += 1;
        externalRestoreFlags.push(runtime.__liaFreezeCoordinateRestoreActive);
      },
      restoreSavedBoardState() {
        viewportCalls += 1;
        return false;
      },
    },
    document: {
      querySelectorAll() { return []; },
    },
  };
  const frozen = { v: 1, b: { main: { bbox: [-5, 5, 5, -5] } } };

  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  runtime.document.querySelectorAll = () => [{}];
  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.equal(externalCalls, 1);
  assert.deepEqual(externalRestoreFlags, [true]);
  assert.equal(runtime.__liaFreezeCoordinateRestoreActive, undefined);
  assert.equal(viewportCalls, 1);
});

test('preseeds every store and hydrates Board, DGS, Table, Slider, Plot and Schar after a late mount', async () => {
  const { restoreCoordinateStates } = await statePromise;
  const frozen = {
    v: 1,
    b: {
      main: { bbox: [-5, 5, 5, -5], width: 640, height: 480 },
    },
    p: {
      main: { A: { x: 1, y: 2, fixed: false, showName: true } },
    },
    g: {
      main: {
        target: { visible: true, name: 'f', color: '#0055aa' },
      },
    },
    d: {
      main: {
        boardId: 'main',
        records: [{ type: 'point', x: 1, y: 2 }],
      },
    },
    s: {
      'family::main': {
        values: { a: 2 },
        panelScale: 0.75,
        panelMinimized: false,
        termVisible: true,
      },
    },
    q: {
      o: { pointQuiz: 1 },
      m: { pointsQuiz: 1 },
    },
    t: {
      table1: {
        v: [{ x: '1', y: '2' }, { x: '3', y: '4' }],
        w: { x0: 101, y0: 99 },
      },
    },
    x: {
      plot1: { r: 'sin(x)', p: 1 },
    },
    z: {
      sliderKey: {
        u: 'slider1',
        b: 'main',
        n: 'a',
        v: 3.5,
        p: [{ x: -4, y: -3 }, { x: 4, y: -3 }],
      },
    },
  };
  const runtime = {};

  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.deepEqual(plain(runtime.__coordBoardStates), frozen.b);
  assert.deepEqual(plain(runtime.__pointStates), frozen.p);
  assert.deepEqual(plain(runtime.__pointGraphStates), frozen.g);
  assert.deepEqual(plain(runtime.__dgsConstructionStates), frozen.d);
  assert.deepEqual(plain(runtime.__liaScharStateStore), frozen.s);
  assert.deepEqual(plain(runtime.__pointOnGraphLocks), frozen.q.o);
  assert.deepEqual(plain(runtime.__pointsOnGraphLocks), frozen.q.m);
  assert.deepEqual(plain(runtime.__tableStates), {
    table1: {
      cols: 2,
      values: frozen.t.table1.v,
      cellWidths: frozen.t.table1.w,
    },
  });
  assert.deepEqual(plain(runtime.__plotInputStates), {
    plot1: { raw: 'sin(x)' },
  });

  const events = [];
  const firstMoves = [];
  const secondMoves = [];
  const input = { value: '' };
  const panel = { style: {} };
  const board = {
    containerObj: { isConnected: true },
    update() {
      events.push(['board-update']);
    },
  };
  const anchor = {};
  runtime.__boards = { main: board };
  runtime.__coord = {
    runExternalBootstraps() {
      events.push(['external-bootstrap']);
    },
    restoreSavedBoardState(boardArg, bbox, boardId) {
      events.push(['board', boardArg, bbox.slice(), boardId]);
    },
  };
  runtime.document = {
    querySelectorAll: () => [anchor],
    getElementById: id => id === 'lia-table-table1'
      ? { dataset: { spec: 'table-spec' } }
      : null,
  };
  runtime.__dgsConstructionBoards = {};
  runtime.__applyDgsHistory = (boardId, snapshot) => {
    events.push(['dgs', boardId, plain(snapshot)]);
    runtime.__dgsConstructionBoards[boardId] = board;
  };
  runtime.__bootstrapTables = () => events.push(['table-bootstrap']);
  runtime.setTableValues = (uid, values) => {
    events.push(['table-values', uid, plain(values)]);
    runtime.__tableStates[uid].values = values.map(value => ({ ...value }));
    return true;
  };
  runtime.renderTableFromSpec = (uid, spec, force) => {
    events.push(['table-render', uid, spec, force]);
    return true;
  };
  runtime.__sliderEntries = {
    sliderKey: {
      uid: 'slider1',
      boardId: 'main',
      name: 'a',
      slider: {
        board,
        __liaDgsSliderMinimum: -5,
        __liaDgsSliderMaximum: 5,
        point1: livePoint(0, 0, firstMoves),
        point2: livePoint(0, 0, secondMoves),
        setValue(value) {
          events.push(['slider-value', value]);
        },
      },
    },
  };
  runtime.__bootstrapPlotFunctions = () => events.push(['plot-functions']);
  runtime.__scheduleFunctionAnalysisPointsForBoard = boardId => {
    events.push(['function-analysis', boardId]);
  };
  runtime.__scheduleObjectAnalysisPointsForBoard = boardId => {
    events.push(['object-analysis', boardId]);
  };
  runtime.__plotInputStates.plot1.boardId = 'main';
  runtime.__plotInputInstances = { plot1: { input } };
  runtime.__plotInput = {
    plotIntoBoard(boardArg, live, raw) {
      events.push(['plot', boardArg, raw]);
      live.graph = { board: boardArg };
    },
  };
  runtime.__scharEntries = {
    mounted: {
      uid: 'family',
      boardId: 'main',
      panel,
    },
  };

  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.ok(events.some(event =>
    event[0] === 'board'
      && event[1] === board
      && event[3] === 'main'
  ));
  assert.ok(events.some(event => event[0] === 'dgs' && event[1] === 'main'));
  assert.ok(events.some(event =>
    event[0] === 'table-values' && event[1] === 'table1'
  ));
  assert.ok(events.some(event =>
    event[0] === 'table-render'
      && event[1] === 'table1'
      && event[2] === 'table-spec'
      && event[3] === true
  ));
  assert.ok(events.some(event => event[0] === 'slider-value' && event[1] === 3.5));
  assert.ok(events.some(event => event[0] === 'plot' && event[2] === 'sin(x)'));
  assert.deepEqual(firstMoves, [[[-4, -3], 0]]);
  assert.deepEqual(secondMoves, [[[4, -3], 0]]);
  assert.equal(runtime.__sliderEntries.sliderKey.slider.__liaDgsSliderValue, 3.5);
  assert.equal(input.value, 'sin(x)');
  assert.equal(panel.style.transformOrigin, 'top left');
  assert.equal(panel.style.transform, 'scale(0.75)');
  assert.deepEqual(plain(runtime.__liaScharStateStore['family::main'].values), { a: 2 });
  assert.ok(events.some(event => event[0] === 'external-bootstrap'));
  assert.ok(events.some(event => event[0] === 'table-bootstrap'));
});

test('slider restore verifies stable identity and clamps to the authored range', async () => {
  const { restoreCoordinateStates } = await statePromise;
  const board = { containerObj: { isConnected: true }, update() {} };
  const wrongValues = [];
  const correctValues = [];
  const runtime = {
    __boards: { main: board },
    __sliderEntries: {
      stableKey: {
        uid: 'wrong', boardId: 'main', name: 'wrong', minimum: -10, maximum: 10,
        slider: { board, setValue(value) { wrongValues.push(value); } },
      },
      actualKey: {
        uid: 'slider1', boardId: 'main', name: 'a', minimum: -2, maximum: 2,
        slider: { board, setValue(value) { correctValues.push(value); } },
      },
    },
  };

  const frozen = {
    v: 1,
    z: { stableKey: { u: 'slider1', b: 'main', n: 'a', v: 99 } },
  };
  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.deepEqual(wrongValues, []);
  assert.deepEqual(correctValues, [2]);
  assert.equal(runtime.__sliderEntries.actualKey.slider.__liaDgsSliderValue, 2);
  runtime.__sliderEntries.actualKey.slider.__liaDgsSliderValue = -1;
  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.deepEqual(correctValues, [2, 2]);
});

test('late-hydrates a regression snapshot once and preserves it during template recreation', async () => {
  const { restoreCoordinateStates } = await statePromise;
  const frozen = {
    v: 1,
    r: {
      'board:reg': {
        revision: 3,
        boardId: 'reg',
        drawColor: '#ff0000',
        drawingHistory: {
          strokes: [{ color: '#ff0000', width: 3, points: [{ x: 0, y: 0 }] }],
          undoActions: ['must be discarded'],
          redoActions: ['must be discarded'],
        },
        regressionPoints: [{ key: 'P', x: 1, y: 2 }],
        autoCreatedPointsData: [],
        analysisSeq: 1,
        analyses: [{
          id: 'qanalysis-1',
          classKey: 'quadratic',
          title: 'Quadratic',
          color: '#ff0000',
          model: { a: 1, c: 2, d: 3 },
          overlayScale: 0.8,
          minimized: true,
          order: 1,
        }],
      },
    },
  };
  let externalCalls = 0;
  let regressionBootstraps = 0;
  let dgsBootstraps = 0;
  let removals = 0;
  const restoreFlags = [];
  const runtime = {
    __coord: {
      runExternalBootstraps() {
        externalCalls += 1;
      },
    },
  };

  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.equal(runtime.__liaRegressionSnapshots['board:reg'].revision, 3);
  assert.deepEqual(
    plain(runtime.__liaRegressionSnapshots['board:reg'].drawingHistory),
    {
      strokes: [{ color: '#ff0000', width: 3, points: [{ x: 0, y: 0 }] }],
      undoActions: [],
      redoActions: [],
    }
  );

  const board = {
    containerObj: { isConnected: true },
    update() {},
  };
  runtime.__boards = { reg: board };
  runtime.__liaRegressionStates = {
    stale: {
      boardId: 'reg',
      board,
      // Proposal can mark the revision before its close.click() is blocked.
      restoredSnapshotRevision: 3,
      drawLayer: {
        remove() {
          removals += 1;
        },
      },
    },
  };
  runtime.__bootstrapRegression = () => {
    regressionBootstraps += 1;
    restoreFlags.push(runtime.__liaFreezeCoordinateRestoreActive);
    runtime.__liaRegressionStates = {
      restored: {
        boardId: 'reg',
        board,
        restoredSnapshotRevision: 3,
        quadraticAnalysisEntries: [{
          id: 'qanalysis-1',
          classKey: 'quadratic',
          panel: {
            querySelector(selector) {
              return selector === '.lia-plot-analysis-mini-wrap'
                ? { style: { display: 'inline-flex' } }
                : null;
            },
          },
        }],
      },
    };
  };
  runtime.__bootstrapDGS = () => {
    dgsBootstraps += 1;
    restoreFlags.push(runtime.__liaFreezeCoordinateRestoreActive);
  };

  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.equal(regressionBootstraps, 1);
  assert.equal(dgsBootstraps, 1);
  assert.equal(removals, 1);
  assert.deepEqual(restoreFlags, [true, true]);
  assert.equal(runtime.__liaFreezeCoordinateRestoreActive, undefined);
  assert.equal(runtime.__liaRegressionSnapshots['board:reg'].revision, 3);
  assert.equal(runtime.__liaRegressionSnapshots['board:reg'].boardId, 'reg');

  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.equal(regressionBootstraps, 1);
  assert.equal(dgsBootstraps, 1);
  assert.equal(removals, 1);
  assert.equal(externalCalls, 2);
});

test('accepts the legacy raw coord board store as viewport-only state', async () => {
  const {
    hasCoordinateState,
    restoreCoordinateStates,
  } = await statePromise;
  const legacy = {
    oldBoard: {
      bbox: [-8, 6, 8, -6],
      width: 720,
      height: 480,
      runtimeCallback() {},
    },
  };
  const boundingBoxes = [];
  const board = {
    containerObj: { isConnected: true },
    setBoundingBox(bbox, keepAspect) {
      boundingBoxes.push([bbox.slice(), keepAspect]);
    },
    update() {},
  };
  const runtime = { __boards: { oldBoard: board } };

  assert.equal(hasCoordinateState(legacy), true);
  assert.equal(restoreCoordinateStates([runtime], legacy), true);
  assert.deepEqual(plain(runtime.__coordBoardStates), {
    oldBoard: {
      bbox: [-8, 6, 8, -6],
      width: 720,
      height: 480,
    },
  });
  assert.deepEqual(boundingBoxes, [[[-8, 6, 8, -6], true]]);
});

test('rejects NaN, prototype keys, unknown DGS records and unsafe plotted expressions', async () => {
  const {
    captureCoordinateStates,
    restoreCoordinateStates,
  } = await statePromise;
  const pointBoards = Object.create(null);
  pointBoards.main = {
    good: { x: 1, y: 2, fixed: true },
    nan: { x: Number.NaN, y: 2, fixed: false },
    huge: { x: 1e13, y: 2, fixed: false },
  };
  Object.defineProperty(pointBoards, '__proto__', {
    value: { polluted: true },
    enumerable: true,
  });
  Object.defineProperty(pointBoards, 'constructor', {
    value: { prototype: { polluted: true } },
    enumerable: true,
  });
  const poisonedRecord = {
    type: 'point',
    coordinateExpressions: {
      x: 'x',
      y: 'constructor.constructor(1)',
    },
  };
  Object.defineProperty(poisonedRecord, '__proto__', {
    value: { polluted: true },
    enumerable: true,
  });
  const frozen = {
    v: 1,
    b: {
      main: { bbox: [Number.NaN, 5, 5, -5] },
    },
    p: pointBoards,
    d: {
      main: {
        records: [
          { type: 'unknown-widget', payload: 'discard' },
          { type: 'function', expression: 'window.alert(1)' },
          { type: 'function', expression: 'sin(x)' },
          { type: 'point', x: Number.NaN, y: 2 },
          poisonedRecord,
        ],
      },
    },
    r: {
      'board:main': {
        revision: Number.NaN,
        boardId: 'main',
        drawingHistory: {
          strokes: [{
            color: '#f00',
            width: 3,
            points: [{ x: Number.NaN, y: 1 }, { x: 2, y: 3 }],
          }],
        },
        regressionPoints: [{ key: 'bad', x: Number.NaN, y: 1 }],
        autoCreatedPointsData: [],
        analyses: [
          { classKey: 'linear', model: { slope: Number.NaN } },
          { classKey: 'arbitrary-code', model: { a: 1 } },
          {
            id: 'qanalysis-1',
            classKey: 'quadratic',
            title: 'Quadratic',
            color: '#00ff00',
            model: { a: 1, c: 2, d: 3 },
            overlayScale: 0.7,
            minimized: true,
            order: 1,
          },
        ],
      },
    },
    x: {
      evil: { r: 'window.alert(1)', p: 1 },
    },
    z: {
      invalidSlider: {
        u: 'slider',
        b: 'main',
        n: 'a',
        v: Number.NaN,
      },
    },
  };
  const board = {
    containerObj: { isConnected: true },
    update() {},
  };
  const input = { value: '' };
  let plotCalls = 0;
  let sliderCalls = 0;
  const appliedDgs = [];
  const runtime = {
    __boards: { main: board },
    __dgsConstructionBoards: {},
    __applyDgsHistory(boardId, snapshot) {
      appliedDgs.push([boardId, plain(snapshot)]);
      this.__dgsConstructionBoards[boardId] = board;
    },
    __plotInputStates: {
      evil: { boardId: 'main' },
    },
    __plotInputInstances: {
      evil: { input },
    },
    __plotInput: {
      plotIntoBoard() {
        plotCalls += 1;
      },
    },
    __sliderEntries: {
      invalidSlider: {
        uid: 'slider',
        boardId: 'main',
        name: 'a',
        slider: {
          board,
          setValue() {
            sliderCalls += 1;
          },
        },
      },
    },
  };

  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.deepEqual(plain(runtime.__pointStates), {
    main: {
      good: { x: 1, y: 2, fixed: true },
    },
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(runtime.__pointStates, '__proto__'),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(runtime.__pointStates, 'constructor'),
    false
  );
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(runtime.__coordBoardStates, undefined);
  assert.equal(runtime.__sliderEntries.invalidSlider.slider.__liaDgsSliderValue, undefined);
  assert.equal(sliderCalls, 0);
  assert.equal(plotCalls, 0);
  assert.equal(input.value, 'window.alert(1)');
  assert.equal(appliedDgs.length, 1);
  assert.deepEqual(appliedDgs[0][1].records, [
    { type: 'function', expression: 'sin(x)' },
  ]);
  assert.deepEqual(
    plain(runtime.__liaRegressionSnapshots['board:main'].drawingHistory.strokes),
    [{
      color: '#f00',
      width: 3,
      points: [{ x: 2, y: 3 }],
    }]
  );
  assert.deepEqual(
    plain(runtime.__liaRegressionSnapshots['board:main'].regressionPoints),
    []
  );
  assert.deepEqual(
    plain(runtime.__liaRegressionSnapshots['board:main'].analyses),
    [{
      id: 'qanalysis-1',
      classKey: 'quadratic',
      title: 'Quadratic',
      color: '#00ff00',
      model: { a: 1, c: 2, d: 3 },
      overlayScale: 0.7,
      minimized: true,
      order: 1,
    }]
  );

  const recaptured = captureCoordinateStates([runtime]);
  assertJsonOnly(recaptured);
  assert.equal(JSON.stringify(recaptured).includes('unknown-widget'), false);
  assert.equal(JSON.stringify(recaptured).includes('window.alert'), true);
  assert.equal(Object.prototype.polluted, undefined);
});

test('repeated restore does not duplicate DGS objects, plotted graphs or table values', async () => {
  const { restoreCoordinateStates } = await statePromise;
  const frozen = {
    v: 1,
    b: {
      main: { bbox: [-5, 5, 5, -5] },
    },
    d: {
      main: {
        boardId: 'main',
        records: [{ type: 'point', x: 1, y: 2 }],
      },
    },
    t: {
      table1: {
        v: [{ x: '1', y: '2' }, { x: '3', y: '4' }],
      },
    },
    x: {
      plot1: { r: 'x^2', p: 1 },
    },
  };
  let externalBootstraps = 0;
  let tableBootstraps = 0;
  let dgsApplications = 0;
  let plotCreations = 0;
  let tableWrites = 0;
  let viewportWrites = 0;
  let boardUpdates = 0;
  const createdDgsObjects = [];
  const createdGraphs = [];
  const board = {
    containerObj: { isConnected: true },
    setBoundingBox() {
      viewportWrites += 1;
    },
    update() {
      boardUpdates += 1;
    },
  };
  const tableRoot = { isConnected: true, dataset: { spec: 'table-spec' } };
  const runtime = {
    __coord: {
      runExternalBootstraps() {
        externalBootstraps += 1;
      },
    },
    __boards: { main: board },
    __dgsConstructionBoards: {},
    __applyDgsHistory(boardId, snapshot) {
      dgsApplications += 1;
      createdDgsObjects.push(...snapshot.records.map(record => ({ ...record })));
      this.__dgsConstructionBoards[boardId] = board;
    },
    __bootstrapTables() {
      tableBootstraps += 1;
    },
    __tableStates: {
      table1: {},
    },
    document: {
      getElementById(id) {
        return id === 'lia-table-table1'
          ? tableRoot
          : null;
      },
    },
    setTableValues(uid, values) {
      tableWrites += 1;
      this.__tableStates[uid].values = values.map(value => ({ ...value }));
      return true;
    },
    __plotInputStates: {
      plot1: { boardId: 'main' },
    },
    __plotInput: {
      plotIntoBoard(boardArg, live, raw) {
        plotCreations += 1;
        const graph = { board: boardArg, raw };
        createdGraphs.push(graph);
        live.graph = graph;
      },
    },
  };

  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.equal(restoreCoordinateStates([runtime], frozen), true);

  assert.equal(externalBootstraps, 1);
  assert.equal(tableBootstraps, 1);
  assert.equal(dgsApplications, 1);
  assert.equal(plotCreations, 1);
  assert.equal(createdDgsObjects.length, 1);
  assert.equal(createdGraphs.length, 1);
  assert.equal(tableWrites, 1);
  assert.equal(viewportWrites, 1);
  assert.equal(boardUpdates, 2);
  assert.deepEqual(plain(runtime.__tableStates.table1.values), frozen.t.table1.v);
  assert.equal(runtime.__plotInputStates.plot1.graph, createdGraphs[0]);
  assert.equal(runtime.__dgsConstructionBoards.main, board);
});

test('captures runtimes that expose only graph, lock, Schar or live Regression state', async () => {
  const { captureCoordinateStates } = await statePromise;
  const graphRuntime = {
    __pointGraphStates: {
      graphBoard: {
        target: { visible: true, name: 'g', color: '#0088cc' },
      },
    },
  };
  const lockRuntime = {
    __pointOnGraphLocks: { singleOnly: true },
    __pointsOnGraphLocks: { multiOnly: 1 },
  };
  const storedScharRuntime = {
    __liaScharStateStore: {
      'stored::scharBoard': {
        values: { a: 1.25 },
        panelScale: 0.65,
        panelMinimized: false,
        termVisible: true,
      },
    },
  };
  const liveScharRuntime = {
    __scharEntries: {
      only: {
        uid: 'live',
        boardId: 'scharBoard',
        values: { b: 2.5 },
        panelScale: 0.8,
        panelMinimized: true,
        termVisible: false,
      },
    },
  };
  const regressionBoard = { containerObj: { isConnected: true } };
  const liveRegressionRuntime = {
    __boards: { regressionBoard },
    __liaRegressionStates: {
      only: {
        boardId: 'regressionBoard',
        board: regressionBoard,
        drawColor: '#ff0000',
        strokes: [],
        regressionPoints: [],
        autoCreatedPointsData: [],
        analysisSeq: 0,
      },
    },
  };

  const captured = plain(captureCoordinateStates([
    graphRuntime,
    lockRuntime,
    storedScharRuntime,
    liveScharRuntime,
    liveRegressionRuntime,
  ]));

  assert.deepEqual(captured.g, {
    graphBoard: {
      target: { visible: true, name: 'g', color: '#0088cc' },
    },
  });
  assert.deepEqual(captured.q, {
    o: { singleOnly: 1 },
    m: { multiOnly: 1 },
  });
  assert.deepEqual(captured.s, {
    'stored::scharBoard': {
      values: { a: 1.25 },
      panelScale: 0.65,
      panelMinimized: false,
      termVisible: true,
    },
    'live::scharBoard': {
      values: { b: 2.5 },
      panelScale: 0.8,
      panelMinimized: true,
      termVisible: false,
    },
  });
  assert.equal(captured.r['board:regressionBoard'].boardId, 'regressionBoard');
  assert.equal(captured.r['board:regressionBoard'].revision, 1);
});

test('replots a changed expression on the same board but skips an identical signature', async () => {
  const { restoreCoordinateStates } = await statePromise;
  const board = {
    containerObj: { isConnected: true },
    update() {},
  };
  const plotted = [];
  const runtime = {
    __boards: { main: board },
    __plotInputStates: {
      plot1: { boardId: 'main' },
    },
    __plotInput: {
      plotIntoBoard(boardArg, live, raw) {
        plotted.push(raw);
        live.graph = { board: boardArg, raw };
      },
    },
  };
  const frozen = raw => ({
    v: 1,
    x: {
      plot1: { r: raw, p: 1 },
    },
  });

  assert.equal(restoreCoordinateStates([runtime], frozen('sin(x)')), true);
  assert.equal(restoreCoordinateStates([runtime], frozen('sin(x)')), true);
  assert.deepEqual(plotted, ['sin(x)']);

  assert.equal(restoreCoordinateStates([runtime], frozen('cos(x)')), true);
  assert.equal(restoreCoordinateStates([runtime], frozen('cos(x)')), true);
  assert.deepEqual(plotted, ['sin(x)', 'cos(x)']);
  assert.equal(runtime.__plotInputStates.plot1.graph.raw, 'cos(x)');
});

test('rehydrates a higher Regression revision on the same board but skips an identical revision', async () => {
  const { restoreCoordinateStates } = await statePromise;
  const board = {
    containerObj: { isConnected: true },
    update() {},
  };
  let regressionBootstraps = 0;
  let dgsBootstraps = 0;
  let removals = 0;
  const runtime = {
    __coord: {
      runExternalBootstraps() {},
    },
    __boards: { reg: board },
    __liaRegressionStates: {
      initial: {
        boardId: 'reg',
        board,
        restoredSnapshotRevision: 0,
        drawLayer: {
          remove() {
            removals += 1;
          },
        },
      },
    },
  };
  runtime.__bootstrapRegression = () => {
    regressionBootstraps += 1;
    const revision = runtime.__liaRegressionSnapshots['board:reg'].revision;
    runtime.__liaRegressionStates = {
      restored: {
        boardId: 'reg',
        board,
        restoredSnapshotRevision: revision,
        drawLayer: {
          remove() {
            removals += 1;
          },
        },
      },
    };
  };
  runtime.__bootstrapDGS = () => {
    dgsBootstraps += 1;
  };
  const frozen = revision => ({
    v: 1,
    r: {
      'board:reg': {
        revision,
        boardId: 'reg',
        drawColor: '#ff0000',
        drawingHistory: { strokes: [] },
        regressionPoints: [],
        autoCreatedPointsData: [],
        analysisSeq: 0,
        analyses: [],
      },
    },
  });

  assert.equal(restoreCoordinateStates([runtime], frozen(1)), true);
  assert.equal(restoreCoordinateStates([runtime], frozen(1)), true);
  assert.equal(regressionBootstraps, 1);
  assert.equal(dgsBootstraps, 1);
  assert.equal(removals, 1);

  assert.equal(restoreCoordinateStates([runtime], frozen(2)), true);
  assert.equal(restoreCoordinateStates([runtime], frozen(2)), true);
  assert.equal(regressionBootstraps, 2);
  assert.equal(dgsBootstraps, 2);
  assert.equal(removals, 2);
  assert.equal(
    runtime.__liaRegressionStates.restored.restoredSnapshotRevision,
    2
  );
});

test('plots only strict known math identifiers while retaining rejected raw text', async () => {
  const { restoreCoordinateStates } = await statePromise;
  const board = {
    containerObj: { isConnected: true },
    update() {},
  };
  const cubeRoot = String.fromCharCode(92) + 'sqrt[3]{x}';
  const expressions = {
    alertCall: 'alert(1)',
    bareMath: 'Math',
    unknownName: 'mystery(x)',
    cubeRoot,
    mathSin: 'Math.sin(x)',
  };
  const plotted = [];
  const inputs = Object.fromEntries(
    Object.keys(expressions).map(uid => [uid, { value: '' }])
  );
  const runtime = {
    __boards: { main: board },
    __plotInputStates: Object.fromEntries(
      Object.keys(expressions).map(uid => [uid, { boardId: 'main' }])
    ),
    __plotInputInstances: Object.fromEntries(
      Object.entries(inputs).map(([uid, input]) => [uid, { input }])
    ),
    __plotInput: {
      plotIntoBoard(boardArg, live, raw) {
        plotted.push(raw);
        live.graph = { board: boardArg, raw };
      },
    },
  };
  const frozen = {
    v: 1,
    x: Object.fromEntries(
      Object.entries(expressions).map(([uid, raw]) => [uid, { r: raw, p: 1 }])
    ),
  };

  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  assert.deepEqual(plotted, [cubeRoot, 'Math.sin(x)']);
  assert.equal(inputs.alertCall.value, 'alert(1)');
  assert.equal(inputs.bareMath.value, 'Math');
  assert.equal(inputs.unknownName.value, 'mystery(x)');
  assert.equal(runtime.__plotInputStates.alertCall.graph, undefined);
  assert.equal(runtime.__plotInputStates.bareMath.graph, undefined);
  assert.equal(runtime.__plotInputStates.unknownName.graph, undefined);
  assert.equal(runtime.__plotInputStates.cubeRoot.graph.raw, cubeRoot);
  assert.equal(runtime.__plotInputStates.mathSin.graph.raw, 'Math.sin(x)');
});

test('merge keeps an unmounted slide slider while the current same slider wins by stable key', async () => {
  const { mergeCoordinateStates } = await statePromise;
  const previous = {
    v: 1,
    z: {
      oldSlide: {
        u: 'slider-old',
        b: 'board-old',
        n: 'a',
        v: 1.25,
        p: [{ x: -4, y: -3 }, { x: 4, y: -3 }],
      },
      shared: {
        u: 'slider-shared',
        b: 'board-current',
        n: 'b',
        v: 2,
      },
    },
  };
  const current = {
    v: 1,
    z: {
      shared: {
        u: 'slider-shared',
        b: 'board-current',
        n: 'b',
        v: 7.5,
      },
      currentOnly: {
        u: 'slider-current',
        b: 'board-current',
        n: 'c',
        v: -1,
      },
    },
  };

  assert.deepEqual(plain(mergeCoordinateStates(previous, current)), {
    v: 1,
    z: {
      oldSlide: {
        u: 'slider-old',
        b: 'board-old',
        n: 'a',
        v: 1.25,
        p: [{ x: -4, y: -3 }, { x: 4, y: -3 }],
      },
      shared: {
        u: 'slider-shared',
        b: 'board-current',
        n: 'b',
        v: 7.5,
      },
      currentOnly: {
        u: 'slider-current',
        b: 'board-current',
        n: 'c',
        v: -1,
      },
    },
  });
  assert.equal(previous.z.shared.v, 2);
});

test('merge unifies every stable map and both lock maps across slides', async () => {
  const { mergeCoordinateStates } = await statePromise;
  const regression = boardId => ({
    revision: 1,
    boardId,
    drawingHistory: { strokes: [] },
    regressionPoints: [],
    autoCreatedPointsData: [],
    analysisSeq: 0,
    analyses: [],
  });
  const first = {
    v: 1,
    b: { boardA: { bbox: [-5, 5, 5, -5] } },
    p: { boardA: { A: { x: 1, y: 2, fixed: false } } },
    g: {
      boardA: {
        graphA: { visible: true, name: 'f', color: '#f00' },
      },
    },
    d: {
      boardA: {
        records: [{ type: 'point', x: 1, y: 2 }],
      },
    },
    s: {
      'scharA::boardA': {
        values: { a: 1 },
        panelScale: 0.6,
      },
    },
    r: { 'board:boardA': regression('boardA') },
    q: {
      o: { pointA: 1 },
      m: { pointsA: 1 },
    },
    t: {
      tableA: { v: [{ x: '1', y: '2' }] },
    },
    x: {
      plotA: { r: 'sin(x)', p: 1 },
    },
  };
  const second = {
    v: 1,
    b: { boardB: { bbox: [-8, 6, 8, -6] } },
    p: { boardB: { B: { x: 3, y: 4, fixed: true } } },
    g: {
      boardB: {
        graphB: { visible: false, name: 'g', color: '#00f' },
      },
    },
    d: {
      boardB: {
        records: [{ type: 'segment', ids: ['B', 'C'] }],
      },
    },
    s: {
      'scharB::boardB': {
        values: { b: 2 },
        panelScale: 0.7,
      },
    },
    r: { 'board:boardB': regression('boardB') },
    q: {
      o: { pointB: 1 },
      m: { pointsB: 1 },
    },
    t: {
      tableB: { v: [{ x: '3', y: '4' }] },
    },
    x: {
      plotB: { r: 'cos(x)', p: 0 },
    },
  };

  const merged = plain(mergeCoordinateStates(first, undefined, second));
  const expectedKeys = {
    b: ['boardA', 'boardB'],
    p: ['boardA', 'boardB'],
    g: ['boardA', 'boardB'],
    d: ['boardA', 'boardB'],
    s: ['scharA::boardA', 'scharB::boardB'],
    r: ['board:boardA', 'board:boardB'],
    t: ['tableA', 'tableB'],
    x: ['plotA', 'plotB'],
  };
  for (const [map, keys] of Object.entries(expectedKeys)) {
    assert.deepEqual(Object.keys(merged[map]).sort(), keys);
  }
  assert.deepEqual(Object.keys(merged.q.o).sort(), ['pointA', 'pointB']);
  assert.deepEqual(Object.keys(merged.q.m).sort(), ['pointsA', 'pointsB']);
  assert.equal(merged.p.boardA.A.x, 1);
  assert.equal(merged.p.boardB.B.x, 3);
});

test('merge treats an explicitly empty PlotInput as a meaningful later overwrite', async () => {
  const { mergeCoordinateStates } = await statePromise;
  const previous = {
    v: 1,
    x: {
      sharedPlot: { r: 'sin(x)', p: 1 },
      oldSlidePlot: { r: 'x^2', p: 1 },
    },
  };
  const current = {
    v: 1,
    x: {
      sharedPlot: { r: '', p: 0 },
    },
  };

  assert.deepEqual(plain(mergeCoordinateStates(previous, current)), {
    v: 1,
    x: {
      sharedPlot: { r: '', p: 0 },
      oldSlidePlot: { r: 'x^2', p: 1 },
    },
  });
});

test('merge validates and deeply detaches inputs while discarding prototype keys', async () => {
  const { mergeCoordinateStates } = await statePromise;
  const boardState = {
    bbox: [-5, 5, 5, -5],
    metadata: {
      nested: { score: 1 },
      invalid: Number.NaN,
    },
    callback() {},
  };
  const boards = Object.create(null);
  boards.safeBoard = boardState;
  boards.invalidBoard = { bbox: [Number.NaN, 5, 5, -5] };
  const pointEntries = Object.create(null);
  pointEntries.A = { x: 1.23456789, y: 2, fixed: true };
  pointEntries.invalid = { x: Number.NaN, y: 2, fixed: false };
  const points = Object.create(null);
  points.safeBoard = pointEntries;
  const sliders = Object.create(null);
  sliders.safeSlider = {
    u: 'slider',
    b: 'safeBoard',
    n: 'a',
    v: 2.3456789,
  };
  sliders.invalidSlider = {
    u: 'bad',
    b: 'safeBoard',
    n: 'bad',
    v: Number.NaN,
  };
  for (const target of [boards, pointEntries, points, sliders]) {
    Object.defineProperty(target, '__proto__', {
      value: { polluted: true },
      enumerable: true,
    });
    Object.defineProperty(target, 'prototype', {
      value: { polluted: true },
      enumerable: true,
    });
    Object.defineProperty(target, 'constructor', {
      value: { prototype: { polluted: true } },
      enumerable: true,
    });
  }
  const input = {
    v: 1,
    b: boards,
    p: points,
    d: {
      safeBoard: {
        records: [
          { type: 'unknown-widget' },
          { type: 'point', x: Number.NaN, y: 2 },
        ],
      },
    },
    z: sliders,
  };
  Object.defineProperty(input, '__proto__', {
    value: { polluted: true },
    enumerable: true,
  });

  const merged = mergeCoordinateStates(null, 17, input);

  assert.deepEqual(Object.keys(merged.b), ['safeBoard']);
  assert.deepEqual(Object.keys(merged.p), ['safeBoard']);
  assert.deepEqual(Object.keys(merged.p.safeBoard), ['A']);
  assert.deepEqual(Object.keys(merged.z), ['safeSlider']);
  assert.deepEqual(plain(merged.d.safeBoard.records), []);
  assert.equal(merged.p.safeBoard.A.x, 1.234568);
  assert.equal(merged.z.safeSlider.v, 2.345679);
  assert.equal(merged.b.safeBoard.metadata.invalid, undefined);
  assert.equal(merged.b.safeBoard.callback, undefined);
  assert.notEqual(merged.b.safeBoard, boardState);
  assert.notEqual(merged.b.safeBoard.metadata, boardState.metadata);
  assert.notEqual(merged.b.safeBoard.metadata.nested, boardState.metadata.nested);

  boardState.metadata.nested.score = 99;
  pointEntries.A.x = 99;
  sliders.safeSlider.v = 99;
  assert.equal(merged.b.safeBoard.metadata.nested.score, 1);
  assert.equal(merged.p.safeBoard.A.x, 1.234568);
  assert.equal(merged.z.safeSlider.v, 2.345679);
  assertJsonOnly(merged);
  assert.equal(Object.prototype.polluted, undefined);
  for (const map of [merged.b, merged.p, merged.p.safeBoard, merged.z]) {
    assert.equal(Object.prototype.hasOwnProperty.call(map, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(map, 'prototype'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(map, 'constructor'), false);
  }
});

test('compacts dense Coordinate freehand strokes in screen space and restores Proposal state', async () => {
  const {
    captureCoordinateStates,
    compactCoordinateStateForFreeze,
    expandCoordinateStateForRestore,
    restoreCoordinateStates,
    COORDINATE_DRAWING_COMPACT_VERSION,
  } = await statePromise;
  const boardState = {
    bbox: [-12, 7, 18, -9],
    width: 960,
    height: 420,
    sizeMode: 'manual',
  };
  const board = { containerObj: { isConnected: true } };
  const densePoints = Array.from({ length: 2000 }, (_, index) => {
    const x = -10 + 26 * index / 1999;
    return { x, y: 0.8 + 2.4 * Math.sin(x * 0.55) };
  });
  const runtime = {
    __coordBoardStates: { drawing: boardState },
    __boards: { drawing: board },
    __pointStates: {
      drawing: {
        exactPoint: { x: 1.23456789, y: -2.34567891, fixed: true },
      },
    },
    __dgsConstructionStates: {
      drawing: {
        records: [{
          type: 'point',
          x: 1,
          y: 2,
          tracePoints: [
            { x: 0.123456789, y: 0.987654321 },
            { x: 0.223456789, y: 0.887654321 },
            { x: 0.323456789, y: 0.787654321 },
          ],
        }],
      },
    },
    __liaRegressionSnapshots: {},
    __liaRegressionStates: {
      live: {
        boardId: 'drawing',
        board,
        drawColor: '#123456',
        strokes: [
          { color: '#654321', width: 4.25, points: densePoints },
          { color: '#ff0000', width: 3, points: [{ x: 0.123456789, y: -1.987654321 }] },
          {
            color: '#654321',
            width: 3,
            points: Array.from({ length: 160 }, (_, index) => ({
              x: -4 + index / 20,
              y: -3 + index / 80,
            })),
          },
        ],
        regressionPoints: [{ key: 'R1', x: 1.23456789, y: 2.34567891 }],
        autoCreatedPointsData: [{ key: 'A1', x: -3.45678912, y: 4.56789123 }],
        analysisSeq: 0,
      },
    },
  };

  const captured = plain(captureCoordinateStates([runtime]));
  assert.equal(captured.v, 1);
  assert.equal(captured.r['board:drawing'].drawingHistory.strokes[0].points.length, 2000);

  const compacted = plain(compactCoordinateStateForFreeze(captured));
  assert.equal(compacted.v, 2);
  const envelope = compacted.r['board:drawing'].drawingHistory.q;
  assert.equal(envelope[0], COORDINATE_DRAWING_COMPACT_VERSION);
  assert.deepEqual(envelope[1], [-12, 7, 18, -9, 960, 420]);
  assert.deepEqual(envelope[2], ['#654321', '#ff0000']);
  assert.equal(envelope[3].length, 3);
  assert.equal(envelope[3][0].length, 3);
  assert.equal(envelope[3][1].length, 2);
  assert.match(envelope[3][0].at(-1), /^b:[A-Za-z0-9_-]+$/);
  assert.ok(JSON.stringify(compacted).length < JSON.stringify(captured).length * 0.35);
  assert.equal(JSON.stringify(compacted).includes('gz:'), false);

  const { encodeToken, decodeToken } = await codecPromise;
  const payload = { v: 'sf-mini-ti-4', sh: '#1', s: [{ h: '#1', coord: compacted }] };
  const encoded = await encodeToken(payload);
  assert.equal(encoded.mode, 'gzip');
  assert.deepEqual(await decodeToken(encoded.token), payload);

  const expanded = plain(expandCoordinateStateForRestore(compacted));
  assert.equal(expanded.v, 1);
  const strokes = expanded.r['board:drawing'].drawingHistory.strokes;
  assert.equal(strokes.length, 3);
  assert.deepEqual(strokes.map(stroke => [stroke.color, stroke.width]), [
    ['#654321', 4.25],
    ['#ff0000', 3],
    ['#654321', 3],
  ]);
  assert.ok(strokes[0].points.length < densePoints.length / 4);
  assert.equal(strokes[1].points.length, 1);
  assert.deepEqual(expanded.p, captured.p);
  assert.deepEqual(expanded.d, captured.d);
  assert.deepEqual(
    expanded.r['board:drawing'].regressionPoints,
    captured.r['board:drawing'].regressionPoints
  );
  assert.deepEqual(
    expanded.r['board:drawing'].autoCreatedPointsData,
    captured.r['board:drawing'].autoCreatedPointsData
  );

  const toPixel = point => ({
    x: (point.x - boardState.bbox[0]) * boardState.width
      / (boardState.bbox[2] - boardState.bbox[0]),
    y: (boardState.bbox[1] - point.y) * boardState.height
      / (boardState.bbox[1] - boardState.bbox[3]),
  });
  const segmentDistance = (point, start, end) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
  };
  const restoredPixels = strokes[0].points.map(toPixel);
  let maxDistance = 0;
  for (const rawPoint of densePoints) {
    const pixel = toPixel(rawPoint);
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 1; index < restoredPixels.length; index++) {
      nearest = Math.min(nearest,
        segmentDistance(pixel, restoredPixels[index - 1], restoredPixels[index]));
    }
    maxDistance = Math.max(maxDistance, nearest);
  }
  assert.ok(maxDistance <= 3, `maximum visual deviation was ${maxDistance}px`);
  assert.ok(Math.hypot(
    toPixel(densePoints[0]).x - restoredPixels[0].x,
    toPixel(densePoints[0]).y - restoredPixels[0].y,
  ) <= 1.7);
  assert.ok(Math.hypot(
    toPixel(densePoints.at(-1)).x - restoredPixels.at(-1).x,
    toPixel(densePoints.at(-1)).y - restoredPixels.at(-1).y,
  ) <= 1.7);

  const restoreRuntime = {};
  assert.equal(restoreCoordinateStates([restoreRuntime], compacted), true);
  assert.equal(restoreRuntime.__liaRegressionSnapshots['board:drawing'].drawingHistory.q, undefined);
  assert.equal(
    restoreRuntime.__liaRegressionSnapshots['board:drawing'].drawingHistory.strokes.length,
    3
  );
});

test('rejects malformed Coordinate drawing streams transactionally', async () => {
  const {
    compactCoordinateStateForFreeze,
    expandCoordinateStateForRestore,
    restoreCoordinateStates,
  } = await statePromise;
  const raw = {
    v: 1,
    b: { board: { bbox: [-5, 5, 5, -5], width: 800, height: 500 } },
    r: {
      'board:board': {
        revision: 1,
        boardId: 'board',
        drawingHistory: {
          strokes: [{
            color: '#ff0000',
            width: 3,
            points: Array.from({ length: 100 }, (_, index) => ({
              x: index / 20,
              y: Math.sin(index / 20),
            })),
          }],
        },
        regressionPoints: [],
        autoCreatedPointsData: [],
        analyses: [],
      },
    },
  };
  const compacted = plain(compactCoordinateStateForFreeze(raw));
  const expanded = expandCoordinateStateForRestore(compacted);
  assert.equal(Object.isFrozen(expanded), true);
  assert.equal(Object.isFrozen(expanded.r['board:board'].drawingHistory.strokes[0].points), true);

  const exportOnly = plain(raw);
  exportOnly.b.board.exportBBox = exportOnly.b.board.bbox;
  delete exportOnly.b.board.bbox;
  assert.equal(compactCoordinateStateForFreeze(exportOnly).v, 2);

  // Reusing the same caller-owned object after mutation must revalidate it;
  // no identity cache may return the previously accepted drawing.
  const malformed = compacted;
  const tuple = malformed.r['board:board'].drawingHistory.q[3][0];
  tuple[tuple.length - 1] = tuple.at(-1).slice(0, -1);

  assert.equal(expandCoordinateStateForRestore(malformed), undefined);
  const downgraded = plain(malformed);
  downgraded.v = 1;
  assert.equal(expandCoordinateStateForRestore(downgraded), undefined);
  const runtime = {};
  assert.equal(restoreCoordinateStates([runtime], malformed), false);
  assert.equal(runtime.__coordBoardStates, undefined);
  assert.equal(runtime.__liaRegressionSnapshots, undefined);
  assert.equal(expandCoordinateStateForRestore({ v: 3, b: raw.b }), undefined);
});

test('Coordinate Douglas-Peucker is iterative and safely falls back on adversarial input', async () => {
  const {
    compactCoordinateStateForFreeze,
    expandCoordinateStateForRestore,
    restoreCoordinateStates,
    simplifyCoordinateDrawingPointsDouglasPeucker,
  } = await statePromise;
  const points = Array.from({ length: 5000 }, (_, index) => [index, index % 2 ? 2 : 0]);
  const simplified = simplifyCoordinateDrawingPointsDouglasPeucker(points);
  assert.deepEqual(simplified[0], points[0]);
  assert.deepEqual(simplified.at(-1), points.at(-1));
  assert.equal(simplified.length, points.length);

  const sourcePoints = Array.from({ length: 6000 }, (_, index) => ({
    x: index,
    y: index % 2 ? 0.02 : 0,
  }));
  const compacted = compactCoordinateStateForFreeze({
    v: 1,
    b: { board: { bbox: [0, 3, 6000, -3], width: 12000, height: 600 } },
    r: {
      'board:board': {
        revision: 1,
        boardId: 'board',
        drawingHistory: {
          strokes: [{ color: '#ff0000', width: 3, points: sourcePoints }],
        },
        regressionPoints: [],
        autoCreatedPointsData: [],
        analyses: [],
      },
    },
  });
  assert.equal(compacted.v, 2);
  const runtime = {};
  assert.equal(restoreCoordinateStates([runtime], compacted), true);
  assert.equal(
    runtime.__liaRegressionSnapshots['board:board'].drawingHistory.strokes[0].points.length,
    sourcePoints.length
  );

  const overBudget = { v: 2, r: {} };
  for (let index = 0; index < 17; index++) {
    const key = `board:budget-${index}`;
    const snapshot = plain(compacted.r['board:board']);
    snapshot.boardId = `budget-${index}`;
    overBudget.r[key] = snapshot;
  }
  assert.equal(expandCoordinateStateForRestore(overBudget), undefined);
});

test('seeds complete large Regression point sets instead of partial generic clones', async () => {
  const { restoreCoordinateStates } = await statePromise;
  const count = 20000;
  const frozen = {
    v: 1,
    r: {
      'board:large': {
        revision: 1,
        boardId: 'large',
        drawingHistory: {
          strokes: [{
            color: '#ff0000',
            width: 3,
            points: Array.from({ length: count }, (_, index) => ({
              x: index / 100,
              y: index % 2,
            })),
          }],
        },
        regressionPoints: Array.from({ length: count }, (_, index) => ({
          key: `R${index}`,
          x: index / 100,
          y: 1,
        })),
        autoCreatedPointsData: Array.from({ length: count }, (_, index) => ({
          key: `A${index}`,
          x: index / 100,
          y: 2,
        })),
        analyses: [],
      },
    },
  };
  const runtime = {};
  assert.equal(restoreCoordinateStates([runtime], frozen), true);
  const snapshot = runtime.__liaRegressionSnapshots['board:large'];
  assert.equal(snapshot.drawingHistory.strokes[0].points.length, count);
  assert.equal(snapshot.regressionPoints.length, count);
  assert.equal(snapshot.autoCreatedPointsData.length, count);
});
