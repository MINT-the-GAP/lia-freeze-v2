// All DOM and CSS for the plugin: runtime styles, the freeze nav bar (teacher),
// the live submit box helpers (student), and the content lock logic.

// ── Types ─────────────────────────────────────────────────────────────────────

export type FreezeBarState = {
  slideTitle: string;
  slidePos: string;       // e.g. "3 / 7"
  canFirst: boolean;
  canPrev: boolean;
  canNext: boolean;
  canEval: boolean;       // whether an evaluation slide exists
};

// ── Runtime CSS ───────────────────────────────────────────────────────────────

const STYLE_ID = "lia-submission-runtime-style";

export function injectRuntimeCSS(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
:root {
  --lia-submit-bg-rgb: 106, 92, 255;
  --lia-submit-fg: #ffffff;
  --lia-submit-border-on-theme: rgba(255,255,255,.34);
  --lia-submit-button-bg: rgba(255,255,255,.14);
  --lia-submit-note-bg: rgba(0,0,0,.14);
  --lia-course-bg: #ffffff;
  --lia-course-fg: #111111;
  --lia-course-border: rgba(0,0,0,.20);
  --lia-submit-input-bg: #ffffff;
  --lia-submit-input-fg: #111111;
  --lia-submit-input-border: rgba(0,0,0,.20);
  --lia-submit-placeholder: rgba(17,17,17,.65);
}

@media (prefers-color-scheme: dark) {
  :root {
    --lia-course-bg: #1a1a1e;
    --lia-course-fg: #f3f3f3;
    --lia-course-border: rgba(255,255,255,.20);
    --lia-submit-input-bg: #1f1f24;
    --lia-submit-input-fg: #f3f3f3;
    --lia-submit-input-border: rgba(255,255,255,.20);
    --lia-submit-placeholder: rgba(243,243,243,.60);
  }
}

/* ── Submit box (live @Abgabe slide) ── */
.lia-submit-box {
  margin-top: 1.25rem;
  padding: 1rem;
  border: 1px solid var(--lia-submit-border-on-theme);
  border-radius: 14px;
  background: rgb(var(--lia-submit-bg-rgb));
  color: var(--lia-submit-fg);
  box-shadow: 0 10px 26px rgba(0,0,0,.14);
}
.lia-submit-box label {
  display: block;
  font-weight: 700;
  margin: .7rem 0 .25rem 0;
}
.lia-submit-box input[type="text"],
.lia-submit-box textarea {
  text-align: left !important;
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: .78rem .95rem;
  border-radius: 10px;
  line-height: 1.4;
  outline: none;
  background: var(--lia-course-bg);
  color: var(--lia-course-fg) !important;
  -webkit-text-fill-color: var(--lia-course-fg) !important;
  caret-color: var(--lia-course-fg);
  border: 1px solid var(--lia-course-border);
  opacity: 1;
}
.lia-submit-box input[type="text"]:read-only,
.lia-submit-box textarea:read-only,
.lia-submit-box input[type="text"]:disabled,
.lia-submit-box textarea:disabled {
  color: var(--lia-course-fg) !important;
  -webkit-text-fill-color: var(--lia-course-fg) !important;
  opacity: 1;
}
.lia-submit-box input::placeholder,
.lia-submit-box textarea::placeholder {
  color: color-mix(in srgb, var(--lia-course-fg) 65%, transparent);
  -webkit-text-fill-color: color-mix(in srgb, var(--lia-course-fg) 65%, transparent);
}
.lia-submit-box textarea { min-height: 110px; resize: vertical; }
.lia-submit-box button {
  margin-top: 1rem;
  padding: .78rem 1.05rem;
  border-radius: 10px;
  cursor: pointer;
  font-size: 2.25rem;
  font-weight: 700;
  background: var(--lia-submit-button-bg);
  color: var(--lia-submit-fg);
  border: 1px solid var(--lia-submit-border-on-theme);
}
.lia-submit-box button:disabled { opacity: .82; cursor: not-allowed; }
.lia-submit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: .75rem;
  margin-top: 1rem;
  justify-content: flex-start;
}
.lia-submit-actions button { margin-top: 0; flex: 0 0 320px; width: 320px; max-width: 100%; }

#lia-status { margin-top: .85rem; font-weight: 700; }

