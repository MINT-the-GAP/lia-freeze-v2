// Compact, validated bridge for lia-marker's root-window registry.
//
// main / Proposals expose REG.setHighlights(), while the public 0.0.1 tag only
// exposes REG.instances.  Freeze therefore records the concrete instance key
// and supports both restore paths without depending on layout rectangles alone.

export type MarkerHighlightKind = "user" | "solution" | "prefill";
export type MarkerHighlightColor =
  | "yellow"
  | "green"
  | "blue"
  | "pink"
  | "orange"
  | "red";

export interface MarkerHighlightItem {
  id: number;
  kind: MarkerHighlightKind;
  color: MarkerHighlightColor;
  anchor: { sp: string; so: number; ep: string; eo: number };
  rects: Array<{ x: number; y: number; w: number; h: number }>;
  scope: string;
  slide: string;
}

export interface MarkerInstance {
  __alive?: boolean;
  HL?: unknown[];
  nextId?: number;
  __prefillKeys?: Set<string>;
  state?: {
    active?: boolean;
    panelOpen?: boolean;
    tool?: unknown;
    color?: unknown;
  };
}

export interface MarkerRegistry {
  instances?: Record<string, MarkerInstance>;
  setHighlights?(highlights: unknown[]): void;
}

export interface MarkerFrozenInstanceV1 {
  k: string;
  h: MarkerHighlightItem[];
  n: number;
}

export interface MarkerFrozenStateV1 {
  v: 1;
  i: MarkerFrozenInstanceV1[];
}

