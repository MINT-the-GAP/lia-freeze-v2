// DOM fallback for native LiaScript quizzes.
//
// The regular IndexedDB connector remains the primary state source. This
// module records the baseline quiz UIs for runtimes (notably the local
// devserver) whose connector deliberately does not persist state. Tile quizzes
// are also recorded when IndexedDB is available so legacy lia-kachel versions,
// current Proposal markup and local no-IDB runtimes share one deterministic
// restore path.

export type NativeDomKind =
  | 'generic'
  | "text"
  | "multiple"
  | "single"
  | "freeText"
  | "matrix"
  | "selection"
  | "orthography"
  | "diktat"
  | "marker"
  | "tile"
  | "fraction";

export type NativeDomOutcome = "correct" | "wrong" | "resolved" | "open";

export type NativeDomFeedbackRenderer = (
  quizRoot: Element,
  contentHost: Element,
  feedback: { text: string; hidden: boolean; appearance?: string[] } | null
) => boolean;

let nativeDomFeedbackRenderer: NativeDomFeedbackRenderer | null = null;

export function configureNativeDomFeedbackRenderer(
  renderer: NativeDomFeedbackRenderer | null
): void {
  nativeDomFeedbackRenderer = renderer;
}

export type NativeDomControlType =
  | "text"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio";

export interface NativeDomControlState {
  index: number;
  type: NativeDomControlType;
  value?: string;
  checked?: 0 | 1;
  key?: string;
  appearance?: string[];
}

export interface NativeDomSelectionState {
  index: number;
  text: string;
  appearance?: string[];
}

export interface NativeDomTileState {
  index: number;
  key?: string;
  sourceKey?: string;
  value: string;
}

export interface NativeDomOrthographyState {
  uid: string;
  value: string;
  start: string;
  tries?: number;
  solved?: 0 | 1;
}

export interface NativeDomFeedbackState {
  text: string;
  hidden: 0 | 1;
  appearance?: string[];
}

export interface NativeDomTaskState {
  taskIndex: number;
  nativeIndex: number;
  table: "quiz" | "survey";
  kind: NativeDomKind;
  controls: NativeDomControlState[];
  selection?: NativeDomSelectionState;
  tiles?: NativeDomTileState[];
  orthography?: NativeDomOrthographyState;
  feedback?: NativeDomFeedbackState;
  touched: 0 | 1;
  outcome: NativeDomOutcome;
  submitted?: 0 | 1;
  rootAppearance?: string[];
}

export interface NativeDomFallbackV1 {
  version: 1;
  slides: Record<string, NativeDomTaskState[]>;
}

export interface NativeDomTrackerOptions {
  getHash(): string;
  getRoot(): Element | null;
  getTaskTables?(hash: string): Array<"quiz" | "survey"> | undefined;
}

export interface SyntheticQuizElement {
  solved: -1 | 0 | 1;
  score: 0 | 1;
  trial: number;
}

export interface NativeDomKindSignals {
  tile?: boolean;
  diktat?: boolean;
  marker?: boolean;
  fraction?: boolean;
  orthography?: boolean;
  selection?: boolean;
  multiple?: boolean;
  single?: boolean;
  matrix?: boolean;
  generic?: boolean;
  multi?: boolean;
  text?: boolean;
  hasTextControl?: boolean;
  hasTextarea?: boolean;
  hasResolve?: boolean;
  tableHint?: "quiz" | "survey";
}

export function classifyNativeDomKind(
  signals: NativeDomKindSignals
): NativeDomKind | null {
  // Template-backed quizzes reuse LiaScript's generic/multi shells. Their
  // identifying scope therefore has to win over the shell class.
  if (signals.tile) return "tile";
  if (signals.diktat) return "diktat";
  if (signals.marker) return "marker";
  if (signals.fraction) return "fraction";
  if (signals.orthography) return "orthography";
  if (signals.selection) return "selection";
  if (signals.multiple) return "multiple";
  if (signals.single) return "single";
  if (signals.matrix) return "matrix";
  if (signals.generic) return "generic";
  if (signals.multi && (signals.tableHint === "quiz" || signals.hasTextControl)) {
    return "text";
  }
  if (signals.text) {
    if (signals.tableHint === "survey") return "freeText";
    if (signals.tableHint === "quiz") return "text";
    if (signals.hasTextarea) return "freeText";
    if (signals.hasResolve) return "text";
  }
  return null;
}

const QUIZ_SELECTOR = ".lia-quiz";
const IGNORED_SELECTOR = [
  "#lia-freeze-bar",
  ".lia-submit-box",
  ".lia-annot-toolbar",
  ".lia-exam-intro-virtual-slide",
  ".lia-adetails-award-input",
  "#lia-name",
  "#lia-link",
].join(",");

const APPEARANCE_CLASSES = new Set([
  "is-success",
  "is-failure",
  "is-error",
  "is-danger",
  "is-warning",
  "text-success",
  "text-error",
  "text-danger",
  "text-warning",
  "text-disabled",
]);

