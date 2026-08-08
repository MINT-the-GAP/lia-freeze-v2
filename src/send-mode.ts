// Deferred quiz checking for @Auswertung(...;Send).
//
// In collect mode LiaScript's native check/resolve actions are intercepted while
// learner inputs continue to behave normally. The caller later switches to the
// grading phase, checks only the recorded tasks, freezes the scored state, and
// finally enters review mode where feedback and the native solution control are
// available again.

export type DeferredSendPhase = "off" | "collect" | "grading" | "review";

export interface DeferredSendTask {
  hash: string;
  taskIndex: number;
}

export interface DeferredSendCheckCount extends DeferredSendTask {
  count: number;
}

export interface DeferredSendCheckCountsV1 {
  version: 1;
  items: DeferredSendCheckCount[];
}

export interface DeferredSendContext {
  getHash(): string;
  getRuntimeWindows(): Window[];
  getContentHost(targetDocument: Document): Element | null;
  setQuizStatus?(root: Element, contentHost: Element, text: string): void;
  formatLoggedStatus?(checkCount: number): string;
  formatCheckButtonLabel?(): string;
  clearQuizStatuses?(targetDocument: Document): void;
  onLogged?(task: DeferredSendTask): void;
  onReviewResolve?(task: DeferredSendTask): void;
  onReviewMarkerSolve?(): void;
}

const SEND_STYLE_ID = "lia-deferred-send-style";
const SEND_PHASE_CLASSES = [
  "lia-send-collect",
  "lia-send-grading",
  "lia-send-review",
] as const;

let phase: DeferredSendPhase = "off";
let context: DeferredSendContext | null = null;
const loggedTaskKeys = new Set<string>();
const checkCountByTaskKey = new Map<string, number>();
const boundWindows = new WeakSet<Window>();
const observedDocuments = new WeakMap<Document, MutationObserver>();
const originalCheckButtonLabels = new WeakMap<Element, string>();
const statusDismissTimers = new Map<string, { runtimeWindow: Window; timer: number }>();
const MAX_CHECK_COUNT = 100000;
const STATUS_DISMISS_DELAY_MS = 10_000;

function normalizeHash(raw: string): string {
  const value = String(raw || "").trim();
  return /^#\d+$/.test(value) ? value : "";
}

export function makeDeferredSendTaskKey(hash: string, taskIndex: number): string {
  const cleanHash = normalizeHash(hash);
  const index = Number(taskIndex);
  return cleanHash && Number.isInteger(index) && index >= 0
    ? cleanHash + "::send::" + index
    : "";
}

