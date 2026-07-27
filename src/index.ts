// Entry point. Detects live vs. shared-link mode, boots the appropriate flow,
// and wires hash-change handling, the abgabe slide, and the evaluation overlay.
import {
  configureDeferredSendMode,
  getDeferredSendCheckCounts,
  getDeferredSendTasks,
  makeDeferredSendTaskKey,
  refreshDeferredSendMode,
  setDeferredSendPhase,
} from './send-mode';
import { installPortIntercept } from "./port";
import {
  activateAnnotationSnapshot,
  activateCanvasSnapshot,
  cancelPendingMarkerRestore,
  captureMarkerReviewState,
  captureAnnotationProgress,
  captureSnapshot,
  captureCanvasProgress,
  captureCoordinateProgress,
  refreshAnnotationRender,
  refreshCanvasRender,
  refreshCoordinateRender,
  refreshMarkerRender,
  restoreSnapshot,
  SnapshotPayload,
} from "./snapshot";
import {
  getSubmissionToken,
  storeToken,
  buildLink,
  loadPayload,
  getCurrentHash,
} from "./url";
import {
  injectRuntimeCSS,
  applyThemeColors,
  applyCourseColors,
  refreshAssignmentDetails,
  configureAssignmentDetailAwards,
  getManualAwardValues,
  installFreezeBar,
  setFreezeBarState,
  setPageFrozen,
  reapplyContentLock,
  wireLiveBar,
  setLiveBarStatus,
  setLiveBarFrozen,
  setPrintReportHeader,
  setPrintReportMode,
  copyLinkToClipboard,
  getContentHost,
  getContentHostForDocument,
} from "./freeze-ui";
import {
  parseEvaluationOptions,
  parseDeclaredSlides,
  parseAbgabeHash,
  parseSectionCount,
  parseEvaluationDeclarations,
  parseExamConfig,
  renderEvaluationSlide,
  getAutomaticTaskAward,
  buildFrozenEvaluationMetadata,
  readFrozenEvaluationMetadata,
  DeclaredSlide,
  ExamConfig,
} from "./evaluation";
import {
  ExamHeadingRef,
  parseExamHeadingIndex,
  resolveLiaSectionHash,
} from "./exam-routing";
import {
  buildPrintableSubmissionHeaderModel,
  buildSubmissionDocumentMetadata,
  parseCourseDocumentIdentity,
} from "./submission-document";
import type { CourseDocumentIdentity } from "./submission-document";
import {
  installF12Tracking,
  installTabTracking,
  installExamFullscreenTracking,
  requestExamFullscreen,
  getSecurityState,
  resetF12Tracking,
  resetTabTracking,
  courseUsesMathpathExplain,
} from "./security";
import {
  captureNativeDomNow,
  captureNativeDomTaskOutcomeNow,
  exportNativeDomFallback,
  installNativeDomTracker,
  mergeNativeDomTaskSnapshots,
  restoreNativeDomForSlide,
  type NativeDomFallbackV1,
} from "./native-dom";
import { sameOriginRuntimeWindows } from "./runtime-windows";

// ── Module state ──────────────────────────────────────────────────────────────

let declaredSlides: DeclaredSlide[] = [];
let evalDecl: ReturnType<typeof parseEvaluationDeclarations> = Object.create(null);
let evalOptions: ReturnType<typeof parseEvaluationOptions> = {
  trackF12: false,
  trackTab: false,
  trackTime: false,
  deferFeedback: false,
};
let abgabeHash = "";
let sectionCount = 0;
let courseDocumentIdentity: CourseDocumentIdentity = {
  title: "",
  courseVersion: "",
};

let activePayload: SnapshotPayload | null = null;
let evalContainer: HTMLElement | null = null;
let frozenLink = "";
let frozenName = "";
let booted = false;
let creatingLink = false;
let gradingSendSubmission = false;
const reviewedSendSolutionKeys = new Set<string>();
let printingSubmission = false;
let freezeNavigationInstalled = false;
let canvasAcceptEmptyCaptureQueued = false;
let canvasProgressCaptureQueued = false;
let canvasTrailingCaptureTimer = 0;
let lastCanvasCaptureAttemptAt = 0;
let canvasRefreshGeneration = 0;
let coordinateProgressCaptureQueued = false;
let coordinateMutationRefreshTimer = 0;
let canvasMutationRefreshPending = false;
let coordinateRefreshGeneration = 0;
let coordinateAcceptSliderCaptureQueued = false;
let coordinateAcceptScharCaptureQueued = false;
let canvasCaptureWarningShown = false;
let annotationProgressCaptureQueued = false;
let annotationCaptureWarningShown = false;
let annotationMutationRefreshPending = false;
const canvasProgressRuntimeWindows = new WeakSet<Window>();
const annotationProgressRuntimeWindows = new WeakSet<Window>();
const coordinateProgressRuntimeWindows = new WeakSet<Window>();
const runtimeMutationObserverDocuments = new WeakSet<Document>();
const COORDINATE_REFRESH_DELAYS = [80, 300, 800, 1600, 3200, 6000] as const;
const CANVAS_REFRESH_DELAYS = [40, 120, 360, 800, 1600, 3200, 6000] as const;
const CANVAS_CAPTURE_COOLDOWN_MS = 180;
const ANNOTATION_REFRESH_DELAYS = [40, 120, 360, 800, 1600, 3200, 6000] as const;

function eventElement(event: Event): Element | null {
  const target = event.target as Node | null;
  return target?.nodeType === 1 && typeof (target as Element).closest === "function"
    ? target as Element
    : null;
}

function captureCanvasProgressBestEffort(
  options: { acceptEmptyChanges?: boolean } = {}
): void {
  lastCanvasCaptureAttemptAt = Date.now();
  try {
    captureCanvasProgress(options);
    canvasCaptureWarningShown = false;
  } catch (error) {
    if (canvasCaptureWarningShown) return;
    canvasCaptureWarningShown = true;
    console.warn("[LIA-FREEZE] Canvas progress capture skipped:", error);
  }
}

function flushScheduledCanvasProgressCapture(): void {
  if (document.body?.classList.contains("lia-course-frozen")) {
    canvasAcceptEmptyCaptureQueued = false;
    return;
  }
  const remaining = CANVAS_CAPTURE_COOLDOWN_MS - (Date.now() - lastCanvasCaptureAttemptAt);
  if (remaining > 0) {
    if (!canvasTrailingCaptureTimer) {
      canvasTrailingCaptureTimer = window.setTimeout(() => {
        canvasTrailingCaptureTimer = 0;
        flushScheduledCanvasProgressCapture();
      }, remaining);
    }
    return;
  }
  const acceptQueuedEmpty = canvasAcceptEmptyCaptureQueued;
  canvasAcceptEmptyCaptureQueued = false;
  captureCanvasProgressBestEffort({ acceptEmptyChanges: acceptQueuedEmpty });
}

function scheduleCanvasProgressCapture(acceptEmptyChanges = false): void {
  if (document.body?.classList.contains("lia-course-frozen")) return;
  canvasAcceptEmptyCaptureQueued ||= acceptEmptyChanges;
  if (canvasProgressCaptureQueued) return;
  canvasProgressCaptureQueued = true;
  queueMicrotask(() => {
    canvasProgressCaptureQueued = false;
    flushScheduledCanvasProgressCapture();
  });
}

function installCanvasProgressCapture(): void {
  for (const runtimeWindow of sameOriginRuntimeWindows()) {
    if (canvasProgressRuntimeWindows.has(runtimeWindow)) continue;
    canvasProgressRuntimeWindows.add(runtimeWindow);
    ["pointerup", "click", "input", "change"].forEach(type => {
      runtimeWindow.addEventListener(type, event => {
        const target = eventElement(event);
        if (!target?.closest(".lia-canvas-pair")) return;
        scheduleCanvasProgressCapture(true);
      }, true);
    });
    runtimeWindow.addEventListener(
      "pagehide",
      () => captureCanvasProgressBestEffort(),
      true,
    );
    runtimeWindow.addEventListener(
      "lia:canvas-change",
      () => scheduleCanvasProgressCapture(true),
      true,
    );
  }
}

function scheduleCanvasRefresh(): void {
  const generation = ++canvasRefreshGeneration;
  CANVAS_REFRESH_DELAYS.forEach(delay => {
    window.setTimeout(() => {
      if (generation !== canvasRefreshGeneration) return;
      if (!document.body?.classList.contains("lia-course-frozen")) {
        installCanvasProgressCapture();
      }
      installCoordinateMutationRefreshObserver();
      refreshCanvasRender();
    }, delay);
  });
}

function captureAnnotationProgressBestEffort(
  options: { acceptEmptyChanges?: boolean } = {},
): void {
  try {
    captureAnnotationProgress(options);
    annotationCaptureWarningShown = false;
  } catch (error) {
    if (annotationCaptureWarningShown) return;
    annotationCaptureWarningShown = true;
    console.warn('[LIA-FREEZE] Annotation progress capture skipped:', error);
  }
}

function scheduleAnnotationProgressCapture(acceptEmptyChanges = false): void {
  if (document.body?.classList.contains('lia-course-frozen')) return;
  if (annotationProgressCaptureQueued) return;
  annotationProgressCaptureQueued = true;
  queueMicrotask(() => {
    annotationProgressCaptureQueued = false;
    if (document.body?.classList.contains('lia-course-frozen')) return;
    captureAnnotationProgressBestEffort({ acceptEmptyChanges });
  });
}

