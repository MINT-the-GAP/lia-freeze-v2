// Stable, serializable bridge for lia-orthography's public V8 state API.
//
// The template exposes its live in-memory objects. Freeze deliberately stores
// only the three user-visible fields needed for a deterministic shared link so
// internal config objects cannot leak into (or break) the payload.

export interface OrthographyFrozenState {
  liveValue: string | null;
  solved: boolean;
  tries: number;
}

export interface OrthographyRuntimeState {
  liveValue?: unknown;
  solved?: unknown;
  tries?: unknown;
  start?: unknown;
  solution?: unknown;
  [key: string]: unknown;
}

export interface OrthographyStateApi {
  getAllStates?(): Record<string, OrthographyRuntimeState>;
  setState?(uid: string, value: string): void;
}

function finiteTries(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function frozenValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function captureOrthographyStates(
  api: OrthographyStateApi | undefined
): Record<string, OrthographyFrozenState> {
  const result: Record<string, OrthographyFrozenState> = {};
  if (!api?.getAllStates) return result;

  const states = api.getAllStates();
  if (!states || typeof states !== "object") return result;

  for (const [uid, raw] of Object.entries(states)) {
    if (!uid || !raw || typeof raw !== "object") continue;
    result[uid] = {
      liveValue: frozenValue(raw.liveValue),
      solved: raw.solved === true || raw.solved === 1,
      tries: finiteTries(raw.tries),
    };
  }
  return result;
}

function savedValue(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return null;
  const state = raw as OrthographyRuntimeState;
  if (typeof state.liveValue === "string") return state.liveValue;
  if (typeof state.solution === "string" && state.solved === true) return state.solution;
  if (typeof state.start === "string") return state.start;
  return null;
}

/**
 * Applies current compact states and older raw V8 state objects.
 *
 * setState creates not-yet-rendered UIDs and performs the template's own DOM
 * synchronization. We then restore the public runtime object's attempt and
 * solved flags before asking the template to synchronize once more.
 */
export function restoreOrthographyStates(
  api: OrthographyStateApi | undefined,
  states: Record<string, unknown>
): boolean {
  if (!api?.setState || !states || typeof states !== "object") return false;

  for (const [uid, raw] of Object.entries(states)) {
    if (!uid) continue;
    const value = savedValue(raw);
    if (value === null) continue;

    api.setState(uid, value);

    const runtime = api.getAllStates?.()?.[uid];
    if (runtime && typeof runtime === "object" && raw && typeof raw === "object") {
      const saved = raw as OrthographyRuntimeState;
      runtime.liveValue = value;
      runtime.solved = saved.solved === true || saved.solved === 1;
      runtime.tries = finiteTries(saved.tries);
    }

    // This second call invokes lia-orthography's own syncUid after the flags
    // above have been restored (resolve gating, sticky solution, reset state).
    api.setState(uid, value);
  }
  return true;
}
