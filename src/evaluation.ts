// Parses @Auswertung / @ADetails / @Abgabe declarations from course markdown
// and renders the scored evaluation slide shown to the teacher.
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
  trackTime: boolean;
  deferFeedback: boolean;
}

export interface DeclaredSlide {
  h: string;
  t: string;
  vt?: string;
}

export interface DeclaredTask {
  be: number;
  tg: string[];
  table: "quiz" | "survey";
}

export interface SlideDeclaration {
  tt: number;   // total task count
  tb: number;   // total point-units
  tg: Record<string, { total: number; tasks: number }>;
  tl: DeclaredTask[];
}

// Per-slide declaration map: "#1" → SlideDeclaration
export type EvaluationDeclarationMap = Record<string, SlideDeclaration>;

export type ManualAwardValues = Record<string, string | number | undefined>;

export function makeManualAwardKey(hash: string, taskIndex: number): string {
  const cleanHash = /^#\d+$/.test(String(hash || "").trim())
    ? String(hash).trim()
    : "";
  const index = Number(taskIndex);
  return cleanHash && Number.isInteger(index) && index > 0
    ? cleanHash + "::task::" + index
    : "";
}

export interface ParsedCourse {
  options: EvaluationOptions;
  slides: DeclaredSlide[];
  evalDecl: EvaluationDeclarationMap;
  abgabeHash: string;
}

export interface ExamConfig {
  enabled: boolean;
  durationMinutes: number;
  triggerHash: string;
}

// ── Fence-aware line iterator ─────────────────────────────────────────────────

function stripLeadingHeaderComment(src: string): string {
  const stripped = src.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
  return stripped;
}

function visibleOutsideHtmlComments(
  line: string,
  state: { inComment: boolean },
): string {
  let rest = line;
  let visible = "";
  while (rest) {
    if (state.inComment) {
      const end = rest.indexOf("-->");
      if (end < 0) return visible;
      state.inComment = false;
      rest = rest.slice(end + 3);
      continue;
    }
    const start = rest.indexOf("<!--");
    if (start < 0) return visible + rest;
    visible += rest.slice(0, start);
    state.inComment = true;
    rest = rest.slice(start + 4);
  }
  return visible;
}

function iterateNonFencedLines(
  text: string,
  fn: (line: string, idx: number) => void
): void {
  const lines = stripLeadingHeaderComment(text).split(/\r?\n/);
  const commentState = { inComment: false };
  let fence: { kind: string; length: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (fence) {
      const marker = rawLine.match(/^\s*((?:\x60){3,}|~{3,})/);
      if (
        marker
        && fence.kind === marker[1][0]
        && marker[1].length >= fence.length
        && rawLine.slice((marker.index || 0) + marker[0].length).trim() === ""
      ) {
        fence = null;
      }
      continue;
    }

    const line = visibleOutsideHtmlComments(rawLine, commentState);
    const marker = line.match(/^\s*((?:\x60){3,}|~{3,})/);
    if (marker) {
      fence = { kind: marker[1][0], length: marker[1].length };
      continue;
    }
    fn(line, i);
  }
}

// ── @Auswertung option parsing ────────────────────────────────────────────────

function parseMacroFlags(raw: string): EvaluationOptions {
  const out: EvaluationOptions = {
    trackF12: false,
    trackTab: false,
    trackTime: false,
    deferFeedback: false,
  };
  normalizeSpace(raw).split(/[;,]/).forEach(flag => {
    const f = normalizeSpace(flag);
    if (/^f12$/i.test(f))  out.trackF12 = true;
    if (/^tab$/i.test(f))  out.trackTab = true;
    if (/^time$/i.test(f)) out.trackTime = true;
    if (/^send$/i.test(f)) out.deferFeedback = true;
  });
  return out;
}

export function parseEvaluationOptions(courseMarkdown: string): EvaluationOptions {
  const out: EvaluationOptions = {
    trackF12: false,
    trackTab: false,
    trackTime: false,
    deferFeedback: false,
  };
  iterateNonFencedLines(courseMarkdown, line => {
    const m = line.match(/^\s*@Auswertung(?:\s*\(([^)]*)\))?\s*$/);
    if (!m) return;
    const flags = parseMacroFlags(m[1] || "");
    if (flags.trackF12)  out.trackF12  = true;
    if (flags.trackTab)  out.trackTab  = true;
    if (flags.trackTime) out.trackTime = true;
    if (flags.deferFeedback) out.deferFeedback = true;
  });
  return out;
}

// ── Declared slides ───────────────────────────────────────────────────────────

const EVALUATION_TITLE = "Evaluation";

export function parseDeclaredSlides(courseMarkdown: string): DeclaredSlide[] {
  const slides: DeclaredSlide[] = [];
  let hasEval = false;
  let liaIdx = 0;      // counts ALL H1-H6 headers — matches LiaScript's URL hash numbering
  let evalLiaIdx = 0;

  iterateNonFencedLines(courseMarkdown, line => {
    if (/^\s*@Auswertung(?:\s*\(([^)]*)\))?\s*$/.test(line)) {
      hasEval = true;
      evalLiaIdx = liaIdx + 1; // evaluation slide is appended after the last real section
    }
    if (/^#{1,6}\s+/.test(line)) {
      liaIdx++;
      const hm = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (hm) {
        slides.push({ h: "#" + liaIdx, t: normalizeSpace(hm[2]) });
      }
    }
  });

  if (hasEval) {
    const evalH = "#" + (evalLiaIdx || liaIdx + 1);
    slides.push({ h: evalH, t: EVALUATION_TITLE, vt: "evaluation" });
  }

  return slides;
}

