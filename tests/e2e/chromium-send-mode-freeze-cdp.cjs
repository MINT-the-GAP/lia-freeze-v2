/*
 * Focused real-Chromium regression for @Auswertung(...;Send).
 *
 * It proves that native Check actions only log answers in the live course,
 * while feedback and the solution control stay unavailable. Creating the
 * Freeze link performs the deferred checks, freezes the graded state, and
 * exposes feedback plus the native solution control in review mode.
 *
 * Usage:
 *   node tests/e2e/chromium-send-mode-freeze-cdp.cjs \
 *     <page-websocket-url> [course-url]
 *
 * With no course-url, the target self-navigates to the local copy of
 * tests/e2e/send-mode.md served from localhost:8000. Use a fresh Chromium
 * profile so LiaScript's persisted quiz state cannot leak between runs.
 */

const endpoint = process.argv[2];
const explicitCourseUrl = process.argv[3] || '';

if (!endpoint) {
  console.error(
    'Usage: node chromium-send-mode-freeze-cdp.cjs ' +
    '<page-websocket-url> [course-url]'
  );
  process.exit(2);
}

const COMMAND_TIMEOUT_MS = 90_000;
const OVERALL_TIMEOUT_MS = 240_000;

const socket = new WebSocket(endpoint);
const pending = new Map();
let nextId = 1;
let socketOpened = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function closeSocket(error) {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    if (error) waiter.reject(error);
  }
  pending.clear();
  if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
}

function command(method, params = {}) {
  if (socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('CDP socket is not open for ' + method));
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP command timed out: ' + method));
    }, COMMAND_TIMEOUT_MS);
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

function evaluateCall(fn, ...args) {
  const serialized = args.map(value => JSON.stringify(value)).join(',');
  return evaluate('(' + fn.toString() + ')(' + serialized + ')');
}

function openSocket() {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out opening CDP socket')), 20_000);
    const opened = () => {
      clearTimeout(timer);
      socketOpened = true;
      resolve();
    };
    const failed = event => {
      clearTimeout(timer);
      reject(event instanceof Error ? event : new Error('CDP socket failed to open'));
    };
    socket.addEventListener('open', opened, { once: true });
    socket.addEventListener('error', failed, { once: true });
  });
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

socket.addEventListener('error', event => {
  if (!socketOpened) return;
  closeSocket(event instanceof Error ? event : new Error('CDP socket error'));
});

socket.addEventListener('close', () => {
  if (!pending.size) return;
  closeSocket(new Error('CDP socket closed with commands pending'));
});

function assertAdetailsBoundary(state, label) {
  const ownership = state.ownership || {};
  assert(ownership.hostExists
      && ownership.hostOutsideQuiz
      && ownership.shadowRootExists
      && ownership.sidecarRootCount === 1
      && ownership.statusCount === 1,
    label + ' does not use exactly one external ADetails Shadow-DOM sidecar: ' +
    JSON.stringify(state));
  assert(!ownership.quizHasSendLogged && ownership.quizLightDomFreezeStatusCount === 0,
    label + ' leaked Freeze status into the quiz light DOM: ' + JSON.stringify(state));
}

function assertCollectState(state, label) {
  assertAdetailsBoundary(state, label);
  assert(state.phase === 'collect',
    label + ' was not in collect phase: ' + JSON.stringify(state));
  assert(state.open,
    label + ' did not remain open after the intercepted Check action: ' +
    JSON.stringify(state));
  assert(!state.outcomeClass && !state.outcome,
    label + ' already contains grading/trial evidence: ' + JSON.stringify(state));
  assert(state.sendLogged && state.failureMarkers === 0,
    label + ' was not logged neutrally: ' + JSON.stringify(state));
  assert(!/\b(?:trial|attempt|Versuch)\b|\d/.test(state.check?.text || ''),
    label + ' consumed a visible quiz trial: ' + JSON.stringify(state.check));
  assert(!state.feedback.text,
    label + ' exposed feedback before Freeze: ' + JSON.stringify(state.feedback));
  assert(state.status.startsWith('Antwort gespeichert'),
    label + ' has no neutral saved-answer status: ' + JSON.stringify(state));
  assert(state.resolve.exists && !state.resolve.visible,
    label + ' exposed an interactive solution control before Freeze: ' +
    JSON.stringify(state.resolve));
}