const MAX_HIGHLIGHTS = 4096;
const MAX_RECTS_PER_HIGHLIGHT = 512;
const MAX_PATH_LENGTH = 8192;
const MAX_LABEL_LENGTH = 1024;
const KINDS = new Set<MarkerHighlightKind>(["user", "solution", "prefill"]);
const COLORS = new Set<MarkerHighlightColor>([
  "yellow",
  "green",
  "blue",
  "pink",
  "orange",
  "red",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeInteger(
  value: unknown,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const number = finiteNumber(value);
  return number !== null
    && Number.isSafeInteger(number)
    && number >= 0
    && number <= maximum
    ? number
    : fallback;
}

function safeString(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string"
    ? value.slice(0, maxLength)
    : fallback;
}

function sanitizeHighlight(value: unknown, fallbackId: number): MarkerHighlightItem | null {
  if (!isRecord(value) || !isRecord(value.anchor) || !Array.isArray(value.rects)) {
    return null;
  }

  const kind = value.kind as MarkerHighlightKind;
  const color = value.color as MarkerHighlightColor;
  if (!KINDS.has(kind) || !COLORS.has(color)) return null;

  const sp = safeString(value.anchor.sp, "", MAX_PATH_LENGTH);
  const ep = safeString(value.anchor.ep, "", MAX_PATH_LENGTH);
  const so = safeInteger(value.anchor.so, -1);
  const eo = safeInteger(value.anchor.eo, -1);
  const nodePath = /^\d+(?:\/\d+)*$/;
  if (!nodePath.test(sp) || !nodePath.test(ep) || so < 0 || eo < 0) return null;

  const rects = value.rects
    .slice(0, MAX_RECTS_PER_HIGHLIGHT)
    .map(rect => {
      if (!isRecord(rect)) return null;
      const x = finiteNumber(rect.x);
      const y = finiteNumber(rect.y);
      const w = finiteNumber(rect.w);
      const h = finiteNumber(rect.h);
      if (x === null || y === null || w === null || h === null || w < 0 || h < 0) {
        return null;
      }
      return { x, y, w, h };
    })
    .filter((rect): rect is { x: number; y: number; w: number; h: number } => !!rect);

  return {
    id: safeInteger(value.id, fallbackId, Number.MAX_SAFE_INTEGER - 1),
    kind,
    color,
    anchor: { sp, so, ep, eo },
    rects,
    scope: safeString(value.scope, "global", MAX_LABEL_LENGTH) || "global",
    slide: safeString(value.slide, "global", MAX_LABEL_LENGTH) || "global",
  };
}

export function sanitizeMarkerHighlights(value: unknown): MarkerHighlightItem[] {
  if (!Array.isArray(value)) return [];
  const highlights: MarkerHighlightItem[] = [];
  const usedIds = new Set<number>();
  let nextFallbackId = 1;

  value.slice(0, MAX_HIGHLIGHTS).forEach((raw, index) => {
    const item = sanitizeHighlight(raw, index + 1);
    if (!item) return;
    if (usedIds.has(item.id)) {
      while (usedIds.has(nextFallbackId)) nextFallbackId += 1;
      item.id = nextFallbackId;
    }
    usedIds.add(item.id);
    while (usedIds.has(nextFallbackId)) nextFallbackId += 1;
    highlights.push(item);
  });
  return highlights;
}

function nextMarkerId(highlights: MarkerHighlightItem[], requested?: unknown): number {
  const minimum = highlights.reduce((max, item) => Math.max(max, item.id + 1), 1);
  return Math.max(minimum, safeInteger(requested, minimum));
}

function compactCapturedHighlights(highlights: MarkerHighlightItem[]): MarkerHighlightItem[] {
  // rects are viewport/layout derivatives. Every supported lia-marker revision
  // recalculates them from the anchor during render, so omitting them keeps the
  // decentralized URL substantially smaller without losing authored state.
  return highlights.map(item => ({ ...item, rects: [] }));
}

function markerPrefillKeys(highlights: MarkerHighlightItem[]): Set<string> {
  return new Set(highlights
    .filter(item => item.kind === "prefill")
    .map(item =>
      "P|" + item.color
      + "|" + item.scope
      + "|" + item.slide
      + "|" + item.anchor.sp
      + "|" + item.anchor.so
      + "|" + item.anchor.ep
      + "|" + item.anchor.eo
    ));
}

function registryEntries(registry: MarkerRegistry): Array<[string, MarkerInstance]> {
  if (!registry.instances || typeof registry.instances !== "object") return [];
  return Object.entries(registry.instances).filter((entry): entry is [string, MarkerInstance] =>
    !!entry[1] && typeof entry[1] === "object"
  );
}

function stableMarkerDocumentKey(key: string): string {
  const separator = key.lastIndexOf("::");
  if (separator < 0) return key.replace(/#.*$/, "");
  const rawBase = key.slice(0, separator);
  const title = key.slice(separator + 2);
  let base = rawBase;
  try {
    const url = new URL(rawBase);
    url.hash = "";
    base = url.toString();
  } catch {
    base = rawBase.replace(/#.*$/, "");
  }
  return base + "::" + title;
}

function uniqueRegistries(registries: readonly (MarkerRegistry | undefined)[]): MarkerRegistry[] {
  const seen = new Set<MarkerRegistry>();
  return registries.filter((registry): registry is MarkerRegistry => {
    if (!registry || typeof registry !== "object" || seen.has(registry)) return false;
    seen.add(registry);
    return true;
  });
}

export function captureMarkerState(
  registries: readonly (MarkerRegistry | undefined)[]
): MarkerFrozenStateV1 {
  const instances: MarkerFrozenInstanceV1[] = [];

  uniqueRegistries(registries).forEach(registry => {
    const entries = registryEntries(registry);
    const live = entries.filter(([, instance]) => instance.__alive !== false);
    (live.length ? live : entries).forEach(([key, instance]) => {
      const highlights = compactCapturedHighlights(sanitizeMarkerHighlights(instance.HL));
      if (!highlights.length) return;
      instances.push({
        k: safeString(key, "", MAX_PATH_LENGTH),
        h: highlights,
        n: nextMarkerId(highlights, instance.nextId),
      });
    });
  });

  return { v: 1, i: instances };
}

export function normalizeMarkerState(value: unknown): MarkerFrozenStateV1 {
  // Links produced by the original Freeze implementation stored a raw array.
  if (Array.isArray(value)) {
    const highlights = sanitizeMarkerHighlights(value);
    return {
      v: 1,
      i: highlights.length
        ? [{ k: "", h: highlights, n: nextMarkerId(highlights) }]
        : [],
    };
  }

  if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.i)) {
    return { v: 1, i: [] };
  }

  const instances = value.i.slice(0, 64).map(raw => {
    if (!isRecord(raw)) return null;
    const highlights = sanitizeMarkerHighlights(raw.h);
    if (!highlights.length) return null;
    return {
      k: safeString(raw.k, "", MAX_PATH_LENGTH),
      h: highlights,
      n: nextMarkerId(highlights, raw.n),
    };
  }).filter((item): item is MarkerFrozenInstanceV1 => !!item);

  return { v: 1, i: instances };
}

export function restoreMarkerState(
  registries: readonly (MarkerRegistry | undefined)[],
  value: unknown
): boolean {
  const saved = normalizeMarkerState(value).i;
  if (!saved.length) return false;

  const targets: Array<{
    key: string;
    instance: MarkerInstance;
    registry: MarkerRegistry;
  }> = [];
  const seenInstances = new Set<MarkerInstance>();

  uniqueRegistries(registries).forEach(registry => {
    const entries = registryEntries(registry);
    const live = entries.filter(([, instance]) => instance.__alive !== false);
    (live.length ? live : entries).forEach(([key, instance]) => {
      if (seenInstances.has(instance)) return;
      seenInstances.add(instance);
      targets.push({ key, instance, registry });
    });
  });

  if (!targets.length) return false;

  const used = new Set<MarkerInstance>();
  let applied = 0;
  saved.forEach((snapshot, index) => {
    let target = snapshot.k
      ? targets.find(candidate => candidate.key === snapshot.k && !used.has(candidate.instance))
      : undefined;
    if (!target && snapshot.k) {
      const stableKey = stableMarkerDocumentKey(snapshot.k);
      const stableMatches = targets.filter(candidate =>
        !used.has(candidate.instance)
        && stableMarkerDocumentKey(candidate.key) === stableKey
      );
      if (stableMatches.length === 1) target = stableMatches[0];
    }
    if (!target && saved.length === 1) {
      target = [...targets].reverse().find(candidate => !used.has(candidate.instance));
    }
    if (!target) {
      target = targets[index] && !used.has(targets[index].instance)
        ? targets[index]
        : targets.find(candidate => !used.has(candidate.instance));
    }
    if (!target) return;

    const highlights = sanitizeMarkerHighlights(snapshot.h);
    target.instance.HL = highlights;
    target.instance.nextId = nextMarkerId(highlights, snapshot.n);
    target.instance.__prefillKeys = markerPrefillKeys(highlights);
    used.add(target.instance);
    applied += 1;

    const registryTargets = targets.filter(candidate => candidate.registry === target!.registry);
    if (
      saved.length === 1
      && registryTargets.length === 1
      && typeof target.registry.setHighlights === "function"
    ) {
      try {
        target.registry.setHighlights(sanitizeMarkerHighlights(highlights));
        target.instance.nextId = nextMarkerId(highlights, snapshot.n);
        target.instance.__prefillKeys = markerPrefillKeys(highlights);
      } catch {
        // The direct instance assignment above is the 0.0.1-compatible path.
      }
    }
  });

  return applied === saved.length;
}

export function deactivateMarkerRegistries(
  registries: readonly (MarkerRegistry | undefined)[]
): boolean {
  let found = false;
  uniqueRegistries(registries).forEach(registry => {
    registryEntries(registry).forEach(([, instance]) => {
      if (!instance.state || typeof instance.state !== "object") return;
      instance.state.active = false;
      instance.state.panelOpen = false;
      found = true;
    });
  });
  return found;
}
