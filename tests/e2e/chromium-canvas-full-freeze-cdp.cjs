/*
 * Trusted-input Canvas resize/freeze regression for README.md slide #27.
 *
 * Start Chromium with a remote-debugging port and pass any page websocket URL.
 * The runner navigates that target to a fresh README.md#27 course.
 */

const endpoint = process.argv[2];
if (!endpoint) {
  console.error('Usage: node chromium-canvas-full-freeze-cdp.cjs <page-websocket-url>');
  process.exit(2);
}

const { gunzipSync } = require('node:zlib');

const socket = new WebSocket(endpoint);
const pending = new Map();
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
    throw new Error('Chromium evaluation failed: ' + JSON.stringify(result.exceptionDetails));
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

async function trustedDrag(start, end, steps = 8) {
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: start.x,
    y: start.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  for (let index = 1; index <= steps; index++) {
    await command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: start.x + (end.x - start.x) * index / steps,
      y: start.y + (end.y - start.y) * index / steps,
      button: 'left',
      buttons: 1,
    });
  }
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: end.x,
    y: end.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

async function assertCanvasHit(point, label) {
  const hit = await evaluateCall(function (cellIndex, x, y) {
    const canvas = document.querySelectorAll('.flex-child')[cellIndex]
      ?.querySelector('canvas.lia-draw');
    return !!canvas && document.elementFromPoint(x, y) === canvas;
  }, 16, point.x, point.y);
  assert(hit, label + ' press would not hit the canvas according to elementFromPoint');
}

async function trustedStroke(points, label) {
  assert(points.length >= 4, label + ' needs at least four points');
  await assertCanvasHit(points[0], label);
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: points[0].x,
    y: points[0].y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  for (const point of points.slice(1)) {
    await command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
    });
  }
  const last = points[points.length - 1];
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: last.x,
    y: last.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

function summarizePaths(state) {
  return (state?.it || [])
    .filter(item => item?.k === 'p' && Array.isArray(item.p) && item.p.length)
    .map(item => {
      const xs = item.p.map(point => Number(point[0]));
      const ys = item.p.map(point => Number(point[1]));
      return {
        count: item.p.length,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      };
    })
    .sort((left, right) => left.minY - right.minY);
}

function decodeSubmissionPayload(link) {
  const outer = new URL(link);
  const course = new URL(decodeURIComponent(outer.search.slice(1)));
  const token = decodeURIComponent(course.hash.slice('#submission='.length));
  if (!token.startsWith('gz:')) throw new Error('Submission token is not gzip encoded');
  let encoded = token.slice(3).replace(/-/g, '+').replace(/_/g, '/');
  while (encoded.length % 4) encoded += '=';
  return JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'));
}

function compactCanvasUid(state) {
  if (!Array.isArray(state) || state[0] !== 'cvq1') return '';
  const packed = state[1];
  return typeof packed === 'number'
    ? Math.floor(packed / 64) + '_' + (packed % 64)
    : String(packed || '');
}

function payloadCanvasState(payload, uid) {
  const states = (payload?.s || []).flatMap(slide => Array.isArray(slide?.canvas) ? slide.canvas : []);
  const state = states.find(value =>
    compactCanvasUid(value) === uid
    || (value && typeof value === 'object' && value.u === uid)
  );
  if (Array.isArray(state) && state[0] === 'cvq1') {
    return { width: Number(state[2]), height: Number(state[3]), raw: state };
  }
  if (state && typeof state === 'object') {
    return { width: Number(state.w), height: Number(state.h), raw: state };
  }
  return null;
}

socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
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