function installAnnotationProgressCapture(): void {
  for (const runtimeWindow of sameOriginRuntimeWindows()) {
    if (annotationProgressRuntimeWindows.has(runtimeWindow)) continue;
    annotationProgressRuntimeWindows.add(runtimeWindow);
    ['pointerup', 'click', 'input', 'change'].forEach(type => {
      runtimeWindow.addEventListener(type, event => {
        const target = eventElement(event);
        if (!target?.closest('.lia-annot-shell, .lia-annot-toolbar')) return;
        scheduleAnnotationProgressCapture(true);
      }, true);
    });
    runtimeWindow.addEventListener(
      'pagehide',
      () => captureAnnotationProgressBestEffort(),
      true,
    );
    runtimeWindow.addEventListener(
      'lia:annotation-change',
      () => scheduleAnnotationProgressCapture(true),
      true,
    );
  }
}

function scheduleAnnotationRefresh(): void {
  ANNOTATION_REFRESH_DELAYS.forEach(delay => {
    window.setTimeout(() => {
      if (!document.body?.classList.contains('lia-course-frozen')) {
        installAnnotationProgressCapture();
      }
      refreshAnnotationRender();
    }, delay);
  });
}

const COORDINATE_CONTEXT_SELECTOR = [
  ".jxgbox",
  ".lia-jxg-resize-handle",
  ".JXG_navigation",
  "[data-lia-dgs-tools]",
  "[class^='lia-dgs-']",
  "[class*=' lia-dgs-']",
  "[class^='lia-plot-']",
  "[class*=' lia-plot-']",
  "[class^='lia-schar-']",
  "[class*=' lia-schar-']",
  "[class^='lia-dyn-table-']",
  "[class*=' lia-dyn-table-']",
  "[id^='lia-plot-input-']",
  "[id^='point-ui-']",
  "[id^='point-graph-ui-']",
  "[id^='multi-graph-ui-']",
  "[id^='lia-table-']",
].join(",");

const COORDINATE_SLIDER_CONTEXT_SELECTOR = [
  ".jxgbox",
  ".lia-dgs-slider-button",
  ".lia-dgs-slider-settings-section",
  ".lia-dgs-slider-settings-grid",
  ".lia-dgs-slider-field",
].join(",");

const COORDINATE_SCHAR_CONTEXT_SELECTOR = [
  "[class^='lia-schar-']",
  "[class*=' lia-schar-']",
].join(",");

function scheduleCoordinateProgressCapture(
  options: { acceptSliderChanges?: boolean; acceptScharChanges?: boolean } = {}
): void {
  if (document.body?.classList.contains("lia-course-frozen")) return;
  coordinateAcceptSliderCaptureQueued ||= !!options.acceptSliderChanges;
  coordinateAcceptScharCaptureQueued ||= !!options.acceptScharChanges;
  if (coordinateProgressCaptureQueued) return;
  coordinateProgressCaptureQueued = true;
  queueMicrotask(() => {
    coordinateProgressCaptureQueued = false;
    const acceptSliderChanges = coordinateAcceptSliderCaptureQueued;
    const acceptScharChanges = coordinateAcceptScharCaptureQueued;
    coordinateAcceptSliderCaptureQueued = false;
    coordinateAcceptScharCaptureQueued = false;
    if (document.body?.classList.contains("lia-course-frozen")) return;
    captureCoordinateProgress({ acceptSliderChanges, acceptScharChanges });
  });
}

function installCoordinateProgressCapture(): void {
  for (const runtimeWindow of sameOriginRuntimeWindows()) {
    if (coordinateProgressRuntimeWindows.has(runtimeWindow)) continue;
    coordinateProgressRuntimeWindows.add(runtimeWindow);
    ["pointerup", "click", "input", "change", "wheel"].forEach(type => {
      runtimeWindow.addEventListener(type, event => {
        const target = eventElement(event);
        if (!target?.closest(COORDINATE_CONTEXT_SELECTOR)) return;
        scheduleCoordinateProgressCapture({
          acceptSliderChanges: !!target.closest(COORDINATE_SLIDER_CONTEXT_SELECTOR),
          acceptScharChanges: !!target.closest(COORDINATE_SCHAR_CONTEXT_SELECTOR),
        });
      }, true);
    });
    runtimeWindow.addEventListener("pagehide", () => captureCoordinateProgress(), true);
  }
}

function scheduleCoordinateRefresh(): void {
  const generation = ++coordinateRefreshGeneration;
  COORDINATE_REFRESH_DELAYS.forEach(delay => {
    window.setTimeout(() => {
      if (generation !== coordinateRefreshGeneration) return;
      if (!document.body?.classList.contains("lia-course-frozen")) {
        installCoordinateProgressCapture();
      }
      refreshCoordinateRender();
    }, delay);
  });
}

function installCoordinateMutationRefreshObserver(): void {
  for (const runtimeWindow of sameOriginRuntimeWindows()) {
    try {
      const runtimeDocument = runtimeWindow.document;
      if (!runtimeDocument.body || runtimeMutationObserverDocuments.has(runtimeDocument)) continue;
      const Observer = (runtimeWindow as Window & typeof globalThis).MutationObserver
        ?? MutationObserver;
      new Observer((mutations: MutationRecord[]) => {
        if (!document.body?.classList.contains("lia-shared-freeze-link")) return;
        if (!mutations.some(mutation => mutation.addedNodes.length || mutation.removedNodes.length)) return;
        canvasMutationRefreshPending ||= mutations.some(mutation => {
          const targetNode = mutation.target as Node;
          const target = targetNode.nodeType === 1
            ? targetNode as Element
            : targetNode.parentElement;
          if (target?.closest(".lia-canvas-pair, .lia-canvas-mount")) return true;
          return Array.from(mutation.addedNodes).some(node => {
            if (node.nodeType !== 1) return false;
            const element = node as Element;
            return element.matches(".lia-canvas-pair, .lia-canvas-mount")
              || !!element.querySelector(".lia-canvas-pair, .lia-canvas-mount");
          });
        });
        annotationMutationRefreshPending ||= mutations.some(mutation => {
          const targetNode = mutation.target as Node;
          const target = targetNode.nodeType === 1
            ? targetNode as Element
            : targetNode.parentElement;
          if (target?.closest('.lia-annot-shell, .lia-annot-toolbar')) return true;
          return Array.from(mutation.addedNodes).some(node => {
            if (node.nodeType !== 1) return false;
            const element = node as Element;
            return element.matches('.lia-annot-shell, .lia-annot-toolbar')
              || !!element.querySelector('.lia-annot-shell, .lia-annot-toolbar');
          });
        });
        if (coordinateMutationRefreshTimer) window.clearTimeout(coordinateMutationRefreshTimer);
        coordinateMutationRefreshTimer = window.setTimeout(() => {
          coordinateMutationRefreshTimer = 0;
          installCoordinateMutationRefreshObserver();
          refreshCoordinateRender();
          if (canvasMutationRefreshPending) {
            canvasMutationRefreshPending = false;
            refreshCanvasRender();
          }
          if (annotationMutationRefreshPending) {
            annotationMutationRefreshPending = false;
            refreshAnnotationRender();
          }
        }, 0);
      }).observe(runtimeDocument.body, { childList: true, subtree: true });
      runtimeMutationObserverDocuments.add(runtimeDocument);
    } catch { /* same-origin runtime may disappear while observers are installed */ }
  }
}

// ── Exam state ────────────────────────────────────────────────────────────────

let examConfig: ExamConfig = { enabled: false, durationMinutes: 0, triggerHash: "" };
let examHeadingIndex: ExamHeadingRef[] = [];
let mathpathExplainEnabled = false;
let courseMarkdownLoaded = false;
let examTimerStartedAtMs = 0;
let examTimerEndsAtMs = 0;
let examLockToSubmission = false;
let examTickInterval = 0;
let examLockWatchInterval = 0;
let lateExamFallbackInstalled = false;
let fallbackSecurityTrackingInstalled = false;

// ── Slide time tracking ───────────────────────────────────────────────────────

let slideTimeMs: Record<string, number> = {};
let slideTimerStart = 0;
let slideTimerHash = "";

function stopCurrentSlideTimer(): void {
  if (!slideTimerHash || !slideTimerStart) return;
  const elapsed = Date.now() - slideTimerStart;
  slideTimeMs[slideTimerHash] = (slideTimeMs[slideTimerHash] ?? 0) + elapsed;
  slideTimerStart = 0;
  slideTimerHash = "";
}

function startSlideTimer(hash: string): void {
  slideTimerHash = hash;
  slideTimerStart = Date.now();
}

function buildSlideTimeMs(): Record<string, number> {
  return { ...slideTimeMs };
}

// ── Exam functions ────────────────────────────────────────────────────────────

function getOrCreateCountdown(): HTMLElement {
  let el = document.getElementById("lia-exam-countdown") as HTMLElement | null;
  if (el) return el;
  el = document.createElement("div");
  el.id = "lia-exam-countdown";
  document.body.appendChild(el);
  return el;
}

function updateCountdownLayout(): void {
  const el = document.getElementById("lia-exam-countdown") as HTMLElement | null;
  if (!el) return;
  const mobile = window.innerWidth <= 700;
  el.style.right  = mobile ? "12px" : "30px";
  el.style.bottom = mobile ? "30px" : "5px";
}

function tickExamTimer(): void {
  if (!examConfig.enabled || examTimerStartedAtMs <= 0) {
    getOrCreateCountdown().style.display = "none";
    return;
  }
  const remainingMs = Math.max(0, examTimerEndsAtMs - Date.now());
  const totalSecs   = Math.ceil(remainingMs / 1000);
  const mm = String(Math.floor(totalSecs / 60)).padStart(2, "0");
  const ss = String(totalSecs % 60).padStart(2, "0");
  const el = getOrCreateCountdown();
  el.textContent = "Time left: " + mm + ":" + ss;
  el.style.display = "block";
  updateCountdownLayout();

  if (remainingMs <= 0) {
    lockExamAndFreeze();
  }
}

