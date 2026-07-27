// Compact, versioned projection of lia-annotation's public freeze-v1 state.
//
// Annotation coordinates are relative to the slide. New captures use the
// established af2 envelope so links produced by the previous Freeze template
// remain interoperable: 1/1000 quantization, delta + ZigZag VarUint point
// streams, a shared color table and numeric slide keys. Before packing, an
// iterative Douglas-Peucker pass removes redundant samples. Blob streaming and
// adaptive gzip deliberately remain the responsibility of the outer codec, so
// the complete snapshot is compressed exactly once.

export const ANNOTATION_COMPACT_VERSION = "af2";
export const ANNOTATION_FREEZE_VERSION = "lia-annotation-freeze-v1";
export const ANNOTATION_POINT_SCALE = 1_000;
export const ANNOTATION_MIN_RAW_POINT_DISTANCE_PX = 1;
export const ANNOTATION_DOUGLAS_PEUCKER_TOLERANCE_PX = 1.4;

const ANNOTATION_POINTS_TOKEN_PREFIX = "b:";
const MAX_SLIDES = 4_096;
const MAX_ITEMS_PER_SLIDE = 10_000;
const MAX_TOTAL_ITEMS = 50_000;
const MAX_PATH_POINTS = 200_000;
const MAX_TOTAL_POINTS = 400_000;
const MAX_DP_DISTANCE_CHECKS = 2_000_000;
const MAX_BINARY_PATH_CHARACTERS = 2_000_000;
const MAX_COLORS = 4_096;
const MAX_COLOR_CHARACTERS = 256;
const MAX_SLIDE_KEY_CHARACTERS = 256;
const MAX_SLIDE_NUMBER = 10_000_000;
const MAX_BASE_WIDTH_PX = 32_768;
const MAX_STROKE_WIDTH_PX = 4_096;
const MAX_ABS_RELATIVE_COORDINATE = 8;
const MIN_SIMPLIFICATION_BASE_WIDTH_PX = 320;

type JsonRecord = Record<string, unknown>;
export type AnnotationQuantizedPoint = [number, number];
type DecodeBudget = { points: number; items: number };
type CompactItem = [number, number, unknown] | [number, number, number, unknown]
  | [number, number, number, number, unknown]
  | [number, number, number, number, number, unknown];

export class AnnotationStateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnotationStateLimitError";
  }
}

