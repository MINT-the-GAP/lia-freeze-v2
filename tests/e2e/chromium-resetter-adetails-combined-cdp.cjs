/*
 * Real LiaScript ownership regression for the unpublished Resetter fix
 * eead3d7f4ff93888eac8a970be4ad5951b4a81db together with lia-freeze-v2.
 */

const endpoint = process.argv[2];
if (!endpoint) {
  console.error(
    'Usage: node chromium-resetter-adetails-combined-cdp.cjs <page-websocket-url>'
  );
  process.exit(2);
}

const RESETTER_FIX = 'eead3d7f4ff93888eac8a970be4ad5951b4a81db';
const socket = new WebSocket(endpoint);
const pending = new Map();
const browserErrors = [];
let nextId = 1;

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      'Chromium evaluation failed: ' + JSON.stringify(result.exceptionDetails)
    );
  }
  return result.result?.value;
}

function evaluateCall(fn, ...args) {
  const serialized = args.map(value => JSON.stringify(value)).join(',');
  return evaluate('(' + fn.toString() + ')(' + serialized + ')');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function trustedClick(point) {
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

function fatalBrowserErrors() {
  return browserErrors.filter(entry =>
    /created_by_elm|uncaught|typeerror|referenceerror|rangeerror/i.test(entry.text)
  );
}

function assertOwnership(state, label) {
  assert(state.ready, label + ' is not ready: ' + JSON.stringify(state));
  assert(state.resetHostOutside && state.detailsHostOutside,
    label + ' host leaked into the Elm quiz: ' + JSON.stringify(state));
  assert(state.resetLightElements === 0 && state.detailsLightElements === 0,
    label + ' has template-owned light-DOM elements: ' + JSON.stringify(state));
  assert(state.resetButtons === 1 && state.detailsRoots === 1,
    label + ' duplicated a shadow sidecar: ' + JSON.stringify(state));
  assert(state.badge === '2 BE',
    label + ' lost the ADetails badge: ' + JSON.stringify(state));
  assert(state.quizForbidden === 0 && state.controlForbidden === 0,
    label + ' injected a template node into the quiz/control: '
      + JSON.stringify(state));
}

socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params?.exceptionDetails;
    browserErrors.push({
      source: 'exception',
      text: details?.exception?.description || details?.text || 'Runtime exception',
    });
  } else if (
    message.method === 'Runtime.consoleAPICalled'
    && message.params?.type === 'error'
  ) {
    browserErrors.push({
      source: 'console',
      text: (message.params.args || [])
        .map(arg => arg.value ?? arg.description ?? '')
        .join(' '),
    });
  } else if (
    message.method === 'Log.entryAdded'
    && message.params?.entry?.level === 'error'
  ) {
    browserErrors.push({
      source: 'log',
      text: message.params.entry.text || 'Log error',
    });
  }

  if (!('id' in message)) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result || {});
});
socket.addEventListener('error', error => {
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
});