function assertCorrectReview(state, label) {
  assertAdetailsBoundary(state, label);
  assert(state.phase === 'review' && state.frozen,
    label + ' is not a frozen Send review: ' + JSON.stringify(state));
  assert(/\b(?:solved|success|correct)\b/i.test(
    state.className + ' ' + state.outcome + ' ' + state.feedback.className
  ), label + ' was not graded correct: ' + JSON.stringify(state));
  assert(state.feedback.text && state.feedback.visible,
    label + ' has no visible feedback after Freeze: ' + JSON.stringify(state.feedback));
  assert(state.textValue === 'Berlin',
    label + ' lost the submitted text answer: ' + JSON.stringify(state));
  assert(state.textControl?.locked && state.check?.locked,
    label + ' left its answer or Check control interactive: ' + JSON.stringify(state));
}

function assertWrongReview(state, label) {
  assertAdetailsBoundary(state, label);
  assert(state.phase === 'review' && state.frozen,
    label + ' is not a frozen Send review: ' + JSON.stringify(state));
  assert(/\b(?:failed|wrong|error)\b/i.test(
    state.className + ' ' + state.outcome + ' ' + state.feedback.className
  ), label + ' was not graded wrong: ' + JSON.stringify(state));
  assert(state.feedback.text && state.feedback.visible,
    label + ' has no visible feedback after Freeze: ' + JSON.stringify(state.feedback));
  assert(state.radios.length >= 3 && state.radios[0].checked && !state.radios[1].checked,
    label + ' did not retain the original wrong answer: ' + JSON.stringify(state.radios));
  assert(state.radios.every(control => control.locked) && state.check?.locked,
    label + ' left answer/Check controls interactive: ' + JSON.stringify(state));
  assert(
    state.resolve.exists
      && state.resolve.visible
      && !state.resolve.disabled
      && !state.resolve.locked
      && !state.resolve.freezeLocked,
    label + ' did not preserve an enabled, unlocked solution control: ' +
    JSON.stringify(state.resolve)
  );
}

function assertUntouchedReview(state, label) {
  assertAdetailsBoundary(state, label);
  assert(state.phase === 'review' && state.frozen,
    label + ' is not a frozen Send review: ' + JSON.stringify(state));
  assert(state.open && !state.outcomeClass && !state.outcome && !state.feedback.text,
    label + ' was graded even though it was never submitted: ' + JSON.stringify(state));
  assert(state.textValue === '',
    label + ' is no longer empty: ' + JSON.stringify(state));
}

function assertEvaluation(result, label) {
  const normalized = String(result?.text || '').replace(/\s+/g, ' ').trim();
  assert(normalized.includes('Richtige Texteingabe'),
    label + ' misses the correct task tag: ' + normalized);
  assert(normalized.includes('Falsche Einfachauswahl'),
    label + ' misses the wrong task tag: ' + normalized);
  assert(normalized.includes('Unbearbeitete Aufgabe'),
    label + ' misses the untouched task tag: ' + normalized);
  assert(/2 of 6 points achieved\./i.test(normalized),
    label + ' does not report 2 of 6 points: ' + normalized);
  const expected = {
    '#2::send::0': 2,
    '#3::send::0': 1,
    '#4::send::0': 0,
  };
  assert(result?.total === 3,
    label + ' does not report exactly three learner Check clicks: ' + JSON.stringify(result));
  assert(JSON.stringify(result?.counts) === JSON.stringify(expected),
    label + ' has wrong per-task Check counts: ' + JSON.stringify(result));
}