const ROOT_APPEARANCE_CLASSES = new Set(["open", "solved", "failed", "resolved"]);
const TILE_TARGET_HANDLER = /cmd\s*:\s*['"](?:dragtarget|dragenter)['"]/i;
const TILE_SOURCE_HANDLER = /cmd\s*:\s*['"](?:dragsource|dragstart|dragend)['"]/i;
const TILE_SOURCE_VALUE = /\bvalue\s*:\s*(\[[^\]]*\])/i;
const TILE_TARGET_ATTRIBUTES = ["onclick", "onkeydown", "ondragover", "ondragleave", "ondrop"];
const TILE_SOURCE_ATTRIBUTES = ["onclick", "onkeydown", "ondragstart", "ondragend"];

let trackerOptions: NativeDomTrackerOptions | null = null;
let tracked: NativeDomFallbackV1 = { version: 1, slides: {} };
let pendingTimers: number[] = [];

function normalizeSpace(value: string): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function statusClasses(element: Element, allowed: Set<string>): string[] | undefined {
  const classes = Array.from(element.classList).filter(name => allowed.has(name));
  return classes.length ? classes : undefined;
}

function hasHandler(
  element: Element,
  attributes: string[],
  pattern: RegExp
): boolean {
  return attributes.some(name => pattern.test(element.getAttribute(name) || ""));
}

function isTileTarget(element: Element): boolean {
  if (element.getAttribute("data-kf-seq-dummy") === "1") return false;
  if (element.matches(".lia-quiz-drop > .lia-quiz__answers > [role='button']")) {
    return true;
  }
  return hasHandler(element, TILE_TARGET_ATTRIBUTES, TILE_TARGET_HANDLER);
}

function isTileSource(element: Element): boolean {
  if (isTileTarget(element)) return false;
  if (
    element.matches("[role='button']")
    && element.closest(".lia-quiz-drop > .lia-quiz__answers")
  ) {
    return true;
  }
  return element.getAttribute("draggable")?.toLowerCase() === "true"
    || hasHandler(element, TILE_SOURCE_ATTRIBUTES, TILE_SOURCE_HANDLER);
}

function tileTargets(root: Element): Element[] {
  const interactive = Array.from(root.querySelectorAll(
    "[onclick],[onkeydown],[ondragover],[ondragleave],[ondrop]," +
    ".lia-quiz-drop > .lia-quiz__answers > [role='button']"
  )).filter(isTileTarget);
  const hasResolvedTile = root.matches(".lia-quiz-drop.resolved,.lia-quiz-multi.resolved")
    || !!root.querySelector(".lia-quiz-drop.resolved,.lia-quiz-multi.resolved");
  if (!hasResolvedTile) return interactive;

  const staticTargets = Array.from(root.querySelectorAll<HTMLElement>("[style]"))
    .filter(element =>
      !element.hasAttribute("role")
      && element.style.padding === "1rem"
      && element.style.borderStyle === "dotted"
      && normalizeSpace(element.textContent || "").length > 0
    );
  return [...interactive, ...staticTargets.filter(target => !interactive.includes(target))];
}

function tileSources(root: Element): Element[] {
  const targets = tileTargets(root);
  return Array.from(root.querySelectorAll(
    "[onclick],[onkeydown],[ondragstart],[ondragend],[draggable]"
  )).filter(element =>
    isTileSource(element)
    && !targets.some(target => target === element || target.contains(element))
  );
}

function tileInteractiveAncestor(element: Element): Element | null {
  let current: Element | null = element;
  while (current && current !== document.body) {
    if (isTileTarget(current) || isTileSource(current)) return current;
    current = current.parentElement;
  }
  return null;
}

function findTileTaskRoot(quizRoot: Element, host: Element): Element | null {
  let current: Element | null = quizRoot;
  while (current && host.contains(current)) {
    const quizzes = current.matches(QUIZ_SELECTOR)
      ? [current]
      : Array.from(current.querySelectorAll(QUIZ_SELECTOR));
    if (
      quizzes.length === 1
      && quizzes[0] === quizRoot
      && tileTargets(current).length > 0
    ) {
      return current;
    }
    if (current === host) break;
    current = current.parentElement;
  }
  if (quizRoot.classList.contains("lia-quiz-drop")) {
    return quizRoot;
  }
  return null;
}

function findDiktatTaskRoot(quizRoot: Element, host: Element): Element | null {
  let current: Element | null = quizRoot.parentElement;
  while (current && host.contains(current)) {
    const quizzes = Array.from(current.querySelectorAll(QUIZ_SELECTOR));
    if (
      quizzes.length === 1
      && quizzes[0] === quizRoot
      && !!current.querySelector(".lia-diktat input,.lia-diktat textarea")
    ) {
      return current;
    }
    if (current === host) break;
    current = current.parentElement;
  }
  return null;
}

function findMarkerTaskRoot(quizRoot: Element, host: Element): Element | null {
  const directProxy = quizRoot.closest(".hlq-proxy");
  if (directProxy && directProxy.closest(".markerquiz") && host.contains(directProxy)) {
    return directProxy;
  }

  const scope = quizRoot.closest(".markerquiz");
  if (!scope || !host.contains(scope)) return null;
  const proxies = Array.from(scope.querySelectorAll(".hlq-proxy"));
  const quizzes = Array.from(scope.querySelectorAll(QUIZ_SELECTOR));
  if (proxies.length === 1 && quizzes.length === 1 && quizzes[0] === quizRoot) {
    // LiaScript can move the generated input next to (instead of into) the
    // .lia-quiz root. The authored marker scope is the smallest stable root
    // containing the proxy input and its native check/resolve control.
    return scope;
  }
  return null;
}

export function findNativeDomTaskScope(
  quizRoot: Element,
  host: Element
): Element {
  // Inline inputs, dropdowns and native drag targets are rendered immediately
  // before the .lia-quiz control root. Pick the nearest ancestor which still
  // owns exactly this one quiz; never climb into a flex/slide scope containing
  // another task.
  let current: Element | null = quizRoot.parentElement;
  while (current && host.contains(current)) {
    const quizzes = current.matches(QUIZ_SELECTOR)
      ? [current]
      : Array.from(current.querySelectorAll(QUIZ_SELECTOR));
    if (quizzes.length === 1 && quizzes[0] === quizRoot) return current;
    if (quizzes.length > 1) break;
    if (current === host) break;
    current = current.parentElement;
  }
  return quizRoot;
}

function associatedQuizRoot(element: Element, host: Element): Element | null {
  let current: Element | null = element;
  while (current && host.contains(current)) {
    const quizzes = current.matches(QUIZ_SELECTOR)
      ? [current]
      : Array.from(current.querySelectorAll(QUIZ_SELECTOR));
    if (quizzes.length === 1) return quizzes[0];
    if (quizzes.length > 1) return null;
    if (current === host) break;
    current = current.parentElement;
  }
  return null;
}

export function tileSourceIdentity(handler: string | null): string | undefined {
  const value = handler?.match(TILE_SOURCE_VALUE)?.[1];
  return value ? "value:" + value.replace(/\s+/g, "") : undefined;
}

function handlerKey(element: Element, attributes: string[], source: boolean): string | undefined {
  for (const name of attributes) {
    const raw = element.getAttribute(name) || "";
    if (!(source ? TILE_SOURCE_HANDLER : TILE_TARGET_HANDLER).test(raw)) continue;
    if (source) {
      const identity = tileSourceIdentity(raw);
      if (identity) return identity;
    }
    const id = raw.match(/param\s*:\s*\{[^}]*\bid\s*:\s*(\d+)/i)?.[1];
    if (!id) continue;
    return "id:" + id;
  }
  return undefined;
}

function tileTargetValue(target: Element): string {
  const valueHost = target.firstElementChild ?? target;
  const value = normalizeSpace(valueHost.textContent || "");
  return value === "✛" || value === "+" ? "" : value;
}

function readTiles(root: Element): NativeDomTileState[] {
  return tileTargets(root).map((target, index) => {
    const assignedSource = Array.from(target.querySelectorAll(
      "[onclick],[onkeydown],[ondragstart],[ondragend],[draggable]"
    )).find(isTileSource);
    return {
      index,
      key: handlerKey(target, TILE_TARGET_ATTRIBUTES, false),
      sourceKey: assignedSource
        ? handlerKey(assignedSource, TILE_SOURCE_ATTRIBUTES, true)
        : undefined,
      value: tileTargetValue(target),
    };
  });
}

function readFeedback(root: Element): NativeDomFeedbackState | undefined {
  const feedback = root.querySelector(".lia-quiz__feedback");
  if (!feedback) return undefined;
  const text = normalizeSpace(feedback.textContent || "");
  const hidden = feedback instanceof HTMLElement && feedback.hidden;
  // LiaScript keeps an empty visible feedback container around while a quiz
  // remounts. It is not new evidence and must not erase previously captured
  // feedback from the completed check.
  if (!text) return undefined;
  return {
    text,
    hidden: hidden ? 1 : 0,
    appearance: statusClasses(feedback, APPEARANCE_CLASSES),
  };
}

function quizKind(
  root: Element,
  tableHint?: "quiz" | "survey",
  tileRoot?: Element | null,
  diktatRoot?: Element | null,
  markerRoot?: Element | null,
  taskScope: Element = root
): NativeDomKind | null {
  const orthographyScope = root.closest(
    ".orthography-check,.orthography-wrap[data-ortho-uid],.orthography-ui[data-ortho-uid]"
  );
  return classifyNativeDomKind({
    tile: !!tileRoot,
    diktat: !!diktatRoot,
    marker: !!markerRoot,
    fraction: !!root.closest(".fq-widget[data-fq-kind][data-fq-uid]"),
    // @orthography and @orthographytext use LiaScript's generic [[!]] shell.
    orthography: root.hasAttribute("data-ortho-uid") || !!orthographyScope,
    selection: root.classList.contains("lia-quiz-select")
      || !!taskScope.querySelector(".lia-dropdown__selected"),
    multiple: root.classList.contains("lia-quiz-multiple-choice"),
    single: root.classList.contains("lia-quiz-single-choice"),
    matrix: root.classList.contains("lia-quiz-matrix"),
    generic: root.classList.contains("lia-quiz-generic"),
    multi: root.classList.contains("lia-quiz-multi"),
    text: root.classList.contains("lia-quiz-text"),
    hasTextControl: !!taskScope.querySelector(
      "input.lia-quiz__input,textarea.lia-quiz__input"
    ),
    hasTextarea: !!taskScope.querySelector("textarea.lia-quiz__input,textarea"),
    hasResolve: !!root.querySelector(".lia-quiz__resolve"),
    tableHint,
  });
}

function readOrthography(
  root: Element,
  host: Element
): NativeDomOrthographyState | undefined {
  const uid = root.getAttribute("data-ortho-uid")
    || root.closest(".orthography-check")?.getAttribute("data-ortho-uid")
    || "";
  if (!uid) return undefined;
  const wrap = Array.from(host.querySelectorAll<HTMLElement>(".orthography-wrap"))
    .find(candidate => candidate.dataset.orthoUid === uid);
  const input = wrap?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input[id^='orthography-input-'],textarea[id^='orthographytext-input-'],[data-id^='lia-quiz-']"
  );
  if (!wrap || !input) return undefined;
  const startNode = wrap.querySelector<HTMLElement>(
    "[id^='orthography-start-'],[id^='orthographytext-start-']"
  );
  const tries = Number.parseInt(wrap.dataset.orthoTries || "", 10);
  return {
    uid,
    value: input.value,
    start: startNode?.textContent ?? input.defaultValue ?? "",
    tries: Number.isFinite(tries) && tries >= 0 ? tries : undefined,
    solved: wrap.dataset.orthoSolved === "1" ? 1 : 0,
  };
}

