/*
 * Real-Chromium round trip for coordinate-proposal-combined.md.
 *
 * The rectangle is constructed through trusted CDP mouse input only: open the
 * DGS menu, select the polygon tool, and click the five board positions that
 * close (0,0) -> (4,0) -> (4,3) -> (0,3) -> (0,0).
 *
 * Usage:
 *   node tests/e2e/chromium-coordinate-combined-freeze-cdp.cjs \
 *     <page-websocket-url> [course-url]
 *
 * When course-url is omitted, the runner navigates the target to the fixture
 * served by localhost:8000 (or by the HTTP origin already open in the target).
 */

const { gunzipSync } = require('node:zlib');

const endpoint = process.argv[2];
const explicitCourseUrl = process.argv[3] || '';

if (!endpoint) {
  console.error(
    'Usage: node chromium-coordinate-combined-freeze-cdp.cjs ' +
    '<page-websocket-url> [course-url]'
  );
  process.exit(2);
}

const BOARD_ID = 'coord_combined';
const QUIZ_TAGS = [
  ['KoordQuiz', 1],
  ['GeometrieQuiz', 2],
  ['CoordinateQuiz', 4],
  ['GeometryQuiz', 8],
];
const EXPECTED_VERTICES = [[0, 0], [4, 0], [4, 3], [0, 3]];
const COMMAND_TIMEOUT_MS = 90_000;
const OVERALL_TIMEOUT_MS = 300_000;

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

function fromBase64Url(value) {
  let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  return Buffer.from(normalized, 'base64');
}

function decodeSubmissionPayload(link) {
  const outer = new URL(link);
  const embedded = new URL(decodeURIComponent(outer.search.slice(1)));
  const match = embedded.hash.match(/^#submission=([^#&]+)/);
  if (!match) throw new Error('Freeze link has no submission token');
  const token = decodeURIComponent(match[1]);
  const json = token.startsWith('gz:')
    ? gunzipSync(fromBase64Url(token.slice(3))).toString('utf8')
    : fromBase64Url(token).toString('utf8');
  return JSON.parse(json);
}

function dgsSnapshotFromPayload(payload, boardId) {
  for (const slide of Array.isArray(payload?.s) ? payload.s : []) {
    const value = slide?.coord?.d?.[boardId];
    if (value && Array.isArray(value.records)) return value;
  }
  return null;
}

function polygonGeometry(snapshot) {
  const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
  const polygon = records.find(record => record?.type === 'polygon' && record?.origin !== 'macro');
  if (!polygon) return null;
  const pointRecords = records.filter(record => record?.type === 'point');
  const byId = new Map(pointRecords.map(record => [String(record.id || ''), record]));
  const byName = new Map(pointRecords.map(record => [String(record.name || ''), record]));
  const vertices = (Array.isArray(polygon.points) ? polygon.points : []).map(reference => {
    const point = byId.get(String(reference?.id || ''))
      || byName.get(String(reference?.name || ''));
    return point ? [Number(point.x), Number(point.y)] : [NaN, NaN];
  });
  return { polygon, vertices, records: records.length };
}

function assertRectangle(geometry, label) {
  assert(geometry, label + ' has no learner-created polygon');
  assert(geometry.vertices.length === EXPECTED_VERTICES.length,
    label + ' polygon has ' + geometry.vertices.length + ' vertices: ' +
    JSON.stringify(geometry.vertices));
  EXPECTED_VERTICES.forEach((expected, index) => {
    const actual = geometry.vertices[index];
    assert(
      Math.abs(actual[0] - expected[0]) < 0.08 && Math.abs(actual[1] - expected[1]) < 0.08,
      label + ' vertex #' + index + ' is not ' + JSON.stringify(expected) + ': ' +
      JSON.stringify(actual)
    );
  });
}

async function waitForPageAfterNavigation() {
  await delay(1_200);
  return evaluateCall(async function (boardId) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    for (let attempt = 0; attempt < 240; attempt++) {
      const board = window.__boards?.[boardId];
      const root = board?.containerObj?.getRootNode?.();
      const menu = root?.querySelector?.('.lia-dgs-menu-button');
      const quizzes = document.querySelectorAll('.lia-quiz');
      if (location.hash === '#2' && board?.containerObj?.isConnected && menu && quizzes.length >= 4) {
        return {
          hash: location.hash,
          quizCount: quizzes.length,
          details: Array.from(document.querySelectorAll('.lia-assignment-details'))
            .map(item => item.dataset.adetails || ''),
          combinedReady: typeof window.__checkCombinedQuizFromSpec === 'function',
        };
      }
      await pause(100);
    }
    throw new Error('Combined coordinate fixture did not become ready: ' + location.href);
  }, BOARD_ID);
}

