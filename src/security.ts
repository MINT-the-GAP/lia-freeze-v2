// Tracks fraud signals: F12 (DevTools) opens and tab/window switches.
// Counts are stored in the snapshot payload's sec field.

// ── State ─────────────────────────────────────────────────────────────────────

const state = { f12: 0, tab: 0 };

let f12Installed = false;
let tabInstalled = false;
let devtoolsInstalled = false;

let lastF12Stamp = -1;
let lastF12KeyStamp = -1;
let lastTabStamp = -1;
let devtoolsOpen = false;
let tabArmed = false;
let tabBlurTimer = 0;

export function getSecurityState(): { f12: number; tab: number } {
  return { f12: state.f12, tab: state.tab };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isFrozen(): boolean {
  return !!(document.body?.classList.contains("lia-snapshot-mode"));
}

function getRootWin(): Window {
  let w: Window = window;
  try { while (w.parent && w.parent !== w) w = w.parent as Window; } catch (_) {}
  return w;
}

function skipDevtoolsHeuristic(): boolean {
  const platform = String(navigator.platform || "");
  const ua = String(navigator.userAgent || "");
  const touch = Number(navigator.maxTouchPoints || 0);
  const isIOS = /iPad|iPhone|iPod/.test(platform) || /iPad|iPhone|iPod/.test(ua);
  const isIPadOS = platform === "MacIntel" && touch > 1;
  return isIOS || isIPadOS;
}

function isLikelyDevtoolsOpen(): boolean {
  if (skipDevtoolsHeuristic()) return false;
  const wGap = Math.abs((window.outerWidth || 0) - (window.innerWidth || 0));
  const hGap = Math.abs((window.outerHeight || 0) - (window.innerHeight || 0));
  if (wGap > 170 || hGap > 170) return true;
  try {
    // @ts-ignore
    if (window.Firebug?.chrome?.isInitialized) return true;
  } catch (_) {}
  return false;
}

function isF12Key(e: KeyboardEvent): boolean {
  return e.key === "F12" || e.code === "F12" || (e.keyCode ?? (e as any).which) === 123;
}

function isTabActive(): boolean {
  let visible = true;
  let focused = true;
  try { visible = document.visibilityState !== "hidden"; } catch (_) {}
  try { focused = typeof document.hasFocus === "function" ? document.hasFocus() : true; } catch (_) {}
  return visible && focused;
}

// ── F12 counter ───────────────────────────────────────────────────────────────

function recordF12(type: string, ts: number): void {
  const COALESCE_MS = 1200;

  if (lastF12Stamp >= 0 && Math.abs(ts - lastF12Stamp) <= 40) return;

  if (type === "devtools-open") {
    if (lastF12KeyStamp >= 0 && ts >= lastF12KeyStamp && (ts - lastF12KeyStamp) <= COALESCE_MS) {
      lastF12Stamp = ts;
      return;
    }
  }

  lastF12Stamp = ts;
  state.f12 += 1;
}

// ── Tab counter ───────────────────────────────────────────────────────────────

function recordTab(ts: number): void {
  if (lastTabStamp >= 0 && Math.abs(ts - lastTabStamp) <= 500) return;
  lastTabStamp = ts;
  state.tab += 1;
}

function armTab(): void {
  if (isFrozen() || tabArmed || !isTabActive()) return;
  tabArmed = true;
}

function scheduleBlurProbe(): void {
  if (isFrozen() || !tabArmed) return;
  clearTimeout(tabBlurTimer);
  tabBlurTimer = window.setTimeout(() => {
    if (isFrozen() || !tabArmed) return;
    let hidden = false;
    let unfocused = false;
    try { hidden = document.visibilityState === "hidden"; } catch (_) {}
    try { unfocused = typeof document.hasFocus === "function" ? !document.hasFocus() : true; } catch (_) {}
    if (hidden || unfocused) recordTab(Date.now());
  }, 80);
}

// ── Install F12 tracking ──────────────────────────────────────────────────────

export function installF12Tracking(onTrigger?: () => void): void {
  if (f12Installed) return;
  f12Installed = true;

  function wrap(orig: () => void): () => void {
    return () => { orig(); onTrigger?.(); };
  }
  const trigger = wrap(() => {});

  const root = getRootWin();
  const targets = Array.from(new Set([window, document, document.documentElement, document.body, root, root.document].filter(Boolean)));

  targets.forEach((t: any) => {
    if (!t?.addEventListener) return;
    t.addEventListener("keydown", (e: KeyboardEvent) => {
      if (isFrozen()) return;
      if (!isF12Key(e) || e.repeat) return;
      const ts = Math.round(e.timeStamp || Date.now());
      lastF12KeyStamp = ts;
      recordF12("keydown", ts);
      onTrigger?.();
    }, true);
  });

  // Devtools size heuristic
  if (!devtoolsInstalled && !skipDevtoolsHeuristic()) {
    devtoolsInstalled = true;
    devtoolsOpen = isLikelyDevtoolsOpen();

    if (devtoolsOpen && !isFrozen()) {
      recordF12("devtools-open-initial", Date.now());
      onTrigger?.();
    }

    function probe(): void {
      if (isFrozen()) return;
      const nowOpen = isLikelyDevtoolsOpen();
      if (nowOpen && !devtoolsOpen) {
        recordF12("devtools-open", Date.now());
        onTrigger?.();
      }
      devtoolsOpen = nowOpen;
    }

    window.addEventListener("resize", () => setTimeout(probe, 60), true);
    window.addEventListener("focus",  () => setTimeout(probe, 60), true);
    window.setInterval(probe, 700);
  }

  void trigger; // suppress unused warning
}

// ── Install tab tracking ──────────────────────────────────────────────────────

export function installTabTracking(onTrigger?: () => void): void {
  if (tabInstalled) return;
  tabInstalled = true;

  const root = getRootWin();
  const wins = Array.from(new Set([window, root].filter(Boolean)));
  const docs = Array.from(new Set([document, root.document].filter(Boolean)));

  docs.forEach((d: any) => {
    if (!d?.addEventListener) return;
    d.addEventListener("visibilitychange", (e: Event) => {
      if (isFrozen()) return;
      const doc = (e.currentTarget && "visibilityState" in (e.currentTarget as Document))
        ? (e.currentTarget as Document)
        : document;
      if (doc.visibilityState === "visible") { armTab(); return; }
      if (doc.visibilityState === "hidden" && tabArmed) { recordTab(Date.now()); onTrigger?.(); }
    }, true);
  });

  wins.forEach((w: any) => {
    if (!w?.addEventListener) return;
    w.addEventListener("focus",    () => armTab(), true);
    w.addEventListener("pageshow", () => armTab(), true);
    w.addEventListener("blur",     () => scheduleBlurProbe(), true);
  });

  setTimeout(() => armTab(), 250);
}
