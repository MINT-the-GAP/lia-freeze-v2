/*
 * Focused Chromium regression for lia-orthography with
 * @Auswertung(F12;Tab;Time;Send).
 *
 * Usage:
 *   node tests/e2e/chromium-send-orthography-freeze-cdp.cjs \
 *     <page-websocket-url> [course-url]
 *
 * Always run this against a fresh Chromium profile.
 */

const endpoint = process.argv[2];
const explicitCourseUrl = process.argv[3] || '';

if (!endpoint) {
  console.error(
    'Usage: chromium-send-orthography-freeze-cdp.cjs '
    + '<page-websocket-url> [course-url]'
  );
  process.exit(2);
}

const socket = new WebSocket(endpoint);
const pending = new Map();
let nextId = 1;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP timeout: ' + method));
    }, 90_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      'Chromium evaluation failed: '
      + JSON.stringify(response.exceptionDetails)
    );
  }
  return response.result?.value;
}

function evaluateCall(fn, ...args) {
  const values = args.map(value => JSON.stringify(value)).join(',');
  return evaluate('(' + fn.toString() + ')(' + values + ')');
}

function openSocket() {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP open timeout')), 20_000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener('error', event => {
      clearTimeout(timer);
      reject(event instanceof Error ? event : new Error('CDP socket error'));
    }, { once: true });
  });
}

socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result || {});
});

