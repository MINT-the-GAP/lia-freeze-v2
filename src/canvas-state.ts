// Compact, versioned projection of lia-canvas-ocr's public cvf1 freeze state.
//
// The template already crops drawings to their visible bounds. This layer
// reduces the remaining URL payload by filtering near-identical points,
// quantizing geometry, applying Douglas-Peucker, and delta-packing paths into
// either a small base36 string or a binary varint stream. The outer snapshot
// codec still owns Blob/CompressionStream gzip and the final base64url token.

export const CANVAS_COMPACT_VERSION = "cvq1";
export const CANVAS_GRID_STEP_PX = 2.25;
export const CANVAS_MIN_RAW_POINT_DISTANCE_PX = 1.25;
export const CANVAS_DOUGLAS_PEUCKER_TOLERANCE_PX = 1.4;

const CANVAS_PATH_MAGIC = 3;
const CANVAS_UID_PACK_FACTOR = 64;
const PATH_RUN_SEPARATOR = "~";
const MAX_PATH_POINTS = 200_000;
const MAX_TOTAL_DECODED_POINTS = 400_000;
const MAX_BINARY_PATH_CHARACTERS = 2_000_000;
const MAX_CANVAS_STATES = 4_096;
const MAX_DP_DISTANCE_CHECKS = 2_000_000;
const MAX_ITEMS_PER_CANVAS = 10_000;
const MAX_COLORS_PER_CANVAS = 4_096;
const MAX_CANVAS_DIMENSION_PX = 32_768;
const MAX_ABS_COORDINATE_PX = 131_072;
const MAX_STROKE_WIDTH_PX = 4_096;
const MAX_COLOR_CHARACTERS = 256;
const MAX_ENCODED_COLOR_CHARACTERS = MAX_COLOR_CHARACTERS + 2;
const DEFAULT_PEN_COLOR_PREFIX = "~d";
const ESCAPED_COLOR_PREFIX = "~~";

const ITEM_PATH = 0;
const ITEM_ERASER_PATH = 1;
const ITEM_POINT = 2;
const ITEM_ERASER_POINT = 3;
const ITEM_RECT = 4;
const ITEM_PATH_RUN = 5;
const ITEM_ERASER_PATH_RUN = 6;

const PALETTE = [
  "#ff0000",
  "#ff7500",
  "#ffff00",
  "#ff00ff",
  "#0055ff",
  "#00ffff",
  "#00ff00",
  "#007500",
  "#000000",
  "#ffffff",
] as const;

type JsonRecord = Record<string, unknown>;
type QuantizedPoint = [number, number];
type CompactItem = Array<number | string>;
type CompactBackground = 0 | [number, number, number, number, number, number];
type CollapsedStrings = 0 | string | string[];
type CollapsedItems = 0 | CompactItem | CompactItem[];
type CompactCanvasState = [
  typeof CANVAS_COMPACT_VERSION,
  string | number,
  number,
  number,
  CompactBackground,
  CollapsedStrings,
  CollapsedItems,
  (0 | 1)?,
];

type ColorTable = {
  values: string[];
  indexes: Map<string, number>;
};

type DecodeBudget = { points: number };

class CanvasStateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasStateLimitError";
  }
}

function record(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function strictFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strictInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function reserveDecodedPoints(budget: DecodeBudget, count: number): void {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_PATH_POINTS) {
    throw new Error("Canvas path point count is outside the supported range.");
  }
  if (budget.points > MAX_TOTAL_DECODED_POINTS - count) {
    throw new Error("Canvas state contains too many decoded points.");
  }
  budget.points += count;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hasOnlyKeys(value: JsonRecord, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every(key => keys.has(key));
}

function rawPoint(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = finite(value[0]);
    const y = finite(value[1]);
    return x === null || y === null ? null : [x, y];
  }
  if (record(value)) {
    const x = finite(value.x);
    const y = finite(value.y);
    return x === null || y === null ? null : [x, y];
  }
  return null;
}

function distanceSquared(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function pointSegmentDistanceSquared(
  point: QuantizedPoint,
  start: QuantizedPoint,
  end: QuantizedPoint,
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) {
    return distanceSquared(point, start);
  }
  const projection = clamp(
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
    0,
    1,
  );
  const qx = start[0] + projection * dx;
  const qy = start[1] + projection * dy;
  const qdx = point[0] - qx;
  const qdy = point[1] - qy;
  return qdx * qdx + qdy * qdy;
}

export function simplifyCanvasPointsDouglasPeucker(
  points: QuantizedPoint[],
  toleranceCells = CANVAS_DOUGLAS_PEUCKER_TOLERANCE_PX / CANVAS_GRID_STEP_PX,
): QuantizedPoint[] {
  if (points.length <= 2 || !(toleranceCells > 0)) return points.slice();

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  const toleranceSquared = toleranceCells * toleranceCells;
  let distanceChecks = 0;

  while (stack.length) {
    const [startIndex, endIndex] = stack.pop()!;
    if (endIndex <= startIndex + 1) continue;

    let maxDistanceSquared = -1;
    let maxIndex = -1;
    for (let index = startIndex + 1; index < endIndex; index++) {
      if (++distanceChecks > MAX_DP_DISTANCE_CHECKS) {
        // Quantization and the online filters have already reduced the input.
        // Keep that safe result instead of letting an adversarial zigzag path
        // monopolize the main thread with quadratic Douglas-Peucker work.
        return points.slice();
      }
      const candidate = pointSegmentDistanceSquared(
        points[index],
        points[startIndex],
        points[endIndex],
      );
      if (candidate > maxDistanceSquared) {
        maxDistanceSquared = candidate;
        maxIndex = index;
      }
    }

    if (maxIndex >= 0 && maxDistanceSquared > toleranceSquared) {
      keep[maxIndex] = 1;
      stack.push([startIndex, maxIndex], [maxIndex, endIndex]);
    }
  }

  const simplified = points.filter((_, index) => keep[index] === 1);
  return simplified.length >= 2 ? simplified : points.slice();
}

function quantizeCoordinate(value: unknown): number | null {
  const number = finite(value);
  if (number === null || Math.abs(number) > MAX_ABS_COORDINATE_PX) return null;
  const quantized = Math.round(number / CANVAS_GRID_STEP_PX);
  return Number.isSafeInteger(quantized) ? quantized : null;
}

