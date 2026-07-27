// Stable, compact bridge for lia-Mathe's fraction widget state.
//
// Current `main` exposes getAllWidgets(), but the documented 0.0.2 tag and
// older branches do not. Even on `main`, the public snapshot omits rectangle
// dimensions. Freeze therefore combines the public snapshot with the V3 store
// and DOM-derived hints, while persisting only serializable user-visible data.

export type MatheKind = "circle" | "rect";

export interface MatheDomHint {
  kind?: MatheKind;
  parts?: number;
  rows?: number;
  cols?: number;
}

export interface MatheRuntimeMeta {
  kind?: unknown;
  parts?: unknown;
  rows?: unknown;
  cols?: unknown;
  solved?: unknown;
  revealed?: unknown;
  locked?: unknown;
  ready?: unknown;
  [key: string]: unknown;
}

export interface MatheRuntimeWidget {
  state?: unknown;
  meta?: MatheRuntimeMeta;
  dims?: { rows?: unknown; cols?: unknown };
  [key: string]: unknown;
}

export interface MathePublicApi {
  getAllWidgets?(): Record<string, unknown>;
}

export interface MatheStoreApi {
  getWidget?(uid: string, kind?: MatheKind | ""): MatheRuntimeWidget | undefined;
  widgets?: Record<string, MatheRuntimeWidget>;
  setCircleParts?(
    uid: string,
    parts: number,
    options?: { force?: boolean; preserve?: boolean }
  ): boolean[];
  setRectDims?(
    uid: string,
    rows: number,
    cols: number,
    options?: { force?: boolean; preserve?: boolean }
  ): boolean[];
  refreshNodes?(uid: string): unknown;
  syncInputs?(uid: string, forceValue: boolean): void;
  syncDomState?(uid: string): void;
  render?(uid: string): boolean;
}

/** Bit flags: solved, revealed, locked. Runtime readiness is not persisted. */
export interface MatheFrozenWidgetV1 {
  k: "c" | "r";
  n?: number;
  r?: number;
  c?: number;
  a: number[];
  f: number;
}

export interface MatheFrozenStateV1 {
  v: 1;
  w: Record<string, MatheFrozenWidgetV1>;
}

const MAX_CIRCLE_PARTS = 32;
const MAX_RECT_DIM = 20;
const FLAG_SOLVED = 1;
const FLAG_REVEALED = 2;
const FLAG_LOCKED = 4;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined;
}

function positiveInt(value: unknown, max: number): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const integer = Math.floor(parsed);
  return integer >= 1 && integer <= max ? integer : undefined;
}

function kindOf(...values: unknown[]): MatheKind | undefined {
  for (const value of values) {
    if (value === "circle" || value === "rect") return value;
  }
  return undefined;
}

function bool(value: unknown): boolean {
  return value === true || value === 1;
}

function flagsOf(meta: MatheRuntimeMeta | undefined): number {
  if (!meta) return 0;
  return (bool(meta.solved) ? FLAG_SOLVED : 0)
    | (bool(meta.revealed) ? FLAG_REVEALED : 0)
    | (bool(meta.locked) ? FLAG_LOCKED : 0);
}

function booleanState(value: unknown, max: number): boolean[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map(Boolean);
}

function activeIndexes(state: boolean[], total: number): number[] {
  const active: number[] = [];
  for (let index = 0; index < Math.min(state.length, total); index++) {
    if (state[index]) active.push(index);
  }
  return active;
}

function bestRectDims(total: number): { rows: number; cols: number } {
  const safeTotal = Math.max(1, Math.min(MAX_RECT_DIM * MAX_RECT_DIM, total | 0));
  let cols = 1;
  let rows = safeTotal;
  for (let candidate = 1; candidate * candidate <= safeTotal; candidate++) {
    if (safeTotal % candidate !== 0) continue;
    const other = safeTotal / candidate;
    if (candidate <= MAX_RECT_DIM && other <= MAX_RECT_DIM) {
      cols = candidate;
      rows = other;
    }
  }
  return { rows, cols };
}

function dimensionsOf(
  stateLength: number,
  internal: MatheRuntimeWidget | undefined,
  publicWidget: Record<string, unknown> | undefined,
  hint: MatheDomHint | undefined
): { rows: number; cols: number } {
  const publicMeta = record(publicWidget?.meta) as MatheRuntimeMeta | undefined;
  const candidates: Array<[unknown, unknown]> = [
    [internal?.dims?.rows, internal?.dims?.cols],
    [internal?.meta?.rows, internal?.meta?.cols],
    [publicMeta?.rows, publicMeta?.cols],
    [hint?.rows, hint?.cols],
  ];

  for (const [rawRows, rawCols] of candidates) {
    const rows = positiveInt(rawRows, MAX_RECT_DIM);
    const cols = positiveInt(rawCols, MAX_RECT_DIM);
    if (!rows || !cols) continue;
    if (!stateLength || rows * cols === stateLength) return { rows, cols };
  }

  return bestRectDims(stateLength || 1);
}

