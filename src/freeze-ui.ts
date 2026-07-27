// All DOM and CSS for the plugin: runtime styles, the freeze nav bar (teacher),
// the live submit box helpers (student), and the content lock logic.
import {
  deactivateMarkerRegistries,
  MarkerRegistry,
} from "./marker-state";
import { sameOriginRuntimeWindows } from "./runtime-windows";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FreezeBarState = {
  slideTitle: string;
  slidePos: string;       // e.g. "3 / 7"
  canFirst: boolean;
  canPrev: boolean;
  canNext: boolean;
  canEval: boolean;       // whether an evaluation slide exists
  canPrint: boolean;      // whether a frozen evaluation can be printed
};

export type PrintReportHeaderData = {
  courseTitle: string;
  studentName: string;
  submissionDate: string;
  courseVersion: string;
};

type AssignmentDetailsSpec = {
  raw: string;
  badge: string;
  pointsValue: number | null;
  pointsParts: number[];
  tags: string[];
};

export type AssignmentDetailAwardContext = {
  getHash(): string;
  getDefaultAward(hash: string, taskIndex: number, maximum: number): number;
  onChange(): void;
};

let assignmentDetailAwardContext: AssignmentDetailAwardContext | null = null;
let manualAwardValues: Record<string, string> = Object.create(null);

export function configureAssignmentDetailAwards(
  context: AssignmentDetailAwardContext | null
): void {
  assignmentDetailAwardContext = context;
  manualAwardValues = Object.create(null);
}

export function getManualAwardValues(): Record<string, string> {
  return { ...manualAwardValues };
}

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
body.lia-snapshot-mode #lia-freeze-bar,
body.lia-course-frozen #lia-freeze-bar { display: block; }

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
.lia-frozen-scope [draggable],
.lia-frozen-scope [ondragover],
.lia-frozen-scope [ondragleave],
.lia-frozen-scope [ondrop],
.lia-frozen-scope [ondragstart],
.lia-frozen-scope [ondragend],
.lia-frozen-scope .fq-widget [data-fq-part],
.lia-frozen-scope .lia-canvas-pair canvas,
.lia-frozen-scope .lia-canvas-mount,
.lia-frozen-scope [contenteditable="true"] {
  pointer-events: none !important;
  cursor: not-allowed !important;
}
[data-lia-freeze-marker-locked="1"] {
  pointer-events: none !important;
  cursor: not-allowed !important;
}
.lia-frozen-scope .lia-annot-toolbar,
.lia-frozen-scope .lia-annot-toolbar * { pointer-events: auto !important; }
.lia-frozen-scope .lia-annot-toolbar button,
.lia-frozen-scope .lia-annot-toolbar [role="button"] { cursor: pointer !important; }
.lia-frozen-scope #lia-copy-link { pointer-events: auto !important; cursor: pointer !important; }
.lia-frozen-scope #lia-print-pdf { pointer-events: auto !important; cursor: pointer !important; }
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
  min-width: 3.2em;
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
.lia-adetails-award-input::placeholder {
  color: rgba(255,255,255,.7);
  -webkit-text-fill-color: rgba(255,255,255,.7);
}
body.lia-shared-freeze-link .lia-quiz__control .lia-adetails-points,
body.lia-shared-freeze-link .lia-quiz__control .lia-adetails-points * {
  pointer-events: auto !important;
}
body.lia-shared-freeze-link .lia-frozen-scope .lia-adetails-award-input {
  pointer-events: auto !important;
  cursor: text !important;
  user-select: text !important;
}

/* ── Frozen submission print/PDF report ── */
#lia-print-header {
  display: none;
}

#lia-print-slides {
  display: none;
}

@page {
  margin: 15mm;
}

@media print {
  html,
  body.lia-print-report {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    background: #ffffff !important;
    color: #111111 !important;
  }

  body.lia-print-report {
    padding: 0 !important;
    margin: 0 !important;
  }

  body.lia-print-report > :not(#lia-print-slides):not(#lia-eval-placeholder) {
    display: none !important;
  }

  body.lia-print-report #lia-print-slides {
    display: block !important;
  }

  body.lia-print-report .lia-print-slide {
    display: block !important;
    position: relative !important;
    width: 100% !important;
    min-height: 0 !important;
    overflow: visible !important;
    break-after: page;
    page-break-after: always;
  }

  body.lia-print-report .lia-print-slide > .lia-slide__content,
  body.lia-print-report .lia-print-slide > .lia-content,
  body.lia-print-report .lia-print-slide > main,
  body.lia-print-report .lia-print-slide > article {
    display: block !important;
    position: static !important;
    inset: auto !important;
    width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    opacity: 1 !important;
    visibility: visible !important;
    transform: none !important;
    overflow: visible !important;
    pointer-events: none !important;
  }

  body.lia-print-report .lia-print-slide:last-child {
    break-after: auto;
    page-break-after: auto;
  }

  body.lia-print-report #lia-eval-placeholder {
    display: block !important;
    position: static !important;
    inset: auto !important;
    top: auto !important;
    left: auto !important;
    transform: none !important;
    width: 100% !important;
    max-width: none !important;
    max-height: none !important;
    overflow: visible !important;
    z-index: auto !important;
    box-sizing: border-box !important;
    padding: 0 !important;
    margin: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: #ffffff !important;
    color: #111111 !important;
    --lia-course-bg: #ffffff;
    --lia-course-fg: #111111;
    --lia-course-border: rgba(0,0,0,.24);
    --lia-submit-fg: #111111;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    break-before: page;
    page-break-before: always;
  }

  body.lia-print-report #lia-print-header {
    display: block !important;
    margin: 0 0 12mm 0;
    padding: 0 0 6mm 0;
    border-bottom: 2px solid rgb(var(--lia-submit-bg-rgb));
    break-inside: avoid;
    page-break-inside: avoid;
  }

  body.lia-print-report .lia-print-report-kicker {
    margin-bottom: 2mm;
    color: #444444;
    font-size: 10pt;
    font-weight: 700;
    letter-spacing: .04em;
    text-transform: uppercase;
  }

  body.lia-print-report .lia-print-report-title {
    margin: 0 0 5mm 0;
    color: #111111;
    font-size: 22pt;
    line-height: 1.2;
  }

  body.lia-print-report .lia-print-report-meta {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4mm 7mm;
  }

  body.lia-print-report .lia-print-report-field {
    min-width: 0;
  }

  body.lia-print-report .lia-print-report-label {
    display: block;
    margin-bottom: 1mm;
    color: #555555;
    font-size: 8.5pt;
    font-weight: 700;
    text-transform: uppercase;
  }

  body.lia-print-report .lia-print-report-value {
    display: block;
    overflow-wrap: anywhere;
    color: #111111;
    font-size: 10.5pt;
    font-weight: 700;
  }

  body.lia-print-report button,
  body.lia-print-report input,
  body.lia-print-report select,
  body.lia-print-report textarea,
  body.lia-print-report [contenteditable="true"] {
    display: none !important;
  }
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