function dequantizeCoordinate(value: unknown): number {
  const integer = strictInteger(value);
  if (integer === null) throw new Error("Invalid quantized canvas coordinate.");
  const number = integer * CANVAS_GRID_STEP_PX;
  if (Math.abs(number) > MAX_ABS_COORDINATE_PX) {
    throw new Error("Canvas coordinate exceeds the supported range.");
  }
  return number;
}

export function quantizeCanvasPathPoints(points: unknown[]): QuantizedPoint[] | null {
  if (!Array.isArray(points) || !points.length || points.length > MAX_PATH_POINTS) return null;

  const quantized: QuantizedPoint[] = [];
  const minimumDistanceSquared =
    CANVAS_MIN_RAW_POINT_DISTANCE_PX * CANVAS_MIN_RAW_POINT_DISTANCE_PX;
  let lastAcceptedRaw: [number, number] | null = null;

  for (const value of points) {
    const point = rawPoint(value);
    if (!point) return null;
    if (lastAcceptedRaw && distanceSquared(point, lastAcceptedRaw) < minimumDistanceSquared) {
      continue;
    }

    const x = quantizeCoordinate(point[0]);
    const y = quantizeCoordinate(point[1]);
    if (x === null || y === null) return null;

    const previous = quantized[quantized.length - 1];
    if (previous && previous[0] === x && previous[1] === y) continue;

    quantized.push([x, y]);
    lastAcceptedRaw = point;
  }

  if (quantized.length >= 3) {
    return simplifyCanvasPointsDouglasPeucker(quantized);
  }
  return quantized.length ? quantized : null;
}

function zigZagEncode(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error("Canvas integer is outside the safe range.");
  const encoded = value < 0 ? -value * 2 - 1 : value * 2;
  if (!Number.isSafeInteger(encoded)) throw new Error("Canvas ZigZag integer is outside the safe range.");
  return encoded;
}

function zigZagDecode(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid Canvas ZigZag integer.");
  }
  return value % 2 === 1 ? -(value + 1) / 2 : value / 2;
}

function pushVarUint(bytes: number[], input: number): void {
  let value = input;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid Canvas VarUint.");
  while (value >= 0x80) {
    bytes.push((value % 0x80) + 0x80);
    value = Math.floor(value / 0x80);
  }
  bytes.push(value);
}

function readVarUint(bytes: Uint8Array, cursor: { index: number }): number {
  let value = 0;
  let multiplier = 1;
  let steps = 0;

  while (cursor.index < bytes.length) {
    const byte = bytes[cursor.index++];
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) throw new Error("Canvas VarUint exceeds the safe range.");
    if ((byte & 0x80) === 0) return value;
    multiplier *= 0x80;
    if (!Number.isSafeInteger(multiplier) || ++steps > 8) {
      throw new Error("Canvas VarUint is implausibly long.");
    }
  }

  throw new Error("Canvas VarUint is truncated.");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...Array.from(chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(token: string): Uint8Array {
  if (!token || token.length > MAX_BINARY_PATH_CHARACTERS || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Invalid binary Canvas path token.");
  }
  let padded = token.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4 !== 0) padded += "=";
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeSignedIntegersBinary(values: number[]): string {
  const bytes: number[] = [];
  for (const value of values) pushVarUint(bytes, zigZagEncode(value));
  return bytesToBase64Url(new Uint8Array(bytes));
}

function pointDeltas(points: QuantizedPoint[]): number[] {
  const values: number[] = [];
  let previousX = 0;
  let previousY = 0;
  points.forEach((point, index) => {
    if (index === 0) values.push(point[0], point[1]);
    else values.push(point[0] - previousX, point[1] - previousY);
    previousX = point[0];
    previousY = point[1];
  });
  return values;
}

function encodePathToken(points: QuantizedPoint[]): string {
  const deltas = pointDeltas(points);
  const text = "t" + deltas.map(value => zigZagEncode(value).toString(36)).join(".");
  const binary = "b" + encodeSignedIntegersBinary([
    CANVAS_PATH_MAGIC,
    points.length,
    ...deltas,
  ]);
  return binary.length < text.length ? binary : text;
}

function decodeBinaryPathToken(token: string, budget: DecodeBudget): QuantizedPoint[] {
  const bytes = base64UrlToBytes(token);
  const cursor = { index: 0 };
  const magic = zigZagDecode(readVarUint(bytes, cursor));
  const count = zigZagDecode(readVarUint(bytes, cursor));
  if (magic !== CANVAS_PATH_MAGIC) throw new Error("Invalid binary Canvas path magic.");
  reserveDecodedPoints(budget, count);

  const points = new Array<QuantizedPoint>(count);
  let x = 0;
  let y = 0;
  for (let index = 0; index < count; index++) {
    const a = zigZagDecode(readVarUint(bytes, cursor));
    const b = zigZagDecode(readVarUint(bytes, cursor));
    if (index === 0) {
      x = a;
      y = b;
    } else {
      x += a;
      y += b;
    }
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw new Error("Canvas path coordinate exceeds the safe range.");
    }
    points[index] = [x, y];
  }
  if (cursor.index !== bytes.length) {
    throw new Error("Binary Canvas path contains trailing data.");
  }
  return points;
}

function decodeTextPathToken(token: string, budget: DecodeBudget): QuantizedPoint[] {
  if (!token || token.length > MAX_BINARY_PATH_CHARACTERS) {
    throw new Error("Invalid Canvas text path token.");
  }

  let valueCount = 1;
  for (let index = 0; index < token.length; index++) {
    const code = token.charCodeAt(index);
    if (code === 46) {
      valueCount++;
      continue;
    }
    const numeric = code >= 48 && code <= 57;
    const lowerAlpha = code >= 97 && code <= 122;
    const upperAlpha = code >= 65 && code <= 90;
    if (!numeric && !lowerAlpha && !upperAlpha) {
      throw new Error("Invalid Canvas text path integer.");
    }
  }
  if (valueCount % 2 !== 0) throw new Error("Invalid Canvas text path length.");
  const pointCount = valueCount / 2;
  reserveDecodedPoints(budget, pointCount);

  const points = new Array<QuantizedPoint>(pointCount);
  let x = 0;
  let y = 0;
  let pointIndex = 0;
  let valueIndex = 0;
  let partStart = 0;
  let deltaX = 0;
  for (let index = 0; index <= token.length; index++) {
    if (index < token.length && token.charCodeAt(index) !== 46) continue;
    if (index === partStart) throw new Error("Invalid Canvas text path integer.");
    const encoded = Number.parseInt(token.slice(partStart, index), 36);
    const delta = zigZagDecode(encoded);
    if (valueIndex % 2 === 0) {
      deltaX = delta;
    } else {
      if (pointIndex === 0) {
        x = deltaX;
        y = delta;
      } else {
        x += deltaX;
        y += delta;
      }
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
        throw new Error("Canvas path coordinate exceeds the safe range.");
      }
      points[pointIndex++] = [x, y];
    }
    valueIndex++;
    partStart = index + 1;
  }
  return points;
}