function quizOutcome(root: Element): NativeDomOutcome {
  const frozenOutcome = root.getAttribute('data-lia-freeze-outcome');
  if (frozenOutcome === 'correct' || frozenOutcome === 'wrong' || frozenOutcome === 'resolved') {
    return frozenOutcome;
  }
  // LiaScript does not consistently mirror the feedback tone onto the quiz
  // root. Text, canvas/OCR and template-backed quizzes can therefore be
  // visibly green while the root remains merely open.
  if (root.querySelector(
    '.lia-quiz__feedback.text-success,.lia-quiz__feedback.is-success,.is-success,.text-success'
  )) {
    return 'correct';
  }
  if (root.classList.contains("resolved")) return "resolved";
  if (root.classList.contains("solved")) return "correct";
  if (root.classList.contains("failed")) return "wrong";
  if (root.querySelector(
    ".lia-quiz__feedback.text-error,.lia-quiz__feedback.text-danger,.is-failure"
  )) {
    return "wrong";
  }
  return "open";
}

export function normalizeNativeDomRootAppearance(
  outcome: NativeDomOutcome,
  appearance?: string[]
): string[] | undefined {
  const normalized = Array.from(new Set((appearance ?? []).filter(name =>
    ROOT_APPEARANCE_CLASSES.has(name) && (outcome === 'open' || name !== 'open')
  )));
  if (outcome === 'correct' && !normalized.includes('solved')) normalized.push('solved');
  if (outcome === 'wrong' && !normalized.includes('failed')) normalized.push('failed');
  if (outcome === 'resolved' && !normalized.includes('resolved')) normalized.push('resolved');
  return normalized.length ? normalized : undefined;
}

