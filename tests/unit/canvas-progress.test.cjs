const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

const fileName = path.resolve(__dirname, '..', '..', 'src', 'canvas-progress.ts');
const compiled = ts.transpileModule(readFileSync(fileName, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
  fileName,
}).outputText;
const schedulerPromise = import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

async function setup() {
  const { createCanvasProgressScheduler } = await schedulerPromise;
  let now = 0;
  let nextID = 0;
  let frozen = false;
  const timers = new Map();
  const allCallbacks = [];
  const captures = [];
  const scheduler = createCanvasProgressScheduler({
    capture: options => captures.push(options),
    isFrozen: () => frozen,
    setTimeout: (callback, delay) => {
      const id = nextID++;
      timers.set(id, { callback, at: now + delay });
      allCallbacks.push(callback);
      return id;
    },
    clearTimeout: id => timers.delete(id),
  });
  return {
    scheduler, captures, allCallbacks,
    setFrozen(value) { frozen = value; },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...timers].sort((left, right) => left[1].at - right[1].at)[0];
        if (!next || next[1].at > target) break;
        const [id, timer] = next;
        now = timer.at;
        timers.delete(id);
        timer.callback();
      }
      now = target;
    },
  };
}

test('pointerup, click and delayed canvas-change coalesce into one trailing capture', async () => {
  const { scheduler, captures, advance } = await setup();
  const pointer = {};
  scheduler.begin(pointer);
  scheduler.end(pointer, '3_1');
  scheduler.schedule('3_1');
  advance(120);
  scheduler.schedule('3_1', true);
  advance(159);
  assert.equal(captures.length, 0);
  advance(1);
  assert.equal(captures.length, 1);
  assert.deepEqual([...captures[0].dirtyUIDs], ['3_1']);
  assert.deepEqual([...captures[0].acceptEmptyUIDs], ['3_1']);
  advance(500);
  assert.equal(captures.length, 1);
});

test('a new stroke postpones a pending capture until it ends', async () => {
  const { scheduler, captures, advance, allCallbacks } = await setup();
  scheduler.schedule('3_1', true);
  advance(100);
  const staleCallback = allCallbacks[0];
  const pointer = {};
  scheduler.begin(pointer);
  staleCallback();
  scheduler.schedule('3_2');
  advance(1_000);
  assert.equal(captures.length, 0);
  assert.equal(scheduler.flush(), false);
  scheduler.end(pointer, '3_2');
  advance(160);
  assert.equal(captures.length, 1);
  assert.deepEqual([...captures[0].dirtyUIDs], ['3_1', '3_2']);
  assert.deepEqual([...captures[0].acceptEmptyUIDs], ['3_1']);
});

test('independent pointer objects in several windows prevent capture until all finish', async () => {
  const { scheduler, captures, advance } = await setup();
  const firstWindow = {};
  const secondWindow = {};
  const firstPointer = { pointerId: 1 };
  const secondPointer = { pointerId: 1 };
  scheduler.begin(firstPointer, firstWindow);
  scheduler.begin(secondPointer, secondWindow);
  scheduler.end(firstPointer, '3_1');
  advance(500);
  assert.equal(captures.length, 0);
  scheduler.schedule('3_2', true);
  scheduler.cancelPointers(firstWindow);
  advance(500);
  assert.equal(captures.length, 0);
  scheduler.cancelPointers(secondWindow);
  advance(160);
  assert.equal(captures.length, 1);
  assert.deepEqual([...captures[0].dirtyUIDs], ['3_1', '3_2']);
});

test('clear resets pointers and queue, and stale callbacks cannot consume new work', async () => {
  const { scheduler, captures, advance, allCallbacks } = await setup();
  scheduler.schedule('old', true);
  const oldCallback = allCallbacks[0];
  scheduler.begin({});
  scheduler.clear();
  scheduler.schedule('new');
  oldCallback();
  assert.equal(captures.length, 0);
  advance(160);
  assert.equal(captures.length, 1);
  assert.deepEqual([...captures[0].dirtyUIDs], ['new']);
  assert.deepEqual([...captures[0].acceptEmptyUIDs], []);
});

test('flush consumes pending options synchronously and invalidates its old timer', async () => {
  const { scheduler, captures, advance, allCallbacks } = await setup();
  scheduler.schedule('erased', true);
  scheduler.schedule('drawn');
  const oldCallback = allCallbacks.at(-1);
  assert.equal(scheduler.flush(), true);
  assert.equal(captures.length, 1);
  assert.deepEqual([...captures[0].dirtyUIDs], ['erased', 'drawn']);
  assert.deepEqual([...captures[0].acceptEmptyUIDs], ['erased']);
  scheduler.schedule('later');
  oldCallback();
  assert.equal(captures.length, 1);
  advance(160);
  assert.deepEqual([...captures[1].dirtyUIDs], ['later']);
  assert.deepEqual([...captures[1].acceptEmptyUIDs], []);
  assert.equal(scheduler.flush(), false);
});

test('frozen capture is suppressed and does not leak queued empty-state permissions', async () => {
  const { scheduler, captures, advance, setFrozen } = await setup();
  scheduler.schedule('frozen', true);
  setFrozen(true);
  advance(160);
  assert.equal(captures.length, 0);
  setFrozen(false);
  scheduler.schedule('live');
  scheduler.flush();
  assert.equal(captures.length, 1);
  assert.deepEqual([...captures[0].dirtyUIDs], ['live']);
  assert.deepEqual([...captures[0].acceptEmptyUIDs], []);
});

test('cancelled pointers resume pending work and unrelated pointer ends do not capture', async () => {
  const { scheduler, captures, advance } = await setup();
  const pointer = {};
  scheduler.end({});
  advance(160);
  assert.equal(captures.length, 0);
  scheduler.begin(pointer);
  scheduler.schedule('3_1');
  scheduler.cancelPointers();
  advance(160);
  assert.equal(captures.length, 1);
});