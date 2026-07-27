// Captures the full student state (native quizzes + all MINT plugins) into a
// SnapshotPayload, and restores it from a payload on the teacher's side.
import { loadNativeState, sendRestoreEvent, TableName } from "./port";
import { getCurrentHash } from "./url";
import type { SubmissionDocumentMetadataV1 } from "./submission-document";
import {
  NativeDomFallbackV1,
  NativeDomTaskState,
  toSyntheticQuizElements,
} from "./native-dom";
import {
  captureOrthographyStates,
  OrthographyStateApi,
  restoreOrthographyStates,
} from "./orthography-state";
import {
  captureMatheStates,
  MatheDomHint,
  MatheFrozenStateV1,
  MathePublicApi,
  MatheStoreApi,
  restoreMatheStates,
} from "./mathe-state";
import {
  captureMarkerState,
  MarkerFrozenStateV1,
  MarkerRegistry,
  restoreMarkerState,
} from "./marker-state";
import {
  captureCoordinateStates,
  compactCoordinateStateForFreeze,
  CoordinateFrozenState,
  CoordinateFrozenStateV1,
  CoordinateRuntime,
  expandCoordinateStateForRestore,
  hasCoordinateState,
  mergeCoordinateStates,
  refreshCoordinateLateMounts,
  restoreCoordinateStates,
} from './coordinate-state';
import { sameOriginRuntimeWindows } from './runtime-windows';
import type { DevtoolsEvidenceV1, FullscreenEvidenceV1 } from './security';
import {
  buildFullCanvasFreezeState,
  compactCanvasStates,
  expandCanvasStatesForRestore,
  getCanvasStateUid,
  mergeCanvasStates,
} from './canvas-state';
import {
  AnnotationStateLimitError,
  compactAnnotationFreezeState,
  countAnnotationItems,
  expandAnnotationFreezeStateForRestore,
  mergeAnnotationFreezeStates,
} from './annotation-state';

interface CanvasFreezeApi {
  exportAllCanvasFreezeStatesFromRoot(root: Document | Element): unknown[];
  renderCanvasFreezeStateIntoPair?(pair: Element, state: unknown): Element | null;
  collectCanvasPairsFromRoot?(root: Document | Element): Element[];
  getCanvasUidFromPair?(pair: Element): string;
  getCanvasStoreEntry?(uid: string): unknown;
}

interface CanvasRuntimeBinding {
  runtimeWindow: Window;
  runtimeDocument: Document;
  api: CanvasFreezeApi;
}

interface AnnotationFreezeApi {
  exportFreezeState?(): unknown;
  exportState?(): unknown;
  importFreezeState?(data: unknown, opts?: { replace?: boolean }): boolean;
  importState?(data: unknown, opts?: { replace?: boolean }): boolean;
  hasFreezeData?(): boolean;
  setVisible?(visible: boolean): void;
  setReadOnly?(value: boolean | null): void;
  refresh?(): void;
}

// ---- Window globals declared minimally ----