.lia-frozen-note {
  display: none;
  margin-top: 1rem;
  padding: .8rem 1rem;
  border-radius: 10px;
  border: 1px solid var(--lia-submit-border-on-theme);
  background: var(--lia-submit-note-bg);
  color: var(--lia-submit-fg);
}
body.lia-course-frozen .lia-frozen-note { display: block; }

/* ── Freeze nav bar (shared-link mode) ── */
#lia-freeze-bar {
  display: none;
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: min(1180px, calc(100vw - 16px));
  box-sizing: border-box;
  z-index: 99999;
  padding: .62rem .85rem;
  border-radius: 0 0 14px 14px;
  background: rgb(var(--lia-submit-bg-rgb));
  color: var(--lia-submit-fg);
  border: 1px solid var(--lia-submit-border-on-theme);
  box-shadow: 0 10px 26px rgba(0,0,0,.14);
}
body.lia-snapshot-mode #lia-freeze-bar { display: block; }

#lia-freeze-bar-inner {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: .9rem;
}
.lia-freeze-nav-group { display: flex; align-items: center; gap: .45rem; }
#lia-freeze-center {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
#lia-freeze-head {
  font-weight: 800;
  font-size: 1rem;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
#lia-freeze-bar button {
  width: 46px;
  height: 46px;
  min-width: 46px;
  padding: 0;
  border-radius: 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--lia-submit-button-bg);
  color: var(--lia-submit-fg);
  border: 1px solid var(--lia-submit-border-on-theme);
}
#lia-freeze-bar button:disabled { opacity: .55; cursor: not-allowed; }
.lia-freeze-icon { width: 28px; height: 28px; display: block; pointer-events: none; }

/* ── Freeze info banner (shared-link mode, sticky) ── */
#lia-freeze-info {
  display: none;
  position: sticky;
  top: 0;
  z-index: 50;
  width: 100%;
  box-sizing: border-box;
  margin: 0 0 1rem 0;
  padding: .8rem 1rem;
  border-radius: 12px;
  font-weight: 700;
  background: rgb(var(--lia-submit-bg-rgb));
  color: var(--lia-submit-fg);
  border: 1px solid var(--lia-submit-border-on-theme);
  box-shadow: 0 10px 26px rgba(0,0,0,.14);
}
body.lia-snapshot-mode #lia-freeze-info { display: block !important; }

/* ── Content lock (applies only inside the slide content area) ── */
.lia-frozen-scope button,
.lia-frozen-scope input,
.lia-frozen-scope select,
.lia-frozen-scope textarea,
.lia-frozen-scope a,
.lia-frozen-scope summary,
.lia-frozen-scope [role="button"],
.lia-frozen-scope [contenteditable="true"] {
  pointer-events: none !important;
  cursor: not-allowed !important;
}
.lia-frozen-scope .lia-annot-toolbar,
.lia-frozen-scope .lia-annot-toolbar * { pointer-events: auto !important; }
.lia-frozen-scope .lia-annot-toolbar button,
.lia-frozen-scope .lia-annot-toolbar [role="button"] { cursor: pointer !important; }
.lia-frozen-scope #lia-copy-link { pointer-events: auto !important; cursor: pointer !important; }
.lia-frozen-scope #lia-link {
  pointer-events: auto !important;
  cursor: text !important;
  user-select: text !important;
}
.lia-frozen-scope .lia-exam-name-input,
.lia-frozen-scope .lia-exam-start-btn {
  pointer-events: auto !important;
  cursor: auto !important;
}
.lia-frozen-scope .lia-exam-start-btn { cursor: pointer !important; }

/* ── Static quiz freeze ── */
.lia-frozen-static-quiz {
  display: block;
}
.lia-frozen-static-quiz * {
  pointer-events: none !important;
}

/* ── Exam intro overlay ── */
#lia-exam-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 10000001;
  overflow-y: auto;
  align-items: flex-start;
  justify-content: center;
  padding: 3rem 1.5rem;
  box-sizing: border-box;
  background: var(--lia-course-bg);
}

/* ── Exam shake animation ── */
@keyframes lia-exam-shake {
  0%,100% { transform: translateX(0); }
  20%      { transform: translateX(-8px); }
  40%      { transform: translateX(8px); }
  60%      { transform: translateX(-6px); }
  80%      { transform: translateX(6px); }
}

