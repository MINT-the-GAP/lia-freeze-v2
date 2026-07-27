/*
 * Focused real-Chromium regression for the four standalone @ADetails cases
 * that originally disappeared from the frozen evaluation:
 *
 *   #10 Geography=Berlin and Astronomy=Jupiter
 *   #14 OCR=3
 *   #15 Coordinates: A=(1,4)
 *
 * Start a fresh Chromium profile on README.md#10 and pass that page's CDP
 * websocket URL as the only argument.
 */

const endpoint = process.argv[2];
if (!endpoint) {
  console.error('Usage: node chromium-original-adetails-freeze-cdp.cjs <page-websocket-url>');
  process.exit(2);
}

const socket = new WebSocket(endpoint);
const pending = new Map();
let nextId = 1;

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP command timed out: ' + method));
    }, 90_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error('Chromium evaluation failed: ' + JSON.stringify(result.exceptionDetails));
  }
  return result.result?.value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (!('id' in message)) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result || {});
});

socket.addEventListener('error', error => {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
  pending.clear();
});

socket.addEventListener('open', async () => {
  try {
    await command('Runtime.enable');
    await command('Page.enable');
    await command('Page.bringToFront');

    const live = await evaluate(String.raw`(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitFor = async (description, predicate, attempts = 160) => {
        for (let attempt = 0; attempt < attempts; attempt++) {
          const value = predicate();
          if (value) return value;
          await pause(100);
        }
        throw new Error('Timed out waiting for ' + description + ' on ' + location.hash);
      };
      const click = element => {
        if (!(element instanceof HTMLElement)) throw new Error('Interactive element is missing');
        element.scrollIntoView({ block: 'center', inline: 'center' });
        element.click();
      };
      const inputValue = (element, value) => {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
          throw new Error('Expected a text input');
        }
        const prototype = element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (setter) setter.call(element, value);
        else element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const quizScope = quiz => quiz?.parentElement ?? quiz;
      const quizInput = quiz => quiz?.querySelector('.lia-quiz__input')
        ?? quizScope(quiz)?.querySelector('.lia-quiz__input');
      const evidence = quiz => ({
        className: quiz?.className || '',
        outcome: quiz?.getAttribute('data-lia-freeze-outcome') || '',
        feedback: quiz?.querySelector('.lia-quiz__feedback')?.textContent?.trim() || '',
        text: (quiz?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 260),
      });
      const isCorrect = quiz => /solved|success|correct|right answer/i.test(
        Object.values(evidence(quiz)).join(' ')
      );
      const visit = async (hash, ready) => {
        location.hash = hash;
        await waitFor(hash + ' navigation', () => location.hash === hash);
        await waitFor(hash + ' content', ready);
        await pause(350);
      };
      const checkQuiz = async quiz => {
        click(await waitFor('quiz check button', () => quiz.querySelector('.lia-quiz__check')));
        await waitFor('correct quiz outcome', () => isCorrect(quiz));
        await pause(180);
      };
      const solveTextQuiz = async (quiz, value) => {
        inputValue(quizInput(quiz), value);
        await pause(80);
        await checkQuiz(quiz);
      };
      const detailValues = () => Array.from(document.querySelectorAll('.lia-assignment-details'))
        .map(item => item.dataset.adetails || '');

      location.hash = '#28';
      const examStart = await waitFor('fresh-course exam start', () => document.querySelector('.lia-exam-start-btn'));
      const examName = document.querySelector('.lia-exam-name-input');
      if (examName) inputValue(examName, 'Original ADetails CDP');
      // Slow only the demo-exam wall clock so first-load template latency
      // cannot expire the authored 30-second example during this regression.
      const realDateNow = Date.now.bind(Date);
      const examClockStart = realDateNow();
      Date.now = () => examClockStart + Math.floor((realDateNow() - examClockStart) / 100);
      click(examStart);
      await pause(500);

      await visit('#10', () => document.querySelectorAll('.lia-quiz__input').length >= 2);
      const clozeQuizzes = Array.from(document.querySelectorAll('.lia-quiz'))
        .filter(quiz => quizInput(quiz));
      if (clozeQuizzes.length !== 2) {
        throw new Error('Expected exactly two standalone cloze quizzes on #10, got ' + clozeQuizzes.length);
      }
      const slide10Details = detailValues();
      if (!slide10Details.includes('1;Geography') || !slide10Details.includes('1;Astronomy')) {
        throw new Error('Standalone #10 @ADetails missing: ' + JSON.stringify(slide10Details));
      }
      await solveTextQuiz(clozeQuizzes[0], 'Berlin');
      await solveTextQuiz(clozeQuizzes[1], 'Jupiter');
      const geography = evidence(clozeQuizzes[0]);
      const astronomy = evidence(clozeQuizzes[1]);

      await visit('#14', () => document.querySelector('.lia-quiz__input'));
      const ocrQuiz = document.querySelector('.lia-quiz');
      const slide14Details = detailValues();
      if (!slide14Details.includes('1=BE;OCR')) {
        throw new Error('OCR @ADetails missing on #14: ' + JSON.stringify(slide14Details));
      }
      await solveTextQuiz(ocrQuiz, '3');
      const ocr = evidence(ocrQuiz);

      await visit('#15', () => window.__boards?.A1 && document.querySelector('.lia-quiz'));
      const coordinateQuiz = document.querySelector('.lia-quiz');
      const slide15Details = detailValues();
      if (!slide15Details.includes('1;Coordinates')) {
        throw new Error('Coordinates @ADetails missing on #15: ' + JSON.stringify(slide15Details));
      }
      const createPoint = await waitFor('coordinate create-point button', () =>
        Array.from(document.querySelectorAll('button'))
          .find(button => /Punkt setzen|Set point/i.test(button.textContent || ''))
      );
      click(createPoint);
      await pause(180);
      const point = await waitFor('coordinate point A1/A', () => window.__points?.A1?.A);
      if (typeof point.moveTo !== 'function') throw new Error('Coordinate point A1/A has no moveTo API');
      point.moveTo([1, 4], 0);
      window.__boards?.A1?.update?.();
      window.__pointStates ??= {};
      window.__pointStates.A1 ??= {};
      const storedPoint = window.__pointStates.A1.A;
      if (storedPoint && typeof storedPoint === 'object') {
        storedPoint.x = 1;
        storedPoint.y = 4;
      }
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
      await pause(250);
      await checkQuiz(coordinateQuiz);
      const coordinates = {
        ...evidence(coordinateQuiz),
        x: Number(point.X?.()),
        y: Number(point.Y?.()),
      };

      location.hash = '#29';
      await pause(500);
      const createLink = await waitFor('submission controls', () => document.getElementById('lia-create-link'));
      const name = document.getElementById('lia-name');
      inputValue(name, 'Original ADetails CDP');
      click(createLink);
      const link = await waitFor('generated Freeze link', () => document.getElementById('lia-link')?.value || '');

      return {
        link,
        slideAtFreeze: location.hash,
        declarations: { slide10Details, slide14Details, slide15Details },
        tasks: { geography, astronomy, ocr, coordinates },
      };
    })()`);

    assert(live.link.includes('submission%3D'), 'Created URL has no encoded submission token');
    for (const [tag, task] of Object.entries(live.tasks)) {
      assert(/solved|success|correct|right answer/i.test(Object.values(task).join(' ')),
        'Live ' + tag + ' task was not correct: ' + JSON.stringify(task));
    }
    assert(Math.abs(live.tasks.coordinates.x - 1) < 1e-6 && Math.abs(live.tasks.coordinates.y - 4) < 1e-6,
      'Live coordinate point is not (1,4): ' + JSON.stringify(live.tasks.coordinates));

    await command('Page.navigate', { url: live.link });
    await delay(2500);

    const shared = await evaluate(String.raw`(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitFor = async (description, predicate, attempts = 180) => {
        for (let attempt = 0; attempt < attempts; attempt++) {
          const value = predicate();
          if (value) return value;
          await pause(100);
        }
        throw new Error('Timed out waiting for ' + description + ' on ' + location.hash);
      };
      await waitFor('shared Freeze mode', () => document.body.classList.contains('lia-shared-freeze-link'));

      const visit = async (hash, ready) => {
        location.hash = hash;
        await waitFor(hash + ' navigation', () => location.hash === hash);
        await waitFor(hash + ' restored content', ready);
        let stable = 0;
        for (let attempt = 0; attempt < 120 && stable < 8; attempt++) {
          stable = ready() ? stable + 1 : 0;
          await pause(100);
        }
        if (stable < 8) throw new Error(hash + ' did not become stable');
      };
      const outcome = quiz => ({
        className: quiz?.className || '',
        outcome: quiz?.getAttribute('data-lia-freeze-outcome') || '',
        feedback: quiz?.querySelector('.lia-quiz__feedback')?.textContent?.trim() || '',
        text: (quiz?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 260),
      });
      const controlState = control => {
        const style = getComputedStyle(control);
        const locked = control.disabled
          || control.getAttribute('data-lia-freeze-locked') === '1'
          || !!control.closest('[data-lia-freeze-locked="1"]')
          || style.display === 'none'
          || style.visibility === 'hidden'
          || style.pointerEvents === 'none';
        return {
          tag: control.tagName,
          type: control.type || '',
          value: control.value ?? '',
          disabled: !!control.disabled,
          freezeLocked: control.getAttribute('data-lia-freeze-locked') || '',
          display: style.display,
          pointerEvents: style.pointerEvents,
          locked,
        };
      };
      const quizScope = quiz => quiz?.parentElement ?? quiz;
      const quizInput = quiz => quiz?.querySelector('.lia-quiz__input')
        ?? quizScope(quiz)?.querySelector('.lia-quiz__input');
      const taskState = (quiz, details) => ({
        details,
        ...outcome(quiz),
        controls: Array.from(quizScope(quiz).querySelectorAll(
          '.lia-quiz__input,.lia-quiz__check,.lia-quiz__resolve,input[type="radio"],input[type="checkbox"]'
        )).map(controlState),
      });
      const details = () => Array.from(document.querySelectorAll('.lia-assignment-details'))
        .map(item => item.dataset.adetails || '');

      await visit('#10', () => document.querySelectorAll('.lia-quiz__input').length >= 2);
      const clozeQuizzes = Array.from(document.querySelectorAll('.lia-quiz'))
        .filter(quiz => quizInput(quiz));
      const geography = taskState(clozeQuizzes[0], details());
      const astronomy = taskState(clozeQuizzes[1], details());

      await visit('#14', () => document.querySelector('.lia-quiz__input')?.value === '3');
      const ocr = taskState(document.querySelector('.lia-quiz'), details());

      await visit('#15', () => window.__points?.A1?.A && document.querySelector('.lia-quiz'));
      const coordinateQuiz = document.querySelector('.lia-quiz');
      const point = window.__points.A1.A;
      const board = document.querySelector('.jxgbox');
      const coordinateControls = Array.from(document.querySelectorAll(
        '.lia-quiz .lia-quiz__check,.lia-quiz .lia-quiz__resolve,.lia-quiz input,button'
      )).filter(control => /Punkt setzen|Set point|check|solve|solution/i.test(
        (control.textContent || '') + ' ' + (control.className || '') + ' ' + (control.getAttribute('aria-label') || '')
      ));
      const coordinates = {
        ...taskState(coordinateQuiz, details()),
        x: Number(point.X?.()),
        y: Number(point.Y?.()),
        pointFixed: !!point.visProp?.fixed,
        boardPointerEvents: board ? getComputedStyle(board).pointerEvents : '',
        boardFreezeLocked: board?.getAttribute('data-lia-freeze-locked') || '',
        coordinateControls: coordinateControls.map(controlState),
      };

      const bodyClasses = document.body.className;
      document.getElementById('lia-freeze-last')?.click();
      const evaluation = await waitFor('visible evaluation', () => {
        const value = document.getElementById('lia-eval-placeholder');
        return value?.style.display === 'block' ? value : null;
      });
      const evaluationText = evaluation.innerText || '';
      const lines = evaluationText.split('\n').map(line => line.trim()).filter(Boolean);
      const tagChecks = ['Geography', 'Astronomy', 'OCR', 'Coordinates'].map(tag => {
        const offset = lines.indexOf(tag);
        const block = offset >= 0 ? lines.slice(offset, offset + 13).join(' ') : '';
        return {
          tag,
          found: offset >= 0,
          block,
          correct: /Correct\s+1(?:\.0+)?\b/i.test(block),
          wrong: /Wrong\s+0(?:\.0+)?\b/i.test(block),
          achieved: /Achieved\s+1(?:\.0+)?\s+of\s+1(?:\.0+)?\b/i.test(block),
          score: /Score\s+100\s*%/i.test(block),
        };
      });

      return {
        href: location.href,
        bodyClasses,
        tasks: { geography, astronomy, ocr, coordinates },
        tagChecks,
        evaluationVisible: evaluation.style.display === 'block',
        evaluationExcerpt: evaluationText.replace(/\s+/g, ' ').slice(0, 900),
      };
    })()`);

    assert(/lia-shared-freeze-link/.test(shared.bodyClasses),
      'Shared-link body class is missing: ' + shared.bodyClasses);
    assert(/lia-course-frozen/.test(shared.bodyClasses),
      'Shared course is not globally frozen: ' + shared.bodyClasses);

    const expectedValues = {
      geography: 'Berlin',
      astronomy: 'Jupiter',
      ocr: '3',
    };
    for (const [tag, expectedValue] of Object.entries(expectedValues)) {
      const task = shared.tasks[tag];
      assert(/solved|success|correct|right answer/i.test(
        [task.className, task.outcome, task.feedback, task.text].join(' ')
      ), 'Shared ' + tag + ' task is not correct: ' + JSON.stringify(task));
      assert(task.controls.some(control => control.value === expectedValue),
        'Shared ' + tag + ' value was not restored: ' + JSON.stringify(task.controls));
      assert(task.controls.length > 0 && task.controls.every(control => control.locked),
        'Shared ' + tag + ' controls are not locked: ' + JSON.stringify(task.controls));
    }

    const coordinate = shared.tasks.coordinates;
    assert(/solved|success|correct|right answer/i.test(
      [coordinate.className, coordinate.outcome, coordinate.feedback, coordinate.text].join(' ')
    ), 'Shared Coordinates task is not correct: ' + JSON.stringify(coordinate));
    assert(Math.abs(coordinate.x - 1) < 1e-6 && Math.abs(coordinate.y - 4) < 1e-6,
      'Shared coordinate point was not restored to (1,4): ' + JSON.stringify(coordinate));
    assert(coordinate.controls.every(control => control.locked)
      && coordinate.coordinateControls.every(control => control.locked),
      'Shared coordinate controls are not locked: ' + JSON.stringify(coordinate));
    assert(coordinate.pointFixed || coordinate.boardPointerEvents === 'none' || coordinate.boardFreezeLocked === '1',
      'Shared coordinate board/point is not locked: ' + JSON.stringify(coordinate));

    assert(shared.evaluationVisible, 'Evaluation did not open in shared mode');
    assert(shared.tagChecks.length === 4, 'Expected four evaluation tag checks');
    for (const check of shared.tagChecks) {
      assert(check.found && check.correct && check.wrong && check.achieved && check.score,
        'Evaluation is wrong for ' + check.tag + ': ' + JSON.stringify(check));
    }

    process.stdout.write(JSON.stringify({
      live: {
        slideAtFreeze: live.slideAtFreeze,
        linkLength: live.link.length,
        declarations: live.declarations,
        tasks: live.tasks,
      },
      shared: {
        bodyClasses: shared.bodyClasses,
        tasks: shared.tasks,
        tagChecks: shared.tagChecks,
        evaluationExcerpt: shared.evaluationExcerpt,
      },
    }, null, 2));
  } catch (error) {
    console.error(error.stack || String(error));
    process.exitCode = 1;
  } finally {
    socket.close();
  }
});