function installPageHelpers() {
  window.__orthographySendAudit = (() => {
    const answers = ['Der Apfel ist rot.', 'Das Haus ist groß.'];
    const timeline = [];
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = async (description, predicate, attempts = 500) => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const value = predicate();
        if (value) return value;
        await pause(100);
      }
      throw new Error('Timed out waiting for ' + description + ' at ' + location.href);
    };
    const normalize = value => String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/g, '');
    const rendered = element => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0
        && element.getClientRects().length > 0;
    };
    const visible = element => rendered(element)
      && getComputedStyle(element).pointerEvents !== 'none';
    const locked = element => !!element && (
      !!element.disabled
      || !!element.readOnly
      || element.hasAttribute('inert')
      || element.getAttribute('aria-disabled') === 'true'
      || element.getAttribute('data-lia-freeze-locked') === '1'
      || element.getAttribute('data-lia-freeze-marker-locked') === '1'
    );
    const setValue = (element, value) => {
      if (!(element instanceof HTMLInputElement
          || element instanceof HTMLTextAreaElement)) {
        throw new Error('Expected an Orthography input');
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
    const phase = () => document.body.classList.contains('lia-send-review')
      ? 'review'
      : document.body.classList.contains('lia-send-grading')
        ? 'grading'
        : document.body.classList.contains('lia-send-collect')
          ? 'collect'
          : 'off';
    const cells = () => Array.from(document.querySelectorAll('.flex-child'));
    const binding = index => {
      const cell = cells()[index];
      const ui = cell?.querySelector('.orthography-ui[data-ortho-uid]');
      const wrap = ui?.querySelector('.orthography-wrap[data-ortho-uid]');
      const checkScope = ui?.querySelector('.orthography-check[data-ortho-uid]');
      return {
        cell,
        ui,
        wrap,
        checkScope,
        uid: ui?.getAttribute('data-ortho-uid') || '',
        input: wrap?.querySelector(
          "input[id^='orthography-input-'],textarea[id^='orthographytext-input-']"
        ),
        solution: wrap?.querySelector(
          "[id^='orthography-solution-'],[id^='orthographytext-solution-']"
        ),
        root: checkScope?.querySelector('.lia-quiz'),
      };
    };
    const api = () => {
      const seen = new Set();
      for (const runtimeWindow of [window, parent, top]) {
        try {
          if (seen.has(runtimeWindow)) continue;
          seen.add(runtimeWindow);
          if (runtimeWindow.__ORTHOGRAPHY_EXPORT_V8__) {
            return runtimeWindow.__ORTHOGRAPHY_EXPORT_V8__;
          }
        } catch {}
      }
      return null;
    };
    const read = index => {
      const current = binding(index);
      const { cell, wrap, root, input, solution, uid } = current;
      if (!cell || !wrap || !root || !input || !solution || !uid) {
        throw new Error('Orthography #' + index + ' is incomplete');
      }
      const adetailsHost = cell.querySelector(
        '.lia-assignment-details[data-adetails]'
      );
      const adetailsShadow = adetailsHost?.shadowRoot || null;
      const sidecarRoots = adetailsShadow
        ? Array.from(adetailsShadow.querySelectorAll(
          '[data-lia-freeze-adetails-sidecar]'
        ))
        : [];
      const sidecarRoot = sidecarRoots[0] || null;
      const statuses = sidecarRoot
        ? Array.from(sidecarRoot.querySelectorAll('.lia-send-status'))
        : [];
      const status = statuses[0] || null;
      const control = root.querySelector('.lia-quiz__control');
      const forbiddenSidecarSelector = [
        '.lia-send-status',
        '.lia-adetails-points',
        '.lia-adetails-sidecar',
        '.lia-adetails-feedback',
        '[data-lia-send-logged]',
        '[data-lia-freeze-adetails-sidecar]',
      ].join(',');
      const runtimeState = api()?.getAllStates?.()?.[uid] || {};
      const sidecarFeedback = Array.from(
        sidecarRoot?.querySelectorAll('.lia-adetails-feedback') || []
      ).find(item => !!item.textContent?.trim()) || null;
      const feedback = sidecarFeedback || root.querySelector('.lia-quiz__feedback');
      const resolve = root.querySelector('.lia-quiz__resolve');
      const check = root.querySelector('.lia-quiz__check');
      const className = root.className || '';
      const feedbackText = feedback?.textContent?.trim() || '';
      const feedbackClass = feedback?.className || '';
      const outcome = root.getAttribute('data-lia-freeze-outcome') || '';
      const solutionText = solution.textContent || '';
      const state = {
        liveValue: typeof runtimeState.liveValue === 'string'
          ? runtimeState.liveValue
          : null,
        solved: runtimeState.solved === true || runtimeState.solved === 1,
        tries: Number(runtimeState.tries || 0),
        resolvePending: runtimeState.resolvePending === true,
      };
      return {
        index,
        uid,
        phase: phase(),
        frozen: document.body.classList.contains('lia-course-frozen'),
        shared: document.body.classList.contains('lia-shared-freeze-link'),
        adetails: adetailsHost?.getAttribute('data-adetails') || '',
        className,
        open: /\bopen\b/i.test(className),
        outcomeClass: /\b(?:solved|resolved|failed|success)\b/i.test(className),
        outcome,
        correct: /\b(?:solved|success|correct|right answer)\b/i.test(
          className + ' ' + outcome + ' ' + feedbackClass + ' ' + feedbackText
        ),
        sendLogged: sidecarRoot?.getAttribute('data-lia-send-logged') === '1',
        status: status?.textContent?.trim() || '',
        ownership: {
          hostExists: !!adetailsHost,
          hostOutsideQuiz: !!adetailsHost
            && !adetailsHost.closest('.lia-quiz,.lia-quiz__control'),
          hostLightDomEmpty: !!adetailsHost && adetailsHost.childNodes.length === 0,
          sidecarRootCount: sidecarRoots.length,
          statusCount: statuses.length,
          quizHasSendLogged: root.hasAttribute('data-lia-send-logged'),
          quizLightDomSidecars: root.querySelectorAll(forbiddenSidecarSelector).length,
          controlLightDomSidecars: control
            ? control.querySelectorAll(forbiddenSidecarSelector).length
            : 0,
        },
        input: {
          value: input.value,
          readOnly: !!input.readOnly,
          disabled: !!input.disabled,
          locked: locked(input),
        },
        state,
        solutionText,
        solutionShown: normalize(input.value) === normalize(solutionText)
          && state.solved
          && wrap.getAttribute('data-ortho-solved') === '1'
          && !!input.readOnly,
        feedback: {
          text: feedbackText,
          visible: rendered(feedback),
          display: feedback ? getComputedStyle(feedback).display : '',
          visibility: feedback ? getComputedStyle(feedback).visibility : '',
          opacity: feedback ? getComputedStyle(feedback).opacity : '',
          pointerEvents: feedback ? getComputedStyle(feedback).pointerEvents : '',
          rects: feedback?.getClientRects().length || 0,
        },
        check: {
          exists: !!check,
          visible: visible(check),
          disabled: !!check?.disabled,
          locked: locked(check),
        },
        resolve: {
          exists: !!resolve,
          visible: visible(resolve),
          disabled: !!resolve?.disabled,
          locked: locked(resolve),
          ariaHidden: resolve?.getAttribute('aria-hidden') || '',
          tabIndex: resolve?.getAttribute('tabindex') || '',
          display: resolve ? getComputedStyle(resolve).display : '',
          pointerEvents: resolve ? getComputedStyle(resolve).pointerEvents : '',
          className: resolve?.className || '',
        },
      };
    };
    const readBoth = () => [read(0), read(1)];
    const visit = async hash => {
      if (location.hash !== hash) location.hash = hash;
      await waitFor(hash + ' navigation', () => location.hash === hash);
      if (hash === '#2') {
        await waitFor('two Orthography quizzes', () =>
          cells().length === 2
          && [0, 1].every(index => binding(index).root && binding(index).input)
        );
      }
      await pause(260);
    };
    const evaluation = async () => {
      const button = await waitFor(
        'evaluation button',
        () => document.getElementById('lia-freeze-last')
      );
      button.click();
      const panel = await waitFor('evaluation panel', () => {
        const item = document.getElementById('lia-eval-placeholder');
        return item?.style.display === 'block' ? item : null;
      });
      return panel.innerText || '';
    };
    const sampleReadiness = (uid, index, startedAt) => {
      const escapedUid = CSS.escape(uid);
      const ui = document.querySelector(
        '.orthography-ui[data-ortho-uid=' + escapedUid + ']'
      );
      const root = ui?.querySelector('.orthography-check .lia-quiz') || null;
      const check = root?.querySelector('.lia-quiz__check') || null;
      const input = ui?.querySelector(
        'input[id^=orthography-input-],textarea[id^=orthographytext-input-]'
      ) || null;
      const runtimeState = api()?.getAllStates?.()?.[uid] || {};
      return {
        ms: Math.round(performance.now() - startedAt),
        index,
        uid,
        hash: location.hash,
        phase: phase(),
        rootExists: !!root,
        rootConnected: !!root?.isConnected,
        checkExists: !!check,
        checkConnected: !!check?.isConnected,
        checkDisabled: !!check?.disabled,
        inputExists: !!input,
        inputConnected: !!input?.isConnected,
        inputValue: input?.value || '',
        inputExact: input?.value === answers[index],
        liveValue: typeof runtimeState.liveValue === 'string'
          ? runtimeState.liveValue
          : null,
        liveValueExact: runtimeState.liveValue === answers[index],
        solved: runtimeState.solved === true || runtimeState.solved === 1,
        checkToken: Number(runtimeState.checkToken || 0),
      };
    };
    const solve = async index => {
      const before = read(index);
      const resolve = binding(index).root?.querySelector('.lia-quiz__resolve');
      const buttonUsable = !!resolve && visible(resolve) && !locked(resolve);
      const alreadyShown = before.solutionShown;
      const usable = alreadyShown || buttonUsable;
      let triggered = alreadyShown;
      const mechanism = alreadyShown ? 'already-shown' : 'native-resolve';
      if (!alreadyShown && buttonUsable) {
        resolve.click();
        for (let attempt = 0; attempt < 100; attempt++) {
          const current = read(index);
          triggered = current.solutionShown
            && !before.state.solved
            && current.state.solved;
          if (triggered) break;
          await pause(100);
        }
      }
      const after = read(index);
      await pause(6_500);
      const afterRestoreWindow = read(index);
      await visit('#3');
      await visit('#2');
      await pause(6_500);
      const afterNavigation = read(index);
      return {
        usable,
        triggered,
        mechanism,
        buttonUsable,
        before,
        after,
        afterRestoreWindow,
        afterNavigation,
      };
    };

    const runLive = async studentName => {
      await waitFor('Orthography Send collect mode', () =>
        location.hash === '#2'
        && phase() === 'collect'
        && cells().length === 2
        && [0, 1].every(index => binding(index).root?.querySelector('.lia-quiz__check'))
      );
      for (let index = 0; index < 2; index++) {
        setValue(binding(index).input, answers[index]);
        await pause(120);
        binding(index).root.querySelector('.lia-quiz__check').click();
        await waitFor('neutral status #' + index, () =>
          read(index).status.startsWith('Antwort gespeichert')
        );
      }
      const collected = readBoth();
      const recordedUids = collected.map(item => item.uid);

      location.hash = '#3';
      const create = await waitFor(
        'submission controls',
        () => document.getElementById('lia-create-link')
      );
      setValue(document.getElementById('lia-name'), studentName);
      create.click();
      const timelineStarted = performance.now();
      let sampleTimeline = true;
      const timelineTask = (async () => {
        for (let tick = 0; tick < 450 && sampleTimeline; tick++) {
          recordedUids.forEach((uid, index) => {
            timeline.push(sampleReadiness(uid, index, timelineStarted));
          });
          await pause(100);
        }
      })();
      let link = '';
      let freezeError = '';
      try {
        for (let attempt = 0; attempt < 600 && !link; attempt++) {
          link = document.getElementById('lia-link')?.value || '';
          const submitText = document.querySelector('.lia-submit-box')
            ?.innerText?.replace(/\s+/g, ' ').trim() || '';
          if (!link && /(?:timeout|timed out|fehler|error|could not|nicht vorbereiten)/i.test(submitText)) {
            throw new Error('Visible submission error: ' + submitText);
          }
          if (!link) await pause(100);
        }
        if (!link) throw new Error('Timed out waiting for Freeze link');
        await waitFor('same-tab Send review', () =>
          document.body.classList.contains('lia-course-frozen')
          && document.body.classList.contains('lia-send-review')
          && !document.getElementById('lia-send-grading-overlay'),
        600);
      } catch (error) {
        freezeError = String(error?.message || error);
      } finally {
        sampleTimeline = false;
        await timelineTask;
      }
      if (freezeError || !link) {
        return { link, collected, freezeError, timeline };
      }

      await visit('#2');
      await waitFor('graded Orthography results', () =>
        readBoth().every(item => item.correct && item.feedback.text)
      , 1_200);
      const review = readBoth();
      const evaluationBefore = await evaluation();
      await visit('#3');
      await visit('#2');
      await waitFor('same-tab feedback after evaluation', () =>
        readBoth().every(item => item.feedback.visible)
      );
      const solved = await solve(0);
      const evaluationAfter = await evaluation();
      return {
        link,
        collected,
        review,
        evaluationBefore,
        solved,
        evaluationAfter,
        timeline,
      };
    };

    const runShared = async () => {
      await waitFor('shared Send review', () =>
        document.body.classList.contains('lia-shared-freeze-link')
        && document.body.classList.contains('lia-course-frozen')
        && document.body.classList.contains('lia-send-review')
      );
      await visit('#2');
      await waitFor('shared Orthography results', () =>
        readBoth().every(item => item.correct && item.feedback.text)
      );
      const review = readBoth();
      const evaluationBefore = await evaluation();
      await visit('#3');
      await visit('#2');
      await waitFor('shared feedback after evaluation', () =>
        readBoth().every(item => item.feedback.visible)
      );
      const solved = await solve(1);
      const evaluationAfter = await evaluation();
      return { review, evaluationBefore, solved, evaluationAfter };
    };

    return { runLive, runShared, timeline };
  })();
}

