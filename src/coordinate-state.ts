// Stable, validated bridge for MINT-the-GAP/lia-coordinate (Proposal).
//
// The template intentionally keeps its learner state in window-scoped stores.
// JSXGraph boards, DOM nodes and runtime registries are never serializable and
// must not enter the submission URL. This adapter projects only the authored,
// user-visible state, pre-seeds it before a slide mounts and then hydrates the
// freshly rendered template through its own public/runtime hooks.

type AnyRecord = Record<string, any>;

export interface CoordinateBoardLike {
  containerObj?: { isConnected?: boolean };
  update?(): void;
  setBoundingBox?(bbox: number[], keepAspect?: boolean): void;
  [key: string]: any;
}

export interface CoordinateRuntime {
  document?: Document;
  __coordBoardStates?: Record<string, unknown>;
  __coord?: {
    getBoardStateStore?(): Record<string, unknown>;
    restoreSavedBoardState?(board: unknown, initialBBox: number[], boardId: string): boolean;
    runExternalBootstraps?(): void;
    [key: string]: any;
  };
  __boards?: Record<string, CoordinateBoardLike>;
  __points?: Record<string, Record<string, unknown>>;
  __pointStates?: Record<string, unknown>;
  __pointGraphStates?: Record<string, unknown>;
  __pointOnGraphLocks?: Record<string, unknown>;
  __pointsOnGraphLocks?: Record<string, unknown>;
  __dgsConstructionStates?: Record<string, unknown>;
  __dgsConstructionBoards?: Record<string, unknown>;
  __liaScharStateStore?: Record<string, unknown>;
  __scharEntries?: Record<string, AnyRecord>;
  __liaRegressionSnapshots?: Record<string, unknown>;
  __liaRegressionStates?: Record<string, AnyRecord>;
  __tableStates?: Record<string, AnyRecord>;
  __plotInputStates?: Record<string, AnyRecord>;
  __plotInputInstances?: Record<string, AnyRecord>;
  __plotInput?: { plotIntoBoard?(board: unknown, state: AnyRecord, raw: string): unknown };
  __sliderEntries?: Record<string, AnyRecord>;
  __liaCoordHooks?: Record<string, (() => void) | undefined>;
  __persistDgsBoardState?(boardId: string, recordHistory?: boolean): void;
  __applyDgsHistory?(boardId: string, snapshot: unknown): void;
  __bootstrapTables?(): void;
  __bootstrapPlotInputs?(): void;
  __bootstrapScharen?(): void;
  __bootstrapRegression?(): void;
  __bootstrapDGS?(): void;
  __bootstrapPlotFunctions?(): void;
  __scheduleFunctionAnalysisPointsForBoard?(boardId?: string): void;
  __scheduleObjectAnalysisPointsForBoard?(boardId?: string): void;
  getTableData?(uid: string): unknown;
  setTableValues?(uid: string, values: unknown): boolean;
  renderTableFromSpec?(uid: string, spec: string, force?: boolean): boolean;
  restorePointFromSpec?(spec: string): unknown;
  renderPlotInputFromSpec?(uid: string, spec: string): boolean;
  /** Narrow synchronous escape hatch for Proposal's own restore events. */
  __liaFreezeCoordinateRestoreActive?: boolean;
  [key: string]: any;
}

export type CoordinateJson =
  | null
  | boolean
  | number
  | string
  | CoordinateJson[]
  | { [key: string]: CoordinateJson };

export interface CoordinateTableStateV1 {
  v: Array<{ x: string; y: string }>;
  w?: Record<string, number>;
}

export interface CoordinatePlotInputStateV1 {
  r: string;
  p: 0 | 1;
}

export interface CoordinateSliderStateV1 {
  u: string;
  b: string;
  n: string;
  v: number;
  p?: [{ x: number; y: number }, { x: number; y: number }];
}

/** Compact keys keep large DGS/regression submissions URL-friendly. */
export interface CoordinateFrozenStateV1 {
  v: 1;
  /** Board viewport, size, axis mode and DGS instrument pose. */
  b?: Record<string, CoordinateJson>;
  /** Learner-created/draggable point coordinates. */
  p?: Record<string, CoordinateJson>;
  /** Revealed PointOnGraph target graphs. */
  g?: Record<string, CoordinateJson>;
  /** Current DGS construction snapshots (never live boards). */
  d?: Record<string, CoordinateJson>;
  /** Schar parameters and panel state. */
  s?: Record<string, CoordinateJson>;
  /** Normalized regression drawing/analysis snapshots. */
  r?: Record<string, CoordinateJson>;
  /** PointOnGraph solution locks. */
  q?: { o?: Record<string, 1>; m?: Record<string, 1> };
  /** Dynamic table values. */
  t?: Record<string, CoordinateTableStateV1>;
  /** PlotInput text plus whether it had actually been plotted. */
  x?: Record<string, CoordinatePlotInputStateV1>;
  /** Live macro-slider values/positions projected away from JSXGraph. */
  z?: Record<string, CoordinateSliderStateV1>;
}

/** URL-only variant. Restore always expands this back to the Proposal v1 shape. */
export interface CoordinateFrozenStateV2 extends Omit<CoordinateFrozenStateV1, "v"> {
  v: 2;
}

export type CoordinateFrozenState = CoordinateFrozenStateV1 | CoordinateFrozenStateV2;

export const COORDINATE_DRAWING_COMPACT_VERSION = "crs1";
export const COORDINATE_DRAWING_GRID_STEP_PX = 1;
export const COORDINATE_DRAWING_MIN_POINT_DISTANCE_PX = 1.25;
export const COORDINATE_DRAWING_DOUGLAS_PEUCKER_TOLERANCE_PX = 1.4;

const MAX_KEY_LENGTH = 512;
const MAX_STRING_LENGTH = 20_000;
const MAX_DEPTH = 24;
const MAX_ARRAY_LENGTH = 5_000;
const MAX_OBJECT_KEYS = 3_000;
const MAX_TOTAL_NODES = 80_000;
const MAX_TABLE_COLUMNS = 100;
const MAX_REGRESSION_STROKES = 300;
const MAX_REGRESSION_POINTS = 20_000;
const MAX_REGRESSION_ANALYSES = 80;
const MAX_REGRESSION_BINARY_PATH_CHARACTERS = 500_000;
const MAX_REGRESSION_COLORS = MAX_REGRESSION_STROKES;
const MAX_REGRESSION_DP_DISTANCE_CHECKS = 2_000_000;
const MAX_TOTAL_REGRESSION_DECODED_DRAWING_POINTS = 100_000;
const MAX_REGRESSION_CLONE_NODES = 260_000;
const MAX_ABSOLUTE_NUMBER = 1e12;
const MAX_COORDINATE_BOARDS = 256;
const MAX_COORDINATE_WIDGETS = 2_048;
const MAX_COORDINATE_LOCKS = 5_000;
const MAX_DGS_RECORDS_TOTAL = 5_000;

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const DGS_RECORD_TYPES = new Set([
  "tangent", "midpoint", "angle-bisector", "slider", "point", "text",
  "function", "external-function-analysis", "segment", "ray", "vector",
  "compass-arc", "arc", "perpendicular", "parallel", "line", "polygon",
  "sector", "circle", "angle", "intersection-construction",
]);
const ANALYSIS_CLASS_KEYS = new Set([
  "linear", "quadratic", "cubic", "quartic", "sin", "exp", "log",
  "sqrt", "hyperbola", "hyperbola2",
]);
const ANALYSIS_MODEL_KEYS: Record<string, string[]> = {
  linear: ["m", "n"],
  // Proposal stores the vertex form a(x-c)^2+d, not polynomial a/b/c.
  quadratic: ["a", "c", "d"],
  cubic: ["a", "b", "c", "d"],
  quartic: ["a", "b", "c", "d", "f"],
  sin: ["A", "b", "c", "d"],
  exp: ["A", "b", "c", "d"],
  log: ["A", "b", "c", "d"],
  sqrt: ["A", "b", "c", "d"],
  hyperbola: ["A", "b", "c", "d"],
  hyperbola2: ["A", "b", "c", "d"],
};

function record(value: unknown): AnyRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    if (Object.prototype.toString.call(value) !== "[object Object]") return undefined;
  } catch {
    return undefined;
  }
  return value as AnyRecord;
}

function safeKey(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_KEY_LENGTH
    && !FORBIDDEN_KEYS.has(value)
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeString(value: unknown, max = MAX_STRING_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length > max || /[\u0000\u0008\u000b\u000c]/.test(value)) return undefined;
  return value;
}

function finite(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function rounded(value: unknown): number | undefined {
  const number = finite(value);
  if (number === undefined || Math.abs(number) > MAX_ABSOLUTE_NUMBER) return undefined;
  return Math.round(number * 1e6) / 1e6;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1;
}

function validBBox(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const bbox = value.map(finite);
  if (bbox.some(item => item === undefined)) return undefined;
  const result = bbox as number[];
  if (result.some(item => Math.abs(item) > MAX_ABSOLUTE_NUMBER)) return undefined;
  if (!(result[2] > result[0]) || !(result[1] > result[3])) return undefined;
  return result.map(item => Math.round(item * 1e8) / 1e8);
}

type CloneBudget = { nodes: number };

function cloneJson(
  value: unknown,
  budget: CloneBudget,
  depth = 0,
): CoordinateJson | undefined {
  if (budget.nodes >= MAX_TOTAL_NODES || depth > MAX_DEPTH) return undefined;
  budget.nodes += 1;
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) && Math.abs(value) <= MAX_ABSOLUTE_NUMBER
      ? value
      : undefined;
  }
  if (typeof value === "string") return safeString(value);
  if (Array.isArray(value)) {
    const result: CoordinateJson[] = [];
    for (const item of value.slice(0, MAX_ARRAY_LENGTH)) {
      const cloned = cloneJson(item, budget, depth + 1);
      if (cloned !== undefined) result.push(cloned);
    }
    return result;
  }
  const source = record(value);
  if (!source) return undefined;
  const result: Record<string, CoordinateJson> = Object.create(null);
  for (const key of Object.keys(source).slice(0, MAX_OBJECT_KEYS)) {
    if (!safeKey(key)) continue;
    const cloned = cloneJson(source[key], budget, depth + 1);
    if (cloned !== undefined) result[key] = cloned;
  }
  return result;
}

function cloneRecordWithBudget(
  value: unknown,
  budget: CloneBudget
): Record<string, CoordinateJson> | undefined {
  const cloned = cloneJson(value, budget);
  return record(cloned) as Record<string, CoordinateJson> | undefined;
}

function cloneRecord(value: unknown): Record<string, CoordinateJson> {
  return cloneRecordWithBudget(value, { nodes: 0 }) ?? Object.create(null);
}

function hasKeys(value: unknown): boolean {
  return !!record(value) && Object.keys(value as AnyRecord).length > 0;
}

function mergeJsonRecord(
  target: Record<string, CoordinateJson>,
  source: Record<string, CoordinateJson>
): void {
  for (const [key, value] of Object.entries(source)) {
    if (safeKey(key)) target[key] = value;
  }
}

