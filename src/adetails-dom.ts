// @ADetails DOM integration.
//
// LiaScript owns the light-DOM children below `.lia-quiz`, in particular the
// `.lia-quiz__control` button row.  Freeze therefore renders all of its quiz
// sidecar UI in the shadow root of the declarative `[data-adetails]` marker
// which follows the corresponding quiz in the authored course.

export type AssignmentDetailsSpec = {
  raw: string;
  badge: string;
  pointsValue: number | null;
  pointsParts: number[];
  tags: string[];
};

export type AssignmentDetailAwardAdapter = {
  getHash(): string;
  getDefaultAward(hash: string, taskIndex: number, maximum: number): number;
  getValue(key: string): string | undefined;
  setValue(key: string, value: string): void;
  onChange(): void;
};

export type AssignmentDetailRefreshOptions = {
  award?: AssignmentDetailAwardAdapter | null;
};

export type AssignmentDetailFeedback = {
  text: string;
  hidden: boolean;
  appearance?: string[];
};

type AssignmentDetailSidecar = {
  marker: HTMLElement;
  shadow: ShadowRoot;
  root: HTMLElement;
  badge: HTMLSpanElement;
  status: HTMLDivElement;
  feedback: HTMLDivElement;
  ownerId: string;
  quizRoot: Element | null;
  awardInput: HTMLInputElement | null;
  awardKey: string;
  disposeAwardInput: (() => void) | null;
};

type AssignmentDetailObserverState = {
  observer: MutationObserver;
  refresh: () => void;
  pending: boolean;
  timer: number | null;
  pageHide: EventListener | null;
};

type GenericQuizSidecar = {
  quizRoot: Element;
  contentHost: Element;
  entry: HTMLDivElement;
  status: HTMLDivElement;
  feedback: HTMLDivElement;
};

type GenericQuizSidecarPortal = {
  host: HTMLElement;
  shadow: ShadowRoot;
  root: HTMLDivElement;
  entries: Map<Element, GenericQuizSidecar>;
};

const ADETAILS_MARKER_SELECTOR = ".lia-assignment-details[data-adetails]";
const ADETAILS_SIDECAR_ATTR = "data-lia-freeze-adetails-sidecar";
const ADETAILS_SHADOW_STYLE_ATTR = "data-lia-freeze-adetails-style";
const GENERIC_SIDECAR_HOST_ATTR = "data-lia-freeze-quiz-sidecars";
const sidecars = new Map<HTMLElement, AssignmentDetailSidecar>();
const observers = new WeakMap<Document, AssignmentDetailObserverState>();
const genericPortals = new WeakMap<Document, GenericQuizSidecarPortal>();

function normalizeSpace(value: string): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function formatAssignmentValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace(/\.0+$/, "");
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