function summarizeTimeline(samples) {
  return [0, 1].map(index => {
    const rows = (samples || []).filter(item => item.index === index);
    const first = predicate => rows.find(predicate)?.ms ?? null;
    return {
      index,
      uid: rows[0]?.uid || '',
      samples: rows.length,
      firstRootConnectedMs: first(item => item.rootConnected),
      firstCheckConnectedMs: first(item => item.checkConnected),
      firstCheckEnabledMs: first(item => item.checkConnected && !item.checkDisabled),
      firstInputExactMs: first(item => item.inputConnected && item.inputExact),
      firstLiveValueExactMs: first(item => item.liveValueExact),
      firstSolvedMs: first(item => item.solved),
      maxCheckToken: rows.reduce(
        (maximum, item) => Math.max(maximum, item.checkToken || 0),
        0
      ),
      last: rows.at(-1) || null,
    };
  });
}

function assertSidecarOwnership(item, label) {
  const ownership = item.ownership || {};
  assert(item.adetails && ownership.hostExists && ownership.hostOutsideQuiz,
    label + ' has no external ADetails host: ' + JSON.stringify(item));
  assert(ownership.hostLightDomEmpty
      && ownership.sidecarRootCount === 1
      && ownership.statusCount === 1,
    label + ' does not have exactly one Shadow-DOM status sidecar: '
      + JSON.stringify(item));
  assert(!ownership.quizHasSendLogged
      && ownership.quizLightDomSidecars === 0
      && ownership.controlLightDomSidecars === 0,
    label + ' leaked Send/ADetails state into Elm-owned quiz light DOM: '
      + JSON.stringify(item));
}