declare global {
  interface Window {
    // lia-annotation
    __LIA_ANNOTATION__?: AnnotationFreezeApi;
    __LIA_ANNOTATION_FREEZE_EXPORT__?: () => unknown;
    __LIA_ANNOTATION_FREEZE_IMPORT__?: (
      data: unknown,
      opts?: { replace?: boolean },
    ) => boolean;

    // lia-canvas-ocr
    __LIA_CANVAS_OCR__?: {
      freeze: CanvasFreezeApi;
    };

    // lia-marker
    __LIA_TEXTMARKER_REG_V4__?: MarkerRegistry;

    // lia-orthography (getAllStates / setState added in Step 5)
    __ORTHOGRAPHY_EXPORT_V8__?: OrthographyStateApi;

    // lia-Mathe public API
    __LIA_FRACTION_QUIZ__?: MathePublicApi & {
      check(uid: string): boolean;
      onReveal(uid: string): boolean;
    };

    // lia-Mathe V3 store — capture fallback plus synchronized restore path.
    __LIA_FRACTION_QUIZ_V3__?: MatheStoreApi;
    __LIA_MATH_QUIZ__?: { refresh?(): void };

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
  quizEval?: Record<number, unknown>;
  survey?: Record<number, unknown>;
  code?:   Record<number, unknown>;
  task?:   Record<number, unknown>;
  canvas?: unknown[];
  marker?: MarkerFrozenStateV1 | unknown[];
  ortho?:  Record<string, unknown>;
  mathe?:  MatheFrozenStateV1 | Record<string, unknown>;
  coord?:  CoordinateFrozenState | Record<string, unknown>;
}

export interface SnapshotPayload {
  v: string;
  sh: string;
  s: SlideState[];
  nativeDom?: NativeDomFallbackV1;
  // Versioned, validated ADetails/slides metadata. Kept as unknown here to
  // avoid coupling the snapshot transport to the evaluation parser module.
  ev?: unknown;
  // Versioned counts of learner Check clicks in deferred Send mode. Kept
  // separate from LiaScript's native `trial`, which includes Freeze grading.
  sendChecks?: unknown;
  doc?: SubmissionDocumentMetadataV1;
  annot?: unknown;
  // Compatibility with the earlier decentralized Freeze payload.
  af?: unknown;
  n?: string;
  sec?: {
    trackF12: 0 | 1;
    trackTab: 0 | 1;
    f12: number;
    tab: number;
    dt?: DevtoolsEvidenceV1;
    fs?: FullscreenEvidenceV1;
  };
  slideTimeMs?: Record<string, number>;
}

export const PAYLOAD_VERSION = "sf-mini-ti-4";

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

function canvasRuntimeBindings(): CanvasRuntimeBinding[] {
  const bindings: CanvasRuntimeBinding[] = [];
  for (const runtimeWindow of sameOriginRuntimeWindows()) {
    try {
      const api = runtimeWindow.__LIA_CANVAS_OCR__?.freeze;
      const runtimeDocument = runtimeWindow.document;
      if (!api?.exportAllCanvasFreezeStatesFromRoot || !runtimeDocument) continue;
      if (bindings.some(binding => binding.api === api && binding.runtimeDocument === runtimeDocument)) continue;
      bindings.push({ runtimeWindow, runtimeDocument, api });
    } catch { /* best-effort across same-origin runtime windows */ }
  }
  return bindings;
}

function canvasPairUid(api: CanvasFreezeApi, pair: Element): string {
  try {
    const fromApi = api.getCanvasUidFromPair?.(pair);
    if (fromApi) return String(fromApi);
  } catch { /* fall back to the public mount dataset */ }
  const mount = pair.querySelector?.(".lia-canvas-mount");
  return mount ? String((mount as HTMLElement).dataset?.uid ?? "") : "";
}

function canvasPairsByUid(binding: CanvasRuntimeBinding): Map<string, Element> {
  const pairsByUid = new Map<string, Element>();
  if (!binding.api.collectCanvasPairsFromRoot) return pairsByUid;
  const pairs = binding.api.collectCanvasPairsFromRoot(binding.runtimeDocument);
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    const uid = canvasPairUid(binding.api, pair);
    if (uid && !pairsByUid.has(uid)) pairsByUid.set(uid, pair);
  }
  return pairsByUid;
}

function withFullCanvasGeometry(
  rawState: unknown,
  pair: Element | undefined,
  api: CanvasFreezeApi
): unknown {
  if (!pair || typeof api.getCanvasStoreEntry !== "function") return rawState;
  const uid = getCanvasStateUid(rawState) || canvasPairUid(api, pair);
  if (!uid) return rawState;
  try {
    const storeEntry = api.getCanvasStoreEntry(uid);
    const canvas = pair.querySelector(".lia-draw") as HTMLCanvasElement | null;
    const width = canvas
      ? (canvas.clientWidth || Number(canvas.getAttribute("width")) || undefined)
      : undefined;
    const height = canvas
      ? (canvas.clientHeight || Number(canvas.getAttribute("height")) || undefined)
      : undefined;
    return buildFullCanvasFreezeState(rawState, uid, storeEntry, { width, height })
      ?? rawState;
  } catch {
    return rawState;
  }
}

function normalizeCssColor(runtimeDocument: Document, value: unknown): string {
  const color = typeof value === "string" ? value.trim() : "";
  if (!color) return "";
  try {
    const context = runtimeDocument.createElement("canvas").getContext("2d");
    if (!context) return color.toLowerCase().replace(/\s+/g, "");
    // Invalid CSS colors leave fillStyle unchanged. Two different sentinels
    // distinguish that case from a valid color which happens to equal one.
    context.fillStyle = "#010203";
    context.fillStyle = color;
    const first = String(context.fillStyle);
    context.fillStyle = "#040506";
    context.fillStyle = color;
    const second = String(context.fillStyle);
    return first === second ? first.toLowerCase().replace(/\s+/g, "") : "";
  } catch {
    return color.toLowerCase().replace(/\s+/g, "");
  }
}

