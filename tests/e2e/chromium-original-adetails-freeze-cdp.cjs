/*
 * Focused real-Chromium regression for the four standalone @ADetails cases
 * that originally disappeared from the frozen evaluation:
 *
 *   #10 Geography=Berlin and Astronomy=Jupiter
 *   #14 OCR=3
 *   #15 Coordinates: A=(1,4)
 *
 * Open the local README.md course in Chromium and pass that page's CDP
 * websocket URL as the only argument.  The runner uses that page only to
 * discover the local course URL, then creates and disposes its own incognito
 * BrowserContext and target.
 */

const endpoint = process.argv[2];
if (!endpoint) {
  console.error('Usage: node chromium-original-adetails-freeze-cdp.cjs <page-websocket-url>');
  process.exit(2);
}

const socket = new WebSocket(endpoint);
let browserSocket = null;
const pending = new Map();
const browserErrors = [];
let nextId = 1;
let activeSessionId = null;
let browserContextId = null;
let targetId = null;

function sendCommand(transport, method, params, sessionId) {
  return new Promise((resolve, reject) => {
    if (!transport || transport.readyState !== 1) {
      reject(new Error('CDP socket is not open for ' + method));
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP command timed out: ' + method));
    }, 90_000);
    pending.set(id, { resolve, reject, timer });
    transport.send(JSON.stringify({
      id,
      method,
      params,
      ...(sessionId ? { sessionId } : {}),
    }));
  });
}

function command(method, params = {}, sessionId = activeSessionId) {
  const transport = sessionId ? browserSocket : socket;
  return sendCommand(transport, method, params, sessionId);
}

function sessionCommand(method, params = {}) {
  if (!activeSessionId) {
    return Promise.reject(new Error('No flattened target session for ' + method));
  }
  return command(method, params, activeSessionId);
}

function browserCommand(method, params = {}) {
  return sendCommand(browserSocket, method, params, null);
}

async function evaluate(expression, sessionId = activeSessionId) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, sessionId);
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

async function connectBrowserTransport() {
  const pageEndpoint = new URL(endpoint);
  const protocol = pageEndpoint.protocol === 'wss:' ? 'https:' : 'http:';
  const response = await fetch(protocol + '//' + pageEndpoint.host + '/json/version');
  if (!response.ok) {
    throw new Error('Could not discover browser CDP endpoint: HTTP ' + response.status);
  }
  const version = await response.json();
  const browserEndpoint = version.webSocketDebuggerUrl;
  assert(browserEndpoint, 'Chromium /json/version did not expose a browser websocket');

  browserSocket = new WebSocket(browserEndpoint);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser CDP socket timed out')), 20_000);
    browserSocket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    browserSocket.addEventListener('error', event => {
      clearTimeout(timer);
      reject(event instanceof Error ? event : new Error('Browser CDP socket failed'));
    }, { once: true });
  });
  browserSocket.addEventListener('message', handleProtocolMessage);
  browserSocket.addEventListener('error', rejectPendingCommands);
}

function remoteObjectText(value) {
  if (!value || typeof value !== 'object') return String(value ?? '');
  if (Object.prototype.hasOwnProperty.call(value, 'value')) {
    try { return typeof value.value === 'string' ? value.value : JSON.stringify(value.value); }
    catch { return String(value.value); }
  }
  return value.description || value.unserializableValue || value.className || value.type || '';
}

function captureProtocolEvent(message) {
  if (!activeSessionId || message.sessionId !== activeSessionId) return;

  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params?.exceptionDetails || {};
    browserErrors.push({
      kind: 'exception',
      text: details.exception?.description || details.text || 'Runtime exception',
      url: details.url || '',
      line: Number(details.lineNumber ?? -1) + 1,
    });
    return;
  }

  if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    browserErrors.push({
      kind: 'console-error',
      text: (message.params.args || []).map(remoteObjectText).filter(Boolean).join(' '),
      url: message.params.stackTrace?.callFrames?.[0]?.url || '',
      line: Number(message.params.stackTrace?.callFrames?.[0]?.lineNumber ?? -1) + 1,
    });
    return;
  }

  if (message.method === 'Log.entryAdded') {
    const entry = message.params?.entry || {};
    if (entry.level === 'error') {
      browserErrors.push({
        kind: 'log-error',
        text: entry.text || '',
        url: entry.url || '',
        line: Number(entry.lineNumber ?? 0),
        source: entry.source || '',
      });
    }
  }
}

function fatalBrowserErrors() {
  return browserErrors.filter(error =>
    error.kind === 'exception'
    || /created_by_elm|uncaught|unhandled(?:rejection)?|(?:Type|Reference|Range|Syntax)Error\b/i.test(
      error.text || ''
    )
  );
}

function assertNoFatalBrowserErrors(stage) {
  const fatal = fatalBrowserErrors();
  assert(fatal.length === 0,
    stage + ' emitted an unhandled browser error: ' + JSON.stringify(fatal, null, 2));
}

async function waitForPageUrl(expectedBase) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const href = await evaluate('location.href');
      if (typeof href === 'string' && href.startsWith(expectedBase)) return href;
    } catch {
      // The execution context can disappear while the navigation commits.
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for fresh target navigation to ' + expectedBase);
}

function handleProtocolMessage(event) {
  const message = JSON.parse(String(event.data));
  captureProtocolEvent(message);
  if (!('id' in message)) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result || {});
}

function rejectPendingCommands(error) {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
  pending.clear();
}

socket.addEventListener('message', handleProtocolMessage);
socket.addEventListener('error', rejectPendingCommands);

