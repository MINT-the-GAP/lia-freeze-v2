// Entry point. Detects live vs. shared-link mode, boots the appropriate flow,
// and wires hash-change handling, the abgabe slide, and the evaluation overlay.
import { installPortIntercept } from "./port";
import { captureSnapshot, restoreSnapshot, SnapshotPayload } from "./snapshot";
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
  installFreezeBar,
  setFreezeBarState,
  setPageFrozen,
  reapplyContentLock,
  wireLiveBar,
  setLiveBarStatus,
  setLiveBarFrozen,
  copyLinkToClipboard,
} from "./freeze-ui";
import {
  parseEvaluationOptions,
  parseDeclaredSlides,
  parseAbgabeHash,
  parseSectionCount,
  parseEvaluationDeclarations,
  parseExamConfig,
  renderEvaluationSlide,
  DeclaredSlide,
  ExamConfig,
} from "./evaluation";
import { installF12Tracking, installTabTracking, getSecurityState } from "./security";

// ── Module state ──────────────────────────────────────────────────────────────

let declaredSlides: DeclaredSlide[] = [];
let evalDecl: ReturnType<typeof parseEvaluationDeclarations> = Object.create(null);
let evalOptions: ReturnType<typeof parseEvaluationOptions> = { trackF12: false, trackTab: false, trackTime: false };
let abgabeHash = "";
let sectionCount = 0;

let activePayload: SnapshotPayload | null = null;
let evalContainer: HTMLElement | null = null;
let frozenLink = "";
let frozenName = "";
let booted = false;

// ── Exam state ────────────────────────────────────────────────────────────────

let examConfig: ExamConfig = { enabled: false, durationMinutes: 0, triggerHash: "" };
let examTimerStartedAtMs = 0;
let examTimerEndsAtMs = 0;
let examLockToSubmission = false;
let examTickInterval = 0;
let examLockWatchInterval = 0;

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

  if (examTickInterval) clearInterval(examTickInterval);
  examTickInterval = window.setInterval(tickExamTimer, 1000);
  tickExamTimer();
}