function controlType(element: Element): NativeDomControlType | null {
  if (element instanceof HTMLTextAreaElement) return "textarea";
  if (element instanceof HTMLSelectElement) return "select";
  if (!(element instanceof HTMLInputElement)) return null;
  const type = element.type.toLowerCase();
  if (type === "checkbox" || type === "radio") return type;
  if (type === "text" || type === "search" || type === "number") return "text";
  return null;
}

function controlKey(element: Element): string | undefined {
  const labelled = element.getAttribute("aria-label")
    || element.closest("label")?.textContent
    || "";
  const key = normalizeSpace(labelled);
  return key || undefined;
}

function eligibleControls(root: Element): Element[] {
  return Array.from(root.querySelectorAll("input,textarea,select")).filter(element =>
    !element.closest(IGNORED_SELECTOR) && controlType(element) !== null
  );
}

function readControls(root: Element): NativeDomControlState[] {
  const controls: NativeDomControlState[] = [];
  const elements = eligibleControls(root);
  elements.forEach((element, index) => {
    const type = controlType(element);
    if (!type) return;

    const state: NativeDomControlState = {
      index,
      type,
      key: controlKey(element),
      appearance: statusClasses(element, APPEARANCE_CLASSES),
    };

    if (element instanceof HTMLInputElement && (type === "checkbox" || type === "radio")) {
      state.checked = element.checked ? 1 : 0;
    } else if (
      element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement
    ) {
      state.value = element.value;
    }
    controls.push(state);
  });
  return controls;
}

function readSelection(root: Element): NativeDomSelectionState | undefined {
  const selected = root.querySelector(".lia-dropdown__selected");
  if (!selected) return undefined;

  const text = normalizeSpace(selected.textContent || "");
  const options = Array.from(root.querySelectorAll(".lia-dropdown__option"));
  const valueHost = Array.from(selected.children).find(child => !child.matches("i"));
  const signature = valueHost?.innerHTML ?? "";
  let index = text
    ? options.findIndex(option => normalizeSpace(option.textContent || "") === text)
    : -1;
  if (index < 0 && signature) {
    index = options.findIndex(option => {
      const source = option.firstElementChild ?? option;
      return source.innerHTML === signature;
    });
  }
  if (index < 0) return undefined;

  const dropdown = selected.closest(".lia-dropdown");
  return {
    index,
    text,
    appearance: dropdown ? statusClasses(dropdown, APPEARANCE_CLASSES) : undefined,
  };
}

function taskTouched(
  controls: NativeDomControlState[],
  selection: NativeDomSelectionState | undefined,
  tiles: NativeDomTileState[] | undefined,
  orthography: NativeDomOrthographyState | undefined,
  outcome: NativeDomOutcome
): boolean {
  if (outcome !== "open" || selection) return true;
  if (tiles?.some(tile => tile.value.length > 0)) return true;
  if (orthography && orthography.value !== orthography.start) return true;
  return controls.some(control =>
    control.checked === 1 || (typeof control.value === "string" && control.value.length > 0)
  );
}

function readTask(
  root: Element,
  host: Element,
  taskIndex: number,
  quizIndex: number,
  surveyIndex: number,
  tableHint?: "quiz" | "survey"
): NativeDomTaskState | null {
  const taskScope = findNativeDomTaskScope(root, host);
  const tileRoot = findTileTaskRoot(root, host);
  const diktatRoot = findDiktatTaskRoot(root, host);
  const markerRoot = findMarkerTaskRoot(root, host);
  const kind = quizKind(
    root,
    tableHint,
    tileRoot,
    diktatRoot,
    markerRoot,
    taskScope
  );
  if (!kind) return null;
  const table = kind === "freeText" ? "survey" : "quiz";
  const controls = readControls(
    kind === "diktat" && diktatRoot
      ? diktatRoot
      : kind === "marker" && markerRoot
        ? markerRoot
        : taskScope
  );
  const selection = kind === "selection" ? readSelection(taskScope) : undefined;
  const tiles = kind === "tile" && tileRoot ? readTiles(tileRoot) : undefined;
  const orthography = kind === "orthography" ? readOrthography(root, host) : undefined;
  const outcome = table === "survey" ? "open" : quizOutcome(root);

  return {
    taskIndex,
    nativeIndex: table === "survey" ? surveyIndex : quizIndex,
    table,
    kind,
    controls,
    selection,
    tiles,
    orthography,
    feedback: readFeedback(root),
    touched: taskTouched(controls, selection, tiles, orthography, outcome) ? 1 : 0,
    outcome,
    submitted: table === "survey" && !root.classList.contains("open") ? 1 : undefined,
    rootAppearance: normalizeNativeDomRootAppearance(
      outcome,
      statusClasses(root, ROOT_APPEARANCE_CLASSES)
    ),
  };
}

function hasMeaningfulState(tasks: NativeDomTaskState[]): boolean {
  return tasks.some(task => task.touched === 1 || task.outcome !== "open");
}

function mergeFeedback(
  current: NativeDomFeedbackState | undefined,
  previous: NativeDomFeedbackState | undefined
): NativeDomFeedbackState | undefined {
  if (current && normalizeSpace(current.text)) return current;
  if (previous && normalizeSpace(previous.text)) return previous;
  return current ?? previous;
}

