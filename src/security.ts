// Tracks browser signals related to developer tools and tab/window switches.
// A normal web page cannot prove that DevTools are open. The tracker therefore
// stores bounded, auditable signals and confidence information instead of
// turning a single heuristic into a fraud verdict.

export type BrowserFamily = "chromium" | "firefox" | "safari" | "other";
export type DevtoolsSignalKind = "k" | "g" | "c";
export type DevtoolsEvidenceEventV1 = [
  kind: DevtoolsSignalKind,
  elapsedMs: number,
  detail: string,
];

export interface DevtoolsEvidenceV1 {
  v: 1;
  b: BrowserFamily;
  /** Trusted DevTools-related shortcut candidates, including combined ones. */
  k: number;
  /** Stable, calibrated viewport anomalies, including combined ones. */
  g: number;
  /** Shortcut candidates confirmed by a matching viewport anomaly. */
  c: number;
  /** Latest bounded evidence tuples: kind, elapsed time, allow-listed detail. */
  e: DevtoolsEvidenceEventV1[];
}

export type FullscreenEvidenceKind = "x" | "a";
export type FullscreenEvidenceEventV1 = [
  kind: FullscreenEvidenceKind,
  elapsedMs: number,
  detail: "exit" | "lia-mathpath-explain",
];

export interface FullscreenEvidenceV1 {
  v: 1;
  /** 0 not requested, 1 entered, 2 unsupported, 3 denied/failed, 4 pending. */
  r: 0 | 1 | 2 | 3 | 4;
  /** Unapproved exits after a confirmed fullscreen entry. */
  x: number;
  /** Confirmed lia-mathpath @Explain transitions excluded from x. */
  a: number;
  /** Latest bounded transition tuples. */
  e: FullscreenEvidenceEventV1[];
}

export interface SecurityState {
  /** Legacy-compatible shortcut incident count. Geometry-only hints stay out. */
  f12: number;
  tab: number;
  devtools: DevtoolsEvidenceV1;
  fullscreen: FullscreenEvidenceV1;
}

export interface F12TrackingOptions {
  onTrigger?: () => void;
  /** False keeps listeners installed but disarms all collection. */
  isActive?: () => boolean;
}

export interface TabTrackingOptions {
  onTrigger?: () => void;
  /** False keeps listeners installed but disarms all collection. */
  isActive?: () => boolean;
  /** Enables the exact runtime proof; normally gated by the authored import. */
  allowMathpathExplain?: boolean;
}

export interface ExamFullscreenTrackingOptions {
  /** Fullscreen exits are recorded only while this returns true. */
  isActive?: () => boolean;
  /** Enables the exact runtime proof; normally gated by the authored import. */
  allowMathpathExplain?: boolean;
}

export type ExamFullscreenRequestResult = "entered" | "unsupported" | "denied" | "pending";

interface GeometrySample {
  outerW: number;
  outerH: number;
  innerW: number;
  innerH: number;
  gapW: number;
  gapH: number;
  dpr: number;
  scale: number;
}

type GeometryMode =
  | "inactive"
  | "calibrating"
  | "closed"
  | "candidate-open"
  | "open"
  | "candidate-close"
  | "suppressed";

const MAX_EVIDENCE_EVENTS = 24;
const GEOMETRY_POLL_MS = 250;
const CALIBRATION_SAMPLES = 6;
const CALIBRATION_MS = 1000;
const OPEN_CONFIRM_SAMPLES = 4;
const OPEN_CONFIRM_MS = 900;
const CLOSE_CONFIRM_SAMPLES = 3;
const CLOSE_CONFIRM_MS = 600;
const GEOMETRY_SUPPRESS_MS = 1800;
const SHORTCUT_GEOMETRY_COALESCE_MS = 2500;
const SHORTCUT_DEDUPE_MS = 300;
const EXPLAIN_GRACE_MS = 2500;
const EXPLAIN_ESCAPE_GRACE_MS = 750;
const FULLSCREEN_TAB_SUPPRESS_MS = 900;
const FULLSCREEN_REQUEST_TIMEOUT_MS = 5000;
const WEBKIT_REQUEST_CONFIRM_MS = 2000;

const state = { f12: 0, tab: 0 };

let f12Installed = false;
let tabInstalled = false;
let fullscreenInstalled = false;
let f12Options: F12TrackingOptions = {};
let tabOptions: TabTrackingOptions = {};
let fullscreenOptions: ExamFullscreenTrackingOptions = {};

let lastTabStamp = -1;
let tabArmed = false;
let tabBlurTimer = 0;

let fullscreenEvidence: FullscreenEvidenceV1 = createFullscreenEvidence();
let fullscreenRequested = false;
let fullscreenWasEntered = false;
let fullscreenStartedAt = 0;
let fullscreenTabSuppressedUntil = 0;
let fullscreenDocument: Document | null = null;
let fullscreenTarget: Element | null = null;

interface ExplainAllowance {
  doc: Document;
  frame: HTMLIFrameElement;
  href: string;
  expiresAt: number;
  source: "click" | "escape";
  blurConsumed: boolean;
  fullscreenConsumed: boolean;
}

let explainAllowance: ExplainAllowance | null = null;
const explainListenerDocuments = new WeakSet<object>();

