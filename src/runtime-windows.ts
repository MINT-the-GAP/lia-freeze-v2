// Enumerate the current same-origin browsing-context tree.
//
// Template registries commonly live in the root viewer while their content
// event handlers live in a child frame. Starting with the current window and
// then walking the reachable root tree covers both without crossing origins.
export function sameOriginRuntimeWindows(start: Window = window): Window[] {
  const windows: Window[] = [];
  let current: Window | null = start;

  while (current && !windows.includes(current)) {
    windows.push(current);
    try {
      const parentWindow: Window = current.parent;
      if (!parentWindow || parentWindow === current) break;
      void parentWindow.document;
      current = parentWindow;
    } catch {
      break;
    }
  }

  const root = windows[windows.length - 1] ?? start;
  const traversed = new Set<Window>();
  const visit = (runtimeWindow: Window): void => {
    if (traversed.has(runtimeWindow)) return;
    traversed.add(runtimeWindow);
    if (!windows.includes(runtimeWindow)) windows.push(runtimeWindow);
    let frameCount = 0;
    try {
      void runtimeWindow.document;
      frameCount = runtimeWindow.frames.length;
    } catch {
      return;
    }
    for (let index = 0; index < frameCount; index++) {
      try {
        const child = runtimeWindow.frames[index];
        void child.document;
        visit(child);
      } catch { /* cross-origin child */ }
    }
  };
  visit(root);
  return windows;
}