socket.addEventListener('open', async () => {
  let browserVersion = null;
  let sourceCourse = null;
  try {
    await connectBrowserTransport();
    browserVersion = await browserCommand('Browser.getVersion');
    sourceCourse = await evaluate(String.raw`({
      href: location.href,
      origin: location.origin,
      protocol: location.protocol,
      hostname: location.hostname,
    })`, null);
    assert(sourceCourse && /^https?:$/.test(sourceCourse.protocol),
      'The supplied page target is not on a local HTTP origin: ' + JSON.stringify(sourceCourse));

    const courseUrl = new URL(sourceCourse.href);
    courseUrl.hash = '#10';
    const courseSourceUrl = new URL(decodeURIComponent(courseUrl.search.slice(1)));
    const immediateSourceUrl = new URL('tests/e2e/adetails-immediate.md', courseSourceUrl);
    const immediateUrl = new URL(courseUrl.origin + courseUrl.pathname);
    immediateUrl.search = '?' + immediateSourceUrl.href;
    immediateUrl.hash = '#2';
    const context = await browserCommand('Target.createBrowserContext');
    browserContextId = context.browserContextId;
    assert(browserContextId, 'Chromium did not create an incognito BrowserContext');

    const target = await browserCommand('Target.createTarget', {
      url: 'about:blank',
      browserContextId,
      background: false,
    });
    targetId = target.targetId;
    assert(targetId, 'Chromium did not create a target in the fresh BrowserContext');

    const attached = await browserCommand('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    activeSessionId = attached.sessionId;
    assert(activeSessionId, 'Chromium did not attach a flattened target session');

    await command('Runtime.enable');
    await command('Page.enable');
    await command('Log.enable');
    await command('Page.navigate', { url: immediateUrl.href });
    await waitForPageUrl(immediateUrl.href.split('#')[0]);
    await command('Page.bringToFront');

    const immediate = await evaluate(String.raw`(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitFor = async (description, predicate, attempts = 160) => {
        for (let attempt = 0; attempt < attempts; attempt++) {
          const value = predicate();
          if (value) return value;
          await pause(100);
        }
        throw new Error('Timed out waiting for ' + description + ' on ' + location.hash);
      };
      const invariant = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const click = element => {
        invariant(element instanceof HTMLElement, 'Interactive element is missing');
        element.scrollIntoView({ block: 'center', inline: 'center' });
        element.click();
      };
      const inputValue = (element, value) => {
        invariant(element instanceof HTMLInputElement, 'Expected a text input');
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )?.set;
        if (setter) setter.call(element, value);
        else element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const quizInput = quiz => quiz?.querySelector('.lia-quiz__input')
        ?? quiz?.parentElement?.querySelector('.lia-quiz__input');
      const textQuizzes = () => Array.from(document.querySelectorAll('.lia-quiz'))
        .filter(quiz => quizInput(quiz));
      const visibleNativeFeedback = quiz => Array.from(
        quiz?.querySelectorAll('.lia-quiz__feedback') || []
      ).find(element => {
        const style = getComputedStyle(element);
        return !element.hidden
          && element.getAttribute('aria-hidden') !== 'true'
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && element.getClientRects().length > 0
          && !!element.textContent?.trim();
      }) || null;
      const isCorrect = quiz => /solved|success|correct|right answer/i.test([
        quiz?.className || '',
        quiz?.querySelector('.lia-quiz__feedback')?.textContent || '',
        quiz?.innerText || '',
      ].join(' '));
      const snapshot = () => {
        const markers = Array.from(document.querySelectorAll(
          '.lia-assignment-details[data-adetails]'
        ));
        invariant(markers.length === 2, 'Expected two immediate ADetails hosts');
        invariant(document.querySelector(
          '.lia-quiz .lia-adetails-points,.lia-quiz .lia-send-status,'
          + '.lia-quiz__control .lia-adetails-points,'
          + '.lia-quiz__control .lia-send-status'
        ) === null, 'Freeze light-DOM UI leaked into an immediate quiz');
        return markers.map(marker => {
          const shadow = marker.shadowRoot;
          const badge = shadow?.querySelector('.lia-adetails-points');
          const lightNodes = Array.from(marker.childNodes);
          invariant(marker.created_by_elm === true, 'ADetails host is not Elm-declared');
          invariant(lightNodes.every(node => node.created_by_elm === true),
            'Immediate host contains a non-Elm light-DOM child');
          invariant(!marker.closest('.lia-quiz,.lia-quiz__control'),
            'Immediate ADetails host is inside a quiz subtree');
          invariant(shadow?.querySelectorAll(
            '[data-lia-freeze-adetails-sidecar]'
          ).length === 1, 'Immediate host does not own exactly one shadow sidecar');
          invariant(badge && !badge.hidden, 'Immediate ADetails badge is missing');
          return {
            marker,
            details: marker.dataset.adetails || '',
            instance: marker.dataset.adetailsInstance || '',
            owner: badge.getAttribute('data-adetails-owner') || '',
            badge: badge.textContent?.trim() || '',
          };
        });
      };
      const solve = async (index, value, label) => {
        const resolveQuiz = () => textQuizzes()[index] || null;
        const quiz = await waitFor(label + ' quiz', resolveQuiz);
        const before = { href: location.href, timeOrigin: performance.timeOrigin };
        inputValue(quizInput(quiz), value);
        await pause(80);
        click(await waitFor(
          label + ' current check',
          () => resolveQuiz()?.querySelector('.lia-quiz__check')
        ));
        let currentQuiz = resolveQuiz() || quiz;
        const feedback = await waitFor(label + ' immediate native feedback', () => {
          currentQuiz = resolveQuiz() || currentQuiz;
          return isCorrect(currentQuiz) && visibleNativeFeedback(currentQuiz);
        }, 80);
        invariant(location.href === before.href, label + ' navigated during Check');
        invariant(performance.timeOrigin === before.timeOrigin, label + ' reloaded during Check');
        return {
          label,
          kind: 'native',
          feedback: feedback.textContent?.trim() || '',
          hrefUnchanged: true,
          timeOriginUnchanged: true,
        };
      };

      await waitFor('two immediate text quizzes', () => textQuizzes().length === 2);
      await waitFor('two immediate shadow badges', () => {
        const markers = Array.from(document.querySelectorAll(
          '.lia-assignment-details[data-adetails]'
        ));
        return markers.length === 2 && markers.every(marker =>
          marker.shadowRoot?.querySelector('.lia-adetails-points:not([hidden])')
        );
      });
      const initial = snapshot();
      const initialSummary = initial.map(({ marker, ...item }) => item);
      const oldHosts = initial.map(item => item.marker);
      const checks = [
        await solve(0, 'Berlin', 'Immediate Geography'),
        await solve(1, 'Jupiter', 'Immediate Astronomy'),
      ];

      location.hash = '#3';
      await waitFor('navigation target', () => location.hash === '#3');
      await pause(250);
      invariant(oldHosts.every(marker => !marker.isConnected),
        'Immediate ADetails hosts survived slide navigation');
      location.hash = '#2';
      await waitFor('remounted immediate quizzes', () => textQuizzes().length === 2);
      await waitFor('remounted immediate badges', () =>
        document.querySelectorAll('.lia-assignment-details[data-adetails]').length === 2
      );
      const revisited = snapshot();
      const revisitedSummary = revisited.map(({ marker, ...item }) => item);
      initialSummary.forEach(item => {
        const current = revisitedSummary.find(candidate => candidate.details === item.details);
        invariant(current && current.instance === item.instance && current.owner === item.owner,
          'Immediate ADetails ID changed after remount: '
          + JSON.stringify({ initial: item, current }));
      });
      checks.push(
        await solve(0, 'Berlin', 'Immediate Geography after remount'),
        await solve(1, 'Jupiter', 'Immediate Astronomy after remount')
      );
      return { initial: initialSummary, revisited: revisitedSummary, checks };
    })()`);

    assert(immediate.initial.some(item =>
      item.details === '1,5;Tags: Geography,Capital' && item.badge === '1.5 BE'
    ), 'Quoted decimal/tag @ADetails argument was not preserved: '
      + JSON.stringify(immediate.initial));
    assert(immediate.initial.some(item =>
      item.details === '2;Astronomy' && item.badge === '2 BE'
    ), 'Second immediate @ADetails instance is missing: '
      + JSON.stringify(immediate.initial));
    assert(immediate.checks.length === 4 && immediate.checks.every(check =>
      check.kind === 'native'
      && check.feedback
      && check.hrefUnchanged
      && check.timeOriginUnchanged
    ), 'Immediate non-Send Check did not expose native feedback: '
      + JSON.stringify(immediate.checks));
    assertNoFatalBrowserErrors('Immediate ADetails checks');

    await command('Page.navigate', { url: courseUrl.href });
    await waitForPageUrl(courseUrl.href.split('#')[0]);
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
      const invariant = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const evidence = quiz => ({
        className: quiz?.className || '',
        outcome: quiz?.getAttribute('data-lia-freeze-outcome') || '',
        feedback: quiz?.querySelector('.lia-quiz__feedback')?.textContent?.trim() || '',
        text: (quiz?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 260),
      });
      const isCorrect = quiz => /solved|success|correct|right answer/i.test(
        Object.values(evidence(quiz)).join(' ')
      );
      const visibleNativeFeedback = quiz => Array.from(
        quiz?.querySelectorAll('.lia-quiz__feedback') || []
      ).find(element => {
        const style = getComputedStyle(element);
        return !element.hidden
          && element.getAttribute('aria-hidden') !== 'true'
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && element.getClientRects().length > 0
          && !!element.textContent?.trim();
      }) || null;
      const assertNativeFeedback = (quiz, label) => {
        const feedback = visibleNativeFeedback(quiz);
        invariant(feedback && isCorrect(quiz),
          label + ' has no visible native feedback before navigation: '
          + JSON.stringify(evidence(quiz)));
        return feedback.textContent.trim();
      };
      const visibleSendStatus = quiz => {
        const quizzes = Array.from(document.querySelectorAll('.lia-quiz'));
        const index = quizzes.indexOf(quiz);
        const marker = index >= 0
          ? document.querySelectorAll('.lia-assignment-details[data-adetails]')[index]
          : null;
        const status = marker?.shadowRoot?.querySelector('.lia-send-status');
        if (!status || status.hidden || !status.textContent?.trim()) return null;
        const style = getComputedStyle(status);
        return style.display !== 'none' && style.visibility !== 'hidden' ? status : null;
      };
      const visibleCheckFeedback = quiz => {
        const native = visibleNativeFeedback(quiz);
        if (native && isCorrect(quiz)) return { element: native, kind: 'native' };
        const send = visibleSendStatus(quiz);
        return send ? { element: send, kind: 'send' } : null;
      };
      const assertVisibleCheckFeedback = (quiz, label) => {
        const observed = visibleCheckFeedback(quiz);
        invariant(observed,
          label + ' has no visible native or deferred-Send feedback before navigation');
        return observed;
      };
      const sidecarSnapshot = expectedDetails => {
        const markers = Array.from(document.querySelectorAll(
          '.lia-assignment-details[data-adetails]'
        ));
        invariant(markers.length === expectedDetails.length,
          'Expected ' + expectedDetails.length + ' ADetails hosts on ' + location.hash
          + ', got ' + markers.length);
        invariant(document.querySelectorAll(
          '.lia-quiz .lia-assignment-details,'
          + '.lia-quiz .lia-adetails-sidecar,'
          + '.lia-quiz .lia-adetails-points,'
          + '.lia-quiz .lia-adetails-award-input,'
          + '.lia-quiz .lia-send-status,'
          + '.lia-quiz [data-lia-freeze-adetails-sidecar],'
          + '.lia-quiz__control .lia-assignment-details,'
          + '.lia-quiz__control .lia-adetails-sidecar,'
          + '.lia-quiz__control .lia-adetails-points,'
          + '.lia-quiz__control .lia-adetails-award-input,'
          + '.lia-quiz__control .lia-send-status,'
          + '.lia-quiz__control [data-lia-freeze-adetails-sidecar]'
        ).length === 0, 'Freeze/ADetails light-DOM node leaked into an Elm quiz subtree');

        const items = markers.map(marker => {
          const instance = marker.getAttribute('data-adetails-instance') || '';
          const shadow = marker.shadowRoot;
          const roots = shadow
            ? Array.from(shadow.querySelectorAll('[data-lia-freeze-adetails-sidecar]'))
            : [];
          const badges = shadow
            ? Array.from(shadow.querySelectorAll('.lia-adetails-points'))
            : [];
          const root = roots[0] || null;
          const badge = badges[0] || null;
          const owner = root?.getAttribute('data-adetails-owner') || '';
          const badgeOwner = badge?.getAttribute('data-adetails-owner') || '';
          const style = badge ? getComputedStyle(badge) : null;

          invariant(!marker.closest('.lia-quiz,.lia-quiz__control'),
            'ADetails host is inside an Elm-owned quiz subtree: ' + instance);
          const lightNodes = Array.from(marker.childNodes);
          invariant(marker.created_by_elm === true,
            'Declarative ADetails host is not owned by Elm: ' + instance);
          invariant(lightNodes.every(node => node.created_by_elm === true),
            'ADetails host contains a non-Elm light-DOM node: ' + instance + ' '
            + JSON.stringify(lightNodes.map(node => ({
              type: node.nodeType,
              name: node.nodeName,
              text: node.textContent,
              elm: node.created_by_elm ?? null,
            }))));
          invariant(marker.querySelector(
            '.lia-adetails-sidecar,.lia-adetails-points,.lia-adetails-award-input,'
            + '.lia-send-status,.lia-adetails-feedback,'
            + '[data-lia-freeze-adetails-sidecar]'
          ) === null, 'Freeze inserted an ADetails child into host light DOM: ' + instance);
          invariant(!!instance, 'ADetails host has no deterministic instance ID');
          invariant(roots.length === 1,
            'ADetails host ' + instance + ' has ' + roots.length + ' shadow sidecar roots');
          invariant(badges.length === 1,
            'ADetails host ' + instance + ' has ' + badges.length + ' shadow badges');
          invariant(owner && badgeOwner === owner && owner === instance,
            'ADetails owner/instance IDs disagree: '
            + JSON.stringify({ instance, owner, badgeOwner }));
          invariant(!badge.hidden && style.display !== 'none' && style.visibility !== 'hidden',
            'ADetails badge is not visible for ' + instance);

          return {
            marker,
            details: marker.dataset.adetails || '',
            instance,
            owner,
            badgeText: badge.textContent?.replace(/\s+/g, ' ').trim() || '',
            elmLightNodes: lightNodes.length,
          };
        });

        const actualDetails = items.map(item => item.details);
        expectedDetails.forEach(details => invariant(actualDetails.includes(details),
          'Missing @ADetails declaration ' + details + ': ' + JSON.stringify(actualDetails)));
        invariant(new Set(items.map(item => item.instance)).size === items.length,
          'ADetails instance IDs are not unique: ' + JSON.stringify(items));
        invariant(new Set(items.map(item => item.owner)).size === items.length,
          'ADetails owner IDs are not unique: ' + JSON.stringify(items));
        return items;
      };
      const visit = async (hash, ready) => {
        location.hash = hash;
        await waitFor(hash + ' navigation', () => location.hash === hash);
        await waitFor(hash + ' content', ready);
        await pause(350);
      };
      const checks = [];
      const textQuizzes = () => Array.from(document.querySelectorAll('.lia-quiz'))
        .filter(quiz => quizInput(quiz));
      const checkQuiz = async (resolveQuiz, label) => {
        const before = {
          href: location.href,
          timeOrigin: performance.timeOrigin,
        };
        const started = performance.now();
        const quizAtClick = await waitFor('current quiz for ' + label, resolveQuiz);
        click(await waitFor(
          'quiz check button',
          () => resolveQuiz()?.querySelector('.lia-quiz__check')
        ));
        let observed;
        let currentQuiz = quizAtClick;
        try {
          observed = await waitFor(
            'immediate visible feedback for ' + label,
            () => {
              currentQuiz = resolveQuiz() || currentQuiz;
              return visibleCheckFeedback(currentQuiz);
            },
            80
          );
        } catch (error) {
          currentQuiz = resolveQuiz() || currentQuiz;
          throw new Error((error?.message || String(error)) + ': '
            + JSON.stringify({
              evidence: evidence(currentQuiz),
              feedbackNodes: Array.from(
                currentQuiz.querySelectorAll('.lia-quiz__feedback')
              ).map(node => ({
                text: node.textContent?.trim() || '',
                hidden: node.hidden,
                className: node.className,
                display: getComputedStyle(node).display,
                visibility: getComputedStyle(node).visibility,
                rects: node.getClientRects().length,
              })),
              sendStatuses: Array.from(
                document.querySelectorAll('.lia-assignment-details[data-adetails]')
              ).map(marker => ({
                details: marker.dataset.adetails || '',
                text: marker.shadowRoot?.querySelector('.lia-send-status')
                  ?.textContent?.trim() || '',
              })),
              html: currentQuiz.outerHTML.slice(0, 3000),
            }));
        }
        await pause(180);
        invariant(location.href === before.href,
          label + ' navigated while checking: ' + before.href + ' -> ' + location.href);
        invariant(performance.timeOrigin === before.timeOrigin,
          label + ' reloaded while checking');
        const result = {
          label,
          elapsedMs: Math.round(performance.now() - started),
          feedback: observed.element.textContent?.trim() || '',
          kind: observed.kind,
          hrefUnchanged: true,
          timeOriginUnchanged: true,
        };
        checks.push(result);
        return result;
      };
      const solveTextQuiz = async (quizIndex, value, label) => {
        const resolveQuiz = () => textQuizzes()[quizIndex] || null;
        const quiz = await waitFor('text quiz ' + (quizIndex + 1), resolveQuiz);
        inputValue(quizInput(quiz), value);
        await pause(80);
        await checkQuiz(resolveQuiz, label);
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
      await waitFor('#10 ADetails shadow sidecars', () => {
        const markers = Array.from(document.querySelectorAll(
          '.lia-assignment-details[data-adetails]'
        ));
        return markers.length === 2 && markers.every(marker =>
          marker.shadowRoot?.querySelector('[data-lia-freeze-adetails-sidecar] .lia-adetails-points')
        );
      });
      const clozeQuizzes = textQuizzes();
      if (clozeQuizzes.length !== 2) {
        throw new Error('Expected exactly two standalone cloze quizzes on #10, got ' + clozeQuizzes.length);
      }
      const initialSlide10Sidecars = sidecarSnapshot(['1;Geography', '1;Astronomy']);
      const initialSlide10Hosts = initialSlide10Sidecars.map(item => item.marker);
      const initialSlide10Summary = initialSlide10Sidecars.map(({ marker, ...item }) => item);
      const slide10Details = initialSlide10Summary.map(item => item.details);
      if (!slide10Details.includes('1;Geography') || !slide10Details.includes('1;Astronomy')) {
        throw new Error('Standalone #10 @ADetails missing: ' + JSON.stringify(slide10Details));
      }
      await solveTextQuiz(0, 'Berlin', 'Geography initial check');
      await solveTextQuiz(1, 'Jupiter', 'Astronomy initial check');
      const checkedSlide10Quizzes = textQuizzes();
      assertVisibleCheckFeedback(checkedSlide10Quizzes[0], 'Geography');
      assertVisibleCheckFeedback(checkedSlide10Quizzes[1], 'Astronomy');

      await visit('#14', () => document.querySelector('.lia-quiz__input'));
      await waitFor('#14 ADetails shadow sidecar', () =>
        document.querySelector('.lia-assignment-details[data-adetails]')
          ?.shadowRoot?.querySelector('[data-lia-freeze-adetails-sidecar] .lia-adetails-points')
      );
      const slide14Sidecars = sidecarSnapshot(['1=BE;OCR']);
      const slide14Details = slide14Sidecars.map(item => item.details);
      const slide10CleanedAt14 = initialSlide10Hosts.every(marker => !marker.isConnected);
      invariant(slide10CleanedAt14,
        'Detached #10 ADetails hosts remained connected after navigation to #14');
      if (!slide14Details.includes('1=BE;OCR')) {
        throw new Error('OCR @ADetails missing on #14: ' + JSON.stringify(slide14Details));
      }
      await solveTextQuiz(0, '3', 'OCR check');
      const ocrQuiz = document.querySelector('.lia-quiz');
      assertVisibleCheckFeedback(ocrQuiz, 'OCR');

      await visit('#10', () => document.querySelectorAll('.lia-quiz__input').length >= 2);
      await waitFor('re-rendered #10 ADetails shadow sidecars', () => {
        const markers = Array.from(document.querySelectorAll(
          '.lia-assignment-details[data-adetails]'
        ));
        return markers.length === 2 && markers.every(marker =>
          marker.shadowRoot?.querySelector('[data-lia-freeze-adetails-sidecar] .lia-adetails-points')
        );
      });
      const revisitedSlide10Sidecars = sidecarSnapshot(['1;Geography', '1;Astronomy']);
      const revisitedSlide10Summary = revisitedSlide10Sidecars.map(({ marker, ...item }) => item);
      invariant(initialSlide10Hosts.every(marker => !marker.isConnected),
        'Old #10 ADetails host reconnected instead of being cleaned up');
      initialSlide10Summary.forEach(initial => {
        const revisited = revisitedSlide10Summary.find(item => item.details === initial.details);
        invariant(revisited
          && revisited.instance === initial.instance
          && revisited.owner === initial.owner,
        'ADetails instance/owner ID changed after #10 -> #14 -> #10: '
          + JSON.stringify({ initial, revisited }));
      });

      const revisitedClozeQuizzes = textQuizzes();
      invariant(revisitedClozeQuizzes.length === 2,
        'Expected exactly two cloze quizzes after returning to #10');
      await solveTextQuiz(
        0,
        'Berlin',
        'Geography check after slide re-render'
      );
      await solveTextQuiz(
        1,
        'Jupiter',
        'Astronomy check after slide re-render'
      );
      const recheckedSlide10Quizzes = textQuizzes();
      assertVisibleCheckFeedback(recheckedSlide10Quizzes[0], 'Geography after slide re-render');
      assertVisibleCheckFeedback(recheckedSlide10Quizzes[1], 'Astronomy after slide re-render');

      await visit('#15', () => window.__boards?.A1 && document.querySelector('.lia-quiz'));
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
      await checkQuiz(() => document.querySelector('.lia-quiz'), 'Coordinates check');
      const coordinateQuiz = document.querySelector('.lia-quiz');
      const coordinatePosition = {
        x: Number(point.X?.()),
        y: Number(point.Y?.()),
      };
      assertVisibleCheckFeedback(coordinateQuiz, 'Coordinates');

      location.hash = '#29';
      await pause(500);
      const createLink = await waitFor('submission controls', () => document.getElementById('lia-create-link'));
      const name = document.getElementById('lia-name');
      inputValue(name, 'Original ADetails CDP');
      click(createLink);
      const link = await waitFor('generated Freeze link', () => document.getElementById('lia-link')?.value || '');

      await visit('#10', () => textQuizzes().length === 2);
      const gradedSlide10Quizzes = textQuizzes();
      const geography = evidence(gradedSlide10Quizzes[0]);
      const astronomy = evidence(gradedSlide10Quizzes[1]);
      await visit('#14', () => document.querySelector('.lia-quiz'));
      const ocr = evidence(document.querySelector('.lia-quiz'));
      await visit('#15', () => window.__boards?.A1 && document.querySelector('.lia-quiz'));
      const gradedPoint = window.__points?.A1?.A;
      const coordinates = {
        ...evidence(document.querySelector('.lia-quiz')),
        x: Number(gradedPoint?.X?.() ?? coordinatePosition.x),
        y: Number(gradedPoint?.Y?.() ?? coordinatePosition.y),
      };
      location.hash = '#29';
      await pause(250);

      return {
        link,
        slideAtFreeze: location.hash,
        declarations: { slide10Details, slide14Details, slide15Details },
        tasks: { geography, astronomy, ocr, coordinates },
        checks,
        adetails: {
          initialSlide10: initialSlide10Summary,
          slide14: slide14Sidecars.map(({ marker, ...item }) => item),
          revisitedSlide10: revisitedSlide10Summary,
          cleanup: {
            slide10CleanedAt14,
            oldHostsDisconnectedAfterReturn: initialSlide10Hosts.every(
              marker => !marker.isConnected
            ),
          },
        },
      };
    })()`);

    assert(live.link.includes('submission%3D'), 'Created URL has no encoded submission token');
    for (const [tag, task] of Object.entries(live.tasks)) {
      assert(/solved|success|correct|right answer/i.test(Object.values(task).join(' ')),
        'Live ' + tag + ' task was not correct: ' + JSON.stringify(task));
    }
    assert(Math.abs(live.tasks.coordinates.x - 1) < 1e-6 && Math.abs(live.tasks.coordinates.y - 4) < 1e-6,
      'Live coordinate point is not (1,4): ' + JSON.stringify(live.tasks.coordinates));
    assert(live.adetails.initialSlide10.length === 2
      && live.adetails.revisitedSlide10.length === 2,
    'Expected two isolated #10 ADetails sidecars before and after navigation');
    assert(live.adetails.cleanup.slide10CleanedAt14
      && live.adetails.cleanup.oldHostsDisconnectedAfterReturn,
    'ADetails hosts were not cleaned up across #10 -> #14 -> #10: '
      + JSON.stringify(live.adetails.cleanup));
    assert(live.checks.length >= 6 && live.checks.every(check =>
      check.feedback && check.hrefUnchanged && check.timeOriginUnchanged
    ), 'A README Send check lacked visible sidecar feedback or navigated/reloaded: '
      + JSON.stringify(live.checks));

    await sessionCommand('Page.navigate', { url: live.link });
    await waitForPageUrl(live.link.split('#')[0]);
    await sessionCommand('Page.bringToFront');
    await delay(1200);

    const awardTarget = await evaluate(String.raw`(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitFor = async (description, predicate, attempts = 180) => {
        for (let attempt = 0; attempt < attempts; attempt++) {
          const value = predicate();
          if (value) return value;
          await pause(100);
        }
        throw new Error('Timed out waiting for ' + description + ' on ' + location.hash);
      };
      const resolveAward = () => {
        const hosts = Array.from(document.querySelectorAll(
          '.lia-assignment-details[data-adetails]'
        ));
        if (hosts.length !== 2) return null;
        const host = hosts.find(item => item.dataset.adetails === '1;Geography');
        const shadow = host?.shadowRoot;
        const inputs = shadow
          ? Array.from(shadow.querySelectorAll('.lia-adetails-award-input'))
          : [];
        if (!host?.isConnected || inputs.length !== 1
            || !(inputs[0] instanceof HTMLInputElement)) {
          return null;
        }
        return { host, shadow, input: inputs[0] };
      };

      await waitFor('shared Freeze mode', () =>
        document.body.classList.contains('lia-shared-freeze-link')
      );
      if (location.hash !== '#10') location.hash = '#10';
      await waitFor('#10 navigation', () => location.hash === '#10');
      await waitFor('#10 restored quizzes and award inputs', () =>
        document.querySelectorAll('.lia-quiz__input').length >= 2 && resolveAward()
      );

      let current = null;
      let stable = 0;
      for (let attempt = 0; attempt < 120 && stable < 8; attempt++) {
        const next = resolveAward();
        const sameInput = !!next && !!current
          && next.host === current.host
          && next.input === current.input;
        stable = next ? (sameInput ? stable + 1 : 1) : 0;
        current = next;
        await pause(100);
      }
      if (!current || stable < 8) {
        throw new Error('Shared Geography award input did not become stable on #10');
      }

      current.input.scrollIntoView({ block: 'center', inline: 'center' });
      await pause(200);
      const resolved = resolveAward();
      if (!resolved || resolved.input !== current.input) {
        throw new Error('Shared Geography award input remounted while scrolling into view');
      }
      const { host, shadow, input } = resolved;
      const rect = input.getBoundingClientRect();
      const style = getComputedStyle(input);
      if (rect.width <= 0 || rect.height <= 0
          || style.display === 'none'
          || style.visibility === 'hidden'
          || style.pointerEvents === 'none'
          || input.disabled
          || input.readOnly) {
        throw new Error('Shared Geography award input is not CDP-clickable');
      }
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const shadowHit = typeof shadow.elementFromPoint === 'function'
        ? shadow.elementFromPoint(x, y)
        : null;
      const documentHit = document.elementFromPoint(x, y);
      const probe = {
        host,
        input,
        initialValue: input.value,
        inputEvents: 0,
        trustedInputEvents: 0,
        changeEvents: 0,
        trustedChangeEvents: 0,
        focusEvents: 0,
        trustedFocusEvents: 0,
        blurEvents: 0,
        focusedAfterClick: false,
      };
      input.addEventListener('input', event => {
        probe.inputEvents++;
        if (event.isTrusted) probe.trustedInputEvents++;
      });
      input.addEventListener('change', event => {
        probe.changeEvents++;
        if (event.isTrusted) probe.trustedChangeEvents++;
      });
      input.addEventListener('focus', event => {
        probe.focusEvents++;
        if (event.isTrusted) probe.trustedFocusEvents++;
      });
      input.addEventListener('blur', () => {
        probe.blurEvents++;
      });
      window.__liaFreezeAwardCdpProbe = probe;

      return {
        x,
        y,
        width: rect.width,
        height: rect.height,
        details: host.dataset.adetails || '',
        instance: host.getAttribute('data-adetails-instance') || '',
        owner: input.closest('.lia-adetails-points')
          ?.getAttribute('data-adetails-owner') || '',
        initialValue: input.value,
        hitInput: shadowHit === input || documentHit === host,
      };
    })()`);

    assert(awardTarget.details === '1;Geography'
      && awardTarget.instance
      && awardTarget.owner === awardTarget.instance
      && Number(awardTarget.initialValue) === 1
      && awardTarget.width > 0
      && awardTarget.height > 0
      && awardTarget.hitInput,
    'Could not resolve a clickable shared Geography award input: '
      + JSON.stringify(awardTarget));

    const clickAwardTarget = async point => {
      await sessionCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y,
        buttons: 0,
      });
      await sessionCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      });
      await sessionCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      });
    };

    await clickAwardTarget(awardTarget);
    await delay(100);
    const awardFocus = await evaluate(String.raw`(() => {
      const probe = window.__liaFreezeAwardCdpProbe;
      if (!probe?.input?.isConnected || !probe.host?.shadowRoot) {
        throw new Error('Shared award CDP probe was detached after the mouse click');
      }
      probe.focusedAfterClick = probe.host.shadowRoot.activeElement === probe.input;
      return {
        focused: probe.focusedAfterClick,
        focusEvents: probe.focusEvents,
        trustedFocusEvents: probe.trustedFocusEvents,
      };
    })()`);
    assert(awardFocus.focused
      && awardFocus.focusEvents >= 1
      && awardFocus.trustedFocusEvents >= 1,
    'CDP mouse input did not focus the shared Shadow-DOM award input: '
      + JSON.stringify(awardFocus));

    await sessionCommand('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Control',
      code: 'ControlLeft',
      windowsVirtualKeyCode: 17,
      nativeVirtualKeyCode: 17,
      modifiers: 2,
    });
    await sessionCommand('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 2,
    });
    await sessionCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 2,
    });
    await sessionCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Control',
      code: 'ControlLeft',
      windowsVirtualKeyCode: 17,
      nativeVirtualKeyCode: 17,
    });
    await sessionCommand('Input.insertText', { text: '0.5' });
    await sessionCommand('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    await sessionCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    await delay(350);

    const keyboardAward = await evaluate(String.raw`(() => {
      const probe = window.__liaFreezeAwardCdpProbe;
      if (!probe?.input?.isConnected || !probe.host?.shadowRoot) {
        throw new Error('Shared award CDP probe was detached after keyboard input');
      }
      const rect = probe.input.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
        value: probe.input.value,
        inputEvents: probe.inputEvents,
        trustedInputEvents: probe.trustedInputEvents,
        changeEvents: probe.changeEvents,
        trustedChangeEvents: probe.trustedChangeEvents,
        focusEvents: probe.focusEvents,
        trustedFocusEvents: probe.trustedFocusEvents,
        blurEvents: probe.blurEvents,
        focusedAfterClick: probe.focusedAfterClick,
        focused: probe.host.shadowRoot.activeElement === probe.input,
      };
    })()`);
    assert(keyboardAward.value === '0.5'
      && keyboardAward.inputEvents >= 1
      && keyboardAward.trustedInputEvents >= 1
      && keyboardAward.changeEvents >= 1
      && keyboardAward.trustedChangeEvents >= 1
      && keyboardAward.focusEvents >= 1
      && keyboardAward.trustedFocusEvents >= 1
      && keyboardAward.blurEvents >= 1
      && keyboardAward.focusedAfterClick
      && keyboardAward.width > 0
      && keyboardAward.height > 0
      && !keyboardAward.focused,
    'CDP keyboard/input sequence did not replace and commit the award value: '
      + JSON.stringify(keyboardAward));

    // Re-focus without changing the value so the final shared snapshot also
    // proves that the real CDP pointer path reaches the open ShadowRoot input.
    await clickAwardTarget(keyboardAward);
    await delay(100);

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
          reviewResolve: control.matches('.lia-quiz__resolve'),
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
      const awardInputSnapshot = host => {
        const shadow = host?.shadowRoot;
        const inputs = shadow
          ? Array.from(shadow.querySelectorAll('.lia-adetails-award-input'))
          : [];
        if (inputs.length !== 1 || !(inputs[0] instanceof HTMLInputElement)) {
          throw new Error('Expected one Shadow-DOM award input for '
            + (host?.dataset.adetails || 'unknown ADetails'));
        }
        const input = inputs[0];
        const probe = window.__liaFreezeAwardCdpProbe;
        if (!probe || probe.host !== host || probe.input !== input) {
          throw new Error('Shared award input is not the CDP-edited Shadow-DOM input');
        }
        const style = getComputedStyle(input);
        return {
          method: 'cdp',
          details: host.dataset.adetails || '',
          instance: host.getAttribute('data-adetails-instance') || '',
          owner: input.closest('.lia-adetails-points')
            ?.getAttribute('data-adetails-owner') || '',
          initialValue: probe.initialValue,
          value: input.value,
          inputEvents: probe.inputEvents,
          trustedInputEvents: probe.trustedInputEvents,
          changeEvents: probe.changeEvents,
          trustedChangeEvents: probe.trustedChangeEvents,
          focusEvents: probe.focusEvents,
          trustedFocusEvents: probe.trustedFocusEvents,
          blurEvents: probe.blurEvents,
          focusedAfterClick: probe.focusedAfterClick,
          disabled: input.disabled,
          readOnly: input.readOnly,
          pointerEvents: style.pointerEvents,
          visible: !input.hidden
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && input.getClientRects().length > 0,
          focused: shadow.activeElement === input,
        };
      };

      await visit('#10', () => document.querySelectorAll('.lia-quiz__input').length >= 2);
      const awardHosts = await waitFor('two shared ADetails award inputs', () => {
        const hosts = Array.from(document.querySelectorAll(
          '.lia-assignment-details[data-adetails]'
        ));
        return hosts.length === 2 && hosts.every(host =>
          host.shadowRoot?.querySelectorAll('.lia-adetails-award-input').length === 1
        ) ? hosts : null;
      });
      if (awardHosts.some(host => host.closest('.lia-quiz,.lia-quiz__control'))) {
        throw new Error('Shared ADetails host leaked into an Elm-owned quiz subtree');
      }
      const geographyAwardHost = awardHosts.find(
        host => host.dataset.adetails === '1;Geography'
      );
      const awardEdit = awardInputSnapshot(geographyAwardHost);
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
        const manuallyAwarded = tag === 'Geography';
        return {
          tag,
          found: offset >= 0,
          block,
          correct: manuallyAwarded
            ? /Correct\s+0[.,]5\b/i.test(block)
            : /Correct\s+1(?:\.0+)?\b/i.test(block),
          wrong: manuallyAwarded
            ? /Wrong\s+0[.,]5\b/i.test(block)
            : /Wrong\s+0(?:\.0+)?\b/i.test(block),
          achieved: manuallyAwarded
            ? /Achieved\s+0[.,]5\s+of\s+1(?:\.0+)?\b/i.test(block)
            : /Achieved\s+1(?:\.0+)?\s+of\s+1(?:\.0+)?\b/i.test(block),
          score: manuallyAwarded
            ? /Score\s+50\s*%/i.test(block)
            : /Score\s+100\s*%/i.test(block),
        };
      });

      return {
        href: location.href,
        bodyClasses,
        tasks: { geography, astronomy, ocr, coordinates },
        awardEdit,
        tagChecks,
        evaluationVisible: evaluation.style.display === 'block',
        evaluationExcerpt: evaluationText.replace(/\s+/g, ' ').slice(0, 900),
      };
    })()`);

    assert(/lia-shared-freeze-link/.test(shared.bodyClasses),
      'Shared-link body class is missing: ' + shared.bodyClasses);
    assert(/lia-course-frozen/.test(shared.bodyClasses),
      'Shared course is not globally frozen: ' + shared.bodyClasses);
    assert(shared.awardEdit.method === 'cdp'
      && shared.awardEdit.details === '1;Geography'
      && Number(shared.awardEdit.initialValue) === 1
      && shared.awardEdit.value === '0.5'
      && shared.awardEdit.inputEvents >= 1
      && shared.awardEdit.trustedInputEvents >= 1
      && shared.awardEdit.changeEvents >= 1
      && shared.awardEdit.trustedChangeEvents >= 1
      && shared.awardEdit.focusEvents >= 2
      && shared.awardEdit.trustedFocusEvents >= 2
      && shared.awardEdit.blurEvents >= 1
      && shared.awardEdit.focusedAfterClick,
    'Shared Shadow-DOM award input did not preserve genuine CDP input/change/focus: '
      + JSON.stringify(shared.awardEdit));
    assert(shared.awardEdit.instance
      && shared.awardEdit.owner === shared.awardEdit.instance
      && !shared.awardEdit.disabled
      && !shared.awardEdit.readOnly
      && shared.awardEdit.pointerEvents !== 'none'
      && shared.awardEdit.visible
      && shared.awardEdit.focused,
    'Shared Shadow-DOM award input is not editable: '
      + JSON.stringify(shared.awardEdit));

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
      assert(task.controls.length > 0
        && task.controls.filter(control => !control.reviewResolve)
          .every(control => control.locked)
        && task.controls.filter(control => !control.locked)
          .every(control => control.reviewResolve),
        'Shared ' + tag + ' controls are not locked: ' + JSON.stringify(task.controls));
    }

    const coordinate = shared.tasks.coordinates;
    assert(/solved|success|correct|right answer/i.test(
      [coordinate.className, coordinate.outcome, coordinate.feedback, coordinate.text].join(' ')
    ), 'Shared Coordinates task is not correct: ' + JSON.stringify(coordinate));
    assert(Math.abs(coordinate.x - 1) < 1e-6 && Math.abs(coordinate.y - 4) < 1e-6,
      'Shared coordinate point was not restored to (1,4): ' + JSON.stringify(coordinate));
    assert(coordinate.controls.filter(control => !control.reviewResolve)
      .every(control => control.locked)
      && coordinate.controls.filter(control => !control.locked)
        .every(control => control.reviewResolve)
      && coordinate.coordinateControls.filter(control => !control.reviewResolve)
        .every(control => control.locked)
      && coordinate.coordinateControls.filter(control => !control.locked)
        .every(control => control.reviewResolve),
      'Shared coordinate controls are not locked: ' + JSON.stringify(coordinate));
    assert(coordinate.pointFixed || coordinate.boardPointerEvents === 'none' || coordinate.boardFreezeLocked === '1',
      'Shared coordinate board/point is not locked: ' + JSON.stringify(coordinate));

    assert(shared.evaluationVisible, 'Evaluation did not open in shared mode');
    assert(shared.tagChecks.length === 4, 'Expected four evaluation tag checks');
    for (const check of shared.tagChecks) {
      assert(check.found && check.correct && check.wrong && check.achieved && check.score,
        'Evaluation is wrong for ' + check.tag + ': ' + JSON.stringify(check));
    }

    assertNoFatalBrowserErrors('ADetails live/shared round trip');

    process.stdout.write(JSON.stringify({
      browser: {
        product: browserVersion.product || '',
        protocolVersion: browserVersion.protocolVersion || '',
        sourceOrigin: sourceCourse.origin,
        freshBrowserContext: true,
      },
      immediate,
      live: {
        slideAtFreeze: live.slideAtFreeze,
        linkLength: live.link.length,
        declarations: live.declarations,
        tasks: live.tasks,
        checks: live.checks,
        adetails: live.adetails,
      },
      shared: {
        bodyClasses: shared.bodyClasses,
        tasks: shared.tasks,
        awardEdit: shared.awardEdit,
        tagChecks: shared.tagChecks,
        evaluationExcerpt: shared.evaluationExcerpt,
      },
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
    const sessionId = activeSessionId;
    activeSessionId = null;
    if (sessionId) {
      await browserCommand('Target.detachFromTarget', { sessionId }).catch(() => undefined);
    }
    if (targetId) {
      await browserCommand('Target.closeTarget', { targetId }).catch(() => undefined);
      targetId = null;
    }
    if (browserContextId) {
      await browserCommand('Target.disposeBrowserContext', { browserContextId }).catch(() => undefined);
      browserContextId = null;
    }
    browserSocket?.close();
    socket.close();
  }
});
