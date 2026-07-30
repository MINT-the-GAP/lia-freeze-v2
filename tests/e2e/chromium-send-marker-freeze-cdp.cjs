/*
 * Focused Chromium regression for lia-marker with @Auswertung(...;Send).
 *
 * Usage:
 *   node tests/e2e/chromium-send-marker-freeze-cdp.cjs <page-websocket-url>
 *
 * Run against a fresh Chromium profile. This covers collect, same-tab review,
 * shared-link review, and persistent Marker model solutions.
 */

const endpoint = process.argv[2];
if (!endpoint) {
  console.error('Usage: chromium-send-marker-freeze-cdp.cjs <page-websocket-url>');
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
    throw new Error('Chromium evaluation failed: '
      + JSON.stringify(response.exceptionDetails));
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
  window.__markerSendAudit = (() => {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = async (description, predicate, attempts = 500) => {
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
    const scopes = () => Array.from(document.querySelectorAll('.markerquiz'));
    const contentHost = () => document.querySelector('main.lia-slide__content')
      || document.querySelector('.lia-content')
      || document.querySelector('main')
      || document.querySelector('article')
      || document.body;
    const assignmentDetailMarkerForQuiz = quizRoot => {
      const host = contentHost();
      if (!host?.contains(quizRoot)) return null;
      const markerSelector = '.lia-assignment-details[data-adetails]';
      const excludedSelector = '#lia-freeze-bar,.lia-submit-box,#lia-print-slides';
      const markers = Array.from(host.querySelectorAll(markerSelector))
        .filter(marker => !marker.closest(excludedSelector));
      return markers.find(marker => {
        const localScope = marker.closest('.flex-child') || host;
        const ordered = Array.from(localScope.querySelectorAll(
          '.lia-quiz__check,' + markerSelector
        ));
        const markerIndex = ordered.indexOf(marker);
        if (markerIndex < 0) return false;
        for (let cursor = markerIndex - 1; cursor >= 0; cursor--) {
          const candidate = ordered[cursor];
          if (!candidate.matches('.lia-quiz__check')) continue;
          if (candidate.closest(excludedSelector)) continue;
          return candidate.closest('.lia-quiz') === quizRoot;
        }
        return false;
      }) || null;
    };
    const phase = () => document.body.classList.contains('lia-send-review')
      ? 'review'
      : document.body.classList.contains('lia-send-grading')
        ? 'grading'
        : document.body.classList.contains('lia-send-collect')
          ? 'collect'
          : 'off';
    const highlights = () => {
      const registries = [];
      for (const runtimeWindow of [window, parent, top]) {
        try {
          const registry = runtimeWindow.__LIA_TEXTMARKER_REG_V4__;
          if (registry && !registries.includes(registry)) registries.push(registry);
        } catch {}
      }
      for (const registry of registries) {
        const instances = Object.values(registry.instances || {});
        const instance = [...instances].reverse()
          .find(item => item?.__alive !== false) || instances.at(-1);
        if (Array.isArray(instance?.HL)) return instance.HL;
      }
      return [];
    };
    const read = index => {
      const scope = scopes()[index];
      const root = scope?.querySelector('.lia-quiz');
      if (!scope || !root) throw new Error('Marker #' + index + ' is missing');
      const adetailsHost = assignmentDetailMarkerForQuiz(root);
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
      const proxy = scope.querySelector('.hlq-proxy');
      const sidecarFeedback = sidecarRoot?.querySelector('.lia-adetails-feedback');
      const nativeFeedback = root.querySelector('.lia-quiz__feedback');
      const feedback = sidecarFeedback?.textContent?.trim()
        ? sidecarFeedback
        : nativeFeedback;
      const resolve = root.querySelector('.lia-quiz__resolve');
      const internalSolve = proxy?.querySelector('[data-hlq-act="solve"]');
      const message = proxy?.querySelector('.hlq-msg');
      // lia-marker assigns S1/S2 lazily. Frozen away/back remounts can retain
      // the registry while the equivalent DOM attribute is not written again.
      const scopeId = scope.dataset.hlScope || 'S' + (index + 1);
      const className = root.className || '';
      const feedbackText = feedback?.textContent?.trim() || '';
      const feedbackClass = feedback?.className || '';
      const outcome = root.getAttribute('data-lia-freeze-outcome') || '';
      const locked = element => !!element && (
        !!element.disabled
        || element.hasAttribute('inert')
        || element.getAttribute('aria-disabled') === 'true'
        || element.getAttribute('data-lia-freeze-locked') === '1'
        || element.getAttribute('data-lia-freeze-marker-locked') === '1'
      );
      return {
        index,
        phase: phase(),
        frozen: document.body.classList.contains('lia-course-frozen'),
        shared: document.body.classList.contains('lia-shared-freeze-link'),
        scopeId,
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
        proxyValue: proxy?.querySelector(
          'input.lia-quiz__input,textarea.lia-quiz__input,input[type=text],input[type=number]'
        )?.value?.trim() || '',
        feedback: {
          text: feedbackText,
          visible: visible(feedback),
        },
        message: {
          text: message?.textContent?.trim() || '',
          visible: visible(message),
        },
        resolve: {
          exists: !!resolve,
          visible: visible(resolve),
          disabled: !!resolve?.disabled,
          locked: locked(resolve),
        },
        internalSolve: {
          exists: !!internalSolve,
          visible: visible(internalSolve),
          disabled: !!internalSolve?.disabled,
          locked: locked(internalSolve),
        },
        userColors: highlights().filter(item =>
          item?.kind === 'user' && item?.scope === scopeId
        ).map(item => item.color),
        solutionCount: highlights().filter(item =>
          item?.kind === 'solution' && item?.scope === scopeId
        ).length,
      };
    };
    const readBoth = () => [read(0), read(1)];
    const visit = async hash => {
      if (location.hash !== hash) location.hash = hash;
      await waitFor(hash + ' navigation', () => location.hash === hash);
      if (hash === '#2') {
        await waitFor('two Marker quizzes', () =>
          scopes().length === 2
          && scopes().every(scope => scope.querySelector('.lia-quiz'))
        );
      }
      await pause(240);
    };
    const mark = async (index, color) => {
      const swatch = await waitFor(color + ' swatch', () =>
        Array.from(document.querySelectorAll('.hl-swatch')).find(item =>
          (item.title || item.getAttribute('aria-label') || '').toLowerCase() === color
        )
      );
      swatch.click();
      const target = scopes()[index].querySelector('.lia-hl-target');
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode && !textNode.data.trim()) textNode = walker.nextNode();
      if (!(textNode instanceof Text)) throw new Error('No Marker text #' + index);
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, textNode.data.length);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
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
    const solve = async index => {
      const before = read(index);
      const native = scopes()[index].querySelector('.lia-quiz__resolve');
      const internal = scopes()[index].querySelector('[data-hlq-act="solve"]');
      const button = visible(native) && !native.disabled ? native : internal;
      const markerLocked = !button
        || !!button.disabled
        || button.hasAttribute('inert')
        || button.getAttribute('aria-disabled') === 'true'
        || button.getAttribute('data-lia-freeze-locked') === '1'
        || button.getAttribute('data-lia-freeze-marker-locked') === '1';
      if (markerLocked) {
        throw new Error('Marker solution #' + index + ' is not usable');
      }
      button.click();
      await waitFor('Marker solution #' + index, () => read(index).solutionCount > 0);
      await pause(260);
      return {
        mechanism: button === native ? 'native' : 'marker',
        before,
        after: read(index),
      };
    };

    const runLive = async studentName => {
      await waitFor('Marker Send collect mode', () =>
        location.hash === '#2'
        && phase() === 'collect'
        && scopes().length === 2
        && scopes().every(scope => scope.querySelector('.lia-quiz__check'))
      );
      const highlighter = await waitFor('Text Highlighter', () =>
        document.querySelector('[title="Text Highlighter"],[aria-label="Text Highlighter"]')
      );
      highlighter.click();
      await waitFor('Marker palette', () =>
        document.querySelectorAll('.hl-swatch').length >= 6
      );
      await mark(0, 'red');
      await mark(1, 'blue');
      const highlighted = readBoth();

      for (let index = 0; index < 2; index++) {
        const root = scopes()[index].querySelector('.lia-quiz');
        root.querySelector('.lia-quiz__check').click();
        await waitFor('neutral status #' + index, () =>
          read(index).status.startsWith('Antwort gespeichert')
        );
      }
      const collected = readBoth();

      location.hash = '#3';
      const create = await waitFor(
        'submission controls',
        () => document.getElementById('lia-create-link')
      );
      setValue(document.getElementById('lia-name'), studentName);
      create.click();
      const link = await waitFor(
        'Freeze link',
        () => document.getElementById('lia-link')?.value || '',
        1_800
      );
      await waitFor('same-tab review', () =>
        document.body.classList.contains('lia-course-frozen')
        && document.body.classList.contains('lia-send-review')
        && !document.getElementById('lia-send-grading-overlay'),
      1_800);

      await visit('#2');
      await waitFor('graded Marker results', () =>
        readBoth().every(item => item.proxyValue === '1' && item.feedback.text)
      , 1_200);
      const review = readBoth();
      const evaluationBefore = await evaluation();
      await visit('#2');
      const solved = await solve(0);
      await pause(6_500);
      const afterRestoreWindow = read(0);
      await visit('#3');
      await visit('#2');
      await waitFor('solution after navigation', () => read(0).solutionCount > 0);
      const afterNavigation = read(0);
      const evaluationAfter = await evaluation();
      return {
        link,
        highlighted,
        collected,
        review,
        evaluationBefore,
        solved,
        afterRestoreWindow,
        afterNavigation,
        evaluationAfter,
      };
    };

    const runShared = async () => {
      await waitFor('shared Send review', () =>
        document.body.classList.contains('lia-shared-freeze-link')
        && document.body.classList.contains('lia-course-frozen')
        && document.body.classList.contains('lia-send-review')
      );
      await visit('#2');
      await waitFor('shared Marker results', () =>
        readBoth().every(item => item.proxyValue === '1' && item.feedback.text)
      );
      const review = readBoth();
      const evaluationBefore = await evaluation();
      await visit('#2');
      const solved = await solve(1);
      await pause(6_500);
      const afterRestoreWindow = read(1);
      await visit('#3');
      await visit('#2');
      await waitFor('shared solution after navigation', () =>
        read(1).solutionCount > 0
      );
      const afterNavigation = read(1);
      const evaluationAfter = await evaluation();
      return {
        review,
        evaluationBefore,
        solved,
        afterRestoreWindow,
        afterNavigation,
        evaluationAfter,
      };
    };

    return { runLive, runShared };
  })();
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

function assertCollect(item, label) {
  assertSidecarOwnership(item, label);
  assert(item.phase === 'collect' && item.open && item.sendLogged,
    label + ' is not neutrally logged/open: ' + JSON.stringify(item));
  assert(item.status.startsWith('Antwort gespeichert'),
    label + ' has no neutral status: ' + JSON.stringify(item));
  assert(!item.outcome && !item.outcomeClass && item.proxyValue === '',
    label + ' was graded internally before Freeze: ' + JSON.stringify(item));
  assert(!item.feedback.text && !item.feedback.visible && !item.message.text,
    label + ' exposed feedback before Freeze: ' + JSON.stringify(item));
  assert(!item.resolve.visible && item.internalSolve.exists
      && !item.internalSolve.visible,
    label + ' exposed a solution before Freeze: ' + JSON.stringify(item));
}

function assertReview(item, label, shared) {
  assertSidecarOwnership(item, label);
  assert(item.phase === 'review' && item.frozen && item.shared === shared,
    label + ' is not the expected review: ' + JSON.stringify(item));
  assert(item.proxyValue === '1' && item.correct,
    label + ' was not graded correct: ' + JSON.stringify(item));
  assert(item.feedback.text && item.feedback.visible,
    label + ' has no visible feedback: ' + JSON.stringify(item));
  assert(item.internalSolve.exists && !item.internalSolve.disabled
      && !item.internalSolve.locked,
    label + ' left the Marker solution frozen: ' + JSON.stringify(item));
  assert(!item.resolve.visible || (!item.resolve.disabled && !item.resolve.locked),
    label + ' exposes a locked native solution: ' + JSON.stringify(item));
}

function assertEvaluation(text, label) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  assert(normalized.includes('Marker A') && normalized.includes('Marker B'),
    label + ' misses a Marker tag: ' + normalized);
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
  const source = origin + '/lia-freeze-v2/tests/e2e/send-marker.md';
  const courseUrl = origin + '/liascript/index.html?'
    + encodeURIComponent(source) + '#2';

  await command('Network.clearBrowserCache');
  await command('Page.navigate', { url: courseUrl });
  await delay(1_300);
  await evaluateCall(installPageHelpers);
  const live = await evaluate(
    'window.__markerSendAudit.runLive("Marker Send Chromium")'
  );

  assert(live.link?.includes('submission%3D'),
    'No encoded Freeze link: ' + JSON.stringify(live));
  assert(live.highlighted[0].userColors.includes('red')
      && live.highlighted[1].userColors.includes('blue')
      && live.highlighted[0].scopeId !== live.highlighted[1].scopeId,
    'Correct Marker highlights/scopes are missing: '
      + JSON.stringify(live.highlighted));
  live.collected.forEach((item, index) =>
    assertCollect(item, 'Collected Marker ' + (index ? 'B' : 'A'))
  );
  live.review.forEach((item, index) =>
    assertReview(item, 'Same-tab Marker ' + (index ? 'B' : 'A'), false)
  );
  assertEvaluation(live.evaluationBefore, 'Same-tab evaluation before solve');
  assert(live.solved.after.solutionCount > 0
      && live.afterRestoreWindow.solutionCount > 0
      && live.afterNavigation.solutionCount > 0,
    'Same-tab Marker model solution did not persist: '
      + JSON.stringify({
        solved: live.solved,
        restore: live.afterRestoreWindow,
        navigation: live.afterNavigation,
      }));
  assertEvaluation(live.evaluationAfter, 'Same-tab evaluation after solve');

  await command('Page.navigate', { url: live.link });
  await delay(1_500);
  await evaluateCall(installPageHelpers);
  const shared = await evaluate('window.__markerSendAudit.runShared()');

  shared.review.forEach((item, index) =>
    assertReview(item, 'Shared Marker ' + (index ? 'B' : 'A'), true)
  );
  assertEvaluation(shared.evaluationBefore, 'Shared evaluation before solve');
  assert(shared.solved.after.solutionCount > 0
      && shared.afterRestoreWindow.solutionCount > 0
      && shared.afterNavigation.solutionCount > 0,
    'Shared Marker model solution did not persist: ' + JSON.stringify(shared));
  assertEvaluation(shared.evaluationAfter, 'Shared evaluation after solve');

  console.log(JSON.stringify({
    ok: true,
    courseUrl,
    freezeLinkLength: live.link.length,
    collect: {
      proxyValues: live.collected.map(item => item.proxyValue),
      neutral: live.collected.map(item => item.status),
      feedbackHidden: live.collected.every(item => !item.feedback.visible),
      solutionsHidden: live.collected.every(item =>
        !item.resolve.visible && !item.internalSolve.visible
      ),
    },
    sameTab: {
      results: live.review.map(item => item.proxyValue),
      feedbackVisible: live.review.every(item => item.feedback.visible),
      modelSolutionPersistent: live.afterNavigation.solutionCount > 0,
      score: '5/5',
    },
    shared: {
      results: shared.review.map(item => item.proxyValue),
      feedbackVisible: shared.review.every(item => item.feedback.visible),
      modelSolutionPersistent: shared.afterNavigation.solutionCount > 0,
      scoreStableAfterSolve: true,
    },
  }, null, 2));
}

const overallTimer = setTimeout(() => {
  console.error('Overall Marker Send E2E timeout');
  socket.close();
  process.exitCode = 1;
}, 360_000);

run().then(() => {
  clearTimeout(overallTimer);
  socket.close();
}).catch(error => {
  clearTimeout(overallTimer);
  console.error(error?.stack || error);
  socket.close();
  process.exitCode = 1;
});