async function run() {
  const ready = await evaluateCall(async function () {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    for (let attempts = 0; document.querySelectorAll('.flex-child').length !== 34 && attempts < 120; attempts++) {
      await pause(100);
    }
    return {
      hash: location.hash,
      cells: document.querySelectorAll('.flex-child').length,
    };
  });
  assert(ready.hash === '#27', 'Expected fresh README slide #27, got ' + ready.hash);
  assert(ready.cells === 34, 'Expected 34 flex children, got ' + ready.cells);

  const launcher = await evaluateCall(async function (cellIndex) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const button = document.querySelectorAll('.flex-child')[cellIndex]
      ?.querySelector('.lia-canvas-launch');
    if (!button) return null;
    button.scrollIntoView({ block: 'center', inline: 'center' });
    await pause(150);
    const rect = button.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    return {
      point,
      hit: hit === button || hit?.closest('.lia-canvas-launch') === button,
    };
  }, 16);
  assert(launcher?.hit, 'Canvas OCR A launcher is not the topmost hit target');
  await trustedClick(launcher.point);

  const initial = await evaluateCall(async function (cellIndex) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    let canvas = null;
    for (let attempts = 0; !canvas && attempts < 100; attempts++) {
      canvas = document.querySelectorAll('.flex-child')[cellIndex]
        ?.querySelector('canvas.lia-draw[data-ready="1"]');
      if (!canvas) await pause(100);
    }
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const pair = canvas.closest('.lia-canvas-pair');
    const api = window.__LIA_CANVAS_OCR__?.freeze;
    const uid = (pair && api?.getCanvasUidFromPair?.(pair))
      || pair?.querySelector('.lia-canvas-mount')?.dataset?.uid
      || '';
    const toolbar = Array.from(
      document.querySelectorAll('.flex-child')[cellIndex]
        .querySelectorAll('.lia-toolstack button,.lia-resize-corner')
    ).filter(element => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).map(element => {
      const box = element.getBoundingClientRect();
      return {
        aria: element.getAttribute('aria-label') || '',
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    });
    return {
      clientWidth: rect.width,
      clientHeight: rect.height,
      backingWidth: canvas.width,
      backingHeight: canvas.height,
      uid,
      toolbar,
    };
  }, 16);
  assert(initial, 'Canvas OCR A did not open');
  assert(/^\d+_\d+$/.test(initial.uid), 'Canvas OCR A exposes no stable runtime UID: ' + JSON.stringify(initial));
  assert(initial.toolbar.length >= 7, 'Canvas toolbar/resize hit areas were not discovered');
  assert(initial.clientHeight >= 240 && initial.clientHeight <= 250, 'Unexpected initial Canvas height: ' + initial.clientHeight);

  const topScan = await evaluateCall(function (cellIndex, relativeStart, relativeEnd) {
    const cell = document.querySelectorAll('.flex-child')[cellIndex];
    const canvas = cell?.querySelector('canvas.lia-draw');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scanned = [];
    for (let y = Math.ceil(rect.top + relativeStart); y <= rect.top + relativeEnd; y += 8) {
      const row = [];
      for (let x = Math.ceil(rect.left + 12); x <= rect.right - 12; x += 10) {
        const hit = document.elementFromPoint(x, y);
        scanned.push({ x, y, hit: hit?.className?.baseVal || hit?.className || hit?.tagName || '' });
        if (hit === canvas) row.push({ x, y });
      }
      if (row.length >= 8) {
        const start = Math.max(0, Math.floor((row.length - 8) / 2));
        return {
          path: row.slice(start, start + 8),
          scanned: scanned.length,
          canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }
    }
    return { path: [], scanned: scanned.length };
  }, 16, 35, 115);
  assert(topScan?.path?.length >= 8, 'Toolbar-aware scan found no safe upper Canvas stroke');
  await trustedStroke(topScan.path, 'Upper stroke');
  await delay(250);

  const resize = await evaluateCall(function (cellIndex) {
    const cell = document.querySelectorAll('.flex-child')[cellIndex];
    const handle = cell?.querySelector('.lia-resize-corner[data-corner="br"]');
    const canvas = cell?.querySelector('canvas.lia-draw');
    if (!handle || !canvas) return null;
    const handleRect = handle.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const point = {
      x: handleRect.left + handleRect.width / 2,
      y: handleRect.top + handleRect.height / 2,
    };
    return {
      point,
      hit: document.elementFromPoint(point.x, point.y)?.closest('.lia-resize-corner[data-corner="br"]') === handle,
      canvasHeight: canvasRect.height,
    };
  }, 16);
  assert(resize?.hit, 'Bottom-right Canvas resize handle is not the topmost hit target');
  await trustedDrag(resize.point, { x: resize.point.x, y: resize.point.y + 180 }, 12);

  const resized = await evaluateCall(async function (cellIndex, minimumHeight) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    let result = null;
    for (let attempts = 0; attempts < 80; attempts++) {
      const canvas = document.querySelectorAll('.flex-child')[cellIndex]
        ?.querySelector('canvas.lia-draw');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        result = {
          x: rect.x,
          y: rect.y,
          clientWidth: rect.width,
          clientHeight: rect.height,
          backingWidth: canvas.width,
          backingHeight: canvas.height,
        };
        if (rect.height >= minimumHeight) break;
      }
      await pause(100);
    }
    return result;
  }, 16, initial.clientHeight + 160);
  assert(resized?.clientHeight >= initial.clientHeight + 160, 'Trusted BR resize did not grow Canvas height: ' + JSON.stringify({ initial, resized }));
  assert(resized.backingHeight >= Math.floor(resized.clientHeight), 'Live Canvas backing height does not cover resized client height');

  const bottomScan = await evaluateCall(function (cellIndex, relativeStart, relativeEnd) {
    const cell = document.querySelectorAll('.flex-child')[cellIndex];
    const canvas = cell?.querySelector('canvas.lia-draw');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scanned = [];
    for (let y = Math.ceil(rect.top + relativeStart); y <= rect.top + relativeEnd; y += 8) {
      const row = [];
      for (let x = Math.ceil(rect.left + 12); x <= rect.right - 12; x += 10) {
        const hit = document.elementFromPoint(x, y);
        scanned.push({ x, y, hit: hit?.className?.baseVal || hit?.className || hit?.tagName || '' });
        if (hit === canvas) row.push({ x, y });
      }
      if (row.length >= 8) {
        const start = Math.max(0, Math.floor((row.length - 8) / 2));
        return {
          path: row.slice(start, start + 8),
          scanned: scanned.length,
          localY: y - rect.top,
          canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }
    }
    return { path: [], scanned: scanned.length, localY: null };
  }, 16, initial.clientHeight + 65, resized.clientHeight - 45);
  assert(bottomScan?.path?.length >= 8, 'Toolbar/footer-aware scan found no safe lower Canvas stroke');
  assert(bottomScan.localY > initial.clientHeight + 50, 'Lower stroke is not below the original Canvas viewport');
  await trustedStroke(bottomScan.path, 'Lower stroke');
  await delay(350);

  const live = await evaluateCall(function (cellIndex, uid) {
    const cell = document.querySelectorAll('.flex-child')[cellIndex];
    const canvas = cell?.querySelector('canvas.lia-draw');
    const rect = canvas?.getBoundingClientRect();
    const api = window.__LIA_CANVAS_OCR__?.freeze;
    const states = api?.exportAllCanvasFreezeStatesFromRoot?.(document) || [];
    const state = states.find(item => item?.u === uid) || null;
    const entry = api?.getCanvasStoreEntry?.(uid);
    let pixels = null;
    if (canvas) {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const offset = (y * canvas.width + x) * 4;
          const ink = data[offset + 3] > 16
            && data[offset] + data[offset + 1] + data[offset + 2] < 690;
          if (!ink) continue;
          count++;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      pixels = { readable: true, count, minX, minY, maxX, maxY };
    }
    return {
      state,
      store: entry && {
        wrapWidth: entry.wrapW,
        canvasHeight: entry.canvasH,
      },
      geometry: rect && {
        clientWidth: rect.width,
        clientHeight: rect.height,
        backingWidth: canvas.width,
        backingHeight: canvas.height,
      },
      pixels,
    };
  }, 16, initial.uid);
  assert(live.state, 'Public Canvas freeze API did not export UID ' + initial.uid);
  const livePaths = summarizePaths(live.state);
  assert(livePaths.length >= 2, 'Canvas export does not contain both trusted strokes: ' + JSON.stringify(livePaths));
  assert(livePaths[0].maxY < initial.clientHeight, 'Upper path was not exported in the upper viewport');
  assert(livePaths[livePaths.length - 1].minY > initial.clientHeight + 20, 'Lower path was not exported below the original viewport');
  assert(live.pixels?.count > 40 && live.pixels.minY < initial.clientHeight && live.pixels.maxY > initial.clientHeight + 20, 'Live Canvas pixels do not prove both upper and lower strokes: ' + JSON.stringify(live.pixels));
  assert(
    live.store?.canvasHeight >= Math.floor(resized.clientHeight),
    'Canvas store height ' + live.store?.canvasHeight + ' does not cover resized viewport height ' + resized.clientHeight
  );
  assert(
    live.store?.wrapWidth >= Math.floor(resized.clientWidth),
    'Canvas store width ' + live.store?.wrapWidth + ' does not cover resized viewport width ' + resized.clientWidth
  );

  const ocrCheck = await evaluateCall(async function (cellIndex) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const cell = document.querySelectorAll('.flex-child')[cellIndex];
    const input = cell?.querySelector('input.lia-quiz__input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '4');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    input?.dispatchEvent(new Event('change', { bubbles: true }));
    await pause(100);
    const check = document.querySelectorAll('.flex-child')[cellIndex]
      ?.querySelector('.lia-quiz__check');
    check?.scrollIntoView({ block: 'center', inline: 'center' });
    await pause(120);
    const rect = check?.getBoundingClientRect();
    if (!rect) return null;
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return {
      point,
      hit: document.elementFromPoint(point.x, point.y)?.closest('.lia-quiz__check') === check,
    };
  }, 16);
  assert(ocrCheck?.hit, 'OCR Check button is not the topmost hit target');
  await trustedClick(ocrCheck.point);
  const ocrCollected = await evaluateCall(async function (cellIndex) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    for (let attempts = 0; attempts < 80; attempts++) {
      const cell = document.querySelectorAll('.flex-child')[cellIndex];
      const quiz = cell?.querySelector('.lia-quiz');
      const feedbackNode = cell?.querySelector('.lia-quiz__feedback');
      const resolve = cell?.querySelector('.lia-quiz__resolve');
      const visible = element => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden'
          && style.pointerEvents !== 'none' && element.getClientRects().length > 0;
      };
      if (quiz?.getAttribute('data-lia-send-logged') === '1') {
        return {
          logged: true,
          value: cell?.querySelector('input.lia-quiz__input')?.value || '',
          quizClass: quiz.className || '',
          outcome: quiz.getAttribute('data-lia-freeze-outcome') || '',
          feedback: feedbackNode?.textContent?.trim() || '',
          feedbackVisible: visible(feedbackNode),
          resolveVisible: visible(resolve),
          status: quiz.querySelector('.lia-send-status')?.textContent?.trim() || '',
        };
      }
      await pause(100);
    }
    return { logged: false };
  }, 16);
  assert(ocrCollected.logged && ocrCollected.value === '4'
    && /\bopen\b/.test(ocrCollected.quizClass)
    && !ocrCollected.outcome
    && !ocrCollected.feedback
    && !ocrCollected.feedbackVisible
    && !ocrCollected.resolveVisible
    && ocrCollected.status.startsWith('Antwort gespeichert'),
  'Send did not log Canvas OCR neutrally before Freeze: ' + JSON.stringify(ocrCollected));

  const frozen = await evaluateCall(async function () {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const setValue = (element, value) => {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      setter?.call(element, value);
      element?.dispatchEvent(new Event('input', { bubbles: true }));
      element?.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (let steps = 0; steps < 6 && !document.getElementById('lia-create-link'); steps++) {
      document.querySelector('button[title="next"]')?.click();
      await pause(350);
      const examInput = document.querySelector('.lia-exam-name-input');
      const examStart = document.querySelector('.lia-exam-start-btn');
      if (examInput && examStart) {
        setValue(examInput, 'Canvas Chromium Student');
        examStart.click();
        await pause(300);
      }
    }
    const name = document.getElementById('lia-name');
    const create = document.getElementById('lia-create-link');
    if (!name || !create) return { error: 'Submit UI not reached', hash: location.hash };
    setValue(name, 'Canvas Chromium Student');
    create.click();
    let link = '';
    for (let attempts = 0; !link && attempts < 200; attempts++) {
      await pause(100);
      link = document.getElementById('lia-link')?.value || '';
    }
    return { link, hash: location.hash };
  });
  assert(frozen.link, 'Canvas submission link was not created: ' + JSON.stringify(frozen));
  const payload = decodeSubmissionPayload(frozen.link);
  const payloadCanvas = payloadCanvasState(payload, initial.uid);
  assert(payloadCanvas, 'Submission payload has no cvq1/cvf1 Canvas state');
  assert(
    payloadCanvas.height >= Math.floor(resized.clientHeight),
    'Freeze payload Canvas height ' + payloadCanvas.height + ' does not cover resized viewport height ' + resized.clientHeight
  );
  assert(
    payloadCanvas.width >= Math.floor(resized.clientWidth),
    'Freeze payload Canvas width ' + payloadCanvas.width + ' does not cover resized viewport width ' + resized.clientWidth
  );

  await command('Page.navigate', { url: frozen.link });
  await delay(2200);

  const shared = await evaluateCall(async function (cellIndex, uid, originalHeight, payloadWidth, payloadHeight) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    for (let attempts = 0; !document.body.classList.contains('lia-shared-freeze-link') && attempts < 150; attempts++) {
      await pause(100);
    }
    location.hash = '#27';
    let stable = 0;
    let result = null;
    for (let attempts = 0; attempts < 160; attempts++) {
      const cell = document.querySelectorAll('.flex-child')[cellIndex];
      const pair = cell?.querySelector('.lia-canvas-pair');
      const mount = pair?.querySelector('.lia-canvas-mount');
      const surface = pair?.querySelector('canvas.lia-draw,canvas.lia-canvas-freeze-preview,img.lia-canvas-freeze-preview');
      const canvas = surface instanceof HTMLCanvasElement ? surface : null;
      const image = surface instanceof HTMLImageElement ? surface : null;
      const api = window.__LIA_CANVAS_OCR__?.freeze;
      const states = api?.exportAllCanvasFreezeStatesFromRoot?.(document) || [];
      const state = states.find(item => item?.u === uid) || null;
      const entry = api?.getCanvasStoreEntry?.(uid);
      const rect = surface?.getBoundingClientRect();
      const locked = [pair, mount, surface].some(element =>
        element?.getAttribute('data-lia-freeze-locked') === '1'
        || element?.getAttribute('data-lia-freeze-canvas-locked') === '1'
      );
      let pixels = null;
      if (surface) {
        try {
          const sourceWidth = canvas?.width || image?.naturalWidth || 0;
          const sourceHeight = canvas?.height || image?.naturalHeight || 0;
          const scratch = canvas || document.createElement('canvas');
          if (image) {
            scratch.width = sourceWidth;
            scratch.height = sourceHeight;
            scratch.getContext('2d').drawImage(image, 0, 0);
          }
          const data = scratch.getContext('2d').getImageData(0, 0, sourceWidth, sourceHeight).data;
          let count = 0;
          let topInk = 0;
          let bottomInk = 0;
          let minX = sourceWidth;
          let minY = sourceHeight;
          let maxX = -1;
          let maxY = -1;
          for (let y = 0; y < sourceHeight; y++) {
            for (let x = 0; x < sourceWidth; x++) {
              const offset = (y * sourceWidth + x) * 4;
              const ink = data[offset + 3] > 16
                && data[offset] + data[offset + 1] + data[offset + 2] < 690;
              if (!ink) continue;
              count++;
              if (y < originalHeight) topInk++;
              if (y > originalHeight + 20) bottomInk++;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
          pixels = { readable: true, count, topInk, bottomInk, minX, minY, maxX, maxY };
        } catch (error) {
          pixels = { readable: false, error: String(error) };
        }
      }
      const ocr = cell?.querySelector('input.lia-quiz__input');
      const quiz = cell?.querySelector('.lia-quiz');
      const feedback = quiz?.querySelector('.lia-quiz__feedback');
      const feedbackStyle = feedback instanceof HTMLElement ? getComputedStyle(feedback) : null;
      result = {
        state,
        store: entry && {
          wrapWidth: entry.wrapW,
          canvasHeight: entry.canvasH,
        },
        locked,
        staticPreview: !state && !entry && !!surface?.classList.contains('lia-canvas-freeze-preview'),
        surfaceType: canvas ? 'canvas' : image ? 'image' : '',
        pixels,
        ocrValue: ocr?.value || '',
        ocrLocked: !!ocr?.disabled || ocr?.getAttribute('data-lia-freeze-locked') === '1',
        quizClass: quiz?.className || '',
        quizOutcome: quiz?.getAttribute('data-lia-freeze-outcome') || '',
        feedback: feedback?.textContent?.trim() || '',
        feedbackVisible: !!feedbackStyle
          && feedbackStyle.display !== 'none'
          && feedbackStyle.visibility !== 'hidden'
          && feedback.getClientRects().length > 0,
        geometry: rect && {
          clientWidth: rect.width,
          clientHeight: rect.height,
          backingWidth: canvas?.width || image?.naturalWidth || 0,
          backingHeight: canvas?.height || image?.naturalHeight || 0,
        },
      };
      const ready = locked
        && result.ocrValue === '4'
        && result.ocrLocked
        && /solved|success|correct/i.test(result.quizClass + ' ' + result.quizOutcome)
        && result.feedbackVisible
        && !!result.feedback
        && result.staticPreview
        && result.pixels?.readable
        && result.pixels.topInk > 20
        && result.pixels.bottomInk > 20
        && result.geometry?.clientWidth >= payloadWidth - 1
        && result.geometry?.clientHeight >= payloadHeight - 1;
      stable = ready ? stable + 1 : 0;
      if (stable >= 10) break;
      await pause(100);
    }
    return { ...result, stable: stable >= 10, hash: location.hash };
  }, 16, initial.uid, initial.clientHeight, payloadCanvas.width, payloadCanvas.height);
  assert(shared.stable, 'Shared Canvas did not restore and remain locked for one second: ' + JSON.stringify(shared));
  assert(shared.staticPreview && shared.state === null && shared.store === null, 'Shared Canvas is not the expected static preview mode: ' + JSON.stringify(shared));
  assert(shared.geometry.backingWidth >= payloadCanvas.width, 'Shared Canvas backing width clips payload viewport');
  assert(shared.geometry.backingHeight >= payloadCanvas.height, 'Shared Canvas backing height clips payload viewport');
  assert(shared.geometry.clientWidth >= payloadCanvas.width - 1, 'Shared Canvas client width clips payload viewport');
  assert(shared.geometry.clientHeight >= payloadCanvas.height - 1, 'Shared Canvas client height clips payload viewport');
  assert(shared.pixels.topInk > 20 && shared.pixels.bottomInk > 20, 'Shared preview has no pixel evidence for both upper and lower strokes');
  for (const key of ['minX', 'maxX', 'minY', 'maxY']) {
    assert(Math.abs(live.pixels[key] - shared.pixels[key]) <= 3, 'Shared preview pixel bounds changed at ' + key + ': ' + JSON.stringify({ live: live.pixels, shared: shared.pixels }));
  }

  return {
    live: {
      initial,
      resized,
      toolbarHitAreas: initial.toolbar,
      topScan: { scanned: topScan.scanned, path: topScan.path },
      bottomScan: { scanned: bottomScan.scanned, path: bottomScan.path, localY: bottomScan.localY },
      state: {
        version: live.state.v,
        uid: live.state.u,
        width: live.state.w,
        height: live.state.h,
        items: live.state.it.length,
      },
      paths: livePaths,
      pixels: live.pixels,
      payloadCanvas: { width: payloadCanvas.width, height: payloadCanvas.height },
      ocrFeedback: shared.feedback,
    },
    shared: {
      stable: shared.stable,
      locked: shared.locked,
      ocrValue: shared.ocrValue,
      geometry: shared.geometry,
      store: shared.store,
      state: shared.state,
      staticPreview: shared.staticPreview,
      surfaceType: shared.surfaceType,
      pixels: shared.pixels,
    },
    linkLength: frozen.link.length,
  };
}

socket.addEventListener('open', async () => {
  let timeoutId;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('Canvas full Freeze E2E exceeded 60 seconds')),
        60000
      );
    });
    const result = await Promise.race([
      run(),
      timeout,
    ]);
    process.stdout.write(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.stack || String(error));
    process.exitCode = 1;
  } finally {
    clearTimeout(timeoutId);
    socket.close();
  }
});