function record(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function strictFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strictInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function hasOnlyKeys(value: JsonRecord, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every(key => keys.has(key));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundFreezeNumber(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function rawPoint(value: unknown): { x: number; y: number } | null {
  if (!record(value) || !hasOnlyKeys(value, ["x", "y"])) return null;
  const x = strictFinite(value.x);
  const y = strictFinite(value.y);
  if (x === null || y === null
    || Math.abs(x) > MAX_ABS_RELATIVE_COORDINATE
    || Math.abs(y) > MAX_ABS_RELATIVE_COORDINATE) return null;
  return { x, y };
}

function distanceSquared(a: AnnotationQuantizedPoint, b: AnnotationQuantizedPoint): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function pointSegmentDistanceSquared(
  point: AnnotationQuantizedPoint,
  start: AnnotationQuantizedPoint,
  end: AnnotationQuantizedPoint,
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return distanceSquared(point, start);
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

export function simplifyAnnotationPointsDouglasPeucker(
  points: AnnotationQuantizedPoint[],
  toleranceCells: number,
): AnnotationQuantizedPoint[] {
  if (points.length <= 2 || !(toleranceCells > 0)) return points.slice();

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  const toleranceSquared = toleranceCells * toleranceCells;
  let checks = 0;

  while (stack.length) {
    const [startIndex, endIndex] = stack.pop()!;
    if (endIndex <= startIndex + 1) continue;

    let farthestIndex = -1;
    let farthestDistance = -1;
    for (let index = startIndex + 1; index < endIndex; index++) {
      if (++checks > MAX_DP_DISTANCE_CHECKS) {
        // Quantization and minimum-distance filtering already produced a safe
        // result. Avoid quadratic work on adversarial zigzag input.
        return points.slice();
      }
      const distance = pointSegmentDistanceSquared(
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

export function quantizeAnnotationPathPoints(
  values: unknown[],
  baseWidth: number,
): AnnotationQuantizedPoint[] | null {
  if (!Array.isArray(values) || !values.length || values.length > MAX_PATH_POINTS) return null;
  const effectiveBaseWidth = clamp(
    baseWidth,
    MIN_SIMPLIFICATION_BASE_WIDTH_PX,
    MAX_BASE_WIDTH_PX,
  );
  const minimumRelativeDistance = ANNOTATION_MIN_RAW_POINT_DISTANCE_PX / effectiveBaseWidth;
  const minimumDistanceSquared = minimumRelativeDistance * minimumRelativeDistance;
  const quantized: AnnotationQuantizedPoint[] = [];
  let lastAcceptedRaw: { x: number; y: number } | null = null;

  for (let index = 0; index < values.length; index++) {
    const point = rawPoint(values[index]);
    if (!point) return null;
    const isLast = index === values.length - 1;
    if (lastAcceptedRaw && !isLast) {
      const dx = point.x - lastAcceptedRaw.x;
      const dy = point.y - lastAcceptedRaw.y;
      if (dx * dx + dy * dy < minimumDistanceSquared) continue;
    }

    const x = Math.round(point.x * ANNOTATION_POINT_SCALE);
    const y = Math.round(point.y * ANNOTATION_POINT_SCALE);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
    const previous = quantized[quantized.length - 1];
    if (!previous || previous[0] !== x || previous[1] !== y) {
      quantized.push([x, y]);
    }
    lastAcceptedRaw = point;
  }

  if (quantized.length >= 3) {
    const toleranceCells = ANNOTATION_DOUGLAS_PEUCKER_TOLERANCE_PX
      * ANNOTATION_POINT_SCALE / effectiveBaseWidth;
    return simplifyAnnotationPointsDouglasPeucker(quantized, toleranceCells);
  }
  return quantized.length ? quantized : null;
}

function zigZagEncode(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error("Annotation integer exceeds the safe range.");
  const encoded = value < 0 ? -value * 2 - 1 : value * 2;
  if (!Number.isSafeInteger(encoded)) throw new Error("Annotation ZigZag integer exceeds the safe range.");
  return encoded;
}

function zigZagDecode(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid Annotation ZigZag integer.");
  }
  return value % 2 === 1 ? -(value + 1) / 2 : value / 2;
}

function pushVarUint(bytes: number[], input: number): void {
  let value = input;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid Annotation VarUint.");
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
    if (!Number.isSafeInteger(value)) throw new Error("Annotation VarUint exceeds the safe range.");
    if ((byte & 0x80) === 0) return value;
    multiplier *= 0x80;
    if (!Number.isSafeInteger(multiplier) || ++steps > 8) {
      throw new Error("Annotation VarUint is implausibly long.");
    }
  }
  throw new Error("Annotation VarUint is truncated.");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(token: string): Uint8Array {
  if (!token || token.length > MAX_BINARY_PATH_CHARACTERS || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Invalid binary Annotation path token.");
  }
  let padded = token.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4 !== 0) padded += "=";
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Invalid base64url Annotation path token.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodePointToken(points: AnnotationQuantizedPoint[]): string {
  const bytes: number[] = [];
  let previousX = 0;
  let previousY = 0;
  points.forEach((point, index) => {
    const x = index === 0 ? point[0] : point[0] - previousX;
    const y = index === 0 ? point[1] : point[1] - previousY;
    pushVarUint(bytes, zigZagEncode(x));
    pushVarUint(bytes, zigZagEncode(y));
    previousX = point[0];
    previousY = point[1];
  });
  return ANNOTATION_POINTS_TOKEN_PREFIX + bytesToBase64Url(new Uint8Array(bytes));
}

function reserveDecodedPoints(budget: DecodeBudget, count: number): void {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_PATH_POINTS) {
    throw new Error("Annotation path point count is outside the supported range.");
  }
  if (budget.points > MAX_TOTAL_POINTS - count) {
    throw new Error("Annotation state contains too many decoded points.");
  }
  budget.points += count;
}

function decodeBinaryIntegers(token: string): number[] {
  const bytes = base64UrlToBytes(token);
  const cursor = { index: 0 };
  const integers: number[] = [];
  while (cursor.index < bytes.length) {
    if (integers.length >= MAX_PATH_POINTS * 2) {
      throw new Error("Annotation path contains too many integers.");
    }
    integers.push(zigZagDecode(readVarUint(bytes, cursor)));
  }
  return integers;
}

function decodeTextIntegers(token: string): number[] {
  if (!token || token.length > MAX_BINARY_PATH_CHARACTERS
    || !/^[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*$/.test(token)) {
    throw new Error("Invalid legacy Annotation text path token.");
  }
  const parts = token.split(".");
  if (parts.length > MAX_PATH_POINTS * 2) {
    throw new Error("Annotation path contains too many text integers.");
  }
  return parts.map(part => {
    const encoded = Number.parseInt(part, 36);
    return zigZagDecode(encoded);
  });
}

function decodePointToken(value: unknown, budget: DecodeBudget): Array<{ x: number; y: number }> {
  let integers: number[];
  if (typeof value === "string") {
    integers = value.startsWith(ANNOTATION_POINTS_TOKEN_PREFIX)
      ? decodeBinaryIntegers(value.slice(ANNOTATION_POINTS_TOKEN_PREFIX.length))
      : decodeTextIntegers(value);
  } else if (Array.isArray(value)) {
    if (value.length > MAX_PATH_POINTS * 2) throw new Error("Annotation path array is too large.");
    integers = value.map(entry => {
      const integer = strictInteger(entry);
      if (integer === null) throw new Error("Invalid legacy Annotation path integer.");
      return integer;
    });
  } else {
    throw new Error("Invalid Annotation path token.");
  }

  if (!integers.length || integers.length % 2 !== 0) {
    throw new Error("Invalid Annotation path integer count.");
  }
  reserveDecodedPoints(budget, integers.length / 2);

  const points: Array<{ x: number; y: number }> = [];
  let x = 0;
  let y = 0;
  for (let index = 0; index < integers.length; index += 2) {
    if (index === 0) {
      x = integers[index];
      y = integers[index + 1];
    } else {
      x += integers[index];
      y += integers[index + 1];
    }
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)
      || Math.abs(x) > MAX_ABS_RELATIVE_COORDINATE * ANNOTATION_POINT_SCALE
      || Math.abs(y) > MAX_ABS_RELATIVE_COORDINATE * ANNOTATION_POINT_SCALE) {
      throw new Error("Annotation path coordinate exceeds the supported range.");
    }
    points.push({ x: x / ANNOTATION_POINT_SCALE, y: y / ANNOTATION_POINT_SCALE });
  }
  return points;
}

function packSlideKey(value: string): string | number {
  const match = /^#([1-9]\d*)$/.exec(value);
  if (!match) return value;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number <= MAX_SLIDE_NUMBER ? number : value;
}

function unpackSlideKey(value: unknown): string {
  if (typeof value === "string") {
    if (!value || value.length > MAX_SLIDE_KEY_CHARACTERS || value.trim() !== value) {
      throw new Error("Invalid Annotation slide key.");
    }
    if (/^\d+$/.test(value)) return `#${value}`;
    return value;
  }
  const number = strictInteger(value);
  if (number === null || number < 1 || number > MAX_SLIDE_NUMBER) {
    throw new Error("Invalid packed Annotation slide key.");
  }
  return `#${number}`;
}

function slideKeyCompare(a: string, b: string): number {
  const aNumber = /^#(\d+)$/.exec(a);
  const bNumber = /^#(\d+)$/.exec(b);
  if (aNumber && bNumber) return Number(aNumber[1]) - Number(bNumber[1]);
  if (aNumber) return -1;
  if (bNumber) return 1;
  return a.localeCompare(b);
}

function validStyle(
  widthValue: unknown,
  alphaValue: unknown,
  baseWidthValue: unknown,
): { width: number; alpha: number; baseW: number } | null {
  const width = strictFinite(widthValue);
  const alpha = strictFinite(alphaValue);
  const baseW = strictFinite(baseWidthValue);
  if (width === null || alpha === null || baseW === null
    || width < 0 || width > MAX_STROKE_WIDTH_PX
    || alpha < 0 || alpha > 1
    || baseW <= 0 || baseW > MAX_BASE_WIDTH_PX) return null;
  return {
    width: roundFreezeNumber(width),
    alpha: roundFreezeNumber(alpha),
    baseW: roundFreezeNumber(baseW),
  };
}

function makeCompactItem(
  tool: number,
  colorIndex: number,
  style: { width: number; alpha: number; baseW: number },
  token: string,
): CompactItem {
  if (style.width === 1 && style.alpha === 1 && style.baseW === 1) {
    return [tool, colorIndex, token];
  }
  if (style.alpha === 1 && style.baseW === 1) {
    return [tool, colorIndex, style.width, token];
  }
  if (style.baseW === 1) {
    return [tool, colorIndex, style.width, style.alpha, token];
  }
  return [tool, colorIndex, style.width, style.alpha, style.baseW, token];
}

function compactRawAnnotationState(value: unknown): unknown | null {
  if (!record(value) || value.version !== ANNOTATION_FREEZE_VERSION
    || !hasOnlyKeys(value, ["version", "ui", "slides"])) return null;
  if (!record(value.ui) || !hasOnlyKeys(value.ui, ["visible"])
    || typeof value.ui.visible !== "boolean") return null;
  if (!record(value.slides)) return null;

  const slideKeys = Object.keys(value.slides);
  if (slideKeys.length > MAX_SLIDES) {
    throw new AnnotationStateLimitError("Annotation state contains too many slides.");
  }

  const colors: string[] = [];
  const colorIndexes = new Map<string, number>();
  const internColor = (color: string): number => {
    const existing = colorIndexes.get(color);
    if (existing !== undefined) return existing;
    if (colors.length >= MAX_COLORS) {
      throw new AnnotationStateLimitError("Annotation color table is too large.");
    }
    const index = colors.length;
    colors.push(color);
    colorIndexes.set(color, index);
    return index;
  };

  const slides: Array<[string | number, CompactItem[]]> = [];
  let totalItems = 0;
  let totalSourcePoints = 0;
  let totalCompactPoints = 0;

  for (const slideKey of slideKeys.sort(slideKeyCompare)) {
    if (!slideKey || slideKey.length > MAX_SLIDE_KEY_CHARACTERS) {
      throw new AnnotationStateLimitError("Annotation slide key is too long.");
    }
    const slide = value.slides[slideKey];
    if (!record(slide) || !hasOnlyKeys(slide, ["items", "redo"])
      || !Array.isArray(slide.items)
      || (slide.redo !== undefined && !Array.isArray(slide.redo))) return null;
    if (slide.items.length > MAX_ITEMS_PER_SLIDE) {
      throw new AnnotationStateLimitError(`Annotation slide "${slideKey}" contains too many items.`);
    }

    const items: CompactItem[] = [];
    for (const rawItem of slide.items) {
      if (!record(rawItem) || !hasOnlyKeys(rawItem, [
        "kind", "tool", "color", "width", "alpha", "baseW", "points",
      ]) || rawItem.kind !== "path"
        || (rawItem.tool !== "pen" && rawItem.tool !== "eraser")
        || typeof rawItem.color !== "string"
        || !Array.isArray(rawItem.points)) return null;
      if (rawItem.color.length > MAX_COLOR_CHARACTERS) {
        throw new AnnotationStateLimitError("Annotation color is too long.");
      }
      if (rawItem.points.length > MAX_PATH_POINTS) {
        throw new AnnotationStateLimitError("Annotation path contains too many points.");
      }
      totalSourcePoints += rawItem.points.length;
      if (totalSourcePoints > MAX_TOTAL_POINTS) {
        throw new AnnotationStateLimitError("Annotation state contains too many source points.");
      }
      const style = validStyle(rawItem.width, rawItem.alpha, rawItem.baseW);
      if (!style) return null;
      const points = quantizeAnnotationPathPoints(rawItem.points, style.baseW);
      if (!points?.length) return null;
      totalCompactPoints += points.length;
      if (totalCompactPoints > MAX_TOTAL_POINTS) {
        throw new AnnotationStateLimitError("Annotation state contains too many compact points.");
      }
      items.push(makeCompactItem(
        rawItem.tool === "eraser" ? 1 : 0,
        internColor(rawItem.color),
        style,
        encodePointToken(points),
      ));
      totalItems++;
      if (totalItems > MAX_TOTAL_ITEMS) {
        throw new AnnotationStateLimitError("Annotation state contains too many items.");
      }
    }
    if (items.length) slides.push([packSlideKey(slideKey), items]);
  }

  if (!slides.length && value.ui.visible) return null;
  const compact: JsonRecord = { v: ANNOTATION_COMPACT_VERSION };
  if (slides.length) compact.s = slides;
  if (colors.length) compact.c = colors;
  if (!value.ui.visible) compact.u = 0;
  return compact;
}

export function isCompactAnnotationState(value: unknown): boolean {
  return record(value) && value.v === ANNOTATION_COMPACT_VERSION;
}

function readCompactStyle(tuple: unknown[]): {
  tool: "pen" | "eraser";
  colorIndex: number;
  width: number;
  alpha: number;
  baseW: number;
  token: unknown;
} {
  if (tuple.length < 3 || tuple.length > 6) throw new Error("Invalid compact Annotation item tuple.");
  const toolCode = strictInteger(tuple[0]);
  const colorIndex = strictInteger(tuple[1]);
  if ((toolCode !== 0 && toolCode !== 1) || colorIndex === null || colorIndex < 0) {
    throw new Error("Invalid compact Annotation item metadata.");
  }
  let width = 1;
  let alpha = 1;
  let baseW = 1;
  let token: unknown;
  if (tuple.length === 3) token = tuple[2];
  else if (tuple.length === 4) {
    width = strictFinite(tuple[2]) ?? Number.NaN;
    token = tuple[3];
  } else if (tuple.length === 5) {
    width = strictFinite(tuple[2]) ?? Number.NaN;
    alpha = strictFinite(tuple[3]) ?? Number.NaN;
    token = tuple[4];
  } else {
    width = strictFinite(tuple[2]) ?? Number.NaN;
    alpha = strictFinite(tuple[3]) ?? Number.NaN;
    baseW = strictFinite(tuple[4]) ?? Number.NaN;
    token = tuple[5];
  }
  const style = validStyle(width, alpha, baseW);
  if (!style) throw new Error("Compact Annotation style is outside the supported range.");
  return {
    tool: toolCode === 1 ? "eraser" : "pen",
    colorIndex,
    ...style,
    token,
  };
}

function expandCompactAnnotationState(value: JsonRecord, budget: DecodeBudget): JsonRecord {
  if (!hasOnlyKeys(value, ["v", "s", "c", "u"])
    || (value.u !== undefined && value.u !== 0)) {
    throw new Error("Invalid compact Annotation envelope.");
  }
  const colorSource = value.c === undefined ? [] : value.c;
  if (!Array.isArray(colorSource) || colorSource.length > MAX_COLORS
    || colorSource.some(color => typeof color !== "string" || color.length > MAX_COLOR_CHARACTERS)) {
    throw new Error("Invalid compact Annotation color table.");
  }
  const colors = colorSource as string[];
  const slideSource = value.s === undefined ? [] : value.s;
  if (!Array.isArray(slideSource) || slideSource.length > MAX_SLIDES) {
    throw new Error("Invalid compact Annotation slide list.");
  }

  const slides: JsonRecord = {};
  const seenKeys = new Set<string>();
  for (const slideEntry of slideSource) {
    if (!Array.isArray(slideEntry) || slideEntry.length !== 2 || !Array.isArray(slideEntry[1])) {
      throw new Error("Invalid compact Annotation slide tuple.");
    }
    const slideKey = unpackSlideKey(slideEntry[0]);
    if (seenKeys.has(slideKey)) throw new Error("Duplicate compact Annotation slide key.");
    seenKeys.add(slideKey);
    const tuples = slideEntry[1] as unknown[];
    if (!tuples.length || tuples.length > MAX_ITEMS_PER_SLIDE) {
      throw new Error("Compact Annotation slide item count is outside the supported range.");
    }
    if (budget.items > MAX_TOTAL_ITEMS - tuples.length) {
      throw new Error("Annotation state contains too many decoded items.");
    }
    budget.items += tuples.length;
    const items = tuples.map(tupleValue => {
      if (!Array.isArray(tupleValue)) throw new Error("Invalid compact Annotation item.");
      const style = readCompactStyle(tupleValue);
      if (style.colorIndex >= colors.length) {
        throw new Error("Compact Annotation color index is outside the table.");
      }
      return {
        kind: "path",
        tool: style.tool,
        color: colors[style.colorIndex] ?? "#ff0000",
        width: style.width,
        alpha: style.alpha,
        baseW: style.baseW,
        points: decodePointToken(style.token, budget),
      };
    });
    slides[slideKey] = { items, redo: [] };
  }

  if (!Object.keys(slides).length && value.u !== 0) {
    throw new Error("Empty compact Annotation state has no observable data.");
  }
  return {
    version: ANNOTATION_FREEZE_VERSION,
    ui: { visible: value.u !== 0 },
    slides,
  };
}

function validateRawAnnotationState(value: unknown, budget: DecodeBudget): JsonRecord {
  if (!record(value) || value.version !== ANNOTATION_FREEZE_VERSION
    || !hasOnlyKeys(value, ["version", "ui", "slides"])
    || !record(value.ui) || !hasOnlyKeys(value.ui, ["visible"])
    || typeof value.ui.visible !== "boolean"
    || !record(value.slides)) throw new Error("Invalid raw Annotation freeze state.");
  const slideKeys = Object.keys(value.slides);
  if (slideKeys.length > MAX_SLIDES) throw new Error("Annotation state contains too many slides.");
  const slides: JsonRecord = {};

  for (const slideKey of slideKeys) {
    if (!slideKey || slideKey.length > MAX_SLIDE_KEY_CHARACTERS) {
      throw new Error("Invalid raw Annotation slide key.");
    }
    const slide = value.slides[slideKey];
    if (!record(slide) || !hasOnlyKeys(slide, ["items", "redo"])
      || !Array.isArray(slide.items)
      || (slide.redo !== undefined && !Array.isArray(slide.redo))
      || slide.items.length > MAX_ITEMS_PER_SLIDE) {
      throw new Error("Invalid raw Annotation slide.");
    }
    if (budget.items > MAX_TOTAL_ITEMS - slide.items.length) {
      throw new Error("Annotation state contains too many items.");
    }
    budget.items += slide.items.length;
    const items = slide.items.map(itemValue => {
      if (!record(itemValue) || !hasOnlyKeys(itemValue, [
        "kind", "tool", "color", "width", "alpha", "baseW", "points",
      ]) || itemValue.kind !== "path"
        || (itemValue.tool !== "pen" && itemValue.tool !== "eraser")
        || typeof itemValue.color !== "string"
        || itemValue.color.length > MAX_COLOR_CHARACTERS
        || !Array.isArray(itemValue.points)) {
        throw new Error("Invalid raw Annotation path.");
      }
      const style = validStyle(itemValue.width, itemValue.alpha, itemValue.baseW);
      if (!style) throw new Error("Raw Annotation style is outside the supported range.");
      reserveDecodedPoints(budget, itemValue.points.length);
      const points = itemValue.points.map(pointValue => {
        const point = rawPoint(pointValue);
        if (!point) throw new Error("Invalid raw Annotation point.");
        return { x: roundFreezeNumber(point.x), y: roundFreezeNumber(point.y) };
      });
      return {
        kind: "path",
        tool: itemValue.tool,
        color: itemValue.color,
        ...style,
        points,
      };
    });
    if (items.length) slides[slideKey] = { items, redo: [] };
  }
  return {
    version: ANNOTATION_FREEZE_VERSION,
    ui: { visible: value.ui.visible },
    slides,
  };
}

export function compactAnnotationFreezeState(value: unknown): unknown | null {
  if (value == null) return null;
  if (isCompactAnnotationState(value)) {
    return expandAnnotationFreezeStateForRestore(value) ? value : null;
  }
  return compactRawAnnotationState(value);
}

export function expandAnnotationFreezeStateForRestore(value: unknown): JsonRecord | null {
  if (value == null) return null;
  const budget: DecodeBudget = { points: 0, items: 0 };
  try {
    if (isCompactAnnotationState(value)) {
      return expandCompactAnnotationState(value as JsonRecord, budget);
    }
    return validateRawAnnotationState(value, budget);
  } catch {
    return null;
  }
}

export function countAnnotationItems(value: unknown): number {
  const expanded = expandAnnotationFreezeStateForRestore(value);
  if (!expanded || !record(expanded.slides)) return 0;
  return Object.values(expanded.slides).reduce<number>((total, slide) => {
    return total + (record(slide) && Array.isArray(slide.items) ? slide.items.length : 0);
  }, 0);
}

export function mergeAnnotationFreezeStates(
  previous: unknown,
  current: unknown,
  options: { acceptEmptyChanges?: boolean } = {},
): unknown | null {
  if (options.acceptEmptyChanges) return current ?? null;
  const previousExpanded = expandAnnotationFreezeStateForRestore(previous);
  const currentExpanded = expandAnnotationFreezeStateForRestore(current);
  if (!currentExpanded) return previous ?? null;
  if (!previousExpanded) return current ?? null;
  const previousSlides = record(previousExpanded.slides) ? previousExpanded.slides : {};
  const currentSlides = record(currentExpanded.slides) ? currentExpanded.slides : {};
  const merged = {
    version: ANNOTATION_FREEZE_VERSION,
    ui: currentExpanded.ui,
    slides: { ...previousSlides, ...currentSlides },
  };
  return compactRawAnnotationState(merged);
}