export function parseAssignmentDetails(raw: string): AssignmentDetailsSpec {
  const txt = normalizeSpace(raw);
  let pointsValue: number | null = null;
  let pointsParts: number[] = [];
  const tags: string[] = [];
  const parts = txt.split(/\s*;\s*/).filter(Boolean);

  parts.forEach((part, index) => {
    const value = normalizeSpace(part);
    const tagKeyMatch = value.match(/^tags?\s*[:=]\s*(.+)$/i);
    if (tagKeyMatch) {
      tagKeyMatch[1].split(",").map(normalizeSpace).filter(Boolean).forEach(tag => {
        if (!tags.includes(tag)) tags.push(tag);
      });
      return;
    }

    const pointsKeyMatch = value.match(
      /^(?:points?|be|punkte?)\s*[:=]\s*([\d.,]+(?:\s*\|\s*[\d.,]+)*)$/i
    );
    if (pointsKeyMatch) {
      const parsed = parseAssignmentPointSpec(pointsKeyMatch[1]);
      if (parsed.total !== null && pointsValue === null) {
        pointsValue = parsed.total;
        pointsParts = parsed.parts;
      }
      return;
    }

    const numberWithUnit = value.match(
      /^([\d.,]+(?:\s*\|\s*[\d.,]+)*)\s*=\s*[A-Za-z%]+$/
    );
    if (numberWithUnit) {
      const parsed = parseAssignmentPointSpec(numberWithUnit[1]);
      if (parsed.total !== null && pointsValue === null) {
        pointsValue = parsed.total;
        pointsParts = parsed.parts;
      }
      return;
    }

    const bare = parseAssignmentPointSpec(value);
    if (bare.total !== null && pointsValue === null) {
      pointsValue = bare.total;
      pointsParts = bare.parts;
      return;
    }

    if (index >= 1 || parts.length === 1) {
      value.split(",").map(normalizeSpace).filter(Boolean).forEach(tag => {
        if (!tags.includes(tag)) tags.push(tag);
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

function assignmentDetailMarkers(host: ParentNode): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>(ADETAILS_MARKER_SELECTOR))
    .filter(marker => !marker.closest("#lia-freeze-bar,.lia-submit-box,#lia-print-slides"));
}

function lastQuizCheckBeforeMarker(
  marker: Element,
  contentHost: Element
): HTMLButtonElement | null {
  const localScope = marker.closest(".flex-child") ?? contentHost;
  const pickLatest = (scope: ParentNode): HTMLButtonElement | null => {
    const ordered = Array.from(
      scope.querySelectorAll<HTMLElement>(
        ".lia-quiz__check," + ADETAILS_MARKER_SELECTOR
      )
    );
    const markerIndex = ordered.indexOf(marker as HTMLElement);
    if (markerIndex < 0) return null;
    for (let index = markerIndex - 1; index >= 0; index -= 1) {
      const candidate = ordered[index];
      if (!candidate.matches(".lia-quiz__check")) continue;
      if (candidate.closest("#lia-freeze-bar,.lia-submit-box,#lia-print-slides")) continue;
      return candidate as HTMLButtonElement;
    }
    return null;
  };

  // A flex marker belongs only to its own flex child. Falling back to an
  // earlier sibling would bind a marker whose local quiz renders late to the
  // preceding task. Markers outside flex layouts use the content host itself.
  return pickLatest(localScope);
}

function taskIndexForQuiz(
  checkButton: HTMLButtonElement,
  contentHost: Element,
  marker: HTMLElement,
  markers: HTMLElement[]
): number {
  const roots = Array.from(contentHost.querySelectorAll<HTMLElement>(".lia-quiz"))
    .filter(root => !root.closest(
      "#lia-freeze-bar,.lia-submit-box,#lia-print-slides,.lia-annot-toolbar"
    ));
  const quizRoot = checkButton.closest<HTMLElement>(".lia-quiz");
  const index = quizRoot ? roots.indexOf(quizRoot) : -1;
  if (index >= 0) return index + 1;
  const markerIndex = markers.indexOf(marker);
  return markerIndex >= 0 ? markerIndex + 1 : 0;
}

function cleanOwnerPart(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function deterministicOwnerId(
  marker: HTMLElement,
  contentHost: Element,
  markers: HTMLElement[]
): string {
  const declared = cleanOwnerPart(marker.getAttribute("data-adetails-instance") || "");
  if (declared) return declared.startsWith("lia-adetails-")
    ? declared
    : "lia-adetails-" + declared;

  const hash = marker.ownerDocument.defaultView?.location?.hash.match(/^#(\d+)/)?.[1]
    ?? "slide";
  const index = Math.max(0, markers.indexOf(marker)) + 1;
  const scope = marker.closest(".flex-child");
  const scopeIndex = scope
    ? Array.from(contentHost.querySelectorAll(".flex-child")).indexOf(scope) + 1
    : 0;
  return "lia-adetails-" + cleanOwnerPart(hash)
    + (scopeIndex > 0 ? "-flex-" + scopeIndex : "")
    + "-" + index;
}

function createSidecarElement<K extends keyof HTMLElementTagNameMap>(
  marker: HTMLElement,
  tagName: K,
  className: string,
  part: string
): HTMLElementTagNameMap[K] {
  const element = marker.ownerDocument.createElement(tagName);
  element.className = className;
  element.setAttribute("part", part);
  return element;
}

function ensureSidecar(
  marker: HTMLElement,
  ownerId: string
): AssignmentDetailSidecar | null {
  const existing = sidecars.get(marker);
  if (existing) {
    existing.ownerId = ownerId;
    existing.root.setAttribute("data-adetails-owner", ownerId);
    existing.badge.setAttribute("data-adetails-owner", ownerId);
    return existing;
  }

  let shadow = marker.shadowRoot;
  try {
    shadow ??= marker.attachShadow({ mode: "open" });
  } catch {
    return null;
  }

  if (!shadow.querySelector("style[" + ADETAILS_SHADOW_STYLE_ATTR + "]")) {
    const style = marker.ownerDocument.createElement("style");
    style.setAttribute(ADETAILS_SHADOW_STYLE_ATTR, "1");
    // Author-level ::part rules can otherwise override the user-agent rule for
    // `[hidden]`. Keep hidden sidecar parts out of layout inside our own tree.
    style.textContent = "[hidden]{display:none!important}";
    shadow.appendChild(style);
  }

  let root = shadow.querySelector<HTMLElement>("[" + ADETAILS_SIDECAR_ATTR + "]");
  if (!root) {
    root = createSidecarElement(marker, "span", "lia-adetails-sidecar", "sidecar");
    root.setAttribute(ADETAILS_SIDECAR_ATTR, "1");
    shadow.appendChild(root);
  }

  let badge = root.querySelector<HTMLSpanElement>(".lia-adetails-points");
  if (!badge) {
    badge = createSidecarElement(marker, "span", "lia-adetails-points", "points");
    badge.hidden = true;
    root.appendChild(badge);
  }

  let status = root.querySelector<HTMLDivElement>(".lia-send-status");
  if (!status) {
    status = createSidecarElement(marker, "div", "lia-send-status", "send-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    root.appendChild(status);
  }

  let feedback = root.querySelector<HTMLDivElement>(".lia-adetails-feedback");
  if (!feedback) {
    feedback = createSidecarElement(
      marker,
      "div",
      "lia-adetails-feedback lia-quiz__feedback",
      "feedback"
    );
    feedback.hidden = true;
    root.appendChild(feedback);
  }

  // Legacy Freeze versions declared the marker with an inline
  // `display:none !important`.  The marker is the plugin-owned boundary, so
  // changing its own presentation is safe; no Elm quiz node is touched.
  marker.style.setProperty("visibility", "visible", "important");
  root.setAttribute("data-adetails-owner", ownerId);
  badge.setAttribute("data-adetails-owner", ownerId);

  const state: AssignmentDetailSidecar = {
    marker,
    shadow,
    root,
    badge,
    status,
    feedback,
    ownerId,
    quizRoot: null,
    awardInput: null,
    awardKey: "",
    disposeAwardInput: null,
  };
  sidecars.set(marker, state);
  syncSidecarVisibility(state);
  return state;
}

function syncSidecarVisibility(state: AssignmentDetailSidecar): void {
  const visible = !state.badge.hidden || !state.status.hidden || !state.feedback.hidden;
  state.marker.style.setProperty("display", visible ? "inline-flex" : "none", "important");
}

function disposeAwardInput(state: AssignmentDetailSidecar): void {
  state.disposeAwardInput?.();
  state.disposeAwardInput = null;
  state.awardInput = null;
  state.awardKey = "";
}

function setPlainBadge(state: AssignmentDetailSidecar, text: string): void {
  if (state.awardInput) disposeAwardInput(state);
  if (state.badge.textContent !== text) state.badge.textContent = text;
  state.badge.hidden = !text;
  syncSidecarVisibility(state);
}

function clearTransientSidecarState(state: AssignmentDetailSidecar): void {
  state.status.textContent = "";
  state.status.hidden = true;
  state.feedback.className = "lia-adetails-feedback lia-quiz__feedback";
  state.feedback.textContent = "";
  state.feedback.hidden = true;
  state.root.removeAttribute("data-lia-send-logged");
  syncSidecarVisibility(state);
}

function ensureGenericPortal(
  targetDocument: Document
): GenericQuizSidecarPortal | null {
  const existing = genericPortals.get(targetDocument);
  if (existing?.host.isConnected) return existing;
  if (existing) genericPortals.delete(targetDocument);

  const body = targetDocument.body;
  if (!body) return null;
  const host = targetDocument.createElement("lia-freeze-quiz-sidecars");
  host.setAttribute(GENERIC_SIDECAR_HOST_ATTR, "1");
  host.setAttribute("aria-label", "Quiz status");

  let shadow: ShadowRoot;
  try {
    shadow = host.attachShadow({ mode: "open" });
  } catch {
    return null;
  }

  const style = targetDocument.createElement("style");
  style.textContent = `
:host {
  position: fixed;
  right: 1rem;
  bottom: 4.5rem;
  z-index: 99994;
  display: block;
  width: min(30rem, calc(100vw - 2rem));
  pointer-events: none;
  color: var(--lia-course-fg, currentColor);
  font: 600 .92rem/1.35 system-ui, sans-serif;
}
[hidden] { display: none !important; }
.lia-freeze-generic-sidecars { display: grid; gap: .4rem; }
.lia-freeze-generic-quiz-sidecar {
  padding: .5rem .65rem;
  border: 1px solid color-mix(in srgb, currentColor 24%, transparent);
  border-radius: .55rem;
  background: var(--lia-course-bg, Canvas);
  box-shadow: 0 .2rem .7rem rgba(0, 0, 0, .16);
}
.lia-freeze-generic-sidecar-label {
  display: block;
  margin-bottom: .16rem;
  font-size: .78rem;
  opacity: .72;
}
`;
  const root = targetDocument.createElement("div");
  root.className = "lia-freeze-generic-sidecars";
  shadow.append(style, root);
  body.appendChild(host);

  const portal: GenericQuizSidecarPortal = {
    host,
    shadow,
    root,
    entries: new Map(),
  };
  genericPortals.set(targetDocument, portal);
  return portal;
}

function removeGenericEntry(
  portal: GenericQuizSidecarPortal,
  state: GenericQuizSidecar
): void {
  state.entry.remove();
  portal.entries.delete(state.quizRoot);
  if (portal.entries.size) return;
  portal.host.remove();
  genericPortals.delete(portal.host.ownerDocument);
}

function cleanupGenericEntry(
  portal: GenericQuizSidecarPortal,
  state: GenericQuizSidecar
): void {
  if (!state.status.hidden || !state.feedback.hidden) return;
  removeGenericEntry(portal, state);
}

function ensureGenericEntry(
  quizRoot: Element,
  contentHost: Element
): { portal: GenericQuizSidecarPortal; state: GenericQuizSidecar } | null {
  const portal = ensureGenericPortal(quizRoot.ownerDocument);
  if (!portal) return null;
  const existing = portal.entries.get(quizRoot);
  if (existing) {
    existing.contentHost = contentHost;
    return { portal, state: existing };
  }

  const entry = quizRoot.ownerDocument.createElement("div");
  entry.className = "lia-freeze-generic-quiz-sidecar";
  entry.setAttribute("part", "quiz-sidecar");
  const roots = Array.from(contentHost.querySelectorAll(".lia-quiz"));
  const taskIndex = roots.indexOf(quizRoot);
  entry.setAttribute("data-lia-freeze-task-index", String(taskIndex + 1));

  const label = quizRoot.ownerDocument.createElement("span");
  label.className = "lia-freeze-generic-sidecar-label";
  label.textContent = taskIndex >= 0 ? "Task " + (taskIndex + 1) : "Quiz";
  const status = quizRoot.ownerDocument.createElement("div");
  status.className = "lia-send-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  const feedback = quizRoot.ownerDocument.createElement("div");
  feedback.className = "lia-adetails-feedback lia-quiz__feedback";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  feedback.hidden = true;
  entry.append(label, status, feedback);
  portal.root.appendChild(entry);

  const state: GenericQuizSidecar = {
    quizRoot,
    contentHost,
    entry,
    status,
    feedback,
  };
  portal.entries.set(quizRoot, state);
  return { portal, state };
}

function setGenericQuizStatus(
  quizRoot: Element,
  contentHost: Element,
  text: string | null
): boolean {
  const current = genericPortals.get(quizRoot.ownerDocument)?.entries.get(quizRoot);
  const ensured = text ? ensureGenericEntry(quizRoot, contentHost) : null;
  const portal = ensured?.portal ?? genericPortals.get(quizRoot.ownerDocument);
  const state = ensured?.state ?? current;
  if (!portal || !state) return !text;
  state.status.textContent = text || "";
  state.status.hidden = !text;
  cleanupGenericEntry(portal, state);
  return true;
}

function setGenericQuizFeedback(
  quizRoot: Element,
  contentHost: Element,
  feedback: AssignmentDetailFeedback | null
): boolean {
  const current = genericPortals.get(quizRoot.ownerDocument)?.entries.get(quizRoot);
  const ensured = feedback && !feedback.hidden
    ? ensureGenericEntry(quizRoot, contentHost)
    : null;
  const portal = ensured?.portal ?? genericPortals.get(quizRoot.ownerDocument);
  const state = ensured?.state ?? current;
  if (!portal || !state) return !feedback || feedback.hidden;
  state.feedback.className = "lia-adetails-feedback lia-quiz__feedback";
  feedback?.appearance?.forEach(name => {
    if (/^[A-Za-z0-9_-]+$/.test(name)) state.feedback.classList.add(name);
  });
  state.feedback.textContent = feedback?.text || "";
  state.feedback.hidden = !feedback || feedback.hidden;
  cleanupGenericEntry(portal, state);
  return true;
}

function clearGenericQuizStatuses(targetDocument: Document): void {
  const portal = genericPortals.get(targetDocument);
  if (!portal) return;
  Array.from(portal.entries.values()).forEach(state => {
    state.status.textContent = "";
    state.status.hidden = true;
    cleanupGenericEntry(portal, state);
  });
}

function sweepGenericPortal(targetDocument: Document): void {
  const portal = genericPortals.get(targetDocument);
  if (!portal) return;
  Array.from(portal.entries.values()).forEach(state => {
    if (
      !state.quizRoot.isConnected
      || !state.contentHost.isConnected
      || !state.contentHost.contains(state.quizRoot)
    ) {
      removeGenericEntry(portal, state);
    }
  });
}

function disposeGenericPortal(targetDocument: Document): void {
  const portal = genericPortals.get(targetDocument);
  if (!portal) return;
  portal.entries.clear();
  portal.host.remove();
  genericPortals.delete(targetDocument);
}

export function assignmentDetailAwardKey(hash: string, taskIndex: number): string {
  const cleanHash = /^#\d+$/.test(String(hash || "").trim())
    ? String(hash).trim()
    : "";
  return cleanHash && taskIndex > 0
    ? cleanHash + "::task::" + taskIndex
    : "";
}

function renderBadge(
  state: AssignmentDetailSidecar,
  spec: AssignmentDetailsSpec,
  taskIndex: number,
  options: AssignmentDetailRefreshOptions
): void {
  state.root.setAttribute("data-adetails-raw", spec.raw);
  state.root.setAttribute("data-adetails-badge", spec.badge);
  if (spec.pointsValue !== null) {
    state.root.setAttribute("data-adetails-points", String(spec.pointsValue));
  } else {
    state.root.removeAttribute("data-adetails-points");
  }
  if (spec.pointsParts.length) {
    state.root.setAttribute("data-adetails-point-parts", JSON.stringify(spec.pointsParts));
  } else {
    state.root.removeAttribute("data-adetails-point-parts");
  }
  if (spec.tags.length) {
    state.root.setAttribute("data-adetail-tags", JSON.stringify(spec.tags));
  } else {
    state.root.removeAttribute("data-adetail-tags");
  }

  const award = options.award;
  const sharedLink = state.marker.ownerDocument.body?.classList
    .contains("lia-shared-freeze-link") === true;
  const maximum = spec.pointsValue;
  if (!award || !sharedLink || maximum === null || maximum <= 0 || taskIndex <= 0) {
    setPlainBadge(state, spec.badge);
    return;
  }

  const hash = award.getHash();
  const key = assignmentDetailAwardKey(hash, taskIndex);
  if (!key) {
    setPlainBadge(state, spec.badge);
    return;
  }

  let input = state.awardInput;
  if (!input || state.awardKey !== key || !state.badge.contains(input)) {
    disposeAwardInput(state);
    state.badge.replaceChildren();

    input = createSidecarElement(
      state.marker,
      "input",
      "lia-adetails-award-input",
      "award-input"
    );
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.setAttribute("data-adetails-award-key", key);

    const separator = createSidecarElement(
      state.marker,
      "span",
      "lia-adetails-award-sep",
      "award-separator"
    );
    separator.textContent = "/";
    const total = createSidecarElement(
      state.marker,
      "span",
      "lia-adetails-award-total",
      "award-total"
    );
    total.textContent = spec.badge;
    state.badge.append(input, separator, total);

    const handleChange = () => {
      award.setValue(key, input?.value ?? "");
      award.onChange();
    };
    input.addEventListener("input", handleChange);
    input.addEventListener("change", handleChange);
    state.disposeAwardInput = () => {
      input?.removeEventListener("input", handleChange);
      input?.removeEventListener("change", handleChange);
    };
    state.awardInput = input;
    state.awardKey = key;
  }

  const total = state.badge.querySelector<HTMLElement>(".lia-adetails-award-total");
  if (total) total.textContent = spec.badge;
  input.setAttribute("aria-label", "Awarded points (maximum " + spec.badge + ")");
  const manualValue = award.getValue(key);
  const inputIsActive = state.marker.ownerDocument.activeElement === input
    || state.shadow.activeElement === input;
  if (!inputIsActive) {
    const automatic = award.getDefaultAward(hash, taskIndex, maximum);
    input.value = manualValue !== undefined
      ? manualValue
      : formatAssignmentValue(Math.max(0, Math.min(maximum, automatic)));
  }
  state.badge.hidden = false;
  syncSidecarVisibility(state);
}

function disposeSidecar(state: AssignmentDetailSidecar, clearShadow: boolean): void {
  disposeAwardInput(state);
  state.quizRoot = null;
  if (clearShadow) {
    try { state.root.remove(); } catch { /* detached host */ }
    state.marker.style.setProperty("display", "none", "important");
  }
  sidecars.delete(state.marker);
}

export function refreshAssignmentDetailSidecars(
  contentHost: Element,
  options: AssignmentDetailRefreshOptions = {}
): void {
  sweepGenericPortal(contentHost.ownerDocument);
  const markers = assignmentDetailMarkers(contentHost);
  const active = new Set(markers);

  sidecars.forEach(state => {
    if (
      state.marker.ownerDocument === contentHost.ownerDocument
      && (!state.marker.isConnected || !active.has(state.marker))
    ) {
      disposeSidecar(state, true);
    }
  });

  markers.forEach(marker => {
    const ownerId = deterministicOwnerId(marker, contentHost, markers);
    const state = ensureSidecar(marker, ownerId);
    if (!state) return;

    const spec = parseAssignmentDetails(marker.getAttribute("data-adetails") || "");
    const checkButton = lastQuizCheckBeforeMarker(marker, contentHost);
    const previousQuizRoot = state.quizRoot;
    state.quizRoot = checkButton?.closest(".lia-quiz") ?? null;
    if (!state.quizRoot || (previousQuizRoot && previousQuizRoot !== state.quizRoot)) {
      clearTransientSidecarState(state);
    }
    if (!checkButton || !spec.badge) {
      setPlainBadge(state, "");
      return;
    }
    renderBadge(
      state,
      spec,
      taskIndexForQuiz(checkButton, contentHost, marker, markers),
      options
    );
  });
}

export function getAssignmentDetailSidecar(marker: Element): {
  ownerId: string;
  shadow: ShadowRoot;
  badge: HTMLSpanElement;
  status: HTMLDivElement;
  feedback: HTMLDivElement;
  quizRoot: Element | null;
} | null {
  const state = sidecars.get(marker as HTMLElement);
  return state ? {
    ownerId: state.ownerId,
    shadow: state.shadow,
    badge: state.badge,
    status: state.status,
    feedback: state.feedback,
    quizRoot: state.quizRoot,
  } : null;
}

export function assignmentDetailMarkerForQuiz(
  quizRoot: Element,
  contentHost: Element
): HTMLElement | null {
  const markers = assignmentDetailMarkers(contentHost);
  return markers.find(marker => {
    const check = lastQuizCheckBeforeMarker(marker, contentHost);
    return check?.closest(".lia-quiz") === quizRoot;
  }) ?? null;
}

function sidecarForQuiz(
  quizRoot: Element,
  contentHost: Element
): AssignmentDetailSidecar | null {
  const marker = assignmentDetailMarkerForQuiz(quizRoot, contentHost);
  if (!marker) return null;
  const markers = assignmentDetailMarkers(contentHost);
  const ownerId = deterministicOwnerId(marker, contentHost, markers);
  const state = ensureSidecar(marker, ownerId);
  if (state) state.quizRoot = quizRoot;
  return state;
}

export function setAssignmentDetailSendStatus(
  quizRoot: Element,
  contentHost: Element,
  text: string | null
): boolean {
  const state = sidecarForQuiz(quizRoot, contentHost);
  if (!state) return setGenericQuizStatus(quizRoot, contentHost, text);
  setGenericQuizStatus(quizRoot, contentHost, null);
  state.status.textContent = text || "";
  state.status.hidden = !text;
  if (text) state.root.setAttribute("data-lia-send-logged", "1");
  else state.root.removeAttribute("data-lia-send-logged");
  syncSidecarVisibility(state);
  return true;
}

export function clearAssignmentDetailSendStatuses(targetDocument: Document): void {
  sidecars.forEach(state => {
    if (state.marker.ownerDocument !== targetDocument) return;
    state.status.textContent = "";
    state.status.hidden = true;
    state.root.removeAttribute("data-lia-send-logged");
    syncSidecarVisibility(state);
  });
  clearGenericQuizStatuses(targetDocument);
}

export function setAssignmentDetailFeedback(
  quizRoot: Element,
  contentHost: Element,
  feedback: AssignmentDetailFeedback | null
): boolean {
  const state = sidecarForQuiz(quizRoot, contentHost);
  if (!state) return setGenericQuizFeedback(quizRoot, contentHost, feedback);
  setGenericQuizFeedback(quizRoot, contentHost, null);
  state.feedback.className = "lia-adetails-feedback lia-quiz__feedback";
  feedback?.appearance?.forEach(name => {
    if (/^[A-Za-z0-9_-]+$/.test(name)) state.feedback.classList.add(name);
  });
  state.feedback.textContent = feedback?.text || "";
  state.feedback.hidden = !feedback || feedback.hidden;
  syncSidecarVisibility(state);
  return true;
}

function printableBadgeText(state: AssignmentDetailSidecar): string {
  if (state.badge.hidden) return "";
  const input = state.badge.querySelector<HTMLInputElement>(".lia-adetails-award-input");
  const total = state.badge.querySelector<HTMLElement>(".lia-adetails-award-total");
  return input
    ? normalizeSpace(input.value + " / " + (total?.textContent || ""))
    : normalizeSpace(state.badge.textContent || "");
}

export function materializeAssignmentDetailSidecarsForPrint(
  source: Element,
  clone: Element
): void {
  const sourceMarkers = assignmentDetailMarkers(source);
  const cloneMarkers = Array.from(
    clone.querySelectorAll<HTMLElement>(ADETAILS_MARKER_SELECTOR)
  );
  sourceMarkers.forEach((sourceMarker, index) => {
    const state = sidecars.get(sourceMarker);
    const cloneMarker = cloneMarkers[index];
    if (!state || !cloneMarker) return;

    const texts = [
      printableBadgeText(state),
      state.status.hidden ? "" : normalizeSpace(state.status.textContent || ""),
      state.feedback.hidden ? "" : normalizeSpace(state.feedback.textContent || ""),
    ].filter(Boolean);
    if (!texts.length) return;

    cloneMarker.style.setProperty("display", "inline-flex", "important");
    cloneMarker.style.setProperty("visibility", "visible", "important");
    const output = cloneMarker.ownerDocument.createElement("span");
    output.className = "lia-adetails-print-sidecar";
    output.textContent = texts.join(" · ");
    cloneMarker.appendChild(output);
  });

  // A course can use Send or restored native feedback without @ADetails.
  // Those live in a body-level portal and therefore are not part of `source`;
  // materialize them beside the matching quiz only in this detached clone.
  const portal = genericPortals.get(source.ownerDocument);
  if (!portal) return;
  const sourceQuizzes = Array.from(source.querySelectorAll<HTMLElement>(".lia-quiz"));
  const cloneQuizzes = Array.from(clone.querySelectorAll<HTMLElement>(".lia-quiz"));
  portal.entries.forEach(state => {
    const index = sourceQuizzes.indexOf(state.quizRoot as HTMLElement);
    const cloneQuiz = index >= 0 ? cloneQuizzes[index] : null;
    if (!cloneQuiz) return;
    const texts = [
      state.entry.querySelector(".lia-freeze-generic-sidecar-label")?.textContent || "",
      state.status.hidden ? "" : normalizeSpace(state.status.textContent || ""),
      state.feedback.hidden ? "" : normalizeSpace(state.feedback.textContent || ""),
    ].map(normalizeSpace).filter(Boolean);
    if (texts.length <= 1) return;
    const output = clone.ownerDocument.createElement("div");
    output.className = "lia-adetails-print-sidecar lia-freeze-generic-print-sidecar";
    output.textContent = texts.join(" · ");
    cloneQuiz.insertAdjacentElement("afterend", output);
  });
}

export function observeAssignmentDetailSidecars(
  targetDocument: Document,
  refresh: () => void
): () => void {
  const existing = observers.get(targetDocument);
  if (existing) {
    existing.refresh = refresh;
    return () => disconnectAssignmentDetailObserver(targetDocument);
  }
  const body = targetDocument.body;
  if (!body) return () => undefined;
  const Observer = targetDocument.defaultView?.MutationObserver ?? MutationObserver;
  const state: AssignmentDetailObserverState = {
    observer: null as unknown as MutationObserver,
    refresh,
    pending: false,
    timer: null,
    pageHide: null,
  };
  state.observer = new Observer(mutations => {
    if (!mutations.some(mutation => (
      mutation.type === "childList"
      || (mutation.type === "attributes" && mutation.attributeName === "data-adetails")
    ))) return;
    if (state.pending) return;
    state.pending = true;
    const schedule = targetDocument.defaultView?.setTimeout ?? setTimeout;
    state.timer = schedule(() => {
      state.timer = null;
      state.pending = false;
      state.refresh();
    }, 0);
  });
  state.observer.observe(body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-adetails"],
  });
  const runtimeWindow = targetDocument.defaultView;
  if (runtimeWindow) {
    state.pageHide = event => {
      // A persisted pagehide enters the back/forward cache. Keep the observer
      // and sidecar registry alive so pageshow can resume without a second
      // bookkeeping layer in freeze-ui.
      if ((event as PageTransitionEvent).persisted) return;
      disconnectAssignmentDetailObserver(targetDocument);
    };
    runtimeWindow.addEventListener("pagehide", state.pageHide);
  }
  observers.set(targetDocument, state);
  return () => disconnectAssignmentDetailObserver(targetDocument);
}

export function disconnectAssignmentDetailObserver(targetDocument: Document): void {
  const state = observers.get(targetDocument);
  if (state) {
    state.observer.disconnect();
    if (state.timer !== null) {
      const clear = targetDocument.defaultView?.clearTimeout ?? clearTimeout;
      clear(state.timer);
      state.timer = null;
    }
    if (state.pageHide) {
      targetDocument.defaultView?.removeEventListener("pagehide", state.pageHide);
    }
    observers.delete(targetDocument);
  }
  sidecars.forEach(sidecar => {
    if (sidecar.marker.ownerDocument === targetDocument) disposeSidecar(sidecar, true);
  });
  disposeGenericPortal(targetDocument);
}