let browserFamily: BrowserFamily = detectBrowserFamily();
let evidence: DevtoolsEvidenceV1 = createEvidence();
let trackingStartedAt = 0;
let trackingWasActive = false;
let lastShortcutAt = -Infinity;
let lastShortcutObservedAt = -Infinity;
let lastShortcutSignature = "";
let lastShortcutEvidence: DevtoolsEvidenceEventV1 | null = null;
let pendingShortcutWhileOpen: { at: number; detail: string } | null = null;

let geometryMode: GeometryMode = "inactive";
let geometryBaseline: GeometrySample | null = null;
let geometrySamples: GeometrySample[] = [];
let geometryStateStartedAt = 0;
let geometryCandidateAxis = "";
let geometryCandidateCount = 0;
let geometrySuppressedUntil = 0;

function detectBrowserFamily(): BrowserFamily {
  const ua = typeof navigator === "undefined" ? "" : String(navigator.userAgent || "");
  if (/Firefox|FxiOS/i.test(ua)) return "firefox";
  if (/Edg|OPR|Chrome|Chromium|CriOS|Brave/i.test(ua)) return "chromium";
  if (/Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR/i.test(ua)) return "safari";
  return "other";
}

function createEvidence(): DevtoolsEvidenceV1 {
  return { v: 1, b: browserFamily, k: 0, g: 0, c: 0, e: [] };
}

function createFullscreenEvidence(): FullscreenEvidenceV1 {
  return { v: 1, r: 0, x: 0, a: 0, e: [] };
}

function monotonicNow(): number {
  try {
    const value = window.performance?.now?.();
    if (Number.isFinite(value)) return Number(value);
  } catch { /* fall through */ }
  try {
    const value = performance.now();
    if (Number.isFinite(value)) return Number(value);
  } catch { /* fall through */ }
  return Date.now();
}

function getSameOriginRootWin(): Window {
  let current: Window = window;
  try {
    while (current.parent && current.parent !== current) {
      const parent = current.parent as Window;
      // Accessing document is the same-origin guard. Never return an
      // inaccessible root WindowProxy and then dereference it elsewhere.
      void parent.document;
      current = parent;
    }
  } catch { /* keep highest accessible window */ }
  return current;
}

function isFrozen(): boolean {
  try {
    if (document.body?.classList.contains("lia-snapshot-mode")) return true;
  } catch { /* continue with root */ }
  try {
    return !!getSameOriginRootWin().document.body?.classList.contains("lia-snapshot-mode");
  } catch {
    return false;
  }
}

/**
 * Enables the narrow @Explain exception only for a real course integration:
 * the canonical lia-mathpath import must be in the LiaScript header and an
 * authored hint use must occur outside fenced examples.
 */