function decodePathToken(token: string, budget: DecodeBudget): Array<[number, number]> {
  if (typeof token !== "string" || token.length < 2) throw new Error("Invalid Canvas path token.");
  let quantized: QuantizedPoint[];

  if (token[0] === "b") {
    quantized = decodeBinaryPathToken(token.slice(1), budget);
  } else if (token[0] === "t") {
    quantized = decodeTextPathToken(token.slice(1), budget);
  } else {
    throw new Error("Unknown Canvas path token encoding.");
  }

  return quantized.map(point => [
    dequantizeCoordinate(point[0]),
    dequantizeCoordinate(point[1]),
  ]);
}

function encodePaletteColor(value: unknown, defaultPen = false): string {
  const raw = String(value ?? "").trim();
  if (raw.length > MAX_COLOR_CHARACTERS) throw new CanvasStateLimitError("Canvas color is too long.");
  const normalized = raw.toLowerCase().replace(/\s+/g, "");
  const paletteIndex = PALETTE.indexOf(normalized as (typeof PALETTE)[number]);
  const encoded = paletteIndex >= 0 ? paletteIndex.toString(36) : raw;
  if (defaultPen) return DEFAULT_PEN_COLOR_PREFIX + encoded;
  return encoded.startsWith("~") ? "~" + encoded : encoded;
}

function decodePaletteColor(value: string): { color: string; defaultPen: boolean } {
  let encoded = value;
  let defaultPen = false;
  if (encoded.startsWith(DEFAULT_PEN_COLOR_PREFIX)) {
    defaultPen = true;
    encoded = encoded.slice(DEFAULT_PEN_COLOR_PREFIX.length);
  } else if (encoded.startsWith(ESCAPED_COLOR_PREFIX)) {
    encoded = encoded.slice(1);
  }
  if (!encoded) return { color: "", defaultPen };
  if (/^[0-9a-z]$/i.test(encoded)) {
    const index = Number.parseInt(encoded, 36);
    if (index >= 0 && index < PALETTE.length) {
      return { color: PALETTE[index], defaultPen };
    }
  }
  return { color: encoded, defaultPen };
}

function internColor(table: ColorTable, value: unknown, defaultPen = false): number {
  const encoded = encodePaletteColor(value, defaultPen);
  const existing = table.indexes.get(encoded);
  if (existing !== undefined) return existing;
  const index = table.values.length;
  if (index >= MAX_COLORS_PER_CANVAS) {
    throw new CanvasStateLimitError("Canvas color table is too large.");
  }
  table.values.push(encoded);
  table.indexes.set(encoded, index);
  return index;
}

function readColor(
  colors: string[],
  value: unknown,
): { color: string; defaultPen: boolean } {
  const index = strictInteger(value);
  if (index === null || index < 0 || index >= colors.length) {
    throw new Error("Invalid compact Canvas color index.");
  }
  return decodePaletteColor(colors[index]);
}

function packUid(value: unknown): string | number {
  const uid = String(value ?? "").trim();
  const match = /^([1-9]\d*)_(0|[1-9]\d*)$/.exec(uid);
  if (!match) return uid;
  const slide = Number(match[1]);
  const canvas = Number(match[2]);
  if (!Number.isSafeInteger(slide) || !Number.isSafeInteger(canvas)) return uid;
  if (`${slide}_${canvas}` !== uid) return uid;
  if (slide < 1 || canvas < 0 || canvas >= CANVAS_UID_PACK_FACTOR) return uid;
  const packed = slide * CANVAS_UID_PACK_FACTOR + canvas;
  return Number.isSafeInteger(packed) ? packed : uid;
}

function unpackUid(value: unknown): string {
  if (typeof value === "string") {
    if (!value || value.length > MAX_COLOR_CHARACTERS || value.trim() !== value) {
      throw new Error("Invalid compact Canvas UID.");
    }
    return value;
  }
  const packed = strictInteger(value);
  if (packed === null || packed < CANVAS_UID_PACK_FACTOR) {
    throw new Error("Invalid packed Canvas UID.");
  }
  const slide = Math.floor(packed / CANVAS_UID_PACK_FACTOR);
  const canvas = packed % CANVAS_UID_PACK_FACTOR;
  if (slide < 1 || canvas < 0 || canvas >= CANVAS_UID_PACK_FACTOR) {
    throw new Error("Invalid packed Canvas UID.");
  }
  return `${slide}_${canvas}`;
}

function encodeBackground(value: unknown, colors: ColorTable): CompactBackground | null {
  const background = value === undefined ? { m: "none" } : value;
  if (!record(background) || !hasOnlyKeys(background, ["m", "s", "ox", "oy", "c", "lw"])) {
    return null;
  }
  const mode = String(background.m ?? "none");
  if (mode === "none") return 0;
  if (mode !== "grid" && mode !== "lined") return null;

  const step = finite(background.s);
  const offsetX = finite(background.ox);
  const offsetY = finite(background.oy);
  const lineWidth = finite(background.lw);
  if (step === null || offsetX === null || offsetY === null || lineWidth === null
    || step <= 0 || lineWidth < 0) {
    return null;
  }
  if (step > MAX_CANVAS_DIMENSION_PX
    || Math.abs(offsetX) > MAX_ABS_COORDINATE_PX
    || Math.abs(offsetY) > MAX_ABS_COORDINATE_PX
    || lineWidth > MAX_STROKE_WIDTH_PX) {
    throw new CanvasStateLimitError("Canvas background exceeds the supported range.");
  }
  return [
    mode === "grid" ? 1 : 2,
    Math.round(step * 100),
    Math.round(offsetX * 100),
    Math.round(offsetY * 100),
    internColor(colors, background.c ?? ""),
    Math.round(lineWidth * 1000),
  ];
}