function sanitizeBoardStore(value: unknown): Record<string, CoordinateJson> {
  const source = cloneRecord(value);
  const result: Record<string, CoordinateJson> = Object.create(null);
  for (const [boardId, raw] of Object.entries(source).slice(0, MAX_COORDINATE_BOARDS)) {
    if (!safeKey(boardId)) continue;
    const state = record(raw);
    if (!state) continue;
    if (state.bbox !== undefined) {
      const bbox = validBBox(state.bbox);
      if (!bbox) continue;
      state.bbox = bbox;
    }
    if (state.exportBBox !== undefined) {
      const exportBBox = validBBox(state.exportBBox);
      if (exportBBox) state.exportBBox = exportBBox;
      else delete state.exportBBox;
    }
    for (const key of ["width", "height", "maxStartWidth"]) {
      if (state[key] == null) continue;
      const number = finite(state[key]);
      if (number === undefined || number <= 0 || number > 100_000) delete state[key];
      else state[key] = Math.round(number * 100) / 100;
    }
    result[boardId] = state as Record<string, CoordinateJson>;
  }
  return result;
}

function sanitizePointStore(value: unknown): Record<string, CoordinateJson> {
  const result: Record<string, CoordinateJson> = Object.create(null);
  const boards = record(value);
  if (!boards) return result;
  for (const [boardId, rawPoints] of Object.entries(boards).slice(0, MAX_COORDINATE_BOARDS)) {
    if (!safeKey(boardId)) continue;
    const points = record(rawPoints);
    if (!points) continue;
    const cleanPoints: Record<string, CoordinateJson> = Object.create(null);
    for (const [name, rawPoint] of Object.entries(points).slice(0, 2_000)) {
      if (!safeKey(name)) continue;
      const point = record(rawPoint);
      const x = rounded(point?.x);
      const y = rounded(point?.y);
      if (x === undefined || y === undefined || Math.abs(x) > 1e12 || Math.abs(y) > 1e12) continue;
      const clean: Record<string, CoordinateJson> = {
        x,
        y,
        fixed: booleanValue(point?.fixed),
      };
      if (point && "showName" in point) clean.showName = point.showName !== false;
      cleanPoints[name] = clean;
    }
    if (Object.keys(cleanPoints).length) result[boardId] = cleanPoints;
  }
  return result;
}

function sanitizeGraphStore(value: unknown): Record<string, CoordinateJson> {
  const result: Record<string, CoordinateJson> = Object.create(null);
  const boards = record(value);
  if (!boards) return result;
  for (const [boardId, rawGraphs] of Object.entries(boards).slice(0, MAX_COORDINATE_BOARDS)) {
    if (!safeKey(boardId)) continue;
    const graphs = record(rawGraphs);
    if (!graphs) continue;
    const cleanGraphs: Record<string, CoordinateJson> = Object.create(null);
    for (const [graphKey, rawGraph] of Object.entries(graphs).slice(0, 1_000)) {
      if (!safeKey(graphKey)) continue;
      const graph = record(rawGraph);
      if (!graph) continue;
      cleanGraphs[graphKey] = {
        visible: booleanValue(graph.visible),
        name: safeString(graph.name, 300) ?? "",
        color: safeString(graph.color, 80) ?? "",
      };
    }
    if (Object.keys(cleanGraphs).length) result[boardId] = cleanGraphs;
  }
  return result;
}

const SAFE_MATH_IDENTIFIERS = new Set([
  "x", "y", "e", "pi", "math",
  "sin", "cos", "tan", "asin", "acos", "atan", "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "sqrt", "exp", "ln", "log", "abs", "floor", "ceil",
  "round", "min", "max", "pow", "frac", "cdot", "times", "div", "left", "right",
]);

function safeMathExpression(value: unknown, strictIdentifiers = false): string | undefined {
  const expression = safeString(value, 4_000)?.trim();
  if (!expression) return undefined;
  if (/[;'"`<>]/.test(expression)) return undefined;
  if (/(?:__|\b(?:constructor|prototype|window|document|globalThis|Function|eval|import|new|this)\b|=>)/i.test(expression)) {
    return undefined;
  }
  if (strictIdentifiers) {
    const prepared = expression
      .replace(/^\${1,2}\s*/, "").replace(/\s*\${1,2}$/, "")
      .replace(/^\s*[A-Za-z]+\s*\(\s*x\s*\)\s*=\s*/, "")
      .replace(/^\s*y\s*=\s*/, "");
    const identifiers = prepared.match(/\\?[A-Za-z][A-Za-z0-9]*/g) ?? [];
    if (identifiers.some(identifier => !SAFE_MATH_IDENTIFIERS.has(identifier.replace(/^\\/, "").toLowerCase()))) {
      return undefined;
    }
    if (/\bmath\b(?!\s*\.)/i.test(prepared)) return undefined;
  }
  return expression;
}

function sanitizeDgsStore(value: unknown): Record<string, CoordinateJson> {
  const source = record(value);
  const result: Record<string, CoordinateJson> = Object.create(null);
  if (!source) return result;
  const budget: CloneBudget = { nodes: 0 };
  let remainingRecords = MAX_DGS_RECORDS_TOTAL;
  for (const [boardId, rawSnapshot] of Object.entries(source).slice(0, MAX_COORDINATE_BOARDS)) {
    if (remainingRecords <= 0 || budget.nodes >= MAX_TOTAL_NODES) break;
    if (!safeKey(boardId)) continue;
    const raw = record(rawSnapshot);
    if (!raw || !Array.isArray(raw.records)) continue;
    const clean: Record<string, CoordinateJson> = Object.create(null);
    for (const key of Object.keys(raw).slice(0, MAX_OBJECT_KEYS)) {
      if (key === "records" || !safeKey(key)) continue;
      const cloned = cloneJson(raw[key], budget, 1);
      if (cloned !== undefined) clean[key] = cloned;
    }
    const records: CoordinateJson[] = [];
    const candidates = raw.records.slice(0, Math.min(2_000, remainingRecords));
    remainingRecords -= candidates.length;
    for (const rawRecord of candidates) {
      const sourceRecord = record(rawRecord);
      const type = safeString(sourceRecord?.type, 80);
      if (!type || !DGS_RECORD_TYPES.has(type)) continue;
      if (sourceRecord?.expression !== undefined && !safeMathExpression(sourceRecord.expression)) continue;
      if (type === "point") {
        const coordinateExpressions = record(sourceRecord?.coordinateExpressions);
        const hasCoordinates = rounded(sourceRecord?.x) !== undefined
          && rounded(sourceRecord?.y) !== undefined;
        const hasCoordinateExpressions = !!coordinateExpressions
          && !!safeMathExpression(coordinateExpressions.x)
          && !!safeMathExpression(coordinateExpressions.y);
        if (!hasCoordinates && !hasCoordinateExpressions) continue;
      }
      const cloned = cloneRecordWithBudget(sourceRecord, budget);
      if (!cloned) continue;
      cloned.type = type;
      if (type === "text" && typeof cloned.content === "string") {
        cloned.content = cloned.content.replace(/[<>]/g, character => character === "<" ? "‹" : "›");
      }
      const coordinateExpressions = record(cloned.coordinateExpressions);
      if (coordinateExpressions) {
        const x = safeMathExpression(coordinateExpressions.x);
        const y = safeMathExpression(coordinateExpressions.y);
        if (!x || !y) delete cloned.coordinateExpressions;
        else cloned.coordinateExpressions = { x, y };
      }
      records.push(cloned);
    }
    clean.boardId = boardId;
    clean.records = records;
    result[boardId] = clean;
  }
  return result;
}

function sanitizeNumericMap(value: unknown, maxKeys = 80): Record<string, number> | undefined {
  const source = record(value);
  if (!source) return undefined;
  const result: Record<string, number> = Object.create(null);
  for (const [key, raw] of Object.entries(source).slice(0, maxKeys)) {
    if (!safeKey(key)) continue;
    const number = rounded(raw);
    if (number !== undefined && Math.abs(number) <= 1e15) result[key] = number;
  }
  return Object.keys(result).length ? result : undefined;
}

function sanitizeRegressionModel(
  value: unknown,
  classKey: string
): Record<string, number> | undefined {
  const model = sanitizeNumericMap(value);
  const required = ANALYSIS_MODEL_KEYS[classKey];
  if (!model || !required || required.some(key => !Object.prototype.hasOwnProperty.call(model, key))) {
    return undefined;
  }
  return model;
}

function sanitizeRegressionPoints(value: unknown): CoordinateJson[] {
  if (!Array.isArray(value)) return [];
  const result: CoordinateJson[] = [];
  for (const rawPoint of value.slice(0, MAX_REGRESSION_POINTS)) {
    const point = record(rawPoint);
    const key = safeString(point?.key, 300);
    const x = rounded(point?.x);
    const y = rounded(point?.y);
    if (!key || x === undefined || y === undefined) continue;
    result.push({ key, x, y });
  }
  return result;
}

function sanitizeRegressionStrokes(value: unknown): CoordinateJson[] {
  if (!Array.isArray(value)) return [];
  const result: CoordinateJson[] = [];
  let remainingPoints = MAX_REGRESSION_POINTS;
  for (const rawStroke of value.slice(0, MAX_REGRESSION_STROKES)) {
    if (remainingPoints <= 0) break;
    const stroke = record(rawStroke);
    const rawPoints = Array.isArray(stroke?.points) ? stroke.points : [];
    const points: CoordinateJson[] = [];
    for (const rawPoint of rawPoints.slice(0, remainingPoints)) {
      const point = record(rawPoint);
      const x = rounded(point?.x);
      const y = rounded(point?.y);
      if (x === undefined || y === undefined) continue;
      points.push({ x, y });
    }
    remainingPoints -= points.length;
    if (points.length < 1) continue;
    result.push({
      color: safeString(stroke?.color, 80) ?? "#ff0000",
      width: Math.max(0.1, Math.min(100, finite(stroke?.width) ?? 3)),
      points,
    });
  }
  return result;
}

type RegressionStrokePoint = { x: number; y: number };
type RegressionStroke = {
  color: string;
  width: number;
  points: RegressionStrokePoint[];
};
type DrawingTransform = {
  bbox: [number, number, number, number];
  width: number;
  height: number;
};
type QuantizedDrawingPoint = [number, number];
type DrawingSimplificationBudget = { checks: number; exhausted: boolean };
type DrawingDecodeBudget = { points: number };

const COORDINATE_DRAWING_PATH_MAGIC = 17;
const COORDINATE_DRAWING_TOKEN_PREFIX = "b:";
const MAX_ZIGZAG_INPUT = Math.floor((Number.MAX_SAFE_INTEGER - 1) / 2);

function strictInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function strictFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function drawingTransformFromBoard(value: unknown): DrawingTransform | undefined {
  const source = record(value);
  const bbox = validBBox(source?.bbox) ?? validBBox(source?.exportBBox);
  const width = finite(source?.width);
  const height = finite(source?.height);
  if (!bbox || width === undefined || height === undefined
    || width <= 0 || height <= 0 || width > 100_000 || height > 100_000) return undefined;
  return {
    bbox: bbox as [number, number, number, number],
    width: Math.round(width * 100) / 100,
    height: Math.round(height * 100) / 100,
  };
}

function drawingTransformTuple(transform: DrawingTransform): CoordinateJson[] {
  return [...transform.bbox, transform.width, transform.height];
}

function drawingTransformFromTuple(value: unknown): DrawingTransform | undefined {
  if (!Array.isArray(value) || value.length !== 6
    || value.some(entry => strictFiniteNumber(entry) === undefined)) return undefined;
  return drawingTransformFromBoard({
    bbox: value.slice(0, 4),
    width: value[4],
    height: value[5],
  });
}

function drawingLocalPoint(
  point: RegressionStrokePoint,
  transform: DrawingTransform,
): [number, number] | undefined {
  const [left, top, right, bottom] = transform.bbox;
  const x = (point.x - left) * transform.width / (right - left);
  const y = (top - point.y) * transform.height / (top - bottom);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return [x, y];
}

function drawingDistanceSquared(a: QuantizedDrawingPoint, b: QuantizedDrawingPoint): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function drawingPointSegmentDistanceSquared(
  point: QuantizedDrawingPoint,
  start: QuantizedDrawingPoint,
  end: QuantizedDrawingPoint,
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return drawingDistanceSquared(point, start);
  const projection = clamp(
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
    0,
    1,
  );
  const projectedX = start[0] + projection * dx;
  const projectedY = start[1] + projection * dy;
  const distanceX = point[0] - projectedX;
  const distanceY = point[1] - projectedY;
  return distanceX * distanceX + distanceY * distanceY;
}

export function simplifyCoordinateDrawingPointsDouglasPeucker(
  points: QuantizedDrawingPoint[],
  budget: DrawingSimplificationBudget = { checks: 0, exhausted: false },
): QuantizedDrawingPoint[] {
  if (points.length <= 2 || budget.exhausted) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  const toleranceCells = COORDINATE_DRAWING_DOUGLAS_PEUCKER_TOLERANCE_PX
    / COORDINATE_DRAWING_GRID_STEP_PX;
  const toleranceSquared = toleranceCells * toleranceCells;

  while (stack.length) {
    const [startIndex, endIndex] = stack.pop()!;
    if (endIndex <= startIndex + 1) continue;
    let farthestIndex = -1;
    let farthestDistance = -1;
    for (let index = startIndex + 1; index < endIndex; index++) {
      budget.checks += 1;
      if (budget.checks > MAX_REGRESSION_DP_DISTANCE_CHECKS) {
        budget.exhausted = true;
        return points.slice();
      }
      const distance = drawingPointSegmentDistanceSquared(
        points[index],
        points[startIndex],
        points[endIndex],
      );
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex >= 0 && farthestDistance > toleranceSquared) {
      keep[farthestIndex] = 1;
      stack.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }

  const simplified = points.filter((_, index) => keep[index] === 1);
  return simplified.length >= 2 ? simplified : points.slice();
}

function quantizeCoordinateDrawingPoints(
  points: RegressionStrokePoint[],
  transform: DrawingTransform,
  budget: DrawingSimplificationBudget,
): QuantizedDrawingPoint[] | undefined {
  if (!points.length || points.length > MAX_REGRESSION_POINTS) return undefined;
  const result: QuantizedDrawingPoint[] = [];
  const minimumDistanceSquared = COORDINATE_DRAWING_MIN_POINT_DISTANCE_PX
    * COORDINATE_DRAWING_MIN_POINT_DISTANCE_PX;
  let lastAcceptedLocal: [number, number] | undefined;

  for (let index = 0; index < points.length; index++) {
    const local = drawingLocalPoint(points[index], transform);
    if (!local) return undefined;
    const isLast = index === points.length - 1;
    if (lastAcceptedLocal && !isLast) {
      const dx = local[0] - lastAcceptedLocal[0];
      const dy = local[1] - lastAcceptedLocal[1];
      if (dx * dx + dy * dy < minimumDistanceSquared) continue;
    }
    const x = Math.round(local[0] / COORDINATE_DRAWING_GRID_STEP_PX);
    const y = Math.round(local[1] / COORDINATE_DRAWING_GRID_STEP_PX);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)
      || Math.abs(x) > MAX_ZIGZAG_INPUT || Math.abs(y) > MAX_ZIGZAG_INPUT) return undefined;
    const previous = result[result.length - 1];
    if (!previous || previous[0] !== x || previous[1] !== y) result.push([x, y]);
    lastAcceptedLocal = local;
  }

  if (result.length >= 3) return simplifyCoordinateDrawingPointsDouglasPeucker(result, budget);
  return result.length ? result : undefined;
}

function zigZagEncodeDrawing(value: number): number {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_ZIGZAG_INPUT) {
    throw new Error("Coordinate drawing integer exceeds the safe range.");
  }
  return value < 0 ? -value * 2 - 1 : value * 2;
}

