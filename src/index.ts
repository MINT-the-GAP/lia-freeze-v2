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
  renderEvaluationSlide,
  DeclaredSlide,
} from "./evaluation";
import { installF12Tracking, installTabTracking, getSecurityState } from "./security";

// ── Module state ──────────────────────────────────────────────────────────────

let declaredSlides: DeclaredSlide[] = [];
let evalDecl: ReturnType<typeof parseEvaluationDeclarations> = Object.create(null);
let evalOptions: ReturnType<typeof parseEvaluationOptions> = { trackF12: false, trackTab: false };
let abgabeHash = "";
let sectionCount = 0;

let activePayload: SnapshotPayload | null = null;
let evalContainer: HTMLElement | null = null;
let frozenLink = "";
let frozenName = "";
let booted = false;

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
  });
  const bar = document.getElementById("lia-freeze-bar");
  const barH = bar ? (bar as HTMLElement).offsetHeight : 64;
  el.style.top = (barH + 12) + "px";
  el.style.display = "block";

  // Hide the underlying LiaScript slide so the eval card appears alone.
  const host = document.querySelector<HTMLElement>(
    "main.lia-slide__content, .lia-content, main, article"
  );
  if (host) { host.style.opacity = "0"; host.style.pointerEvents = "none"; }
}

function hideEvalPlaceholder(): void {
  if (evalContainer) evalContainer.style.display = "none";
  const host = document.querySelector<HTMLElement>(
    "main.lia-slide__content, .lia-content, main, article"
  );
  if (host) { host.style.opacity = ""; host.style.pointerEvents = ""; }
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

function onHashChange(): void {
  if (!booted) return;
  const hash = getCurrentHash();
  if (isEvalHash(hash)) {
    showEvalPlaceholder();
  } else {
    hideEvalPlaceholder();
  }
  // Slide DOM is replaced on navigation — wait for render before re-locking.
  setTimeout(reapplyContentLock, 80);
  refreshFreezeBar();
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
  const target = ev?.h ?? abgabeHash ?? payload.sh ?? "#1";

  window.location.hash = target;
  if (ev && target === ev.h) showEvalPlaceholder();

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

  window.addEventListener("hashchange", () => { setTimeout(reapplyContentLock, 80); });

  await loadCourseDeclarations();

  if (evalOptions.trackF12) installF12Tracking();
  if (evalOptions.trackTab) installTabTracking();
}

async function doCreateLink(): Promise<void> {
  setLiveBarStatus("Creating submission link…");
  try {
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

    const nameEl = document.getElementById("lia-name") as HTMLInputElement | null;
    const nameVal = (nameEl?.value ?? "").trim();
    if (nameVal) snapshot.n = nameVal;

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