export function setPrintReportHeader(data: PrintReportHeaderData): void {
  const container = document.getElementById("lia-eval-placeholder");
  if (!container) return;

  let header = container.querySelector<HTMLElement>("#lia-print-header");
  if (!header) {
    header = document.createElement("header");
    header.id = "lia-print-header";
    container.prepend(header);
  }
  header.replaceChildren();

  const kicker = document.createElement("div");
  kicker.className = "lia-print-report-kicker";
  kicker.textContent = "Eingefrorene Abgabe";

  const title = document.createElement("h1");
  title.className = "lia-print-report-title";
  title.textContent = data.courseTitle;

  const meta = document.createElement("div");
  meta.className = "lia-print-report-meta";

  const appendField = (labelText: string, valueText: string): void => {
    const field = document.createElement("div");
    field.className = "lia-print-report-field";
    const label = document.createElement("span");
    label.className = "lia-print-report-label";
    label.textContent = labelText;
    const value = document.createElement("span");
    value.className = "lia-print-report-value";
    value.textContent = valueText;
    field.append(label, value);
    meta.appendChild(field);
  };

  appendField("Schülername", data.studentName);
  appendField("Abgabedatum", data.submissionDate);
  appendField("Kursversion", data.courseVersion);
  header.append(kicker, title, meta);
}

export function setPrintReportMode(active: boolean): void {
  document.body?.classList.toggle("lia-print-report", active);
}

// ── Freeze bar (shared-link / teacher mode) ───────────────────────────────────

type NavCallbacks = {
  onFirst(): void;
  onPrev(): void;
  onNext(): void;
  onEval(): void;
  onPrint(): void;
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
        '<button id="lia-freeze-print" type="button" aria-label="Print evaluation or save as PDF" title="Print evaluation / save as PDF" disabled>',
          '<svg viewBox="0 0 24 24" aria-hidden="true" class="lia-freeze-icon">',
            '<path d="M6 9V3h12v6h1a3 3 0 0 1 3 3v6h-4v3H6v-3H2v-6a3 3 0 0 1 3-3h1zm2-4v4h8V5H8zm8 10H8v4h8v-4zm3-2a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" fill="currentColor"/>',
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
  wire("lia-freeze-print", () => _navCallbacks?.onPrint());
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
  set("lia-freeze-print", state.canPrint);

  // keep body padding in sync with bar height
  const h = (bar as HTMLElement).offsetHeight || 64;
  document.body.style.paddingTop = (h + 10) + "px";
  document.documentElement.style.scrollPaddingTop = (h + 10) + "px";
}

// ── Page frozen state ─────────────────────────────────────────────────────────

export function getContentHostForDocument(runtimeDocument: Document): Element | null {
  // Try to find the current slide's content container — same selectors as old code.
  // Prefer the most specific element so only quiz content is locked, not nav/TOC.
  return (
    runtimeDocument.querySelector("main.lia-slide__content") ??
    runtimeDocument.querySelector(".lia-content") ??
    runtimeDocument.querySelector("main") ??
    runtimeDocument.querySelector("article") ??
    null
  );
}

export function getContentHost(): Element | null {
  return getContentHostForDocument(document);
}

const FROZEN_PRESERVED_SELECTOR = [
  "#lia-freeze-bar",
  "#lia-eval-placeholder",
  "#lia-print-pdf",
  ".lia-annot-toolbar",
  ".lia-adetails-award-input",
  ".lia-adetails-points",
  ".lia-assignment-details",
  "[data-adetails]",
  ".lia-exam-intro-virtual-slide",
].join(",");

type CoordinateObject = {
  elType?: unknown;
  type?: unknown;
  visProp?: Record<string, unknown>;
  getAttribute?: (name: string) => unknown;
  setAttribute?: (attributes: Record<string, unknown>) => void;
  [key: string]: unknown;
};

type CoordinateBoard = {
  containerObj?: HTMLElement | null;
  objects?: Record<string, CoordinateObject | null | undefined>;
  objectsList?: Array<CoordinateObject | null | undefined>;
  update?: () => void;
};

type CoordinateRuntimeWindow = Window & {
  __boards?: Record<string, CoordinateBoard | null | undefined>;
  __liaFreezeCoordinateRestoreActive?: boolean;
};

type CoordinateElementState = {
  inert: string | null;
  ariaDisabled: string | null;
  tabIndex: string | null;
  lockMarker: string | null;
  hasDisabled: boolean;
  disabled: boolean;
  hasReadOnly: boolean;
  readOnly: boolean;
};

type CoordinateObjectState = { fixed: unknown };

type CoordinateGuardBinding = {
  document: Document;
  handler: EventListener;
};

type FrozenElementState = {
  inert: string | null;
  ariaDisabled: string | null;
  tabIndex: string | null;
  hasDisabled: boolean;
  disabled: boolean;
  hasReadOnly: boolean;
  readOnly: boolean;
};

function isFreezePreservedElement(element: Element | null): boolean {
  if (!element) return false;
  const sendReview = element.ownerDocument.body?.classList.contains('lia-send-review') === true;
  if (sendReview && element.closest(
    '.lia-quiz__resolve,.hlq-proxy [data-hlq-act="solve"]'
  )) return true;
  if (element.id === "lia-link" || element.id === "lia-copy-link") return true;
  try { return !!element.closest(FROZEN_PRESERVED_SELECTOR); } catch { return false; }
}

function normalizeSpace(s: string): string {
  return String(s || "").trim().replace(/\s+/g, " ");
}

function compareElementsInDocumentOrder(a: Element, b: Element): number {
  if (a === b) return 0;
  const pos = a.compareDocumentPosition(b);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function formatAssignmentValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.0+$/, "");
}

function parseAssignmentPointSpec(raw: string): { total: number | null; parts: number[] } {
  const chunks = normalizeSpace(raw).split(/\s*\|\s*/).filter(Boolean);
  if (!chunks.length) return { total: null, parts: [] };
  const parts = chunks.map(chunk => Number(chunk.replace(",", ".")));
  if (parts.some(value => !Number.isFinite(value) || value < 0)) {
    return { total: null, parts: [] };
  }
  return { total: parts.reduce((sum, value) => sum + value, 0), parts };
}

function parseAssignmentDetails(raw: string): AssignmentDetailsSpec {
  const txt = normalizeSpace(raw);
  let pointsValue: number | null = null;
  let pointsParts: number[] = [];
  const tags: string[] = [];

  const parts = txt.split(/\s*;\s*/).filter(Boolean);

  parts.forEach((part, index) => {
    const p = normalizeSpace(part);

    const tagKeyM = p.match(/^tags?\s*[:=]\s*(.+)$/i);
    if (tagKeyM) {
      tagKeyM[1].split(",").map(t => normalizeSpace(t)).filter(Boolean).forEach(t => {
        if (!tags.includes(t)) tags.push(t);
      });
      return;
    }

    const ptsKeyM = p.match(/^(?:points?|be|punkte?)\s*[:=]\s*([\d.,]+(?:\s*\|\s*[\d.,]+)*)$/i);
    if (ptsKeyM) {
      const parsed = parseAssignmentPointSpec(ptsKeyM[1]);
      if (parsed.total !== null && pointsValue === null) {
        pointsValue = parsed.total;
        pointsParts = parsed.parts;
      }
      return;
    }

    const numUnitM = p.match(/^([\d.,]+(?:\s*\|\s*[\d.,]+)*)\s*=\s*[A-Za-z%]+$/);
    if (numUnitM) {
      const parsed = parseAssignmentPointSpec(numUnitM[1]);
      if (parsed.total !== null && pointsValue === null) {
        pointsValue = parsed.total;
        pointsParts = parsed.parts;
      }
      return;
    }

    const bare = parseAssignmentPointSpec(p);
    if (bare.total !== null && pointsValue === null) {
      pointsValue = bare.total;
      pointsParts = bare.parts;
      return;
    }

    if (index >= 1 || parts.length === 1) {
      p.split(",").map(t => normalizeSpace(t)).filter(Boolean).forEach(t => {
        if (!tags.includes(t)) tags.push(t);
      });
    }
  });

  return {
    raw: txt,
    badge: pointsValue === null ? "" : formatAssignmentValue(pointsValue) + " BE",
    pointsValue,
    pointsParts,
    tags,
  };
}

