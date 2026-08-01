export type StyleDeclarationLike = Pick<
  CSSStyleDeclaration,
  | "getPropertyPriority"
  | "getPropertyValue"
  | "item"
  | "length"
  | "removeProperty"
  | "setProperty"
>;

function normalizePriority(priority: string): string {
  return priority.trim().toLowerCase();
}

export function setStylePropertyIfChanged(
  style: StyleDeclarationLike,
  property: string,
  value: string,
  priority = "",
): boolean {
  const nextPriority = normalizePriority(priority);
  if (
    style.getPropertyValue(property) === value
    && normalizePriority(style.getPropertyPriority(property)) === nextPriority
  ) {
    return false;
  }

  style.setProperty(property, value, nextPriority);
  return true;
}

function hasStyleProperty(style: StyleDeclarationLike, property: string): boolean {
  for (let index = 0; index < style.length; index += 1) {
    if (style.item(index) === property) return true;
  }
  return style.getPropertyValue(property) !== ""
    || style.getPropertyPriority(property) !== "";
}

export function removeStylePropertyIfPresent(
  style: StyleDeclarationLike,
  property: string,
): boolean {
  if (!hasStyleProperty(style, property)) return false;
  style.removeProperty(property);
  return true;
}

type MutationObserverLike = Pick<
  MutationObserver,
  "disconnect" | "observe" | "takeRecords"
>;

export type ThemeRefreshController = {
  request(): void;
  refreshNow(): void;
  cleanup(): void;
};

export type ThemeRefreshControllerOptions = {
  root: Element;
  refresh(): void;
  createObserver?(callback: MutationCallback): MutationObserverLike;
  requestFrame?(callback: FrameRequestCallback): number;
  cancelFrame?(handle: number): void;
};

const ROOT_THEME_OBSERVER_OPTIONS: MutationObserverInit = {
  attributes: true,
  attributeFilter: ["class", "style", "data-theme"],
};

export function createThemeRefreshController(
  options: ThemeRefreshControllerOptions,
): ThemeRefreshController {
  const createObserver = options.createObserver
    ?? (callback => new MutationObserver(callback));
  const requestFrame = options.requestFrame
    ?? (callback => window.requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame
    ?? (handle => window.cancelAnimationFrame(handle));

  let scheduledFrame: number | null = null;
  let refreshing = false;
  let refreshAgain = false;
  let cleanedUp = false;

  const observer = createObserver(() => request());

  function observe(): void {
    observer.observe(options.root, ROOT_THEME_OBSERVER_OPTIONS);
  }

  function runRefresh(): void {
    if (cleanedUp) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }

    refreshing = true;
    try {
      observer.disconnect();
      observer.takeRecords();
      options.refresh();
    } finally {
      try {
        observer.takeRecords();
        if (!cleanedUp) observe();
      } finally {
        refreshing = false;
        if (refreshAgain && !cleanedUp) {
          refreshAgain = false;
          request();
        }
      }
    }
  }

  function flushFrame(): void {
    scheduledFrame = null;
    runRefresh();
  }

  function request(): void {
    if (cleanedUp || scheduledFrame !== null) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    scheduledFrame = requestFrame(flushFrame);
  }

  function refreshNow(): void {
    if (cleanedUp) return;
    if (scheduledFrame !== null) {
      cancelFrame(scheduledFrame);
      scheduledFrame = null;
    }
    runRefresh();
  }

  function cleanup(): void {
    if (cleanedUp) return;
    cleanedUp = true;
    refreshAgain = false;
    if (scheduledFrame !== null) {
      cancelFrame(scheduledFrame);
      scheduledFrame = null;
    }
    observer.disconnect();
    observer.takeRecords();
  }

  observe();
  return { request, refreshNow, cleanup };
}

export type FreezeLifecycleState = {
  bootScheduled: boolean;
  themeRefresh?: ThemeRefreshController;
  themeRefreshCleanup?: () => void;
};

const FREEZE_LIFECYCLE_KEY = "__liaFreezeV2LifecycleV1__";

export function getFreezeLifecycleState(host: object): FreezeLifecycleState {
  const record = host as Record<string, unknown>;
  const existing = record[FREEZE_LIFECYCLE_KEY];
  if (existing && typeof existing === "object") {
    return existing as FreezeLifecycleState;
  }

  const state: FreezeLifecycleState = { bootScheduled: false };
  Object.defineProperty(host, FREEZE_LIFECYCLE_KEY, {
    configurable: true,
    value: state,
  });
  return state;
}

export function claimFreezeBoot(state: FreezeLifecycleState): boolean {
  if (state.bootScheduled) return false;
  state.bootScheduled = true;
  return true;
}