function canvasDefaultPenColor(pair: Element): string {
  try {
    const target = pair.querySelector?.(".lia-canvas-mount") ?? pair;
    const runtimeWindow = target.ownerDocument.defaultView;
    const style = runtimeWindow?.getComputedStyle(target);
    if (!style) return "";
    for (const candidate of [
      style.getPropertyValue("--canvas-pen"),
      style.getPropertyValue("--lia-course-fg"),
      style.color,
    ]) {
      if (normalizeCssColor(target.ownerDocument, candidate)) return String(candidate).trim();
    }
  } catch { /* retain the serialized literal color as fallback */ }
  return "";
}

function withCanvasThemeSemantic(state: unknown, pair: Element | undefined): unknown {
  if (!pair || !state || typeof state !== "object" || Array.isArray(state)) return state;
  const record = state as Record<string, unknown>;
  const items = record.it;
  if (!Array.isArray(items)) return state;
  const defaultColor = canvasDefaultPenColor(pair);
  const normalizedDefault = normalizeCssColor(pair.ownerDocument, defaultColor);
  if (!normalizedDefault) return state;
  let changed = false;
  const themedItems = items.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const path = item as Record<string, unknown>;
    if (path.k !== "p" || path.ck === "default") return item;
    if (normalizeCssColor(pair.ownerDocument, path.c) !== normalizedDefault) return item;
    changed = true;
    return { ...path, ck: "default" };
  });
  return changed ? { ...record, it: themedItems } : state;
}

function materializeCanvasTheme(state: unknown, pair: Element): unknown {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;
  const record = state as Record<string, unknown>;
  const items = record.it;
  if (!Array.isArray(items)) return state;
  const defaultColor = canvasDefaultPenColor(pair);
  if (!normalizeCssColor(pair.ownerDocument, defaultColor)) return state;
  let changed = false;
  const themedItems = items.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const path = item as Record<string, unknown>;
    if (path.k !== "p" || path.ck !== "default" || path.c === defaultColor) return item;
    changed = true;
    return { ...path, c: defaultColor };
  });
  return changed ? { ...record, it: themedItems } : state;
}

function captureMountedCanvasStates(): unknown[] {
  const output: unknown[] = [];
  const indexByUid = new Map<string, number>();
  for (const binding of canvasRuntimeBindings()) {
    try {
      const pairsByUid = canvasPairsByUid(binding);
      const captured = binding.api.exportAllCanvasFreezeStatesFromRoot(binding.runtimeDocument);
      for (const rawState of Array.isArray(captured) ? captured : []) {
        const uid = getCanvasStateUid(rawState);
        const pair = uid ? pairsByUid.get(uid) : undefined;
        const fullState = withFullCanvasGeometry(rawState, pair, binding.api);
        const state = withCanvasThemeSemantic(fullState, pair);
        if (uid && indexByUid.has(uid)) {
          output[indexByUid.get(uid)!] = state;
        } else {
          if (uid) indexByUid.set(uid, output.length);
          output.push(state);
        }
      }
    } catch { /* one runtime must not suppress states captured from another */ }
  }
  return output;
}

let accumulatedCanvasStates: unknown[] = [];
let pendingCanvasCaptureError: { error: Error; uid: string } | null = null;

function normalizedCanvasCaptureError(error: unknown): { error: Error; uid: string } {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const uid = /^Canvas "([^"]+)":/.exec(normalized.message)?.[1] ?? "";
  return { error: normalized, uid: uid === "<unknown>" ? "" : uid };
}

export function captureCanvasProgress(
  options: { acceptEmptyChanges?: boolean } = {}
): unknown[] {
  let current: unknown[];
  try {
    current = compactCanvasStates(captureMountedCanvasStates());
  } catch (error) {
    pendingCanvasCaptureError = normalizedCanvasCaptureError(error);
    throw pendingCanvasCaptureError.error;
  }
  if (
    pendingCanvasCaptureError?.uid
    && current.some(state => getCanvasStateUid(state) === pendingCanvasCaptureError?.uid)
  ) {
    // The previously failing Canvas was captured successfully again (normally
    // after the learner cleared or shortened it), so submission may proceed.
    pendingCanvasCaptureError = null;
  }
  accumulatedCanvasStates = mergeCanvasStates(accumulatedCanvasStates, current, options);
  return accumulatedCanvasStates;
}