function startExamTimer(): void {
  if (!examConfig.enabled) return;
  if (document.body.classList.contains("lia-snapshot-mode")) return;
  if (examLockToSubmission) return;
  if (examTimerStartedAtMs > 0) return;
  const mins = examConfig.durationMinutes;
  if (!Number.isFinite(mins) || mins <= 0) return;

  examTimerStartedAtMs = Date.now();
  examTimerEndsAtMs    = examTimerStartedAtMs + Math.round(mins * 60000);
  // Intro-slide activity must never leak into an actual exam. Resetting after
  // the start timestamp also re-calibrates any early fallback trackers.
  resetF12Tracking();
  resetTabTracking();

  if (examTickInterval) clearInterval(examTickInterval);
  examTickInterval = window.setInterval(tickExamTimer, 1000);
  tickExamTimer();
}

function resolveExamLocationHash(fallback = getCurrentHash()): string {
  const resolved = resolveLiaSectionHash(window.location.hash, examHeadingIndex);
  if (resolved) return resolved;
  return window.location.hash && window.location.hash !== "#" ? "" : fallback;
}

function renderedExamFallback(): ExamConfig | null {
  for (const runtime of sameOriginRuntimeWindows()) {
    try {
      const anchor = runtime.document.querySelector<HTMLElement>(
        ".lia-exam-macro-anchor[data-lia-exam-duration]",
      );
      if (!anchor) continue;
      const duration = Number(
        (anchor.getAttribute("data-lia-exam-duration") || "").replace(",", "."),
      );
      if (!Number.isFinite(duration) || duration <= 0) continue;
      const triggerHash = resolveExamLocationHash();
      if (!/^#[1-9]\d*$/.test(triggerHash)) continue;
      return {
        enabled: true,
        durationMinutes: duration,
        triggerHash,
      };
    } catch { /* runtime may disappear during traversal */ }
  }
  return null;
}

function activateRenderedExamFallback(): boolean {
  if (examConfig.enabled || courseMarkdownLoaded) return examConfig.enabled;
  const fallback = renderedExamFallback();
  if (!fallback) return false;
  examConfig = fallback;
  fallbackSecurityTrackingInstalled = true;
  installF12Tracking({
    isActive: () => examTimerStartedAtMs > 0 && !examLockToSubmission,
  });
  installTabTracking({
    isActive: () => examTimerStartedAtMs > 0 && !examLockToSubmission,
    // The source is unavailable in this fallback. The security module still
    // requires the exact MathPath link, quiz hierarchy, trusted click and
    // matching open overlay/frame before granting a one-shot allowance.
    allowMathpathExplain: true,
  });
  installExamFullscreenTracking({
    isActive: () => examTimerStartedAtMs > 0 && !examLockToSubmission,
    allowMathpathExplain: true,
  });
  setTimeout(showExamIntro, 0);
  return true;
}

function installLateExamFallback(): void {
  if (lateExamFallbackInstalled || courseMarkdownLoaded || examConfig.enabled) return;
  lateExamFallbackInstalled = true;
  for (const runtime of sameOriginRuntimeWindows()) {
    try {
      const body = runtime.document.body;
      if (!body) continue;
      new MutationObserver(() => {
        if (activateRenderedExamFallback()) return;
      }).observe(body, { childList: true, subtree: true });
    } catch { /* same-origin runtime may disappear */ }
  }
}

function lockExamAndFreeze(): void {
  if (!examConfig.enabled) return;
  if (document.body.classList.contains("lia-snapshot-mode")) return;

  examLockToSubmission = true;
  if (examTickInterval) { clearInterval(examTickInterval); examTickInterval = 0; }
  getOrCreateCountdown().style.display = "none";

  // If the learner already submitted, Send may currently be visiting every
  // answered slide to grade it. Expiry must lock that in-flight transaction,
  // never navigate it away from the quiz being checked or start a second
  // snapshot. The active submission will return to Abgabe and freeze itself.
  const submissionInProgress = creatingLink || gradingSendSubmission;
  if (!submissionInProgress) {
    // Navigate to the Abgabe slide and auto-freeze.
    if (abgabeHash) window.location.hash = abgabeHash;
    void doCreateLink();
  }

  // Enforce lock: if student tries to navigate away, bounce back
  if (!examLockWatchInterval) {
    examLockWatchInterval = window.setInterval(() => {
      if (!examLockToSubmission) return;
      if (creatingLink || gradingSendSubmission) return;
      if (document.body.classList.contains("lia-snapshot-mode")) return;
      const cur = getCurrentHash();
      if (abgabeHash && cur !== abgabeHash) window.location.hash = abgabeHash;
    }, 420);
  }
}

function syncNameFields(): void {
  const examEl = document.querySelector<HTMLInputElement>(".lia-exam-name-input");
  const abgabeEl = document.getElementById("lia-name") as HTMLInputElement | null;
  if (!examEl || !abgabeEl) return;
  // Prefer the field that was most recently typed — use the non-empty value
  const examVal   = examEl.value.trim();
  const abgabeVal = abgabeEl.value.trim();
  if (examVal && !abgabeVal)   { abgabeEl.value = examVal; }
  if (abgabeVal && !examVal)   { examEl.value   = abgabeVal; }
}

function renderExamIntroCard(): HTMLElement {
  const initialName = (() => {
    const abgabeEl = document.getElementById("lia-name") as HTMLInputElement | null;
    return abgabeEl?.value.trim() ?? "";
  })();

  const wrap = document.createElement("section");
  wrap.className = "lia-exam-intro-virtual-slide";
  wrap.style.cssText = [
    "max-width:1200px",
    "margin:0 auto",
    "padding:1.5rem 1.6rem",
    "border-radius:16px",
    "border:1px solid color-mix(in srgb,#c1121f 55%,var(--lia-course-border) 45%)",
    "background:color-mix(in srgb,#c1121f 10%,var(--lia-course-bg) 90%)",
    "color:var(--lia-course-fg)",
  ].join(";");

  const dur = String(examConfig.durationMinutes);
  wrap.innerHTML =
    '<h1 style="font-size:8rem;font-weight:900;line-height:1.05;margin:0 0 .9rem 0;color:#c1121f;">Exam</h1>' +
    '<p style="font-size:4.25rem;line-height:1.45;font-weight:700;margin:0;">Clicking "Start Exam" begins the working time of <strong><span style="color:#c1121f;">' +
    dur + ' minutes</span></strong> and switches the course to fullscreen mode.</p>' +
    '<div style="margin-top:1.3rem;">' +
      '<label style="display:block;font-size:4.25rem;font-weight:700;margin:0 0 .4rem 0;">Name</label>' +
      '<input class="lia-exam-name-input" type="text" placeholder="Enter your name" value="' +
      initialName.replace(/"/g, "&quot;") +
      '" style="width:100%;box-sizing:border-box;padding:.6rem .75rem;border-radius:10px;' +
      'border:1px solid color-mix(in srgb,#c1121f 35%,var(--lia-course-border) 65%);' +
      'background:var(--lia-course-bg);color:var(--lia-course-fg);font-size:4rem;">' +
    '</div>' +
    '<button class="lia-exam-start-btn" type="button" style="margin-top:1.3rem;padding:.7rem 1.4rem;' +
      'border-radius:10px;border:2px solid #c1121f;background:#c1121f;color:#fff;' +
      'font-size:4rem;font-weight:800;cursor:pointer;">Start Exam</button>';

  const input = wrap.querySelector<HTMLInputElement>(".lia-exam-name-input");
  if (input) {
    const onInput = () => syncNameFields();
    input.addEventListener("input",  onInput);
    input.addEventListener("change", onInput);
  }

  const btn = wrap.querySelector<HTMLButtonElement>(".lia-exam-start-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      const name = input?.value.trim() ?? "";
      if (!name) {
        if (input) {
          input.style.animation = "none";
          input.style.border = "2px solid #c1121f";
          input.style.outline = "3px solid color-mix(in srgb,#c1121f 40%,transparent)";
          void input.offsetWidth;
          input.style.animation = "lia-exam-shake .35s ease";
          input.focus();
        }
        return;
      }
      syncNameFields();
      // Keep the fullscreen request in this trusted user-activation stack.
      // The subsequent hashchange is too late in Chrome, Edge, Brave, Firefox
      // and Safari, and a rejected request must never block the exam start.
      startExamTimer();
      void requestExamFullscreen();
      const nextHash = (() => {
        const triggerIdx = parseInt(examConfig.triggerHash.slice(1), 10);
        const visible = declaredSlides.filter(s => !s.vt);
        const next = visible.find(s => parseInt(s.h.slice(1), 10) > triggerIdx);
        return next?.h ?? ("#" + (triggerIdx + 1));
      })();
      window.location.hash = nextHash;
    });
  }

  return wrap;
}

let _examOverlay: HTMLElement | null = null;

function getOrCreateExamOverlay(): HTMLElement {
  if (_examOverlay) return _examOverlay;
  const el = document.createElement("div");
  el.id = "lia-exam-overlay";
  document.body.appendChild(el);
  _examOverlay = el;
  return el;
}

function showExamIntro(): void {
  const el = getOrCreateExamOverlay();
  el.innerHTML = "";
  el.appendChild(renderExamIntroCard());
  el.style.display = "flex";
}

function removeExamIntro(): void {
  if (_examOverlay) _examOverlay.style.display = "none";
}

