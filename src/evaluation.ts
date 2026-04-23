import { SnapshotPayload } from "./snapshot";

// ── Inline helper ─────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeSpace(s: string): string {
  return String(s || "").trim().replace(/\s+/g, " ");
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface EvaluationOptions {
  trackF12: boolean;
  trackTab: boolean;
}

export interface DeclaredSlide {
  h: string;
  t: string;
  vt?: string;
}

interface DeclaredTask {
  be: number;
  tg: string[];
}

interface SlideDeclaration {
  tt: number;   // total task count
  tb: number;   // total point-units
  tg: Record<string, { total: number; tasks: number }>;
  tl: DeclaredTask[];
}

// Per-slide declaration map: "#1" → SlideDeclaration
type EvaluationDeclarationMap = Record<string, SlideDeclaration>;

export interface ParsedCourse {
  options: EvaluationOptions;
  slides: DeclaredSlide[];
  evalDecl: EvaluationDeclarationMap;
  abgabeHash: string;
}

// ── Fence-aware line iterator ─────────────────────────────────────────────────

function stripLeadingHeaderComment(src: string): string {
  const stripped = src.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
  return stripped;
}

function iterateNonFencedLines(
  text: string,
  fn: (line: string, idx: number) => void
): void {
  const lines = stripLeadingHeaderComment(text).split(/\r?\n/);
  let inFence = false;
  let fenceChar = "";

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(```+|~~~+)/);
    if (m) {
      const ch = m[1].charAt(0);
      if (!inFence) { inFence = true; fenceChar = ch; continue; }
      if (ch === fenceChar) { inFence = false; fenceChar = ""; continue; }
    }
    if (inFence) continue;
    fn(lines[i], i);
  }
}

// ── @Auswertung option parsing ────────────────────────────────────────────────

function parseMacroFlags(raw: string): EvaluationOptions {
  const out: EvaluationOptions = { trackF12: false, trackTab: false };
  normalizeSpace(raw).split(/[;,]/).forEach(flag => {
    const f = normalizeSpace(flag);
    if (/^f12$/i.test(f)) out.trackF12 = true;
    if (/^tab$/i.test(f)) out.trackTab = true;
  });
  return out;
}

export function parseEvaluationOptions(courseMarkdown: string): EvaluationOptions {
  const out: EvaluationOptions = { trackF12: false, trackTab: false };
  iterateNonFencedLines(courseMarkdown, line => {
    const m = line.match(/^\s*@Auswertung(?:\s*\(([^)]*)\))?\s*$/);
    if (!m) return;
    const flags = parseMacroFlags(m[1] || "");
    if (flags.trackF12) out.trackF12 = true;
    if (flags.trackTab) out.trackTab = true;
  });
  return out;
}

// ── Declared slides ───────────────────────────────────────────────────────────

const EVALUATION_TITLE = "Evaluation";

export function parseDeclaredSlides(courseMarkdown: string): DeclaredSlide[] {
  const slides: DeclaredSlide[] = [];
  let hasEval = false;

  iterateNonFencedLines(courseMarkdown, line => {
    if (/^\s*@Auswertung(?:\s*\(([^)]*)\))?\s*$/.test(line)) {
      hasEval = true;
    }
    const hm = line.match(/^(#{1,2})\s+(.+?)\s*$/);
    if (hm) {
      slides.push({ h: "#" + (slides.length + 1), t: normalizeSpace(hm[2]) });
    }
  });

  if (hasEval) {
    slides.push({ h: "#" + (slides.length + 1), t: EVALUATION_TITLE, vt: "evaluation" });
  }

  return slides;
}

// ── @Abgabe hash ──────────────────────────────────────────────────────────────

export function parseAbgabeHash(courseMarkdown: string): string {
  let slideCount = 0;
  let found = "";

  iterateNonFencedLines(courseMarkdown, line => {
    if (found) return;
    if (/^(#{1,2})\s+(.+?)\s*$/.test(line)) { slideCount++; return; }
    if (/^\s*@Abgabe(?:\s*\([^)]*\))?\s*$/.test(line)) {
      found = "#" + Math.max(1, slideCount);
    }
  });

  return found;
}

// ── @ADetails task declarations ───────────────────────────────────────────────

function parseAssignmentDetails(raw: string): { pointsValue: number | null; tags: string[] } {
  const txt = normalizeSpace(raw);
  let pointsValue: number | null = null;
  const tags: string[] = [];

  const parts = txt.split(/\s*;\s*/).filter(Boolean);

  parts.forEach((part, index) => {
    const p = normalizeSpace(part);

    // "tag: foo" or "tags: foo,bar"
    const tagKeyM = p.match(/^tags?\s*[:=]\s*(.+)$/i);
    if (tagKeyM) {
      tagKeyM[1].split(",").map(t => normalizeSpace(t)).filter(Boolean).forEach(t => {
        if (!tags.includes(t)) tags.push(t);
      });
      return;
    }

    // "points: 2" or "be: 2" or "punkte: 2"
    const ptsKeyM = p.match(/^(?:points?|be|punkte?)\s*[:=]\s*([\d.,]+)$/i);
    if (ptsKeyM) {
      const n = Number(ptsKeyM[1].replace(",", "."));
      if (Number.isFinite(n) && n >= 0 && pointsValue === null) pointsValue = n;
      return;
    }

    // "1=BE" or "2.5=Punkte" — number=unit
    const numUnitM = p.match(/^([\d.,]+)\s*=\s*[A-Za-z%]+$/);
    if (numUnitM) {
      const n = Number(numUnitM[1].replace(",", "."));
      if (Number.isFinite(n) && n >= 0 && pointsValue === null) pointsValue = n;
      return;
    }

    // bare number
    const bare = Number(p.replace(",", "."));
    if (Number.isFinite(bare) && bare >= 0 && pointsValue === null) {
      pointsValue = bare;
      return;
    }

    // everything else at index >= 1 is a bare tag (e.g. "Normal", "Grammar")
    if (index >= 1 || parts.length === 1) {
      p.split(",").map(t => normalizeSpace(t)).filter(Boolean).forEach(t => {
        if (!tags.includes(t)) tags.push(t);
      });
    }
  });

  return { pointsValue, tags };
}

function collectTasksFromSlideLines(lines: string[]): DeclaredTask[] {
  const tasks: DeclaredTask[] = [];

  function pushTask(): DeclaredTask {
    const t: DeclaredTask = { be: 1, tg: [] };
    tasks.push(t);
    return t;
  }

  function mergeMeta(task: DeclaredTask | null, raw: string): void {
    if (!task) return;
    const spec = parseAssignmentDetails(raw);
    if (spec.pointsValue !== null) task.be = spec.pointsValue;
    spec.tags.forEach(tag => {
      if (tag && task.tg.indexOf(tag) < 0) task.tg.push(tag);
    });
  }

  function isGroupedInline(line: string): boolean {
    const t = normalizeSpace(line);
    if (!t || /^\s*<!--/.test(t) || /^\s*@ADetails\b/.test(line)) return false;
    if (/^\s*-\s+/.test(line)) return false;
    if (/@(?:diktat|orthography|rectQuiz|circleQuiz|TextmarkerQuiz|ErzeugePunkt)\s*\(/.test(line)) return false;
    return /\[\[|\[\->\[/.test(line);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || "");
    const trimmed = normalizeSpace(line);

    if (!trimmed || /^\s*<!--/.test(trimmed)) continue;

    // @ADetails — annotate last task
    const detailMatches = Array.from(line.matchAll(/@ADetails\s*\(([^)]*)\)/g));
    if (detailMatches.length) {
      const last = tasks.length ? tasks[tasks.length - 1] : null;
      detailMatches.forEach(m => mergeMeta(last, m[1] || ""));
      continue;
    }

    // choice/matrix bullet block
    if (/^\s*-\s+/.test(line) && /(\[\[|\[\()/.test(line)) {
      pushTask();
      while (i + 1 < lines.length && /^\s*-\s+/.test(String(lines[i + 1] || ""))) i++;
      continue;
    }

    // @diktat block
    if (/@diktat\s*\(/.test(line)) {
      pushTask();
      while (i + 1 < lines.length) {
        const nl = String(lines[i + 1] || "");
        const nt = normalizeSpace(nl);
        if (!nt || /^\s*@ADetails\b/.test(nl) || !/@diktat\s*\(/.test(nl)) break;
        i++;
      }
      continue;
    }

    // @orthography
    const orthoMatches = line.match(/@orthography\s*\(/g) || [];
    orthoMatches.forEach(() => pushTask());
    if (orthoMatches.length) continue;

    // @rectQuiz / @circleQuiz / @TextmarkerQuiz / @ErzeugePunkt
    const macroMatches = line.match(/@(?:rectQuiz|circleQuiz|TextmarkerQuiz|ErzeugePunkt)\b/g) || [];
    macroMatches.forEach(() => pushTask());
    if (macroMatches.length) continue;

    // inline / dropdown / tile quiz — group consecutive
    if (isGroupedInline(line)) {
      pushTask();
      while (i + 1 < lines.length) {
        const nl = String(lines[i + 1] || "");
        const nt = normalizeSpace(nl);
        if (!nt || /^\s*@ADetails\b/.test(nl) || /^\s*<!--/.test(nt)) {
          if (/^\s*<!--/.test(nt)) { i++; continue; }
          break;
        }
        if (!isGroupedInline(nl)) break;
        i++;
      }
      continue;
    }
  }

  return tasks;
}

export function parseEvaluationDeclarations(courseMarkdown: string): EvaluationDeclarationMap {
  const src = stripLeadingHeaderComment(courseMarkdown);
  const allLines = src.split(/\r?\n/);
  let inFence = false;
  let fenceChar = "";

  const slideLineGroups: string[][] = [];
  let current: string[] | null = null;

  for (const line of allLines) {
    const m = line.match(/^\s*(```+|~~~+)/);
    if (m) {
      const ch = m[1].charAt(0);
      if (!inFence) { inFence = true; fenceChar = ch; continue; }
      if (ch === fenceChar) { inFence = false; fenceChar = ""; continue; }
    }
    if (inFence) continue;

    if (/^(#{1,2})\s+/.test(line)) {
      if (current) slideLineGroups.push(current);
      current = [];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) slideLineGroups.push(current);

  const map: EvaluationDeclarationMap = Object.create(null);

  slideLineGroups.forEach((lines, idx) => {
    const tasks = collectTasksFromSlideLines(lines);
    const tagMap: Record<string, { total: number; tasks: number }> = Object.create(null);
    let totalBE = 0;

    const taskList = tasks.map(task => {
      const be = Math.max(0, task.be);
      totalBE += be;
      task.tg.forEach(tag => {
        if (!tagMap[tag]) tagMap[tag] = { total: 0, tasks: 0 };
        tagMap[tag].total += be;
        tagMap[tag].tasks += 1;
      });
      return { be, tg: task.tg.slice() };
    });

    map["#" + (idx + 1)] = { tt: taskList.length, tb: totalBE, tg: tagMap, tl: taskList };
  });

  return map;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

// LiaScript quiz element: { solved: 0|1|-1, score: 0|1, trial: number, ... }
type QuizElement = { solved: number; score?: number; trial?: number };

type Outcome = "correct" | "wrong" | "resolved" | "";

function quizElementOutcome(el: QuizElement): Outcome {
  const solved = Number(el.solved);
  if (solved === 1) return "correct";
  if (solved === -1) return "resolved";
  const trial = Number(el.trial || 0);
  if (trial > 0) return "wrong";
  return "";
}

interface EvalStats {
  total: number;
  correct: number;
  wrong: number;
  resolved: number;
  notMade: number;
}

interface TagStats {
  tag: string;
  total: number;
  tasks: number;
  correct: number;
  wrong: number;
  resolved: number;
}

// Flatten all native quiz elements from all slides.
function collectQuizElements(payload: SnapshotPayload): Array<{ hash: string; idx: number; el: QuizElement }> {
  const out: Array<{ hash: string; idx: number; el: QuizElement }> = [];
  for (const slide of payload.s) {
    if (!slide.quiz) continue;
    for (const [secIdxStr, data] of Object.entries(slide.quiz)) {
      const secIdx = Number(secIdxStr);
      const arr = Array.isArray(data) ? data : [];
      arr.forEach((el: unknown, elIdx: number) => {
        const q = el as QuizElement;
        if (q && typeof q === "object") {
          out.push({ hash: "#" + (secIdx + 1), idx: elIdx + 1, el: q });
        }
      });
    }
  }
  return out;
}

// Collect plugin quiz outcomes as flat synthetic QuizElements (1 point each, no tag matching).
// ortho: { [uid]: { solved: boolean, tries: number } }
// mathe: { [uid]: { state: boolean[], meta: { solved: boolean, revealed: boolean } } }
function collectPluginOutcomes(payload: SnapshotPayload): Outcome[] {
  const out: Outcome[] = [];

  for (const slide of payload.s) {
    // orthography
    const ortho = slide.ortho;
    if (ortho && typeof ortho === "object") {
      for (const uid of Object.keys(ortho)) {
        const s = ortho[uid] as Record<string, unknown>;
        if (!s || typeof s !== "object") continue;
        const solved = !!(s["solved"] ?? (s as any).sv);
        const tries = Number(s["tries"] ?? s["tr"] ?? 0);
        if (solved) out.push("correct");
        else if (tries > 0) out.push("wrong");
        else out.push("");
      }
    }

    // mathe (fraction/circle quiz)
    const mathe = slide.mathe;
    if (mathe && typeof mathe === "object") {
      for (const uid of Object.keys(mathe)) {
        const w = mathe[uid] as Record<string, unknown>;
        if (!w || typeof w !== "object") continue;
        const meta = w["meta"] as Record<string, unknown> | undefined;
        if (!meta) continue;
        if (meta["solved"]) out.push("correct");
        else if (meta["revealed"]) out.push("resolved");
        else out.push("");
      }
    }
  }

  return out;
}

export function buildEvaluationStats(
  payload: SnapshotPayload,
  evalDecl: EvaluationDeclarationMap
): EvalStats {
  const stats: EvalStats = { total: 0, correct: 0, wrong: 0, resolved: 0, notMade: 0 };

  // Sum declared totals first
  for (const decl of Object.values(evalDecl)) {
    stats.total += decl.tb;
  }

  const elements = collectQuizElements(payload);
  const pluginOutcomes = collectPluginOutcomes(payload);

  for (const { hash, idx, el } of elements) {
    const decl = evalDecl[hash];
    const task = decl?.tl[idx - 1];
    const be = task ? task.be : 1;
    const outcome = quizElementOutcome(el);

    if (outcome === "correct") stats.correct += be;
    else if (outcome === "wrong") stats.wrong += be;
    else if (outcome === "resolved") stats.resolved += be;
  }

  // Plugin outcomes contribute to correct/wrong/resolved only.
  // The declared total already includes plugin tasks via @ADetails/@circleQuiz etc.
  // Only add to total as fallback when there are no declarations at all.
  if (stats.total > 0) {
    for (const outcome of pluginOutcomes) {
      if (outcome === "correct") stats.correct += 1;
      else if (outcome === "wrong") stats.wrong += 1;
      else if (outcome === "resolved") stats.resolved += 1;
    }
  } else {
    // Fallback: no declarations — count everything including plugins
    for (const { el } of elements) {
      stats.total += 1;
      const outcome = quizElementOutcome(el);
      if (outcome === "correct") stats.correct += 1;
      else if (outcome === "wrong") stats.wrong += 1;
      else if (outcome === "resolved") stats.resolved += 1;
    }
    for (const outcome of pluginOutcomes) {
      stats.total += 1;
      if (outcome === "correct") stats.correct += 1;
      else if (outcome === "wrong") stats.wrong += 1;
      else if (outcome === "resolved") stats.resolved += 1;
    }
  }

  stats.notMade = Math.max(0, stats.total - stats.correct - stats.wrong - stats.resolved);
  return stats;
}

export function buildEvaluationStatsByTag(
  payload: SnapshotPayload,
  evalDecl: EvaluationDeclarationMap
): TagStats[] {
  const bucket: Record<string, TagStats> = Object.create(null);

  // Seed from declarations
  for (const decl of Object.values(evalDecl)) {
    for (const [tag, meta] of Object.entries(decl.tg)) {
      if (!bucket[tag]) bucket[tag] = { tag, total: 0, tasks: 0, correct: 0, wrong: 0, resolved: 0 };
      bucket[tag].total += meta.total;
      bucket[tag].tasks += meta.tasks;
    }
  }

  const elements = collectQuizElements(payload);

  for (const { hash, idx, el } of elements) {
    const decl = evalDecl[hash];
    const task = decl?.tl[idx - 1];
    if (!task || !task.tg.length) continue;

    const be = task.be;
    const outcome = quizElementOutcome(el);

    for (const tag of task.tg) {
      if (!bucket[tag]) bucket[tag] = { tag, total: 0, tasks: 0, correct: 0, wrong: 0, resolved: 0 };
      if (bucket[tag].total <= 0) { bucket[tag].total += be; bucket[tag].tasks += 1; }
      if (outcome === "correct") bucket[tag].correct += be;
      else if (outcome === "wrong") bucket[tag].wrong += be;
      else if (outcome === "resolved") bucket[tag].resolved += be;
    }
  }

  return Object.keys(bucket)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(tag => bucket[tag]);
}

// ── HTML renderers ────────────────────────────────────────────────────────────

function feedbackColor(kind: "correct" | "wrong" | "resolved" | "neutral"): string {
  if (kind === "correct") return "rgb(25, 135, 84)";
  if (kind === "wrong")   return "rgb(220, 53, 69)";
  if (kind === "resolved") return "rgb(108, 117, 125)";
  return "var(--lia-course-fg)";
}

function formatPercent(part: number, total: number): string {
  const p = total > 0 ? (part / total) * 100 : 0;
  const r = Math.round(p * 10) / 10;
  return String(r).replace(".", ",");
}

function renderCard(label: string, value: string | number, kind: "correct" | "wrong" | "resolved" | "neutral"): string {
  const tone = feedbackColor(kind);
  return [
    '<div style="padding:1rem 1.05rem;border-radius:12px;border:1px solid var(--lia-course-border);background:var(--lia-course-bg);color:var(--lia-course-fg);">',
      '<div style="font-size:3rem;opacity:.98;font-weight:700;margin-bottom:.35rem;color:', tone, ';">',
        escapeHtml(label),
      '</div>',
      '<div style="font-size:5rem;line-height:1;font-weight:800;color:', tone, ';">',
        escapeHtml(String(value)),
      '</div>',
    '</div>',
  ].join("");
}

function renderTagMetricCard(label: string, value: string | number, kind: "correct" | "wrong" | "resolved" | "neutral"): string {
  const tone = kind === "neutral" ? "var(--lia-course-fg)" : feedbackColor(kind);
  return [
    '<div style="padding:1rem 1.05rem;border-radius:12px;border:1px solid var(--lia-course-border);background:var(--lia-course-bg);color:var(--lia-course-fg);min-width:150px;box-sizing:border-box;">',
      '<div style="font-size:1.2rem;opacity:.98;font-weight:700;margin-bottom:.35rem;color:', tone, ';">',
        escapeHtml(label),
      '</div>',
      '<div style="font-size:2.5rem;line-height:1.05;font-weight:800;color:', tone, ';">',
        escapeHtml(String(value)),
      '</div>',
    '</div>',
  ].join("");
}

function renderTagBlock(entry: TagStats): string {
  const pct = formatPercent(entry.correct, entry.total);
  return [
    '<div style="margin-top:1.2rem;padding:1rem 1.05rem;border-radius:14px;border:1px solid var(--lia-course-border);background:color-mix(in srgb, var(--lia-course-bg) 94%, black 6%);">',
      '<div style="font-weight:800;font-size:3.0rem;line-height:1.2;margin-bottom:.8rem;color:var(--lia-course-fg);">',
        escapeHtml(entry.tag),
      '</div>',
      '<div style="overflow-x:auto;">',
        '<div style="display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:.75rem;min-width:820px;">',
          renderTagMetricCard("Correct", entry.correct, "correct"),
          renderTagMetricCard("Wrong", entry.wrong, "wrong"),
          renderTagMetricCard("Resolved", entry.resolved, "resolved"),
          renderTagMetricCard("Achieved", entry.correct + " of " + entry.total, "neutral"),
          renderTagMetricCard("Score", pct + "%", "neutral"),
        '</div>',
      '</div>',
    '</div>',
  ].join("");
}

function renderFraudWarning(kind: "f12" | "tab", count: number): string {
  if (count <= 0) return "";
  const color = feedbackColor("wrong");
  const msg = kind === "f12"
    ? "Fraud attempt detected: DevTools (F12) were opened during the exam."
    : "Fraud attempt detected: The tab or window was left during the exam.";
  return [
    '<div style="margin-top:.85rem;font-weight:800;font-size:2.35rem;padding:1rem 1.05rem;border-radius:12px;',
      'border:1px solid ', color, ';',
      'background:color-mix(in srgb, ', color, ' 12%, var(--lia-course-bg) 88%);',
      'color:', color, ';">',
      escapeHtml(msg),
    '</div>',
  ].join("");
}

// ── Main render ───────────────────────────────────────────────────────────────

export interface RenderEvaluationOptions {
  payload: SnapshotPayload;
  evalDecl: EvaluationDeclarationMap;
  title?: string;
}

export function renderEvaluationSlide(opts: RenderEvaluationOptions): string {
  const { payload, evalDecl, title } = opts;

  const stats = buildEvaluationStats(payload, evalDecl);
  const tagStats = buildEvaluationStatsByTag(payload, evalDecl);
  const pct = formatPercent(stats.correct, stats.total);

  const sec = payload.sec;
  const f12Warning = sec?.trackF12 ? renderFraudWarning("f12", sec.f12) : "";
  const tabWarning = sec?.trackTab ? renderFraudWarning("tab", sec.tab) : "";

  const tagSection = tagStats.length
    ? [
        '<div style="margin-top:1.35rem;">',
          '<div style="font-weight:800;font-size:2rem;line-height:1.2;margin-bottom:.2rem;">Evaluation by Tags</div>',
          '<div style="opacity:.82;margin-bottom:.8rem;">Each tag shows its own partial result.</div>',
          tagStats.map(renderTagBlock).join(""),
        '</div>',
      ].join("")
    : "";

  return [
    '<div style="font-weight:800;font-size:4.35rem;line-height:1.2;margin-bottom:.6rem;">',
      escapeHtml(title || EVALUATION_TITLE),
    '</div>',

    '<div style="margin-bottom:1rem;opacity:0.92;font-weight:700;">',
      "Summary of the frozen submission",
    '</div>',

    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.85rem;margin-bottom:1rem;">',
      renderCard("Correct",   stats.correct,   "correct"),
      renderCard("Wrong",     stats.wrong,     "wrong"),
      renderCard("Resolved",  stats.resolved,  "resolved"),
      renderCard("Not done",  stats.notMade,   "neutral"),
    '</div>',

    '<div style="font-weight:800;font-size:2.35rem;padding:1rem 1.05rem;border-radius:12px;border:1px solid var(--lia-course-border);background:var(--lia-course-bg);color:var(--lia-course-fg);">',
      escapeHtml(String(stats.correct)),
      ' of ',
      escapeHtml(String(stats.total)),
      ' points achieved. <br>&nbsp;&nbsp;&nbsp; <strong><big><big><big><big>',
      escapeHtml(pct),
      '%</big></big></big></big></strong>.<br>',
      '<span style="opacity:.82;">Based on the quiz states stored in the freeze snapshot.</span>',
    '</div>',

    f12Warning,
    tabWarning,
    tagSection,
  ].join("");
}