function publicWidgets(api: MathePublicApi | undefined): Record<string, unknown> {
  try {
    const widgets = api?.getAllWidgets?.();
    return widgets && typeof widgets === "object" ? widgets : {};
  } catch {
    return {};
  }
}

function safeUid(uid: string): boolean {
  return !!uid
    && uid.length <= 160
    && uid !== "__proto__"
    && uid !== "prototype"
    && uid !== "constructor";
}

export function captureMatheStates(
  api: MathePublicApi | undefined,
  store: MatheStoreApi | undefined,
  hints: Record<string, MatheDomHint> = {}
): MatheFrozenStateV1 {
  const external = publicWidgets(api);
  const internal = store?.widgets && typeof store.widgets === "object"
    ? store.widgets
    : {};
  const uids = new Set([
    ...Object.keys(external),
    ...Object.keys(internal),
    ...Object.keys(hints),
  ]);
  const widgets: Record<string, MatheFrozenWidgetV1> = {};

  for (const uid of uids) {
    if (!safeUid(uid)) continue;
    const publicWidget = record(external[uid]);
    let internalWidget: MatheRuntimeWidget | undefined = internal[uid];
    if (!internalWidget && store?.getWidget) {
      try { internalWidget = store.getWidget(uid); } catch { /* ignore */ }
    }
    const publicMeta = record(publicWidget?.meta) as MatheRuntimeMeta | undefined;
    const meta = internalWidget?.meta ?? publicMeta;
    const hint = hints[uid];
    const kind = kindOf(internalWidget?.meta?.kind, publicMeta?.kind, hint?.kind);
    if (!kind) continue;

    const rawState = internalWidget?.state ?? publicWidget?.state;
    const state = booleanState(rawState, MAX_RECT_DIM * MAX_RECT_DIM);
    const flags = flagsOf(meta);

    if (kind === "circle") {
      const parts = positiveInt(internalWidget?.meta?.parts, MAX_CIRCLE_PARTS)
        ?? positiveInt(publicMeta?.parts, MAX_CIRCLE_PARTS)
        ?? positiveInt(hint?.parts, MAX_CIRCLE_PARTS)
        ?? positiveInt(state.length, MAX_CIRCLE_PARTS)
        ?? 1;
      widgets[uid] = {
        k: "c",
        n: parts,
        a: activeIndexes(state, parts),
        f: flags,
      };
      continue;
    }

    const dims = dimensionsOf(state.length, internalWidget, publicWidget, hint);
    const total = dims.rows * dims.cols;
    widgets[uid] = {
      k: "r",
      r: dims.rows,
      c: dims.cols,
      a: activeIndexes(state, total),
      f: flags,
    };
  }

  return { v: 1, w: widgets };
}

interface DecodedWidget {
  kind?: MatheKind;
  parts?: number;
  rows?: number;
  cols?: number;
  total?: number;
  active: number[];
  solved?: boolean;
  revealed?: boolean;
  locked?: boolean;
}

function selectedIndexes(value: unknown, total: number): number[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<number>();
  for (const raw of value) {
    const index = Number(raw);
    if (Number.isInteger(index) && index >= 0 && index < total) unique.add(index);
  }
  return Array.from(unique).sort((a, b) => a - b);
}

function decodeCompact(raw: unknown): DecodedWidget | undefined {
  const saved = record(raw);
  if (!saved) return undefined;
  const kind = saved.k === "c" ? "circle" : saved.k === "r" ? "rect" : undefined;
  if (!kind) return undefined;
  const flags = Number.isFinite(Number(saved.f)) ? Number(saved.f) | 0 : 0;

  if (kind === "circle") {
    const parts = positiveInt(saved.n, MAX_CIRCLE_PARTS) ?? 1;
    return {
      kind,
      parts,
      total: parts,
      active: selectedIndexes(saved.a, parts),
      solved: !!(flags & FLAG_SOLVED),
      revealed: !!(flags & FLAG_REVEALED),
      locked: !!(flags & FLAG_LOCKED),
    };
  }

  const rows = positiveInt(saved.r, MAX_RECT_DIM) ?? 1;
  const cols = positiveInt(saved.c, MAX_RECT_DIM) ?? 1;
  const total = rows * cols;
  return {
    kind,
    rows,
    cols,
    total,
    active: selectedIndexes(saved.a, total),
    solved: !!(flags & FLAG_SOLVED),
    revealed: !!(flags & FLAG_REVEALED),
    locked: !!(flags & FLAG_LOCKED),
  };
}

