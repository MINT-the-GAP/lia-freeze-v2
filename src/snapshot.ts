// Captures the full student state (native quizzes + all MINT plugins) into a
// SnapshotPayload, and restores it from a payload on the teacher's side.
import { loadNativeState, sendRestoreEvent, TableName } from "./port";
import { getCurrentHash } from "./url";

// ---- Window globals declared minimally ----

declare global {
  interface Window {
    // lia-annotation
    __LIA_ANNOTATION__?: {
      exportFreezeState(): unknown;
      importFreezeState(data: unknown, opts?: { replace?: boolean }): boolean;
      hasFreezeData?(): boolean;
      setReadOnly?(v: boolean): void;
    };

    // lia-canvas-ocr
    __LIA_CANVAS_OCR__?: {
      freeze: {
        exportAllCanvasFreezeStatesFromRoot(root: Document | Element): unknown[];
        renderCanvasFreezeStateIntoPair?(pair: Element, state: unknown): Element | null;
        collectCanvasPairsFromRoot?(root: Document | Element): Element[];
      };
    };

    // lia-marker
    __LIA_TEXTMARKER_REG_V4__?: {
      instances: Record<string, { HL: unknown[] }>;
      setHighlights?(hlArray: unknown[]): void;
    };

    // lia-orthography (getAllStates / setState added in Step 5)
    __ORTHOGRAPHY_EXPORT_V8__?: {
      getAllStates?(): Record<string, unknown>;
      setState?(uid: string, value: string): void;
    };

    // lia-Mathe public API
    __LIA_FRACTION_QUIZ__?: {
      getAllWidgets(): Record<string, { state: boolean[]; meta: { uid: string; kind: string; solved: boolean; revealed: boolean; locked: boolean; ready: boolean } }>;
      check(uid: string): boolean;
      onReveal(uid: string): boolean;
    };

    // lia-Mathe internal store — used only for state restore (write path)
    __LIA_FRACTION_QUIZ_V3__?: {
      getWidget(uid: string): { state: boolean[]; meta: Record<string, unknown> } | undefined;
    };

    // lia-coordinate
    __coordBoardStates?: Record<string, unknown>;
    __coord?: {
      getBoardStateStore?(): Record<string, unknown>;
      restoreSavedBoardState?(board: unknown, initialBBox: number[], boardId: string): boolean;
    };
    __boards?: Record<string, unknown>;
  }
}

// ---- Payload types ----

export interface SlideState {
  h: string;
  quiz?:   Record<number, unknown>;
  survey?: Record<number, unknown>;
  code?:   Record<number, unknown>;
  task?:   Record<number, unknown>;
  canvas?: unknown[];
  marker?: unknown[];
  ortho?:  Record<string, unknown>;
  mathe?:  Record<string, unknown>;
  coord?:  Record<string, unknown>;
}

export interface SnapshotPayload {
  v: string;
  sh: string;
  s: SlideState[];
  annot?: unknown;
  n?: string;
  sec?: { trackF12: 0 | 1; trackTab: 0 | 1; f12: number; tab: number };
}

export const PAYLOAD_VERSION = "sf-mini-ti-3";

// ---- Native quiz state (port-accumulated, keyed globally by section index) ----

async function pullNativeState(): Promise<{
  quiz: Record<number, unknown>;
  survey: Record<number, unknown>;
  code: Record<number, unknown>;
  task: Record<number, unknown>;
}> {
  return loadNativeState();
}

// ---- Plugin capture helpers ----

function captureCanvas(): unknown[] {
  try {
    const api = window.__LIA_CANVAS_OCR__?.freeze;
    if (!api?.exportAllCanvasFreezeStatesFromRoot) return [];
    return api.exportAllCanvasFreezeStatesFromRoot(document);
  } catch { return []; }
}

function captureMarker(): unknown[] {
  try {
    const reg = window.__LIA_TEXTMARKER_REG_V4__;
    if (!reg) return [];
    const docId = document.baseURI || location.href;
    return reg.instances[docId]?.HL ?? [];
  } catch { return []; }
}

function captureOrtho(): Record<string, unknown> {
  try {
    return window.__ORTHOGRAPHY_EXPORT_V8__?.getAllStates?.() ?? {};
  } catch { return {}; }
}

function captureMathe(): Record<string, unknown> {
  try {
    const api = window.__LIA_FRACTION_QUIZ__;
    if (!api) return {};
    const widgets = api.getAllWidgets();
    const out: Record<string, unknown> = {};
    for (const uid of Object.keys(widgets)) {
      out[uid] = widgets[uid];
    }
    return out;
  } catch { return {}; }
}

function captureCoord(): Record<string, unknown> {
  try {
    const store = window.__coord?.getBoardStateStore?.()
      ?? window.__coordBoardStates
      ?? {};
    return JSON.parse(JSON.stringify(store));
  } catch { return {}; }
}

function captureAnnotation(): unknown {
  try {
    return window.__LIA_ANNOTATION__?.exportFreezeState() ?? null;
  } catch { return null; }
}

// ---- Restore helpers ----

