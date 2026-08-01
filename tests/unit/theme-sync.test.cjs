const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");

function loadTypeScriptModule(fileName) {
  const source = readFileSync(fileName, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ES2020,
    },
    fileName,
  }).outputText;
  const encoded = Buffer.from(compiled, "utf8").toString("base64");
  return import("data:text/javascript;base64," + encoded);
}

function fakeStyle(initial = {}) {
  const values = new Map(Object.entries(initial));
  const setCalls = [];
  const removeCalls = [];
  return {
    values,
    setCalls,
    removeCalls,
    get length() {
      return values.size;
    },
    item(index) {
      return Array.from(values.keys())[index] || "";
    },
    getPropertyValue(property) {
      return values.get(property)?.value || "";
    },
    getPropertyPriority(property) {
      return values.get(property)?.priority || "";
    },
    setProperty(property, value, priority = "") {
      setCalls.push({ property, value, priority });
      values.set(property, { value, priority });
    },
    removeProperty(property) {
      removeCalls.push(property);
      const previous = values.get(property)?.value || "";
      values.delete(property);
      return previous;
    },
  };
}

function fakeFrames() {
  let nextHandle = 1;
  const callbacks = new Map();
  const cancelled = [];
  return {
    callbacks,
    cancelled,
    request(callback) {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      cancelled.push(handle);
      callbacks.delete(handle);
    },
    flushNext() {
      const entry = callbacks.entries().next().value;
      if (!entry) return false;
      const [handle, callback] = entry;
      callbacks.delete(handle);
      callback(0);
      return true;
    },
  };
}

function fakeObserverFactory() {
  const state = {
    active: false,
    callback: null,
    observeCalls: [],
    disconnectCalls: 0,
    takeRecordsCalls: 0,
  };
  const api = {
    observe(root, options) {
      state.active = true;
      state.observeCalls.push({ root, options });
    },
    disconnect() {
      state.active = false;
      state.disconnectCalls += 1;
    },
    takeRecords() {
      state.takeRecordsCalls += 1;
      return [];
    },
  };
  return {
    state,
    api,
    create(callback) {
      state.callback = callback;
      return api;
    },
    emit() {
      if (state.active) state.callback([], api);
    },
    emitQueued() {
      state.callback([], api);
    },
  };
}

const repoRoot = path.resolve(__dirname, "..", "..");
const themeSyncPromise = loadTypeScriptModule(
  path.join(repoRoot, "src", "theme-sync.ts")
);

test("does not rewrite an unchanged CSS value and priority", async () => {
  const { setStylePropertyIfChanged } = await themeSyncPromise;
  const style = fakeStyle({
    "--lia-color": { value: "rgb(1, 2, 3)", priority: "important" },
  });

  assert.equal(
    setStylePropertyIfChanged(
      style,
      "--lia-color",
      "rgb(1, 2, 3)",
      " IMPORTANT "
    ),
    false
  );
  assert.equal(style.setCalls.length, 0);
});

test("writes a changed CSS value exactly once", async () => {
  const { setStylePropertyIfChanged } = await themeSyncPromise;
  const style = fakeStyle({
    "--lia-color": { value: "old", priority: "" },
  });

  assert.equal(
    setStylePropertyIfChanged(style, "--lia-color", "new"),
    true
  );
  assert.equal(
    setStylePropertyIfChanged(style, "--lia-color", "new"),
    false
  );
  assert.deepEqual(style.setCalls, [{
    property: "--lia-color",
    value: "new",
    priority: "",
  }]);
});

test("writes once when only the CSS priority changes", async () => {
  const { setStylePropertyIfChanged } = await themeSyncPromise;
  const style = fakeStyle({
    "--lia-color": { value: "same", priority: "" },
  });

  assert.equal(
    setStylePropertyIfChanged(style, "--lia-color", "same", "important"),
    true
  );
  assert.equal(style.setCalls.length, 1);
});