async function visibleButtonPoint(kind) {
  return evaluateCall(async function (boardId, requestedKind) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const find = () => {
      const board = window.__boards?.[boardId];
      const root = board?.containerObj?.getRootNode?.();
      if (!root?.querySelector) return null;
      if (requestedKind === 'menu') return root.querySelector('.lia-dgs-menu-button');
      if (requestedKind === 'shapes') {
        return root.querySelector('.lia-dgs-top-menu .lia-dgs-polygon-button');
      }
      if (requestedKind === 'polygon') {
        return Array.from(root.querySelectorAll('.lia-dgs-shape-submenu .lia-dgs-geometry-tool'))
          .find(button => /Vieleck|Polygon/i.test(button.textContent || '')) || null;
      }
      return null;
    };
    let button = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      button = find();
      if (button && getComputedStyle(button).display !== 'none') break;
      await pause(100);
    }
    if (!(button instanceof HTMLElement)) return null;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    await pause(180);
    const rect = button.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const root = window.__boards?.[boardId]?.containerObj?.getRootNode?.();
    const hit = root?.elementFromPoint?.(point.x, point.y) || document.elementFromPoint(point.x, point.y);
    return {
      point,
      hit: hit === button || hit?.closest('button') === button,
      label: button.getAttribute('aria-label') || button.title || button.textContent?.trim() || '',
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  }, BOARD_ID, kind);
}

async function boardPoints(coordinates) {
  return evaluateCall(async function (boardId, userCoordinates) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const board = window.__boards?.[boardId];
    const container = board?.containerObj;
    if (!(container instanceof HTMLElement)) return null;
    container.scrollIntoView({ block: 'center', inline: 'center' });
    await pause(250);
    const rect = container.getBoundingClientRect();
    const origin = board.origin?.scrCoords;
    if (!origin || !Number.isFinite(board.unitX) || !Number.isFinite(board.unitY)) return null;
    return userCoordinates.map(([x, y]) => {
      const point = {
        x: rect.left + Number(origin[1]) + Number(x) * Number(board.unitX),
        y: rect.top + Number(origin[2]) - Number(y) * Number(board.unitY),
      };
      const root = container.getRootNode();
      const hit = root?.elementFromPoint?.(point.x, point.y) || document.elementFromPoint(point.x, point.y);
      return {
        point,
        inside: !!hit && container.contains(hit),
        hit: hit?.className?.baseVal || hit?.className || hit?.tagName || '',
      };
    });
  }, BOARD_ID, coordinates);
}

async function quizCheckPoint(index) {
  return evaluateCall(async function (quizIndex) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    let quiz = null;
    let button = null;
    for (let attempt = 0; attempt < 120; attempt++) {
      quiz = document.querySelectorAll('.lia-quiz')[quizIndex] || null;
      button = quiz?.querySelector('.lia-quiz__check') || null;
      if (button) break;
      await pause(100);
    }
    if (!(button instanceof HTMLElement)) return null;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    await pause(160);
    const rect = button.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    return {
      point,
      hit: hit === button || hit?.closest('button') === button,
      text: button.textContent?.trim() || '',
    };
  }, index);
}

async function waitForQuizOutcome(index) {
  return evaluateCall(async function (quizIndex) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const evidence = quiz => ({
      className: quiz?.className || '',
      outcome: quiz?.getAttribute('data-lia-freeze-outcome') || '',
      feedback: quiz?.querySelector('.lia-quiz__feedback')?.textContent?.trim() || '',
      text: (quiz?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    });
    for (let attempt = 0; attempt < 160; attempt++) {
      const quiz = document.querySelectorAll('.lia-quiz')[quizIndex] || null;
      const result = evidence(quiz);
      if (/solved|success|correct|right answer/i.test(Object.values(result).join(' '))) {
        return { solved: true, ...result };
      }
      await pause(100);
    }
    const quiz = document.querySelectorAll('.lia-quiz')[quizIndex] || null;
    return { solved: false, ...evidence(quiz) };
  }, index);
}