function assertCollect(item, label, expectedValue) {
  assertSidecarOwnership(item, label);
  assert(item.phase === 'collect' && item.open && item.sendLogged,
    label + ' is not neutrally logged/open: ' + JSON.stringify(item));
  assert(item.status.startsWith('Antwort gespeichert'),
    label + ' has no neutral status: ' + JSON.stringify(item));
  assert(!item.outcome && !item.outcomeClass,
    label + ' was graded before Freeze: ' + JSON.stringify(item));
  assert(!item.feedback.text && !item.feedback.visible,
    label + ' exposed feedback before Freeze: ' + JSON.stringify(item));
  assert(item.resolve.exists && !item.resolve.visible,
    label + ' exposed a solution control before Freeze: ' + JSON.stringify(item));
  assert(!item.state.solved && item.state.tries === 0,
    label + ' mutated Orthography result state before Freeze: ' + JSON.stringify(item));
  assert(item.input.value === expectedValue && !item.input.readOnly,
    label + ' did not retain the submitted value: ' + JSON.stringify(item));
}

function assertReview(item, label, shared, expectedDetails) {
  assertSidecarOwnership(item, label);
  assert(item.phase === 'review' && item.frozen && item.shared === shared,
    label + ' is not the expected frozen review: ' + JSON.stringify(item));
  assert(item.correct && item.feedback.text && item.feedback.visible,
    label + ' is not correct with visible feedback: ' + JSON.stringify(item));
  assert(item.input.value === item.solutionText,
    label + ' lost the correct submitted value: ' + JSON.stringify(item));
  assert(item.adetails === expectedDetails,
    label + ' lost @ADetails: ' + JSON.stringify(item));
}