function getLastQuizCheckBeforeMarker(marker: Element): HTMLButtonElement | null {
  const host = getContentHost() ?? document.body;
  const localScope = marker.closest(".flex-child") ?? host;

  const pickLatest = (scope: ParentNode): HTMLButtonElement | null => {
    const checks = Array.from(scope.querySelectorAll<HTMLButtonElement>(".lia-quiz__check"));
    let best: HTMLButtonElement | null = null;
    checks.forEach(check => {
      if (check.closest("#lia-freeze-bar") || check.closest(".lia-submit-box")) return;
      if (!(check.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      if (!best || (best.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        best = check;
      }
    });
    return best;
  };

  return pickLatest(localScope) ?? (localScope === host ? null : pickLatest(host));
}

function ensureAssignmentDetailOwnerId(marker: Element): string {
  const existing = marker.getAttribute("data-adetails-owner-id");
  if (existing) return existing;
  const ownerId = "lia-adetails-" + Math.random().toString(36).slice(2, 10);
  marker.setAttribute("data-adetails-owner-id", ownerId);
  return ownerId;
}

function ensureAssignmentDetailBadge(checkBtn: HTMLButtonElement, ownerId: string): HTMLSpanElement {
  const control =
    checkBtn.closest(".lia-quiz__control") ??
    checkBtn.parentElement ??
    checkBtn;

  let badge = control.querySelector<HTMLSpanElement>('.lia-adetails-points[data-adetails-owner="' + ownerId + '"]');
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "lia-adetails-points";
    badge.setAttribute("data-adetails-owner", ownerId);
    control.appendChild(badge);
  }
  return badge;
}

function getAssignmentDetailTaskIndex(
  marker: Element,
  checkBtn: HTMLButtonElement,
  host: Element
): number {
  const quizRoots = Array.from(host.querySelectorAll<HTMLElement>(".lia-quiz"))
    .filter(root => !root.closest("#lia-freeze-bar,.lia-submit-box,.lia-annot-toolbar"));
  const quizRoot = checkBtn.closest<HTMLElement>(".lia-quiz");
  const rootIndex = quizRoot ? quizRoots.indexOf(quizRoot) : -1;
  if (rootIndex >= 0) return rootIndex + 1;

  const orderedMarkers = Array.from(host.querySelectorAll<HTMLElement>("[data-adetails]"))
    .filter(item => !item.closest("#lia-freeze-bar,.lia-submit-box"))
    .sort(compareElementsInDocumentOrder);
  const markerIndex = orderedMarkers.indexOf(marker as HTMLElement);
  return markerIndex >= 0 ? markerIndex + 1 : 0;
}

function assignmentDetailAwardKey(hash: string, taskIndex: number): string {
  const cleanHash = /^#\d+$/.test(String(hash || "").trim())
    ? String(hash).trim()
    : "";
  return cleanHash && taskIndex > 0
    ? cleanHash + "::task::" + taskIndex
    : "";
}

function renderAssignmentDetailBadge(
  badge: HTMLSpanElement,
  marker: HTMLElement,
  spec: AssignmentDetailsSpec,
  taskIndex: number
): void {
  const sharedLink = !!document.body?.classList.contains("lia-shared-freeze-link");
  const maximum = spec.pointsValue;
  if (!sharedLink || maximum === null || maximum <= 0 || taskIndex <= 0) {
    badge.textContent = spec.badge;
    badge.style.display = spec.badge ? "inline-flex" : "none";
    return;
  }

  const hash = assignmentDetailAwardContext?.getHash() ?? window.location.hash;
  const key = assignmentDetailAwardKey(hash, taskIndex);
  if (!key) {
    badge.textContent = spec.badge;
    badge.style.display = spec.badge ? "inline-flex" : "none";
    return;
  }

  let input = badge.querySelector<HTMLInputElement>(".lia-adetails-award-input");
  if (!input || input.getAttribute("data-adetails-award-key") !== key) {
    badge.replaceChildren();
    input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.className = "lia-adetails-award-input";
    input.setAttribute("data-adetails-award-key", key);

    const separator = document.createElement("span");
    separator.className = "lia-adetails-award-sep";
    separator.textContent = "/";
    const total = document.createElement("span");
    total.className = "lia-adetails-award-total";
    total.textContent = spec.badge;
    badge.append(input, separator, total);

    const handleChange = () => {
      manualAwardValues[key] = input?.value ?? "";
      assignmentDetailAwardContext?.onChange();
    };
    input.addEventListener("input", handleChange);
    input.addEventListener("change", handleChange);
  }

  const total = badge.querySelector<HTMLElement>(".lia-adetails-award-total");
  if (total) total.textContent = spec.badge;
  const hasManualValue = Object.prototype.hasOwnProperty.call(manualAwardValues, key);
  if (document.activeElement !== input) {
    const automatic = assignmentDetailAwardContext?.getDefaultAward(
      hash,
      taskIndex,
      maximum
    ) ?? 0;
    input.value = hasManualValue
      ? manualAwardValues[key]
      : formatAssignmentValue(Math.max(0, Math.min(maximum, automatic)));
  }
  marker.setAttribute("data-adetails-award-key", key);
  badge.style.display = "inline-flex";
}

export function refreshAssignmentDetails(): void {
  const host = getContentHost() ?? document.body;
  const markers = Array.from(host.querySelectorAll<HTMLElement>("[data-adetails]"));

  markers
    .filter(marker => !marker.closest("#lia-freeze-bar") && !marker.closest(".lia-submit-box"))
    .sort(compareElementsInDocumentOrder)
    .forEach(marker => {
      const spec = parseAssignmentDetails(marker.getAttribute("data-adetails") || "");
      marker.setAttribute("data-adetails-raw", spec.raw);
      if (spec.pointsValue !== null) marker.setAttribute("data-adetails-points", String(spec.pointsValue));
      else marker.removeAttribute("data-adetails-points");
      if (spec.tags.length) marker.setAttribute("data-adetail-tags", JSON.stringify(spec.tags));
      else marker.removeAttribute("data-adetail-tags");

      const checkBtn = getLastQuizCheckBeforeMarker(marker);
      if (!checkBtn || !spec.badge) return;

      const taskIndex = getAssignmentDetailTaskIndex(marker, checkBtn, host);
      if (taskIndex > 0) marker.setAttribute("data-adetails-task-index", String(taskIndex));
      else marker.removeAttribute("data-adetails-task-index");

      const ownerId = ensureAssignmentDetailOwnerId(marker);
      const badge = ensureAssignmentDetailBadge(checkBtn, ownerId);

      const control = checkBtn.closest(".lia-quiz__control") ?? checkBtn.parentElement;
      const quizRoot = checkBtn.closest(".lia-quiz");
      [quizRoot, control, checkBtn].forEach(element => {
        if (!element) return;
        element.setAttribute("data-adetails-raw", spec.raw);
        element.setAttribute("data-adetails-badge", spec.badge);
        if (spec.pointsValue !== null) {
          element.setAttribute("data-adetails-points", String(spec.pointsValue));
        } else {
          element.removeAttribute("data-adetails-points");
        }
        if (spec.pointsParts.length) {
          element.setAttribute("data-adetails-point-parts", JSON.stringify(spec.pointsParts));
        } else {
          element.removeAttribute("data-adetails-point-parts");
        }
        if (spec.tags.length) {
          element.setAttribute("data-adetail-tags", JSON.stringify(spec.tags));
        } else {
          element.removeAttribute("data-adetail-tags");
        }
      });
      renderAssignmentDetailBadge(badge, marker, spec, taskIndex);
    });
}

export function setPageFrozen(frozen: boolean, isSharedLink = false): void {
  const b = document.body;
  if (!b) return;

  freezeRuntimeDocuments().forEach(runtimeDocument => {
    const runtimeBody = runtimeDocument.body;
    if (!runtimeBody) return;
    runtimeBody.classList.toggle("lia-course-frozen", frozen);
    runtimeBody.classList.toggle("lia-snapshot-mode", frozen);
    runtimeBody.classList.toggle("lia-shared-freeze-link", frozen && isSharedLink);
  });

  // Apply/remove the content lock class on the slide content host only,
  // so navigation, TOC and other UI remain interactive.
  if (frozen) {
    lockCoordinateUi();
    ensureFrozenDragBlocker();
    ensureFrozenInteractionBlocker();
    ensureFrozenContentObserver();
    lockMarkerUi();
    freezeRuntimeDocuments().forEach(runtimeDocument => {
      getContentHostForDocument(runtimeDocument)?.classList.add("lia-frozen-scope");
    });
    setTimeout(lockQuizElements, 120);
    [360, 800, 1600, 3200, 6000].forEach(delay => {
      window.setTimeout(lockMarkerUi, delay);
    });
    [120, 360, 800, 1600, 3200, 6000].forEach(scheduleCoordinateUiLock);
  } else {
    if (frozenContentLockTimer) {
      window.clearTimeout(frozenContentLockTimer);
      frozenContentLockTimer = 0;
    }
    freezeRuntimeDocuments().forEach(runtimeDocument => {
      runtimeDocument.querySelectorAll(".lia-frozen-scope").forEach(el => {
        el.classList.remove("lia-frozen-scope");
      });
    });
    unlockQuizElements();
    unlockMarkerUi();
    unlockCoordinateUi();
  }
}

const frozenDragBlockerDocuments = new WeakSet<Document>();
const frozenInteractionBlockerWindows = new WeakSet<Window>();
const frozenContentObservers = new WeakMap<Document, MutationObserver>();
const frozenLockedElements = new Map<HTMLElement, FrozenElementState>();
let frozenContentLockTimer = 0;

const FROZEN_INTERACTIVE_SELECTOR =
  "input, textarea, select, button, summary, a, [role='button'], " +
  ".fq-widget [data-fq-part], " +
  ".lia-canvas-pair canvas, .lia-canvas-mount, " +
  "#lia-hl-overlay .lia-hl-rect[data-kind='user'], " +
  "[contenteditable='true'], [draggable], [ondragover], [ondragleave], " +
  "[ondrop], [ondragstart], [ondragend]";

const FROZEN_MARKER_SELECTOR = [
  "#lia-hl-ui-overlay-v1",
  "#lia-hl-btn",
  "#lia-hl-panel",
  "#lia-hl-panel *",
  "#lia-hl-overlay .lia-hl-rect[data-kind='user']",
  "#lia-hl-explain-tip",
  "#lia-hl-explain-tip *",
].join(",");

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

const COORDINATE_DIRECT_LOCK_SELECTOR = [
  ".lia-jxg-resize-handle",
  ".JXG_navigation",
  ".JXG_navigation_button",
  ".lia-dgs-top-menu",
  ".lia-dgs-geometry-submenu",
  ".lia-dgs-side-menu",
  ".lia-dgs-object-list-panel",
  ".lia-dgs-color-popup",
  ".lia-dgs-angle-dialog",
  ".lia-dgs-set-square-overlay",
  ".lia-plot-draw-layer",
  ".lia-plot-color-menu",
  ".lia-plot-analysis-resize",
  ".lia-plot-analysis-mini-wrap",
  ".lia-plot-analysis-mini-strip",
  ".lia-schar-resize-handle",
  ".lia-schar-mini-wrap",
  ".lia-schar-mini-name",
  ".lia-schar-mini-strip",
  ".lia-dyn-table-rail",
  ".lia-dyn-table-pool-item",
].join(",");

const COORDINATE_BOARD_OVERLAY_SELECTOR = [
  ".lia-dgs-top-menu",
  ".lia-dgs-geometry-submenu",
  ".lia-dgs-side-menu",
  ".lia-dgs-object-list-panel",
  ".lia-dgs-color-popup",
  ".lia-dgs-angle-dialog",
  ".lia-plot-color-menu",
  ".lia-plot-analyze-panel",
  ".lia-schar-panel",
  ".lia-dyn-table-root",
  "[id^='lia-plot-input-']",
  "[id^='point-ui-']",
  "[id^='point-graph-ui-']",
  "[id^='multi-graph-ui-']",
  "[id^='lia-table-']",
].join(",");

const COORDINATE_FOCUSABLE_SELECTOR = [
  "input", "textarea", "select", "button", "summary", "a[href]",
  "[role='button']", "[contenteditable='true']", "[tabindex]", "[draggable='true']",
].join(",");

const COORDINATE_GUARDED_EVENTS = [
  "pointerdown", "pointermove", "pointerup", "pointercancel",
  "mousedown", "mousemove", "mouseup",
  "touchstart", "touchmove", "touchend", "touchcancel",
  "wheel", "click", "dblclick", "contextmenu",
  "beforeinput", "input", "change",
  "keydown", "keypress", "keyup",
  "submit", "reset", "focusin",
  "dragstart", "dragover", "dragleave", "drop", "dragend",
];

let coordinateBoardContainers = new Set<HTMLElement>();
const coordinateLockedElements = new Map<HTMLElement, CoordinateElementState>();
const coordinateLockedObjects = new Map<CoordinateObject, CoordinateObjectState>();
const coordinateTouchedBoards = new Set<CoordinateBoard>();
const coordinateGuardBindings = new Map<Window, CoordinateGuardBinding>();
const coordinateObservers: MutationObserver[] = [];
const coordinateLockTimers = new Set<number>();
let coordinateObservedRoots = new WeakSet<Node>();

function pageIsFrozen(): boolean {
  return !!document.body?.classList.contains("lia-course-frozen");
}

function asElement(value: unknown): Element | null {
  const element = value as Element | null;
  return element && element.nodeType === 1 && typeof element.matches === "function"
    ? element
    : null;
}

function closestElement(element: Element, selector: string): Element | null {
  try { return element.closest(selector); } catch { return null; }
}

function eventPathElements(event: Event): Element[] {
  const values = typeof event.composedPath === "function"
    ? event.composedPath()
    : [event.target];
  const elements: Element[] = [];
  values.forEach(value => {
    const element = asElement(value);
    if (element && !elements.includes(element)) elements.push(element);
  });
  return elements;
}

function elementInsideCoordinateBoard(element: Element): boolean {
  for (const container of coordinateBoardContainers) {
    try {
      if (container === element || container.contains(element)) return true;
    } catch { /* detached/cross-document best effort */ }
  }
  return !!closestElement(element, ".jxgbox");
}

function elementHasCoordinateContext(element: Element): boolean {
  if (isFreezePreservedElement(element)) return false;
  if (elementInsideCoordinateBoard(element)) return true;
  return !!closestElement(element, COORDINATE_CONTEXT_SELECTOR);
}

function coordinateBoardEvent(elements: Element[]): boolean {
  const origin = elements[0];
  if (!origin || closestElement(origin, COORDINATE_BOARD_OVERLAY_SELECTOR)) return false;
  return elements.some(element => elementInsideCoordinateBoard(element));
}

function coordinatePointerEvent(elements: Element[]): boolean {
  if (coordinateBoardEvent(elements)) return true;
  return elements.some(element => {
    if (closestElement(element, COORDINATE_DIRECT_LOCK_SELECTOR)) return true;
    const interactive = closestElement(element, COORDINATE_FOCUSABLE_SELECTOR);
    return !!interactive && elementHasCoordinateContext(interactive);
  });
}

function coordinateContextEvent(elements: Element[]): boolean {
  return elements.some(element => elementHasCoordinateContext(element));
}

function restoreAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function lockCoordinateElement(element: HTMLElement, makeInert: boolean): void {
  if (isFreezePreservedElement(element)) return;
  const control = element as HTMLElement & { disabled?: boolean; readOnly?: boolean };
  if (!coordinateLockedElements.has(element)) {
    coordinateLockedElements.set(element, {
      inert: element.getAttribute("inert"),
      ariaDisabled: element.getAttribute("aria-disabled"),
      tabIndex: element.getAttribute("tabindex"),
      lockMarker: element.getAttribute("data-lia-freeze-coordinate-locked"),
      hasDisabled: "disabled" in control,
      disabled: !!control.disabled,
      hasReadOnly: "readOnly" in control,
      readOnly: !!control.readOnly,
    });
  }
  if (makeInert) element.setAttribute("inert", "");
  if ("disabled" in control) control.disabled = true;
  if ("readOnly" in control) control.readOnly = true;
  element.setAttribute("aria-disabled", "true");
  element.setAttribute("tabindex", "-1");
  element.setAttribute("data-lia-freeze-coordinate-locked", "1");
  try { if (element.matches(":focus") && typeof element.blur === "function") element.blur(); } catch { /* best effort */ }
}

function coordinateObjectKind(object: CoordinateObject): string {
  return String(object.elType ?? object.type ?? "").trim().toLowerCase();
}

function safelyFixableCoordinateObject(object: CoordinateObject): boolean {
  const kind = coordinateObjectKind(object);
  if (["point", "glider", "slider", "text", "image"].some(name => kind.includes(name))) {
    return true;
  }
  return object.__liaDgsSlider === true
    || object.__liaDgsText === true
    || object.__liaDgsPointName !== undefined
    || object.__liaPointName !== undefined;
}

function readCoordinateObjectFixed(object: CoordinateObject): { readable: boolean; value: unknown } {
  try {
    if (typeof object.getAttribute === "function") {
      const value = object.getAttribute("fixed");
      if (value !== undefined) return { readable: true, value };
    }
  } catch { /* fall through */ }
  if (object.visProp && Object.prototype.hasOwnProperty.call(object.visProp, "fixed")) {
    return { readable: true, value: object.visProp.fixed };
  }
  return { readable: false, value: undefined };
}

function lockCoordinateObject(object: CoordinateObject): void {
  if (!safelyFixableCoordinateObject(object) || typeof object.setAttribute !== "function") return;
  // JSXGraph's setAttribute can redraw SVG children. Those child mutations are
  // observed by the late-mount lock below, so writing `fixed` on every pass
  // creates a teacher-only redraw/observer loop. One write per object is enough:
  // capture-phase guards remain active even if a template later changes it.
  if (coordinateLockedObjects.has(object)) return;
  const fixed = readCoordinateObjectFixed(object);
  if (!fixed.readable) return;
  coordinateLockedObjects.set(object, { fixed: fixed.value });
  try { object.setAttribute({ fixed: true }); } catch { /* JSXGraph best effort */ }
}

function boardObjects(board: CoordinateBoard): CoordinateObject[] {
  const objects: CoordinateObject[] = [];
  try {
    Object.values(board.objects || {}).forEach(object => {
      if (object && !objects.includes(object)) objects.push(object);
    });
  } catch { /* best effort */ }
  try {
    (board.objectsList || []).forEach(object => {
      if (object && !objects.includes(object)) objects.push(object);
    });
  } catch { /* best effort */ }
  return objects;
}

function currentCoordinateBoards(runtimeWindows: Window[]): CoordinateBoard[] {
  const boards: CoordinateBoard[] = [];
  runtimeWindows.forEach(runtimeWindow => {
    try {
      const registry = (runtimeWindow as CoordinateRuntimeWindow).__boards;
      Object.values(registry || {}).forEach(board => {
        if (board && !boards.includes(board)) boards.push(board);
      });
    } catch { /* same-origin best effort */ }
  });
  return boards;
}

function removeCoordinateGuard(runtimeWindow: Window, binding: CoordinateGuardBinding): void {
  COORDINATE_GUARDED_EVENTS.forEach(type => {
    try { runtimeWindow.removeEventListener(type, binding.handler, true); } catch { /* best effort */ }
  });
}

function ensureCoordinateGuard(runtimeWindow: Window): void {
  let runtimeDocument: Document;
  try { runtimeDocument = runtimeWindow.document; } catch { return; }
  const existing = coordinateGuardBindings.get(runtimeWindow);
  if (existing?.document === runtimeDocument) return;
  if (existing) removeCoordinateGuard(runtimeWindow, existing);

  const activePointers = new Set<number>();
  let activeMouse = false;
  let activeTouch = false;
  let activeDrag = false;

  const handler: EventListener = event => {
    if (!pageIsFrozen()) return;
    if ((runtimeWindow as CoordinateRuntimeWindow).__liaFreezeCoordinateRestoreActive) return;
    if ((event as Event & { __liaFreezeRestore?: boolean }).__liaFreezeRestore) return;
    const elements = eventPathElements(event);
    if (elements.some(isFreezePreservedElement)) return;

    const pointerTarget = coordinatePointerEvent(elements);
    const boardTarget = coordinateBoardEvent(elements);
    const contextTarget = coordinateContextEvent(elements);
    const pointerId = Number((event as PointerEvent).pointerId);
    let block = false;

    switch (event.type) {
      case "pointerdown":
        block = pointerTarget;
        if (block && Number.isFinite(pointerId)) activePointers.add(pointerId);
        break;
      case "pointermove":
        block = pointerTarget || (Number.isFinite(pointerId) && activePointers.has(pointerId));
        break;
      case "pointerup":
      case "pointercancel":
        block = pointerTarget || (Number.isFinite(pointerId) && activePointers.has(pointerId));
        if (Number.isFinite(pointerId)) activePointers.delete(pointerId);
        break;
      case "mousedown":
        block = pointerTarget;
        activeMouse = block;
        break;
      case "mousemove":
        block = pointerTarget || activeMouse;
        break;
      case "mouseup":
        block = pointerTarget || activeMouse;
        activeMouse = false;
        break;
      case "touchstart":
        block = pointerTarget;
        activeTouch = block;
        break;
      case "touchmove":
        block = pointerTarget || activeTouch;
        break;
      case "touchend":
      case "touchcancel":
        block = pointerTarget || activeTouch;
        activeTouch = false;
        break;
      case "wheel":
        block = boardTarget;
        break;
      case "dragstart":
        block = contextTarget;
        activeDrag = block;
        break;
      case "dragover":
      case "dragleave":
        block = contextTarget || activeDrag;
        break;
      case "drop":
      case "dragend":
        block = contextTarget || activeDrag;
        activeDrag = false;
        break;
      case "focusin":
        block = pointerTarget;
        if (block) {
          const target = asElement(event.target) as HTMLElement | null;
          try { target?.blur(); } catch { /* best effort */ }
        }
        break;
      default:
        block = contextTarget;
    }

    if (!block) return;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  };

  COORDINATE_GUARDED_EVENTS.forEach(type => {
    try { runtimeWindow.addEventListener(type, handler, { capture: true, passive: false }); } catch { /* best effort */ }
  });
  coordinateGuardBindings.set(runtimeWindow, { document: runtimeDocument, handler });
}

function coordinateRootDocument(root: Document | ShadowRoot): Document {
  return root.nodeType === Node.DOCUMENT_NODE
    ? root as Document
    : root.ownerDocument ?? document;
}

function observeCoordinateRoot(root: Document | ShadowRoot): void {
  if (coordinateObservedRoots.has(root)) return;
  coordinateObservedRoots.add(root);
  const runtimeDocument = coordinateRootDocument(root);
  const Observer = runtimeDocument.defaultView?.MutationObserver ?? MutationObserver;
  try {
    const observer = new Observer(mutations => {
      if (!pageIsFrozen()) return;
      if (!mutations.some(mutation => mutation.addedNodes.length > 0)) return;
      scheduleCoordinateUiLock(0);
    });
    observer.observe(root, { childList: true, subtree: true });
    coordinateObservers.push(observer);
  } catch { /* cross-realm best effort */ }
}

function visitCoordinateRoots(
  runtimeDocument: Document,
  visit: (root: Document | ShadowRoot) => void,
): void {
  const pending: Array<Document | ShadowRoot> = [runtimeDocument];
  const visited = new Set<Node>();
  while (pending.length) {
    const root = pending.shift()!;
    if (visited.has(root)) continue;
    visited.add(root);
    visit(root);
    try {
      root.querySelectorAll<Element>("*").forEach(element => {
        if (element.shadowRoot && !visited.has(element.shadowRoot)) pending.push(element.shadowRoot);
      });
    } catch { /* inaccessible/closed roots are covered by composed-event guards */ }
  }
}

function lockCoordinateRoot(root: Document | ShadowRoot): void {
  observeCoordinateRoot(root);
  try {
    root.querySelectorAll<HTMLElement>(".jxgbox").forEach(container => {
      coordinateBoardContainers.add(container);
      lockCoordinateElement(container, false);
    });
    root.querySelectorAll<HTMLElement>(COORDINATE_DIRECT_LOCK_SELECTOR).forEach(element => {
      lockCoordinateElement(element, true);
    });
    root.querySelectorAll<HTMLElement>(COORDINATE_FOCUSABLE_SELECTOR).forEach(element => {
      // The board itself receives a tabindex marker above. Do not let that
      // marker make the whole board inert on the second pass: annotations and
      // selectable explanatory text may live below the board container.
      if (coordinateBoardContainers.has(element)) {
        lockCoordinateElement(element, false);
        return;
      }
      if (elementHasCoordinateContext(element)) lockCoordinateElement(element, true);
    });
  } catch { /* same-origin best effort */ }
}

function scheduleCoordinateUiLock(delay = 0): void {
  const timer = window.setTimeout(() => {
    coordinateLockTimers.delete(timer);
    lockCoordinateUi();
  }, delay);
  coordinateLockTimers.add(timer);
}

function lockCoordinateUi(): void {
  if (!pageIsFrozen()) return;
  const runtimeWindows = sameOriginRuntimeWindows();
  const boards = currentCoordinateBoards(runtimeWindows);
  coordinateBoardContainers = new Set<HTMLElement>();

  boards.forEach(board => {
    const container = board.containerObj;
    if (container && container.nodeType === 1) coordinateBoardContainers.add(container);
    coordinateTouchedBoards.add(board);
    boardObjects(board).forEach(lockCoordinateObject);
  });

  runtimeWindows.forEach(runtimeWindow => {
    ensureCoordinateGuard(runtimeWindow);
    try {
      visitCoordinateRoots(runtimeWindow.document, lockCoordinateRoot);
    } catch { /* same-origin best effort */ }
  });

  coordinateBoardContainers.forEach(container => lockCoordinateElement(container, false));
}

function unlockCoordinateUi(): void {
  coordinateLockTimers.forEach(timer => window.clearTimeout(timer));
  coordinateLockTimers.clear();
  coordinateObservers.splice(0).forEach(observer => {
    try { observer.disconnect(); } catch { /* best effort */ }
  });
  coordinateObservedRoots = new WeakSet<Node>();

  coordinateGuardBindings.forEach((binding, runtimeWindow) => {
    removeCoordinateGuard(runtimeWindow, binding);
  });
  coordinateGuardBindings.clear();

  coordinateLockedElements.forEach((state, element) => {
    const control = element as HTMLElement & { disabled?: boolean; readOnly?: boolean };
    try {
      restoreAttribute(element, "inert", state.inert);
      restoreAttribute(element, "aria-disabled", state.ariaDisabled);
      restoreAttribute(element, "tabindex", state.tabIndex);
      restoreAttribute(element, "data-lia-freeze-coordinate-locked", state.lockMarker);
      if (state.hasDisabled) control.disabled = state.disabled;
      if (state.hasReadOnly) control.readOnly = state.readOnly;
    } catch { /* detached nodes are harmless */ }
  });
  coordinateLockedElements.clear();

  coordinateLockedObjects.forEach((state, object) => {
    try { object.setAttribute?.({ fixed: state.fixed }); } catch { /* stale JSXGraph object */ }
  });
  coordinateLockedObjects.clear();
  coordinateTouchedBoards.forEach(board => {
    try { board.update?.(); } catch { /* stale board */ }
  });
  coordinateTouchedBoards.clear();
  coordinateBoardContainers.clear();
}

function markerRegistries(): MarkerRegistry[] {
  const registries: MarkerRegistry[] = [];
  sameOriginRuntimeWindows().forEach(runtimeWindow => {
    try {
      const registry = runtimeWindow.__LIA_TEXTMARKER_REG_V4__ as MarkerRegistry | undefined;
      if (registry && !registries.includes(registry)) registries.push(registry);
    } catch { /* same-origin best effort */ }
  });
  return registries;
}

function freezeRuntimeDocuments(): Document[] {
  const documents: Document[] = [];
  sameOriginRuntimeWindows().forEach(runtimeWindow => {
    try {
      if (!documents.includes(runtimeWindow.document)) documents.push(runtimeWindow.document);
    } catch { /* same-origin best effort */ }
  });
  return documents;
}

function lockMarkerUi(): void {
  if (!document.body.classList.contains("lia-course-frozen")) return;
  deactivateMarkerRegistries(markerRegistries());

  freezeRuntimeDocuments().forEach(runtimeDocument => {
    runtimeDocument.body?.classList.remove("lia-hl-active", "lia-hl-panel-open");
    runtimeDocument.querySelectorAll<HTMLElement>(FROZEN_MARKER_SELECTOR).forEach(element => {
      if (!element.hasAttribute("data-lia-freeze-marker-locked")) {
        const wasDisabled = "disabled" in element
          && !!(element as HTMLElement & { disabled?: boolean }).disabled;
        element.setAttribute("data-lia-freeze-marker-was-disabled", wasDisabled ? "1" : "0");
      }
      if ("disabled" in element) {
        (element as HTMLElement & { disabled?: boolean }).disabled = true;
      }
      element.setAttribute("inert", "");
      element.setAttribute("aria-disabled", "true");
      element.setAttribute("tabindex", "-1");
      element.setAttribute("data-lia-freeze-marker-locked", "1");
    });
  });
}

function unlockMarkerUi(): void {
  freezeRuntimeDocuments().forEach(runtimeDocument => {
    runtimeDocument.querySelectorAll<HTMLElement>("[data-lia-freeze-marker-locked='1']")
      .forEach(element => {
        if (
          "disabled" in element
          && element.getAttribute("data-lia-freeze-marker-was-disabled") !== "1"
        ) {
          (element as HTMLElement & { disabled?: boolean }).disabled = false;
        }
        element.removeAttribute("inert");
        element.removeAttribute("aria-disabled");
        element.removeAttribute("data-lia-freeze-marker-locked");
        element.removeAttribute("data-lia-freeze-marker-was-disabled");
      });
  });
}

function frozenInteractiveTarget(target: EventTarget | null): HTMLElement | null {
  const targetElement = target as Element | null;
  if (!targetElement || typeof targetElement.closest !== "function") return null;
  const targetDocument = targetElement.ownerDocument;
  if (!targetDocument.body?.classList.contains("lia-course-frozen")) return null;
  if (isFreezePreservedElement(targetElement)) return null;
  const markerInteractive = targetElement.closest<HTMLElement>(FROZEN_MARKER_SELECTOR);
  if (markerInteractive) return markerInteractive;
  const interactive = targetElement.closest<HTMLElement>(FROZEN_INTERACTIVE_SELECTOR);
  const host = getContentHostForDocument(targetDocument);
  const canvasInteractive = interactive?.closest(".lia-canvas-pair, .lia-canvas-mount");
  if (!interactive || (!host?.contains(interactive) && !canvasInteractive)) return null;
  if (isFreezePreservedElement(interactive)) return null;
  if (interactive.closest("#lia-freeze-bar")) return null;
  if (interactive.closest(".lia-submit-box")) return null;
  if (interactive.closest(".lia-annot-toolbar")) return null;
  if (interactive.closest(".lia-exam-intro-virtual-slide")) return null;
  if (interactive.id === "lia-link" || interactive.id === "lia-copy-link") return null;
  return interactive;
}

function ensureFrozenInteractionBlocker(): void {
  const block = (event: Event): void => {
    const eventTarget = event.target as Node | null;
    const eventWindow = eventTarget?.ownerDocument?.defaultView as CoordinateRuntimeWindow | null;
    if (eventWindow?.__liaFreezeCoordinateRestoreActive) return;
    if ((event as Event & { __liaFreezeRestore?: boolean }).__liaFreezeRestore) return;
    if (!frozenInteractiveTarget(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const blockedEvents = [
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
    "mousedown",
    "mousemove",
    "mouseup",
    "touchstart",
    "touchmove",
    "touchend",
    "wheel",
    "beforeinput",
    "input",
    "change",
    "click",
    "dblclick",
    "keydown",
    "keypress",
    "keyup",
    "submit",
    "reset",
  ];
  sameOriginRuntimeWindows().forEach(runtimeWindow => {
    if (frozenInteractionBlockerWindows.has(runtimeWindow)) return;
    frozenInteractionBlockerWindows.add(runtimeWindow);
    blockedEvents.forEach(type => runtimeWindow.addEventListener(
      type,
      block,
      { capture: true, passive: false },
    ));
    // lia-marker commits selections from capture-phase mouse events on ordinary
    // text nodes. Keep text selectable, but force the tool inactive before its
    // handler gets a chance to mutate the saved highlight array.
    ["pointerdown", "mousedown", "mouseup", "dblclick"].forEach(type => {
      runtimeWindow.addEventListener(type, lockMarkerUi, true);
    });
    runtimeWindow.addEventListener("focusin", event => {
      const target = frozenInteractiveTarget(event.target);
      if (target) target.blur();
    }, true);
  });
}

function ensureFrozenContentObserver(): void {
  freezeRuntimeDocuments().forEach(runtimeDocument => {
    if (!runtimeDocument.body || frozenContentObservers.has(runtimeDocument)) return;
    const Observer = runtimeDocument.defaultView?.MutationObserver ?? MutationObserver;
    const observer = new Observer(mutations => {
      if (!runtimeDocument.body?.classList.contains("lia-course-frozen")) return;
      if (!mutations.some(mutation => mutation.addedNodes.length > 0)) return;
      if (frozenContentLockTimer) window.clearTimeout(frozenContentLockTimer);
      frozenContentLockTimer = window.setTimeout(() => {
        frozenContentLockTimer = 0;
        if (!pageIsFrozen()) return;
        const sharedLink = document.body.classList.contains("lia-shared-freeze-link");
        freezeRuntimeDocuments().forEach(nextDocument => {
          nextDocument.body?.classList.add("lia-course-frozen", "lia-snapshot-mode");
          nextDocument.body?.classList.toggle("lia-shared-freeze-link", sharedLink);
        });
        ensureFrozenDragBlocker();
        ensureFrozenInteractionBlocker();
        ensureFrozenContentObserver();
        lockCoordinateUi();
        lockQuizElements();
      }, 0);
    });
    observer.observe(runtimeDocument.body, { childList: true, subtree: true });
    frozenContentObservers.set(runtimeDocument, observer);
  });
}

function ensureFrozenDragBlocker(): void {
  const selector =
    "[draggable], [ondragover], [ondragleave], [ondrop], [ondragstart], [ondragend]";
  const block = (event: Event): void => {
    const target = asElement(event.target);
    const targetDocument = target?.ownerDocument;
    if (!targetDocument?.body?.classList.contains("lia-course-frozen")) return;
    const interactive = target?.closest(selector);
    const host = getContentHostForDocument(targetDocument);
    if (!interactive || !host?.contains(interactive)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  freezeRuntimeDocuments().forEach(runtimeDocument => {
    if (frozenDragBlockerDocuments.has(runtimeDocument)) return;
    frozenDragBlockerDocuments.add(runtimeDocument);
    ["dragstart", "dragover", "dragleave", "drop", "dragend"].forEach(type => {
      runtimeDocument.addEventListener(type, block, true);
    });
  });
}

function lockQuizElements(): void {
  if (!pageIsFrozen()) return;
  frozenLockedElements.forEach((_, element) => {
    if (!element.isConnected) frozenLockedElements.delete(element);
  });
  lockCoordinateUi();
  lockMarkerUi();
  freezeRuntimeDocuments().forEach(runtimeDocument => {
    const host = getContentHostForDocument(runtimeDocument);
    const elements = new Set<HTMLElement>();
    host?.querySelectorAll<HTMLElement>(FROZEN_INTERACTIVE_SELECTOR).forEach(el => elements.add(el));
    runtimeDocument
      .querySelectorAll<HTMLElement>(".lia-canvas-pair canvas, .lia-canvas-mount")
      .forEach(el => elements.add(el));
    elements.forEach(el => {
      if (isFreezePreservedElement(el)) return;
      if (el.closest("#lia-freeze-bar")) return;
      if (el.closest(".lia-submit-box")) return;
      if (el.closest(".lia-annot-toolbar")) return;
      if (el.closest(".lia-exam-intro-virtual-slide")) return;
      if (el.id === "lia-link" || el.id === "lia-copy-link") return;
      const control = el as HTMLElement & { disabled?: boolean; readOnly?: boolean };
      if (!frozenLockedElements.has(el)) {
        frozenLockedElements.set(el, {
          inert: el.getAttribute("inert"),
          ariaDisabled: el.getAttribute("aria-disabled"),
          tabIndex: el.getAttribute("tabindex"),
          hasDisabled: "disabled" in control,
          disabled: !!control.disabled,
          hasReadOnly: "readOnly" in control,
          readOnly: !!control.readOnly,
        });
      }
      if ("disabled" in control) control.disabled = true;
      if ("readOnly" in control) control.readOnly = true;
      // Orthography re-synchronizes disabled/readOnly/tabindex after DOM changes.
      // inert is outside that observer's contract and therefore remains a stable
      // keyboard as well as pointer lock in the teacher's shared-link view.
      el.setAttribute("inert", "");
      el.setAttribute("data-lia-freeze-locked", "1");
      // Keep LiaScript's native draggable value intact. lia-Kachel Proposal uses
      // draggable='true' on a target child as the semantic placed-tile marker.
      // CSS plus the capture-phase drag blocker above still prevents interaction.
      el.setAttribute("aria-disabled", "true");
      el.setAttribute("tabindex", "-1");
    });
  });
}

function unlockQuizElements(): void {
  frozenLockedElements.forEach((state, element) => {
    const control = element as HTMLElement & { disabled?: boolean; readOnly?: boolean };
    restoreAttribute(element, "inert", state.inert);
    restoreAttribute(element, "aria-disabled", state.ariaDisabled);
    restoreAttribute(element, "tabindex", state.tabIndex);
    if (state.hasDisabled && "disabled" in control) control.disabled = state.disabled;
    if (state.hasReadOnly && "readOnly" in control) control.readOnly = state.readOnly;
    element.removeAttribute("data-lia-freeze-locked");
  });
  frozenLockedElements.clear();
}

// Re-apply lia-frozen-scope after slide navigation (the content host is replaced).
export function reapplyContentLock(): void {
  if (!document.body.classList.contains("lia-course-frozen")) return;
  const sharedLink = document.body.classList.contains("lia-shared-freeze-link");
  freezeRuntimeDocuments().forEach(runtimeDocument => {
    runtimeDocument.body?.classList.add("lia-course-frozen", "lia-snapshot-mode");
    runtimeDocument.body?.classList.toggle("lia-shared-freeze-link", sharedLink);
    runtimeDocument.querySelectorAll(".lia-frozen-scope").forEach(el => {
      el.classList.remove("lia-frozen-scope");
    });
    getContentHostForDocument(runtimeDocument)?.classList.add("lia-frozen-scope");
  });
  ensureFrozenDragBlocker();
  ensureFrozenInteractionBlocker();
  ensureFrozenContentObserver();
  lockCoordinateUi();
  [120, 360, 800].forEach(scheduleCoordinateUiLock);
  setTimeout(lockQuizElements, 120);
  setTimeout(refreshAssignmentDetails, 0);
}

// ── Live-mode helpers (wiring the @Abgabe slide DOM) ─────────────────────────

export function wireLiveBar(callbacks: {
  onCreateLink(): void;
  onCopyLink(): void;
  onPrint(): void;
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

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (!t.closest("#lia-print-pdf")) return;
    e.preventDefault();
    e.stopPropagation();
    if (!document.body.classList.contains("lia-course-frozen")) return;
    callbacks.onPrint();
  }, true);
}

export function setLiveBarStatus(msg: string): void {
  const el = document.getElementById("lia-status");
  if (el) el.textContent = msg;
}

function getOrCreateLivePrintButton(): HTMLButtonElement | null {
  const existing = document.getElementById("lia-print-pdf") as HTMLButtonElement | null;
  if (existing) return existing;

  const actions = document.querySelector<HTMLElement>(".lia-submit-box .lia-submit-actions");
  if (!actions) return null;

  const button = document.createElement("button");
  button.id = "lia-print-pdf";
  button.type = "button";
  button.hidden = true;
  button.disabled = true;
  button.textContent = 'Save course and evaluation as PDF';
  button.textContent = "Save evaluation as PDF";
  button.title = "Open the print dialog and choose Save as PDF";
  button.setAttribute("data-snapshot-admin", "1");
  actions.appendChild(button);
  button.textContent = 'Save course and evaluation as PDF';
  return button;
}

export function setLiveBarFrozen(linkUrl: string, name: string): void {
  const nameEl = document.getElementById("lia-name") as HTMLInputElement | null;
  const linkEl = document.getElementById("lia-link") as HTMLInputElement | null;
  const btnEl  = document.getElementById("lia-create-link") as HTMLButtonElement | null;
  const copyBtn = document.getElementById("lia-copy-link") as HTMLButtonElement | null;
  const printBtn = getOrCreateLivePrintButton();
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
  if (printBtn) {
    printBtn.hidden = !linkUrl;
    printBtn.disabled = !linkUrl;
  }

  setLiveBarStatus("Submission link created.");

  if (noteEl) {
    noteEl.style.display = "block";
    noteEl.innerHTML =
      "This is a <strong>frozen submission</strong>. Tasks and inputs are locked. " +
      "The table of contents, display mode, and layout can still be used. " +
      "The PDF button opens the browser print dialog.";
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