async function run() {
  await openSocket();
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Page.bringToFront');

  const currentOrigin = await evaluate('location.origin');
  const origin = /^https?:\/\//.test(currentOrigin || '')
    ? currentOrigin
    : 'http://localhost:8000';
  const sourceUrl = origin + '/lia-freeze-v2/tests/e2e/coordinate-proposal-combined.md';
  const courseUrl = explicitCourseUrl || (
    origin + '/liascript/index.html?' + encodeURIComponent(sourceUrl) + '#2'
  );

  await command('Page.navigate', { url: courseUrl });
  const ready = await waitForPageAfterNavigation();
  assert(ready.hash === '#2', 'Expected combined quiz slide #2, got ' + ready.hash);
  assert(ready.quizCount === 4, 'Expected exactly four combined quizzes, got ' + ready.quizCount);
  assert(ready.combinedReady, 'lia-coordinate combined quiz API is not ready');
  assert(
    QUIZ_TAGS.every(([tag, points]) => ready.details.includes(points + ';' + tag)),
    'Combined quiz @ADetails declarations are incomplete: ' + JSON.stringify(ready.details)
  );

  const menu = await visibleButtonPoint('menu');
  assert(menu?.hit, 'DGS menu button is not a trusted hit target: ' + JSON.stringify(menu));
  await trustedClick(menu.point);
  await delay(180);

  const shapes = await visibleButtonPoint('shapes');
  assert(shapes?.hit, 'DGS shapes button is not a trusted hit target: ' + JSON.stringify(shapes));
  await trustedClick(shapes.point);
  await delay(180);

  const polygonTool = await visibleButtonPoint('polygon');
  assert(polygonTool?.hit,
    'DGS polygon submenu item is not a trusted hit target: ' + JSON.stringify(polygonTool));
  await trustedClick(polygonTool.point);
  await delay(180);

  const clickCoordinates = [...EXPECTED_VERTICES, EXPECTED_VERTICES[0]];
  const points = await boardPoints(clickCoordinates);
  assert(points?.length === 5, 'Could not calculate the five DGS board click positions');
  points.forEach((entry, index) => {
    assert(entry.inside,
      'DGS click #' + index + ' would miss the board: ' + JSON.stringify(entry));
  });
  for (const entry of points) {
    await trustedClick(entry.point);
    await delay(150);
  }

  const liveGeometry = await evaluateCall(async function (boardId) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    window.__persistDgsBoardState?.(boardId, false);
    for (let attempt = 0; attempt < 120; attempt++) {
      const snapshot = window.__dgsConstructionStates?.[boardId];
      if (snapshot?.records?.some(record => record?.type === 'polygon' && record?.origin !== 'macro')) {
        return snapshot;
      }
      await pause(100);
    }
    return window.__dgsConstructionStates?.[boardId] || null;
  }, BOARD_ID);
  const liveRectangle = polygonGeometry(liveGeometry);
  assertRectangle(liveRectangle, 'Live DGS snapshot');

  const liveQuizOutcomes = [];
  for (let index = 0; index < QUIZ_TAGS.length; index++) {
    const check = await quizCheckPoint(index);
    assert(check?.hit,
      'Quiz check #' + index + ' is not a trusted hit target: ' + JSON.stringify(check));
    await trustedClick(check.point);
    const outcome = await waitForQuizOutcome(index);
    assert(outcome.solved,
      'Live ' + QUIZ_TAGS[index][0] + ' was not accepted: ' + JSON.stringify(outcome));
    liveQuizOutcomes.push(outcome);
  }

  const frozen = await evaluateCall(async function (studentName) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const setValue = (element, value) => {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    location.hash = '#3';
    let create = null;
    for (let attempt = 0; attempt < 180; attempt++) {
      create = document.getElementById('lia-create-link');
      if (create) break;
      await pause(100);
    }
    if (!create) return { error: 'Submission controls not found', hash: location.hash };
    setValue(document.getElementById('lia-name'), studentName);
    create.click();
    let link = '';
    for (let attempt = 0; attempt < 240; attempt++) {
      link = document.getElementById('lia-link')?.value || '';
      if (link) break;
      await pause(100);
    }
    return { link, hash: location.hash };
  }, 'Combined Coordinate CDP');

  assert(frozen.link, 'Freeze link was not created: ' + JSON.stringify(frozen));
  assert(frozen.link.includes('submission%3D'), 'Created URL has no encoded submission token');

  const payload = decodeSubmissionPayload(frozen.link);
  const payloadSnapshot = dgsSnapshotFromPayload(payload, BOARD_ID);
  const payloadRectangle = polygonGeometry(payloadSnapshot);
  assertRectangle(payloadRectangle, 'Freeze payload DGS snapshot');

  await command('Page.navigate', { url: frozen.link });
  await delay(2_200);

  const shared = await evaluateCall(async function (boardId, tags) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = async (description, predicate, attempts = 220) => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const value = predicate();
        if (value) return value;
        await pause(100);
      }
      throw new Error('Timed out waiting for ' + description + ' at ' + location.href);
    };
    await waitFor('shared Freeze mode', () =>
      document.body.classList.contains('lia-shared-freeze-link')
      && document.body.classList.contains('lia-course-frozen')
    );

    location.hash = '#2';
    await waitFor('restored DGS board', () =>
      window.__boards?.[boardId]?.containerObj?.isConnected
      && window.__dgsConstructionStates?.[boardId]?.records?.some(record =>
        record?.type === 'polygon' && record?.origin !== 'macro'
      )
      && document.querySelectorAll('.lia-quiz').length === 4
    );

    let stable = 0;
    for (let attempt = 0; attempt < 160 && stable < 10; attempt++) {
      const snapshot = window.__dgsConstructionStates?.[boardId];
      const polygonReady = snapshot?.records?.some(record =>
        record?.type === 'polygon' && record?.origin !== 'macro'
      );
      stable = polygonReady ? stable + 1 : 0;
      await pause(100);
    }

    const snapshot = window.__dgsConstructionStates?.[boardId] || null;
    const board = window.__boards?.[boardId];
    const boardElement = board?.containerObj;
    const boardRoot = boardElement?.getRootNode?.();
    const dgsControls = Array.from(boardRoot?.querySelectorAll?.(
      '.lia-dgs-menu-button,.lia-dgs-top-menu button,.lia-dgs-geometry-submenu button'
    ) || []);
    const controlState = control => {
      const style = getComputedStyle(control);
      return {
        disabled: !!control.disabled,
        freezeLocked: control.getAttribute('data-lia-freeze-locked') || '',
        pointerEvents: style.pointerEvents,
        locked: !!control.disabled
          || control.getAttribute('data-lia-freeze-locked') === '1'
          || style.pointerEvents === 'none'
          || !!control.closest('.lia-frozen-scope'),
      };
    };
    const quizEvidence = Array.from(document.querySelectorAll('.lia-quiz')).map(quiz => ({
      className: quiz.className || '',
      outcome: quiz.getAttribute('data-lia-freeze-outcome') || '',
      feedback: quiz.querySelector('.lia-quiz__feedback')?.textContent?.trim() || '',
      text: (quiz.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      controls: Array.from(quiz.querySelectorAll('button,input,select,textarea')).map(controlState),
    }));
    const declarations = Array.from(document.querySelectorAll('.lia-assignment-details'))
      .map(item => item.dataset.adetails || '');

    document.getElementById('lia-freeze-last')?.click();
    const evaluation = await waitFor('visible evaluation', () => {
      const value = document.getElementById('lia-eval-placeholder');
      return value?.style.display === 'block' ? value : null;
    });
    const evaluationText = evaluation.innerText || '';
    const lines = evaluationText.split('\n').map(line => line.trim()).filter(Boolean);
    const tagChecks = tags.map(([tag, points]) => {
      const offset = lines.indexOf(tag);
      const block = offset >= 0 ? lines.slice(offset, offset + 13).join(' ') : '';
      const number = String(points).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return {
        tag,
        points,
        found: offset >= 0,
        block,
        correct: new RegExp('Correct\\s+' + number + '(?:\\.0+)?\\b', 'i').test(block),
        wrong: /Wrong\s+0(?:\.0+)?\b/i.test(block),
        resolved: /Resolved\s+0(?:\.0+)?\b/i.test(block),
        achieved: new RegExp(
          'Achieved\\s+' + number + '(?:\\.0+)?\\s+of\\s+' + number + '(?:\\.0+)?\\b',
          'i'
        ).test(block),
        score: /Score\s+100\s*%/i.test(block),
      };
    });

    return {
      href: location.href,
      hash: location.hash,
      bodyClasses: document.body.className,
      stable: stable >= 10,
      snapshot,
      declarations,
      quizEvidence,
      dgsControls: dgsControls.map(controlState),
      boardLock: boardElement && {
        pointerEvents: getComputedStyle(boardElement).pointerEvents,
        freezeLocked: boardElement.getAttribute('data-lia-freeze-locked') || '',
        scope: !!boardElement.closest('.lia-frozen-scope'),
      },
      tagChecks,
      evaluationVisible: evaluation.style.display === 'block',
      evaluationText,
    };
  }, BOARD_ID, QUIZ_TAGS);

  assert(shared.stable, 'Shared DGS polygon did not remain stable for one second');
  assert(/lia-shared-freeze-link/.test(shared.bodyClasses),
    'Shared-link body class is missing: ' + shared.bodyClasses);
  assert(/lia-course-frozen/.test(shared.bodyClasses),
    'Shared course is not globally frozen: ' + shared.bodyClasses);
  assertRectangle(polygonGeometry(shared.snapshot), 'Shared restored DGS snapshot');
  assert(shared.boardLock && (
    shared.boardLock.pointerEvents === 'none'
    || shared.boardLock.freezeLocked === '1'
    || shared.boardLock.scope
  ), 'Shared DGS board is not locked: ' + JSON.stringify(shared.boardLock));
  assert(shared.dgsControls.length > 0 && shared.dgsControls.every(control => control.locked),
    'Shared DGS controls are not all locked: ' + JSON.stringify(shared.dgsControls));
  assert(shared.quizEvidence.length === 4, 'Shared slide does not contain four quiz outcomes');
  shared.quizEvidence.forEach((quiz, index) => {
    assert(/solved|success|correct|right answer/i.test(
      [quiz.className, quiz.outcome, quiz.feedback, quiz.text].join(' ')
    ), 'Shared ' + QUIZ_TAGS[index][0] + ' outcome is not correct: ' + JSON.stringify(quiz));
    assert(quiz.controls.every(control => control.locked),
      'Shared ' + QUIZ_TAGS[index][0] + ' controls are not locked: ' + JSON.stringify(quiz.controls));
  });
  assert(
    QUIZ_TAGS.every(([tag, points]) => shared.declarations.includes(points + ';' + tag)),
    'Shared @ADetails declarations are incomplete: ' + JSON.stringify(shared.declarations)
  );
  assert(shared.evaluationVisible, 'Shared evaluation did not open');
  assert(/15\s+of\s+15\s+points achieved/i.test(shared.evaluationText),
    'Evaluation does not report 15 of 15 points');
  assert(shared.tagChecks.length === 4, 'Expected four evaluation tag checks');
  for (const check of shared.tagChecks) {
    assert(check.found && check.correct && check.wrong && check.resolved
      && check.achieved && check.score,
    'Evaluation is wrong for ' + check.tag + ': ' + JSON.stringify(check));
  }

  return {
    courseUrl,
    live: {
      rectangle: liveRectangle.vertices,
      dgsRecords: liveRectangle.records,
      quizTags: ready.details,
      solved: liveQuizOutcomes.map((outcome, index) => ({
        tag: QUIZ_TAGS[index][0],
        feedback: outcome.feedback,
        outcome: outcome.outcome,
      })),
    },
    payload: {
      version: payload.v,
      linkLength: frozen.link.length,
      rectangle: payloadRectangle.vertices,
      dgsRecords: payloadRectangle.records,
    },
    shared: {
      bodyClasses: shared.bodyClasses,
      rectangle: polygonGeometry(shared.snapshot).vertices,
      boardLock: shared.boardLock,
      dgsControlCount: shared.dgsControls.length,
      tagChecks: shared.tagChecks,
      overall15of15: true,
    },
  };
}

(async () => {
  let timeoutId;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Combined coordinate CDP regression timed out after ' +
          OVERALL_TIMEOUT_MS + ' ms'));
      }, OVERALL_TIMEOUT_MS);
    });
    const result = await Promise.race([run(), timeout]);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  } finally {
    clearTimeout(timeoutId);
    closeSocket();
  }
})();