export function mergeNativeDomTaskSnapshots(
  previous: NativeDomTaskState[],
  current: NativeDomTaskState[]
): NativeDomTaskState[] {
  const merged = current.map<NativeDomTaskState>(task => {
    const old = previous.find(candidate =>
      candidate.taskIndex === task.taskIndex && candidate.table === task.table
    );
    if (!old) {
      return {
        ...task,
        rootAppearance: normalizeNativeDomRootAppearance(
          task.outcome,
          task.rootAppearance
        ),
      };
    }
    const keepOldOutcome = task.outcome === 'open' && old.outcome !== 'open';
    const outcome = keepOldOutcome ? old.outcome : task.outcome;
    const appearance = keepOldOutcome
      ? old.rootAppearance
      : task.rootAppearance?.length
        ? task.rootAppearance
        : old.rootAppearance;
    return {
      ...task,
      controls: task.controls.length ? task.controls : old.controls,
      selection: task.selection ?? old.selection,
      tiles: task.tiles?.length ? task.tiles : old.tiles,
      orthography: task.orthography ?? old.orthography,
      feedback: mergeFeedback(task.feedback, old.feedback),
      touched: task.touched || old.touched ? 1 : 0,
      outcome,
      submitted: task.submitted ?? old.submitted,
      rootAppearance: normalizeNativeDomRootAppearance(outcome, appearance),
    };
  });
  previous.forEach(task => {
    if (!current.some(candidate =>
      candidate.taskIndex === task.taskIndex && candidate.table === task.table
    )) {
      merged.push(task);
    }
  });
  return merged.sort((a, b) =>
    a.taskIndex - b.taskIndex || a.table.localeCompare(b.table)
  );
}

function scheduleCapture(delay: number): void {
  const options = trackerOptions;
  if (!options) return;
  const hash = options.getHash();
  const timer = window.setTimeout(() => {
    pendingTimers = pendingTimers.filter(id => id !== timer);
    if (trackerOptions === options && options.getHash() === hash) {
      captureNativeDomNow(hash);
    }
  }, delay);
  pendingTimers.push(timer);
}

