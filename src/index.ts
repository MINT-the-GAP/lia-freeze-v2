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
  parseEvaluationDeclarations,
  renderEvaluationSlide,
  DeclaredSlide,
} from "./evaluation";
import { installF12Tracking, installTabTracking, getSecurityState } from "./security";

// ── Window globals ────────────────────────────────────────────────────────────

// ── Module state ──────────────────────────────────────────────────────────────

let declaredSlides: DeclaredSlide[] = [];
let evalDecl: ReturnType<typeof parseEvaluationDeclarations> = Object.create(null);
let evalOptions: ReturnType<typeof parseEvaluationOptions> = { trackF12: false, trackTab: false };
let abgabeHash = "";

let activePayload: SnapshotPayload | null = null;
let evalContainer: HTMLElement | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getEvalSlide(): DeclaredSlide | undefined {
  return declaredSlides.find(s => s.vt === "evaluation");
}

function hashIndex(hash: string): number {
  const m = hash.match(/^#(\d+)$/);
  return m ? parseInt(m[1], 10) : 1;
}

function totalSlides(): number {
  return declaredSlides.length || 1;
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
  evalOptions  = parseEvaluationOptions(md);
  declaredSlides = parseDeclaredSlides(md);
  abgabeHash   = parseAbgabeHash(md);
  evalDecl     = parseEvaluationDeclarations(md);
}

// ── Evaluation placeholder ────────────────────────────────────────────────────

function getOrCreateEvalContainer(): HTMLElement {
  if (evalContainer) return evalContainer;
  const el = document.createElement("div");
  el.id = "lia-eval-placeholder";
  el.style.cssText = [
    "display:none",
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "bottom:0",
    "overflow-y:auto",
    "z-index:9000",
    "padding:4rem 1.5rem 3rem",
    "box-sizing:border-box",
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
  });
  const bar = document.getElementById("lia-freeze-bar");
  const barH = bar ? (bar as HTMLElement).offsetHeight : 64;
  el.style.paddingTop = (barH + 24) + "px";
  el.style.display = "block";
}

function hideEvalPlaceholder(): void {
  if (evalContainer) evalContainer.style.display = "none";
}

// ── Freeze bar ────────────────────────────────────────────────────────────────

function refreshFreezeBar(): void {
  const idx = hashIndex(getCurrentHash());
  const total = totalSlides();
  const current = declaredSlides[idx - 1];
  setFreezeBarState({
    slideTitle: current?.t ?? "",
    slidePos: idx + " / " + total,
    canFirst: idx > 1,
    canPrev:  idx > 1,
    canNext:  idx < total,
    canEval:  !!getEvalSlide(),
  });
}

// ── Hash change listener ──────────────────────────────────────────────────────

function onHashChange(): void {
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

  installFreezeBar({
    onFirst: () => { hideEvalPlaceholder(); window.location.hash = "#1"; },
    onPrev:  () => { hideEvalPlaceholder(); window.location.hash = "#" + Math.max(1, hashIndex(getCurrentHash()) - 1); },
    onNext:  () => { hideEvalPlaceholder(); window.location.hash = "#" + Math.min(totalSlides(), hashIndex(getCurrentHash()) + 1); },
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
    // sectionCount: one section per declared slide, or fall back to 20 as safe upper bound
    const sectionCount = declaredSlides.length || 20;
    const snapshot = await captureSnapshot(sectionCount);
    const sec = getSecurityState();

    snapshot.sec = {
      trackF12: evalOptions.trackF12 ? 1 : 0,
      trackTab: evalOptions.trackTab ? 1 : 0,
      f12: sec.f12,
      tab: sec.tab,
    };

    const link = await buildLink(snapshot);
    const nameEl = document.getElementById("lia-name") as HTMLInputElement | null;
    setLiveBarFrozen(link, nameEl?.value ?? "");

    activePayload = snapshot;
    setPageFrozen(true, false);
  } catch (err) {
    setLiveBarStatus("Error: " + (err instanceof Error ? err.message : String(err)));
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  injectRuntimeCSS();
  installPortIntercept();

  const token = getSubmissionToken();
  if (token) storeToken(token);

  const payload = await loadPayload();

  if (payload) {
    await bootSharedLinkMode(payload as SnapshotPayload);
  } else {
    await bootLiveMode();
  }
}

function safeBoot(): void {
  init().catch(err => console.error("[LIA-FREEZE]", err));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", safeBoot);
} else {
  setTimeout(safeBoot, 0);
}