function zigZagDecodeDrawing(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid Coordinate drawing ZigZag integer.");
  }
  return value % 2 === 1 ? -(value + 1) / 2 : value / 2;
}

function pushDrawingVarUint(bytes: number[], input: number): void {
  let value = input;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid Coordinate drawing VarUint.");
  }
  while (value >= 0x80) {
    bytes.push((value % 0x80) + 0x80);
    value = Math.floor(value / 0x80);
  }
  bytes.push(value);
}

function readDrawingVarUint(bytes: Uint8Array, cursor: { index: number }): number {
  let value = 0;
  let multiplier = 1;
  let continuations = 0;
  while (cursor.index < bytes.length) {
    const byte = bytes[cursor.index++];
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) throw new Error("Coordinate drawing VarUint overflow.");
    if ((byte & 0x80) === 0) return value;
    multiplier *= 0x80;
    continuations += 1;
    if (!Number.isSafeInteger(multiplier) || continuations > 8) {
      throw new Error("Coordinate drawing VarUint is implausibly long.");
    }
  }
  throw new Error("Coordinate drawing VarUint is truncated.");
}

function drawingBytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function drawingBase64UrlToBytes(value: string): Uint8Array {
  if (!value || value.length > MAX_REGRESSION_BINARY_PATH_CHARACTERS
    || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid Coordinate drawing path token.");
  }
  let padded = value.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4 !== 0) padded += "=";
  let binary: string;
  try { binary = atob(padded); } catch {
    throw new Error("Invalid base64url Coordinate drawing path token.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeCoordinateDrawingPath(points: QuantizedDrawingPoint[]): string {
  const bytes: number[] = [];
  pushDrawingVarUint(bytes, COORDINATE_DRAWING_PATH_MAGIC);
  pushDrawingVarUint(bytes, points.length);
  let previousX = 0;
  let previousY = 0;
  points.forEach((point, index) => {
    const x = index === 0 ? point[0] : point[0] - previousX;
    const y = index === 0 ? point[1] : point[1] - previousY;
    pushDrawingVarUint(bytes, zigZagEncodeDrawing(x));
    pushDrawingVarUint(bytes, zigZagEncodeDrawing(y));
    previousX = point[0];
    previousY = point[1];
  });
  return COORDINATE_DRAWING_TOKEN_PREFIX + drawingBytesToBase64Url(new Uint8Array(bytes));
}

function decodeCoordinateDrawingPath(
  value: unknown,
  transform: DrawingTransform,
  snapshotBudget: DrawingDecodeBudget,
  totalBudget: DrawingDecodeBudget,
): RegressionStrokePoint[] {
  if (typeof value !== "string" || !value.startsWith(COORDINATE_DRAWING_TOKEN_PREFIX)) {
    throw new Error("Invalid compact Coordinate drawing token.");
  }
  const bytes = drawingBase64UrlToBytes(value.slice(COORDINATE_DRAWING_TOKEN_PREFIX.length));
  const cursor = { index: 0 };
  if (readDrawingVarUint(bytes, cursor) !== COORDINATE_DRAWING_PATH_MAGIC) {
    throw new Error("Invalid compact Coordinate drawing magic.");
  }
  const count = readDrawingVarUint(bytes, cursor);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_REGRESSION_POINTS
    || snapshotBudget.points > MAX_REGRESSION_POINTS - count
    || totalBudget.points > MAX_TOTAL_REGRESSION_DECODED_DRAWING_POINTS - count) {
    throw new Error("Compact Coordinate drawing point count is outside the supported range.");
  }
  snapshotBudget.points += count;
  totalBudget.points += count;
  const points: RegressionStrokePoint[] = [];
  let x = 0;
  let y = 0;
  const [left, top, right, bottom] = transform.bbox;
  for (let index = 0; index < count; index++) {
    const deltaX = zigZagDecodeDrawing(readDrawingVarUint(bytes, cursor));
    const deltaY = zigZagDecodeDrawing(readDrawingVarUint(bytes, cursor));
    x = index === 0 ? deltaX : x + deltaX;
    y = index === 0 ? deltaY : y + deltaY;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)
      || Math.abs(x) > MAX_ZIGZAG_INPUT || Math.abs(y) > MAX_ZIGZAG_INPUT) {
      throw new Error("Compact Coordinate drawing delta overflow.");
    }
    const userX = left + x * COORDINATE_DRAWING_GRID_STEP_PX
      * (right - left) / transform.width;
    const userY = top - y * COORDINATE_DRAWING_GRID_STEP_PX
      * (top - bottom) / transform.height;
    const cleanX = rounded(userX);
    const cleanY = rounded(userY);
    if (cleanX === undefined || cleanY === undefined) {
      throw new Error("Decoded Coordinate drawing point is outside the supported range.");
    }
    points.push({ x: cleanX, y: cleanY });
  }
  if (cursor.index !== bytes.length) {
    throw new Error("Compact Coordinate drawing token contains trailing bytes.");
  }
  return points;
}

function compactRegressionDrawingHistory(
  rawHistory: unknown,
  boardState: unknown,
): CoordinateJson {
  const history = record(rawHistory);
  const strokes = sanitizeRegressionStrokes(history?.strokes) as RegressionStroke[];
  const fallback: CoordinateJson = { strokes, undoActions: [], redoActions: [] };
  const transform = drawingTransformFromBoard(boardState);
  if (!transform || !strokes.length) return fallback;

  try {
    const colors: string[] = [];
    const colorIndexes = new Map<string, number>();
    const compactStrokes: CoordinateJson[] = [];
    const simplificationBudget: DrawingSimplificationBudget = { checks: 0, exhausted: false };
    for (const stroke of strokes) {
      let colorIndex = colorIndexes.get(stroke.color);
      if (colorIndex === undefined) {
        if (colors.length >= MAX_REGRESSION_COLORS) return fallback;
        colorIndex = colors.length;
        colors.push(stroke.color);
        colorIndexes.set(stroke.color, colorIndex);
      }
      const points = quantizeCoordinateDrawingPoints(stroke.points, transform, simplificationBudget);
      if (!points?.length) return fallback;
      const token = encodeCoordinateDrawingPath(points);
      compactStrokes.push(stroke.width === 3
        ? [colorIndex, token]
        : [colorIndex, Math.round(stroke.width * 10_000) / 10_000, token]);
    }
    return {
      q: [
        COORDINATE_DRAWING_COMPACT_VERSION,
        drawingTransformTuple(transform),
        colors,
        compactStrokes,
      ],
    };
  } catch {
    return fallback;
  }
}