export function captureNativeDomNow(hash?: string): void {
  const options = trackerOptions;
  if (!options) return;
  const slideHash = hash || options.getHash();
  const root = options.getRoot();
  if (!root || !/^#\d+$/.test(slideHash)) return;

  const quizRoots = Array.from(root.querySelectorAll(QUIZ_SELECTOR))
    .filter(element => !element.closest(IGNORED_SELECTOR));
  const declaredTables = options.getTaskTables?.(slideHash);
  // Imported templates can temporarily remove/recreate quiz roots. Never let
  // such an incomplete render shift authored task indexes or erase the last
  // complete snapshot.
  if (declaredTables && declaredTables.length !== quizRoots.length) return;
  const taskTables = declaredTables?.length === quizRoots.length
    ? declaredTables
    : undefined;
  const tasks: NativeDomTaskState[] = [];
  let quizIndex = 0;
  let surveyIndex = 0;
  let hasUnknownQuiz = false;

  quizRoots.forEach((quizRoot, taskIndex) => {
    const state = readTask(
      quizRoot,
      root,
      taskIndex,
      quizIndex,
      surveyIndex,
      taskTables?.[taskIndex]
    );
    if (!state) {
      hasUnknownQuiz = true;
      return;
    }
    tasks.push(state);
    if (state.table === "survey") surveyIndex += 1;
    else quizIndex += 1;
  });

  tasks.splice(
    0,
    tasks.length,
    ...mergeNativeDomTaskSnapshots(tracked.slides[slideHash] ?? [], tasks)
  );
  if (hasUnknownQuiz) {
    // Keep the last validated snapshot while a template is between mounts.
    return;
  }
  if (hasMeaningfulState(tasks)) tracked.slides[slideHash] = tasks;
  else delete tracked.slides[slideHash];
}

export function captureNativeDomTaskOutcomeNow(
  hash: string,
  root: Element,
  taskIndex: number,
  nativeIndex: number,
  table: "quiz" | "survey" = "quiz"
): boolean {
  const options = trackerOptions;
  if (!options || !/^#\d+$/.test(hash)) return false;
  const outcome = table === 'survey' ? 'open' : quizOutcome(root);
  if (outcome === 'open') return false;

  const previous = tracked.slides[hash] ?? [];
  const old = previous.find(task =>
    task.taskIndex === taskIndex && task.table === table
  );
  const feedback = readFeedback(root) ?? old?.feedback;
  const rootAppearance = normalizeNativeDomRootAppearance(
    outcome,
    statusClasses(root, ROOT_APPEARANCE_CLASSES)
  );

  let current: NativeDomTaskState | null;
  if (old) {
    // The result root may already be detached after an imported widget
    // remount. Preserve the submitted controls and update only the definitive
    // grading evidence observed on that exact root.
    current = {
      ...old,
      nativeIndex,
      outcome,
      feedback,
      touched: 1,
      rootAppearance,
    };
  } else {
    const host = options.getRoot();
    if (!host) return false;
    current = readTask(
      root,
      host,
      taskIndex,
      table === 'quiz' ? nativeIndex : 0,
      table === 'survey' ? nativeIndex : 0,
      table
    );
    if (!current) return false;
    current = {
      ...current,
      taskIndex,
      nativeIndex,
      table,
      outcome,
      feedback,
      touched: 1,
      rootAppearance,
    };
  }

  const tasks = mergeNativeDomTaskSnapshots(previous, [current]);
  if (hasMeaningfulState(tasks)) tracked.slides[hash] = tasks;
  return true;
}

export function exportNativeDomFallback(): NativeDomFallbackV1 | undefined {
  if (!Object.keys(tracked.slides).length) return undefined;
  return JSON.parse(JSON.stringify(tracked)) as NativeDomFallbackV1;
}

export function installNativeDomTracker(options: NativeDomTrackerOptions): () => void {
  trackerOptions = options;
  tracked = { version: 1, slides: {} };

  const onInteraction = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const host = trackerOptions?.getRoot();
    const siblingQuiz = host ? associatedQuizRoot(target, host) : null;
    if (
      !target.closest(QUIZ_SELECTOR)
      && !siblingQuiz
      && !tileInteractiveAncestor(target)
      && !target.closest(".orthography-wrap[data-ortho-uid]")
      && !target.closest(".lia-diktat")
    ) return;
    if (target.closest(IGNORED_SELECTOR)) return;
    captureNativeDomNow();
    scheduleCapture(0);
    scheduleCapture(90);
    scheduleCapture(320);
  };
  const onHashChange = () => {
    scheduleCapture(120);
    scheduleCapture(360);
  };

  document.addEventListener("input", onInteraction, true);
  document.addEventListener("change", onInteraction, true);
  document.addEventListener("click", onInteraction, true);
  document.addEventListener("drop", onInteraction, true);
  document.addEventListener("dragend", onInteraction, true);
  document.addEventListener("pointerup", onInteraction, true);
  document.addEventListener("touchend", onInteraction, true);
  window.addEventListener("hashchange", onHashChange);

  const observer = new MutationObserver(mutations => {
    const touchesQuiz = mutations.some(mutation => {
      const target = mutation.target instanceof Element
        ? mutation.target
        : mutation.target.parentElement;
      if (target?.closest(QUIZ_SELECTOR)) return true;
      if (target && tileInteractiveAncestor(target)) return true;
      if (target?.closest(".orthography-wrap[data-ortho-uid]")) return true;
      if (target?.closest(".lia-diktat")) return true;
      return Array.from(mutation.addedNodes).some(node =>
        node instanceof Element && (
          node.matches(QUIZ_SELECTOR)
          || node.matches(".orthography-wrap[data-ortho-uid]")
          || node.matches(".lia-diktat")
          || !!node.querySelector(QUIZ_SELECTOR)
          || !!node.querySelector(".orthography-wrap[data-ortho-uid]")
          || !!node.querySelector(".lia-diktat")
          || isTileTarget(node)
          || isTileSource(node)
          || !!Array.from(node.querySelectorAll(
            "[onclick],[onkeydown],[ondragover],[ondragleave],[ondrop],[ondragstart],[ondragend],[draggable]"
          )).find(element => isTileTarget(element) || isTileSource(element))
        )
      );
    });
    if (touchesQuiz) scheduleCapture(60);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });

  scheduleCapture(0);
  scheduleCapture(180);

  return () => {
    document.removeEventListener("input", onInteraction, true);
    document.removeEventListener("change", onInteraction, true);
    document.removeEventListener("click", onInteraction, true);
    document.removeEventListener("drop", onInteraction, true);
    document.removeEventListener("dragend", onInteraction, true);
    document.removeEventListener("pointerup", onInteraction, true);
    document.removeEventListener("touchend", onInteraction, true);
    window.removeEventListener("hashchange", onHashChange);
    observer.disconnect();
    pendingTimers.forEach(id => clearTimeout(id));
    pendingTimers = [];
    if (trackerOptions === options) trackerOptions = null;
  };
}

function addAppearance(element: Element, classes?: string[]): void {
  classes?.forEach(name => {
    if (APPEARANCE_CLASSES.has(name) || ROOT_APPEARANCE_CLASSES.has(name)) {
      element.classList.add(name);
    }
  });
}

function findControl(
  controls: Element[],
  state: NativeDomControlState
): Element | undefined {
  const indexed = controls[state.index];
  if (state.key) {
    const keyed = controls.filter(control =>
      controlType(control) === state.type && controlKey(control) === state.key
    );
    if (keyed.length === 1) return keyed[0];
    if (
      indexed
      && controlType(indexed) === state.type
      && controlKey(indexed) === state.key
    ) return indexed;
  }
  if (indexed && controlType(indexed) === state.type) return indexed;
  return controls.find(control => controlType(control) === state.type);
}

function restoreControls(root: Element, states: NativeDomControlState[]): void {
  const controls = eligibleControls(root);
  states.forEach(state => {
    const element = findControl(controls, state);
    if (!element) return;
    if (
      element instanceof HTMLInputElement
      && (state.type === "checkbox" || state.type === "radio")
    ) {
      element.checked = state.checked === 1;
    } else if (
      element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement
    ) {
      element.value = state.value ?? "";
    }
    addAppearance(element, state.appearance);
    if (element.matches("[data-lia-math-quiz-native],.lia-math-quiz-native")) {
      // The Proposals formula quiz displays a proxy outside .lia-quiz while
      // keeping this hidden native input as its source of truth. Notify the
      // bridge after the visual DOM fallback has restored the native value.
      ["input", "change"].forEach(type => {
        const event = new Event(type, { bubbles: true });
        (event as Event & { __liaFreezeRestore?: boolean }).__liaFreezeRestore = true;
        element.dispatchEvent(event);
      });
    }
  });
}

function restoreSelection(root: Element, state?: NativeDomSelectionState): void {
  if (!state) return;
  const selected = root.querySelector(".lia-dropdown__selected");
  const options = Array.from(root.querySelectorAll(".lia-dropdown__option"));
  if (!selected || !options.length) return;

  const textMatch = state.text
    ? options.find(item =>
        normalizeSpace(item.textContent || "") === normalizeSpace(state.text)
      )
    : undefined;
  const option = textMatch ?? options[state.index];
  const valueHost = Array.from(selected.children).find(child => !child.matches("i"));
  if (option && valueHost) {
    const source = option.firstElementChild ?? option;
    valueHost.replaceChildren(...Array.from(source.childNodes).map(node => node.cloneNode(true)));
  } else if (valueHost) {
    valueHost.textContent = state.text;
  }
  const dropdown = selected.closest(".lia-dropdown");
  if (dropdown) addAppearance(dropdown, state.appearance);
}

function restoreFeedback(
  root: Element,
  contentHost: Element,
  state?: NativeDomFeedbackState
): void {
  if (!state) return;
  const feedback = root.querySelector(".lia-quiz__feedback");
  if (!feedback) {
    nativeDomFeedbackRenderer?.(root, contentHost, {
      text: state.text,
      hidden: state.hidden === 1,
      appearance: state.appearance,
    });
    return;
  }
  nativeDomFeedbackRenderer?.(root, contentHost, null);
  APPEARANCE_CLASSES.forEach(name => feedback?.classList.remove(name));
  feedback.textContent = state.text;
  if (feedback instanceof HTMLElement) feedback.hidden = state.hidden === 1;
  addAppearance(feedback, state.appearance);
}

function restoreOrthography(
  quizRoot: Element,
  host: Element,
  state?: NativeDomOrthographyState
): void {
  if (!state) return;
  const wrap = Array.from(host.querySelectorAll<HTMLElement>(".orthography-wrap"))
    .find(candidate => candidate.dataset.orthoUid === state.uid);
  const input = wrap?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input[id^='orthography-input-'],textarea[id^='orthographytext-input-'],[data-id^='lia-quiz-']"
  );
  if (!wrap || !input) return;

  const proto = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(input, state.value);
  else input.value = state.value;

  if (typeof state.tries === "number") wrap.dataset.orthoTries = String(state.tries);
  if (state.solved !== undefined) wrap.dataset.orthoSolved = String(state.solved);

  // Let the template update its own liveValue. The private marker allows this
  // restore event through Freeze's capture-phase teacher lock.
  ["input", "change"].forEach(type => {
    const event = new Event(type, { bubbles: true });
    (event as Event & { __liaFreezeRestore?: boolean }).__liaFreezeRestore = true;
    input.dispatchEvent(event);
  });

  if (state.solved === 1) input.readOnly = true;
  quizRoot.setAttribute("data-ortho-uid", state.uid);
}