export function parseDeferredSendTaskKey(raw: string): DeferredSendTask | null {
  const match = String(raw || "").match(/^(#\d+)::send::(\d+)$/);
  if (!match) return null;
  const taskIndex = Number(match[2]);
  if (!Number.isSafeInteger(taskIndex) || taskIndex < 0) return null;
  return { hash: match[1], taskIndex };
}

function asElement(value: EventTarget | null): Element | null {
  const node = value as Node | null;
  if (!node) return null;
  return node.nodeType === 1 ? node as Element : node.parentElement;
}

function taskForQuizRoot(root: Element): DeferredSendTask | null {
  if (!context) return null;
  const targetDocument = root.ownerDocument;
  const host = context.getContentHost(targetDocument);
  if (!host || !host.contains(root)) return null;
  const roots = Array.from(host.querySelectorAll(".lia-quiz"));
  const taskIndex = roots.indexOf(root);
  const hash = normalizeHash(context.getHash());
  return hash && taskIndex >= 0 ? { hash, taskIndex } : null;
}

function clearStatusDismissTimer(key: string): void {
  const pending = statusDismissTimers.get(key);
  if (!pending) return;
  pending.runtimeWindow.clearTimeout(pending.timer);
  statusDismissTimers.delete(key);
}

function clearStatusDismissTimers(): void {
  Array.from(statusDismissTimers.keys()).forEach(clearStatusDismissTimer);
}

function scheduleStatusDismissal(
  root: Element,
  contentHost: Element,
  task: DeferredSendTask,
  key: string,
  configuredContext: DeferredSendContext
): void {
  const runtimeWindow = root.ownerDocument.defaultView;
  if (!runtimeWindow) return;
  clearStatusDismissTimer(key);
  const timer = runtimeWindow.setTimeout(() => {
    const pending = statusDismissTimers.get(key);
    if (!pending || pending.timer !== timer) return;
    statusDismissTimers.delete(key);
    if (phase !== "collect" || context !== configuredContext) return;

    // Clear the originally rendered sidecar as well as a replacement quiz root
    // if LiaScript remounted the current slide during the ten-second window.
    configuredContext.setQuizStatus?.(root, contentHost, "");
    let currentHost: Element | null = null;
    try { currentHost = configuredContext.getContentHost(root.ownerDocument); } catch { /* noop */ }
    if (!currentHost || normalizeHash(configuredContext.getHash()) !== task.hash) return;
    const currentRoot = currentHost.querySelectorAll(".lia-quiz")[task.taskIndex];
    if (currentRoot && currentRoot !== root) {
      configuredContext.setQuizStatus?.(currentRoot, currentHost, "");
    }
  }, STATUS_DISMISS_DELAY_MS);
  statusDismissTimers.set(key, { runtimeWindow, timer });
}

function ensureLoggedStatus(
  root: Element,
  task: DeferredSendTask,
  key: string,
  checkCount: number
): void {
  if (!context) return;
  const host = context.getContentHost(root.ownerDocument);
  if (!host) return;
  const configuredContext = context;
  configuredContext.setQuizStatus?.(
    root,
    host,
    configuredContext.formatLoggedStatus?.(checkCount)
      ?? ("Antwort gespeichert. Prüfen-Klicks: " + checkCount
        + ". Die Auswertung erfolgt nach der Abgabe.")
  );
  scheduleStatusDismissal(root, host, task, key, configuredContext);
}

function logQuizRoot(root: Element, showStatus: boolean, countCheck = false): void {
  const task = taskForQuizRoot(root);
  if (!task) return;
  const key = makeDeferredSendTaskKey(task.hash, task.taskIndex);
  if (!key) return;
  if (countCheck) {
    const previous = checkCountByTaskKey.get(key) ?? 0;
    checkCountByTaskKey.set(key, Math.min(MAX_CHECK_COUNT, previous + 1));
  }
  const added = !loggedTaskKeys.has(key);
  loggedTaskKeys.add(key);
  if (showStatus) {
    ensureLoggedStatus(root, task, key, checkCountByTaskKey.get(key) ?? 0);
  }
  if (added) context?.onLogged?.(task);
}

function blockDeferredAction(event: Event): void {
  if (event.cancelable) event.preventDefault();
  event.stopImmediatePropagation();
}

function handleCollectClick(event: Event): void {
  const target = asElement(event.target);
  if (!target) return;

  if (
    (phase === "collect" || phase === "grading")
    && target.closest('.hlq-proxy [data-hlq-act="solve"]')
  ) {
    blockDeferredAction(event);
    return;
  }

  if (phase === "review") {
    if (target.closest('.hlq-proxy [data-hlq-act="solve"]')) {
      context?.onReviewMarkerSolve?.();
      return;
    }
    const resolve = target.closest(".lia-quiz__resolve");
    const root = resolve?.closest(".lia-quiz");
    const task = root ? taskForQuizRoot(root) : null;
    if (task) context?.onReviewResolve?.(task);
    // lia-marker also reacts to LiaScript's visible native resolve control.
    // Its solution highlights are created after this capture listener, so arm
    // the same delayed snapshot path used by the marker's internal Solve
    // button. Otherwise the solution is visible only until the next remount.
    if (root?.closest('.markerquiz')) context?.onReviewMarkerSolve?.();
    return;
  }

  if (phase !== "collect") return;
  const check = target.closest(".lia-quiz__check");
  if (check) {
    const root = check.closest(".lia-quiz");
    if (root) logQuizRoot(root, true, true);
    blockDeferredAction(event);
    return;
  }

  if (target.closest(".lia-quiz__resolve")) {
    blockDeferredAction(event);
  }
}

function handleCollectInput(event: Event): void {
  if (phase !== "collect") return;
  const root = asElement(event.target)?.closest(".lia-quiz");
  if (root) logQuizRoot(root, false);
}

function injectSendStyle(targetDocument: Document): void {
  if (targetDocument.getElementById(SEND_STYLE_ID)) return;
  const style = targetDocument.createElement("style");
  style.id = SEND_STYLE_ID;
  style.textContent = `
body.lia-send-collect .lia-quiz__feedback,
body.lia-send-grading .lia-quiz__feedback,
body.lia-send-collect .lia-quiz__resolve,
body.lia-send-grading .lia-quiz__resolve,
body.lia-send-collect .hlq-msg,
body.lia-send-grading .hlq-msg,
body.lia-send-collect .hlq-proxy [data-hlq-act="solve"],
body.lia-send-grading .hlq-proxy [data-hlq-act="solve"] {
  display: none !important;
  visibility: hidden !important;
}
.lia-assignment-details[data-adetails]::part(send-status) {
  display: block;
  margin-top: .45rem;
  font-weight: 700;
  color: var(--lia-course-fg, currentColor);
}
body.lia-send-review .lia-quiz__resolve:not(:disabled),
body.lia-send-review .hlq-proxy [data-hlq-act="solve"]:not(:disabled) {
  pointer-events: auto !important;
  cursor: pointer !important;
}
`;
  (targetDocument.head ?? targetDocument.documentElement).appendChild(style);
}

function syncCheckButtonLabels(targetDocument: Document): void {
  const collectLabel = context?.formatCheckButtonLabel?.().trim() ?? "";
  targetDocument.querySelectorAll<HTMLElement>(".lia-quiz__check").forEach(button => {
    if (phase === "collect" && collectLabel) {
      if (!originalCheckButtonLabels.has(button)) {
        originalCheckButtonLabels.set(button, button.textContent ?? "");
      }
      if (button.textContent !== collectLabel) button.textContent = collectLabel;
      return;
    }
    const originalLabel = originalCheckButtonLabels.get(button);
    if (originalLabel === undefined) return;
    if (button.textContent !== originalLabel) button.textContent = originalLabel;
    originalCheckButtonLabels.delete(button);
  });
}

function applyPhaseToDocument(targetDocument: Document): void {
  injectSendStyle(targetDocument);
  const body = targetDocument.body;
  if (!body) return;
  SEND_PHASE_CLASSES.forEach(name => body.classList.remove(name));
  if (phase !== "off") body.classList.add("lia-send-" + phase);
  syncCheckButtonLabels(targetDocument);
  if (phase !== "collect") {
    context?.clearQuizStatuses?.(targetDocument);
  }
}

function bindRuntimeWindow(runtimeWindow: Window): void {
  let targetDocument: Document;
  try { targetDocument = runtimeWindow.document; } catch { return; }
  injectSendStyle(targetDocument);
  applyPhaseToDocument(targetDocument);

  if (!boundWindows.has(runtimeWindow)) {
    boundWindows.add(runtimeWindow);
    runtimeWindow.addEventListener("click", handleCollectClick, true);
    ["input", "change", "drop"].forEach(type => {
      runtimeWindow.addEventListener(type, handleCollectInput, true);
    });
  }

  if (!targetDocument.body || observedDocuments.has(targetDocument)) return;
  const Observer = (runtimeWindow as Window & typeof globalThis).MutationObserver
    ?? MutationObserver;
  const observer = new Observer(() => applyPhaseToDocument(targetDocument));
  observer.observe(targetDocument.body, { childList: true, subtree: true });
  observedDocuments.set(targetDocument, observer);
}

export function configureDeferredSendMode(nextContext: DeferredSendContext): void {
  clearStatusDismissTimers();
  context = nextContext;
  loggedTaskKeys.clear();
  checkCountByTaskKey.clear();
  refreshDeferredSendMode();
}

export function setDeferredSendPhase(nextPhase: DeferredSendPhase): void {
  if (nextPhase !== "collect") clearStatusDismissTimers();
  phase = nextPhase;
  refreshDeferredSendMode();
}

export function getDeferredSendPhase(): DeferredSendPhase {
  return phase;
}

export function refreshDeferredSendMode(): void {
  if (!context) return;
  let runtimeWindows: Window[] = [];
  try { runtimeWindows = context.getRuntimeWindows(); } catch { return; }
  runtimeWindows.forEach(bindRuntimeWindow);
}

export function getDeferredSendTasks(): DeferredSendTask[] {
  return Array.from(loggedTaskKeys)
    .map(parseDeferredSendTaskKey)
    .filter((task): task is DeferredSendTask => !!task)
    .sort((a, b) => {
      const hashDelta = Number(a.hash.slice(1)) - Number(b.hash.slice(1));
      return hashDelta || a.taskIndex - b.taskIndex;
    });
}

export function getDeferredSendCheckCounts(): DeferredSendCheckCountsV1 {
  const items = Array.from(checkCountByTaskKey, ([key, count]) => {
    const task = parseDeferredSendTaskKey(key);
    return task ? { ...task, count } : null;
  })
    .filter((item): item is DeferredSendCheckCount => !!item)
    .sort((a, b) => {
      const hashDelta = Number(a.hash.slice(1)) - Number(b.hash.slice(1));
      return hashDelta || a.taskIndex - b.taskIndex;
    });
  return { version: 1, items };
}

export function isDeferredSendReviewControl(element: Element | null): boolean {
  if (!element) return false;
  const targetDocument = element.ownerDocument;
  return targetDocument.body?.classList.contains("lia-send-review") === true
    && !!element.closest(
      '.lia-quiz__resolve,.hlq-proxy [data-hlq-act="solve"]'
    );
}