function decodeCompactRegressionStrokes(
  value: unknown,
  totalBudget: DrawingDecodeBudget = { points: 0 },
): RegressionStroke[] | undefined {
  const history = record(value);
  if (!history || !Object.prototype.hasOwnProperty.call(history, "q")
    || Object.keys(history).some(key => key !== "q")) return undefined;
  const envelope = history.q;
  if (!Array.isArray(envelope) || envelope.length !== 4
    || envelope[0] !== COORDINATE_DRAWING_COMPACT_VERSION) return undefined;
  const transform = drawingTransformFromTuple(envelope[1]);
  const colors = envelope[2];
  const tuples = envelope[3];
  if (!transform || !Array.isArray(colors) || colors.length > MAX_REGRESSION_COLORS
    || colors.some(color => typeof color !== "string" || color.length > 80)
    || !Array.isArray(tuples) || tuples.length > MAX_REGRESSION_STROKES) return undefined;

  const result: RegressionStroke[] = [];
  const snapshotBudget: DrawingDecodeBudget = { points: 0 };
  try {
    for (const rawTuple of tuples) {
      if (!Array.isArray(rawTuple) || (rawTuple.length !== 2 && rawTuple.length !== 3)) {
        throw new Error("Invalid compact Coordinate stroke tuple.");
      }
      const colorIndex = strictInteger(rawTuple[0]);
      const width = rawTuple.length === 2 ? 3 : strictFiniteNumber(rawTuple[1]);
      const token = rawTuple[rawTuple.length - 1];
      if (colorIndex === undefined || colorIndex < 0 || colorIndex >= colors.length
        || width === undefined || width < 0.1 || width > 100) {
        throw new Error("Invalid compact Coordinate stroke style.");
      }
      result.push({
        color: colors[colorIndex] as string,
        width: Math.round(width * 10_000) / 10_000,
        points: decodeCoordinateDrawingPath(token, transform, snapshotBudget, totalBudget),
      });
    }
    return result;
  } catch {
    return undefined;
  }
}

function panelScale(panel: unknown): number {
  try {
    const transform = String((panel as AnyRecord)?.style?.transform || "");
    const match = transform.match(/scale\(([^)]+)\)/);
    const scale = finite(match?.[1]);
    if (scale !== undefined) return Math.max(0.35, Math.min(1.45, scale));
  } catch { /* DOM from another same-origin realm */ }
  return 0.58;
}

function panelMinimized(panel: unknown): boolean {
  try {
    const mini = (panel as AnyRecord)?.querySelector?.(".lia-plot-analysis-mini-wrap");
    return mini?.style?.display === "inline-flex";
  } catch {
    return false;
  }
}

function sanitizeRegressionAnalyses(value: unknown): CoordinateJson[] {
  if (!Array.isArray(value)) return [];
  const result: CoordinateJson[] = [];
  for (const rawAnalysis of value.slice(0, MAX_REGRESSION_ANALYSES)) {
    const analysis = record(rawAnalysis);
    const classKey = safeString(analysis?.classKey, 40);
    const model = classKey ? sanitizeRegressionModel(analysis?.model, classKey) : undefined;
    if (!classKey || !ANALYSIS_CLASS_KEYS.has(classKey) || !model) continue;
    const clean: Record<string, CoordinateJson> = {
      id: safeString(analysis?.id, 300) ?? "",
      classKey,
      title: safeString(analysis?.title, 1_000) ?? "",
      color: safeString(analysis?.color, 80) ?? "#ff0000",
      model,
      overlayScale: Math.max(0.35, Math.min(1.45, finite(analysis?.overlayScale) ?? panelScale(analysis?.panel))),
      minimized: typeof analysis?.minimized === "boolean"
        ? analysis.minimized
        : panelMinimized(analysis?.panel),
      order: Math.max(0, Math.floor(finite(analysis?.order) ?? result.length + 1)),
    };
    const probabilities = sanitizeNumericMap(analysis?.classProbabilities, 20);
    if (probabilities) clean.classProbabilities = probabilities;
    const linked = record(analysis?.linkedModels);
    if (linked) {
      const cleanLinked: Record<string, CoordinateJson> = Object.create(null);
      for (const [key, rawModel] of Object.entries(linked).slice(0, ANALYSIS_CLASS_KEYS.size)) {
        if (!ANALYSIS_CLASS_KEYS.has(key)) continue;
        const linkedModel = sanitizeRegressionModel(rawModel, key);
        if (linkedModel) cleanLinked[key] = linkedModel;
      }
      if (Object.keys(cleanLinked).length) clean.linkedModels = cleanLinked;
    }
    result.push(clean);
  }
  return result.sort((left, right) => Number((left as AnyRecord).order) - Number((right as AnyRecord).order));
}

function regressionAnalysesFromLive(state: AnyRecord): CoordinateJson[] {
  const groups: Array<[string, unknown]> = [
    ["linear", state.analysisEntries],
    ["quadratic", state.quadraticAnalysisEntries],
    ["cubic", state.cubicAnalysisEntries],
    ["quartic", state.quarticAnalysisEntries],
    ["sin", state.sinAnalysisEntries],
    ["exp", state.expAnalysisEntries],
    ["log", state.logAnalysisEntries],
    ["sqrt", state.sqrtAnalysisEntries],
    ["hyperbola", state.hyperbolaAnalysisEntries],
    ["hyperbola2", state.hyperbola2AnalysisEntries],
  ];
  const raw: AnyRecord[] = [];
  let order = 0;
  for (const [fallbackClass, entries] of groups) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const source = record(entry);
      if (!source) continue;
      order += 1;
      raw.push({
        id: source.id,
        classKey: source.classKey || fallbackClass,
        title: source.title,
        color: source.color,
        model: source.model,
        classProbabilities: source.classProbabilities,
        linkedModels: source.linkedModels,
        overlayScale: panelScale(source.panel),
        minimized: panelMinimized(source.panel),
        order,
      });
    }
  }
  return sanitizeRegressionAnalyses(raw);
}

function sanitizeRegressionSnapshot(
  rawSnapshot: unknown,
  fallbackBoardId = "",
  totalDrawingBudget: DrawingDecodeBudget = { points: 0 },
): CoordinateJson | undefined {
  const raw = record(rawSnapshot);
  if (!raw) return undefined;
  const boardId = safeString(raw.boardId, MAX_KEY_LENGTH) ?? fallbackBoardId;
  if (!safeKey(boardId)) return undefined;
  const history = record(raw.drawingHistory);
  const hasCompactHistory = !!history && Object.prototype.hasOwnProperty.call(history, "q");
  const compactStrokes = hasCompactHistory
    ? decodeCompactRegressionStrokes(history, totalDrawingBudget)
    : undefined;
  if (hasCompactHistory && !compactStrokes) return undefined;
  const strokes = compactStrokes ?? sanitizeRegressionStrokes(history?.strokes);
  return {
    revision: Math.min(1_000_000_000, Math.max(1, Math.floor(finite(raw.revision) ?? 1))),
    boardId,
    drawColor: safeString(raw.drawColor, 80) ?? "#ff0000",
    // A frozen viewer never resumes a half-open tool/menu or undo history.
    drawColorMenuOpen: false,
    toolsMenuOpen: false,
    activeTool: "",
    regressionMode: "",
    drawingHistory: {
      strokes,
      undoActions: [],
      redoActions: [],
    },
    regressionPoints: sanitizeRegressionPoints(raw.regressionPoints),
    autoCreatedPointsData: sanitizeRegressionPoints(raw.autoCreatedPointsData),
    analysisSeq: Math.min(1_000_000_000, Math.max(0, Math.floor(finite(raw.analysisSeq) ?? 0))),
    analyses: sanitizeRegressionAnalyses(raw.analyses),
  };
}

function regressionSnapshotFromLive(state: AnyRecord, previous?: unknown): CoordinateJson | undefined {
  const boardId = safeString(state.boardId, MAX_KEY_LENGTH);
  if (!boardId) return undefined;
  const previousRevision = finite(record(previous)?.revision) ?? 0;
  return sanitizeRegressionSnapshot({
    revision: previousRevision + 1,
    boardId,
    drawColor: state.drawColor,
    drawingHistory: { strokes: state.strokes },
    regressionPoints: state.regressionPoints,
    autoCreatedPointsData: state.autoCreatedPointsData,
    analysisSeq: state.analysisSeq,
    analyses: regressionAnalysesFromLive(state),
  }, boardId);
}

function sanitizeRegressionStore(value: unknown): Record<string, CoordinateJson> {
  const source = record(value);
  const result: Record<string, CoordinateJson> = Object.create(null);
  if (!source) return result;
  const totalDrawingBudget: DrawingDecodeBudget = { points: 0 };
  for (const [key, raw] of Object.entries(source).slice(0, MAX_COORDINATE_BOARDS)) {
    if (!safeKey(key)) continue;
    const boardId = key.startsWith("board:") ? key.slice(6) : "";
    const snapshot = sanitizeRegressionSnapshot(raw, boardId, totalDrawingBudget);
    if (snapshot) result[key] = snapshot;
  }
  return result;
}

function regressionStoreContainsCompactHistory(value: unknown): boolean {
  const source = record(value);
  if (!source) return false;
  return Object.values(source).some(rawSnapshot => {
    const history = record(record(rawSnapshot)?.drawingHistory);
    return !!history && Object.prototype.hasOwnProperty.call(history, "q");
  });
}

function compactRegressionStore(
  value: unknown,
  boards: Record<string, CoordinateJson> | undefined,
): { states: Record<string, CoordinateJson>; compacted: boolean } {
  const source = sanitizeRegressionStore(value);
  const states: Record<string, CoordinateJson> = Object.create(null);
  let compacted = false;
  for (const [key, rawSnapshot] of Object.entries(source)) {
    const snapshot = record(rawSnapshot);
    const boardId = safeString(snapshot?.boardId, MAX_KEY_LENGTH);
    if (!snapshot || !boardId) continue;
    const drawingHistory = compactRegressionDrawingHistory(
      snapshot.drawingHistory,
      boards?.[boardId],
    );
    if (record(drawingHistory)?.q) compacted = true;
    states[key] = { ...snapshot, drawingHistory } as Record<string, CoordinateJson>;
  }
  return { states, compacted };
}

function sanitizeScharStore(value: unknown): Record<string, CoordinateJson> {
  const source = record(value);
  const result: Record<string, CoordinateJson> = Object.create(null);
  if (!source) return result;
  for (const [key, rawState] of Object.entries(source).slice(0, MAX_COORDINATE_WIDGETS)) {
    if (!safeKey(key)) continue;
    const state = record(rawState);
    const values = sanitizeNumericMap(state?.values, 100);
    if (!state || !values) continue;
    result[key] = {
      values,
      panelScale: Math.max(0.55, Math.min(1.45, finite(state.panelScale) ?? 0.55)),
      panelMinimized: booleanValue(state.panelMinimized),
      termVisible: booleanValue(state.termVisible),
    };
  }
  return result;
}

function trueLocks(value: unknown): Record<string, 1> {
  const source = record(value);
  const result: Record<string, 1> = Object.create(null);
  if (!source) return result;
  for (const [uid, locked] of Object.entries(source).slice(0, MAX_COORDINATE_LOCKS)) {
    if (safeKey(uid) && booleanValue(locked)) result[uid] = 1;
  }
  return result;
}