function decodeBackground(value: CompactBackground, colors: string[]): JsonRecord {
  if (value === 0) return { m: "none" };
  if (!Array.isArray(value) || value.length !== 6 || (value[0] !== 1 && value[0] !== 2)) {
    throw new Error("Invalid compact Canvas background.");
  }
  const step = strictInteger(value[1]);
  const offsetX = strictInteger(value[2]);
  const offsetY = strictInteger(value[3]);
  const lineWidth = strictInteger(value[5]);
  if (step === null || step <= 0 || step > MAX_CANVAS_DIMENSION_PX * 100
    || offsetX === null || Math.abs(offsetX) > MAX_ABS_COORDINATE_PX * 100
    || offsetY === null || Math.abs(offsetY) > MAX_ABS_COORDINATE_PX * 100
    || lineWidth === null || lineWidth < 0 || lineWidth > MAX_STROKE_WIDTH_PX * 1000) {
    throw new Error("Compact Canvas background values are outside the supported range.");
  }
  const color = readColor(colors, value[4]);
  if (color.defaultPen) throw new Error("Canvas background cannot use a pen-theme color.");
  return {
    m: value[0] === 1 ? "grid" : "lined",
    s: step / 100,
    ox: offsetX / 100,
    oy: offsetY / 100,
    c: color.color,
    lw: lineWidth / 1000,
  };
}

function pathTuple(
  type: number,
  color: number,
  width: number,
  alpha: number,
  token: string,
): CompactItem {
  return alpha === 1000
    ? [type, color, width, token]
    : [type, color, width, alpha, token];
}

function pointTuple(
  type: number,
  color: number,
  width: number,
  alpha: number,
  point: QuantizedPoint,
): CompactItem {
  return alpha === 1000
    ? [type, color, width, point[0], point[1]]
    : [type, color, width, alpha, point[0], point[1]];
}

function compactItem(
  value: unknown,
  colors: ColorTable,
): { item: CompactItem; points: number } | null {
  if (!record(value)) return null;
  const kind = String(value.k ?? "");

  if (kind === "p" || kind === "e") {
    if (!hasOnlyKeys(value, ["k", "c", "a", "w", "p", "ck"])
      || !Array.isArray(value.p)
      || (value.ck !== undefined && value.ck !== "default")) return null;
    if (value.p.length > MAX_PATH_POINTS) {
      throw new CanvasStateLimitError("Canvas path contains too many points.");
    }
    for (const rawPointValue of value.p) {
      const point = rawPoint(rawPointValue);
      if (point && (Math.abs(point[0]) > MAX_ABS_COORDINATE_PX
        || Math.abs(point[1]) > MAX_ABS_COORDINATE_PX)) {
        throw new CanvasStateLimitError("Canvas path coordinate exceeds the supported range.");
      }
    }
    const points = quantizeCanvasPathPoints(value.p);
    if (!points?.length) return null;
    const widthValue = finite(value.w ?? 1);
    const alphaValue = finite(value.a ?? 1);
    if (widthValue !== null && widthValue > MAX_STROKE_WIDTH_PX) {
      throw new CanvasStateLimitError("Canvas stroke width exceeds the supported range.");
    }
    if (widthValue === null || alphaValue === null || widthValue < 0) return null;
    const color = internColor(colors, value.c ?? "#000000", value.ck === "default");
    const width = Math.round(widthValue * 100);
    const alpha = Math.round(clamp(alphaValue, 0, 1) * 1000);
    const eraser = kind === "e";

    if (points.length === 1) {
      return {
        item: pointTuple(eraser ? ITEM_ERASER_POINT : ITEM_POINT, color, width, alpha, points[0]),
        points: 1,
      };
    }
    return {
      item: pathTuple(
        eraser ? ITEM_ERASER_PATH : ITEM_PATH,
        color,
        width,
        alpha,
        encodePathToken(points),
      ),
      points: points.length,
    };
  }

  if (kind === "r") {
    if (!hasOnlyKeys(value, ["k", "f", "x", "y", "w", "h"])) return null;
    for (const coordinate of [value.x, value.y, value.w, value.h]) {
      const number = finite(coordinate);
      if (number !== null && Math.abs(number) > MAX_ABS_COORDINATE_PX) {
        throw new CanvasStateLimitError("Canvas rectangle exceeds the supported coordinate range.");
      }
    }
    const x = quantizeCoordinate(value.x);
    const y = quantizeCoordinate(value.y);
    const width = quantizeCoordinate(value.w);
    const height = quantizeCoordinate(value.h);
    if (x === null || y === null || width === null || height === null) return null;
    return {
      item: [ITEM_RECT, internColor(colors, value.f ?? "rgba(0,0,0,0)"), x, y, width, height],
      points: 0,
    };
  }

  return null;
}

function pathMeta(item: CompactItem): {
  type: number;
  color: number;
  width: number;
  alpha: number;
  token: string;
} | null {
  const type = Number(item[0]);
  if (type !== ITEM_PATH && type !== ITEM_ERASER_PATH) return null;
  if (item.length === 4 && typeof item[3] === "string") {
    return { type, color: Number(item[1]), width: Number(item[2]), alpha: 1000, token: item[3] };
  }
  if (item.length === 5 && typeof item[4] === "string") {
    return {
      type,
      color: Number(item[1]),
      width: Number(item[2]),
      alpha: Number(item[3]),
      token: item[4],
    };
  }
  return null;
}

function packPathRuns(items: CompactItem[]): CompactItem[] {
  const output: CompactItem[] = [];
  let current: ReturnType<typeof pathMeta> = null;
  let tokens: string[] = [];

  const flush = (): void => {
    if (!current) return;
    if (tokens.length === 1) {
      output.push(pathTuple(current.type, current.color, current.width, current.alpha, tokens[0]));
    } else {
      output.push(pathTuple(
        current.type === ITEM_ERASER_PATH ? ITEM_ERASER_PATH_RUN : ITEM_PATH_RUN,
        current.color,
        current.width,
        current.alpha,
        tokens.join(PATH_RUN_SEPARATOR),
      ));
    }
    current = null;
    tokens = [];
  };

  for (const item of items) {
    const meta = pathMeta(item);
    if (!meta) {
      flush();
      output.push(item);
      continue;
    }
    const same = !!current
      && current.type === meta.type
      && current.color === meta.color
      && current.width === meta.width
      && current.alpha === meta.alpha;
    if (!same) {
      flush();
      current = meta;
    }
    tokens.push(meta.token);
  }
  flush();
  return output;
}