function updateExamForHash(hash: string, prevHash: string): void {
  if (!examConfig.enabled) return;
  if (document.body.classList.contains("lia-snapshot-mode")) return;

  if (examLockToSubmission) {
    if (abgabeHash && hash !== abgabeHash) {
      setTimeout(() => { window.location.hash = abgabeHash; }, 0);
    }
    return;
  }

  // A browser grants fullscreen only inside the explicit user gesture. Do not
  // let arrow/hash navigation or a deep link silently bypass the Start button.
  const resolvedHash = resolveExamLocationHash(hash);
  if (examTimerStartedAtMs <= 0 && examConfig.triggerHash) {
    const triggerIdx = parseInt(examConfig.triggerHash.slice(1), 10);
    const currentIdx = parseInt((resolvedHash || "#1").slice(1), 10);
    const introVisible = _examOverlay?.style.display === "flex";
    const leftIntro = (prevHash === examConfig.triggerHash || introVisible)
      && resolvedHash !== examConfig.triggerHash;
    const skippedPastIntro = !resolvedHash || (
      Number.isFinite(currentIdx)
      && Number.isFinite(triggerIdx)
      && currentIdx > triggerIdx
    );
    if (leftIntro || skippedPastIntro) {
      setTimeout(() => {
        window.location.hash = examConfig.triggerHash;
        showExamIntro();
      }, 0);
      return;
    }
  }

  // Show/remove intro card
  removeExamIntro();
  if (resolvedHash === examConfig.triggerHash && examTimerStartedAtMs <= 0) {
    setTimeout(showExamIntro, 180);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getEvalSlide(): DeclaredSlide | undefined {
  return declaredSlides.find(s => s.vt === "evaluation");
}

function hashIndex(hash: string): number {
  const m = hash.match(/^#(\d+)$/);
  return m ? parseInt(m[1], 10) : 1;
}

function totalSlides(): number {
  return declaredSlides.filter(s => !s.vt).length || 1;
}

function isEvalHash(hash: string): boolean {
  const ev = getEvalSlide();
  if (!ev) return false;
  if (ev.h === hash) return true;

  // The evaluation is a virtual slide. In shared-link mode it is hosted on
  // the real Abgabe slide so LiaScript always has a valid slide to render
  // underneath the overlay.
  return document.body?.classList.contains("lia-shared-freeze-link") === true
    && !!abgabeHash
    && hash === abgabeHash;
}

// ── Course markdown fetch ─────────────────────────────────────────────────────

async function fetchCourseMarkdown(): Promise<string | null> {
  const search = window.location.search;
  if (!search || search === "?") return null;
  try {
    const raw = decodeURIComponent(search.slice(1));
    const u = new URL(raw, window.location.href);
    if (u.hash.startsWith("#submission=")) u.hash = "";
    // LiaScript has just loaded this exact course revision. Prefer its browser
    // cache so a brief network interruption cannot unnecessarily disable the
    // Exam declaration/MathPath opt-in lookup.
    const resp = await fetch(u.toString(), { cache: "force-cache" });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

async function loadCourseDeclarations(): Promise<void> {
  const md = await fetchCourseMarkdown();
  if (!md) return;
  courseMarkdownLoaded = true;
  courseDocumentIdentity = parseCourseDocumentIdentity(md);
  evalOptions    = parseEvaluationOptions(md);
  declaredSlides = parseDeclaredSlides(md);
  examHeadingIndex = parseExamHeadingIndex(md);
  abgabeHash     = parseAbgabeHash(md);
  sectionCount   = parseSectionCount(md);
  evalDecl       = parseEvaluationDeclarations(md);
  examConfig     = parseExamConfig(md);
  mathpathExplainEnabled = courseUsesMathpathExplain(md);
}

// ── Evaluation placeholder ────────────────────────────────────────────────────

function getOrCreateEvalContainer(): HTMLElement {
  if (evalContainer) return evalContainer;
  const el = document.createElement("div");
  el.id = "lia-eval-placeholder";
  el.style.cssText = [
    "display:none",
    "position:fixed",
    "left:50%",
    "transform:translateX(-50%)",
    "width:min(920px,calc(100vw - 24px))",
    "max-height:calc(100vh - 120px)",
    "overflow-y:auto",
    "z-index:9000",
    "padding:1.1rem 1.2rem",
    "box-sizing:border-box",
    "border-radius:16px",
    "box-shadow:0 10px 26px rgba(0,0,0,.14)",
    "background:rgb(var(--lia-submit-bg-rgb))",
    "color:var(--lia-submit-fg)",
    "border:1px solid var(--lia-submit-border-on-theme)",
  ].join(";");
  document.body.appendChild(el);
  evalContainer = el;
  return el;
}

function showEvalPlaceholder(): void {
  if (!activePayload) return;
  const el = getOrCreateEvalContainer();
  const evalSlide = getEvalSlide();
  el.innerHTML = renderEvaluationSlide({
    payload: activePayload,
    evalDecl,
    manualAwards: getManualAwardValues(),
    title: evalSlide?.t,
    name: activePayload.n,
    slides: declaredSlides,
  });
  const printHeader = buildPrintableSubmissionHeaderModel(activePayload);
  setPrintReportHeader({
    courseTitle: printHeader.title,
    studentName: printHeader.name,
    submissionDate: printHeader.date,
    courseVersion: printHeader.version,
  });
  const bar = document.getElementById("lia-freeze-bar");
  const barH = bar ? (bar as HTMLElement).offsetHeight : 64;
  el.style.top = (barH + 12) + "px";
  el.style.display = "block";

  // Hide the underlying LiaScript slide so the eval card appears alone.
  for (const sel of ["main.lia-slide__content, .lia-content, main, article", ".lia-submit-box"]) {
    document.querySelectorAll<HTMLElement>(sel).forEach(el => {
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
    });
  }
}

function hideEvalPlaceholder(): void {
  if (evalContainer) evalContainer.style.display = "none";
  for (const sel of ["main.lia-slide__content, .lia-content, main, article", ".lia-submit-box"]) {
    document.querySelectorAll<HTMLElement>(sel).forEach(el => {
      el.style.opacity = "";
      el.style.pointerEvents = "";
    });
  }
}

// ── Freeze bar ────────────────────────────────────────────────────────────────

function refreshFreezeBar(): void {
  const hash = getCurrentHash();
  const idx = hashIndex(hash);
  const total = totalSlides();
  const current = declaredSlides.find(s => s.h === hash);
  const pos = current ? declaredSlides.indexOf(current) + 1 : idx;
  const isFirst = pos <= 1;
  const isLast  = pos >= total;
  setFreezeBarState({
    slideTitle: current?.t ?? "",
    slidePos: pos + " / " + total,
    canFirst: !isFirst,
    canPrev:  !isFirst,
    canNext:  !isLast,
    canEval:  !!getEvalSlide(),
    canPrint: !!activePayload,
  });
}

function installFrozenNavigation(): void {
  if (freezeNavigationInstalled) return;
  freezeNavigationInstalled = true;

  const navSlide = (delta: number): void => {
    hideEvalPlaceholder();
    const hash = getCurrentHash();
    const visibleSlides = declaredSlides.filter(slide => !slide.vt);
    const current = visibleSlides.findIndex(slide => slide.h === hash);
    const next = current >= 0
      ? visibleSlides[Math.max(0, Math.min(visibleSlides.length - 1, current + delta))]
      : (delta < 0 ? visibleSlides[0] : visibleSlides[visibleSlides.length - 1]);
    if (next) window.location.hash = next.h;
  };

  installFreezeBar({
    onFirst: () => {
      hideEvalPlaceholder();
      const first = declaredSlides.find(slide => !slide.vt);
      if (first) window.location.hash = first.h;
    },
    onPrev: () => navSlide(-1),
    onNext: () => navSlide(1),
    onEval: () => {
      if (!getEvalSlide()) return;
      if (abgabeHash) window.location.hash = abgabeHash;
      showEvalPlaceholder();
    },
    onPrint: printFrozenEvaluation,
  });
  refreshFreezeBar();
}

// ── Abgabe slide restore ──────────────────────────────────────────────────────

function applyFrozenAbgabeValues(): void {
  if (!frozenLink) return;
  setLiveBarFrozen(frozenLink, frozenName);
}

function installAbgabeRestoreObserver(): void {
  const obs = new MutationObserver(() => {
    if (!frozenLink) return;
    const linkEl = document.getElementById("lia-link") as HTMLInputElement | null;
    if (linkEl && !linkEl.value) {
      applyFrozenAbgabeValues();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// ── Hash change listener ──────────────────────────────────────────────────────

let _prevHash = "";
let nativeDomRestoreGeneration = 0;

function scheduleNativeDomRestore(hash: string): void {
  const generation = ++nativeDomRestoreGeneration;
  if (!document.body.classList.contains("lia-course-frozen")) return;

  const fallback = activePayload?.nativeDom;
  const frozenTasks = fallback?.slides?.[hash];
  if (!frozenTasks?.length) return;
  const restorableTasks = evalOptions.deferFeedback
    ? frozenTasks.filter(task =>
        !reviewedSendSolutionKeys.has(makeDeferredSendTaskKey(hash, task.taskIndex))
      )
    : frozenTasks;
  if (!restorableTasks.length) return;
  const restorableFallback = restorableTasks.length === frozenTasks.length
    ? fallback
    : { version: 1 as const, slides: { [hash]: restorableTasks } };

  // LiaScript and imported templates can rebuild their quiz DOM well after a
  // frozen review renders, both in-place and from a shared link. Mirror the
  // longer template restore window so a late rerender cannot erase feedback,
  // visible text, survey or OCR values again.
  const delays = [40, 140, 360, 800, 1600, 3200, 6000];
  delays.forEach((delay, index) => {
    window.setTimeout(() => {
      if (generation !== nativeDomRestoreGeneration || getCurrentHash() !== hash) return;
      const root = getContentHost();
      if (root) restoreNativeDomForSlide(restorableFallback, hash, root);
      if (index === delays.length - 1) {
        refreshAssignmentDetails();
        reapplyContentLock();
      }
    }, delay);
  });
}

function onHashChange(): void {
  if (!booted) return;
  const hash = getCurrentHash();
  const prev = _prevHash;
  _prevHash = hash;

  if (isEvalHash(hash)) {
    showEvalPlaceholder();
  } else {
    hideEvalPlaceholder();
  }
  // Slide DOM is replaced on navigation — wait for render before re-locking.
  setTimeout(reapplyContentLock, 80);
  setTimeout(refreshAssignmentDetails, 80);
  setTimeout(refreshMarkerRender, 80);
  setTimeout(refreshMarkerRender, 300);
  scheduleCoordinateRefresh();
  scheduleCanvasRefresh();
  scheduleAnnotationRefresh();
  scheduleNativeDomRestore(hash);
  refreshDeferredSendMode();
  refreshFreezeBar();
  if (!gradingSendSubmission) updateExamForHash(hash, prev);
  syncNameFields();
}

// ── Shared-link mode ──────────────────────────────────────────────────────────

async function bootSharedLinkMode(payload: SnapshotPayload): Promise<void> {
  activePayload = payload;
  const embeddedEvaluation = readFrozenEvaluationMetadata(payload.ev);
  const applyEmbeddedEvaluation = (): void => {
    if (!embeddedEvaluation) return;
    evalDecl = embeddedEvaluation.declarations;
    declaredSlides = embeddedEvaluation.slides;
    abgabeHash = embeddedEvaluation.abgabeHash;
    evalOptions = embeddedEvaluation.options;
    sectionCount = embeddedEvaluation.sectionCount;
  };
  // A current submission token already contains the authoritative evaluation
  // declarations. Apply them before the optional source fetch so restore,
  // navigation and scoring never wait on the network.
  applyEmbeddedEvaluation();
  setDeferredSendPhase(
    embeddedEvaluation?.options.deferFeedback ? 'review' : 'off'
  );
  setPageFrozen(true, true);
  const courseDeclarationsPromise = loadCourseDeclarations();
  // Legacy links without embedded metadata still need the source declarations
  // before their evaluation/navigation model can be built.
  if (!embeddedEvaluation) await courseDeclarationsPromise;

  function navSlide(delta: number): void {
    hideEvalPlaceholder();
    const hash = getCurrentHash();
    const visibleSlides = declaredSlides.filter(s => !s.vt);
    const cur = visibleSlides.findIndex(s => s.h === hash);
    const next = cur >= 0
      ? visibleSlides[Math.max(0, Math.min(visibleSlides.length - 1, cur + delta))]
      : (delta < 0 ? visibleSlides[0] : visibleSlides[visibleSlides.length - 1]);
    if (next) window.location.hash = next.h;
  }

  installFreezeBar({
    onFirst: () => { hideEvalPlaceholder(); const first = declaredSlides.find(s => !s.vt); if (first) window.location.hash = first.h; },
    onPrev:  () => navSlide(-1),
    onNext:  () => navSlide(+1),
    onEval:  () => {
      const ev = getEvalSlide();
      if (ev) {
        window.location.hash = abgabeHash || ev.h;
        showEvalPlaceholder();
      }
    },
    onPrint: printFrozenEvaluation,
  });

  window.addEventListener("hashchange", onHashChange);

  setDeferredSendPhase(evalOptions.deferFeedback ? 'review' : 'off');
  refreshDeferredSendMode();
  installFrozenNavigation();
  configureAssignmentDetailAwards({
    getHash: getCurrentHash,
    getDefaultAward: (hash, taskIndex) =>
      getAutomaticTaskAward(payload, evalDecl, hash, taskIndex),
    onChange: () => {
      if (evalContainer?.style.display === "block") showEvalPlaceholder();
    },
  });

  // Restore native quiz state via port
  restoreSnapshot(payload);

  // Determine where to navigate: prefer eval slide on shared links
  const ev = getEvalSlide();
  // Navigate to a real LiaScript slide (abgabe or last known), then overlay the eval card.
  // The eval hash is virtual and unknown to LiaScript, so we never set it directly.
  const targetHash = abgabeHash || payload.sh || "#1";
  if (getCurrentHash() !== targetHash) window.location.hash = targetHash;
  scheduleNativeDomRestore(targetHash);
  if (ev) setTimeout(() => showEvalPlaceholder(), 300);

  refreshFreezeBar();

  if (embeddedEvaluation) {
    // Finish loading the source for the print archive, then restore the frozen
    // declarations because the live course must never override link metadata.
    // Respect any slide the reviewer selected while that fetch was pending.
    await courseDeclarationsPromise;
    applyEmbeddedEvaluation();
    setDeferredSendPhase(evalOptions.deferFeedback ? 'review' : 'off');
    refreshDeferredSendMode();
    const currentHash = getCurrentHash() || targetHash;
    scheduleNativeDomRestore(currentHash);
    reapplyContentLock();
    refreshAssignmentDetails();
    refreshFreezeBar();
    if (ev && currentHash === targetHash) setTimeout(() => showEvalPlaceholder(), 300);
  }
}

// ── Live mode ─────────────────────────────────────────────────────────────────

async function bootLiveMode(): Promise<void> {
  configureAssignmentDetailAwards(null);
  installCanvasProgressCapture();
  installAnnotationProgressCapture();
  installCoordinateProgressCapture();
  installNativeDomTracker({
    getHash: getCurrentHash,
    getRoot: getContentHost,
    getTaskTables: hash => evalDecl[hash]?.tl.map(task => task.table),
  });

  wireLiveBar({
    onCreateLink: () => { void doCreateLink(); },
    onPrint: printFrozenEvaluation,
    onCopyLink: () => {
      const linkEl = document.getElementById("lia-link") as HTMLInputElement | null;
      const url = linkEl?.value ?? "";
      if (!url) return;
      void copyLinkToClipboard(url).then(ok =>
        setLiveBarStatus(ok ? "Link copied to clipboard." : "Copy failed — please copy manually.")
      );
    },
  });

  // Start timer immediately — before declarations load — so early navigation is captured.
  _prevHash = getCurrentHash();
  startSlideTimer(_prevHash);
  window.addEventListener("hashchange", () => {
    const prev = _prevHash;
    const hash = getCurrentHash();
    _prevHash = hash;
    if (!gradingSendSubmission) {
      stopCurrentSlideTimer();
      startSlideTimer(hash);
    }
    setTimeout(reapplyContentLock, 80);
    setTimeout(refreshAssignmentDetails, 80);
    setTimeout(refreshMarkerRender, 80);
    setTimeout(refreshMarkerRender, 300);
    scheduleCoordinateRefresh();
    scheduleCanvasRefresh();
    scheduleAnnotationRefresh();
    scheduleNativeDomRestore(hash);
    refreshDeferredSendMode();
    if (!gradingSendSubmission) updateExamForHash(hash, prev);
    syncNameFields();
  });

  // Arm the rendered @Exam fallback before awaiting the source fetch. This
  // closes the user-interaction window when a course URL is slow or offline.
  activateRenderedExamFallback();
  installLateExamFallback();
  await loadCourseDeclarations();
  setDeferredSendPhase(evalOptions.deferFeedback ? 'collect' : 'off');
  refreshDeferredSendMode();
  activateRenderedExamFallback();
  captureNativeDomNow(getCurrentHash());

  if (evalOptions.trackF12) {
    installF12Tracking({
      isActive: () => !examConfig.enabled || examTimerStartedAtMs > 0,
    });
  } else if (fallbackSecurityTrackingInstalled) {
    installF12Tracking({ isActive: () => false });
  }
  if (evalOptions.trackTab) {
    installTabTracking({
      isActive: () => !examConfig.enabled || examTimerStartedAtMs > 0,
      allowMathpathExplain: mathpathExplainEnabled,
    });
  } else if (fallbackSecurityTrackingInstalled) {
    installTabTracking({ isActive: () => false });
  }
  if (examConfig.enabled) {
    installExamFullscreenTracking({
      isActive: () => examTimerStartedAtMs > 0 && !examLockToSubmission,
      allowMathpathExplain: mathpathExplainEnabled,
    });
  }

  // Fullscreen requires the explicit Start button. A deep link past the intro
  // is redirected to it instead of silently starting an unmonitored exam.
  if (examConfig.enabled) {
    const cur = resolveExamLocationHash(getCurrentHash());
    if (cur === examConfig.triggerHash) {
      setTimeout(showExamIntro, 180);
    } else if (examTimerStartedAtMs <= 0) {
      const triggerIdx = parseInt(examConfig.triggerHash.slice(1), 10);
      const curIdx     = parseInt((cur || "#1").slice(1), 10);
      if (!cur || curIdx > triggerIdx) {
        window.location.hash = examConfig.triggerHash;
        setTimeout(showExamIntro, 180);
      }
    }
  }
}

function waitForSendRender(delay: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, delay));
}

function setSendGradingOverlay(visible: boolean): void {
  const existing = document.getElementById('lia-send-grading-overlay');
  if (!visible) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const overlay = document.createElement('div');
  overlay.id = 'lia-send-grading-overlay';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'assertive');
  overlay.textContent = 'Abgabe wird eingefroren und anschließend ausgewertet …';
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:10000050',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:2rem',
    'box-sizing:border-box',
    'text-align:center',
    'font-size:clamp(1.4rem,4vw,3rem)',
    'font-weight:800',
    'background:var(--lia-course-bg)',
    'color:var(--lia-course-fg)',
  ].join(';');
  document.body.appendChild(overlay);
}

async function waitForSendQuizRoots(
  hash: string,
  taskIndexes: number[]
): Promise<{ host: Element; roots: Element[] }> {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    refreshDeferredSendMode();
    if (getCurrentHash() === hash) {
      const host = getContentHost();
      const roots = host ? Array.from(host.querySelectorAll('.lia-quiz')) : [];
      if (host?.isConnected && taskIndexes.every(index => {
        const root = roots[index];
        const check = root?.querySelector('.lia-quiz__check');
        return !!root?.isConnected && !!check?.isConnected;
      })) {
        restoreNativeDomForSlide(exportNativeDomFallback(), hash, host);
        await waitForSendRender(180);
        const restoredHost = getContentHost();
        const restoredRoots = restoredHost
          ? Array.from(restoredHost.querySelectorAll('.lia-quiz'))
          : [];
        if (restoredHost?.isConnected && taskIndexes.every(index => {
          const root = restoredRoots[index];
          const check = root?.querySelector('.lia-quiz__check');
          return !!root?.isConnected && !!check?.isConnected;
        })) {
          return { host: restoredHost, roots: restoredRoots };
        }
      }
    }
    await waitForSendRender(100);
  }
  throw new Error('Send grading could not render all recorded quizzes on ' + hash + '.');
}

function sendMarkerProxy(root: Element): Element | null {
  const direct = root.closest('.hlq-proxy');
  if (direct) return direct;
  return root.closest('.markerquiz')?.querySelector('.hlq-proxy') ?? null;
}

function currentDeferredSendHost(fallback: Element): Element {
  const current = getContentHost();
  return current?.isConnected ? current : fallback;
}

function currentDeferredOrthographyBinding(
  host: Element,
  uid: string
): {
  root?: Element;
  input?: HTMLInputElement | HTMLTextAreaElement;
} {
  if (!uid) return {};
  const byUid = <T extends HTMLElement>(selector: string): T | undefined =>
    Array.from(host.querySelectorAll<T>(selector))
      .find(candidate => candidate.dataset.orthoUid === uid);
  // The authored input and [[!]] quiz are siblings: both live below the
  // stable .orthography-ui UID container, never below each other.
  const ui = byUid<HTMLElement>('.orthography-ui[data-ortho-uid]');
  const checkScope = ui?.querySelector<HTMLElement>(
    '.orthography-check[data-ortho-uid]'
  ) ?? byUid<HTMLElement>('.orthography-check[data-ortho-uid]');
  const wrap = ui?.querySelector<HTMLElement>(
    '.orthography-wrap[data-ortho-uid]'
  ) ?? byUid<HTMLElement>('.orthography-wrap[data-ortho-uid]');
  const input = wrap?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input[id^='orthography-input-'],textarea[id^='orthographytext-input-'],[data-id^='lia-quiz-']"
  ) ?? undefined;
  return { root: checkScope?.querySelector('.lia-quiz') ?? undefined, input };
}

function commitDeferredOrthographyValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.defaultValue = value;
  if (input instanceof HTMLInputElement) input.setAttribute('value', value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function currentDeferredSendRoot(
  host: Element,
  taskIndex: number,
  orthographyUid = ''
): Element | undefined {
  const roots = Array.from(host.querySelectorAll('.lia-quiz'));
  if (orthographyUid) {
    const scopedRoot = currentDeferredOrthographyBinding(host, orthographyUid).root;
    if (scopedRoot) return scopedRoot;
    const byUid = roots.find(candidate =>
      candidate.getAttribute('data-ortho-uid') === orthographyUid
    );
    if (byUid) return byUid;
  }
  return roots[taskIndex];
}

async function prepareDeferredSendTemplateQuiz(
  host: Element,
  hash: string,
  taskIndex: number,
  initialRoot: Element,
  orthography?: { uid: string; value: string }
): Promise<Element> {
  let root = initialRoot;
  if (orthography?.uid) {
    type OrthographySendState = {
      liveValue?: unknown;
      solved?: unknown;
      resolvePending?: unknown;
    };
    type OrthographySendApi = {
      getAllStates?(): Record<string, OrthographySendState>;
      setState?(uid: string, value: string): void;
    };
    let runtimeWindow: Window | null = root.ownerDocument.defaultView;
    try {
      while (runtimeWindow?.parent && runtimeWindow.parent !== runtimeWindow) {
        runtimeWindow = runtimeWindow.parent;
      }
    } catch { /* use the nearest same-origin runtime */ }
    const api = (runtimeWindow as (Window & {
      __ORTHOGRAPHY_EXPORT_V8__?: OrthographySendApi;
    }) | null)?.__ORTHOGRAPHY_EXPORT_V8__;
    const state = api?.getAllStates?.()?.[orthography.uid];
    if (state) {
      state.liveValue = orthography.value;
      state.solved = false;
      state.resolvePending = false;
    }
    api?.setState?.(orthography.uid, orthography.value);
    await waitForSendRender(180);
    host = currentDeferredSendHost(host);
    const binding = currentDeferredOrthographyBinding(host, orthography.uid);
    if (binding.input) {
      // setState updates lia-orthography's external field, but LiaScript's
      // generic [[!]] shell observes DOM input/change events. Commit the exact
      // submitted value through that authored sibling so its native Check
      // control becomes ready without substituting a different quiz root.
      commitDeferredOrthographyValue(binding.input, orthography.value);
      await waitForSendRender(180);
      host = currentDeferredSendHost(host);
    }
    root = currentDeferredOrthographyBinding(host, orthography.uid).root
      ?? currentDeferredSendRoot(host, taskIndex, orthography.uid)
      ?? root;
  }

  const fractionWidget = root.closest<HTMLElement>('.fq-widget[data-fq-uid]');
  const fractionUid = fractionWidget?.dataset.fqUid ?? '';
  const fractionWindow = root.ownerDocument.defaultView as (Window & {
    __LIA_FRACTION_QUIZ__?: { check?(uid: string): unknown };
  }) | null;
  if (fractionUid && typeof fractionWindow?.__LIA_FRACTION_QUIZ__?.check === 'function') {
    fractionWindow.__LIA_FRACTION_QUIZ__.check(fractionUid);
    await waitForSendRender(80);
    host = currentDeferredSendHost(host);
    root = Array.from(host.querySelectorAll('.lia-quiz'))[taskIndex] ?? root;
  }

  let proxy = sendMarkerProxy(root);
  let markerScope = proxy?.closest('.markerquiz') ?? root.closest('.markerquiz');
  if (!proxy && !markerScope) return root;
  // The marker proxy and LiaScript quiz root are siblings inside .markerquiz.
  // Updating the proxy input can replace the native root, so retain the stable
  // authored scope instead of trying to rediscover the proxy from that root.
  const readMarkerValue = (candidate: Element | null): string =>
    candidate?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      'input.lia-quiz__input,textarea.lia-quiz__input,input[type="text"],input[type="number"]'
    )?.value.trim() ?? '';

  let value = '';
  const started = Date.now();
  while (!value && Date.now() - started < 5_000) {
    host = currentDeferredSendHost(host);
    root = Array.from(host.querySelectorAll('.lia-quiz'))[taskIndex] ?? root;
    const liveProxy = sendMarkerProxy(root)
      ?? (proxy?.isConnected ? proxy : null)
      ?? markerScope?.querySelector('.hlq-proxy')
      ?? null;
    if (liveProxy) {
      proxy = liveProxy;
      markerScope = liveProxy.closest('.markerquiz') ?? markerScope;
    }
    const internalCheck = proxy?.querySelector<HTMLElement>('[data-hlq-act="check"]');
    if (internalCheck?.isConnected) internalCheck.click();
    // lia-marker writes 1/0 synchronously during the click's capture handler.
    // Read that value before LiaScript gets a chance to replace the input.
    value = readMarkerValue(proxy);
    if (!value) await waitForSendRender(100);
  }
  if (value) {
    // Let LiaScript finish the input rerender, then continue with the native
    // root that belongs to this exact marker scope.
    await waitForSendRender(80);
    host = currentDeferredSendHost(host);
    const scopedCheck = markerScope?.querySelector<HTMLButtonElement>('.lia-quiz__check');
    const scopedRoot = scopedCheck?.closest('.lia-quiz');
    // The internal marker check can replace its native LiaScript root. Never
    // hand the readiness loop a detached shell merely because the old marker
    // scope can still be queried from memory.
    return (scopedRoot?.isConnected ? scopedRoot : undefined)
      ?? Array.from(host.querySelectorAll('.lia-quiz'))[taskIndex]
      ?? root;
  }
  throw new Error(
    'Send grading could not prepare the marker result for '
      + hash + ', task ' + (taskIndex + 1) + '.'
  );
}

async function gradeDeferredSendTasks(): Promise<NativeDomFallbackV1 | undefined> {
  const tasks = getDeferredSendTasks().filter(task =>
    evalDecl[task.hash]?.tl[task.taskIndex]?.table === 'quiz'
  );
  if (!tasks.length) return exportNativeDomFallback();

  const byHash = new Map<string, number[]>();
  tasks.forEach(task => {
    const indexes = byHash.get(task.hash) ?? [];
    if (!indexes.includes(task.taskIndex)) indexes.push(task.taskIndex);
    byHash.set(task.hash, indexes);
  });

  const originalHash = getCurrentHash();
  gradingSendSubmission = true;
  setDeferredSendPhase('grading');
  refreshDeferredSendMode();
  // Keep one immutable copy of the answers as they existed at submission
  // time. Some imported widgets (notably Canvas/OCR) replace their native
  // LiaScript input while other quizzes on the same slide are being graded.
  // Reading the live tracker later would then capture that replacement rather
  // than the student's submitted value.
  const gradingFallback = exportNativeDomFallback();
  let gradedFallback = gradingFallback;
  const captureGradedOutcome = (
    hash: string,
    root: Element,
    taskIndex: number,
    nativeIndex: number
  ): boolean => {
    if (!captureNativeDomTaskOutcomeNow(hash, root, taskIndex, nativeIndex)) return false;
    // Keep a transaction-local copy of every definitive result. The live DOM
    // tracker deliberately keeps observing remounts, but those later open
    // shells must never erase grading evidence before captureSnapshot.
    const captured = exportNativeDomFallback()?.slides?.[hash]?.find(task =>
      task.table === 'quiz'
      && task.taskIndex === taskIndex
      && task.outcome !== 'open'
    );
    if (!captured) return false;
    const slides = { ...(gradedFallback?.slides ?? {}) };
    slides[hash] = mergeNativeDomTaskSnapshots(slides[hash] ?? [], [captured]);
    gradedFallback = { version: 1, slides };
    return true;
  };

  try {
    for (const [hash, taskIndexes] of byHash) {
      if (getCurrentHash() !== hash) window.location.hash = hash;
      const rendered = await waitForSendQuizRoots(hash, taskIndexes);
      let host = rendered.host;
      const recordedTasks = gradingFallback?.slides?.[hash] ?? [];

      // A solved LiaScript quiz can remove its root from the rendered list.
      // Work from the highest authored index down so those removals never shift
      // the indexes of tasks that still need to be checked.
      for (const taskIndex of taskIndexes.slice().sort((a, b) => b - a)) {
        host = currentDeferredSendHost(host);
        // Restore only the task that is about to be checked. Restoring the whole
        // slide here would overwrite outcomes of tasks already graded above.
        const recordedTask = recordedTasks.find(task =>
          task.table === 'quiz' && task.taskIndex === taskIndex
        );
        const nativeIndex = recordedTask?.nativeIndex
          ?? (evalDecl[hash]?.tl.slice(0, taskIndex).filter(task => task.table === 'quiz').length
            ?? taskIndex);
        if (recordedTask) {
          restoreNativeDomForSlide({
            version: 1,
            slides: { [hash]: [recordedTask] },
          }, hash, host);
          await waitForSendRender(180);
          host = currentDeferredSendHost(host);
        }

        const orthography = recordedTask?.orthography;
        let root = currentDeferredSendRoot(host, taskIndex, orthography?.uid)
          ?? Array.from(host.querySelectorAll('.lia-quiz'))[taskIndex];
        if (!root) {
          const remounted = await waitForSendQuizRoots(hash, [taskIndex]);
          host = remounted.host;
          if (recordedTask) {
            restoreNativeDomForSlide({
              version: 1,
              slides: { [hash]: [recordedTask] },
            }, hash, host);
            await waitForSendRender(180);
            host = currentDeferredSendHost(host);
          }
          root = currentDeferredSendRoot(host, taskIndex, orthography?.uid)
            ?? Array.from(host.querySelectorAll('.lia-quiz'))[taskIndex];
        }
        if (!root) {
          throw new Error('Send grading could not render ' + hash + ', task ' + (taskIndex + 1) + '.');
        }
        if (captureGradedOutcome(hash, root, taskIndex, nativeIndex)) continue;
        root = await prepareDeferredSendTemplateQuiz(
          host,
          hash,
          taskIndex,
          root,
          orthography ? { uid: orthography.uid, value: orthography.value } : undefined
        );

        const readyStarted = Date.now();
        let preparedRoot: Element = root;
        let preparedAt = Date.now();
        let check: HTMLButtonElement | null = null;
        let checkClicked = false;
        while (Date.now() - readyStarted < 60_000) {
          host = currentDeferredSendHost(host);
          const currentRoot = currentDeferredSendRoot(host, taskIndex, orthography?.uid);
          if (currentRoot) root = currentRoot;
          check = root.querySelector<HTMLButtonElement>('.lia-quiz__check');
          if (root.isConnected && check?.isConnected && !check.disabled) {
            // Imported templates can remount the ready root on the very next
            // microtask. Dispatch the native check in the same turn in which
            // this exact root/button pair was verified instead of re-querying
            // it once more and racing that remount. In particular, Marker's
            // internal check deliberately remounts an already-ready root; do
            // not prepare that root a second time before using it.
            check.click();
            checkClicked = true;
            break;
          }
          if (
            root.isConnected
            && (root !== preparedRoot || Date.now() - preparedAt >= 12_000)
          ) {
            if (recordedTask) {
              restoreNativeDomForSlide({
                version: 1,
                slides: { [hash]: [recordedTask] },
              }, hash, host);
              await waitForSendRender(180);
              host = currentDeferredSendHost(host);
              root = currentDeferredSendRoot(host, taskIndex, orthography?.uid) ?? root;
            }
            root = await prepareDeferredSendTemplateQuiz(
              host,
              hash,
              taskIndex,
              root,
              orthography ? { uid: orthography.uid, value: orthography.value } : undefined
            );
            preparedRoot = root;
            preparedAt = Date.now();
          }
          check = root.querySelector<HTMLButtonElement>('.lia-quiz__check');
          if (root.isConnected && check?.isConnected && !check.disabled) {
            // Preparation itself may have made the same root ready without a
            // remount, so keep the same-turn check on this path as well.
            check.click();
            checkClicked = true;
            break;
          }
          await waitForSendRender(100);
        }
        if (!checkClicked) {
          host = currentDeferredSendHost(host);
          root = currentDeferredSendRoot(host, taskIndex, orthography?.uid) ?? root;
          check = root.querySelector<HTMLButtonElement>('.lia-quiz__check');
          if (!check) {
            throw new Error('Send grading found no check button for ' + hash + ', task ' + (taskIndex + 1) + '.');
          }
          throw new Error('Send grading could not restore the recorded answer for ' + hash + ', task ' + (taskIndex + 1) + '.');
        }

        const checkStarted = Date.now();
        let graded = false;
        let outcomeRoot: Element | null = null;
        while (Date.now() - checkStarted < 30_000) {
          await waitForSendRender(120);
          host = currentDeferredSendHost(host);
          if (captureGradedOutcome(hash, root, taskIndex, nativeIndex)) {
            graded = true;
            outcomeRoot = root;
            break;
          }
          const currentRoot = currentDeferredSendRoot(host, taskIndex, orthography?.uid);
          if (currentRoot) root = currentRoot;
          if (captureGradedOutcome(hash, root, taskIndex, nativeIndex)) {
            graded = true;
            outcomeRoot = root;
            break;
          }
        }
        if (!graded) {
          throw new Error('Send grading received no result for ' + hash + ', task ' + (taskIndex + 1) + '.');
        }
        // LiaScript may expose the outcome class just before its feedback text.
        // Give that final render a short settling window before the slide is captured.
        await waitForSendRender(240);
        if (outcomeRoot) {
          captureGradedOutcome(hash, outcomeRoot, taskIndex, nativeIndex);
        }
        host = currentDeferredSendHost(host);
        const settledRoot = currentDeferredSendRoot(host, taskIndex, orthography?.uid);
        if (settledRoot && settledRoot !== outcomeRoot) {
          captureGradedOutcome(hash, settledRoot, taskIndex, nativeIndex);
        }
      }
      captureNativeDomNow(hash);
    }
  } finally {
    if (getCurrentHash() !== originalHash) window.location.hash = originalHash;
    await waitForSendRender(750);
    gradingSendSubmission = false;
  }
  return gradedFallback;
}

async function doCreateLink(): Promise<void> {
  if (creatingLink || frozenLink) return;
  creatingLink = true;
  const submittedNameElement = document.getElementById('lia-name') as HTMLInputElement | null;
  const submittedName = (submittedNameElement?.value ?? '').trim();
  const createButton = document.getElementById("lia-create-link") as HTMLButtonElement | null;
  if (createButton) {
    createButton.disabled = true;
    createButton.textContent = "Creating link…";
  }
  setLiveBarStatus("Creating submission link…");
  try {
    stopCurrentSlideTimer();
    // Copy learner Check counts before any technical grading action. The
    // grading phase is intercepted separately, but this makes the submitted
    // evidence immutable even if a quiz implementation dispatches extra clicks.
    const frozenSendChecks = evalOptions.deferFeedback
      ? getDeferredSendCheckCounts()
      : undefined;
    let gradedNativeDom: NativeDomFallbackV1 | undefined;
    if (evalOptions.deferFeedback) {
      setSendGradingOverlay(true);
      captureNativeDomNow(getCurrentHash());
      gradedNativeDom = await gradeDeferredSendTasks();
    }

    // Use the H1-H6 section count so IDB indices for all quiz types are covered.
    // Fall back to declaredSlides length or 30 if declarations haven't loaded yet.
    const count = sectionCount || declaredSlides.length || 30;
    captureNativeDomNow(getCurrentHash());
    const snapshot = await captureSnapshot(count, {
      nativeDom: gradedNativeDom ?? exportNativeDomFallback(),
    });
    const sec = getSecurityState();

    snapshot.sec = {
      trackF12: evalOptions.trackF12 ? 1 : 0,
      trackTab: evalOptions.trackTab ? 1 : 0,
      f12: evalOptions.trackF12 ? sec.f12 : 0,
      tab: evalOptions.trackTab ? sec.tab : 0,
      ...(evalOptions.trackF12 ? { dt: sec.devtools } : {}),
      ...(examConfig.enabled ? { fs: sec.fullscreen } : {}),
    };

    if (evalOptions.trackTime) {
      const times = buildSlideTimeMs();
      if (Object.keys(times).length) snapshot.slideTimeMs = times;
    }

    const nameEl = document.getElementById("lia-name") as HTMLInputElement | null;
    const nameVal = (nameEl?.value ?? "").trim();
    const frozenStudentName = nameVal || submittedName;
    if (frozenStudentName) snapshot.n = frozenStudentName;
    if (frozenSendChecks) snapshot.sendChecks = frozenSendChecks;
    snapshot.ev = buildFrozenEvaluationMetadata(
      evalDecl,
      declaredSlides,
      abgabeHash,
      evalOptions,
      sectionCount || count
    );
    snapshot.doc = buildSubmissionDocumentMetadata({
      title: courseDocumentIdentity.title
        || declaredSlides.find(slide => !slide.vt)?.t
        || "",
      courseVersion: courseDocumentIdentity.courseVersion,
    });

    // Stop exam countdown once submission is successfully created
    if (examTickInterval) { clearInterval(examTickInterval); examTickInterval = 0; }
    getOrCreateCountdown().style.display = "none";

    const link = await buildLink(snapshot);
    activePayload = snapshot;
    frozenLink = link;
    frozenName = frozenStudentName;
    setLiveBarFrozen(link, frozenStudentName);

    setDeferredSendPhase(evalOptions.deferFeedback ? 'review' : 'off');
    refreshDeferredSendMode();
    setPageFrozen(true, false);
    scheduleNativeDomRestore(getCurrentHash());
    installFrozenNavigation();
    const canvasSlide = snapshot.s.find(slide => Array.isArray(slide.canvas));
    if (canvasSlide?.canvas) activateCanvasSnapshot(canvasSlide.canvas);
    activateAnnotationSnapshot(snapshot.annot);
  } catch (err) {
    if (evalOptions.deferFeedback && !frozenLink) {
      setDeferredSendPhase('collect');
      refreshDeferredSendMode();
    }
    setLiveBarStatus("Error: " + (err instanceof Error ? err.message : String(err)));
  } finally {
    setSendGradingOverlay(false);
    creatingLink = false;
    if (!frozenLink && createButton) {
      createButton.disabled = false;
      createButton.textContent = "Create Link";
    }
  }
}

function waitForPrintableSlide(): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, 650));
}