function tableValues(value: unknown): Array<{ x: string; y: string }> {
  const data = record(value);
  const rawValues = Array.isArray(data?.values) ? data.values : Array.isArray(value) ? value : [];
  const result: Array<{ x: string; y: string }> = [];
  for (const raw of rawValues.slice(0, MAX_TABLE_COLUMNS)) {
    const cell = record(raw);
    const rawX = safeString(cell?.x, 2_000) ?? "";
    const rawY = safeString(cell?.y, 2_000) ?? "";
    result.push({
      // The Proposal parses non-empty table cells as mathematical input when
      // rebuilding points. Keep authored formulae but never forward script-like
      // URL data into that parser automatically.
      x: !rawX.trim() || safeMathExpression(rawX, true) ? rawX : "",
      y: !rawY.trim() || safeMathExpression(rawY, true) ? rawY : "",
    });
  }
  return result;
}

function tablePointName(prefix: string, columnIndex: number): string {
  const base = prefix.trim() || "P";
  return base + "_" + (columnIndex + 1);
}

function tableStates(runtime: CoordinateRuntime): Record<string, CoordinateTableStateV1> {
  const result: Record<string, CoordinateTableStateV1> = Object.create(null);
  const source = record(runtime.__tableStates);
  if (!source) return result;
  for (const [uid, state] of Object.entries(source).slice(0, MAX_COORDINATE_WIDGETS)) {
    if (!safeKey(uid)) continue;
    let data: unknown = state;
    try { data = runtime.getTableData?.(uid) ?? state; } catch { /* use projected store */ }
    const values = tableValues(data);
    const widthsSource = record(record(state)?.cellWidths);
    const widths: Record<string, number> = Object.create(null);
    if (widthsSource) {
      for (const [key, raw] of Object.entries(widthsSource).slice(0, MAX_TABLE_COLUMNS * 2)) {
        const width = finite(raw);
        if (safeKey(key) && width !== undefined && width >= 0 && width <= 10_000) widths[key] = width;
      }
    }
    result[uid] = { v: values };
    if (Object.keys(widths).length) result[uid].w = widths;
  }
  return result;
}

function plotInputStates(runtime: CoordinateRuntime): Record<string, CoordinatePlotInputStateV1> {
  const result: Record<string, CoordinatePlotInputStateV1> = Object.create(null);
  const source = record(runtime.__plotInputStates);
  if (!source) return result;
  for (const [uid, rawState] of Object.entries(source).slice(0, MAX_COORDINATE_WIDGETS)) {
    if (!safeKey(uid)) continue;
    const state = record(rawState);
    const raw = safeString(state?.raw, 4_000) ?? "";
    const board = state?.boardId && runtime.__boards?.[String(state.boardId)];
    const plotted = !!state?.graph && (!board || state.graph.board === board);
    // Keep an explicit empty entry as well. It must be able to overwrite an
    // earlier plotted value in the course-wide navigation accumulator.
    result[uid] = { r: raw, p: plotted ? 1 : 0 };
  }
  return result;
}

function pointPosition(point: AnyRecord | undefined): { x: number; y: number } | undefined {
  if (!point) return undefined;
  try {
    const x = rounded(typeof point.X === "function" ? point.X() : undefined);
    const y = rounded(typeof point.Y === "function" ? point.Y() : undefined);
    if (x !== undefined && y !== undefined) return { x, y };
  } catch { /* stale JSXGraph entry */ }
  return undefined;
}

function sliderStates(runtime: CoordinateRuntime): Record<string, CoordinateSliderStateV1> {
  const result: Record<string, CoordinateSliderStateV1> = Object.create(null);
  const entries = record(runtime.__sliderEntries);
  if (!entries) return result;
  for (const [key, rawEntry] of Object.entries(entries).slice(0, MAX_COORDINATE_WIDGETS)) {
    if (!safeKey(key)) continue;
    const entry = record(rawEntry);
    const uid = safeString(entry?.uid, MAX_KEY_LENGTH);
    const boardId = safeString(entry?.boardId, MAX_KEY_LENGTH);
    const name = safeString(entry?.name, 300);
    const board = boardId && runtime.__boards?.[boardId];
    const slider = record(entry?.slider);
    if (!uid || !boardId || !name || !board || !slider || slider.board !== board) continue;
    let value: number | undefined;
    try { value = rounded(typeof slider.Value === "function" ? slider.Value() : slider.__liaDgsSliderValue); } catch { /* stale */ }
    if (value === undefined) continue;
    const first = pointPosition(record(slider.point1));
    const second = pointPosition(record(slider.point2));
    const saved: CoordinateSliderStateV1 = { u: uid, b: boardId, n: name, v: value };
    if (first && second) saved.p = [first, second];
    result[key] = saved;
  }
  return result;
}

function captureLiveSchar(runtime: CoordinateRuntime, target: Record<string, CoordinateJson>): void {
  const entries = record(runtime.__scharEntries);
  if (!entries) return;
  for (const entry of Object.values(entries).slice(0, MAX_COORDINATE_WIDGETS)) {
    const state = record(entry);
    const uid = safeString(state?.uid, MAX_KEY_LENGTH);
    const boardId = safeString(state?.boardId, MAX_KEY_LENGTH);
    if (!uid || !boardId) continue;
    const values = sanitizeNumericMap(state?.values, 100);
    if (!values) continue;
    target[uid + "::" + boardId] = {
      values,
      panelScale: Math.max(0.55, Math.min(1.45, finite(state?.panelScale) ?? panelScale(state?.panel))),
      panelMinimized: booleanValue(state?.panelMinimized),
      termVisible: booleanValue(state?.termVisible),
    };
  }
}

function captureLiveRegression(runtime: CoordinateRuntime, target: Record<string, CoordinateJson>): void {
  const states = record(runtime.__liaRegressionStates);
  if (!states) return;
  for (const state of Object.values(states).slice(0, MAX_COORDINATE_BOARDS)) {
    const live = record(state);
    const boardId = safeString(live?.boardId, MAX_KEY_LENGTH);
    const board = boardId && runtime.__boards?.[boardId];
    if (!boardId || !board || live?.board !== board) continue;
    const key = "board:" + boardId;
    const snapshot = regressionSnapshotFromLive(live!, target[key]);
    if (snapshot) target[key] = snapshot;
  }
}

function flushDgs(runtime: CoordinateRuntime): void {
  if (typeof runtime.__persistDgsBoardState !== "function") return;
  for (const [boardId, board] of Object.entries(runtime.__boards ?? {}).slice(0, MAX_COORDINATE_BOARDS)) {
    if (!safeKey(boardId) || !board) continue;
    if (board.containerObj?.isConnected === false) continue;
    try { runtime.__persistDgsBoardState(boardId, false); } catch { /* isolate a broken board */ }
  }
}

function runtimeHasCoordinate(runtime: CoordinateRuntime): boolean {
  return !!runtime.__coord
    || hasKeys(runtime.__coordBoardStates)
    || hasKeys(runtime.__pointStates)
    || hasKeys(runtime.__pointGraphStates)
    || hasKeys(runtime.__pointOnGraphLocks)
    || hasKeys(runtime.__pointsOnGraphLocks)
    || hasKeys(runtime.__dgsConstructionStates)
    || hasKeys(runtime.__liaScharStateStore)
    || hasKeys(runtime.__scharEntries)
    || hasKeys(runtime.__liaRegressionSnapshots)
    || hasKeys(runtime.__liaRegressionStates)
    || hasKeys(runtime.__tableStates)
    || hasKeys(runtime.__plotInputStates)
    || hasKeys(runtime.__sliderEntries);
}

export function captureCoordinateStates(
  runtimes: CoordinateRuntime[]
): CoordinateFrozenStateV1 {
  const boards: Record<string, CoordinateJson> = Object.create(null);
  const points: Record<string, CoordinateJson> = Object.create(null);
  const graphs: Record<string, CoordinateJson> = Object.create(null);
  const dgs: Record<string, CoordinateJson> = Object.create(null);
  const schar: Record<string, CoordinateJson> = Object.create(null);
  const regression: Record<string, CoordinateJson> = Object.create(null);
  const pointLocks: Record<string, 1> = Object.create(null);
  const multiLocks: Record<string, 1> = Object.create(null);
  const tables: Record<string, CoordinateTableStateV1> = Object.create(null);
  const plots: Record<string, CoordinatePlotInputStateV1> = Object.create(null);
  const sliders: Record<string, CoordinateSliderStateV1> = Object.create(null);

  for (const runtime of runtimes) {
    if (!runtime || !runtimeHasCoordinate(runtime)) continue;
    flushDgs(runtime);
    let boardStore: unknown = runtime.__coordBoardStates;
    try { boardStore = runtime.__coord?.getBoardStateStore?.() ?? boardStore; } catch { /* fallback */ }
    mergeJsonRecord(boards, sanitizeBoardStore(boardStore));
    mergeJsonRecord(points, sanitizePointStore(runtime.__pointStates));
    mergeJsonRecord(graphs, sanitizeGraphStore(runtime.__pointGraphStates));
    mergeJsonRecord(dgs, sanitizeDgsStore(runtime.__dgsConstructionStates));
    mergeJsonRecord(schar, sanitizeScharStore(runtime.__liaScharStateStore));
    captureLiveSchar(runtime, schar);
    mergeJsonRecord(regression, sanitizeRegressionStore(runtime.__liaRegressionSnapshots));
    captureLiveRegression(runtime, regression);
    Object.assign(pointLocks, trueLocks(runtime.__pointOnGraphLocks));
    Object.assign(multiLocks, trueLocks(runtime.__pointsOnGraphLocks));
    Object.assign(tables, tableStates(runtime));
    Object.assign(plots, plotInputStates(runtime));
    Object.assign(sliders, sliderStates(runtime));
  }

  const state: CoordinateFrozenStateV1 = { v: 1 };
  if (Object.keys(boards).length) state.b = boards;
  if (Object.keys(points).length) state.p = points;
  if (Object.keys(graphs).length) state.g = graphs;
  if (Object.keys(dgs).length) state.d = dgs;
  if (Object.keys(schar).length) state.s = schar;
  if (Object.keys(regression).length) state.r = regression;
  if (Object.keys(pointLocks).length || Object.keys(multiLocks).length) {
    state.q = {};
    if (Object.keys(pointLocks).length) state.q.o = pointLocks;
    if (Object.keys(multiLocks).length) state.q.m = multiLocks;
  }
  if (Object.keys(tables).length) state.t = tables;
  if (Object.keys(plots).length) state.x = plots;
  if (Object.keys(sliders).length) state.z = sliders;
  return state;
}

function sanitizeTables(value: unknown): Record<string, CoordinateTableStateV1> {
  const source = record(value);
  const result: Record<string, CoordinateTableStateV1> = Object.create(null);
  if (!source) return result;
  for (const [uid, raw] of Object.entries(source).slice(0, MAX_COORDINATE_WIDGETS)) {
    if (!safeKey(uid)) continue;
    const state = record(raw);
    const values = tableValues(state?.v);
    if (!state || !Array.isArray(state.v)) continue;
    const clean: CoordinateTableStateV1 = { v: values };
    const widths = record(state.w);
    if (widths) {
      const cleanWidths: Record<string, number> = Object.create(null);
      for (const [key, rawWidth] of Object.entries(widths).slice(0, MAX_TABLE_COLUMNS * 2)) {
        const width = finite(rawWidth);
        if (safeKey(key) && width !== undefined && width >= 0 && width <= 10_000) cleanWidths[key] = width;
      }
      if (Object.keys(cleanWidths).length) clean.w = cleanWidths;
    }
    result[uid] = clean;
  }
  return result;
}