function decodeLegacy(raw: unknown): DecodedWidget | undefined {
  const saved = record(raw);
  if (!saved) return undefined;
  const meta = record(saved.meta) as MatheRuntimeMeta | undefined;
  const state = booleanState(saved.state, MAX_RECT_DIM * MAX_RECT_DIM);
  const kind = kindOf(meta?.kind, saved.kind);
  if (!kind) return undefined;

  if (kind === "circle") {
    const parts = positiveInt(meta?.parts, MAX_CIRCLE_PARTS)
      ?? positiveInt(saved.parts, MAX_CIRCLE_PARTS)
      ?? positiveInt(state.length, MAX_CIRCLE_PARTS)
      ?? 1;
    return {
      kind,
      parts,
      total: parts,
      active: activeIndexes(state, parts),
      solved: bool(meta?.solved),
      revealed: bool(meta?.revealed),
      locked: bool(meta?.locked),
    };
  }

  const dims = dimensionsOf(state.length, saved as MatheRuntimeWidget, saved, undefined);
  const total = dims.rows * dims.cols;
  return {
    kind,
    rows: dims.rows,
    cols: dims.cols,
    total,
    active: activeIndexes(state, total),
    solved: bool(meta?.solved),
    revealed: bool(meta?.revealed),
    locked: bool(meta?.locked),
  };
}

function decodedWidgets(states: unknown): Record<string, DecodedWidget> {
  const root = record(states);
  if (!root) return {};
  const compact = root.v === 1 && record(root.w);
  const source = compact ? record(root.w)! : root;
  const result: Record<string, DecodedWidget> = {};

  for (const [uid, raw] of Object.entries(source)) {
    if (!safeUid(uid)) continue;
    const decoded = compact ? decodeCompact(raw) : decodeLegacy(raw);
    if (decoded) result[uid] = decoded;
  }
  return result;
}

function boolArray(total: number, active: number[]): boolean[] {
  const state = Array(Math.max(1, total | 0)).fill(false) as boolean[];
  active.forEach(index => { if (index >= 0 && index < state.length) state[index] = true; });
  return state;
}

function callSafely(callback: (() => unknown) | undefined): void {
  if (!callback) return;
  try { callback(); } catch { /* best-effort across lia-Mathe versions */ }
}

/**
 * Restores compact V1 states as well as the raw widget maps emitted by older
 * Freeze builds. The V3 store can create a UID before its slide mounts; the
 * template's later register() call then keeps the preloaded geometry/state.
 */
export function restoreMatheStates(
  store: MatheStoreApi | undefined,
  states: unknown
): boolean {
  if (!store?.getWidget) return false;
  const decoded = decodedWidgets(states);
  const entries = Object.entries(decoded);
  let applied = 0;

  for (const [uid, saved] of entries) {
    let widget: MatheRuntimeWidget | undefined;
    try { widget = store.getWidget(uid, saved.kind ?? ""); } catch { continue; }
    if (!widget) continue;

    const kind = saved.kind ?? kindOf(widget.meta?.kind);
    if (!kind) continue;
    if (!widget.meta || typeof widget.meta !== "object") widget.meta = {};

    if (kind === "circle") {
      const parts = saved.parts ?? saved.total ?? 1;
      callSafely(() => store.setCircleParts?.(uid, parts, { force: true, preserve: false }));
      try { widget = store.getWidget(uid, kind) ?? widget; } catch { /* retain */ }
      widget.state = boolArray(parts, saved.active);
      if (!widget.meta || typeof widget.meta !== "object") widget.meta = {};
      widget.meta.kind = kind;
      widget.meta.parts = parts;
      delete widget.dims;
    } else {
      const rows = saved.rows ?? 1;
      const cols = saved.cols ?? 1;
      callSafely(() => store.setRectDims?.(uid, rows, cols, { force: true, preserve: false }));
      try { widget = store.getWidget(uid, kind) ?? widget; } catch { /* retain */ }
      widget.state = boolArray(rows * cols, saved.active);
      widget.dims = { rows, cols };
      if (!widget.meta || typeof widget.meta !== "object") widget.meta = {};
      widget.meta.kind = kind;
      widget.meta.rows = rows;
      widget.meta.cols = cols;
    }

    widget.meta.solved = saved.solved === true;
    widget.meta.revealed = saved.revealed === true;
    widget.meta.locked = saved.locked === true;
    callSafely(() => store.refreshNodes?.(uid));
    callSafely(() => store.syncInputs?.(uid, true));
    callSafely(() => store.syncDomState?.(uid));
    callSafely(() => store.render?.(uid));
    applied += 1;
  }

  return applied === entries.length;
}