function clonePrintableSlide(source: Element, slide: DeclaredSlide): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.setProperty('display', 'block', 'important');
  clone.style.setProperty('position', 'static', 'important');
  clone.style.setProperty('width', '100%', 'important');
  clone.style.setProperty('height', 'auto', 'important');
  clone.style.setProperty('min-height', '0', 'important');
  clone.style.setProperty('opacity', '1', 'important');
  clone.style.setProperty('visibility', 'visible', 'important');
  clone.style.setProperty('transform', 'none', 'important');
  clone.style.setProperty('overflow', 'visible', 'important');
  clone.querySelectorAll(
    '#lia-freeze-bar,#lia-eval-placeholder,[data-snapshot-admin]'
  ).forEach(element => element.remove());

  const sourceCanvases = Array.from(source.querySelectorAll('canvas'));
  const cloneCanvases = Array.from(clone.querySelectorAll('canvas'));
  cloneCanvases.forEach((canvas, index) => {
    const original = sourceCanvases[index] as HTMLCanvasElement | undefined;
    if (!original) return;
    try {
      const image = document.createElement('img');
      image.src = original.toDataURL('image/png');
      image.alt = 'Canvas';
      image.style.width = original.clientWidth ? original.clientWidth + 'px' : '100%';
      image.style.maxWidth = '100%';
      image.style.height = 'auto';
      canvas.replaceWith(image);
    } catch {
      // A tainted third-party canvas remains in the clone as a last resort.
    }
  });

  clone.querySelectorAll('input,textarea,select').forEach(control => {
    const value = control instanceof HTMLInputElement && (
      control.type === 'checkbox' || control.type === 'radio'
    )
      ? (control.checked ? '\u2611' : '\u2610')
      : control instanceof HTMLSelectElement
        ? control.selectedOptions[0]?.textContent ?? control.value
        : (control as HTMLInputElement | HTMLTextAreaElement).value;
    const output = document.createElement('span');
    output.className = 'lia-print-control-value';
    output.textContent = value || '\u00a0';
    control.replaceWith(output);
  });

  const page = document.createElement('section');
  page.className = 'lia-print-slide';
  page.dataset.slideHash = slide.h;
  page.appendChild(clone);
  return page;
}