function sanitizePlots(value: unknown): Record<string, CoordinatePlotInputStateV1> {
  const source = record(value);
  const result: Record<string, CoordinatePlotInputStateV1> = Object.create(null);
  if (!source) return result;
  for (const [uid, raw] of Object.entries(source).slice(0, MAX_COORDINATE_WIDGETS)) {
    if (!safeKey(uid)) continue;
    const state = record(raw);
    const text = safeString(state?.r, 4_000);
    if (text === undefined) continue;
    result[uid] = { r: text, p: booleanValue(state?.p) ? 1 : 0 };
  }
  return result;
}

function sanitizeSliderPosition(value: unknown): CoordinateSliderStateV1["p"] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const points = value.map(raw => {
    const point = record(raw);
    const x = rounded(point?.x);
    const y = rounded(point?.y);
    return x === undefined || y === undefined ? undefined : { x, y };
  });
  return points[0] && points[1]
    ? [points[0], points[1]] as CoordinateSliderStateV1["p"]
    : undefined;
}

function sanitizeSliders(value: unknown): Record<string, CoordinateSliderStateV1> {
  const source = record(value);
  const result: Record<string, CoordinateSliderStateV1> = Object.create(null);
  if (!source) return result;
  for (const [key, raw] of Object.entries(source).slice(0, MAX_COORDINATE_WIDGETS)) {
    if (!safeKey(key)) continue;
    const state = record(raw);
    const uid = safeString(state?.u, MAX_KEY_LENGTH);
    const boardId = safeString(state?.b, MAX_KEY_LENGTH);
    const name = safeString(state?.n, 300);
    const valueNumber = rounded(state?.v);
    if (!uid || !boardId || !name || valueNumber === undefined) continue;
    const clean: CoordinateSliderStateV1 = { u: uid, b: boardId, n: name, v: valueNumber };
    const position = sanitizeSliderPosition(state?.p);
    if (position) clean.p = position;
    result[key] = clean;
  }
  return result;
}

const normalizedCoordinateStates = new WeakSet<object>();

function freezeNormalizedCoordinateState(
  state: CoordinateFrozenStateV1,
): CoordinateFrozenStateV1 {
  const seen = new WeakSet<object>();
  const stack: object[] = [state];
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const value of Object.values(current)) {
      if (value && typeof value === "object") stack.push(value as object);
    }
    Object.freeze(current);
  }
  normalizedCoordinateStates.add(state);
  return state;
}

function decodeCoordinateState(value: unknown): CoordinateFrozenStateV1 | undefined {
  const root = record(value);
  if (!root) return undefined;
  if (normalizedCoordinateStates.has(root)) return root as CoordinateFrozenStateV1;
  // Backwards compatibility: old Freeze builds stored the raw board store in
  // `coord`. It is safe to keep restoring that viewport-only shape.
  if (root.v !== 1 && root.v !== 2) {
    if (Object.prototype.hasOwnProperty.call(root, "v") && !record(root.v)) {
      return undefined;
    }
    const legacyBoards = sanitizeBoardStore(root);
    return Object.keys(legacyBoards).length
      ? freezeNormalizedCoordinateState({ v: 1, b: legacyBoards })
      : undefined;
  }
  const state: CoordinateFrozenStateV1 = { v: 1 };
  const boards = sanitizeBoardStore(root.b);
  const points = sanitizePointStore(root.p);
  const graphs = sanitizeGraphStore(root.g);
  const dgs = sanitizeDgsStore(root.d);
  const schar = sanitizeScharStore(root.s);
  if (root.v === 1 && regressionStoreContainsCompactHistory(root.r)) {
    return undefined;
  }
  const regression = sanitizeRegressionStore(root.r);
  if (root.v === 2) {
    const compactSource = root.r === undefined ? undefined : record(root.r);
    const compactKeys = compactSource ? Object.keys(compactSource) : [];
    if ((root.r !== undefined && !compactSource)
      || compactKeys.some(key => !safeKey(key)
        || !Object.prototype.hasOwnProperty.call(regression, key))) {
      return undefined;
    }
  }
  const pointLocks = trueLocks(record(root.q)?.o);
  const multiLocks = trueLocks(record(root.q)?.m);
  const tables = sanitizeTables(root.t);
  const plots = sanitizePlots(root.x);
  const sliders = sanitizeSliders(root.z);
  if (Object.keys(boards).length) state.b = boards;
  if (Object.keys(points).length) state.p = points;
  if (Object.keys(graphs).length) state.g = graphs;
  if (Object.keys(dgs).length) state.d = dgs;
  if (Object.keys(schar).length) state.s = schar;
  if (Object.keys(regression).length) state.r = regression;
  if (Object.keys(pointLocks).length || Object.keys(multiLocks).length) {
    state.q = {};
    if (Object.keys(pointLocks).length) state.q.o = pointLocks;
    if (Object.keys(multiLocks).length) state.q.m = multiLocks;
  }
  if (Object.keys(tables).length) state.t = tables;
  if (Object.keys(plots).length) state.x = plots;
  if (Object.keys(sliders).length) state.z = sliders;
  return freezeNormalizedCoordinateState(state);
}

/** Expand and validate either raw v1, compact v2, or the legacy board-only shape. */
export function expandCoordinateStateForRestore(
  value: unknown,
): CoordinateFrozenStateV1 | undefined {
  return decodeCoordinateState(value);
}

/**
 * Compact only at the decentralized-link boundary. The navigation accumulator
 * deliberately remains expanded so repeated captures never re-quantize paths.
 */
export function compactCoordinateStateForFreeze(value: unknown): CoordinateFrozenState {
  const state = decodeCoordinateState(value) ?? { v: 1 };
  const regression = compactRegressionStore(state.r, state.b);
  if (!regression.compacted) return state;
  const compact: CoordinateFrozenStateV2 = { ...state, v: 2 };
  if (Object.keys(regression.states).length) compact.r = regression.states;
  else delete compact.r;
  return compact;
}

export function hasCoordinateState(value: unknown): boolean {
  const state = decodeCoordinateState(value);
  if (!state) return false;
  return [state.b, state.p, state.g, state.d, state.s, state.r, state.t, state.x, state.z]
    .some(hasKeys)
    || hasKeys(state.q?.o)
    || hasKeys(state.q?.m);
}

/**
 * Merge independently captured slide runtimes by their stable template keys.
 * A later capture overwrites the same widget/board, while state from already
 * unmounted slides remains available for the final decentralized link.
 */
export function mergeCoordinateStates(...values: unknown[]): CoordinateFrozenStateV1 {
  const merged: CoordinateFrozenStateV1 = { v: 1 };
  for (const value of values) {
    const state = decodeCoordinateState(value);
    if (!state) continue;
    for (const key of ["b", "p", "g", "d", "s", "r", "t", "x", "z"] as const) {
      const source = state[key] as Record<string, unknown> | undefined;
      if (!source || !Object.keys(source).length) continue;
      const target = (merged[key] ?? Object.create(null)) as Record<string, unknown>;
      Object.assign(target, source);
      (merged as AnyRecord)[key] = target;
    }
    if (state.q?.o || state.q?.m) {
      merged.q ??= {};
      if (state.q.o) merged.q.o = Object.assign(merged.q.o ?? Object.create(null), state.q.o);
      if (state.q.m) merged.q.m = Object.assign(merged.q.m ?? Object.create(null), state.q.m);
    }
  }
  return merged;
}

function cloneRegressionJson(
  value: CoordinateJson,
  budget: CloneBudget,
  depth = 0,
): CoordinateJson {
  if (budget.nodes >= MAX_REGRESSION_CLONE_NODES || depth > MAX_DEPTH) {
    throw new Error("Coordinate Regression snapshot exceeds the clone budget.");
  }
  budget.nodes += 1;
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    // Regression model sanitizing intentionally permits coefficients up to
    // 1e15; the transactional clone must preserve every already accepted one.
    if (!Number.isFinite(value) || Math.abs(value) > 1e15) {
      throw new Error("Invalid Coordinate Regression number.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_REGRESSION_POINTS) {
      throw new Error("Coordinate Regression array exceeds the supported length.");
    }
    return value.map(item => cloneRegressionJson(item, budget, depth + 1));
  }
  const source = record(value);
  if (!source) throw new Error("Invalid Coordinate Regression object.");
  const keys = Object.keys(source);
  if (keys.length > MAX_OBJECT_KEYS || keys.some(key => !safeKey(key))) {
    throw new Error("Coordinate Regression object exceeds the supported shape.");
  }
  const result: Record<string, CoordinateJson> = Object.create(null);
  for (const key of keys) {
    result[key] = cloneRegressionJson(source[key] as CoordinateJson, budget, depth + 1);
  }
  return result;
}

function seedRegressionStore(
  runtime: CoordinateRuntime,
  source: Record<string, CoordinateJson> | undefined,
): number {
  if (!source || !Object.keys(source).length) return 0;
  try {
    const current = record(runtime.__liaRegressionSnapshots) ?? Object.create(null);
    runtime.__liaRegressionSnapshots = current;
    let applied = 0;
    for (const [key, value] of Object.entries(source)) {
      if (!safeKey(key)) continue;
      try {
        // Clone the complete, already validated Proposal snapshot or nothing.
        // The generic clone's 80k node ceiling would otherwise truncate a
        // legal 20k stroke plus Regression/AutoPoint arrays midway through.
        const cloned = cloneRegressionJson(value, { nodes: 0 });
        current[key] = cloned;
        applied += 1;
      } catch { /* never seed a partial Regression snapshot */ }
    }
    return applied;
  } catch {
    return 0;
  }
}

function seedStore(
  runtime: CoordinateRuntime,
  property: string,
  source: Record<string, unknown> | undefined,
): number {
  if (!source || !Object.keys(source).length) return 0;
  try {
    const current = record(runtime[property]) ?? Object.create(null);
    runtime[property] = current;
    let applied = 0;
    for (const [key, value] of Object.entries(source)) {
      if (!safeKey(key)) continue;
      const cloned = cloneJson(value, { nodes: 0 });
      if (cloned === undefined) continue;
      current[key] = cloned;
      applied += 1;
    }
    return applied;
  } catch {
    return 0;
  }
}

function seedRuntime(runtime: CoordinateRuntime, state: CoordinateFrozenStateV1): number {
  let applied = 0;
  applied += seedStore(runtime, "__coordBoardStates", state.b);
  applied += seedStore(runtime, "__pointStates", state.p);
  applied += seedStore(runtime, "__pointGraphStates", state.g);
  applied += seedStore(runtime, "__dgsConstructionStates", state.d);
  applied += seedStore(runtime, "__liaScharStateStore", state.s);
  applied += seedRegressionStore(runtime, state.r);
  applied += seedStore(runtime, "__pointOnGraphLocks", state.q?.o);
  applied += seedStore(runtime, "__pointsOnGraphLocks", state.q?.m);

  if (state.t) {
    const tableStore = record(runtime.__tableStates) ?? Object.create(null);
    runtime.__tableStates = tableStore;
    for (const [uid, table] of Object.entries(state.t)) {
      const existing = record(tableStore[uid]) ?? Object.create(null);
      existing.cols = table.v.length;
      existing.values = table.v.map(value => ({ x: value.x, y: value.y }));
      if (table.w) existing.cellWidths = { ...table.w };
      tableStore[uid] = existing;
      applied += 1;
    }
  }
  if (state.x) {
    const plotStore = record(runtime.__plotInputStates) ?? Object.create(null);
    runtime.__plotInputStates = plotStore;
    for (const [uid, plot] of Object.entries(state.x)) {
      const existing = record(plotStore[uid]) ?? Object.create(null);
      existing.raw = plot.r;
      plotStore[uid] = existing;
      applied += 1;
    }
  }
  return applied;
}