function collapseStrings(values: string[]): CollapsedStrings {
  if (!values.length) return 0;
  return values.length === 1 ? values[0] : values;
}

function collapseItems(values: CompactItem[]): CollapsedItems {
  if (!values.length) return 0;
  return values.length === 1 ? values[0] : values;
}

function expandStrings(value: unknown): string[] {
  if (value === 0) return [];
  if (typeof value === "string") {
    if (value.length > MAX_ENCODED_COLOR_CHARACTERS) {
      throw new Error("Canvas color is too long.");
    }
    return [value];
  }
  if (Array.isArray(value) && value.every(entry => typeof entry === "string")) {
    if (value.length > MAX_COLORS_PER_CANVAS
      || value.some(entry => String(entry).length > MAX_ENCODED_COLOR_CHARACTERS)) {
      throw new Error("Canvas color table is outside the supported range.");
    }
    return value.slice() as string[];
  }
  throw new Error("Invalid compact Canvas color table.");
}

function expandItems(value: unknown): CompactItem[] {
  if (value === 0) return [];
  if (!Array.isArray(value)) throw new Error("Invalid compact Canvas item list.");
  if (!value.length) return [];
  if (Array.isArray(value[0])) {
    if (value.length > MAX_ITEMS_PER_CANVAS || !value.every(Array.isArray)) {
      throw new Error("Canvas item list is outside the supported range.");
    }
    return value as CompactItem[];
  }
  return [value as CompactItem];
}

export function canvasDimensionsCoverContent(
  width: number,
  height: number,
  items: unknown[]
): { width: number; height: number } {
  let maxX = Math.max(0, width);
  let maxY = Math.max(0, height);
  for (const item of items) {
    if (!record(item)) continue;
    const stroke = Math.max(0, finite(item.w) ?? 0) / 2;
    if (Array.isArray(item.p)) {
      for (const point of item.p) {
        if (!Array.isArray(point) || point.length < 2) continue;
        const x = finite(point[0]);
        const y = finite(point[1]);
        if (x !== null) maxX = Math.max(maxX, x + stroke);
        if (y !== null) maxY = Math.max(maxY, y + stroke);
      }
    }
    if (item.k === 'r') {
      const x = finite(item.x);
      const y = finite(item.y);
      const rectWidth = finite(item.w);
      const rectHeight = finite(item.h);
      if (x !== null && rectWidth !== null) maxX = Math.max(maxX, x + rectWidth);
      if (y !== null && rectHeight !== null) maxY = Math.max(maxY, y + rectHeight);
    }
  }
  return {
    width: Math.ceil(maxX),
    height: Math.ceil(maxY),
  };
}


export interface FullCanvasViewport {
  width?: unknown;
  height?: unknown;
}

function firstCanvasDimension(...values: unknown[]): number | null {
  for (const value of values) {
    const number = finite(value);
    if (number !== null && number > 0 && number <= MAX_CANVAS_DIMENSION_PX) {
      return number;
    }
  }
  return null;
}