function findTileTarget(
  targets: Element[],
  state: NativeDomTileState
): Element | undefined {
  const indexed = targets[state.index];
  if (state.key) {
    const keyed = targets.filter(target =>
      handlerKey(target, TILE_TARGET_ATTRIBUTES, false) === state.key
    );
    if (keyed.length === 1) return keyed[0];
    if (indexed && handlerKey(indexed, TILE_TARGET_ATTRIBUTES, false) === state.key) {
      return indexed;
    }
  }
  return indexed;
}

function cloneTileSource(source: Element, target: Element): Element {
  const clone = source.cloneNode(true) as Element;
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
  [
    "role",
    "aria-grabbed",
    "aria-disabled",
    "aria-hidden",
    "tabindex",
    "onclick",
    "onkeydown",
    "ondragstart",
  ].forEach(name => clone.removeAttribute(name));
  const targetId = handlerKey(target, TILE_TARGET_ATTRIBUTES, false)?.match(/^id:(\d+)$/)?.[1];
  const dragEnd = clone.getAttribute("ondragend");
  if (targetId && dragEnd) {
    clone.setAttribute(
      "ondragend",
      dragEnd.replace(/(\bid\s*:\s*)\d+/i, "$1" + targetId)
    );
  }
  if (clone instanceof HTMLElement) {
    const cursor = source instanceof HTMLElement ? source.style.cursor : "";
    clone.removeAttribute("style");
    clone.style.cursor = cursor || "pointer";
  }
  return clone;
}

function setTileTargetValue(
  target: Element,
  value: string,
  source?: Element,
  placeholderTemplate?: Element
): void {
  const current = tileTargetValue(target);
  if (current === value && current.length > 0) {
    target.classList.remove("lia-target-placeholder");
    target.firstElementChild?.classList.remove("lia-target-placeholder");
    return;
  }

  if (value) {
    if (source) {
      target.replaceChildren(cloneTileSource(source, target));
    } else {
      const valueHost = target.firstElementChild ?? target;
      valueHost.textContent = value;
    }
    target.classList.remove("lia-target-placeholder");
    target.firstElementChild?.classList.remove("lia-target-placeholder");
    if (target instanceof HTMLElement) target.style.color = "";
    if (target.firstElementChild instanceof HTMLElement) {
      target.firstElementChild.style.color = "";
    }
    return;
  }

  const currentHost = target.firstElementChild;
  if (currentHost && tileTargetValue(target) === "") return;
  const placeholder = placeholderTemplate
    ? placeholderTemplate.cloneNode(true) as Element
    : document.createElement("div");
  placeholder.classList.add("lia-target-placeholder");
  placeholder.textContent = "✛";
  target.replaceChildren(placeholder);
  target.classList.add("lia-target-placeholder");
}

export function progressiveTileVisibility(
  filledTargets: readonly boolean[]
): boolean[] {
  let emptyTargetShown = false;
  return filledTargets.map(filled => {
    if (filled) return true;
    if (emptyTargetShown) return false;
    emptyTargetShown = true;
    return true;
  });
}

function findProposalProgressiveMarker(
  root: Element,
  quizRoot: Element,
  host: Element
): Element | null {
  const selector = "span[data-lia-kachelfolge-mode='progressive']";
  let current: Element | null = root;
  while (current && (current === host || host.contains(current))) {
    const markers = current.matches(selector)
      ? [current]
      : Array.from(current.querySelectorAll(selector));
    const quizzes = current.matches(QUIZ_SELECTOR)
      ? [current]
      : Array.from(current.querySelectorAll(QUIZ_SELECTOR));
    if (markers.length === 1 && quizzes.length === 1 && quizzes[0] === quizRoot) {
      return markers[0];
    }
    if (current === host) break;
    current = current.parentElement;
  }
  return null;
}

function restoreSequentialVisibility(
  root: Element,
  quizRoot: Element,
  host: Element,
  targets: Element[]
): void {
  const legacyMode = root.matches("[data-kf-mode='seq']")
    ? root
    : root.querySelector("[data-kf-mode='seq']");
  if (legacyMode) {
    const filled = targets.filter(target => tileTargetValue(target).length > 0).length;
    const visible = Math.min(filled + 1, targets.length);
    targets.forEach((target, index) => {
      if (index < visible) target.setAttribute("data-kf-seq-visible", "1");
      else target.removeAttribute("data-kf-seq-visible");
    });
    const dummy = root.querySelector("[data-kf-seq-dummy='1']");
    if (dummy) {
      if (filled >= targets.length) dummy.setAttribute("data-kf-seq-visible", "1");
      else dummy.removeAttribute("data-kf-seq-visible");
    }
    return;
  }

  const proposalMarker = findProposalProgressiveMarker(root, quizRoot, host);
  if (!proposalMarker) return;
  const visible = progressiveTileVisibility(
    targets.map(target => tileTargetValue(target).length > 0)
  );
  targets.forEach((target, index) => {
    if (visible[index]) {
      target.setAttribute("data-lia-kachelfolge-visible", "true");
    } else {
      target.removeAttribute("data-lia-kachelfolge-visible");
    }
  });
}