socket.addEventListener('open', async () => {
  try {
    await command('Runtime.enable');
    await command('Log.enable');
    await command('Page.enable');

    const origin = await evaluate('location.origin');
    assert(/^https?:\/\//.test(origin), 'The supplied target has no HTTP origin');
    const source = origin
      + '/lia-freeze-v2/tests/e2e/resetter-adetails-combined.md';
    const courseUrl = origin + '/liascript/index.html?'
      + encodeURIComponent(source) + '#1';
    await command('Page.navigate', { url: courseUrl });

    const initial = await evaluateCall(async function () {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const read = () => {
        const quiz = document.querySelector('.lia-quiz');
        const control = quiz?.querySelector('.lia-quiz__control');
        const resetHost = document.querySelector('[data-lia-resetter]');
        const detailsHost = document.querySelector(
          '.lia-assignment-details[data-adetails]'
        );
        const resetButtons = resetHost?.shadowRoot
          ? Array.from(resetHost.shadowRoot.querySelectorAll(
            'input.lia-resetter__button[type="button"]'
          ))
          : [];
        const detailsRoots = detailsHost?.shadowRoot
          ? Array.from(detailsHost.shadowRoot.querySelectorAll(
            '[data-lia-freeze-adetails-sidecar]'
          ))
          : [];
        const badge = detailsRoots[0]?.querySelector('.lia-adetails-points');
        const forbidden = [
          '[data-lia-resetter]',
          '.lia-resetter__button',
          '.lia-adetails-points',
          '.lia-adetails-sidecar',
          '.lia-adetails-feedback',
          '.lia-send-status',
          '[data-lia-freeze-adetails-sidecar]',
        ].join(',');
        return {
          ready: !!quiz
            && !!control
            && resetButtons.length === 1
            && detailsRoots.length === 1
            && badge?.textContent?.trim() === '2 BE',
          quizClass: quiz?.className || '',
          resetHostOutside: !!resetHost
            && !resetHost.closest('.lia-quiz,.lia-quiz__control'),
          detailsHostOutside: !!detailsHost
            && !detailsHost.closest('.lia-quiz,.lia-quiz__control'),
          resetLightElements: resetHost?.childElementCount ?? -1,
          detailsLightElements: detailsHost?.childElementCount ?? -1,
          resetButtons: resetButtons.length,
          detailsRoots: detailsRoots.length,
          badge: badge?.textContent?.trim() || '',
          quizForbidden: quiz?.querySelectorAll(forbidden).length ?? -1,
          controlForbidden: control?.querySelectorAll(forbidden).length ?? -1,
        };
      };
      for (let attempt = 0; attempt < 600; attempt++) {
        const state = read();
        if (state.ready) return state;
        await pause(100);
      }
      throw new Error(
        'Timed out waiting for combined Resetter/ADetails ownership at '
          + location.href
      );
    });
    assertOwnership(initial, 'Initial combination');

    const checkOnce = async label => {
      const before = await evaluateCall(async function () {
        const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
        for (let attempt = 0; attempt < 200; attempt++) {
          const button = document.querySelector('.lia-quiz__check');
          if (button instanceof HTMLElement) {
            button.scrollIntoView({ block: 'center', inline: 'center' });
            await pause(120);
            const rect = button.getBoundingClientRect();
            const point = {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            };
            const hit = document.elementFromPoint(point.x, point.y);
            if (
              (hit === button || hit?.closest?.('.lia-quiz__check') === button)
              && getComputedStyle(button).pointerEvents !== 'none'
            ) {
              return {
                point,
                href: location.href,
                timeOrigin: performance.timeOrigin,
              };
            }
          }
          await pause(100);
        }
        return null;
      });
      assert(before?.point, label + ' Check button is missing');
      const startedAt = Date.now();
      await trustedClick(before.point);
      const result = await evaluateCall(async function (prior) {
        const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
        const renderedText = element => {
          if (!(element instanceof HTMLElement)) return '';
          const style = getComputedStyle(element);
          return !element.hidden
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && element.getClientRects().length > 0
            ? element.textContent?.trim() || ''
            : '';
        };
        for (let attempt = 0; attempt < 100; attempt++) {
          const quiz = document.querySelector('.lia-quiz');
          const marker = document.querySelector(
            '.lia-assignment-details[data-adetails]'
          );
          const shadowFeedback = marker?.shadowRoot?.querySelector(
            '.lia-adetails-feedback'
          );
          const nativeFeedback = quiz?.querySelector('.lia-quiz__feedback');
          const text = renderedText(shadowFeedback) || renderedText(nativeFeedback);
          if (text) {
            return {
              text,
              quizClass: quiz?.className || '',
              hrefUnchanged: location.href === prior.href,
              timeOriginUnchanged: performance.timeOrigin === prior.timeOrigin,
            };
          }
          await pause(50);
        }
        throw new Error('No immediate Check feedback at ' + location.href);
      }, before);
      return { ...result, elapsedMs: Date.now() - startedAt };
    };

    const firstCheck = await checkOnce('First');
    assert(firstCheck.hrefUnchanged && firstCheck.timeOriginUnchanged,
      'First Check navigated or reloaded: ' + JSON.stringify(firstCheck));
    assert(firstCheck.elapsedMs < 5_000,
      'First Check feedback was not immediate: ' + JSON.stringify(firstCheck));

    const resetTarget = await evaluateCall(async function () {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (let attempt = 0; attempt < 200; attempt++) {
        const host = document.querySelector('[data-lia-resetter]');
        const button = host?.shadowRoot?.querySelector(
          'input.lia-resetter__button[type="button"]'
        );
        if (button instanceof HTMLElement) {
          button.scrollIntoView({ block: 'center', inline: 'center' });
          await pause(120);
          const rect = button.getBoundingClientRect();
          const point = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
          const root = button.getRootNode();
          const hit = root?.elementFromPoint?.(point.x, point.y)
            || document.elementFromPoint(point.x, point.y);
          if (hit === button && getComputedStyle(button).pointerEvents !== 'none') {
            return point;
          }
        }
        await pause(100);
      }
      return null;
    });
    assert(resetTarget, 'Resetter Shadow button is missing');
    await trustedClick(resetTarget);

    const afterReset = await evaluateCall(async function () {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const renderedText = element => {
        if (!(element instanceof HTMLElement)) return '';
        const style = getComputedStyle(element);
        return !element.hidden
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && element.getClientRects().length > 0
          ? element.textContent?.trim() || ''
          : '';
      };
      for (let attempt = 0; attempt < 200; attempt++) {
        const quiz = document.querySelector('.lia-quiz');
        const check = quiz?.querySelector('.lia-quiz__check');
        const marker = document.querySelector(
          '.lia-assignment-details[data-adetails]'
        );
        const nativeText = renderedText(
          quiz?.querySelector('.lia-quiz__feedback')
        );
        const shadowText = renderedText(
          marker?.shadowRoot?.querySelector('.lia-adetails-feedback')
        );
        const reset = document.querySelector('[data-lia-resetter]')
          ?.shadowRoot?.querySelector('input.lia-resetter__button');
        const quizClass = quiz?.className || '';
        const open = /\bopen\b/i.test(quizClass)
          && !/\b(?:solved|resolved|failed|success)\b/i.test(quizClass);
        if (
          open
          && check instanceof HTMLElement
          && !nativeText
          && !shadowText
          && reset instanceof HTMLInputElement
          && !reset.disabled
        ) {
          return { reset: true, quizClass };
        }
        await pause(50);
      }
      return {
        reset: false,
        quizClass: document.querySelector('.lia-quiz')?.className || '',
      };
    });
    assert(afterReset.reset,
      'Resetter did not reopen and clear the quiz: ' + JSON.stringify(afterReset));

    const secondCheck = await checkOnce('Second');
    assert(secondCheck.hrefUnchanged && secondCheck.timeOriginUnchanged,
      'Second Check navigated or reloaded: ' + JSON.stringify(secondCheck));
    assert(secondCheck.elapsedMs < 5_000,
      'Second Check feedback was not immediate: ' + JSON.stringify(secondCheck));

    const finalState = await evaluateCall(function () {
      const quiz = document.querySelector('.lia-quiz');
      const control = quiz?.querySelector('.lia-quiz__control');
      const resetHost = document.querySelector('[data-lia-resetter]');
      const detailsHost = document.querySelector(
        '.lia-assignment-details[data-adetails]'
      );
      const resetButtons = resetHost?.shadowRoot
        ? Array.from(resetHost.shadowRoot.querySelectorAll(
          'input.lia-resetter__button[type="button"]'
        ))
        : [];
      const detailsRoots = detailsHost?.shadowRoot
        ? Array.from(detailsHost.shadowRoot.querySelectorAll(
          '[data-lia-freeze-adetails-sidecar]'
        ))
        : [];
      const badge = detailsRoots[0]?.querySelector('.lia-adetails-points');
      const forbidden = '[data-lia-resetter],.lia-resetter__button,'
        + '.lia-adetails-points,.lia-adetails-sidecar,.lia-adetails-feedback,'
        + '.lia-send-status,[data-lia-freeze-adetails-sidecar]';
      return {
        ready: !!quiz
          && !!control
          && resetButtons.length === 1
          && detailsRoots.length === 1
          && badge?.textContent?.trim() === '2 BE',
        resetHostOutside: !!resetHost
          && !resetHost.closest('.lia-quiz,.lia-quiz__control'),
        detailsHostOutside: !!detailsHost
          && !detailsHost.closest('.lia-quiz,.lia-quiz__control'),
        resetLightElements: resetHost?.childElementCount ?? -1,
        detailsLightElements: detailsHost?.childElementCount ?? -1,
        resetButtons: resetButtons.length,
        detailsRoots: detailsRoots.length,
        badge: badge?.textContent?.trim() || '',
        quizForbidden: quiz?.querySelectorAll(forbidden).length ?? -1,
        controlForbidden: control?.querySelectorAll(forbidden).length ?? -1,
      };
    });
    assertOwnership(finalState, 'Final combination');

    await delay(300);
    const fatal = fatalBrowserErrors();
    assert(fatal.length === 0,
      'Unhandled browser errors: ' + JSON.stringify(fatal));

    process.stdout.write(JSON.stringify({
      ok: true,
      resetterFix: RESETTER_FIX,
      courseUrl,
      ownership: finalState,
      firstCheck,
      afterReset,
      secondCheck,
      capturedBrowserErrors: browserErrors,
    }, null, 2));
  } catch (error) {
    console.error(error.stack || String(error));
    const fatal = fatalBrowserErrors();
    if (fatal.length) {
      console.error('Captured browser errors:\n' + JSON.stringify(fatal, null, 2));
    }
    process.exitCode = 1;
  } finally {
    socket.close();
  }
});
