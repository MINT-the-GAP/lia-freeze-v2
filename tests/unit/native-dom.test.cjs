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
function withNativeControls(markup, run) {
  const { document, window } = parseHTML(`<html><body><main>${markup}</main></body></html>`);
  const names = ['document', 'Element', 'HTMLElement', 'HTMLInputElement',
    'HTMLTextAreaElement', 'HTMLSelectElement', 'Event'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true,
      value: name === 'document' ? document : window[name] });
  }
  try {
    return run(document, window);
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('synchronizes native choices and free text once so a model redraw retains the frozen answers', async () => {
  const { restoreNativeDomForSlide } = await nativeDomPromise;
  const checks = '<button class="lia-quiz__check">Check</button>';
  withNativeControls(`
    <div id="single" class="lia-quiz lia-quiz-single-choice">
      <input type="radio"><input type="radio"><input type="radio">${checks}
    </div>
    <div id="multiple" class="lia-quiz lia-quiz-multiple-choice">
      <input type="checkbox"><input type="checkbox">${checks}
    </div>
    <div id="matrix" class="lia-quiz lia-quiz-matrix">
      <input type="radio"><input type="radio"><input type="radio"><input type="radio">${checks}
    </div>
    <div id="free" class="lia-quiz lia-quiz-text">
      <textarea class="lia-quiz__input"></textarea>${checks}
    </div>
  `, (document, window) => {
    const host = document.querySelector('main');
    const single = [...document.querySelectorAll('#single input')];
    const multiple = [...document.querySelectorAll('#multiple input')];
    const matrix = [...document.querySelectorAll('#matrix input')];
    const free = document.querySelector('textarea');
    const model = { single: 2, multiple: [true, false], matrix: [1, 1], free: '' };
    const events = [];
    let checkCount = 0;
    for (const button of document.querySelectorAll('.lia-quiz__check')) {
      button.addEventListener('click', () => { checkCount += 1; });
    }
    const observe = (control, type, apply) => control.addEventListener(type, event => {
      assert.equal(event.__liaFreezeRestore, true);
      assert.strictEqual(event.constructor, window.Event, 'plain events have no native click activation');
      events.push([control, type]);
      apply();
    });
    single.forEach((control, index) => observe(control, 'click', () => {
      model.single = model.single === index ? -1 : index;
    }));
    multiple.forEach((control, index) => observe(control, 'click', () => {
      model.multiple[index] = !model.multiple[index];
    }));
    matrix.forEach((control, index) => observe(control, 'click', () => {
      const row = Math.floor(index / 2);
      const column = index % 2;
      model.matrix[row] = model.matrix[row] === column ? -1 : column;
    }));
    observe(free, 'input', () => { model.free = free.value; });
    const renderModel = () => {
      single.forEach((control, index) => { control.checked = model.single === index; });
      multiple.forEach((control, index) => { control.checked = model.multiple[index]; });
      matrix.forEach((control, index) => { control.checked = model.matrix[Math.floor(index / 2)] === index % 2; });
      free.value = model.free;
    };
    renderModel();
    for (const control of [...single, ...multiple, ...matrix]) {
      control.disabled = true;
      control.setAttribute('inert', '');
    }
    free.readOnly = true;
    const choice = (type, values) => values.map((checked, index) => ({ index, type, checked }));
    const tasks = [
      { ...task(0, 'wrong'), kind: 'single', controls: choice('radio', [1, 0, 0]) },
      { ...task(1, 'wrong'), kind: 'multiple', controls: choice('checkbox', [0, 1]) },
      { ...task(2, 'wrong'), kind: 'matrix', controls: choice('radio', [1, 0, 0, 0]) },
      { ...task(3, 'open', 'survey'), nativeIndex: 0,
        controls: [{ index: 0, type: 'textarea', value: 'Stored reflection' }] },
    ];
    const fallback = { version: 1, slides: { '#1': tasks } };
    assert.deepEqual(restoreNativeDomForSlide(fallback, '#1', host), { applied: 4, expected: 4 });
    assert.deepEqual(model, { single: 0, multiple: [false, true], matrix: [0, -1], free: 'Stored reflection' });
    const eventCount = events.length;
    assert.equal(eventCount, 8);
    renderModel(); // The next LiaScript resize redraw uses these model values.
    assert.equal(single[0].checked, true);
    assert.equal(multiple[1].checked, true);
    assert.equal(matrix[0].checked, true);
    assert.equal(free.value, 'Stored reflection');
    restoreNativeDomForSlide(fallback, '#1', host);
    restoreNativeDomForSlide(fallback, '#1', host);
    assert.equal(events.length, eventCount, 'repeated restore must not toggle matching choices');

    tasks[0].controls = choice('radio', [0, 0, 0]);
    tasks[2].controls = choice('radio', [0, 0, 0, 0]);
    restoreNativeDomForSlide(fallback, '#1', host);
    assert.equal(model.single, -1, 'an all-unchecked snapshot clears a previous selection');
    assert.deepEqual(model.matrix, [-1, -1]);
    const clearedCount = events.length;
    restoreNativeDomForSlide(fallback, '#1', host);
    assert.equal(events.length, clearedCount);
    assert.equal(checkCount, 0, 'restoration never performs an answer check');
    for (const control of [...single, ...multiple, ...matrix]) {
      assert.equal(control.disabled, true);
      assert.equal(control.hasAttribute('inert'), true);
    }
    assert.equal(free.readOnly, true);
  });
});

test('does not replay generic template inputs and preserves the dedicated Math bridge events', async () => {
  const { restoreNativeDomForSlide } = await nativeDomPromise;
  withNativeControls(`
    <div class="lia-quiz lia-quiz-generic"><input id="custom" type="text" class="lia-quiz__input"></div>
    <div class="lia-quiz lia-quiz-multi"><input id="math" type="text" class="lia-quiz__input" data-lia-math-quiz-native></div>
  `, document => {
    const host = document.querySelector('main');
    const custom = document.querySelector('#custom');
    const math = document.querySelector('#math');
    const events = [];
    for (const control of [custom, math]) {
      for (const type of ['click', 'input', 'change']) {
        control.addEventListener(type, event => events.push([control.id, type, event.__liaFreezeRestore]));
      }
    }
    restoreNativeDomForSlide({ version: 1, slides: { '#1': [
      { ...task(0, 'open'), kind: 'generic', controls: [{ index: 0, type: 'text', value: 'custom saved value' }] },
      { ...task(1, 'open'), controls: [{ index: 0, type: 'text', value: 'x + 1' }] },
    ] } }, '#1', host);
    assert.equal(custom.value, 'custom saved value');
    assert.equal(math.value, 'x + 1');
    assert.deepEqual(events, [['math', 'input', true], ['math', 'change', true]]);
  });
});