function captureCanvas(): unknown[] {
  const states = captureCanvasProgress();
  if (pendingCanvasCaptureError) throw pendingCanvasCaptureError.error;
  return states;
}

const annotationFallbackApis = new WeakMap<Window, AnnotationFreezeApi>();

function annotationApis(): AnnotationFreezeApi[] {
  const apis: AnnotationFreezeApi[] = [];
  for (const runtimeWindow of sameOriginRuntimeWindows()) {
    try {
      const objectApi = runtimeWindow.__LIA_ANNOTATION__;
      if (objectApi && !apis.includes(objectApi)) {
        apis.push(objectApi);
        continue;
      }
      const exportFreezeState = runtimeWindow.__LIA_ANNOTATION_FREEZE_EXPORT__;
      const importFreezeState = runtimeWindow.__LIA_ANNOTATION_FREEZE_IMPORT__;
      if (typeof exportFreezeState === 'function' || typeof importFreezeState === 'function') {
        let fallback = annotationFallbackApis.get(runtimeWindow);
        if (!fallback) {
          fallback = {};
          annotationFallbackApis.set(runtimeWindow, fallback);
        }
        fallback.exportFreezeState = exportFreezeState;
        fallback.importFreezeState = importFreezeState;
        if (!apis.includes(fallback)) apis.push(fallback);
      }
    } catch { /* a same-origin runtime may disappear during navigation */ }
  }
  return apis;
}