export function courseUsesMathpathExplain(markdown: string): boolean {
  const source = String(markdown || "");
  const header = source.match(/^\uFEFF?\s*<!--([\s\S]*?)-->/)?.[1] ?? "";
  const hasCanonicalImport = /^\s*import\s*:\s*https:\/\/raw\.githubusercontent\.com\/MINT-the-GAP\/lia-mathpath\/(?:master|Proposal|refs\/heads\/(?:master|Proposal)|[0-9a-fA-F]{40})\/README\.md(?:[?#][^\s]*)?\s*$/m.test(header);
  if (!hasCanonicalImport) return false;

  const authoredSource = source.replace(/<!--[\s\S]*?-->/g, "");
  let fence: { kind: string; length: number } | null = null;
  for (const line of authoredSource.split(/\r?\n/)) {
    const marker = line.match(/^\s*((?:\x60){3,}|~{3,})/);
    if (marker) {
      const kind = marker[1][0];
      if (!fence) {
        fence = { kind, length: marker[1].length };
      } else if (
        fence.kind === kind
        && marker[1].length >= fence.length
        && line.slice((marker.index || 0) + marker[0].length).trim() === ""
      ) {
        fence = null;
      }
      continue;
    }
    if (!fence && /^\s*\[\[\?\]\][^\r\n]*@Explain(?:\s|$)/.test(line)) return true;
  }
  return false;
}

function configuredTabActive(): boolean {
  if (isFrozen()) return false;
  try { return tabOptions.isActive ? tabOptions.isActive() === true : true; }
  catch { return false; }
}

function configuredFullscreenActive(): boolean {
  if (isFrozen()) return false;
  try { return fullscreenOptions.isActive ? fullscreenOptions.isActive() === true : true; }
  catch { return false; }
}

function mathpathExplainAllowed(): boolean {
  return tabOptions.allowMathpathExplain === true
    || fullscreenOptions.allowMathpathExplain === true;
}

function clearExplainAllowance(): void {
  explainAllowance = null;
}

function eventTargetElement(event: Event): Element | null {
  try {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const item of path) {
      if (item && typeof (item as Element).closest === "function") return item as Element;
    }
  } catch { /* fall back to target */ }
  const target = event.target as Element | null;
  return target && typeof target.closest === "function" ? target : null;
}

function normalizedHttpUrl(value: string, doc: Document): string | null {
  try {
    const base = doc.defaultView?.location.href || getSameOriginRootWin().location.href;
    const parsed = new URL(value, base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function confirmedExplainOverlay(
  doc: Document,
  expectedHref?: string,
): { frame: HTMLIFrameElement; href: string } | null {
  try {
    if (!doc.body?.classList.contains("lia-mathpath-overlay-open")) return null;
    const overlay = doc.querySelector<HTMLElement>('.lia-mathpath-explain-overlay[data-open="1"]');
    if (!overlay) return null;
    const frame = overlay.querySelector<HTMLIFrameElement>("iframe.lia-mathpath-explain-frame");
    if (!frame) return null;
    const href = normalizedHttpUrl(frame.getAttribute("src") || frame.src || "", doc);
    if (!href || (expectedHref && href !== expectedHref)) return null;
    return { frame, href };
  } catch {
    return null;
  }
}

function grantExplainAllowance(
  doc: Document,
  frame: HTMLIFrameElement,
  href: string,
  now: number,
  source: "click" | "escape",
): void {
  explainAllowance = {
    doc,
    frame,
    href,
    expiresAt: now + EXPLAIN_GRACE_MS,
    source,
    blurConsumed: false,
    fullscreenConsumed: false,
  };
}

function consumeExplainFullscreenAllowance(now: number): boolean {
  const allowance = explainAllowance;
  if (!allowance || allowance.fullscreenConsumed) return false;
  if (isFrozen()) { clearExplainAllowance(); return false; }
  if (allowance.source === "click") {
    // Keep the one fullscreen allowance for the lifetime of the confirmed
    // overlay. Some browsers consume Escape before the parent sees keydown.
    if (!confirmedExplainOverlay(allowance.doc, allowance.href)) {
      clearExplainAllowance();
      return false;
    }
  } else if (now > allowance.expiresAt) {
    clearExplainAllowance();
    return false;
  }
  allowance.fullscreenConsumed = true;
  allowance.blurConsumed = true;
  return true;
}

function consumeExplainBlurAllowance(now: number): boolean {
  const allowance = explainAllowance;
  if (!allowance
    || allowance.source !== "click"
    || allowance.blurConsumed
    || now > allowance.expiresAt
    || isFrozen()) return false;
  try {
    if (allowance.doc.visibilityState === "hidden") return false;
    const confirmed = confirmedExplainOverlay(allowance.doc, allowance.href);
    if (!confirmed || confirmed.frame !== allowance.frame) return false;
    if (allowance.doc.activeElement !== allowance.frame) return false;
  } catch {
    return false;
  }
  allowance.blurConsumed = true;
  return true;
}

function handleExplainClick(event: MouseEvent): void {
  if (!mathpathExplainAllowed()
    || event.isTrusted !== true
    || event.button !== 0
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || event.altKey) return;

  const target = eventTargetElement(event);
  const link = target?.closest(
    "a.lia-mathpath-explain-link[data-lia-explain-href]",
  ) as HTMLAnchorElement | null;
  if (!link) return;
  const hints = link.closest(".lia-quiz__hints");
  const quiz = link.closest(".lia-quiz");
  const hintItem = link.closest("li.lia-mathpath-no-glossary");
  const flattenedHint = !!hintItem
    && hintItem.parentElement === hints
    && hints?.closest(".lia-quiz") === quiz;
  if (!hints
    || !quiz
    || !flattenedHint) return;

  const doc = link.ownerDocument;
  const dataHref = normalizedHttpUrl(link.getAttribute("data-lia-explain-href") || "", doc);
  const anchorHref = normalizedHttpUrl(link.getAttribute("href") || link.href || "", doc);
  if (!dataHref || !anchorHref || dataHref !== anchorHref) return;
  const clickedAt = monotonicNow();

  // lia-mathpath opens the overlay in its bubbling click handler. Confirm the
  // resulting DOM in a microtask instead of trusting a class-shaped link.
  void Promise.resolve().then(() => {
    if (!mathpathExplainAllowed() || monotonicNow() > clickedAt + EXPLAIN_GRACE_MS) return;
    const confirmed = confirmedExplainOverlay(doc, dataHref);
    if (!confirmed) return;
    grantExplainAllowance(doc, confirmed.frame, confirmed.href, clickedAt, "click");
  });
}

function handleExplainEscape(event: KeyboardEvent): void {
  if (!mathpathExplainAllowed()
    || event.isTrusted !== true
    || event.key !== "Escape"
    || event.repeat
    || event.isComposing
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || event.altKey) return;
  const target = eventTargetElement(event);
  const doc = target?.ownerDocument || document;
  const confirmed = confirmedExplainOverlay(doc);
  if (!confirmed) return;
  // Escape is also the browser's normal fullscreen exit key. Capture the
  // confirmed course overlay before lia-mathpath closes it in its bubble phase.
  const now = monotonicNow();
  grantExplainAllowance(doc, confirmed.frame, confirmed.href, now, "escape");
  if (explainAllowance) explainAllowance.expiresAt = now + EXPLAIN_ESCAPE_GRACE_MS;
}

function installExplainActivityTracking(docs: Document[]): void {
  if (!mathpathExplainAllowed()) return;
  docs.forEach(doc => {
    if (explainListenerDocuments.has(doc)) return;
    explainListenerDocuments.add(doc);
    doc.addEventListener("click", handleExplainClick as EventListener, true);
    doc.addEventListener("keydown", handleExplainEscape as EventListener, true);
  });
}

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitCurrentFullScreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitIsFullScreen?: boolean;
};

type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
};

function currentFullscreenElement(doc: Document): Element | null {
  try {
    const webkitDoc = doc as WebkitDocument;
    return doc.fullscreenElement
      || webkitDoc.webkitFullscreenElement
      || webkitDoc.webkitCurrentFullScreenElement
      || (webkitDoc.webkitIsFullScreen ? fullscreenTarget : null)
      || null;
  } catch {
    return null;
  }
}

function fullscreenElapsed(now: number): number {
  return Math.max(0, Math.min(2147483647, Math.round(now - fullscreenStartedAt)));
}

function pushFullscreenEvent(event: FullscreenEvidenceEventV1): void {
  fullscreenEvidence.e.push(event);
  if (fullscreenEvidence.e.length > MAX_EVIDENCE_EVENTS) {
    fullscreenEvidence.e.splice(0, fullscreenEvidence.e.length - MAX_EVIDENCE_EVENTS);
  }
}

function markFullscreenEntered(element: Element | null): void {
  if (!fullscreenTarget || element !== fullscreenTarget) return;
  fullscreenWasEntered = true;
  fullscreenEvidence.r = 1;
}

function handleFullscreenChange(): void {
  const now = monotonicNow();
  suppressGeometry(now);
  fullscreenTabSuppressedUntil = Math.max(
    fullscreenTabSuppressedUntil,
    now + FULLSCREEN_TAB_SUPPRESS_MS,
  );
  const doc = fullscreenDocument || document;
  const current = currentFullscreenElement(doc);
  if (current) {
    if (fullscreenRequested) markFullscreenEntered(current);
    return;
  }
  if (!fullscreenWasEntered) return;
  fullscreenWasEntered = false;
  if (!configuredFullscreenActive()) return;

  if (consumeExplainFullscreenAllowance(now)) {
    fullscreenEvidence.a += 1;
    pushFullscreenEvent(["a", fullscreenElapsed(now), "lia-mathpath-explain"]);
    return;
  }
  fullscreenEvidence.x += 1;
  pushFullscreenEvent(["x", fullscreenElapsed(now), "exit"]);
}

function handleFullscreenError(): void {
  if (fullscreenRequested && !fullscreenWasEntered && fullscreenEvidence.r !== 1) {
    fullscreenEvidence.r = 3;
    fullscreenTarget = null;
  }
}

function configuredActive(): boolean {
  if (isFrozen()) return false;
  try { return f12Options.isActive ? f12Options.isActive() === true : true; }
  catch { return false; }
}

function isMacLike(): boolean {
  const platform = typeof navigator === "undefined" ? "" : String(navigator.platform || "");
  const ua = typeof navigator === "undefined" ? "" : String(navigator.userAgent || "");
  return /Mac|iPhone|iPad|iPod/i.test(platform + " " + ua);
}

function skipGeometryHeuristic(): boolean {
  const platform = typeof navigator === "undefined" ? "" : String(navigator.platform || "");
  const ua = typeof navigator === "undefined" ? "" : String(navigator.userAgent || "");
  const touch = typeof navigator === "undefined" ? 0 : Number(navigator.maxTouchPoints || 0);
  const mobile = /Android|Mobile|iPad|iPhone|iPod/i.test(ua + " " + platform);
  const iPadOS = platform === "MacIntel" && touch > 1;
  if (mobile || iPadOS) return true;
  try {
    // outer* describes the browser window while inner* in an iframe describes
    // the frame. Mixing those coordinate spaces guarantees false positives.
    if (window.top && window.top !== window) return true;
  } catch {
    return true;
  }
  return false;
}

function geometrySample(): GeometrySample | null {
  if (skipGeometryHeuristic()) return null;
  const outerW = Number(window.outerWidth || 0);
  const outerH = Number(window.outerHeight || 0);
  const innerW = Number(window.innerWidth || 0);
  const innerH = Number(window.innerHeight || 0);
  if (![outerW, outerH, innerW, innerH].every(value => Number.isFinite(value) && value > 0)) {
    return null;
  }
  const dpr = Number(window.devicePixelRatio || 1);
  const scale = Number(window.visualViewport?.scale || 1);
  return {
    outerW,
    outerH,
    innerW,
    innerH,
    gapW: Math.abs(outerW - innerW),
    gapH: Math.abs(outerH - innerH),
    dpr: Number.isFinite(dpr) && dpr > 0 ? dpr : 1,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
  };
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianSample(samples: GeometrySample[]): GeometrySample {
  const field = (key: keyof GeometrySample) => median(samples.map(sample => sample[key]));
  return {
    outerW: field("outerW"), outerH: field("outerH"),
    innerW: field("innerW"), innerH: field("innerH"),
    gapW: field("gapW"), gapH: field("gapH"),
    dpr: field("dpr"), scale: field("scale"),
  };
}

function pushEvidence(kind: DevtoolsSignalKind, at: number, detail: string): DevtoolsEvidenceEventV1 {
  const elapsed = Math.max(0, Math.round(at - trackingStartedAt));
  const item: DevtoolsEvidenceEventV1 = [kind, elapsed, detail.slice(0, 32)];
  evidence.e.push(item);
  if (evidence.e.length > MAX_EVIDENCE_EVENTS) evidence.e.splice(0, evidence.e.length - MAX_EVIDENCE_EVENTS);
  return item;
}

function notifyTrigger(): void {
  try { f12Options.onTrigger?.(); } catch { /* observer must not break tracking */ }
}

function recordShortcut(detail: string, at: number): void {
  evidence.k += 1;
  state.f12 += 1;
  lastShortcutAt = at;
  lastShortcutEvidence = pushEvidence("k", at, detail);
  notifyTrigger();
}

function recordGeometry(axis: string, anomalyStartedAt: number): void {
  evidence.g += 1;
  const canCombine =
    lastShortcutEvidence !== null
    && evidence.e.includes(lastShortcutEvidence)
    && Math.abs(anomalyStartedAt - lastShortcutAt) <= SHORTCUT_GEOMETRY_COALESCE_MS;

  if (canCombine) {
    evidence.c += 1;
    lastShortcutEvidence![0] = "c";
    lastShortcutEvidence![2] = (lastShortcutEvidence![2] + "+" + axis).slice(0, 32);
    lastShortcutEvidence = null;
    return;
  }

  // Geometry-only evidence is deliberately excluded from legacy f12. New
  // readers can show it as a low-confidence hint; old readers stay quiet.
  pushEvidence("g", anomalyStartedAt, axis);
  notifyTrigger();
}

function resetGeometryState(now: number): void {
  geometryMode = "inactive";
  geometryBaseline = null;
  geometrySamples = [];
  geometryStateStartedAt = now;
  geometryCandidateAxis = "";
  geometryCandidateCount = 0;
  geometrySuppressedUntil = 0;
  pendingShortcutWhileOpen = null;
}

function beginCalibration(now: number, sample?: GeometrySample | null): void {
  geometryMode = "calibrating";
  geometryBaseline = null;
  geometrySamples = sample ? [sample] : [];
  geometryStateStartedAt = now;
  geometryCandidateAxis = "";
  geometryCandidateCount = 0;
}

function suppressGeometry(now: number): void {
  geometryMode = "suppressed";
  geometryBaseline = null;
  geometrySamples = [];
  geometryCandidateAxis = "";
  geometryCandidateCount = 0;
  geometrySuppressedUntil = now + GEOMETRY_SUPPRESS_MS;
  // Once browser chrome, fullscreen or zoom changes the viewport, a pending
  // toggle can no longer be classified safely as an opening or a closing.
  pendingShortcutWhileOpen = null;
}

function syncTrackingActivity(now: number): { active: boolean; activated: boolean } {
  const active = configuredActive();
  if (!active) {
    if (trackingWasActive) resetGeometryState(now);
    trackingWasActive = false;
    pendingShortcutWhileOpen = null;
    return { active: false, activated: false };
  }
  if (!trackingWasActive) {
    trackingWasActive = true;
    trackingStartedAt = now;
    beginCalibration(now, geometrySample());
    return { active: true, activated: true };
  }
  return { active: true, activated: false };
}

function geometryThresholds(base: GeometrySample): { x: number; y: number } {
  return {
    x: Math.max(160, Math.min(260, base.outerW * 0.12)),
    y: Math.max(150, Math.min(220, base.outerH * 0.15)),
  };
}

function zoomOrWindowChange(base: GeometrySample, sample: GeometrySample): boolean {
  if (Math.abs(sample.dpr - base.dpr) / Math.max(base.dpr, 0.01) > 0.015) return true;
  if (Math.abs(sample.scale - base.scale) > 0.01 || Math.abs(sample.scale - 1) > 0.01) return true;
  if (Math.abs(sample.outerW - base.outerW) > 24 || Math.abs(sample.outerH - base.outerH) > 24) return true;

  const shrinkW = (base.innerW - sample.innerW) / Math.max(base.innerW, 1);
  const shrinkH = (base.innerH - sample.innerH) / Math.max(base.innerH, 1);
  return shrinkW > 0.06 && shrinkH > 0.06 && Math.abs(shrinkW - shrinkH) < 0.025;
}

function openAxis(base: GeometrySample, sample: GeometrySample): string {
  const thresholds = geometryThresholds(base);
  const deltaW = sample.gapW - base.gapW;
  const deltaH = sample.gapH - base.gapH;
  const widthOnly = deltaW >= thresholds.x && Math.abs(deltaH) < 100;
  const heightOnly = deltaH >= thresholds.y && Math.abs(deltaW) < 100;
  if (widthOnly === heightOnly) return "";
  return widthOnly ? "dock-x" : "dock-y";
}

function returnedToBaseline(base: GeometrySample, sample: GeometrySample, axis: string): boolean {
  const thresholds = geometryThresholds(base);
  if (axis === "dock-x") return sample.gapW - base.gapW < thresholds.x * 0.5;
  if (axis === "dock-y") return sample.gapH - base.gapH < thresholds.y * 0.5;
  return true;
}

function flushPendingOpenShortcut(now: number): void {
  const pending = pendingShortcutWhileOpen;
  if (geometryMode !== "open"
    || !pending
    || now - pending.at < SHORTCUT_GEOMETRY_COALESCE_MS) return;
  pendingShortcutWhileOpen = null;
  recordShortcut(pending.detail, pending.at);
}

function probeGeometry(): void {
  const now = monotonicNow();
  const activity = syncTrackingActivity(now);
  if (!activity.active || activity.activated) return;

  const sample = geometrySample();
  if (!sample) {
    resetGeometryState(now);
    return;
  }

  if (geometryMode === "suppressed") {
    if (now < geometrySuppressedUntil) return;
    beginCalibration(now, sample);
    return;
  }

  if (geometryMode === "inactive") {
    beginCalibration(now, sample);
    return;
  }

  if (geometryMode === "calibrating") {
    const first = geometrySamples[0];
    if (first && zoomOrWindowChange(first, sample)) {
      geometrySamples = [sample];
      geometryStateStartedAt = now;
      return;
    }
    geometrySamples.push(sample);
    if (geometrySamples.length > CALIBRATION_SAMPLES) geometrySamples.shift();
    if (geometrySamples.length >= CALIBRATION_SAMPLES && now - geometryStateStartedAt >= CALIBRATION_MS) {
      geometryBaseline = medianSample(geometrySamples);
      geometryMode = "closed";
      geometrySamples = [];
    }
    return;
  }

  const base = geometryBaseline;
  if (!base) {
    beginCalibration(now, sample);
    return;
  }

  if (zoomOrWindowChange(base, sample)) {
    suppressGeometry(now);
    return;
  }

  if (geometryMode === "open" || geometryMode === "candidate-close") {
    if (returnedToBaseline(base, sample, geometryCandidateAxis)) {
      if (geometryMode !== "candidate-close") {
        geometryMode = "candidate-close";
        geometryStateStartedAt = now;
        geometryCandidateCount = 1;
      } else {
        geometryCandidateCount += 1;
      }
      if (geometryCandidateCount >= CLOSE_CONFIRM_SAMPLES && now - geometryStateStartedAt >= CLOSE_CONFIRM_MS) {
        geometryMode = "closed";
        geometryBaseline = sample;
        geometryCandidateAxis = "";
        geometryCandidateCount = 0;
        // A shortcut while a confirmed docked state closes is not an opening.
        pendingShortcutWhileOpen = null;
      }
    } else {
      geometryMode = "open";
      geometryCandidateCount = 0;
      flushPendingOpenShortcut(now);
    }
    return;
  }

  const axis = openAxis(base, sample);
  if (!axis) {
    if (geometryMode === "candidate-open") pendingShortcutWhileOpen = null;
    geometryMode = "closed";
    geometryBaseline = sample;
    geometryCandidateAxis = "";
    geometryCandidateCount = 0;
    return;
  }

  if (geometryMode !== "candidate-open" || geometryCandidateAxis !== axis) {
    geometryMode = "candidate-open";
    geometryCandidateAxis = axis;
    geometryCandidateCount = 1;
    geometryStateStartedAt = now;
    return;
  }

  geometryCandidateCount += 1;
  if (geometryCandidateCount >= OPEN_CONFIRM_SAMPLES && now - geometryStateStartedAt >= OPEN_CONFIRM_MS) {
    const pending = pendingShortcutWhileOpen;
    if (pending
      && Math.abs(pending.at - geometryStateStartedAt) <= SHORTCUT_GEOMETRY_COALESCE_MS) {
      pendingShortcutWhileOpen = null;
      recordShortcut(pending.detail, pending.at);
    }
    recordGeometry(axis, geometryStateStartedAt);
    geometryMode = "open";
    geometryCandidateCount = 0;
  }
}

function normalizedLetter(e: KeyboardEvent): string {
  const key = String(e.key || "").toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  const match = String(e.code || "").match(/^Key([A-Z])$/);
  return match ? match[1].toLowerCase() : "";
}

function devtoolsShortcut(e: KeyboardEvent): string | null {
  if (e.isTrusted !== true || e.repeat || e.isComposing) return null;
  const mac = isMacLike();
  const key = normalizedLetter(e);
  const f12 = e.key === "F12" || e.code === "F12" || (e.keyCode ?? (e as any).which) === 123;

  if (f12 && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    // Chrome/Edge/Safari on macOS do not use F12 as their documented opener.
    if (!mac || browserFamily === "firefox") return "F12";
    return null;
  }

  if (mac) {
    if (e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey) {
      if ((key === "i" || key === "c") && browserFamily !== "other") {
        return "M-A-" + key.toUpperCase();
      }
      if (key === "j" && browserFamily === "chromium") return "M-A-J";
      if (key === "k" && browserFamily === "firefox") return "M-A-K";
    }
    if (e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && key === "c"
      && (browserFamily === "chromium" || browserFamily === "safari")) {
      return "M-S-C";
    }
    if (e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && key === "j"
      && browserFamily === "firefox") {
      return "M-S-J";
    }
    return null;
  }

  if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return null;
  if ((key === "i" || key === "c") && browserFamily !== "other") {
    return "C-S-" + key.toUpperCase();
  }
  if (key === "j" && (browserFamily === "chromium" || browserFamily === "firefox")) {
    return "C-S-J";
  }
  if (key === "k" && browserFamily === "firefox") return "C-S-K";
  return null;
}

function isZoomShortcut(e: KeyboardEvent): boolean {
  if (e.isTrusted !== true) return false;
  const primary = isMacLike() ? e.metaKey : e.ctrlKey;
  if (!primary || e.altKey) return false;
  return ["+", "=", "-", "0"].includes(String(e.key || ""));
}

function handleShortcut(e: KeyboardEvent): void {
  const now = monotonicNow();
  const activity = syncTrackingActivity(now);
  if (!activity.active) return;

  if (isZoomShortcut(e)) {
    suppressGeometry(now);
    return;
  }

  const detail = devtoolsShortcut(e);
  if (!detail) return;
  if (detail === lastShortcutSignature && now - lastShortcutObservedAt <= SHORTCUT_DEDUPE_MS) return;
  lastShortcutSignature = detail;
  lastShortcutObservedAt = now;

  if (geometryMode === "open"
    || geometryMode === "candidate-close"
    || geometryMode === "candidate-open") {
    // F12 and the standard toolbox shortcuts are toggles. Wait to see whether
    // the confirmed docked state closes before treating this as a new signal.
    pendingShortcutWhileOpen = { at: now, detail };
    return;
  }

  recordShortcut(detail, now);
}

export function getSecurityState(): SecurityState {
  return {
    f12: state.f12,
    tab: state.tab,
    devtools: {
      ...evidence,
      e: evidence.e.map(item => [item[0], item[1], item[2]]),
    },
    fullscreen: {
      ...fullscreenEvidence,
      e: fullscreenEvidence.e.map(item => [item[0], item[1], item[2]]),
    },
  };
}

export function resetF12Tracking(): void {
  const now = monotonicNow();
  state.f12 = 0;
  browserFamily = detectBrowserFamily();
  evidence = createEvidence();
  trackingStartedAt = now;
  trackingWasActive = false;
  lastShortcutAt = -Infinity;
  lastShortcutObservedAt = -Infinity;
  lastShortcutSignature = "";
  lastShortcutEvidence = null;
  pendingShortcutWhileOpen = null;
  resetGeometryState(now);
  syncTrackingActivity(now);
}

export function installF12Tracking(options?: (() => void) | F12TrackingOptions): void {
  f12Options = typeof options === "function" ? { onTrigger: options } : (options ?? {});
  if (f12Installed) {
    syncTrackingActivity(monotonicNow());
    return;
  }
  f12Installed = true;
  resetF12Tracking();

  const root = getSameOriginRootWin();
  const targets = Array.from(new Set<Window>([window, root]));
  targets.forEach(target => target.addEventListener("keydown", handleShortcut as EventListener, true));

  const scheduleProbe = () => window.setTimeout(probeGeometry, 80);
  window.addEventListener("resize", scheduleProbe, true);
  window.addEventListener("focus", scheduleProbe, true);
  window.addEventListener("pageshow", () => suppressGeometry(monotonicNow()), true);
  window.addEventListener("orientationchange", () => suppressGeometry(monotonicNow()), true);
  document.addEventListener("fullscreenchange", () => suppressGeometry(monotonicNow()), true);
  document.addEventListener("webkitfullscreenchange", () => suppressGeometry(monotonicNow()), true);
  window.addEventListener("wheel", (event: WheelEvent) => {
    if (event.isTrusted && (event.ctrlKey || event.metaKey)) suppressGeometry(monotonicNow());
  }, { capture: true, passive: true });
  window.setInterval(probeGeometry, GEOMETRY_POLL_MS);
}

// ── Tab counter ───────────────────────────────────────────────────────────────

export function resetExamFullscreenTracking(): void {
  fullscreenEvidence = createFullscreenEvidence();
  fullscreenRequested = false;
  fullscreenWasEntered = false;
  fullscreenStartedAt = monotonicNow();
  fullscreenTabSuppressedUntil = 0;
  fullscreenTarget = null;
  clearExplainAllowance();
}

export function installExamFullscreenTracking(
  options: ExamFullscreenTrackingOptions = {},
): void {
  fullscreenOptions = options;
  const root = getSameOriginRootWin();
  const docs: Document[] = [document];
  try {
    fullscreenDocument = root.document;
    if (root.document !== document) docs.push(root.document);
  } catch {
    fullscreenDocument = document;
  }
  installExplainActivityTracking(docs);
  if (fullscreenInstalled) return;
  fullscreenInstalled = true;
  resetExamFullscreenTracking();
  docs.forEach(doc => {
    doc.addEventListener("fullscreenchange", handleFullscreenChange, true);
    doc.addEventListener("webkitfullscreenchange", handleFullscreenChange, true);
    doc.addEventListener("fullscreenerror", handleFullscreenError, true);
    doc.addEventListener("webkitfullscreenerror", handleFullscreenError, true);
  });
}

export function requestExamFullscreen(): Promise<ExamFullscreenRequestResult> {
  if (!fullscreenInstalled) installExamFullscreenTracking(fullscreenOptions);
  if (fullscreenRequested) {
    if (fullscreenEvidence.r === 1) return Promise.resolve("entered");
    if (fullscreenEvidence.r === 2) return Promise.resolve("unsupported");
    if (fullscreenEvidence.r === 4) return Promise.resolve("pending");
    return Promise.resolve("denied");
  }

  const root = getSameOriginRootWin();
  let doc: Document;
  try { doc = root.document; }
  catch { doc = document; }
  fullscreenDocument = doc;
  fullscreenRequested = true;
  fullscreenStartedAt = monotonicNow();
  fullscreenTabSuppressedUntil = fullscreenStartedAt + FULLSCREEN_TAB_SUPPRESS_MS;
  suppressGeometry(fullscreenStartedAt);

  const element = doc.documentElement as WebkitElement | null;
  const standard = element && typeof element.requestFullscreen === "function"
    ? element.requestFullscreen
    : null;
  const webkit = element && typeof element.webkitRequestFullscreen === "function"
    ? element.webkitRequestFullscreen
    : element && typeof element.webkitRequestFullScreen === "function"
      ? element.webkitRequestFullScreen
      : null;
  const request = standard || webkit;
  const enabled = standard
    ? doc.fullscreenEnabled !== false
    : (doc as WebkitDocument).webkitFullscreenEnabled !== false;
  if (!element || !request || !enabled) {
    fullscreenEvidence.r = 2;
    return Promise.resolve("unsupported");
  }

  fullscreenTarget = element;
  if (currentFullscreenElement(doc) === element) {
    markFullscreenEntered(element);
    return Promise.resolve("entered");
  }

  fullscreenEvidence.r = 4;
  try {
    const result = request.call(element);
    markFullscreenEntered(currentFullscreenElement(doc));
    if (result && typeof (result as Promise<void>).then === "function") {
      return new Promise<ExamFullscreenRequestResult>(resolve => {
        let completed = false;
        const finish = (accepted: boolean) => {
          if (completed) return;
          completed = true;
          if (accepted) markFullscreenEntered(currentFullscreenElement(doc));
          if (fullscreenEvidence.r !== 1) {
            fullscreenEvidence.r = 3;
            fullscreenTarget = null;
          }
          resolve(fullscreenEvidence.r === 1 ? "entered" : "denied");
        };
        window.setTimeout(() => finish(true), FULLSCREEN_REQUEST_TIMEOUT_MS);
        void Promise.resolve(result).then(
          () => finish(true),
          () => finish(false),
        );
      });
    }

    // Older WebKit returns void. Its prefixed change event remains the source
    // of truth and can still promote this state to entered.
    window.setTimeout(() => {
      markFullscreenEntered(currentFullscreenElement(doc));
      if (fullscreenEvidence.r !== 1) {
        fullscreenEvidence.r = 3;
        fullscreenTarget = null;
      }
    }, WEBKIT_REQUEST_CONFIRM_MS);
    return Promise.resolve(currentFullscreenElement(doc) === element ? "entered" : "pending");
  } catch {
    fullscreenEvidence.r = 3;
    fullscreenTarget = null;
    return Promise.resolve("denied");
  }
}

function isTabActive(doc: Document = document): boolean {
  let visible = true;
  let focused = true;
  try { visible = doc.visibilityState !== "hidden"; } catch { /* use default */ }
  try { focused = typeof doc.hasFocus === "function" ? doc.hasFocus() : true; } catch { /* use default */ }
  return visible && focused;
}

function recordTab(ts: number): boolean {
  if (!configuredTabActive()) return false;
  if (lastTabStamp >= 0 && Math.abs(ts - lastTabStamp) <= 500) return false;
  lastTabStamp = ts;
  state.tab += 1;
  return true;
}

function armTab(doc: Document = document): void {
  if (!configuredTabActive() || tabArmed || !isTabActive(doc)) return;
  tabArmed = true;
}

function scheduleBlurProbe(doc: Document): void {
  if (!configuredTabActive() || !tabArmed) return;
  window.clearTimeout(tabBlurTimer);
  tabBlurTimer = window.setTimeout(() => {
    if (!configuredTabActive() || !tabArmed) return;
    let hidden = false;
    let unfocused = false;
    try { hidden = doc.visibilityState === "hidden"; } catch { /* use default */ }
    try { unfocused = typeof doc.hasFocus === "function" ? !doc.hasFocus() : true; } catch { /* use default */ }
    const now = monotonicNow();
    if (hidden) {
      clearExplainAllowance();
      if (recordTab(now)) tabOptions.onTrigger?.();
      return;
    }
    if (!unfocused) return;
    if (fullscreenEvidence.r === 4) return;
    if (now <= fullscreenTabSuppressedUntil) return;
    if (consumeExplainBlurAllowance(now)) return;
    if (recordTab(now)) tabOptions.onTrigger?.();
  }, 80);
}

export function resetTabTracking(): void {
  state.tab = 0;
  lastTabStamp = -1;
  tabArmed = false;
  window.clearTimeout(tabBlurTimer);
  tabBlurTimer = 0;
  clearExplainAllowance();
  armTab();
}

export function installTabTracking(options?: (() => void) | TabTrackingOptions): void {
  tabOptions = typeof options === "function" ? { onTrigger: options } : (options ?? {});
  const root = getSameOriginRootWin();
  const wins = Array.from(new Set([window, root]));
  const docs: Document[] = [document];
  try { if (root.document !== document) docs.push(root.document); } catch { /* cross-origin root */ }
  installExplainActivityTracking(docs);
  if (tabInstalled) return;
  tabInstalled = true;
  resetTabTracking();

  docs.forEach(doc => {
    doc.addEventListener("visibilitychange", () => {
      if (!configuredTabActive()) return;
      if (doc.visibilityState === "visible") { armTab(doc); return; }
      if (doc.visibilityState === "hidden" && tabArmed) {
        clearExplainAllowance();
        if (recordTab(monotonicNow())) tabOptions.onTrigger?.();
      }
    }, true);
  });

  wins.forEach(win => {
    let doc = document;
    try { doc = win.document; } catch { /* use local document */ }
    win.addEventListener("focus", () => armTab(doc), true);
    win.addEventListener("pageshow", () => armTab(doc), true);
    win.addEventListener("blur", () => scheduleBlurProbe(doc), true);
  });

  window.setTimeout(() => armTab(), 250);
}
