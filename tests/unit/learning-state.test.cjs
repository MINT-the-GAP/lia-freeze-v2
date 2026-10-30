const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = readFileSync(path.join(__dirname, '../../src/learning-state.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020,
} }).outputText;
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const context = () => ({ ready: true, grading: false, deferFeedback: false,
  courseUrl: 'https://example.test/course.md', courseVersion: '2.3.4',
  payload: { n: 'private', sec: { tab: 5 }, s: [{ h: '#2', quiz: { 1: [{ solved: 1 }] }, code: { private: true } }] },
  manualAwards: { '#2::task::1': '0,5' },
});

test('withholds payload and awards until review, including initialization and Send grading', async () => {
  const { readLearningSnapshot } = await modulePromise;
  for (const [updates, phase] of [
    [{ ready: false }, 'unavailable'], [{ grading: true }, 'grading'],
    [{ payload: null, deferFeedback: true }, 'collect'], [{ payload: null }, 'live'],
  ]) {
    const result = readLearningSnapshot({ ...context(), ...updates });
    assert.equal(result.phase, phase);
    assert.equal(result.payload, undefined);
    assert.equal(result.manualAwards, undefined);
  }
});

test('never assigns the current source version to a legacy frozen payload', async () => {
  const { resolveLearningCourseVersion } = await modulePromise;
  assert.equal(resolveLearningCourseVersion(false, undefined, '3.0.0'), '3.0.0');
  assert.equal(resolveLearningCourseVersion(true, '2.4.1', '3.0.0'), '2.4.1');
  assert.equal(resolveLearningCourseVersion(true, undefined, '3.0.0'), '');
});

test('review exposes detached results and current manual corrections without unrelated submission data', async () => {
  const { readLearningSnapshot } = await modulePromise;
  const input = context();
  const result = readLearningSnapshot(input);
  assert.equal(result.phase, 'review');
  assert.equal(result.courseVersion, '2.3.4');
  assert.equal(result.payload.n, undefined);
  assert.equal(result.payload.sec, undefined);
  assert.equal(result.payload.s[0].code, undefined);
  assert.equal(result.manualAwards['#2::task::1'], '0,5');
  result.payload.s[0].quiz[1][0].solved = 0;
  result.manualAwards['#2::task::1'] = '99';
  assert.equal(input.payload.s[0].quiz[1][0].solved, 1);
  assert.equal(input.manualAwards['#2::task::1'], '0,5');
});

test('installs once and reads current state without mutable API or event registration', async () => {
  const { installLearningStateReader } = await modulePromise;
  const target = {};
  const input = context();
  installLearningStateReader(target, () => input);
  const api = target.__liaFreezeLearningStateV1__;
  assert.ok(Object.isFrozen(api));
  assert.equal(Object.getOwnPropertyDescriptor(target, '__liaFreezeLearningStateV1__').writable, false);
  installLearningStateReader(target, () => { throw new Error('duplicate'); });
  assert.equal(target.__liaFreezeLearningStateV1__, api);
  assert.equal(api.read().phase, 'review');
  input.payload = null;
  input.deferFeedback = true;
  assert.equal(api.read().phase, 'collect');
});