function assertSolution(result, label) {
  assert(result.usable,
    label + ' exposes neither an already shown nor a usable solution: '
    + JSON.stringify(result.before));
  assert(result.triggered && result.after.solutionShown,
    label + ' exposes no Orthography model/DOM solution: '
    + JSON.stringify(result));
  assert(result.afterRestoreWindow.solutionShown
      && result.afterRestoreWindow.feedback.visible,
    label + ' solution/feedback was lost after the 6.5 s restore window: '
    + JSON.stringify(result.afterRestoreWindow));
  assert(result.afterNavigation.solutionShown
      && result.afterNavigation.feedback.visible,
    label + ' solution/feedback did not survive away/back navigation: '
    + JSON.stringify(result.afterNavigation));
}

function assertEvaluation(text, label) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  assert(normalized.includes('Orthography A')
      && normalized.includes('Orthography B'),
    label + ' misses an @ADetails tag: ' + normalized);
  assert(/5 of 5 points achieved\./i.test(normalized),
    label + ' does not report 5/5: ' + normalized);
}

async function run() {
  await openSocket();
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Network.enable');
  const originValue = await evaluate('location.origin');
  const origin = /^https?:\/\//.test(originValue || '')
    ? originValue
    : 'http://localhost:8000';
  const source = origin + '/lia-freeze-v2/tests/e2e/send-orthography.md';
  const courseUrl = explicitCourseUrl || (
    origin + '/liascript/index.html?' + encodeURIComponent(source) + '#2'
  );

  await command('Network.clearBrowserCache');
  await command('Page.navigate', { url: courseUrl });
  await delay(1_300);
  await evaluateCall(installPageHelpers);
  const live = await evaluate(
    'window.__orthographySendAudit.runLive("Orthography Send Chromium")'
  );

  assert(live.link && !live.freezeError,
    'Freeze generation failed. readiness=' + JSON.stringify(
      summarizeTimeline(live.timeline)
    ) + ' tail=' + JSON.stringify((live.timeline || []).slice(-20))
    + ' error=' + (live.freezeError || 'no link'));

  await command('Page.navigate', { url: live.link });
  await delay(1_500);
  await evaluateCall(installPageHelpers);
  const shared = await evaluate('window.__orthographySendAudit.runShared()');

  assert(live.link?.includes('submission%3D'),
    'No encoded Freeze link: ' + JSON.stringify(live));
  assertCollect(live.collected[0], 'Collected Orthography A', 'Der Apfel ist rot.');
  assertCollect(live.collected[1], 'Collected Orthography B', 'Das Haus ist groß.');
  assertReview(live.review[0], 'Same-tab Orthography A', false, '2;Orthography A');
  assertReview(live.review[1], 'Same-tab Orthography B', false, '3;Orthography B');
  assertEvaluation(live.evaluationBefore, 'Same-tab evaluation before solution');
  const solutionErrors = [];
  try {
    assertSolution(live.solved, 'Same-tab Orthography A');
  } catch (error) {
    solutionErrors.push(String(error?.message || error));
  }
  assertEvaluation(live.evaluationAfter, 'Same-tab evaluation after solution');

  assertReview(shared.review[0], 'Shared Orthography A', true, '2;Orthography A');
  assertReview(shared.review[1], 'Shared Orthography B', true, '3;Orthography B');
  assertEvaluation(shared.evaluationBefore, 'Shared evaluation before solution');
  try {
    assertSolution(shared.solved, 'Shared Orthography B');
  } catch (error) {
    solutionErrors.push(String(error?.message || error));
  }
  assertEvaluation(shared.evaluationAfter, 'Shared evaluation after solution');
  if (solutionErrors.length) {
    console.error(JSON.stringify({
      diagnostic: true,
      readiness: summarizeTimeline(live.timeline),
      sameTab: {
        review: live.review,
        evaluationBefore: live.evaluationBefore,
        solution: live.solved,
        evaluationAfter: live.evaluationAfter,
      },
      shared: {
        review: shared.review,
        evaluationBefore: shared.evaluationBefore,
        solution: shared.solved,
        evaluationAfter: shared.evaluationAfter,
      },
    }, null, 2));
  }
  assert(solutionErrors.length === 0,
    'Orthography solution regressions:\n' + solutionErrors.join('\n'));

  console.log(JSON.stringify({
    ok: true,
    courseUrl,
    freezeLinkLength: live.link.length,
    readiness: summarizeTimeline(live.timeline),
    collect: {
      values: live.collected.map(item => item.input.value),
      neutral: live.collected.map(item => item.status),
      noPrematureOutcome: live.collected.every(item => !item.outcomeClass),
      noPrematureFeedback: live.collected.every(item => !item.feedback.visible),
      noPrematureSolution: live.collected.every(item => !item.resolve.visible),
    },
    sameTab: {
      feedbackVisible: live.review.every(item => item.feedback.visible),
      solutionPersistent: live.solved.afterNavigation.solutionShown,
      scoreStableAfterSolution: true,
    },
    shared: {
      feedbackVisible: shared.review.every(item => item.feedback.visible),
      solutionPersistent: shared.solved.afterNavigation.solutionShown,
      scoreStableAfterSolution: true,
    },
  }, null, 2));
}

const overallTimer = setTimeout(() => {
  console.error('Overall Orthography Send E2E timeout');
  socket.close();
  process.exitCode = 1;
}, 420_000);

run().then(() => {
  clearTimeout(overallTimer);
  socket.close();
}).catch(error => {
  clearTimeout(overallTimer);
  console.error(error?.stack || error);
  socket.close();
  process.exitCode = 1;
});