interface RuntimeMemory {
  initialized: boolean;
  coordApi?: unknown;
  boards: Map<string, unknown>;
  restoredBoards: Map<string, { board: unknown; signature: string }>;
  dgsBoards: Map<string, unknown>;
  tables: Map<string, {
    live: unknown;
    root: unknown;
    board: unknown;
    pointPrefix?: string;
    signature: string;
    pointsComplete: boolean;
  }>;
  sliders: Map<string, { board: unknown; slider: unknown; signature: string }>;
  regressionBoards: Map<string, { board: unknown; revision: number; signature: string }>;
  plotted: Map<string, { board: unknown; signature: string }>;
  nudgedBoards: Map<string, { board: unknown; count: number }>;
}

const runtimeMemories = new WeakMap<object, RuntimeMemory>();

function memoryFor(runtime: CoordinateRuntime): RuntimeMemory {
  const key = runtime as object;
  let memory = runtimeMemories.get(key);
  if (!memory) {
    memory = {
      initialized: false,
      boards: new Map(),
      restoredBoards: new Map(),
      dgsBoards: new Map(),
      tables: new Map(),
      sliders: new Map(),
      regressionBoards: new Map(),
      plotted: new Map(),
      nudgedBoards: new Map(),
    };
    runtimeMemories.set(key, memory);
  }
  return memory;
}

function discoverNewMount(runtime: CoordinateRuntime, memory: RuntimeMemory): boolean {
  let changed = !memory.initialized || memory.coordApi !== runtime.__coord;
  memory.initialized = true;
  memory.coordApi = runtime.__coord;
  for (const [boardId, board] of Object.entries(runtime.__boards ?? {})) {
    if (!safeKey(boardId) || !board || board.containerObj?.isConnected === false) continue;
    if (memory.boards.get(boardId) !== board) {
      memory.boards.set(boardId, board);
      changed = true;
    }
  }
  // Proposal's external bootstrap list is a board-replacement operation. Do
  // not repeat it merely because anchors arrive incrementally on the same
  // board: that can leave stale JSXGraph children until the next remount.
  // Individual subsystems observe their own anchors; Regression and DGS also
  // receive the explicit late scans above.
  return changed;
}

function call(callback: (() => unknown) | undefined): boolean {
  if (typeof callback !== "function") return false;
  try { callback(); return true; } catch { return false; }
}

function withCoordinateRestoreFlag<T>(runtime: CoordinateRuntime, callback: () => T): T {
  const previous = runtime.__liaFreezeCoordinateRestoreActive;
  runtime.__liaFreezeCoordinateRestoreActive = true;
  try {
    return callback();
  } finally {
    if (previous === undefined) {
      try { delete runtime.__liaFreezeCoordinateRestoreActive; } catch { /* Window may be exotic */ }
    } else {
      runtime.__liaFreezeCoordinateRestoreActive = previous;
    }
  }
}

/**
 * Retries only the two idempotent Proposal anchor scans that can otherwise
 * miss late LiaScript DOM. The complete external list would reset sliders;
 * Schar's bootstrap would also reset its panel scale.
 */
export function refreshCoordinateLateMounts(runtimes: CoordinateRuntime[]): number {
  let refreshed = 0;
  for (const runtime of runtimes) {
    if (!runtime) continue;
    if (
      typeof runtime.__bootstrapRegression === "function"
      && call(() => withCoordinateRestoreFlag(runtime, () => runtime.__bootstrapRegression?.()))
    ) refreshed += 1;
    if (
      typeof runtime.__bootstrapDGS === "function"
      && call(() => withCoordinateRestoreFlag(runtime, () => runtime.__bootstrapDGS?.()))
    ) refreshed += 1;
  }
  return refreshed;
}

function bootstrapRuntime(runtime: CoordinateRuntime, changed: boolean): void {
  if (!changed) return;
  const externalBootstrap = runtime.__coord?.runExternalBootstraps;
  if (!(
    typeof externalBootstrap === "function"
    && call(() => withCoordinateRestoreFlag(runtime, () => externalBootstrap.call(runtime.__coord)))
  )) {
    call(() => runtime.__bootstrapPlotInputs?.());
    call(() => runtime.__bootstrapScharen?.());
    call(() => withCoordinateRestoreFlag(runtime, () => runtime.__bootstrapRegression?.()));
    call(() => withCoordinateRestoreFlag(runtime, () => runtime.__bootstrapDGS?.()));
  }
  // Table is intentionally not part of lia-coordinate's external-bootstrap list.
  call(() => runtime.__bootstrapTables?.());
}

function restoreBoards(
  runtime: CoordinateRuntime,
  state: CoordinateFrozenStateV1,
  memory: RuntimeMemory
): number {
  let applied = 0;
  for (const [boardId, rawState] of Object.entries(state.b ?? {})) {
    const board = runtime.__boards?.[boardId];
    const saved = record(rawState);
    if (!board || !saved || board.containerObj?.isConnected === false) continue;
    const bbox = validBBox(saved.bbox) ?? validBBox(saved.exportBBox);
    if (!bbox) continue;
    const signature = JSON.stringify(saved);
    const previous = memory.restoredBoards.get(boardId);
    if (previous?.board === board && previous.signature === signature) {
      applied += 1;
      continue;
    }
    try {
      if (runtime.__coord?.restoreSavedBoardState) {
        // Proposal returns false for the normal auto/capped-size branch even
        // though it has already applied the submitted bounding box. Treat a
        // non-throwing call as applied or every retry accumulates stale ticks.
        runtime.__coord.restoreSavedBoardState(board, bbox, boardId);
      } else {
        board.setBoundingBox?.(bbox.slice(), true);
      }
      memory.restoredBoards.set(boardId, { board, signature });
      applied += 1;
    } catch { /* isolate board */ }
  }
  return applied;
}

function restoreDgs(
  runtime: CoordinateRuntime,
  state: CoordinateFrozenStateV1,
  memory: RuntimeMemory
): number {
  if (typeof runtime.__applyDgsHistory !== "function") return 0;
  let applied = 0;
  for (const [boardId, snapshot] of Object.entries(state.d ?? {})) {
    const board = runtime.__boards?.[boardId];
    if (!board || board.containerObj?.isConnected === false) continue;
    const runtimeAppliedBoard = runtime.__dgsConstructionBoards?.[boardId];
    if (memory.dgsBoards.get(boardId) === board && runtimeAppliedBoard === board) continue;
    try {
      runtime.__applyDgsHistory(boardId, snapshot);
      if (runtime.__dgsConstructionBoards?.[boardId] === board) {
        memory.dgsBoards.set(boardId, board);
      }
      applied += 1;
    } catch { /* template may still be mounting */ }
  }
  return applied;
}

function restoreTables(
  runtime: CoordinateRuntime,
  state: CoordinateFrozenStateV1,
  memory: RuntimeMemory
): number {
  let applied = 0;
  for (const [uid, saved] of Object.entries(state.t ?? {})) {
    const signature = JSON.stringify(saved);
    const liveBefore = record(runtime.__tableStates?.[uid]);
    const rootBefore = runtime.document?.getElementById("lia-table-" + uid) as HTMLElement | null;
    const boardIdBefore = safeString(liveBefore?.boardId, MAX_KEY_LENGTH);
    const pointPrefixBefore = safeString(liveBefore?.pointPrefix, 300);
    const boardBefore = boardIdBefore && runtime.__boards?.[boardIdBefore];
    const previous = memory.tables.get(uid);
    const sameMount = !!(
      liveBefore
      && rootBefore
      && rootBefore.isConnected !== false
      && previous?.live === liveBefore
      && previous.root === rootBefore
      && previous.board === boardBefore
      && previous.pointPrefix === pointPrefixBefore
      && previous.signature === signature
    );
    if (sameMount && previous?.pointsComplete) {
      applied += 1;
      continue;
    }
    try {
      if (!sameMount && runtime.setTableValues?.(uid, saved.v)) applied += 1;
      const live = record(runtime.__tableStates?.[uid]);
      if (!sameMount && live && saved.w) {
        live.cellWidths = { ...saved.w };
        const root = runtime.document?.getElementById("lia-table-" + uid) as HTMLElement | null;
        if (root && runtime.renderTableFromSpec) {
          runtime.renderTableFromSpec(uid, root.dataset.spec || String(live.spec || ""), true);
        }
      }
      const current = record(runtime.__tableStates?.[uid]);
      const boardId = safeString(current?.boardId, MAX_KEY_LENGTH);
      const pointPrefix = safeString(current?.pointPrefix, 300);
      const board = boardId && runtime.__boards?.[boardId];
      const savedPoints = boardId && record(state.p?.[boardId]);
      const fixedPointNames: string[] = [];
      if (boardId && pointPrefix && savedPoints && !/[;\r\n]/.test(boardId) && !/[;\r\n]/.test(pointPrefix)) {
        for (let columnIndex = 0; columnIndex < saved.v.length; columnIndex += 1) {
          const pointName = tablePointName(pointPrefix, columnIndex);
          if (!safeKey(pointName) || /[;\r\n]/.test(pointName)) continue;
          const point = record(savedPoints[pointName]);
          const x = rounded(point?.x);
          const y = rounded(point?.y);
          if (x === undefined || y === undefined || !booleanValue(point?.fixed)) continue;
          fixedPointNames.push(pointName);
        }
      }
      let pointsComplete = fixedPointNames.length === 0;
      if (fixedPointNames.length) {
        pointsComplete = !!board
          && board.containerObj?.isConnected !== false
          && typeof runtime.restorePointFromSpec === "function";
        if (pointsComplete) {
          for (const pointName of fixedPointNames) {
            if (runtime.restorePointFromSpec?.(`${boardId};${pointName}`)) applied += 1;
            else pointsComplete = false;
          }
        }
      }
      const mounted = record(runtime.__tableStates?.[uid]);
      const mountedRoot = runtime.document?.getElementById("lia-table-" + uid) as HTMLElement | null;
      if (mounted && mountedRoot && mountedRoot.isConnected !== false) {
        const mountedBoardId = safeString(mounted.boardId, MAX_KEY_LENGTH);
        memory.tables.set(uid, {
          live: mounted,
          root: mountedRoot,
          board: mountedBoardId && runtime.__boards?.[mountedBoardId],
          pointPrefix: safeString(mounted.pointPrefix, 300),
          signature,
          pointsComplete,
        });
      }
    } catch { /* delayed table */ }
  }
  return applied;
}

function movePoint(point: AnyRecord | undefined, position: { x: number; y: number }): void {
  if (!point) return;
  try {
    if (typeof point.moveTo === "function") point.moveTo([position.x, position.y], 0);
  } catch { /* position is optional */ }
}