async function preparePrintableSlides(): Promise<HTMLElement> {
  document.getElementById('lia-print-slides')?.remove();
  const archive = document.createElement('div');
  archive.id = 'lia-print-slides';
  document.body.appendChild(archive);

  const originalHash = getCurrentHash();
  const evaluationWasVisible = evalContainer?.style.display === 'block';
  hideEvalPlaceholder();

  for (const slide of declaredSlides.filter(entry => !entry.vt)) {
    if (getCurrentHash() !== slide.h) window.location.hash = slide.h;
    await waitForPrintableSlide();
    const source = getContentHost();
    if (source) archive.appendChild(clonePrintableSlide(source, slide));
  }

  if (getCurrentHash() !== originalHash) window.location.hash = originalHash;
  await waitForPrintableSlide();
  if (evaluationWasVisible) showEvalPlaceholder();
  return archive;
}

async function printFrozenEvaluation(): Promise<void> {
  if (!activePayload || printingSubmission) return;

  const evaluationWasVisible = evalContainer?.style.display === "block";
  const evaluationParent = evalContainer?.parentNode ?? null;
  const evaluationNextSibling = evalContainer?.nextSibling ?? null;
  printingSubmission = true;
  setLiveBarStatus('Preparing all slides for PDF...');
  const printSlides = await preparePrintableSlides();
  // The evaluation overlay is created before the temporary slide archive in
  // the document. Static print layout follows DOM order, so move the same
  // element behind the archive while printing and restore its original anchor
  // afterwards. CSS order alone cannot reorder ordinary block flow reliably.
  if (evalContainer) printSlides.after(evalContainer);
  showEvalPlaceholder();
  setPrintReportMode(true);
  setLiveBarStatus("Opening print dialog…");

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    printingSubmission = false;
    setPrintReportMode(false);
    printSlides.remove();
    if (evalContainer && evaluationParent) {
      if (evaluationNextSibling?.parentNode === evaluationParent) {
        evaluationParent.insertBefore(evalContainer, evaluationNextSibling);
      } else {
        evaluationParent.appendChild(evalContainer);
      }
    }
    window.removeEventListener("afterprint", cleanup);
    if (!evaluationWasVisible) hideEvalPlaceholder();
    setLiveBarStatus("Print dialog closed.");
  };

  window.addEventListener("afterprint", cleanup, { once: true });
  try {
    window.print();
  } catch (error) {
    cleanup();
    setLiveBarStatus(
      "Could not open print dialog: "
      + (error instanceof Error ? error.message : String(error))
    );
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  injectRuntimeCSS();
  configureDeferredSendMode({
    getHash: getCurrentHash,
    getRuntimeWindows: sameOriginRuntimeWindows,
    getContentHost: getContentHostForDocument,
    onLogged: () => captureNativeDomNow(getCurrentHash()),
    onReviewResolve: task => {
      const key = makeDeferredSendTaskKey(task.hash, task.taskIndex);
      if (key) reviewedSendSolutionKeys.add(key);
      nativeDomRestoreGeneration += 1;
    },
    onReviewMarkerSolve: () => {
      cancelPendingMarkerRestore();
      const captureReview = () => {
        const state = captureMarkerReviewState();
        if (!state || !activePayload?.s.length) return;
        const slide = activePayload.s.find(candidate => candidate.marker !== undefined)
          ?? activePayload.s[0];
        slide.marker = state;
      };
      [0, 80, 240, 600, 1200].forEach(delay => {
        window.setTimeout(captureReview, delay);
      });
    },
  });
  installAbgabeRestoreObserver();
  installCoordinateMutationRefreshObserver();
  applyThemeColors();
  applyCourseColors();
  setTimeout(refreshAssignmentDetails, 0);
  new MutationObserver(() => { applyThemeColors(); applyCourseColors(); }).observe(document.documentElement, {
    attributes: true, attributeFilter: ["class", "style", "data-theme"],
  });
  // Patch history.pushState/replaceState so LiaScript arrow navigation triggers onHashChange
  const _push = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState = function (...args) {
    captureCanvasProgressBestEffort();
    captureAnnotationProgressBestEffort();
    captureCoordinateProgress();
    captureNativeDomNow(getCurrentHash());
    const r = _push(...args); onHashChange(); return r;
  };
  history.replaceState = function (...args) {
    captureCanvasProgressBestEffort();
    captureAnnotationProgressBestEffort();
    captureCoordinateProgress();
    captureNativeDomNow(getCurrentHash());
    const r = _replace(...args); onHashChange(); return r;
  };

  installPortIntercept();

  const token = getSubmissionToken();
  if (token) storeToken(token);

  const payload = await loadPayload();

  if (payload) {
    await bootSharedLinkMode(payload as SnapshotPayload);
  } else {
    await bootLiveMode();
  }
  booted = true;
  scheduleCoordinateRefresh();
  scheduleCanvasRefresh();
  scheduleAnnotationRefresh();
}

function safeBoot(): void {
  init().catch(err => console.error("[LIA-FREEZE]", err));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", safeBoot);
} else {
  setTimeout(safeBoot, 0);
}