async function run() {
  await openSocket();
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Network.enable');
  await command('Page.bringToFront');

  const currentOrigin = await evaluate('location.origin');
  const origin = /^https?:\/\//.test(currentOrigin || '')
    ? currentOrigin
    : 'http://localhost:8000';
  const sourceUrl = origin + '/lia-freeze-v2/tests/e2e/send-mode.md';
  const courseUrl = explicitCourseUrl || (
    origin + '/liascript/index.html?' + encodeURIComponent(sourceUrl) + '#2'
  );

  await command('Network.clearBrowserCache');
  await command('Page.navigate', { url: courseUrl });
  await delay(1_200);

  const live = await evaluateCall(async function (studentName) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = async (description, predicate, attempts = 240) => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const value = predicate();
        if (value) return value;
        await pause(100);
      }
      throw new Error('Timed out waiting for ' + description + ' at ' + location.href);
    };
    const setValue = (element, value) => {
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
    const visible = element => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.pointerEvents !== 'none'
        && element.getClientRects().length > 0;
    };
    const controlState = element => {
      if (!(element instanceof HTMLElement)) return null;
      const control = element;
      return {
        disabled: !!control.disabled,
        readOnly: !!control.readOnly,
        freezeLocked: control.getAttribute('data-lia-freeze-locked') === '1',
        inert: control.hasAttribute('inert'),
        ariaDisabled: control.getAttribute('aria-disabled') || '',
        locked: !!control.disabled
          || !!control.readOnly
          || control.getAttribute('data-lia-freeze-locked') === '1'
          || control.hasAttribute('inert'),
      };
    };
    const adetailsForQuiz = root => {
      const markerSelector = '.lia-assignment-details[data-adetails]';
      const contentHost = document.querySelector('main.lia-slide__content')
        ?? document.querySelector('.lia-content')
        ?? document.querySelector('main')
        ?? document.querySelector('article')
        ?? document.body;
      const markers = Array.from(contentHost.querySelectorAll(markerSelector))
        .filter(marker => !marker.closest(
          '#lia-freeze-bar,.lia-submit-box,#lia-print-slides'
        ));
      const host = markers.find(marker => {
        const localScope = marker.closest('.flex-child') ?? contentHost;
        const ordered = Array.from(localScope.querySelectorAll(
          '.lia-quiz__check,' + markerSelector
        ));
        const markerIndex = ordered.indexOf(marker);
        if (markerIndex < 0) return false;
        for (let index = markerIndex - 1; index >= 0; index--) {
          const candidate = ordered[index];
          if (!candidate.matches('.lia-quiz__check')) continue;
          if (candidate.closest('#lia-freeze-bar,.lia-submit-box,#lia-print-slides')) {
            continue;
          }
          return candidate.closest('.lia-quiz') === root;
        }
        return false;
      }) ?? null;
      const shadow = host?.shadowRoot ?? null;
      const sidecarRoots = shadow
        ? Array.from(shadow.querySelectorAll('[data-lia-freeze-adetails-sidecar]'))
        : [];
      const sidecarRoot = sidecarRoots[0] ?? null;
      const statuses = sidecarRoot
        ? Array.from(sidecarRoot.querySelectorAll('.lia-send-status'))
        : [];
      return {
        host,
        shadow,
        sidecarRoots,
        sidecarRoot,
        statuses,
        status: statuses[0] ?? null,
      };
    };
    const readQuiz = () => {
      const root = document.querySelector('.lia-quiz');
      if (!root) throw new Error('Native quiz root is missing on ' + location.hash);
      const scope = root.parentElement ?? root;
      const adetails = adetailsForQuiz(root);
      const shadowFeedback = adetails.sidecarRoot?.querySelector(
        '.lia-adetails-feedback'
      );
      const feedback = shadowFeedback?.textContent?.trim()
        ? shadowFeedback
        : root.querySelector('.lia-quiz__feedback');
      const resolve = root.querySelector('.lia-quiz__resolve');
      const check = root.querySelector('.lia-quiz__check');
      const textControl = scope.querySelector(
        'input.lia-quiz__input,textarea.lia-quiz__input,input[type=text]'
      );
      const radios = Array.from(scope.querySelectorAll('input[type=radio]'));
      const className = root.className || '';
      return {
        hash: location.hash,
        phase: document.body.classList.contains('lia-send-review')
          ? 'review'
          : document.body.classList.contains('lia-send-grading')
            ? 'grading'
            : document.body.classList.contains('lia-send-collect')
              ? 'collect'
              : 'off',
        frozen: document.body.classList.contains('lia-course-frozen'),
        shared: document.body.classList.contains('lia-shared-freeze-link'),
        className,
        open: /\bopen\b/i.test(className),
        outcomeClass: /\b(?:solved|resolved|failed|success)\b/i.test(className),
        outcome: root.getAttribute('data-lia-freeze-outcome') || '',
        sendLogged: adetails.sidecarRoot?.getAttribute('data-lia-send-logged') === '1',
        failureMarkers: scope.querySelectorAll(
          '.is-failure,.text-error,.text-danger,[data-lia-freeze-outcome=wrong]'
        ).length,
        feedback: {
          text: feedback?.textContent?.trim() || '',
          className: feedback?.className || '',
          visible: visible(feedback),
        },
        status: adetails.status?.textContent?.trim() || '',
        ownership: {
          hostExists: !!adetails.host,
          hostOutsideQuiz: !!adetails.host
            && !adetails.host.closest('.lia-quiz,.lia-quiz__control'),
          shadowRootExists: !!adetails.shadow,
          sidecarRootCount: adetails.sidecarRoots.length,
          statusCount: adetails.statuses.length,
          quizHasSendLogged: root.hasAttribute('data-lia-send-logged'),
          quizLightDomFreezeStatusCount: root.querySelectorAll(
            '.lia-send-status,[data-lia-send-logged],[data-lia-freeze-adetails-sidecar]'
          ).length,
        },
        textValue: textControl?.value || '',
        textControl: controlState(textControl),
        radios: radios.map(radio => ({
          checked: radio.checked,
          value: radio.value,
          ...controlState(radio),
        })),
        check: {
          ...controlState(check),
          text: check?.textContent?.trim() || '',
        },
        resolve: {
          exists: !!resolve,
          visible: visible(resolve),
          disabled: !!resolve?.disabled,
          freezeLocked: resolve?.getAttribute('data-lia-freeze-locked') === '1',
          locked: !!resolve?.disabled
            || resolve?.getAttribute('data-lia-freeze-locked') === '1'
            || resolve?.hasAttribute('inert'),
          display: resolve ? getComputedStyle(resolve).display : '',
          pointerEvents: resolve ? getComputedStyle(resolve).pointerEvents : '',
        },
      };
    };
    const visit = async (hash, ready) => {
      if (location.hash !== hash) location.hash = hash;
      await waitFor(hash + ' navigation', () => location.hash === hash);
      await waitFor(hash + ' quiz', () => document.querySelector('.lia-quiz'));
      if (ready) await waitFor(hash + ' restored state', ready);
      await pause(220);
      return readQuiz();
    };
    const showEvaluation = async () => {
      const button = await waitFor(
        'evaluation navigation button',
        () => document.getElementById('lia-freeze-last')
      );
      button.click();
      const evaluation = await waitFor('visible evaluation', () => {
        const item = document.getElementById('lia-eval-placeholder');
        return item?.style.display === 'block' ? item : null;
      });
      const summary = evaluation.querySelector('[data-lia-send-check-total]');
      const counts = Object.fromEntries(Array.from(
        evaluation.querySelectorAll('[data-lia-send-check-task]')
      ).map(row => [
        row.getAttribute('data-lia-send-check-task'),
        Number(row.getAttribute('data-lia-send-check-count')),
      ]));
      return {
        text: evaluation.innerText || '',
        total: summary ? Number(summary.getAttribute('data-lia-send-check-total')) : null,
        counts,
      };
    };

    await waitFor('live Send collect mode', () =>
      location.hash === '#2'
      && document.body.classList.contains('lia-send-collect')
      && document.querySelector('.lia-quiz .lia-quiz__check')
    );

    const correctRoot = document.querySelector('.lia-quiz');
    const correctScope = correctRoot.parentElement ?? correctRoot;
    const correctInput = correctScope.querySelector(
      'input.lia-quiz__input,textarea.lia-quiz__input,input[type=text]'
    );
    setValue(correctInput, 'Berlin');
    const correctCheck = correctRoot.querySelector('.lia-quiz__check');
    correctCheck.click();
    correctCheck.click();
    await waitFor('neutral status for correct answer', () =>
      adetailsForQuiz(correctRoot).status?.textContent?.includes('Antwort gespeichert')
    );
    const collectedCorrect = readQuiz();

    await visit('#3');
    const wrongRoot = document.querySelector('.lia-quiz');
    const wrongScope = wrongRoot.parentElement ?? wrongRoot;
    const wrongChoices = Array.from(wrongScope.querySelectorAll('input[type=radio]'));
    if (wrongChoices.length < 3) {
      throw new Error('Expected three SingleChoice radio inputs, got ' + wrongChoices.length);
    }
    wrongChoices[0].click();
    await pause(100);
    wrongRoot.querySelector('.lia-quiz__check').click();
    await waitFor('neutral status for wrong answer', () =>
      adetailsForQuiz(wrongRoot).status?.textContent?.includes('Antwort gespeichert')
    );
    const collectedWrong = readQuiz();

    const collectedUntouched = await visit('#4');

    location.hash = '#5';
    const create = await waitFor(
      'submission controls',
      () => document.getElementById('lia-create-link')
    );
    setValue(document.getElementById('lia-name'), studentName);
    create.click();
    const link = await waitFor('generated Freeze link', () =>
      document.getElementById('lia-link')?.value || ''
    , 1_200);
    await waitFor('same-tab frozen review', () =>
      document.body.classList.contains('lia-course-frozen')
      && document.body.classList.contains('lia-send-review')
      && !document.getElementById('lia-send-grading-overlay')
    , 1_200);

    const frozenCorrect = await visit('#2', () => {
      const state = readQuiz();
      return state.feedback.text && state.textValue === 'Berlin';
    });
    const frozenWrong = await visit('#3', () => {
      const state = readQuiz();
      return state.feedback.text
        && state.radios[0]?.checked
        && state.resolve.exists
        && state.resolve.visible;
    });
    const frozenUntouched = await visit('#4', () => {
      const state = readQuiz();
      return state.open && state.textValue === '';
    });
    const evaluation = await showEvaluation();

    return {
      href: location.href,
      link,
      collected: {
        correct: collectedCorrect,
        wrong: collectedWrong,
        untouched: collectedUntouched,
      },
      frozen: {
        correct: frozenCorrect,
        wrong: frozenWrong,
        untouched: frozenUntouched,
      },
      evaluation,
    };
  }, 'Send Mode Chromium');

  assert(live.link && live.link.includes('submission%3D'),
    'No encoded Freeze link was generated: ' + JSON.stringify(live));
  assertCollectState(live.collected.correct, 'Live correct text quiz');
  assertCollectState(live.collected.wrong, 'Live wrong SingleChoice quiz');
  assert(live.collected.correct.textValue === 'Berlin',
    'Live correct text answer was not retained');
  assert(live.collected.correct.status.includes('Prüfen-Klicks: 2'),
    'Two live Check clicks were not shown neutrally: ' + live.collected.correct.status);
  assert(live.collected.wrong.status.includes('Prüfen-Klicks: 1'),
    'One live Check click was not shown neutrally: ' + live.collected.wrong.status);
  assert(live.collected.wrong.radios[0]?.checked && !live.collected.wrong.radios[1]?.checked,
    'Live wrong choice was not retained: ' + JSON.stringify(live.collected.wrong.radios));
  assertAdetailsBoundary(live.collected.untouched, 'Live untouched quiz');
  assert(live.collected.untouched.phase === 'collect'
      && live.collected.untouched.open
      && !live.collected.untouched.sendLogged
      && !live.collected.untouched.status
      && !live.collected.untouched.feedback.text
      && live.collected.untouched.textValue === '',
    'Untouched quiz was logged or graded in collect mode: ' +
    JSON.stringify(live.collected.untouched));
  assertCorrectReview(live.frozen.correct, 'Same-tab correct text quiz');
  assertWrongReview(live.frozen.wrong, 'Same-tab wrong SingleChoice quiz');
  assertUntouchedReview(live.frozen.untouched, 'Same-tab untouched quiz');
  assertEvaluation(live.evaluation, 'Same-tab evaluation');

  await command('Page.navigate', { url: live.link });
  await delay(1_500);

  const shared = await evaluateCall(async function () {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = async (description, predicate, attempts = 300) => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const value = predicate();
        if (value) return value;
        await pause(100);
      }
      throw new Error('Timed out waiting for ' + description + ' at ' + location.href);
    };
    const visible = element => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.pointerEvents !== 'none'
        && element.getClientRects().length > 0;
    };
    const controlState = element => {
      if (!(element instanceof HTMLElement)) return null;
      const control = element;
      return {
        disabled: !!control.disabled,
        readOnly: !!control.readOnly,
        freezeLocked: control.getAttribute('data-lia-freeze-locked') === '1',
        inert: control.hasAttribute('inert'),
        ariaDisabled: control.getAttribute('aria-disabled') || '',
        locked: !!control.disabled
          || !!control.readOnly
          || control.getAttribute('data-lia-freeze-locked') === '1'
          || control.hasAttribute('inert'),
      };
    };
    const adetailsForQuiz = root => {
      const markerSelector = '.lia-assignment-details[data-adetails]';
      const contentHost = document.querySelector('main.lia-slide__content')
        ?? document.querySelector('.lia-content')
        ?? document.querySelector('main')
        ?? document.querySelector('article')
        ?? document.body;
      const markers = Array.from(contentHost.querySelectorAll(markerSelector))
        .filter(marker => !marker.closest(
          '#lia-freeze-bar,.lia-submit-box,#lia-print-slides'
        ));
      const host = markers.find(marker => {
        const localScope = marker.closest('.flex-child') ?? contentHost;
        const ordered = Array.from(localScope.querySelectorAll(
          '.lia-quiz__check,' + markerSelector
        ));
        const markerIndex = ordered.indexOf(marker);
        if (markerIndex < 0) return false;
        for (let index = markerIndex - 1; index >= 0; index--) {
          const candidate = ordered[index];
          if (!candidate.matches('.lia-quiz__check')) continue;
          if (candidate.closest('#lia-freeze-bar,.lia-submit-box,#lia-print-slides')) {
            continue;
          }
          return candidate.closest('.lia-quiz') === root;
        }
        return false;
      }) ?? null;
      const shadow = host?.shadowRoot ?? null;
      const sidecarRoots = shadow
        ? Array.from(shadow.querySelectorAll('[data-lia-freeze-adetails-sidecar]'))
        : [];
      const sidecarRoot = sidecarRoots[0] ?? null;
      const statuses = sidecarRoot
        ? Array.from(sidecarRoot.querySelectorAll('.lia-send-status'))
        : [];
      return {
        host,
        shadow,
        sidecarRoots,
        sidecarRoot,
        statuses,
        status: statuses[0] ?? null,
      };
    };
    const readQuiz = () => {
      const root = document.querySelector('.lia-quiz');
      if (!root) throw new Error('Native quiz root is missing on ' + location.hash);
      const scope = root.parentElement ?? root;
      const adetails = adetailsForQuiz(root);
      const shadowFeedback = adetails.sidecarRoot?.querySelector(
        '.lia-adetails-feedback'
      );
      const feedback = shadowFeedback?.textContent?.trim()
        ? shadowFeedback
        : root.querySelector('.lia-quiz__feedback');
      const resolve = root.querySelector('.lia-quiz__resolve');
      const check = root.querySelector('.lia-quiz__check');
      const textControl = scope.querySelector(
        'input.lia-quiz__input,textarea.lia-quiz__input,input[type=text]'
      );
      const radios = Array.from(scope.querySelectorAll('input[type=radio]'));
      const className = root.className || '';
      return {
        hash: location.hash,
        phase: document.body.classList.contains('lia-send-review')
          ? 'review'
          : document.body.classList.contains('lia-send-grading')
            ? 'grading'
            : document.body.classList.contains('lia-send-collect')
              ? 'collect'
              : 'off',
        frozen: document.body.classList.contains('lia-course-frozen'),
        shared: document.body.classList.contains('lia-shared-freeze-link'),
        className,
        open: /\bopen\b/i.test(className),
        outcomeClass: /\b(?:solved|resolved|failed|success)\b/i.test(className),
        outcome: root.getAttribute('data-lia-freeze-outcome') || '',
        sendLogged: adetails.sidecarRoot?.getAttribute('data-lia-send-logged') === '1',
        failureMarkers: scope.querySelectorAll(
          '.is-failure,.text-error,.text-danger,[data-lia-freeze-outcome=wrong]'
        ).length,
        feedback: {
          text: feedback?.textContent?.trim() || '',
          className: feedback?.className || '',
          visible: visible(feedback),
        },
        status: adetails.status?.textContent?.trim() || '',
        ownership: {
          hostExists: !!adetails.host,
          hostOutsideQuiz: !!adetails.host
            && !adetails.host.closest('.lia-quiz,.lia-quiz__control'),
          shadowRootExists: !!adetails.shadow,
          sidecarRootCount: adetails.sidecarRoots.length,
          statusCount: adetails.statuses.length,
          quizHasSendLogged: root.hasAttribute('data-lia-send-logged'),
          quizLightDomFreezeStatusCount: root.querySelectorAll(
            '.lia-send-status,[data-lia-send-logged],[data-lia-freeze-adetails-sidecar]'
          ).length,
        },
        textValue: textControl?.value || '',
        textControl: controlState(textControl),
        radios: radios.map(radio => ({
          checked: radio.checked,
          value: radio.value,
          ...controlState(radio),
        })),
        check: {
          ...controlState(check),
          text: check?.textContent?.trim() || '',
        },
        resolve: {
          exists: !!resolve,
          visible: visible(resolve),
          disabled: !!resolve?.disabled,
          freezeLocked: resolve?.getAttribute('data-lia-freeze-locked') === '1',
          locked: !!resolve?.disabled
            || resolve?.getAttribute('data-lia-freeze-locked') === '1'
            || resolve?.hasAttribute('inert'),
          display: resolve ? getComputedStyle(resolve).display : '',
          pointerEvents: resolve ? getComputedStyle(resolve).pointerEvents : '',
        },
      };
    };
    const visit = async (hash, ready) => {
      if (location.hash !== hash) location.hash = hash;
      await waitFor(hash + ' navigation', () => location.hash === hash);
      await waitFor(hash + ' quiz', () => document.querySelector('.lia-quiz'));
      if (ready) await waitFor(hash + ' restored state', ready);
      await pause(220);
      return readQuiz();
    };
    const showEvaluation = async () => {
      const button = await waitFor(
        'evaluation navigation button',
        () => document.getElementById('lia-freeze-last')
      );
      button.click();
      const evaluation = await waitFor('visible evaluation', () => {
        const item = document.getElementById('lia-eval-placeholder');
        return item?.style.display === 'block' ? item : null;
      });
      const summary = evaluation.querySelector('[data-lia-send-check-total]');
      const counts = Object.fromEntries(Array.from(
        evaluation.querySelectorAll('[data-lia-send-check-task]')
      ).map(row => [
        row.getAttribute('data-lia-send-check-task'),
        Number(row.getAttribute('data-lia-send-check-count')),
      ]));
      return {
        text: evaluation.innerText || '',
        total: summary ? Number(summary.getAttribute('data-lia-send-check-total')) : null,
        counts,
      };
    };

    await waitFor('shared frozen Send review', () =>
      document.body.classList.contains('lia-shared-freeze-link')
      && document.body.classList.contains('lia-course-frozen')
      && document.body.classList.contains('lia-send-review')
    );

    const correct = await visit('#2', () => {
      const state = readQuiz();
      return state.feedback.text && state.textValue === 'Berlin';
    });
    const wrong = await visit('#3', () => {
      const state = readQuiz();
      return state.feedback.text
        && state.radios[0]?.checked
        && state.resolve.exists
        && state.resolve.visible;
    });
    const untouched = await visit('#4', () => {
      const state = readQuiz();
      return state.open && state.textValue === '';
    });
    const evaluationBeforeResolve = await showEvaluation();

    await visit('#3', () => {
      const state = readQuiz();
      return state.resolve.visible && !state.resolve.locked;
    });
    const root = document.querySelector('.lia-quiz');
    const resolve = root.querySelector('.lia-quiz__resolve');
    const beforeClass = root.className || '';
    resolve.click();
    await waitFor('visible native solution', () =>
      /\bresolved\b/i.test(document.querySelector('.lia-quiz')?.className || '')
    );
    await pause(250);

    const afterResolve = readQuiz();
    const resolvedRoot = document.querySelector('.lia-quiz');
    const scope = resolvedRoot.parentElement ?? resolvedRoot;
    const visibleSuccessMarkers = Array.from(scope.querySelectorAll(
      '.text-success,.is-success,[class*=correct],[class*=solution]'
    )).filter(visible).map(item => ({
      tag: item.tagName,
      className: item.className || '',
      text: item.textContent?.trim() || '',
    }));

    // The shared-link DOM fallback intentionally retries for up to six seconds.
    // A review action must invalidate those retries so they cannot repaint the
    // frozen wrong state over LiaScript's newly resolved state.
    await pause(6_500);
    const afterRestoreWindow = readQuiz();

    await visit('#2', () => /\b(?:solved|success)\b/i.test(
      document.querySelector('.lia-quiz')?.className || ''
    ));
    await visit('#3');
    await pause(6_500);
    const afterNavigation = readQuiz();
    const evaluationAfterResolve = await showEvaluation();

    return {
      href: location.href,
      correct,
      wrong,
      untouched,
      evaluationBeforeResolve,
      resolution: {
        beforeClass,
        after: afterResolve,
        afterRestoreWindow,
        afterNavigation,
        visibleSuccessMarkers,
      },
      evaluationAfterResolve,
    };
  });

  assert(shared.correct.shared && shared.wrong.shared && shared.untouched.shared,
    'One or more restored tasks are not in shared-link mode: ' + JSON.stringify(shared));
  assertCorrectReview(shared.correct, 'Shared-link correct text quiz');
  assertWrongReview(shared.wrong, 'Shared-link wrong SingleChoice quiz');
  assertUntouchedReview(shared.untouched, 'Shared-link untouched quiz');
  assertEvaluation(shared.evaluationBeforeResolve, 'Shared-link evaluation before resolve');
  assert(/\b(?:failed|open)\b/i.test(shared.resolution.beforeClass)
      && /\b(?:error|failure)\b/i.test(
        shared.wrong.feedback.className + ' ' +
        shared.wrong.radios.map(item => item.className || '').join(' ')
      )
      && /\bresolved\b/i.test(shared.resolution.after.className),
    'Clicking the preserved solution control did not enter visible resolved state: ' +
    JSON.stringify(shared.resolution));
  assert(
    shared.resolution.visibleSuccessMarkers.length > 0
      || shared.resolution.after.radios[1]?.checked,
    'Resolved SingleChoice did not expose visible solution evidence: ' +
    JSON.stringify(shared.resolution)
  );
  assert(/\bresolved\b/i.test(shared.resolution.afterRestoreWindow.className),
    'A delayed native-DOM restore repainted the resolved quiz: ' +
    JSON.stringify(shared.resolution.afterRestoreWindow));
  assert(/\bresolved\b/i.test(shared.resolution.afterNavigation.className)
      && shared.resolution.afterNavigation.resolve.disabled
      && !shared.resolution.afterNavigation.resolve.freezeLocked,
    'Away/back navigation produced a split or unlocked resolved state: ' +
    JSON.stringify(shared.resolution.afterNavigation));
  assertEvaluation(shared.evaluationAfterResolve, 'Shared-link evaluation after resolve');
  assert(
    JSON.stringify(shared.evaluationAfterResolve.counts)
      === JSON.stringify(shared.evaluationBeforeResolve.counts),
    'Reviewing the solution changed the frozen Check counts: '
      + JSON.stringify({
        before: shared.evaluationBeforeResolve,
        after: shared.evaluationAfterResolve,
      })
  );

  console.log(JSON.stringify({
    ok: true,
    courseUrl,
    freezeLinkLength: live.link.length,
    collect: {
      phase: live.collected.correct.phase,
      neutralStatuses: [
        live.collected.correct.status,
        live.collected.wrong.status,
      ],
      feedbackHidden: [
        !live.collected.correct.feedback.text,
        !live.collected.wrong.feedback.text,
      ],
    },
    sameTab: {
      correct: live.frozen.correct.outcome || live.frozen.correct.className,
      wrong: live.frozen.wrong.outcome || live.frozen.wrong.className,
      score: '2/6',
    },
    shared: {
      correct: shared.correct.outcome || shared.correct.className,
      wrong: shared.wrong.outcome || shared.wrong.className,
      untouched: shared.untouched.outcome || shared.untouched.className,
      resolveBeforeLocked: shared.wrong.resolve.locked,
      resolveAfterClass: shared.resolution.after.className,
      scoreStableAfterResolve: true,
    },
  }, null, 2));
}

const overallTimer = setTimeout(() => {
  closeSocket(new Error('Overall Send-mode E2E timeout after ' + OVERALL_TIMEOUT_MS + ' ms'));
}, OVERALL_TIMEOUT_MS);

run().then(() => {
  clearTimeout(overallTimer);
  closeSocket();
}).catch(error => {
  clearTimeout(overallTimer);
  console.error(error?.stack || error);
  closeSocket(error instanceof Error ? error : new Error(String(error)));
  process.exitCode = 1;
});