/* ── Exam countdown widget ── */
#lia-exam-countdown {
  position: fixed;
  right: 30px;
  bottom: 5px;
  z-index: 99995;
  padding: .25rem .35rem;
  border-radius: 8px;
  font-weight: 800;
  font-size: 1.75rem;
  line-height: 1.2;
  color: #c1121f;
  background: color-mix(in srgb, #c1121f 8%, transparent);
  border: 2px solid #c1121f;
  pointer-events: none;
  display: none;
}
@media (max-width: 700px) {
  #lia-exam-countdown { right: 12px; bottom: 30px; }
}

/* ── @ADetails scoring badges ── */
.lia-adetails-points {
  display: inline-flex;
  align-items: center;
  gap: .28rem;
  margin-left: .7rem;
  font-weight: 700;
  white-space: nowrap;
  opacity: .92;
  color: inherit;
  pointer-events: none !important;
}
.lia-adetails-award-input {
  width: 3.2em;
  box-sizing: border-box;
  padding: .10rem .28rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, rgb(var(--lia-submit-bg-rgb)) 55%, var(--lia-course-fg) 45%);
  background: color-mix(in srgb, rgb(var(--lia-submit-bg-rgb)) 99%, var(--lia-course-bg) 1%);
  color: #ffffff !important;
  -webkit-text-fill-color: #ffffff !important;
  caret-color: #ffffff;
  font: inherit;
  font-weight: 700;
  text-align: center;
}
body.lia-shared-freeze-link .lia-frozen-scope .lia-adetails-award-input {
  pointer-events: auto !important;
  cursor: text !important;
  user-select: text !important;
}
`.trim();

  (document.head || document.documentElement).appendChild(style);
}

// ── Theme sync ────────────────────────────────────────────────────────────────

export function applyCourseColors(): void {
  const probe =
    document.querySelector<Element>(".lia-slide.active .lia-slide__content") ??
    document.querySelector<Element>(".lia-slide.current .lia-slide__content") ??
    document.querySelector<Element>("main.lia-slide__content") ??
    document.querySelector<Element>(".lia-content") ??
    document.querySelector<Element>("main") ??
    document.body;

  let el: Element | null = probe;
  let bg = "", fg = "";
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    const b = cs.backgroundColor;
    if (b && b !== "transparent" && b !== "rgba(0, 0, 0, 0)") { bg = b; fg = cs.color; break; }
    el = el.parentElement;
  }
  if (!bg) {
    bg = getComputedStyle(document.body).backgroundColor || "rgb(255,255,255)";
    fg = getComputedStyle(document.body).color || "rgb(17,17,17)";
  }

  const nums = fg.match(/\d+(\.\d+)?/g) || [];
  const border = nums.length >= 3 ? `rgba(${nums[0]},${nums[1]},${nums[2]},0.22)` : "rgba(0,0,0,0.22)";
  const root = document.documentElement;
  root.style.setProperty("--lia-course-bg", bg);
  root.style.setProperty("--lia-course-fg", fg);
  root.style.setProperty("--lia-course-border", border);
}

export function applyThemeColors(): void {
  const raw = (getComputedStyle(document.body).getPropertyValue("--color-highlight") ||
               getComputedStyle(document.documentElement).getPropertyValue("--color-highlight")).trim();
  const nums = raw.match(/\d+(\.\d+)?/g) || [];
  if (nums.length < 3) return;
  const [r, g, b] = [Number(nums[0]), Number(nums[1]), Number(nums[2])];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const bright = luminance > 160;
  const root = document.documentElement;
  root.style.setProperty("--lia-submit-bg-rgb", `${r}, ${g}, ${b}`);
  root.style.setProperty("--lia-submit-fg", bright ? "#111111" : "#ffffff");
  root.style.setProperty("--lia-submit-border-on-theme", bright ? "rgba(0,0,0,.24)" : "rgba(255,255,255,.34)");
  root.style.setProperty("--lia-submit-button-bg", bright ? "rgba(255,255,255,.38)" : "rgba(255,255,255,.14)");
  root.style.setProperty("--lia-submit-note-bg", bright ? "rgba(255,255,255,.30)" : "rgba(0,0,0,.14)");
}

// ── Freeze bar (shared-link / teacher mode) ───────────────────────────────────

type NavCallbacks = {
  onFirst(): void;
  onPrev(): void;
  onNext(): void;
  onEval(): void;
};

let _navCallbacks: NavCallbacks | null = null;

export function installFreezeBar(callbacks: NavCallbacks): void {
  _navCallbacks = callbacks;

  if (document.getElementById("lia-freeze-bar")) return;

  const bar = document.createElement("div");
  bar.id = "lia-freeze-bar";
  bar.innerHTML = [
    '<div id="lia-freeze-bar-inner">',
      '<div id="lia-freeze-nav-left" class="lia-freeze-nav-group">',
        '<button id="lia-freeze-first" type="button" aria-label="First slide">',
          '<svg viewBox="-4 0 24 24" aria-hidden="true" class="lia-freeze-icon">',
            '<path d="M21 8H10.2V4L2 12l8.2 8v-4H21V8z" fill="currentColor"/>',
            '<rect x="-1.8" y="4" width="2.6" height="16" rx="1.3" fill="currentColor"/>',
          '</svg>',
        '</button>',
        '<button id="lia-freeze-prev" type="button" aria-label="Previous slide">',
          '<svg viewBox="-4 0 24 24" aria-hidden="true" class="lia-freeze-icon">',
            '<path d="M21 8H10.2V4L2 12l8.2 8v-4H21V8z" fill="currentColor"/>',
            '<rect x="10.2" y="10.6" width="10.8" height="2.8" rx="1.4" fill="currentColor"/>',
          '</svg>',
        '</button>',
      '</div>',
      '<div id="lia-freeze-center">',
        '<div id="lia-freeze-head"></div>',
      '</div>',
      '<div id="lia-freeze-nav-right" class="lia-freeze-nav-group">',
        '<button id="lia-freeze-next" type="button" aria-label="Next slide">',
          '<svg viewBox="-4 0 24 24" aria-hidden="true" class="lia-freeze-icon" style="transform:scaleX(-1)">',
            '<path d="M21 8H10.2V4L2 12l8.2 8v-4H21V8z" fill="currentColor"/>',
            '<rect x="10.2" y="10.6" width="10.8" height="2.8" rx="1.4" fill="currentColor"/>',
          '</svg>',
        '</button>',
        '<button id="lia-freeze-last" type="button" aria-label="Go to evaluation slide">',
          '<svg viewBox="-4 0 24 24" aria-hidden="true" class="lia-freeze-icon" style="transform:scaleX(-1)">',
            '<path d="M21 8H10.2V4L2 12l8.2 8v-4H21V8z" fill="currentColor"/>',
            '<rect x="-1.8" y="4" width="2.6" height="16" rx="1.3" fill="currentColor"/>',
          '</svg>',
        '</button>',
      '</div>',
    '</div>',
  ].join("");

  document.body.appendChild(bar);

  function wire(id: string, handler: () => void): void {
    const btn = bar.querySelector<HTMLButtonElement>("#" + id);
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handler();
    }, true);
  }

  wire("lia-freeze-first", () => _navCallbacks?.onFirst());
  wire("lia-freeze-prev",  () => _navCallbacks?.onPrev());
  wire("lia-freeze-next",  () => _navCallbacks?.onNext());
  wire("lia-freeze-last",  () => _navCallbacks?.onEval());
}

export function setFreezeBarState(state: FreezeBarState): void {
  const bar = document.getElementById("lia-freeze-bar");
  if (!bar) return;

  const head = bar.querySelector<HTMLElement>("#lia-freeze-head");
  if (head) {
    const parts: string[] = [];
    if (state.slideTitle) parts.push(state.slideTitle);
    parts.push(state.slidePos);
    head.textContent = parts.join(" · ");
  }

  const set = (id: string, enabled: boolean) => {
    const btn = bar.querySelector<HTMLButtonElement>("#" + id);
    if (btn) btn.disabled = !enabled;
  };
  set("lia-freeze-first", state.canFirst);
  set("lia-freeze-prev",  state.canPrev);
  set("lia-freeze-next",  state.canNext);
  set("lia-freeze-last",  state.canEval);

  // keep body padding in sync with bar height
  const h = (bar as HTMLElement).offsetHeight || 64;
  document.body.style.paddingTop = (h + 10) + "px";
  document.documentElement.style.scrollPaddingTop = (h + 10) + "px";
}

// ── Page frozen state ─────────────────────────────────────────────────────────

function getContentHost(): Element | null {
  // Try to find the current slide's content container — same selectors as old code.
  // Prefer the most specific element so only quiz content is locked, not nav/TOC.
  return (
    document.querySelector("main.lia-slide__content") ??
    document.querySelector(".lia-content") ??
    document.querySelector("main") ??
    document.querySelector("article") ??
    null
  );
}

export function setPageFrozen(frozen: boolean, isSharedLink = false): void {
  const b = document.body;
  if (!b) return;

  b.classList.toggle("lia-course-frozen", frozen);
  b.classList.toggle("lia-snapshot-mode", frozen);
  b.classList.toggle("lia-shared-freeze-link", frozen && isSharedLink);

  // Apply/remove the content lock class on the slide content host only,
  // so navigation, TOC and other UI remain interactive.
  if (frozen) {
    const host = getContentHost();
    if (host) host.classList.add("lia-frozen-scope");
    setTimeout(lockQuizElements, 120);
  } else {
    document.querySelectorAll(".lia-frozen-scope").forEach(el => {
      el.classList.remove("lia-frozen-scope");
    });
  }
}

function lockQuizElements(): void {
  const host = getContentHost();
  if (!host) return;
  host.querySelectorAll<HTMLElement>(
    "input, textarea, select, button, [role='button'], [contenteditable='true']"
  ).forEach(el => {
    if (el.closest("#lia-freeze-bar")) return;
    if (el.closest(".lia-submit-box")) return;
    if (el.closest(".lia-annot-toolbar")) return;
    if (el.closest(".lia-exam-intro-virtual-slide")) return;
    if (el.id === "lia-link" || el.id === "lia-copy-link") return;
    try { (el as HTMLInputElement).disabled = true; } catch (_) {}
    try { (el as HTMLInputElement).readOnly = true; } catch (_) {}
    el.setAttribute("tabindex", "-1");
  });
}

// Re-apply lia-frozen-scope after slide navigation (the content host is replaced).
export function reapplyContentLock(): void {
  if (!document.body.classList.contains("lia-course-frozen")) return;
  document.querySelectorAll(".lia-frozen-scope").forEach(el => {
    el.classList.remove("lia-frozen-scope");
  });
  const host = getContentHost();
  if (host) host.classList.add("lia-frozen-scope");
  setTimeout(lockQuizElements, 120);
}

// ── Live-mode helpers (wiring the @Abgabe slide DOM) ─────────────────────────

export function wireLiveBar(callbacks: {
  onCreateLink(): void;
  onCopyLink(): void;
}): void {
  // Bind #lia-create-link via delegation so it works even if DOM isn't ready yet
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (!t.closest("#lia-create-link")) return;

    if (document.body.classList.contains("lia-snapshot-mode")) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    callbacks.onCreateLink();
  }, true);

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (!t.closest("#lia-copy-link")) return;
    e.preventDefault();
    e.stopPropagation();
    callbacks.onCopyLink();
  }, true);
}

export function setLiveBarStatus(msg: string): void {
  const el = document.getElementById("lia-status");
  if (el) el.textContent = msg;
}

export function setLiveBarFrozen(linkUrl: string, name: string): void {
  const nameEl = document.getElementById("lia-name") as HTMLInputElement | null;
  const linkEl = document.getElementById("lia-link") as HTMLInputElement | null;
  const btnEl  = document.getElementById("lia-create-link") as HTMLButtonElement | null;
  const copyBtn = document.getElementById("lia-copy-link") as HTMLButtonElement | null;
  const noteEl = document.getElementById("lia-frozen-note");

  if (nameEl) { nameEl.value = name; nameEl.disabled = true; }
  if (btnEl)  { btnEl.disabled = true; btnEl.textContent = "Submission frozen"; }

  if (linkEl) {
    linkEl.value = linkUrl;
    linkEl.disabled = false;
    (linkEl as any).readOnly = true;
    linkEl.style.pointerEvents = "auto";
    linkEl.style.userSelect = "text";
  }

  if (copyBtn) copyBtn.disabled = !linkUrl;

  setLiveBarStatus("Submission link created.");

  if (noteEl) {
    noteEl.style.display = "block";
    noteEl.innerHTML =
      "This is a <strong>frozen submission</strong>. Tasks and inputs are locked. " +
      "The table of contents, display mode, and layout can still be used.";
  }
}

export async function copyLinkToClipboard(url: string): Promise<boolean> {
  if (!url) return false;

  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function" && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch (_) {}
  }

  // Fallback: temporary textarea
  const ta = document.createElement("textarea");
  ta.value = url;
  ta.setAttribute("aria-hidden", "true");
  ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;pointer-events:none;font-size:16px";
  document.body.appendChild(ta);
  let ok = false;
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, url.length);
    ok = document.execCommand("copy");
  } catch (_) {}
  ta.remove();
  return ok;
}