function sliderMatchesSavedState(
  slider: AnyRecord,
  saved: CoordinateSliderStateV1,
  restoredValue: number
): boolean {
  let currentValue: number | undefined;
  try {
    currentValue = rounded(
      typeof slider.Value === "function" ? slider.Value() : slider.__liaDgsSliderValue
    );
  } catch { return false; }
  if (currentValue !== rounded(restoredValue)) return false;
  if (!saved.p) return true;
  const first = pointPosition(record(slider.point1));
  const second = pointPosition(record(slider.point2));
  return !!first && !!second
    && first.x === saved.p[0].x && first.y === saved.p[0].y
    && second.x === saved.p[1].x && second.y === saved.p[1].y;
}

function restoreSliders(
  runtime: CoordinateRuntime,
  state: CoordinateFrozenStateV1,
  memory: RuntimeMemory
): number {
  let applied = 0;
  const entries = runtime.__sliderEntries ?? {};
  for (const [key, saved] of Object.entries(state.z ?? {})) {
    const matchesSavedIdentity = (candidate: AnyRecord | undefined): candidate is AnyRecord =>
      candidate?.uid === saved.u
      && candidate?.boardId === saved.b
      && candidate?.name === saved.n;
    const direct = record(entries[key]);
    const entry = matchesSavedIdentity(direct)
      ? direct
      : Object.values(entries).slice(0, MAX_COORDINATE_WIDGETS).map(record).find(matchesSavedIdentity);
    const board = runtime.__boards?.[saved.b];
    const slider = record(entry?.slider);
    if (!entry || !board || !slider || slider.board !== board) continue;
    const minimum = finite(entry.minimum) ?? finite(slider.__liaDgsSliderMinimum);
    const maximum = finite(entry.maximum) ?? finite(slider.__liaDgsSliderMaximum);
    if (
      minimum === undefined
      || maximum === undefined
      || Math.abs(minimum) > MAX_ABSOLUTE_NUMBER
      || Math.abs(maximum) > MAX_ABSOLUTE_NUMBER
      || maximum <= minimum
    ) continue;
    const restoredValue = Math.max(minimum, Math.min(maximum, saved.v));
    const signature = JSON.stringify(saved);
    const previous = memory.sliders.get(key);
    if (
      previous?.board === board
      && previous.slider === slider
      && previous.signature === signature
      && sliderMatchesSavedState(slider, saved, restoredValue)
    ) {
      applied += 1;
      continue;
    }
    try {
      slider.setValue?.(restoredValue);
      slider.__liaDgsSliderValue = restoredValue;
      if (saved.p) {
        movePoint(record(slider.point1), saved.p[0]);
        movePoint(record(slider.point2), saved.p[1]);
      }
      board.update?.();
      runtime.__bootstrapPlotFunctions?.();
      runtime.__scheduleFunctionAnalysisPointsForBoard?.(saved.b);
      runtime.__scheduleObjectAnalysisPointsForBoard?.(saved.b);
      memory.sliders.set(key, { board, slider, signature });
      applied += 1;
    } catch { /* stale slider */ }
  }
  return applied;
}

function restorePlots(
  runtime: CoordinateRuntime,
  state: CoordinateFrozenStateV1,
  memory: RuntimeMemory
): number {
  let applied = 0;
  for (const [uid, saved] of Object.entries(state.x ?? {})) {
    const live = record(runtime.__plotInputStates?.[uid]);
    if (!live) continue;
    live.raw = saved.r;
    const input = record(runtime.__plotInputInstances?.[uid])?.input as HTMLInputElement | undefined;
    try { if (input) input.value = saved.r; } catch { /* another realm */ }
    if (!saved.p || !safeMathExpression(saved.r, true)) {
      applied += 1;
      continue;
    }
    const boardId = safeString(live.boardId, MAX_KEY_LENGTH);
    const board = boardId && runtime.__boards?.[boardId];
    if (!board || board.containerObj?.isConnected === false || !runtime.__plotInput?.plotIntoBoard) continue;
    const signature = boardId + "\u0000" + saved.r;
    const previous = memory.plotted.get(uid);
    if (previous?.board === board && previous.signature === signature && live.graph) {
      applied += 1;
      continue;
    }
    try {
      runtime.__plotInput.plotIntoBoard(board, live, saved.r);
      memory.plotted.set(uid, { board, signature });
      applied += 1;
    } catch { /* invalid/late expression remains visible as input */ }
  }
  return applied;
}

function restoreScharPanels(runtime: CoordinateRuntime, state: CoordinateFrozenStateV1): number {
  let applied = 0;
  const entries = runtime.__scharEntries ?? {};
  for (const [storeKey, raw] of Object.entries(state.s ?? {})) {
    const saved = record(raw);
    if (!saved) continue;
    const separator = storeKey.indexOf("::");
    const uid = separator >= 0 ? storeKey.slice(0, separator) : storeKey;
    const boardId = separator >= 0 ? storeKey.slice(separator + 2) : "";
    const entry = Object.values(entries).map(record).find(candidate =>
      candidate?.uid === uid && (!boardId || candidate?.boardId === boardId)
    );
    if (!entry) continue;
    const scale = Math.max(0.55, Math.min(1.45, finite(saved.panelScale) ?? 0.55));
    entry.panelScale = scale;
    try {
      if (entry.panel?.style) {
        entry.panel.style.transformOrigin = "top left";
        entry.panel.style.transform = "scale(" + scale + ")";
      }
      applied += 1;
    } catch { /* styling remains template-owned */ }
  }
  return applied;
}

const REGRESSION_ANALYSIS_ENTRY_KEYS = [
  "analysisEntries", "quadraticAnalysisEntries", "cubicAnalysisEntries",
  "quarticAnalysisEntries", "sinAnalysisEntries", "expAnalysisEntries",
  "logAnalysisEntries", "sqrtAnalysisEntries", "hyperbolaAnalysisEntries",
  "hyperbola2AnalysisEntries",
];

function regressionSnapshotHydrated(live: AnyRecord, snapshot: AnyRecord): boolean {
  const saved = Array.isArray(snapshot.analyses) ? snapshot.analyses.map(record).filter(Boolean) : [];
  const entries: AnyRecord[] = [];
  for (const key of REGRESSION_ANALYSIS_ENTRY_KEYS) {
    const group = Array.isArray(live[key]) ? live[key] : [];
    group.map(record).filter(Boolean).forEach(entry => entries.push(entry!));
  }
  if (entries.length !== saved.length) return false;
  const unmatched = entries.slice();
  for (const analysis of saved) {
    const id = safeString(analysis?.id, 300) ?? "";
    const classKey = safeString(analysis?.classKey, 40);
    const index = unmatched.findIndex(entry =>
      (id ? String(entry.id || "") === id : true)
      && (!classKey || String(entry.classKey || "") === classKey)
    );
    if (index < 0) return false;
    const entry = unmatched.splice(index, 1)[0];
    if (panelMinimized(entry.panel) !== booleanValue(analysis?.minimized)) return false;
  }
  return true;
}

function restoreRegression(
  runtime: CoordinateRuntime,
  state: CoordinateFrozenStateV1,
  memory: RuntimeMemory
): number {
  let applied = 0;
  const snapshots = runtime.__liaRegressionSnapshots;
  if (!snapshots) return 0;
  for (const [key, rawSnapshot] of Object.entries(state.r ?? {})) {
    const snapshot = record(rawSnapshot);
    if (!snapshot) continue;
    const boardId = safeString(snapshot?.boardId, MAX_KEY_LENGTH);
    const board = boardId && runtime.__boards?.[boardId];
    if (!boardId || !board || board.containerObj?.isConnected === false) continue;
    const live = Object.values(runtime.__liaRegressionStates ?? {}).map(record).find(candidate =>
      candidate?.boardId === boardId && candidate?.board === board
    );
    const revision = finite(snapshot.revision) ?? 1;
    const signature = JSON.stringify(snapshot);
    const previous = memory.regressionBoards.get(boardId);
    if (
      live
      && Number(live.restoredSnapshotRevision) === revision
      && regressionSnapshotHydrated(live, snapshot)
      && (!previous || previous.board !== board || previous.signature === signature)
    ) {
      memory.regressionBoards.set(boardId, { board, revision, signature });
      applied += 1;
      continue;
    }
    if (!live) continue;

    // Proposal has no late apply API. Recreate only the template's own
    // regression controls, while temporarily making its snapshot property
    // read-only so disposeRegressionState cannot overwrite the submitted data.
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(snapshots, key);
      Object.defineProperty(snapshots, key, {
        value: snapshot,
        writable: false,
        enumerable: true,
        configurable: true,
      });
      withCoordinateRestoreFlag(runtime, () => {
        live.drawLayer?.remove?.();
        runtime.__bootstrapRegression?.();
        runtime.__bootstrapDGS?.();
      });
    } catch { /* retain pre-seeded snapshot for the next remount */ }
    finally {
      try {
        Object.defineProperty(snapshots, key, descriptor ?? {
          value: snapshot,
          writable: true,
          enumerable: true,
          configurable: true,
        });
        snapshots[key] = snapshot;
      } catch { /* plain store expected */ }
    }
    const restored = Object.values(runtime.__liaRegressionStates ?? {}).map(record).find(candidate =>
      candidate?.boardId === boardId && candidate?.board === board
        && Number(candidate?.restoredSnapshotRevision) === revision
    );
    if (restored && regressionSnapshotHydrated(restored, snapshot)) {
      memory.regressionBoards.set(boardId, { board, revision, signature });
    }
    applied += 1;
  }
  return applied;
}

function nudgeBoards(runtime: CoordinateRuntime, memory: RuntimeMemory): void {
  for (const [boardId, board] of Object.entries(runtime.__boards ?? {})) {
    if (!board || board.containerObj?.isConnected === false) continue;
    const previous = memory.nudgedBoards.get(boardId);
    const count = previous?.board === board ? previous.count : 0;
    if (count >= 2) continue;
    try {
      board.update?.();
      memory.nudgedBoards.set(boardId, { board, count: count + 1 });
    } catch { /* isolate board */ }
  }
}

/**
 * Seeds every supplied same-origin runtime so delayed template initialization
 * reuses the frozen stores, then hydrates currently mounted boards/widgets.
 * Repeated calls are intentional and idempotent; new slide mounts are detected
 * by board and anchor identity.
 */
export function restoreCoordinateStates(
  runtimes: CoordinateRuntime[],
  value: unknown
): boolean {
  const state = decodeCoordinateState(value);
  if (!state) return false;
  let seeded = 0;
  let hydrated = 0;
  for (const runtime of runtimes) {
    if (!runtime) continue;
    seeded += seedRuntime(runtime, state);
    const memory = memoryFor(runtime);
    const changed = discoverNewMount(runtime, memory);
    bootstrapRuntime(runtime, changed);
    hydrated += restoreBoards(runtime, state, memory);
    hydrated += restoreDgs(runtime, state, memory);
    hydrated += restoreTables(runtime, state, memory);
    hydrated += restoreSliders(runtime, state, memory);
    hydrated += restorePlots(runtime, state, memory);
    hydrated += restoreScharPanels(runtime, state);
    hydrated += restoreRegression(runtime, state, memory);
    // JSXGraph needs one follow-up update after restoring a bounding box so
    // stale ticks disappear. Cap this at two writes per board identity: enough
    // for the initial + follow-up render, never enough for an observer loop.
    nudgeBoards(runtime, memory);
  }
  return seeded > 0 || hydrated > 0 || !hasCoordinateState(state);
}