function captureMountedAnnotationState(): { found: boolean; state: unknown | null } {
  let found = false;
  let bestState: unknown | null = null;
  let bestItemCount = -1;
  let limitError: Error | null = null;
  let captureError: Error | null = null;

  for (const api of annotationApis()) {
    const exportState = api.exportFreezeState ?? api.exportState;
    if (typeof exportState !== 'function') continue;
    try {
      const raw = exportState.call(api);
      const compact = compactAnnotationFreezeState(raw);
      if (compact === null && !expandAnnotationFreezeStateForRestore(raw)) {
        throw new Error('Unsupported or invalid Annotation freeze state.');
      }
      const itemCount = countAnnotationItems(compact);
      found = true;
      if (itemCount > bestItemCount || (itemCount === bestItemCount && compact !== null)) {
        bestItemCount = itemCount;
        bestState = compact;
      }
    } catch (error) {
      if (error instanceof AnnotationStateLimitError) {
        limitError = error;
      } else {
        captureError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  if (limitError) throw limitError;
  if (!found && captureError) throw captureError;
  return { found, state: bestState };
}

let accumulatedAnnotationState: unknown | null = null;
let pendingAnnotationCaptureError: Error | null = null;

export function captureAnnotationProgress(
  options: { acceptEmptyChanges?: boolean } = {},
): unknown | null {
  let current: ReturnType<typeof captureMountedAnnotationState>;
  try {
    current = captureMountedAnnotationState();
  } catch (error) {
    pendingAnnotationCaptureError = error instanceof Error ? error : new Error(String(error));
    throw pendingAnnotationCaptureError;
  }
  if (!current.found) return accumulatedAnnotationState;

  pendingAnnotationCaptureError = null;
  accumulatedAnnotationState = mergeAnnotationFreezeStates(
    accumulatedAnnotationState,
    current.state,
    options,
  );
  return accumulatedAnnotationState;
}

function captureAnnotation(): unknown | null {
  const state = captureAnnotationProgress();
  if (pendingAnnotationCaptureError) throw pendingAnnotationCaptureError;
  return state;
}

function orthographyApi(): OrthographyStateApi | undefined {
  const local = window.__ORTHOGRAPHY_EXPORT_V8__;
  if (local) return local;
  try {
    let root: Window = window;
    while (root.parent && root.parent !== root) root = root.parent;
    return root.__ORTHOGRAPHY_EXPORT_V8__;
  } catch { /* cross-origin parent: use the current runtime */ }
  return local;
}

function captureOrtho(): Record<string, unknown> {
  try {
    return captureOrthographyStates(orthographyApi());
  } catch { return {}; }
}

function markerRegistries(): MarkerRegistry[] {
  const registries: MarkerRegistry[] = [];
  for (const runtimeWindow of sameOriginRuntimeWindows()) {
    try {
      const registry = runtimeWindow.__LIA_TEXTMARKER_REG_V4__;
      if (registry && !registries.includes(registry)) registries.push(registry);
    } catch { /* best-effort across same-origin runtime windows */ }
  }
  return registries;
}

function captureMarker(): MarkerFrozenStateV1 {
  try {
    return captureMarkerState(markerRegistries());
  } catch {
    return { v: 1, i: [] };
  }
}

function matheRuntime(): { api?: MathePublicApi; store?: MatheStoreApi } {
  let api: MathePublicApi | undefined;
  let store: MatheStoreApi | undefined;
  for (const runtimeWindow of sameOriginRuntimeWindows()) {
    api ??= runtimeWindow.__LIA_FRACTION_QUIZ__;
    store ??= runtimeWindow.__LIA_FRACTION_QUIZ_V3__;
  }
  return { api, store };
}

function positiveRangeValue(element: Element | null): number | undefined {
  if (!(element instanceof HTMLInputElement)) return undefined;
  const value = Number.parseInt(element.value, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function captureMatheDomHints(): Record<string, MatheDomHint> {
  const hints: Record<string, MatheDomHint> = {};
  document.querySelectorAll<HTMLElement>(".fq-widget[data-fq-uid]").forEach(element => {
    const uid = element.dataset.fqUid || "";
    if (!uid) return;
    const kind = element.dataset.fqKind;
    if (kind === "circle") {
      const range = document.getElementById("fq-circle-range-" + uid);
      hints[uid] = {
        kind,
        parts: positiveRangeValue(range?.querySelector('input[type="range"]') ?? null),
      };
    } else if (kind === "rect") {
      const rows = document.getElementById("fq-rect-rows-wrap-" + uid);
      const cols = document.getElementById("fq-rect-cols-wrap-" + uid);
      hints[uid] = {
        kind,
        rows: positiveRangeValue(rows?.querySelector('input[type="range"]') ?? null),
        cols: positiveRangeValue(cols?.querySelector('input[type="range"]') ?? null),
      };
    }
  });
  return hints;
}

function captureMathe(): MatheFrozenStateV1 {
  try {
    const runtime = matheRuntime();
    return captureMatheStates(runtime.api, runtime.store, captureMatheDomHints());
  } catch {
    return { v: 1, w: {} };
  }
}

function coordinateRuntimes(): CoordinateRuntime[] {
  return sameOriginRuntimeWindows().map(runtime => runtime as unknown as CoordinateRuntime);
}

let accumulatedCoordinateState: CoordinateFrozenStateV1 = { v: 1 };

export function captureCoordinateProgress(
  options: { acceptSliderChanges?: boolean; acceptScharChanges?: boolean } = {}
): CoordinateFrozenStateV1 {
  try {
    const current = captureCoordinateStates(coordinateRuntimes());
    if (!options.acceptSliderChanges && current.z && accumulatedCoordinateState.z) {
      // Proposal re-runs __bootstrapSliders during slide teardown and writes
      // the authored default back into the live slider. Lifecycle/final
      // captures must not replace an already observed learner value with that
      // transient reset. A real pointer/input interaction explicitly opts in
      // below and can therefore also set a slider back to its default.
      for (const key of Object.keys(current.z)) {
        if (Object.prototype.hasOwnProperty.call(accumulatedCoordinateState.z, key)) {
          delete current.z[key];
        }
      }
      if (!Object.keys(current.z).length) delete current.z;
    }
    if (!options.acceptScharChanges && current.s && accumulatedCoordinateState.s) {
      // Proposal's Schar MutationObserver can rebuild an otherwise unchanged
      // panel at scale 0.55 during teardown. Preserve the latest explicitly
      // observed learner interaction instead of that transient lifecycle reset.
      for (const key of Object.keys(current.s)) {
        if (Object.prototype.hasOwnProperty.call(accumulatedCoordinateState.s, key)) {
          delete current.s[key];
        }
      }
      if (!Object.keys(current.s).length) delete current.s;
    }
    accumulatedCoordinateState = mergeCoordinateStates(accumulatedCoordinateState, current);
  } catch { /* keep the last validated progress snapshot */ }
  return accumulatedCoordinateState;
}

function captureCoord(): CoordinateFrozenState {
  return compactCoordinateStateForFreeze(captureCoordinateProgress());
}

// ---- Restore helpers ----

function canvasPairAlreadyRestored(pair: Element, uid: string): boolean {
  const mount = pair.querySelector?.(".lia-canvas-mount") as HTMLElement | null;
  if (!mount || mount.dataset.liaFreezeCanvasRestored !== uid) return false;
  return !!mount.querySelector(".lia-canvas-freeze-preview, .lia-canvas-freeze-empty");
}

function markCanvasPairRestored(pair: Element, uid: string): void {
  const mount = pair.querySelector?.(".lia-canvas-mount") as HTMLElement | null;
  if (mount) mount.dataset.liaFreezeCanvasRestored = uid;
}

function restoreCanvas(statesByUid: ReadonlyMap<string, unknown>): number {
  if (!statesByUid.size) return 0;
  let applied = 0;

  for (const binding of canvasRuntimeBindings()) {
    if (!binding.api.renderCanvasFreezeStateIntoPair || !binding.api.collectCanvasPairsFromRoot) continue;
    try {
      // Collect and index each runtime exactly once per restore pass. States
      // never cross into a document owned by another API realm.
      const pairsByUid = canvasPairsByUid(binding);
      for (const [uid, state] of statesByUid) {
        const pair = pairsByUid.get(uid);
        if (!pair || canvasPairAlreadyRestored(pair, uid)) continue;
        const rendered = binding.api.renderCanvasFreezeStateIntoPair(
          pair,
          materializeCanvasTheme(state, pair),
        );
        if (rendered) {
          markCanvasPairRestored(pair, uid);
          applied += 1;
        }
      }
    } catch { /* isolate a stale runtime while later retries continue */ }
  }

  return applied;
}

let activeCanvasStatesByUid = new Map<string, unknown>();

function scheduleCanvasRestore(states: unknown[]): void {
  const expanded = expandCanvasStatesForRestore(Array.isArray(states) ? states : []);
  const nextByUid = new Map<string, unknown>();
  for (const state of expanded) {
    const uid = getCanvasStateUid(state);
    if (uid) nextByUid.set(uid, state);
  }
  activeCanvasStatesByUid = nextByUid;
  restoreCanvas(activeCanvasStatesByUid);
  [0, 120, 360, 800, 1600, 3200, 6000].forEach(delay => {
    window.setTimeout(() => { restoreCanvas(activeCanvasStatesByUid); }, delay);
  });
}

export function activateCanvasSnapshot(states: unknown[]): void {
  scheduleCanvasRestore(states);
}

export function refreshCanvasRender(): void {
  if (activeCanvasStatesByUid.size) restoreCanvas(activeCanvasStatesByUid);
}

function nudgeMarkerRender(): void {
  for (const runtimeWindow of sameOriginRuntimeWindows()) {
    try {
      const EventCtor = (runtimeWindow as Window & typeof globalThis).Event;
      runtimeWindow.dispatchEvent(new EventCtor("resize"));
    } catch { /* best-effort render signal for lia-marker 0.0.1 */ }
  }
}

export function refreshMarkerRender(): void {
  if (activeMarkerReviewState) {
    scheduleMarkerRestore(activeMarkerReviewState);
    return;
  }
  nudgeMarkerRender();
}

function restoreMarker(state: unknown): boolean {
  try {
    const applied = restoreMarkerState(markerRegistries(), state);
    if (applied) nudgeMarkerRender();
    return applied;
  } catch {
    return false;
  }
}

let markerRestoreGeneration = 0;
let activeMarkerReviewState: MarkerFrozenStateV1 | null = null;

export function cancelPendingMarkerRestore(): void {
  markerRestoreGeneration += 1;
}

export function captureMarkerReviewState(): MarkerFrozenStateV1 | null {
  const state = captureMarkerState(markerRegistries());
  if (!state.i.length) return null;
  const solutionCount = (value: MarkerFrozenStateV1): number =>
    value.i.reduce(
      (count, instance) => count + instance.h.filter(item => item.kind === 'solution').length,
      0
    );
  const nextSolutions = solutionCount(state);
  const savedSolutions = activeMarkerReviewState
    ? solutionCount(activeMarkerReviewState)
    : 0;
  // The click callback runs before lia-marker's document-level handler. Ignore
  // early or remount captures that contain only the original user highlights,
  // and never let a later intermediate render remove an observed solution.
  if (nextSolutions === 0 || nextSolutions < savedSolutions) {
    return activeMarkerReviewState;
  }
  activeMarkerReviewState = state;
  cancelPendingMarkerRestore();
  return state;
}

function scheduleMarkerRestore(state: unknown): void {
  // The template registry, prefills and current slide DOM initialize
  // independently. Re-apply the exact saved array after each phase.
  const generation = ++markerRestoreGeneration;
  [0, 120, 360, 800, 1600, 3200, 6000].forEach(delay => {
    window.setTimeout(() => {
      if (generation !== markerRestoreGeneration) return;
      restoreMarker(state);
    }, delay);
  });
}

function restoreOrtho(states: Record<string, unknown>): boolean {
  try {
    return restoreOrthographyStates(orthographyApi(), states);
  } catch { return false; }
}

function scheduleOrthoRestore(states: Record<string, unknown>): void {
  if (restoreOrtho(states)) return;
  [0, 120, 360, 800, 1600, 3200, 6000].forEach(delay => {
    window.setTimeout(() => { restoreOrtho(states); }, delay);
  });
}

function restoreMathe(states: unknown): boolean {
  try {
    return restoreMatheStates(matheRuntime().store, states);
  } catch {
    return false;
  }
}

function scheduleMatheRestore(states: unknown): void {
  if (restoreMathe(states)) return;
  [0, 120, 360, 800, 1600, 3200, 6000].forEach(delay => {
    window.setTimeout(() => { restoreMathe(states); }, delay);
  });
}

function scheduleFormulaQuizRefresh(): void {
  [0, 80, 240, 600, 1200].forEach(delay => {
    window.setTimeout(() => {
      for (const runtimeWindow of sameOriginRuntimeWindows()) {
        try { runtimeWindow.__LIA_MATH_QUIZ__?.refresh?.(); } catch { /* best-effort */ }
      }
    }, delay);
  });
}

let activeCoordinateState: unknown;
let activeCoordinateGeneration = 0;

function restoreCoord(states: unknown): boolean {
  try {
    return restoreCoordinateStates(coordinateRuntimes(), states);
  } catch { return false; }
}

function scheduleCoordinateRestore(states: unknown): void {
  const generation = ++activeCoordinateGeneration;
  activeCoordinateState = undefined;
  const expanded = expandCoordinateStateForRestore(states);
  if (!expanded || !hasCoordinateState(expanded)) return;
  activeCoordinateState = expanded;
  restoreCoord(expanded);
  // LiaScript, JSXGraph and the Proposal template mount independently. Each
  // retry seeds newly-created runtimes first and then hydrates their live UI.
  [0, 80, 200, 480, 900, 1600, 3200, 6000].forEach(delay => {
    window.setTimeout(() => {
      if (generation === activeCoordinateGeneration && activeCoordinateState === expanded) {
        restoreCoord(expanded);
      }
    }, delay);
  });
}

export function refreshCoordinateRender(): void {
  // Proposal's Regression/DGS init can run before LiaScript inserts its
  // anchors. These two scans are idempotent and do not reset edited sliders.
  refreshCoordinateLateMounts(coordinateRuntimes());
  if (activeCoordinateState !== undefined) restoreCoord(activeCoordinateState);
}

let activeAnnotationState: Record<string, unknown> | null = null;
let annotationSnapshotActive = false;
let activeAnnotationGeneration = 0;
let importedAnnotationGeneration = 0;

function restoreAnnotationPass(): number {
  let applied = 0;
  for (const api of annotationApis()) {
    try {
      const importState = api.importFreezeState ?? api.importState;
      if (
        activeAnnotationState
        && typeof importState === 'function'
        && importedAnnotationGeneration !== activeAnnotationGeneration
      ) {
        if (importState.call(api, activeAnnotationState, { replace: true }) !== false) {
          // Official lia-annotation APIs in same-origin runtimes share one
          // root store. Import once, then refresh every late API without
          // resetting a teacher's subsequent show/hide choice.
          importedAnnotationGeneration = activeAnnotationGeneration;
          applied++;
        }
      }
      if (annotationSnapshotActive) api.setReadOnly?.(true);
      api.refresh?.();
    } catch { /* isolate a stale runtime while later retries continue */ }
  }
  return applied;
}

export function activateAnnotationSnapshot(data: unknown): void {
  annotationSnapshotActive = true;
  activeAnnotationState = expandAnnotationFreezeStateForRestore(data);
  activeAnnotationGeneration++;
  restoreAnnotationPass();
  [0, 120, 360, 800, 1600, 3200, 6000].forEach(delay => {
    window.setTimeout(restoreAnnotationPass, delay);
  });
}

export function refreshAnnotationRender(): void {
  restoreAnnotationPass();
}

// ---- Public API ----

export async function captureSnapshot(
  sectionCount: number,
  options: { nativeDom?: NativeDomFallbackV1 } = {}
): Promise<SnapshotPayload> {
  const native = await pullNativeState();
  const canvas  = captureCanvas();
  const marker  = captureMarker();
  const ortho   = captureOrtho();
  const mathe   = captureMathe();
  const coord   = captureCoord();
  const annot   = captureAnnotation();
  const domSlides: Record<string, NativeDomTaskState[]> = {};

  const hasNativeState = (value: unknown): boolean => {
    if (value == null) return false;
    return !Array.isArray(value) || value.length > 0;
  };

  // Build one SlideState per section index (0-based), mapping to hash "#N+1"
  const slides: SlideState[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const h = "#" + (i + 1);
    const slide: SlideState = { h };
    const hasNativeQuiz = hasNativeState(native.quiz[i]);
    const hasNativeSurvey = hasNativeState(native.survey[i]);
    const capturedTasks = options.nativeDom?.slides?.[h] ?? [];
    const evaluationFallbackTasks = capturedTasks.filter(task =>
      task.kind === "tile"
      || (task.table === "quiz" ? !hasNativeQuiz : !hasNativeSurvey)
      // A checked DOM result is newer than an IndexedDB row that may still be
      // settling when the student clicks Abgabe immediately after correcting.
      || (task.table === "quiz" && task.outcome !== "open")
    );
    // Native LiaScript state remains authoritative for scoring, but it does not
    // consistently replay the visible values of wrong/partial multi-input
    // quizzes (notably @diktat). Keep meaningful DOM tasks for visual restore
    // even when a native table entry exists.
    const visualFallbackTasks = capturedTasks.filter(task =>
      task.touched === 1 || task.outcome !== "open"
    );

    if (hasNativeQuiz) slide.quiz = { [i]: native.quiz[i] };
    const synthetic = toSyntheticQuizElements(evaluationFallbackTasks);
    if (synthetic.length) slide.quizEval = { [i]: synthetic };
    if (hasNativeSurvey) slide.survey = { [i]: native.survey[i] };
    if (native.code[i]   != null) slide.code    = { [i]: native.code[i] };
    if (native.task[i]   != null) slide.task    = { [i]: native.task[i] };
    if (visualFallbackTasks.length) domSlides[h] = visualFallbackTasks;

    slides.push(slide);
  }

  // Plugin state is global (not per-slide), stored on the first slide for simplicity
  // and also at the payload level (annot). This matches the old payload shape.
  if (slides.length > 0) {
    if (canvas.length)          slides[0].canvas = canvas;
    if (marker.i.length)       slides[0].marker = marker;
    if (Object.keys(ortho).length)  slides[0].ortho  = ortho;
    if (Object.keys(mathe.w).length) slides[0].mathe = mathe;
    if (hasCoordinateState(coord)) slides[0].coord = coord;
  }

  const payload: SnapshotPayload = {
    v:  PAYLOAD_VERSION,
    sh: getCurrentHash(),
    s:  slides,
    annot,
  };
  if (Object.keys(domSlides).length) {
    payload.nativeDom = { version: 1, slides: domSlides };
  }
  return payload;
}

export function restoreSnapshot(payload: SnapshotPayload): void {
  if (!payload || !Array.isArray(payload.s)) return;
  activeMarkerReviewState = null;

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
    if (first.ortho && typeof first.ortho === "object") scheduleOrthoRestore(first.ortho);
  }
  const canvasSlide = payload.s.find(slide => Array.isArray(slide.canvas));
  if (canvasSlide?.canvas) scheduleCanvasRestore(canvasSlide.canvas);
  const markerSlide = payload.s.find(slide => slide.marker !== undefined);
  if (markerSlide?.marker !== undefined) scheduleMarkerRestore(markerSlide.marker);
  const matheSlide = payload.s.find(slide => slide.mathe && typeof slide.mathe === "object");
  if (matheSlide?.mathe) scheduleMatheRestore(matheSlide.mathe);
  const coordinateSlide = payload.s.find(slide => slide.coord && typeof slide.coord === 'object');
  if (coordinateSlide?.coord) scheduleCoordinateRestore(coordinateSlide.coord);
  scheduleFormulaQuizRefresh();

  activateAnnotationSnapshot(payload.annot ?? payload.af);
}