function fullCanvasRgba(value: unknown, alpha: number): string {
  const color = typeof value === "string" ? value.trim() : "";
  const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  const longHex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (shortHex) {
    const rgb = shortHex.slice(1).map(part => Number.parseInt(part + part, 16));
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
  }
  if (longHex) {
    const rgb = longHex.slice(1).map(part => Number.parseInt(part, 16));
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
  if (rgb) {
    return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})`;
  }
  return color || `rgba(20,115,117,${alpha})`;
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * Rebuilds lia-canvas-ocr's public cvf1 state from its public store entry.
 *
 * The template export intentionally crops to painted pixels. Freeze needs the
 * authored/resized viewport as well, otherwise a stroke near the bottom of a
 * tall canvas is restored at the top of a short crop. This projection keeps
 * the full viewport, current pan/zoom and every known drawing item. Content
 * outside the viewport expands the state instead of being clipped.
 */
export function buildFullCanvasFreezeState(
  rawState: unknown,
  uidValue: unknown,
  storeEntry: unknown,
  viewport: FullCanvasViewport = {},
): unknown | null {
  const raw = record(rawState) ? rawState : undefined;
  const entry = record(storeEntry) ? storeEntry : undefined;
  const view = entry && record(entry.VIEW) ? entry.VIEW : undefined;
  const uid = String(uidValue ?? raw?.u ?? "").trim();
  if (!entry || !view || !uid || uid.length > MAX_COLOR_CHARACTERS) return null;

  const scale = strictFinite(view.scale);
  const panX = strictFinite(view.panX);
  const panY = strictFinite(view.panY);
  if (
    scale === null || scale <= 0 || scale > 1_000
    || panX === null || panY === null
    || Math.abs(panX) > MAX_ABS_COORDINATE_PX
    || Math.abs(panY) > MAX_ABS_COORDINATE_PX
  ) {
    return null;
  }

  const width = firstCanvasDimension(viewport.width, entry.wrapW, raw?.w);
  const height = firstCanvasDimension(viewport.height, entry.canvasH, raw?.h);
  if (width === null || height === null || !Array.isArray(entry.ITEMS)) return null;
  if (entry.ITEMS.length > MAX_ITEMS_PER_CANVAS) return null;

  const items: JsonRecord[] = [];
  let minX = 0;
  let minY = 0;
  let maxX = width;
  let maxY = height;
  let pointCount = 0;

  const includeBounds = (x: number, y: number, radius = 0): void => {
    minX = Math.min(minX, x - radius);
    minY = Math.min(minY, y - radius);
    maxX = Math.max(maxX, x + radius);
    maxY = Math.max(maxY, y + radius);
  };
  const screenPoint = (value: unknown): [number, number] | null => {
    const point = rawPoint(value);
    if (!point) return null;
    const x = point[0] * scale + panX;
    const y = point[1] * scale + panY;
    if (
      !Number.isFinite(x) || !Number.isFinite(y)
      || Math.abs(x) > MAX_ABS_COORDINATE_PX
      || Math.abs(y) > MAX_ABS_COORDINATE_PX
    ) {
      return null;
    }
    return [x, y];
  };

  for (const value of entry.ITEMS) {
    if (!record(value)) return null;
    if (value.kind === "path") {
      if (!Array.isArray(value.points) || !value.points.length) continue;
      if (value.points.length > MAX_PATH_POINTS) return null;
      pointCount += value.points.length;
      if (pointCount > MAX_TOTAL_DECODED_POINTS) return null;

      const points: Array<[number, number]> = [];
      for (const pointValue of value.points) {
        const point = screenPoint(pointValue);
        if (!point) return null;
        points.push(point);
      }
      const rawWidth = strictFinite(value.width);
      const rawAlpha = value.alpha === undefined ? 1 : strictFinite(value.alpha);
      const color = typeof value.color === "string" ? value.color : "";
      if (
        rawWidth === null || rawWidth < 0 || rawWidth > MAX_STROKE_WIDTH_PX
        || rawAlpha === null || rawAlpha < 0 || rawAlpha > 1
        || !safeCanvasColor(color)
        || (value.tool !== "pen" && value.tool !== "eraser")
      ) {
        return null;
      }
      const strokeWidth = Math.max(0.75, rawWidth * scale);
      points.forEach(point => includeBounds(point[0], point[1], strokeWidth / 2));
      items.push({
        k: value.tool === "eraser" ? "e" : "p",
        c: color,
        a: rawAlpha,
        w: strokeWidth,
        p: points,
      });
      continue;
    }

    if (value.kind === "rect") {
      const start = screenPoint({ x: value.x0, y: value.y0 });
      const end = screenPoint({ x: value.x1, y: value.y1 });
      const alpha = value.alpha === undefined ? 0.28 : strictFinite(value.alpha);
      if (!start || !end || alpha === null || alpha < 0 || alpha > 1) return null;
      if (value.color !== undefined && !safeCanvasColor(value.color)) return null;
      const x = Math.min(start[0], end[0]);
      const y = Math.min(start[1], end[1]);
      const rectWidth = Math.abs(end[0] - start[0]);
      const rectHeight = Math.abs(end[1] - start[1]);
      includeBounds(x, y);
      includeBounds(x + rectWidth, y + rectHeight);
      items.push({
        k: "r",
        f: fullCanvasRgba(value.color, alpha),
        x,
        y,
        w: rectWidth,
        h: rectHeight,
      });
      continue;
    }

    // A future template item may need semantics this bridge does not know.
    return null;
  }

  const shiftX = minX < 0 ? -minX : 0;
  const shiftY = minY < 0 ? -minY : 0;
  const fullWidth = Math.ceil(maxX + shiftX);
  const fullHeight = Math.ceil(maxY + shiftY);
  if (
    fullWidth < 1 || fullHeight < 1
    || fullWidth > MAX_CANVAS_DIMENSION_PX
    || fullHeight > MAX_CANVAS_DIMENSION_PX
  ) {
    return null;
  }

  const shiftedItems = items.map(item => {
    if (item.k === "r") {
      return {
        ...item,
        x: Number(item.x) + shiftX,
        y: Number(item.y) + shiftY,
      };
    }
    return {
      ...item,
      p: (item.p as Array<[number, number]>).map(point => [
        point[0] + shiftX,
        point[1] + shiftY,
      ]),
    };
  });

  const mode = String(entry.bgMode ?? "none");
  let background: JsonRecord = { m: "none" };
  if (mode === "grid" || mode === "lined") {
    const rawStep = strictFinite(entry.bgStep);
    const step = rawStep === null ? 0 : rawStep * scale;
    const rawBackground = raw && record(raw.bg) ? raw.bg : undefined;
    if (!(step > 0) || step > MAX_CANVAS_DIMENSION_PX) return null;
    const color = rawBackground && safeCanvasColor(rawBackground.c)
      ? String(rawBackground.c)
      : "rgba(20,115,117,0.65)";
    const lineWidth = rawBackground ? strictFinite(rawBackground.lw) : null;
    background = {
      m: mode,
      s: step,
      ox: positiveModulo(panX + shiftX, step),
      oy: positiveModulo(panY + shiftY, step),
      c: color,
      lw: lineWidth !== null && lineWidth >= 0 && lineWidth <= MAX_STROKE_WIDTH_PX
        ? lineWidth
        : 1.125,
    };
  } else if (mode !== "none") {
    return null;
  }

  return {
    v: "cvf1",
    u: uid,
    ...(shiftedItems.length ? {} : { e: 1 }),
    w: fullWidth,
    h: fullHeight,
    bg: background,
    it: shiftedItems,
  };
}


function compactSingleCanvasState(value: unknown): unknown {
  if (!record(value) || value.v !== "cvf1") return value;
  if (!hasOnlyKeys(value, ["v", "u", "e", "w", "h", "bg", "it"])) return value;
  if (!Array.isArray(value.it)) return value;
  if (value.it.length > MAX_ITEMS_PER_CANVAS) {
    throw new CanvasStateLimitError("Canvas contains too many items.");
  }
  if (value.e !== undefined && value.e !== 1) return value;

  const uid = String(value.u ?? "");
  const widthValue = finite(value.w);
  const heightValue = finite(value.h);
  if (uid.length > MAX_COLOR_CHARACTERS) {
    throw new CanvasStateLimitError("Canvas UID is too long.");
  }
  if ((widthValue !== null && widthValue > MAX_CANVAS_DIMENSION_PX)
    || (heightValue !== null && heightValue > MAX_CANVAS_DIMENSION_PX)) {
    throw new CanvasStateLimitError("Canvas dimensions exceed the supported range.");
  }
  if (!uid || widthValue === null || heightValue === null
    || widthValue < 0 || heightValue < 0) {
    return value;
  }

  const dimensions = canvasDimensionsCoverContent(
    widthValue,
    heightValue,
    value.it
  );
  if (dimensions.width > MAX_CANVAS_DIMENSION_PX
    || dimensions.height > MAX_CANVAS_DIMENSION_PX) {
    throw new CanvasStateLimitError('Canvas content exceeds the supported dimensions.');
  }

  const colors: ColorTable = { values: [], indexes: new Map() };
  const background = encodeBackground(value.bg, colors);
  if (background === null) return value;

  const items: CompactItem[] = [];
  let pointCount = 0;
  for (const rawItem of value.it) {
    const compact = compactItem(rawItem, colors);
    if (!compact) return value;
    pointCount += compact.points;
    if (pointCount > MAX_TOTAL_DECODED_POINTS) {
      throw new CanvasStateLimitError("Canvas contains too many points.");
    }
    items.push(compact.item);
  }

  const state: CompactCanvasState = [
    CANVAS_COMPACT_VERSION,
    packUid(uid),
    dimensions.width,
    dimensions.height,
    background,
    collapseStrings(colors.values),
    collapseItems(packPathRuns(items)),
  ];
  if (value.e === 1) state.push(1);
  return state;
}

export function compactCanvasStates(states: unknown[]): unknown[] {
  if (!Array.isArray(states)) return [];
  return states.map(state => {
    try {
      return compactSingleCanvasState(state);
    } catch (error) {
      if (error instanceof CanvasStateLimitError) {
        const uid = record(state) && typeof state.u === "string" && state.u
          ? state.u
          : "<unknown>";
        throw new CanvasStateLimitError(`Canvas "${uid}": ${error.message}`);
      }
      return state;
    }
  });
}

// Captures are scoped to the currently mounted LiaScript slide. Keep states
// from unmounted slides, while treating an explicitly exported empty cvf1
// state as authoritative so the Clear action cannot resurrect old ink.
function isExplicitlyEmptyCanvasState(state: unknown): boolean {
  if (isCompactCanvasState(state)) return state[7] === 1;
  return record(state) && state.e === 1;
}

export function mergeCanvasStates(
  previous: unknown[],
  current: unknown[],
  options: { acceptEmptyChanges?: boolean } = {},
): unknown[] {
  const output: unknown[] = [];
  const indexByUid = new Map<string, number>();
  const previousByUid = new Map<string, unknown>();
  for (const state of Array.isArray(previous) ? previous : []) {
    const uid = getCanvasStateUid(state);
    if (uid) previousByUid.set(uid, state);
  }

  for (const currentState of Array.isArray(current) ? current : []) {
    const uid = getCanvasStateUid(currentState);
    const previousState = uid ? previousByUid.get(uid) : undefined;
    const state = !options.acceptEmptyChanges
      && isExplicitlyEmptyCanvasState(currentState)
      && previousState !== undefined
      && !isExplicitlyEmptyCanvasState(previousState)
        ? previousState
        : currentState;
    if (uid && indexByUid.has(uid)) {
      output[indexByUid.get(uid)!] = state;
      continue;
    }
    if (uid) indexByUid.set(uid, output.length);
    output.push(state);
  }

  for (const state of Array.isArray(previous) ? previous : []) {
    const uid = getCanvasStateUid(state);
    if (uid && indexByUid.has(uid)) continue;
    if (uid) indexByUid.set(uid, output.length);
    output.push(state);
  }

  return output;
}

export function isCompactCanvasState(value: unknown): value is CompactCanvasState {
  return Array.isArray(value)
    && value[0] === CANVAS_COMPACT_VERSION
    && (value.length === 7 || (value.length === 8 && value[7] === 1));
}

export function getCanvasStateUid(value: unknown): string {
  if (isCompactCanvasState(value)) {
    try {
      return unpackUid(value[1]);
    } catch {
      return "";
    }
  }
  return record(value) ? String(value.u ?? "") : "";
}

function decodedPathItems(
  entry: CompactItem,
  colors: string[],
  budget: DecodeBudget,
): JsonRecord[] {
  const type = strictInteger(entry[0]);
  const isRun = type === ITEM_PATH_RUN || type === ITEM_ERASER_PATH_RUN;
  const isPath = type === ITEM_PATH || type === ITEM_ERASER_PATH || isRun;
  if (!isPath) return [];

  let alpha = 1000;
  let token: unknown;
  if (entry.length === 4) token = entry[3];
  else if (entry.length === 5) {
    alpha = strictInteger(entry[3]) ?? -1;
    token = entry[4];
  } else {
    throw new Error("Invalid compact Canvas path tuple.");
  }
  const width = strictInteger(entry[2]);
  if (width === null || width < 0 || width > MAX_STROKE_WIDTH_PX * 100
    || alpha < 0 || alpha > 1000 || typeof token !== "string") {
    throw new Error("Invalid compact Canvas path style.");
  }
  const color = readColor(colors, entry[1]);
  const eraser = type === ITEM_ERASER_PATH || type === ITEM_ERASER_PATH_RUN;
  const tokens = isRun ? token.split(PATH_RUN_SEPARATOR) : [token];
  if (!tokens.length || tokens.length > MAX_ITEMS_PER_CANVAS || tokens.some(candidate => !candidate)) {
    throw new Error("Invalid compact Canvas path run.");
  }
  return tokens.map(candidate => ({
    k: eraser ? "e" : "p",
    c: color.color,
    ...(color.defaultPen ? { ck: "default" } : {}),
    a: alpha / 1000,
    w: width / 100,
    p: decodePathToken(candidate, budget),
  }));
}

function decodeCompactItem(
  entry: CompactItem,
  colors: string[],
  budget: DecodeBudget,
): JsonRecord[] {
  const type = strictInteger(entry[0]);
  if (type === ITEM_PATH || type === ITEM_ERASER_PATH
    || type === ITEM_PATH_RUN || type === ITEM_ERASER_PATH_RUN) {
    return decodedPathItems(entry, colors, budget);
  }

  if (type === ITEM_POINT || type === ITEM_ERASER_POINT) {
    let alpha = 1000;
    let xIndex = 3;
    if (entry.length === 6) {
      alpha = strictInteger(entry[3]) ?? -1;
      xIndex = 4;
    } else if (entry.length !== 5) {
      throw new Error("Invalid compact Canvas point tuple.");
    }
    const width = strictInteger(entry[2]);
    if (width === null || width < 0 || width > MAX_STROKE_WIDTH_PX * 100
      || alpha < 0 || alpha > 1000) {
      throw new Error("Invalid compact Canvas point style.");
    }
    reserveDecodedPoints(budget, 2);
    const point: [number, number] = [
      dequantizeCoordinate(entry[xIndex]),
      dequantizeCoordinate(entry[xIndex + 1]),
    ];
    const color = readColor(colors, entry[1]);
    return [{
      k: type === ITEM_ERASER_POINT ? "e" : "p",
      c: color.color,
      ...(color.defaultPen ? { ck: "default" } : {}),
      a: alpha / 1000,
      w: width / 100,
      // Canvas2D does not paint a moveTo-only subpath. A duplicated endpoint
      // produces the intended round-cap dot for short strokes collapsed into
      // one quantized cell without changing its stored coordinate.
      p: [point, point.slice()],
    }];
  }

  if (type === ITEM_RECT && entry.length === 6) {
    const color = readColor(colors, entry[1]);
    if (color.defaultPen) throw new Error("Canvas rectangle cannot use a pen-theme color.");
    return [{
      k: "r",
      f: color.color,
      x: dequantizeCoordinate(entry[2]),
      y: dequantizeCoordinate(entry[3]),
      w: dequantizeCoordinate(entry[4]),
      h: dequantizeCoordinate(entry[5]),
    }];
  }

  throw new Error("Unknown compact Canvas item type.");
}

function safeCanvasColor(value: unknown): boolean {
  return typeof value === "string" && value.length <= MAX_COLOR_CHARACTERS;
}

function safeRawCanvasBackground(value: unknown): boolean {
  if (value === undefined) return true;
  if (!record(value) || typeof value.m !== "string") return false;
  if (value.m === "none") return true;
  if (value.m !== "grid" && value.m !== "lined") {
    // A future painter may understand the mode. It carries no executable data
    // here, so retain the raw state for forward compatibility.
    return true;
  }
  const step = strictFinite(value.s);
  const offsetX = strictFinite(value.ox);
  const offsetY = strictFinite(value.oy);
  const lineWidth = strictFinite(value.lw);
  return step !== null && step > 0 && step <= MAX_CANVAS_DIMENSION_PX
    && offsetX !== null && Math.abs(offsetX) <= MAX_ABS_COORDINATE_PX
    && offsetY !== null && Math.abs(offsetY) <= MAX_ABS_COORDINATE_PX
    && lineWidth !== null && lineWidth >= 0 && lineWidth <= MAX_STROKE_WIDTH_PX
    && safeCanvasColor(value.c);
}

function sanitizeRawCanvasState(value: unknown, budget: DecodeBudget): unknown | null {
  if (!record(value) || value.v !== "cvf1") return null;
  const uid = typeof value.u === "string" ? value.u : "";
  const width = strictFinite(value.w);
  const height = strictFinite(value.h);
  if (!uid || uid.length > MAX_COLOR_CHARACTERS
    || width === null || height === null
    || width < 0 || height < 0
    || width > MAX_CANVAS_DIMENSION_PX || height > MAX_CANVAS_DIMENSION_PX
    || (value.e !== undefined && value.e !== 1)
    || !Array.isArray(value.it) || value.it.length > MAX_ITEMS_PER_CANVAS
    || !safeRawCanvasBackground(value.bg)) return null;

  let totalPoints = 0;
  for (const item of value.it) {
    if (!record(item)) return null;
    const kind = String(item.k ?? "");

    if (kind === "r") {
      if (!safeCanvasColor(item.f)) return null;
      if ([item.x, item.y, item.w, item.h].some(coordinate => {
        const number = strictFinite(coordinate);
        return number === null || Math.abs(number) > MAX_ABS_COORDINATE_PX;
      })) return null;
      continue;
    }

    if ((kind === "p" || kind === "e") && !Array.isArray(item.p)) return null;
    // Unknown future items without a point array are ignored by the current
    // upstream painter and are safe to retain for forward compatibility.
    if (!Array.isArray(item.p)) continue;
    if (item.p.length > MAX_PATH_POINTS) return null;
    if (kind === "p" || kind === "e") {
      if (!safeCanvasColor(item.c)
        || (item.ck !== undefined && item.ck !== "default")) return null;
      const alpha = strictFinite(item.a ?? 1);
      const strokeWidth = strictFinite(item.w ?? 1);
      if (alpha === null || alpha < 0 || alpha > 1
        || strokeWidth === null || strokeWidth < 0
        || strokeWidth > MAX_STROKE_WIDTH_PX) return null;
    }
    totalPoints += item.p.length;
    if (totalPoints > MAX_TOTAL_DECODED_POINTS
      || budget.points > MAX_TOTAL_DECODED_POINTS - totalPoints) return null;
    for (const pointValue of item.p) {
      if (!Array.isArray(pointValue) || pointValue.length < 2) return null;
      const x = strictFinite(pointValue[0]);
      const y = strictFinite(pointValue[1]);
      if (x === null || y === null
        || Math.abs(x) > MAX_ABS_COORDINATE_PX
        || Math.abs(y) > MAX_ABS_COORDINATE_PX) return null;
    }
  }

  budget.points += totalPoints;
  return value;
}

function expandCanvasStateWithBudget(
  value: unknown,
  budget: DecodeBudget,
): unknown | null {
  if (!isCompactCanvasState(value)) return sanitizeRawCanvasState(value, budget);
  const pointsBeforeDecode = budget.points;
  try {
    const uid = unpackUid(value[1]);
    const width = strictInteger(value[2]);
    const height = strictInteger(value[3]);
    if (width === null || height === null || width < 0 || height < 0
      || width > MAX_CANVAS_DIMENSION_PX || height > MAX_CANVAS_DIMENSION_PX) {
      throw new Error("Invalid compact Canvas size.");
    }
    const colors = expandStrings(value[5]);
    const items = expandItems(value[6]).flatMap(entry => decodeCompactItem(entry, colors, budget));
    const dimensions = canvasDimensionsCoverContent(width, height, items);
    if (dimensions.width > MAX_CANVAS_DIMENSION_PX
      || dimensions.height > MAX_CANVAS_DIMENSION_PX) {
      throw new Error('Decoded Canvas content exceeds the supported dimensions.');
    }
    const output: JsonRecord = {
      v: "cvf1",
      u: uid,
      w: dimensions.width,
      h: dimensions.height,
      bg: decodeBackground(value[4], colors),
      it: items,
    };
    if (value[7] === 1) output.e = 1;
    return output;
  } catch {
    // A malformed state must not consume the shared batch budget and thereby
    // suppress otherwise valid canvases which follow it in the same link.
    budget.points = pointsBeforeDecode;
    return null;
  }
}

export function expandCanvasStateForRestore(value: unknown): unknown | null {
  return expandCanvasStateWithBudget(value, { points: 0 });
}

export function expandCanvasStatesForRestore(states: unknown[]): unknown[] {
  if (!Array.isArray(states)) return [];
  const expanded: unknown[] = [];
  const budget: DecodeBudget = { points: 0 };
  for (const state of states.slice(0, MAX_CANVAS_STATES)) {
    const value = expandCanvasStateWithBudget(state, budget);
    if (value !== null) expanded.push(value);
  }
  return expanded;
}