test("does not remove a missing CSS variable", async () => {
  const { removeStylePropertyIfPresent } = await themeSyncPromise;
  const style = fakeStyle();

  assert.equal(
    removeStylePropertyIfPresent(style, "--lia-missing"),
    false
  );
  assert.equal(style.removeCalls.length, 0);
});

test("removes a present empty CSS variable only once", async () => {
  const { removeStylePropertyIfPresent } = await themeSyncPromise;
  const style = fakeStyle({
    "--lia-empty": { value: "", priority: "" },
  });

  assert.equal(removeStylePropertyIfPresent(style, "--lia-empty"), true);
  assert.equal(removeStylePropertyIfPresent(style, "--lia-empty"), false);
  assert.deepEqual(style.removeCalls, ["--lia-empty"]);
});

test("coalesces mutation bursts and ignores writes made while refreshing", async () => {
  const { createThemeRefreshController } = await themeSyncPromise;
  const frames = fakeFrames();
  const observer = fakeObserverFactory();
  const root = {};
  let refreshCount = 0;
  const controller = createThemeRefreshController({
    root,
    refresh() {
      refreshCount += 1;
      observer.emit();
    },
    createObserver: callback => observer.create(callback),
    requestFrame: callback => frames.request(callback),
    cancelFrame: handle => frames.cancel(handle),
  });

  observer.emit();
  observer.emit();
  observer.emit();
  assert.equal(frames.callbacks.size, 1);
  assert.equal(frames.flushNext(), true);
  assert.equal(refreshCount, 1);
  assert.equal(frames.callbacks.size, 0);
  assert.equal(observer.state.disconnectCalls, 1);
  assert.equal(observer.state.takeRecordsCalls, 2);
  assert.equal(observer.state.observeCalls.length, 2);
  assert.deepEqual(observer.state.observeCalls[0].options, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  });

  observer.emit();
  assert.equal(frames.flushNext(), true);
  assert.equal(refreshCount, 2);
  controller.cleanup();
});

test("reconnects the observer when a refresh throws", async () => {
  const { createThemeRefreshController } = await themeSyncPromise;
  const frames = fakeFrames();
  const observer = fakeObserverFactory();
  let shouldThrow = true;
  let refreshCount = 0;
  const controller = createThemeRefreshController({
    root: {},
    refresh() {
      refreshCount += 1;
      if (shouldThrow) throw new Error("expected");
    },
    createObserver: callback => observer.create(callback),
    requestFrame: callback => frames.request(callback),
    cancelFrame: handle => frames.cancel(handle),
  });

  assert.throws(() => controller.refreshNow(), /expected/);
  assert.equal(observer.state.active, true);
  shouldThrow = false;
  observer.emit();
  assert.equal(frames.flushNext(), true);
  assert.equal(refreshCount, 2);
  controller.cleanup();
});

test("cleanup cancels pending work and disconnects the observer", async () => {
  const { createThemeRefreshController } = await themeSyncPromise;
  const frames = fakeFrames();
  const observer = fakeObserverFactory();
  let refreshCount = 0;
  const controller = createThemeRefreshController({
    root: {},
    refresh() {
      refreshCount += 1;
    },
    createObserver: callback => observer.create(callback),
    requestFrame: callback => frames.request(callback),
    cancelFrame: handle => frames.cancel(handle),
  });

  controller.request();
  assert.equal(frames.callbacks.size, 1);
  controller.cleanup();
  controller.cleanup();
  observer.emitQueued();

  assert.equal(frames.callbacks.size, 0);
  assert.equal(frames.cancelled.length, 1);
  assert.equal(observer.state.active, false);
  assert.equal(observer.state.disconnectCalls, 1);
  assert.equal(refreshCount, 0);
});

test("claims boot only once for repeated bundle evaluation", async () => {
  const { claimFreezeBoot, getFreezeLifecycleState } = await themeSyncPromise;
  const host = {};
  const first = getFreezeLifecycleState(host);
  const second = getFreezeLifecycleState(host);

  assert.strictEqual(first, second);
  assert.equal(claimFreezeBoot(first), true);
  assert.equal(claimFreezeBoot(second), false);
});