function restoreCanvas(states: unknown[]): void {
  try {
    const api = window.__LIA_CANVAS_OCR__?.freeze;
    if (!api?.renderCanvasFreezeStateIntoPair || !api.collectCanvasPairsFromRoot) return;
    const pairs = api.collectCanvasPairsFromRoot(document);
    const list = Array.isArray(states) ? states : [];
    for (const state of list) {
      const uid = (state as Record<string, unknown>)?.["u"] as string | undefined;
      if (!uid) continue;
      const pair = pairs.find(p => {
        const mount = p.querySelector?.(".lia-canvas-mount");
        return mount && (mount as HTMLElement).dataset?.uid === uid;
      });
      if (pair) api.renderCanvasFreezeStateIntoPair(pair, state);
    }
  } catch { /* best-effort */ }
}

function restoreMarker(hl: unknown[]): void {
  try {
    const reg = window.__LIA_TEXTMARKER_REG_V4__;
    if (!reg || typeof reg.setHighlights !== "function") return;
    reg.setHighlights(Array.isArray(hl) ? hl : []);
  } catch { /* best-effort */ }
}

function restoreOrtho(states: Record<string, unknown>): void {
  try {
    const api = window.__ORTHOGRAPHY_EXPORT_V8__;
    if (!api || typeof api.setState !== "function") return;
    for (const [uid, s] of Object.entries(states)) {
      const val = (s as Record<string, unknown>)?.["liveValue"] ?? s;
      if (typeof val === "string") api.setState(uid, val);
    }
  } catch { /* best-effort */ }
}

function restoreMathe(states: Record<string, unknown>): void {
  try {
    const store = window.__LIA_FRACTION_QUIZ_V3__;
    if (!store) return;
    for (const [uid, saved] of Object.entries(states)) {
      const s = saved as { state?: boolean[] };
      if (!Array.isArray(s.state)) continue;
      const w = store.getWidget(uid);
      if (w) w.state = [...s.state];
    }
  } catch { /* best-effort */ }
}

function restoreCoord(states: Record<string, unknown>): void {
  try {
    // Merge saved board states back into the live store.
    // Full visual restore requires board objects (JSXGraph); a future step
    // can call __coord.restoreSavedBoardState per board if needed.
    const liveStore = window.__coord?.getBoardStateStore?.()
      ?? window.__coordBoardStates;
    if (!liveStore) return;
    for (const [id, state] of Object.entries(states)) {
      (liveStore as Record<string, unknown>)[id] = state;
    }
  } catch { /* best-effort */ }
}

function restoreAnnotation(data: unknown): void {
  try {
    if (!data) return;
    window.__LIA_ANNOTATION__?.importFreezeState(data, { replace: true });
  } catch { /* best-effort */ }
}

// ---- Public API ----

export async function captureSnapshot(sectionCount: number): Promise<SnapshotPayload> {
  const native = await pullNativeState();
  const canvas  = captureCanvas();
  const marker  = captureMarker();
  const ortho   = captureOrtho();
  const mathe   = captureMathe();
  const coord   = captureCoord();
  const annot   = captureAnnotation();

  // Build one SlideState per section index (0-based), mapping to hash "#N+1"
  const slides: SlideState[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const h = "#" + (i + 1);
    const slide: SlideState = { h };

    if (native.quiz[i]   != null) slide.quiz   = { [i]: native.quiz[i] };
    if (native.survey[i] != null) slide.survey  = { [i]: native.survey[i] };
    if (native.code[i]   != null) slide.code    = { [i]: native.code[i] };
    if (native.task[i]   != null) slide.task    = { [i]: native.task[i] };

    slides.push(slide);
  }

  // Plugin state is global (not per-slide), stored on the first slide for simplicity
  // and also at the payload level (annot). This matches the old payload shape.
  if (slides.length > 0) {
    if (canvas.length)          slides[0].canvas = canvas;
    if (Object.keys(marker).length || (marker as unknown[]).length) slides[0].marker = marker as unknown[];
    if (Object.keys(ortho).length)  slides[0].ortho  = ortho;
    if (Object.keys(mathe).length)  slides[0].mathe  = mathe;
    if (Object.keys(coord).length)  slides[0].coord  = coord;
  }

  return {
    v:  PAYLOAD_VERSION,
    sh: getCurrentHash(),
    s:  slides,
    annot,
  };
}

export function restoreSnapshot(payload: SnapshotPayload): void {
  if (!payload || !Array.isArray(payload.s)) return;

  // Restore native quiz/survey/code/task via port
  for (let i = 0; i < payload.s.length; i++) {
    const slide = payload.s[i];
    for (const table of ["quiz", "survey", "code", "task"] as TableName[]) {
      const tableData = slide[table] as Record<number, unknown> | undefined;
      if (!tableData) continue;
      for (const [idx, data] of Object.entries(tableData)) {
        sendRestoreEvent(table, Number(idx), data);
      }
    }
  }

  // Restore plugin state from wherever it was stored in the payload
  const first = payload.s[0];
  if (first) {
    if (Array.isArray(first.canvas)) restoreCanvas(first.canvas);
    if (Array.isArray(first.marker)) restoreMarker(first.marker);
    if (first.ortho && typeof first.ortho === "object") restoreOrtho(first.ortho);
    if (first.mathe && typeof first.mathe === "object") restoreMathe(first.mathe);
    if (first.coord && typeof first.coord === "object") restoreCoord(first.coord);
  }

  restoreAnnotation(payload.annot);
}
