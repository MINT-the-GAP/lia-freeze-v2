const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

function loadTypeScriptModule(fileName) {
  const source = readFileSync(fileName, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ES2020,
    },
    fileName,
  }).outputText;
  const encoded = Buffer.from(compiled, 'utf8').toString('base64');
  return import('data:text/javascript;base64,' + encoded);
}

const repoRoot = path.resolve(__dirname, '..', '..');
const nativeDomPromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'native-dom.ts'));

function task(nativeIndex, outcome, table = 'quiz') {
  return {
    taskIndex: nativeIndex,
    nativeIndex,
    table,
    kind: table === 'survey' ? 'freeText' : 'text',
    controls: [],
    touched: outcome === 'open' ? 0 : 1,
    outcome,
  };
}

function fakeElement(name, quiz = false) {
  return {
    name,
    quiz,
    parentElement: null,
    children: [],
    append(...children) {
      children.forEach(child => {
        child.parentElement = this;
        this.children.push(child);
      });
      return this;
    },
    contains(candidate) {
      let current = candidate;
      while (current) {
        if (current === this) return true;
        current = current.parentElement;
      }
      return false;
    },
    matches(selector) {
      return selector === '.lia-quiz' && this.quiz;
    },
    querySelectorAll(selector) {
      assert.equal(selector, '.lia-quiz');
      const output = [];
      const visit = element => {
        element.children.forEach(child => {
          if (child.quiz) output.push(child);
          visit(child);
        });
      };
      visit(this);
      return output;
    },
  };
}

test('classifies specialized template quizzes before generic LiaScript shells', async () => {
  const { classifyNativeDomKind } = await nativeDomPromise;
  const genericMultiShell = {
    generic: true,
    multi: true,
    tableHint: 'quiz',
    hasTextControl: true,
  };
  const specialized = [
    ['tile', 'tile'],
    ['diktat', 'diktat'],
    ['marker', 'marker'],
    ['fraction', 'fraction'],
    ['orthography', 'orthography'],
    ['selection', 'selection'],
  ];

  specialized.forEach(([signal, expected]) => {
    assert.equal(
      classifyNativeDomKind({ ...genericMultiShell, [signal]: true }),
      expected
    );
  });
  assert.equal(classifyNativeDomKind({ generic: true }), 'generic');
  assert.equal(
    classifyNativeDomKind({ multi: true, tableHint: 'quiz' }),
    'text'
  );
  assert.equal(
    classifyNativeDomKind({ text: true, tableHint: 'survey' }),
    'freeText'
  );
});

test('uses the nearest single-quiz wrapper instead of a shared flex host', async () => {
  const { findNativeDomTaskScope } = await nativeDomPromise;
  const host = fakeElement('host');
  const flexA = fakeElement('flex-a');
  const wrapperA = fakeElement('wrapper-a');
  const siblingInput = fakeElement('input-a');
  const quizA = fakeElement('quiz-a', true);
  const flexB = fakeElement('flex-b');
  const wrapperB = fakeElement('wrapper-b');
  const quizB = fakeElement('quiz-b', true);
  wrapperA.append(siblingInput, quizA);
  wrapperB.append(quizB);
  flexA.append(wrapperA);
  flexB.append(wrapperB);
  host.append(flexA, flexB);

  assert.strictEqual(findNativeDomTaskScope(quizA, host), wrapperA);

  const grouped = fakeElement('grouped');
  const quizC = fakeElement('quiz-c', true);
  const quizD = fakeElement('quiz-d', true);
  grouped.append(quizC, quizD);
  host.append(grouped);
  assert.strictEqual(
    findNativeDomTaskScope(quizC, host),
    quizC,
    'a scope shared with another quiz must never capture sibling controls'
  );
});

test('maps DOM outcomes to the existing evaluation element contract', async () => {
  const { toSyntheticQuizElements } = await nativeDomPromise;
  const elements = toSyntheticQuizElements([
    task(0, 'correct'),
    task(1, 'wrong'),
    task(2, 'resolved'),
    task(3, 'open'),
  ]);

  assert.deepEqual(elements, [
    { solved: 1, score: 1, trial: 1 },
    { solved: 0, score: 0, trial: 1 },
    { solved: -1, score: 0, trial: 1 },
    { solved: 0, score: 0, trial: 0 },
  ]);
});

test('keeps entered text when a solved inline quiz rerenders without controls', async () => {
  const { mergeNativeDomTaskSnapshots } = await nativeDomPromise;
  const beforeCheck = {
    ...task(0, 'open'),
    controls: [{ index: 0, type: 'text', value: 'Berlin' }],
    touched: 1,
  };
  const afterCheck = {
    ...task(0, 'correct'),
    controls: [],
    feedback: { text: 'Congratulations', hidden: 0 },
  };

  const [merged] = mergeNativeDomTaskSnapshots([beforeCheck], [afterCheck]);
  assert.deepEqual(merged.controls, beforeCheck.controls);
  assert.deepEqual(merged.feedback, afterCheck.feedback);
  assert.equal(merged.outcome, 'correct');
  assert.equal(merged.touched, 1);
});