function restoreTiles(
  quizRoot: Element,
  host: Element,
  states?: NativeDomTileState[]
): void {
  if (!states) return;
  const tileRoot = findTileTaskRoot(quizRoot, host);
  if (!tileRoot) return;
  const targets = tileTargets(tileRoot);
  const sources = tileSources(tileRoot);
  const usedSources = new Set<Element>();
  const placeholderTemplate = targets
    .map(target => target.firstElementChild)
    .find(child => !!child && tileTargetValue(child) === "") ?? undefined;

  states.forEach(state => {
    const target = findTileTarget(targets, state);
    if (!target) return;
    let source: Element | undefined;
    if (state.value) {
      if (state.sourceKey) {
        source = sources.find(candidate =>
          !usedSources.has(candidate)
          && handlerKey(candidate, TILE_SOURCE_ATTRIBUTES, true) === state.sourceKey
        );
      }
      source ??= sources.find(candidate =>
        !usedSources.has(candidate)
        && normalizeSpace(candidate.textContent || "") === normalizeSpace(state.value)
      );
      if (source) usedSources.add(source);
    }
    setTileTargetValue(target, state.value, source, placeholderTemplate);
  });

  sources.forEach(source => {
    const hidden = usedSources.has(source);
    if (source instanceof HTMLElement) {
      if (hidden) {
        source.style.setProperty("display", "none", "important");
        source.style.setProperty("pointer-events", "none", "important");
      } else {
        source.style.removeProperty("display");
        source.style.removeProperty("pointer-events");
      }
    }
    if (hidden) {
      source.setAttribute("aria-hidden", "true");
      source.setAttribute("draggable", "false");
    } else {
      source.removeAttribute("aria-hidden");
      if (hasHandler(source, TILE_SOURCE_ATTRIBUTES, TILE_SOURCE_HANDLER)) {
        source.setAttribute("draggable", "true");
      }
    }
  });
  restoreSequentialVisibility(tileRoot, quizRoot, host, targets);
}

function quizRootMatchesTask(
  root: Element,
  task: NativeDomTaskState,
  host: Element,
  allowLegacyShell = false
): boolean {
  const taskScope = findNativeDomTaskScope(root, host);
  const detected = quizKind(
    root,
    task.table,
    findTileTaskRoot(root, host),
    findDiktatTaskRoot(root, host),
    findMarkerTaskRoot(root, host),
    taskScope
  );
  if (detected === task.kind) return true;
  // Links created by the short-lived generic-shell fallback identified every
  // .lia-quiz-multi as text. Accept that only at its original authored index;
  // never let a fallback search attach it to a different specialized task.
  if (
    allowLegacyShell
    && root.classList.contains("lia-quiz-multi")
    && task.kind === "text"
  ) {
    return true;
  }
  return root.classList.contains("lia-quiz-text")
    && (task.kind === "text" || task.kind === "freeText");
}

export function restoreNativeDomForSlide(
  fallback: NativeDomFallbackV1 | undefined,
  hash: string,
  root: Element
): { applied: number; expected: number } {
  const tasks = fallback?.version === 1 ? fallback.slides?.[hash] : undefined;
  if (!Array.isArray(tasks) || !tasks.length) return { applied: 0, expected: 0 };

  const roots = Array.from(root.querySelectorAll(QUIZ_SELECTOR));
  const used = new Set<Element>();
  let applied = 0;

  tasks.forEach(task => {
    let quizRoot: Element | undefined = roots[task.taskIndex];
    if (
      !quizRoot
      || !quizRootMatchesTask(quizRoot, task, root, true)
      || used.has(quizRoot)
    ) {
      quizRoot = roots.find(candidate =>
        !used.has(candidate) && quizRootMatchesTask(candidate, task, root)
      );
    }
    if (!quizRoot) return;
    used.add(quizRoot);
    const taskScope = findNativeDomTaskScope(quizRoot, root);
    const controlRoot = task.kind === "diktat"
      ? findDiktatTaskRoot(quizRoot, root) ?? quizRoot
      : task.kind === "marker"
        ? findMarkerTaskRoot(quizRoot, root) ?? quizRoot
        : taskScope;
    restoreControls(controlRoot, task.controls);
    restoreSelection(taskScope, task.selection);
    restoreTiles(quizRoot, root, task.tiles);
    restoreOrthography(quizRoot, root, task.orthography);
    restoreFeedback(quizRoot, root, task.feedback);
    quizRoot.classList.remove("open", "solved", "resolved", "failed");
    const rootAppearance = normalizeNativeDomRootAppearance(
      task.outcome,
      task.rootAppearance
    );
    if (rootAppearance?.length) {
      addAppearance(quizRoot, rootAppearance);
    } else {
      if (
        task.outcome !== "correct"
        && task.outcome !== "resolved"
        && !(task.table === "survey" && task.submitted === 1)
      ) {
        quizRoot.classList.add("open");
      }
      if (task.outcome === "correct") quizRoot.classList.add("solved");
      if (task.outcome === "resolved") quizRoot.classList.add("resolved");
      if (task.outcome === "wrong") quizRoot.classList.add("failed");
    }
    applied += 1;
  });

  return { applied, expected: tasks.length };
}

export function toSyntheticQuizElements(
  tasks: NativeDomTaskState[]
): Array<SyntheticQuizElement | null> {
  const quizTasks = tasks
    .filter(task => task.table === "quiz")
    .sort((a, b) => a.nativeIndex - b.nativeIndex);
  if (!quizTasks.length) return [];
  const elements: Array<SyntheticQuizElement | null> = Array.from(
    { length: quizTasks[quizTasks.length - 1].nativeIndex + 1 },
    () => null
  );
  quizTasks.forEach(task => {
    if (task.outcome === "correct") {
      elements[task.nativeIndex] = { solved: 1, score: 1, trial: 1 };
    } else if (task.outcome === "resolved") {
      elements[task.nativeIndex] = { solved: -1, score: 0, trial: 1 };
    } else if (task.outcome === "wrong") {
      elements[task.nativeIndex] = { solved: 0, score: 0, trial: 1 };
    } else {
      elements[task.nativeIndex] = { solved: 0, score: 0, trial: 0 };
    }
  });
  return elements;
}
