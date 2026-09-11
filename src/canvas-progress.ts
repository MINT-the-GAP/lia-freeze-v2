// Delay live progress capture until pointer handlers and asynchronous canvas
// change notifications have settled. The capture itself must remain cheap;
// delaying a raster export would still block the next stroke.

export interface CanvasProgressCaptureOptions {
  dirtyUIDs: ReadonlySet<string>;
  acceptEmptyUIDs: ReadonlySet<string>;
}

export interface CanvasProgressSchedulerOptions {
  capture(options: CanvasProgressCaptureOptions): void;
  isFrozen(): boolean;
  delayMs?: number;
  setTimeout?(callback: () => void, delay: number): unknown;
  clearTimeout?(timer: unknown): void;
}

export interface CanvasProgressScheduler {
  schedule(uid?: string, acceptEmptyChanges?: boolean): void;
  begin(pointer: object, scope?: object): void;
  end(pointer: object, uid?: string, acceptEmptyChanges?: boolean): void;
  cancelPointers(scope?: object): void;
  hasActivePointers(): boolean;
  flush(): boolean;
  clear(): void;
}

export function createCanvasProgressScheduler(
  options: CanvasProgressSchedulerOptions,
): CanvasProgressScheduler {
  const scheduleTimeout = options.setTimeout
    ?? ((callback: () => void, delay: number) => globalThis.setTimeout(callback, delay));
  const cancelTimeout = options.clearTimeout
    ?? ((timer: unknown) => globalThis.clearTimeout(timer as number));
  // Older OCR releases dispatch lia:canvas-change 120 ms after persist.
  const delayMs = options.delayMs ?? 160;
  const pointers = new Map<object, object | undefined>();
  const dirtyUIDs = new Set<string>();
  const acceptEmptyUIDs = new Set<string>();
  let pending = false;
  let timer: unknown;
  let timerScheduled = false;
  let generation = 0;

  function cancelTimer(): void {
    // A callback may already be queued when clearTimeout is called. Invalidate
    // it as well, so it cannot consume a newer queue after clear or begin.
    generation++;
    if (timerScheduled) cancelTimeout(timer);
    timerScheduled = false;
    timer = undefined;
  }

  function takePending(): CanvasProgressCaptureOptions {
    const queued = {
      dirtyUIDs: new Set(dirtyUIDs),
      acceptEmptyUIDs: new Set(acceptEmptyUIDs),
    };
    pending = false;
    dirtyUIDs.clear();
    acceptEmptyUIDs.clear();
    return queued;
  }

  function flush(): boolean {
    cancelTimer();
    if (!pending || pointers.size > 0) return false;
    const queued = takePending();
    if (options.isFrozen()) return false;
    options.capture(queued);
    return true;
  }

  function arm(): void {
    cancelTimer();
    if (!pending || pointers.size > 0) return;
    const expectedGeneration = generation;
    timerScheduled = true;
    timer = scheduleTimeout(() => {
      if (expectedGeneration !== generation) return;
      timerScheduled = false;
      timer = undefined;
      flush();
    }, delayMs);
  }

  function schedule(uid?: string, acceptEmptyChanges = false): void {
    pending = true;
    if (uid) {
      dirtyUIDs.add(uid);
      if (acceptEmptyChanges) acceptEmptyUIDs.add(uid);
    }
    arm();
  }

  return {
    schedule,
    begin(pointer, scope) {
      pointers.set(pointer, scope);
      cancelTimer();
    },
    end(pointer, uid, acceptEmptyChanges = false) {
      // Ignore unrelated pointerup events outside a canvas. Known pointers
      // still finish a queued capture even when their canvas was unmounted.
      if (!pointers.delete(pointer) && !uid) return;
      schedule(uid, acceptEmptyChanges);
    },
    cancelPointers(scope) {
      if (scope === undefined) pointers.clear();
      else {
        for (const [pointer, pointerScope] of pointers) {
          if (pointerScope === scope) pointers.delete(pointer);
        }
      }
      arm();
    },
    hasActivePointers() {
      return pointers.size > 0;
    },
    flush,
    clear() {
      cancelTimer();
      pointers.clear();
      takePending();
    },
  };
}