function lockExamAndFreeze(): void {
  if (!examConfig.enabled) return;
  if (document.body.classList.contains("lia-snapshot-mode")) return;

  examLockToSubmission = true;
  if (examTickInterval) { clearInterval(examTickInterval); examTickInterval = 0; }
  getOrCreateCountdown().style.display = "none";


  // Navigate to the Abgabe slide and auto-freeze
  if (abgabeHash) window.location.hash = abgabeHash;
  void doCreateLink();

  // Enforce lock: if student tries to navigate away, bounce back
  if (!examLockWatchInterval) {
    examLockWatchInterval = window.setInterval(() => {
      if (!examLockToSubmission) return;
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
    dur + ' minutes</span></strong>.</p>' +
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

  // Guard: if leaving the intro slide without a name, bounce back immediately
  if (
    examTimerStartedAtMs <= 0 &&
    examConfig.triggerHash &&
    prevHash === examConfig.triggerHash &&
    hash !== examConfig.triggerHash
  ) {
    const name = (document.querySelector<HTMLInputElement>(".lia-exam-name-input")?.value ?? "").trim();
    if (!name) {
      setTimeout(() => { window.location.hash = examConfig.triggerHash; }, 0);
      return;
    }
    syncNameFields();
    startExamTimer();
  }

  // Show/remove intro card
  removeExamIntro();
  if (hash === examConfig.triggerHash && examTimerStartedAtMs <= 0) {
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
  return !!ev && ev.h === hash;
}

// ── Course markdown fetch ─────────────────────────────────────────────────────

async function fetchCourseMarkdown(): Promise<string | null> {
  const search = window.location.search;
  if (!search || search === "?") return null;
  try {
    const raw = decodeURIComponent(search.slice(1));
    const u = new URL(raw, window.location.href);
    if (u.hash.startsWith("#submission=")) u.hash = "";
    const resp = await fetch(u.toString(), { cache: "no-store" });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

async function loadCourseDeclarations(): Promise<void> {
  const md = await fetchCourseMarkdown();
  if (!md) return;
  evalOptions    = parseEvaluationOptions(md);
  declaredSlides = parseDeclaredSlides(md);
  abgabeHash     = parseAbgabeHash(md);
  sectionCount   = parseSectionCount(md);
  evalDecl       = parseEvaluationDeclarations(md);
  examConfig     = parseExamConfig(md);
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
    title: evalSlide?.t,
    name: activePayload.n,
    slides: declaredSlides,
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
  });
}

// ── Abgabe slide restore ──────────────────────────────────────────────────────

function applyFrozenAbgabeValues(): void {
  if (!frozenLink) return;
  const nameEl  = document.getElementById("lia-name")        as HTMLInputElement | null;
  const linkEl  = document.getElementById("lia-link")        as HTMLInputElement | null;
  const btnEl   = document.getElementById("lia-create-link") as HTMLButtonElement | null;
  const copyBtn = document.getElementById("lia-copy-link")   as HTMLButtonElement | null;
  const noteEl  = document.getElementById("lia-frozen-note");

  if (nameEl) { nameEl.value = frozenName; nameEl.disabled = true; }
  if (btnEl)  { btnEl.disabled = true; btnEl.textContent = "Submission frozen"; }
  if (linkEl) {
    linkEl.value = frozenLink;
    linkEl.disabled = false;
    (linkEl as any).readOnly = true;
    linkEl.style.pointerEvents = "auto";
    linkEl.style.userSelect = "text";
  }
  if (copyBtn) copyBtn.disabled = !frozenLink;
  if (noteEl)  noteEl.style.display = "block";
}

function installAbgabeRestoreObserver(): void {
  const obs = new MutationObserver(() => {
    if (!frozenLink) return;
    const linkEl = document.getElementById("lia-link") as HTMLInputElement | null;
    if (linkEl && !linkEl.value) {
      applyFrozenAbgabeValues();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// ── Hash change listener ──────────────────────────────────────────────────────

let _prevHash = "";

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
  refreshFreezeBar();
  updateExamForHash(hash, prev);
  syncNameFields();
}

// ── Shared-link mode ──────────────────────────────────────────────────────────

async function bootSharedLinkMode(payload: SnapshotPayload): Promise<void> {
  activePayload = payload;
  setPageFrozen(true, true);

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
      if (ev) { window.location.hash = ev.h; showEvalPlaceholder(); }
    },
  });

  window.addEventListener("hashchange", onHashChange);

  await loadCourseDeclarations();

  // Install fraud tracking if the snapshot requested it
  if (payload.sec?.trackF12) installF12Tracking();
  if (payload.sec?.trackTab) installTabTracking();

  // Restore native quiz state via port
  restoreSnapshot(payload);

  // Determine where to navigate: prefer eval slide on shared links
  const ev = getEvalSlide();
  // Navigate to a real LiaScript slide (abgabe or last known), then overlay the eval card.
  // The eval hash is virtual and unknown to LiaScript, so we never set it directly.
  window.location.hash = abgabeHash || payload.sh || "#1";
  if (ev) setTimeout(() => showEvalPlaceholder(), 300);

  refreshFreezeBar();
}

// ── Live mode ─────────────────────────────────────────────────────────────────

async function bootLiveMode(): Promise<void> {
  wireLiveBar({
    onCreateLink: () => { void doCreateLink(); },
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
    stopCurrentSlideTimer();
    startSlideTimer(hash);
    setTimeout(reapplyContentLock, 80);
    updateExamForHash(hash, prev);
    syncNameFields();
  });

  await loadCourseDeclarations();

  if (evalOptions.trackF12) installF12Tracking();
  if (evalOptions.trackTab) installTabTracking();

  // Exam init: only start timer if already past the intro slide.
  // If on the intro slide, show the card.
  if (examConfig.enabled) {
    const cur = getCurrentHash();
    if (cur === examConfig.triggerHash) {
      setTimeout(showExamIntro, 180);
    } else if (examTimerStartedAtMs <= 0) {
      // Only auto-start if the student somehow landed past the intro slide
      // (e.g. direct URL with a hash beyond the trigger).
      const triggerIdx = parseInt(examConfig.triggerHash.slice(1), 10);
      const curIdx     = parseInt((cur || "#1").slice(1), 10);
      if (curIdx > triggerIdx) {
        startExamTimer();
      }
    }
  }
}

async function doCreateLink(): Promise<void> {
  setLiveBarStatus("Creating submission link…");
  try {
    stopCurrentSlideTimer();

    // Use the H1-H6 section count so IDB indices for all quiz types are covered.
    // Fall back to declaredSlides length or 30 if declarations haven't loaded yet.
    const count = sectionCount || declaredSlides.length || 30;
    const snapshot = await captureSnapshot(count);
    const sec = getSecurityState();

    snapshot.sec = {
      trackF12: evalOptions.trackF12 ? 1 : 0,
      trackTab: evalOptions.trackTab ? 1 : 0,
      f12: sec.f12,
      tab: sec.tab,
    };

    if (evalOptions.trackTime) {
      const times = buildSlideTimeMs();
      if (Object.keys(times).length) snapshot.slideTimeMs = times;
    }

    const nameEl = document.getElementById("lia-name") as HTMLInputElement | null;
    const nameVal = (nameEl?.value ?? "").trim();
    if (nameVal) snapshot.n = nameVal;

    // Stop exam countdown once submission is successfully created
    if (examTickInterval) { clearInterval(examTickInterval); examTickInterval = 0; }
    getOrCreateCountdown().style.display = "none";

    const link = await buildLink(snapshot);
    frozenLink = link;
    frozenName = nameVal;
    setLiveBarFrozen(link, nameVal);

    activePayload = snapshot;
    setPageFrozen(true, false);
  } catch (err) {
    setLiveBarStatus("Error: " + (err instanceof Error ? err.message : String(err)));
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  injectRuntimeCSS();
  installAbgabeRestoreObserver();
  applyThemeColors();
  applyCourseColors();
  new MutationObserver(() => { applyThemeColors(); applyCourseColors(); }).observe(document.documentElement, {
    attributes: true, attributeFilter: ["class", "style", "data-theme"],
  });
  // Patch history.pushState/replaceState so LiaScript arrow navigation triggers onHashChange
  const _push = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState = function (...args) {
    const r = _push(...args); onHashChange(); return r;
  };
  history.replaceState = function (...args) {
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
}

function safeBoot(): void {
  init().catch(err => console.error("[LIA-FREEZE]", err));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", safeBoot);
} else {
  setTimeout(safeBoot, 0);
}