// ── Section count (H1-H6, matching LiaScript IDB section numbering) ───────────

export function parseSectionCount(courseMarkdown: string): number {
  let count = 0;
  iterateNonFencedLines(courseMarkdown, line => {
    if (/^#{1,6}\s+/.test(line)) count++;
  });
  return count;
}

// ── @Exam config parsing ──────────────────────────────────────────────────────

export function parseExamConfig(courseMarkdown: string): ExamConfig {
  const out: ExamConfig = { enabled: false, durationMinutes: 0, triggerHash: "" };
  let slideCount = 0;

  iterateNonFencedLines(courseMarkdown, line => {
    if (out.enabled) return;
    if (/^#{1,6}\s+/.test(line)) { slideCount++; return; }
    const m = line.trim().match(/^@Exam(?:\s*\(([^)]*)\))?\s*$/i);
    if (!m) return;
    const mins = Number(normalizeSpace(m[1] || "").replace(",", "."));
    if (Number.isFinite(mins) && mins > 0) {
      out.enabled = true;
      out.durationMinutes = mins;
      out.triggerHash = "#" + Math.max(1, slideCount);
    }
  });

  return out;
}

// ── @Abgabe hash ──────────────────────────────────────────────────────────────

export function parseAbgabeHash(courseMarkdown: string): string {
  let slideCount = 0;
  let found = "";

  iterateNonFencedLines(courseMarkdown, line => {
    if (found) return;
    if (/^#{1,6}\s+/.test(line)) { slideCount++; return; }
    if (/^\s*@Abgabe(?:\s*\([^)]*\))?\s*$/.test(line)) {
      found = "#" + Math.max(1, slideCount);
    }
  });

  return found;
}

// ── @ADetails task declarations ───────────────────────────────────────────────

function parseAssignmentPointSpec(raw: string): { total: number | null; parts: number[] } {
  const chunks = normalizeSpace(raw).split(/\s*\|\s*/).filter(Boolean);
  if (!chunks.length) return { total: null, parts: [] };
  const parts = chunks.map(chunk => Number(chunk.replace(",", ".")));
  if (parts.some(value => !Number.isFinite(value) || value < 0)) {
    return { total: null, parts: [] };
  }
  return { total: parts.reduce((sum, value) => sum + value, 0), parts };
}

export interface FrozenEvaluationMetadataV1 {
  v: 1;
  declarations: EvaluationDeclarationMap;
  slides: DeclaredSlide[];
  abgabeHash: string;
  options: EvaluationOptions;
  sectionCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export interface FrozenSendCheckItem {
  hash: string;
  taskIndex: number;
  count: number;
}

export interface FrozenSendCheckCounts {
  total: number;
  items: FrozenSendCheckItem[];
  byTask: Record<string, number>;
}

function makeSendCheckTaskKey(hash: string, taskIndex: number): string {
  return hash + "::send::" + taskIndex;
}

export function readFrozenSendCheckCounts(value: unknown): FrozenSendCheckCounts | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) return null;
  if (value.items.length > 100_000) return null;

  const items: FrozenSendCheckItem[] = [];
  const byTask: Record<string, number> = {};
  let total = 0;

  for (const rawItem of value.items) {
    if (!isRecord(rawItem) || typeof rawItem.hash !== "string") return null;
    const hashMatch = rawItem.hash.match(/^#(\d+)$/);
    const hashNumber = hashMatch ? Number(hashMatch[1]) : NaN;
    const taskIndex = Number(rawItem.taskIndex);
    const count = Number(rawItem.count);
    if (!hashMatch
      || !Number.isSafeInteger(hashNumber)
      || hashNumber < 1
      || hashNumber > 1_000_000
      || String(hashNumber) !== hashMatch[1]
      || !Number.isSafeInteger(taskIndex)
      || taskIndex < 0
      || taskIndex > 1_000_000
      || !Number.isSafeInteger(count)
      || count < 1
      || count > 100_000) {
      return null;
    }

    const key = makeSendCheckTaskKey(rawItem.hash, taskIndex);
    if (Object.prototype.hasOwnProperty.call(byTask, key)) return null;
    byTask[key] = count;
    total += count;
    items.push({ hash: rawItem.hash, taskIndex, count });
  }

  items.sort((a, b) => {
    const hashDelta = Number(a.hash.slice(1)) - Number(b.hash.slice(1));
    return hashDelta || a.taskIndex - b.taskIndex;
  });
  return { total, items, byTask };
}

export function readFrozenEvaluationMetadata(
  value: unknown
): FrozenEvaluationMetadataV1 | null {
  if (!isRecord(value) || value.v !== 1) return null;
  if (!isRecord(value.declarations) || !Array.isArray(value.slides)) return null;

  const declarations: EvaluationDeclarationMap = Object.create(null);
  const declarationEntries = Object.entries(value.declarations);
  if (declarationEntries.length > 10_000) return null;

  for (const [hash, rawDeclaration] of declarationEntries) {
    if (!/^#\d+$/.test(hash) || !isRecord(rawDeclaration) || !Array.isArray(rawDeclaration.tl)) {
      return null;
    }
    if (rawDeclaration.tl.length > 2_000) return null;
    const tasks: DeclaredTask[] = [];
    const tagMap: Record<string, { total: number; tasks: number }> = Object.create(null);
    let total = 0;

    for (const rawTask of rawDeclaration.tl) {
      if (!isRecord(rawTask) || (rawTask.table !== "quiz" && rawTask.table !== "survey")) {
        return null;
      }
      const be = Number(rawTask.be);
      if (!Number.isFinite(be) || be < 0 || be > 1_000_000) return null;
      if (!Array.isArray(rawTask.tg) || rawTask.tg.length > 50) return null;
      const tags: string[] = [];
      for (const rawTag of rawTask.tg) {
        if (typeof rawTag !== "string" || rawTag.length > 300) return null;
        const tag = normalizeSpace(rawTag);
        if (tag && !tags.includes(tag)) tags.push(tag);
      }
      tasks.push({ be, tg: tags, table: rawTask.table });
      total += be;
      tags.forEach(tag => {
        if (!tagMap[tag]) tagMap[tag] = { total: 0, tasks: 0 };
        tagMap[tag].total += be;
        tagMap[tag].tasks += 1;
      });
    }
    declarations[hash] = {
      tt: tasks.length,
      tb: total,
      tg: tagMap,
      tl: tasks,
    };
  }

  if (value.slides.length > 10_000) return null;
  const slides: DeclaredSlide[] = [];
  for (const rawSlide of value.slides) {
    if (!isRecord(rawSlide) || typeof rawSlide.h !== "string" || !/^#\d+$/.test(rawSlide.h)) {
      return null;
    }
    if (typeof rawSlide.t !== "string" || rawSlide.t.length > 1_000) return null;
    if (rawSlide.vt !== undefined && rawSlide.vt !== "evaluation") return null;
    slides.push({
      h: rawSlide.h,
      t: normalizeSpace(rawSlide.t),
      ...(rawSlide.vt === "evaluation" ? { vt: "evaluation" } : {}),
    });
  }

  const rawOptions = isRecord(value.options) ? value.options : {};
  const abgabeHash = typeof value.abgabeHash === "string" && /^#\d+$/.test(value.abgabeHash)
    ? value.abgabeHash
    : "";
  const count = Number(value.sectionCount);
  const sectionCount = Number.isInteger(count) && count > 0 && count <= 10_000
    ? count
    : slides.filter(slide => !slide.vt).length;

  return {
    v: 1,
    declarations,
    slides,
    abgabeHash,
    options: {
      trackF12: rawOptions.trackF12 === true,
      trackTab: rawOptions.trackTab === true,
      trackTime: rawOptions.trackTime === true,
      deferFeedback: rawOptions.deferFeedback === true,
    },
    sectionCount,
  };
}

export function buildFrozenEvaluationMetadata(
  declarations: EvaluationDeclarationMap,
  slides: DeclaredSlide[],
  abgabeHash: string,
  options: EvaluationOptions,
  sectionCount: number
): FrozenEvaluationMetadataV1 {
  const frozen = readFrozenEvaluationMetadata({
    v: 1,
    declarations,
    slides,
    abgabeHash,
    options,
    sectionCount,
  });
  if (!frozen) throw new Error("Invalid frozen evaluation metadata.");
  return frozen;
}

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
    const ptsKeyM = p.match(/^(?:points?|be|punkte?)\s*[:=]\s*([\d.,]+(?:\s*\|\s*[\d.,]+)*)$/i);
    if (ptsKeyM) {
      const parsed = parseAssignmentPointSpec(ptsKeyM[1]);
      if (parsed.total !== null && pointsValue === null) pointsValue = parsed.total;
      return;
    }

    // "1=BE" or "2.5=Punkte" — number=unit
    const numUnitM = p.match(/^([\d.,]+(?:\s*\|\s*[\d.,]+)*)\s*=\s*[A-Za-z%]+$/);
    if (numUnitM) {
      const parsed = parseAssignmentPointSpec(numUnitM[1]);
      if (parsed.total !== null && pointsValue === null) pointsValue = parsed.total;
      return;
    }

    // bare number
    const bare = parseAssignmentPointSpec(p);
    if (bare.total !== null && pointsValue === null) {
      pointsValue = bare.total;
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

const COORDINATE_QUIZ_MACRO_NAMES = [
  'CreatePoint',
  'ErzeugePunkt',
  'PointOnGraph',
  'PunktGraph',
  'PointsOnGraph',
  'PunkteAufGraph',
  'Rekonstruktion',
  'Reconstruction',
  'PerimeterQuiz',
  'UmfangQuiz',
  'AreaQuiz',
  'FlaecheQuiz',
  'ConstructionQuiz',
  'KonstruktionQuiz',
  'KoordQuiz',
  'GeometrieQuiz',
  'CoordinateQuiz',
  'GeometryQuiz',
].join('|');

const COORDINATE_QUIZ_CALL = new RegExp(
  '@(?:' + COORDINATE_QUIZ_MACRO_NAMES + ')\\s*\\(',
  'i'
);

const COORDINATE_QUIZ_CALLS = new RegExp(
  '@(?:' + COORDINATE_QUIZ_MACRO_NAMES + ')\\s*\\(',
  'gi'
);

function collectTasksFromSlideLines(lines: string[]): DeclaredTask[] {
  const tasks: DeclaredTask[] = [];

  function pushTask(table: "quiz" | "survey" = "quiz"): DeclaredTask {
    const t: DeclaredTask = { be: 1, tg: [], table };
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
    if (/@(?:diktat|orthography(?:text)?|rectQuizC?|circleQuizC?|liaQuizC?|TextmarkerQuiz)\s*\(/i.test(line)) return false;
    if (COORDINATE_QUIZ_CALL.test(line)) return false;
    return /\[\[|\[\(|\[\->\[/.test(line);
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

    // choice/matrix block — either "- [[ ]]" bullet or indented "    [[ ]]" / "    [( )]"
    if (/\[\[\s*_{2,}/.test(line)) {
      pushTask("survey");
      continue;
    }

    const isChoiceLine = (l: string) =>
      (/^\s*-\s+/.test(l) && /(\[\[|\[\()/.test(l)) ||
      /^\s{2,}\[[\[( ]/.test(l);
    if (isChoiceLine(line)) {
      pushTask();
      while (i + 1 < lines.length && isChoiceLine(String(lines[i + 1] || ""))) i++;
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

    // lia-orthography's single-line and multiline forms both emit one [[!]] quiz.
    const orthoMatches = line.match(/@orthography(?:text)?\s*\(/gi) || [];
    orthoMatches.forEach(() => pushTask());
    if (orthoMatches.length) continue;

    // lia-Mathe fraction/formula quizzes and @TextmarkerQuiz.
    // Every authored macro below expands to exactly one native LiaScript quiz.
    const macroMatches = line.match(
      /@(?:(?:rectQuizC?|circleQuizC?|liaQuizC?)\s*\(|TextmarkerQuiz\b)/gi
    ) || [];
    macroMatches.forEach(() => pushTask());
    if (macroMatches.length) continue;

    // Every public lia-coordinate Proposal quiz macro expands to one native quiz.
    // Non-quiz coordinate macros are deliberately absent from this exact allow-list.
    const coordinateMatches = line.match(COORDINATE_QUIZ_CALLS) || [];
    coordinateMatches.forEach(() => pushTask());
    if (coordinateMatches.length) continue;

    // lia-kachel public macros each expand to exactly one native tile quiz.
    // Count the authored macro, not the number of [->[…]] targets in its argument.
    const kachelMatches = line.match(/@KachelfolgeN?\s*\(/gi) || [];
    kachelMatches.forEach(() => pushTask());
    if (kachelMatches.length) continue;

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

    if (/^#{1,6}\s+/.test(line)) {
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
      return { be, tg: task.tg.slice(), table: task.table };
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

function declaredQuizTask(
  decl: SlideDeclaration | undefined,
  nativeQuizIndex: number
): DeclaredTask | undefined {
  if (!decl) return undefined;
  return decl.tl.filter(task => task.table !== "survey")[nativeQuizIndex - 1];
}

// Flatten native quiz elements and merge the evaluation-only DOM fallback by
// native quiz index. DOM entries override only their own index. This matters
// for lia-kachel: an order-independent success can be DOM-only even while Elm
// still exposes native placement state for the same slide. quizEval is never
// replayed to Elm.
type CollectedQuizElement = { hash: string; idx: number; el: QuizElement };

function collectQuizElements(payload: SnapshotPayload): CollectedQuizElement[] {
  const merged = new Map<string, CollectedQuizElement>();
  for (const slide of payload.s) {
    for (const quizState of [slide.quiz, slide.quizEval]) {
      if (!quizState) continue;
      for (const [secIdxStr, data] of Object.entries(quizState)) {
        const secIdx = Number(secIdxStr);
        const arr = Array.isArray(data) ? data : [];
        arr.forEach((el: unknown, elIdx: number) => {
          const q = el as QuizElement;
          if (q && typeof q === "object") {
            const hash = "#" + (secIdx + 1);
            const idx = elIdx + 1;
            merged.set(hash + ":" + idx, { hash, idx, el: q });
          }
        });
      }
    }
  }
  return Array.from(merged.values());
}

type EvaluationAllocation = {
  correct: number;
  wrong: number;
  resolved: number;
  notMade: number;
};

function parseManualAward(raw: string | number | undefined, maximum: number): number | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim().replace(",", ".");
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(maximum, value));
}

function automaticAllocation(be: number, task: DeclaredTask, el?: QuizElement): EvaluationAllocation {
  if (task.table === "survey" || !el) {
    return { correct: 0, wrong: 0, resolved: 0, notMade: be };
  }
  const outcome = quizElementOutcome(el);
  if (outcome === "correct") return { correct: be, wrong: 0, resolved: 0, notMade: 0 };
  if (outcome === "wrong") return { correct: 0, wrong: be, resolved: 0, notMade: 0 };
  if (outcome === "resolved") return { correct: 0, wrong: 0, resolved: be, notMade: 0 };
  return { correct: 0, wrong: 0, resolved: 0, notMade: be };
}

function declaredTaskAllocation(
  hash: string,
  taskIndex: number,
  task: DeclaredTask,
  nativeQuizIndex: number,
  elements: CollectedQuizElement[],
  manualAwards?: ManualAwardValues
): EvaluationAllocation {
  const be = Math.max(0, Number(task.be) || 0);
  const key = makeManualAwardKey(hash, taskIndex);
  const manual = key ? parseManualAward(manualAwards?.[key], be) : null;
  if (manual !== null) {
    return {
      correct: manual,
      wrong: Math.max(0, be - manual),
      resolved: 0,
      notMade: 0,
    };
  }
  const element = task.table === "quiz"
    ? elements.find(item => item.hash === hash && item.idx === nativeQuizIndex)?.el
    : undefined;
  return automaticAllocation(be, task, element);
}

export function getAutomaticTaskAward(
  payload: SnapshotPayload,
  evalDecl: EvaluationDeclarationMap,
  hash: string,
  taskIndex: number
): number {
  const decl = evalDecl[hash];
  const task = decl?.tl[taskIndex - 1];
  if (!task) return 0;
  let nativeQuizIndex = 0;
  for (let i = 0; i < taskIndex; i++) {
    if (decl.tl[i]?.table === "quiz") nativeQuizIndex += 1;
  }
  return declaredTaskAllocation(
    hash,
    taskIndex,
    task,
    nativeQuizIndex,
    collectQuizElements(payload)
  ).correct;
}

export function buildEvaluationStats(
  payload: SnapshotPayload,
  evalDecl: EvaluationDeclarationMap,
  manualAwards?: ManualAwardValues
): EvalStats {
  const stats: EvalStats = { total: 0, correct: 0, wrong: 0, resolved: 0, notMade: 0 };
  const elements = collectQuizElements(payload);
  let declaredTasks = 0;

  for (const [hash, decl] of Object.entries(evalDecl)) {
    let nativeQuizIndex = 0;
    decl.tl.forEach((task, taskOffset) => {
      declaredTasks += 1;
      if (task.table === "quiz") nativeQuizIndex += 1;
      const be = Math.max(0, Number(task.be) || 0);
      const allocation = declaredTaskAllocation(
        hash,
        taskOffset + 1,
        task,
        nativeQuizIndex,
        elements,
        manualAwards
      );
      stats.total += be;
      stats.correct += allocation.correct;
      stats.wrong += allocation.wrong;
      stats.resolved += allocation.resolved;
      stats.notMade += allocation.notMade;
    });
  }

  if (declaredTasks === 0) {
    // Fallback: no declarations — count 1 point per native quiz element.
    for (const { el } of elements) {
      stats.total += 1;
      const outcome = quizElementOutcome(el);
      if (outcome === "correct") stats.correct += 1;
      else if (outcome === "wrong") stats.wrong += 1;
      else if (outcome === "resolved") stats.resolved += 1;
      else stats.notMade += 1;
    }
  } else {
    for (const key of ["total", "correct", "wrong", "resolved", "notMade"] as const) {
      stats[key] = Math.round(stats[key] * 1e9) / 1e9;
    }
  }
  return stats;
}

export function buildEvaluationStatsByTag(
  payload: SnapshotPayload,
  evalDecl: EvaluationDeclarationMap,
  manualAwards?: ManualAwardValues
): TagStats[] {
  const bucket: Record<string, TagStats> = Object.create(null);
  const elements = collectQuizElements(payload);

  for (const [hash, decl] of Object.entries(evalDecl)) {
    let nativeQuizIndex = 0;
    decl.tl.forEach((task, taskOffset) => {
      if (task.table === "quiz") nativeQuizIndex += 1;
      if (!task.tg.length) return;
      const be = Math.max(0, Number(task.be) || 0);
      const allocation = declaredTaskAllocation(
        hash,
        taskOffset + 1,
        task,
        nativeQuizIndex,
        elements,
        manualAwards
      );
      for (const tag of task.tg) {
        if (!bucket[tag]) bucket[tag] = { tag, total: 0, tasks: 0, correct: 0, wrong: 0, resolved: 0 };
        bucket[tag].total += be;
        bucket[tag].tasks += 1;
        bucket[tag].correct += allocation.correct;
        bucket[tag].wrong += allocation.wrong;
        bucket[tag].resolved += allocation.resolved;
      }
    });
  }

  return Object.keys(bucket)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(tag => {
      const entry = bucket[tag];
      entry.total = Math.round(entry.total * 1e9) / 1e9;
      entry.correct = Math.round(entry.correct * 1e9) / 1e9;
      entry.wrong = Math.round(entry.wrong * 1e9) / 1e9;
      entry.resolved = Math.round(entry.resolved * 1e9) / 1e9;
      return entry;
    });
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

interface RenderableDevtoolsEvidence {
  browser: "chromium" | "firefox" | "safari" | "other";
  shortcuts: number;
  geometry: number;
  combined: number;
}

interface RenderableFullscreenEvidence {
  status: 0 | 1 | 2 | 3 | 4;
  exits: number;
  allowedExplain: number;
}

function safeSecurityCount(value: unknown): number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 100000
      ? value
      : 0;
}

function readDevtoolsEvidence(value: unknown): RenderableDevtoolsEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const browsers = ["chromium", "firefox", "safari", "other"] as const;
  if (raw.v !== 1 || !browsers.includes(raw.b as typeof browsers[number])) return null;

  const shortcuts = safeSecurityCount(raw.k);
  const geometry = safeSecurityCount(raw.g);
  const combined = safeSecurityCount(raw.c);
  if (shortcuts !== raw.k || geometry !== raw.g || combined !== raw.c) return null;
  if (combined > shortcuts || combined > geometry) return null;
  if (!Array.isArray(raw.e) || raw.e.length > 24) return null;

  const eventsValid = raw.e.every(event => {
    if (!Array.isArray(event) || event.length !== 3) return false;
    const [kind, elapsed, detail] = event;
    return (kind === "k" || kind === "g" || kind === "c")
      && typeof elapsed === "number"
      && Number.isSafeInteger(elapsed)
      && elapsed >= 0
      && elapsed <= 2147483647
      && typeof detail === "string"
      && detail.length <= 32;
  });
  if (!eventsValid) return null;

  return {
    browser: raw.b as RenderableDevtoolsEvidence["browser"],
    shortcuts,
    geometry,
    combined,
  };
}

function readFullscreenEvidence(value: unknown): RenderableFullscreenEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.v !== 1 || ![0, 1, 2, 3, 4].includes(raw.r as number)) return null;
  const exits = safeSecurityCount(raw.x);
  const allowedExplain = safeSecurityCount(raw.a);
  if (exits !== raw.x || allowedExplain !== raw.a) return null;
  if (raw.r !== 1 && (exits > 0 || allowedExplain > 0)) return null;
  if (!Array.isArray(raw.e) || raw.e.length > 24) return null;

  let exitEvents = 0;
  let allowedEvents = 0;
  const eventsValid = raw.e.every(event => {
    if (!Array.isArray(event) || event.length !== 3) return false;
    const [kind, elapsed, detail] = event;
    if (typeof elapsed !== "number"
      || !Number.isSafeInteger(elapsed)
      || elapsed < 0
      || elapsed > 2147483647) return false;
    if (kind === "x" && detail === "exit") { exitEvents += 1; return true; }
    if (kind === "a" && detail === "lia-mathpath-explain") {
      allowedEvents += 1;
      return true;
    }
    return false;
  });
  if (!eventsValid || exitEvents > exits || allowedEvents > allowedExplain) return null;
  if (exits + allowedExplain <= 24
    && (exitEvents !== exits || allowedEvents !== allowedExplain)) return null;

  return {
    status: raw.r as RenderableFullscreenEvidence["status"],
    exits,
    allowedExplain,
  };
}

function renderDevtoolsWarning(sec: SnapshotPayload["sec"]): string {
  if (!sec) return "";
  const trackF12 = (sec as unknown as { trackF12?: unknown }).trackF12;
  if (trackF12 !== 1 && trackF12 !== true) return "";
  const evidence = readDevtoolsEvidence(sec.dt);
  if (!evidence) {
    const legacyCount = safeSecurityCount(sec.f12);
    if (legacyCount <= 0) return "";
    const color = feedbackColor("resolved");
    return [
      '<div style="margin-top:.85rem;font-weight:800;font-size:2.35rem;padding:1rem 1.05rem;border-radius:12px;',
        'border:1px solid ', color, ';',
        'background:color-mix(in srgb, ', color, ' 12%, var(--lia-course-bg) 88%);',
        'color:', color, ';">',
        escapeHtml("Legacy F12/DevTools signal detected (" + legacyCount + "). "),
        '<span style="font-weight:600;font-size:1.45rem;">',
          escapeHtml("Source details are unavailable; treat this as an unverified indicator, not proof."),
        '</span>',
      '</div>',
    ].join("");
  }

  const incidents = evidence.shortcuts + evidence.geometry - evidence.combined;
  if (incidents <= 0) return "";
  const color = feedbackColor(evidence.combined > 0 ? "wrong" : "resolved");
  const browserLabels: Record<RenderableDevtoolsEvidence["browser"], string> = {
    chromium: "Chromium (Chrome, Edge or Brave)",
    firefox: "Firefox",
    safari: "Safari",
    other: "Other browser",
  };
  const incidentLabel = incidents === 1 ? "signal incident" : "signal incidents";
  return [
    '<div style="margin-top:.85rem;padding:1rem 1.05rem;border-radius:12px;',
      'border:1px solid ', color, ';',
      'background:color-mix(in srgb, ', color, ' 12%, var(--lia-course-bg) 88%);',
      'color:', color, ';">',
      '<div style="font-weight:800;font-size:2.35rem;">DevTools-related browser signals detected</div>',
      '<div style="font-weight:700;font-size:1.55rem;margin-top:.35rem;">',
        escapeHtml(incidents + " " + incidentLabel + ". Trusted shortcut candidates: "
          + evidence.shortcuts + " · stable viewport anomalies: " + evidence.geometry
          + " · combined signals: " + evidence.combined + "."),
      '</div>',
      '<div style="font-weight:600;font-size:1.35rem;margin-top:.3rem;">',
        escapeHtml("Browser family: " + browserLabels[evidence.browser] + ". "),
        escapeHtml("These are technical indicators, not proof that DevTools were opened, and they do not change quiz points."),
      '</div>',
    '</div>',
  ].join("");
}

function renderSendCheckSection(
  evidence: FrozenSendCheckCounts,
  evalDecl: EvaluationDeclarationMap,
  slides?: DeclaredSlide[]
): string {
  const declaredKeys = new Set<string>();
  const rows: Array<{
    key: string;
    hash: string;
    taskIndex: number;
    count: number;
    title: string;
    detail: string;
    table: "quiz" | "survey" | "unknown";
  }> = [];
  const slideTitles = new Map((slides ?? []).map(slide => [slide.h, slide.t]));

  Object.entries(evalDecl)
    .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
    .forEach(([hash, declaration]) => {
      declaration.tl.forEach((task, taskIndex) => {
        const key = makeSendCheckTaskKey(hash, taskIndex);
        declaredKeys.add(key);
        const tags = task.tg.length ? task.tg.join(", ") : "No tag";
        rows.push({
          key,
          hash,
          taskIndex,
          count: evidence.byTask[key] ?? 0,
          title: slideTitles.get(hash) ?? hash,
          detail: tags + " · " + (task.table === "survey" ? "Survey (ungraded)" : "Quiz"),
          table: task.table,
        });
      });
    });

  // Keep clicks visible even when a course declaration could not associate
  // them with @ADetails. The overall count and the task rows then still agree.
  evidence.items.forEach(item => {
    const key = makeSendCheckTaskKey(item.hash, item.taskIndex);
    if (declaredKeys.has(key)) return;
    rows.push({
      key,
      hash: item.hash,
      taskIndex: item.taskIndex,
      count: item.count,
      title: slideTitles.get(item.hash) ?? item.hash,
      detail: "No @ADetails declaration",
      table: "unknown",
    });
  });

  const renderedRows = rows.map(row => [
    '<div data-lia-send-check-task="', escapeHtml(row.key),
      '" data-lia-send-check-count="', String(row.count),
      '" data-lia-send-check-table="', row.table,
      '" style="display:grid;grid-template-columns:minmax(220px,1.7fr) minmax(180px,1.4fr) minmax(70px,.35fr);gap:.75rem;',
      'align-items:center;padding:.55rem .7rem;border-top:1px solid var(--lia-course-border);">',
      '<span><strong>', escapeHtml(row.title), '</strong> · Task ', String(row.taskIndex + 1), '</span>',
      '<span style="opacity:.86;">', escapeHtml(row.detail), '</span>',
      '<span style="font-weight:800;text-align:right;">', String(row.count), '</span>',
    '</div>',
  ].join("")).join("");

  return [
    '<div data-lia-send-check-summary="1" data-lia-send-check-total="', String(evidence.total),
      '" style="margin-top:1.35rem;">',
      '<div style="font-weight:800;font-size:2rem;line-height:1.2;margin-bottom:.2rem;">Check clicks per task</div>',
      '<div style="opacity:.82;margin-bottom:.8rem;">Only learner clicks on Check before submission are counted. ',
        'Editing an answer and the automatic Freeze grading do not increase these values.</div>',
      '<div style="overflow-x:auto;border:1px solid var(--lia-course-border);border-radius:12px;">',
        '<div style="min-width:680px;">',
          '<div style="display:grid;grid-template-columns:minmax(220px,1.7fr) minmax(180px,1.4fr) minmax(70px,.35fr);',
            'gap:.75rem;padding:.55rem .7rem;font-weight:800;background:color-mix(in srgb, var(--lia-course-bg) 94%, black 6%);">',
            '<span>Task</span><span>Tags / type</span><span style="text-align:right;">Checks</span>',
          '</div>',
          renderedRows || '<div style="padding:.7rem;">No declared tasks.</div>',
        '</div>',
      '</div>',
    '</div>',
  ].join("");
}

function renderTabWarning(count: number): string {
  if (count <= 0) return "";
  const color = feedbackColor("wrong");
  return [
    '<div style="margin-top:.85rem;padding:1rem 1.05rem;border-radius:12px;',
      'border:1px solid ', color, ';',
      'background:color-mix(in srgb, ', color, ' 12%, var(--lia-course-bg) 88%);',
      'color:', color, ';">',
      '<div style="font-weight:800;font-size:2.35rem;">',
        escapeHtml("Tab/window focus or visibility signals detected"),
      '</div>',
      '<div style="font-weight:600;font-size:1.35rem;margin-top:.3rem;">',
        escapeHtml(count + (count === 1 ? " signal was" : " signals were")
          + " recorded. These are technical indicators, not proof of misconduct, and they do not change quiz points. "
          + "Confirmed lia-mathpath @Explain transitions are excluded."),
      '</div>',
    '</div>',
  ].join("");
}

function renderFullscreenWarning(sec: SnapshotPayload["sec"]): string {
  const evidence = readFullscreenEvidence(sec?.fs);
  if (!evidence) return "";

  let heading = "";
  let detail = "";
  let tone: "wrong" | "resolved" = "resolved";
  if (evidence.exits > 0) {
    tone = "wrong";
    heading = evidence.exits === 1
      ? "Fullscreen mode was left once during the exam"
      : "Fullscreen mode was left " + evidence.exits + " times during the exam";
    detail = "This records confirmed browser fullscreen transitions and does not change quiz points.";
    if (evidence.allowedExplain > 0) {
      detail += " " + evidence.allowedExplain
        + " intended lia-mathpath @Explain transition"
        + (evidence.allowedExplain === 1 ? " was" : "s were")
        + " excluded and is not treated as a violation.";
    }
  } else if (evidence.allowedExplain > 0) {
    heading = "Intended @Explain transition excluded";
    detail = evidence.allowedExplain
      + " confirmed lia-mathpath @Explain transition"
      + (evidence.allowedExplain === 1 ? " was" : "s were")
      + " excluded and is not treated as a violation.";
  } else if (evidence.status === 0) {
    heading = "Fullscreen mode was not requested";
    detail = "The exam was not started through the fullscreen Start Exam action, so fullscreen exits could not be monitored.";
  } else if (evidence.status === 2) {
    heading = "Fullscreen mode is unavailable";
    detail = "This browser or embedding context did not provide an allowed fullscreen API. No fullscreen exit is inferred.";
  } else if (evidence.status === 3) {
    heading = "Fullscreen request was not completed";
    detail = "The browser denied or could not complete the request. No fullscreen exit is inferred.";
  } else if (evidence.status === 4) {
    heading = "Fullscreen request was still pending";
    detail = "The submission was frozen before the browser completed the request. No fullscreen exit is inferred.";
  } else {
    return "";
  }

  const color = feedbackColor(tone);
  return [
    '<div style="margin-top:.85rem;padding:1rem 1.05rem;border-radius:12px;',
      'border:1px solid ', color, ';',
      'background:color-mix(in srgb, ', color, ' 12%, var(--lia-course-bg) 88%);',
      'color:', color, ';">',
      '<div style="font-weight:800;font-size:2.35rem;">', escapeHtml(heading), '</div>',
      '<div style="font-weight:600;font-size:1.35rem;margin-top:.3rem;">',
        escapeHtml(detail),
      '</div>',
    '</div>',
  ].join("");
}

// ── Main render ───────────────────────────────────────────────────────────────

export interface RenderEvaluationOptions {
  payload: SnapshotPayload;
  evalDecl: EvaluationDeclarationMap;
  manualAwards?: ManualAwardValues;
  title?: string;
  name?: string;
  slides?: DeclaredSlide[];
}

export function renderEvaluationSlide(opts: RenderEvaluationOptions): string {
  const { payload, evalDecl, title, name } = opts;

  const stats = buildEvaluationStats(payload, evalDecl, opts.manualAwards);
  const tagStats = buildEvaluationStatsByTag(payload, evalDecl, opts.manualAwards);
  const sendCheckCounts = readFrozenSendCheckCounts(payload.sendChecks);
  const pct = formatPercent(stats.correct, stats.total);

  const sec = payload.sec;
  const f12Warning = renderDevtoolsWarning(sec);
  const tabWarning = sec?.trackTab ? renderTabWarning(safeSecurityCount(sec.tab)) : "";
  const fullscreenWarning = renderFullscreenWarning(sec);

  const subtitle = name
    ? "Name: " + escapeHtml(name) + "<br>Summary of the frozen submission"
    : "Summary of the frozen submission";

  const tagSection = tagStats.length
    ? [
        '<div style="margin-top:1.35rem;">',
          '<div style="font-weight:800;font-size:2rem;line-height:1.2;margin-bottom:.2rem;">Evaluation by Tags</div>',
          '<div style="opacity:.82;margin-bottom:.8rem;">Each tag shows its own partial result.</div>',
          tagStats.map(renderTagBlock).join(""),
        '</div>',
      ].join("")
    : "";
  const sendCheckSection = sendCheckCounts
    ? renderSendCheckSection(sendCheckCounts, evalDecl, opts.slides)
    : "";

  const slideTimeSection = (() => {
    const times = payload.slideTimeMs;
    if (!times || !Object.keys(times).length) return "";
    const rows = Object.entries(times)
      .sort((a, b) => parseInt(a[0].slice(1), 10) - parseInt(b[0].slice(1), 10))
      .map(([h, ms]) => {
        const slide = opts.slides?.find(s => s.h === h);
        const label = slide ? escapeHtml(slide.t) : escapeHtml(h);
        const totalSecs = Math.round(ms / 1000);
        const display = totalSecs < 60
          ? totalSecs + " sec"
          : Math.floor(totalSecs / 60) + " min " + (totalSecs % 60) + " sec";
        return '<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid var(--lia-course-border);">'
          + '<span>' + label + '</span>'
          + '<span style="font-weight:700;">' + escapeHtml(display) + '</span>'
          + '</div>';
      })
      .join("");
    return [
      '<div style="margin-top:1.35rem;">',
        '<div style="font-weight:800;font-size:2rem;line-height:1.2;margin-bottom:.4rem;">Time per Slide</div>',
        '<div style="border:1px solid var(--lia-course-border);border-radius:12px;padding:.6rem 1rem;">',
          rows,
        '</div>',
      '</div>',
    ].join("");
  })();

  return [
    '<div style="font-weight:800;font-size:4.35rem;line-height:1.2;margin-bottom:.6rem;">',
      escapeHtml(title || EVALUATION_TITLE),
    '</div>',

    '<div style="margin-bottom:1rem;opacity:0.92;font-weight:700;">',
      subtitle,
    '</div>',

    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.85rem;margin-bottom:1rem;">',
      renderCard("Correct",   stats.correct,   "correct"),
      renderCard("Wrong",     stats.wrong,     "wrong"),
      renderCard("Resolved",  stats.resolved,  "resolved"),
      renderCard("Not done",  stats.notMade,   "neutral"),
      sendCheckCounts ? renderCard("Checks", sendCheckCounts.total, "neutral") : "",
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
    fullscreenWarning,
    tagSection,
    sendCheckSection,
    slideTimeSection,
  ].join("");
}