test('does not downgrade a captured correct generic quiz to open', async () => {
  const { mergeNativeDomTaskSnapshots } = await nativeDomPromise;
  const solved = {
    ...task(0, 'correct'),
    kind: 'generic',
    feedback: { text: 'Correct', hidden: 0 },
    rootAppearance: ['solved'],
  };
  const remounted = {
    ...task(0, 'open'),
    kind: 'generic',
    feedback: { text: '', hidden: 0 },
    rootAppearance: ['open'],
  };
  const [merged] = mergeNativeDomTaskSnapshots([solved], [remounted]);
  assert.equal(merged.outcome, 'correct');
  assert.deepEqual(merged.rootAppearance, ['solved']);
  assert.deepEqual(merged.feedback, solved.feedback);
});

test('preserves a graded task while its quiz root is temporarily absent', async () => {
  const { mergeNativeDomTaskSnapshots } = await nativeDomPromise;
  const solved = {
    ...task(0, 'correct'),
    feedback: { text: 'Correct', hidden: 0 },
    rootAppearance: ['solved'],
  };
  const openSibling = {
    ...task(1, 'open'),
    controls: [{ index: 0, type: 'text', value: 'answer' }],
    touched: 1,
    rootAppearance: ['open'],
  };
  const merged = mergeNativeDomTaskSnapshots([solved, openSibling], [openSibling]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].outcome, 'correct');
  assert.deepEqual(merged[0].feedback, solved.feedback);
  assert.deepEqual(merged[0].rootAppearance, ['solved']);
});

test('keeps survey text out of automatic scoring', async () => {
  const { toSyntheticQuizElements } = await nativeDomPromise;
  assert.deepEqual(toSyntheticQuizElements([
    task(0, 'open', 'survey'),
    task(0, 'correct'),
  ]), [
    { solved: 1, score: 1, trial: 1 },
  ]);
});

test('orders synthetic elements by their native quiz index', async () => {
  const { toSyntheticQuizElements } = await nativeDomPromise;
  assert.deepEqual(toSyntheticQuizElements([
    task(2, 'resolved'),
    task(0, 'correct'),
    task(1, 'wrong'),
  ]).map(element => element.solved), [1, 0, -1]);
});

test('preserves native quiz indexes for tile-only evaluation overrides', async () => {
  const { toSyntheticQuizElements } = await nativeDomPromise;
  assert.deepEqual(toSyntheticQuizElements([
    task(3, 'correct'),
  ]), [
    null,
    null,
    null,
    { solved: 1, score: 1, trial: 1 },
  ]);
});

test('mirrors Proposal KachelfolgeN progressive visibility', async () => {
  const { progressiveTileVisibility } = await nativeDomPromise;

  assert.deepEqual(progressiveTileVisibility([false, false, false]), [
    true,
    false,
    false,
  ]);
  assert.deepEqual(progressiveTileVisibility([true, false, false]), [
    true,
    true,
    false,
  ]);
  assert.deepEqual(progressiveTileVisibility([false, true, false]), [
    true,
    true,
    false,
  ]);
  assert.deepEqual(progressiveTileVisibility([true, true, true]), [
    true,
    true,
    true,
  ]);
  assert.deepEqual(progressiveTileVisibility([false, false, false, true]), [
    true,
    false,
    false,
    true,
  ]);
});

test('identifies Proposal sources by native address instead of target id', async () => {
  const { tileSourceIdentity } = await nativeDomPromise;
  const bank =
    "message: { cmd: 'dragsource', param: {id: 2, value: [2, 0]}}";
  const placed =
    "message: { cmd: 'dragend', param: {id: 0, value: [2,0]}}";

  assert.equal(tileSourceIdentity(bank), "value:[2,0]");
  assert.equal(tileSourceIdentity(placed), "value:[2,0]");
});

test('routes missing native feedback to a sidecar without appending to the Elm quiz', async () => {
  const {
    configureNativeDomFeedbackRenderer,
    restoreNativeDomForSlide,
  } = await nativeDomPromise;
  const { document } = parseHTML(`
    <html><body><main>
      <div class="lia-quiz lia-quiz-multi open">
        <div class="lia-quiz__answers"></div>
        <div class="lia-quiz__control"><button class="lia-quiz__check">Check</button></div>
      </div>
    </main></body></html>
  `);
  const host = document.querySelector('main');
  const quiz = document.querySelector('.lia-quiz');
  const beforeChildren = Array.from(quiz.children);
  const rendered = [];
  configureNativeDomFeedbackRenderer((root, contentHost, feedback) => {
    rendered.push({ root, contentHost, feedback });
    return true;
  });

  const result = restoreNativeDomForSlide({
    version: 1,
    slides: {
      '#1': [{
        taskIndex: 0,
        nativeIndex: 0,
        table: 'quiz',
        kind: 'text',
        controls: [],
        touched: 1,
        outcome: 'correct',
        feedback: { text: 'Correct immediately', hidden: 0 },
      }],
    },
  }, '#1', host);

  assert.deepEqual(result, { applied: 1, expected: 1 });
  assert.deepEqual(Array.from(quiz.children), beforeChildren);
  assert.equal(quiz.querySelector('.lia-quiz__feedback'), null);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].root, quiz);
  assert.equal(rendered[0].contentHost, host);
  assert.deepEqual(rendered[0].feedback, {
    text: 'Correct immediately',
    hidden: false,
    appearance: undefined,
  });

  configureNativeDomFeedbackRenderer(null);
});
