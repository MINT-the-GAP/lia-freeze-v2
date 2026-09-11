/** Full README course Canvas performance/regression runner.
 * Start devserver: node node_modules/@liascript/devserver/dist/index.js --node_modules . --port 4174 --input ..
 * node tests/browser/canvas-progress.mjs before [freeze-bundle] [canvas-bundle]
 * node tests/browser/canvas-progress.mjs after dist/index.js [canvas-bundle]
 * Chrome is headless. All course imports are loaded; only explicitly supplied bundles are substituted.
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import ts from 'typescript';

const compiledCanvas = ts.transpileModule(await readFile('src/canvas-state.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const { expandCanvasStatesForRestore } = await import('data:text/javascript;base64,' + Buffer.from(compiledCanvas).toString('base64'));

const label = process.argv[2] || 'inspect';
const artifacts = resolve('tests/artifacts/canvas-progress-2026-09-10');
await mkdir(artifacts, { recursive: true });
const freezePath = process.argv[3] || (label === 'before' ? artifacts + '/before-index.js' : 'dist/index.js');
const canvasPath = process.argv[4] || '';
const freezeBundle = freezePath === 'none' ? Buffer.from('') : await readFile(freezePath);
const canvasBundle = canvasPath ? await readFile(canvasPath) : null;
const sha256 = data => createHash('sha256').update(data).digest('hex');
const imported = [];
const errors = [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const context = await browser.newContext({ viewport: { width: 1800, height: 1300 }, ignoreHTTPSErrors: true });
const page = await context.newPage();
page.setDefaultTimeout(45000);
page.on('pageerror', error => errors.push(String(error)));
page.on('response', async response => {
  const url = response.url();
  if (response.status() >= 400) errors.push(response.status() + ' ' + url);
  if (/README\.md|\/dist\/index\.js/.test(url)) {
    try { const body = await response.body(); imported.push({ url, status: response.status(), sha256: sha256(body), bytes: body.length }); } catch {}
  }
});
await page.route('**/lia-freeze-v2/dist/index.js*', route => route.fulfill({ body: freezeBundle, contentType: 'application/javascript' }));
if (canvasBundle) await page.route(/https:\/\/.*(?:MINT-the-GAP\/lia-canvas-ocr|MINT-the-GAP%2Flia-canvas-ocr).*\/dist\/index\.js(?:\?.*)?$/, route => route.fulfill({ body: canvasBundle, contentType: 'application/javascript' }));
await page.addInitScript(() => {
  const metrics = window.__canvasProgressMetrics = { phase: '', entries: {}, drawing: false };
  function record(name, start, detail) {
    if (!metrics.phase) return;
    const entry = metrics.entries[metrics.phase];
    const stat = entry.calls[name] ||= { count: 0, totalMs: 0, maxMs: 0, whileDrawing: 0, samples: [] };
    const elapsed = performance.now() - start;
    stat.count++; stat.totalMs += elapsed; stat.maxMs = Math.max(stat.maxMs, elapsed);
    if (metrics.drawing) stat.whileDrawing++;
    if (typeof detail === 'string') { stat.byDetail ||= {}; stat.byDetail[detail] = (stat.byDetail[detail] || 0) + 1; }
    if (stat.samples.length < 5) stat.samples.push({ at: start, elapsed, detail, stack: new Error().stack });
  }
  metrics.record = record;
  const nativeImage = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function measuredGetImageData(...args) {
    const start = performance.now();
    try { return nativeImage.apply(this, args); } finally { record('getImageData', start, args.slice(0, 4)); }
  };
  const nativeBtoa = window.btoa;
  window.btoa = function measuredBtoa(value) {
    const start = performance.now();
    try { return nativeBtoa.call(this, value); } finally { record('btoa', start, value?.length); }
  };
  const nativeCompression = window.CompressionStream;
  if (nativeCompression) window.CompressionStream = class MeasuredCompressionStream extends nativeCompression {
    constructor(format) { const start = performance.now(); super(format); record('CompressionStream', start, format); }
  };
  new PerformanceObserver(list => {
    if (!metrics.phase) return;
    for (const item of list.getEntries()) {
      const entry = metrics.entries[metrics.phase];
      if (item.startTime >= entry.started) entry.longtasks.push({ startTime: item.startTime, duration: item.duration });
    }
  }).observe({ type: 'longtask', buffered: false });
  addEventListener('pointerdown', event => { if (event.target?.closest?.('canvas.lia-draw')) metrics.drawing = true; }, true);
  addEventListener('pointerup', event => { metrics.drawing = false; if (event.target?.closest?.('canvas.lia-draw')) metrics.lastPointerUp = performance.now(); }, true);
  addEventListener('pointercancel', () => { metrics.drawing = false; }, true);
  addEventListener('lia:canvas-change', event => record('lia:canvas-change', performance.now(), event.detail), true);
});
const cdp = await context.newCDPSession(page);
const result = { label, timestamp: new Date().toISOString(), browser: browser.version(), course: 'README.md#27 (all imports)', freezeSha256: sha256(freezeBundle), canvasSha256: canvasBundle && sha256(canvasBundle), scenario: { cpuRate: Number(process.env.CANVAS_PROGRESS_CPU_RATE || 4), openCanvases: 2, seededPathsPerCanvas: Number(process.env.CANVAS_PROGRESS_SEEDED_PATHS || 220), sampledPointsPerSeededPath: Number(process.env.CANVAS_PROGRESS_POINTS || 64), measuredStrokes: Number(process.env.CANVAS_PROGRESS_STROKES || 24), pointsPerMeasuredStroke: 16, pauseMs: [90, 240] }, regressions: {}, imported, errors };
const log = (phase, data) => process.stderr.write(`[${label}] ${phase}${data ? ' ' + JSON.stringify(data) : ''}\n`);
async function phase(name) {
  log(name);
  await page.evaluate(name => { const m = window.__canvasProgressMetrics; if (m.phase) m.entries[m.phase].ended = performance.now(); m.phase = name; if (name) m.entries[name] = { started: performance.now(), calls: {}, longtasks: [] }; }, name);
}
function cell(index) { return page.locator('.flex-child').nth(index); }
async function draw(index, serial, points = 16, options = {}) {
  const canvas = cell(index).locator('canvas.lia-draw');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert(box?.width > 20, 'Canvas must be mounted and visible');
  const startX = box.x + 70 + (serial % 7) * Math.max(3, (box.width - 190) / 7);
  const startY = box.y + 45 + (serial % 7) * 22;
  await page.mouse.move(startX, startY);
  await page.mouse.down(options);
  for (let i = 1; i <= points; i++) await page.mouse.move(startX + i * 5, startY + Math.sin(i * 0.9) * 14, { steps: 1 });
  await page.mouse.up(options);
}
async function states() {
  return page.evaluate(() => [...document.querySelectorAll('.flex-child')].map((cell, index) => {
    const pair = cell.querySelector('.lia-canvas-pair');
    const api = window.__LIA_CANVAS_OCR__?.freeze;
    const uid = pair && api?.getCanvasUidFromPair(pair);
    if (!uid) return null;
    const entry = api.getCanvasStoreEntry(uid);
    return { index, uid, count: entry?.ITEMS?.length || 0, redo: entry?.REDO?.length || 0, view: entry?.VIEW, last: entry?.ITEMS?.at(-1), revision: api.listCanvasLiveStateRevisions?.(document)?.find(item => item.uid === uid)?.revision };
  }).filter(Boolean));
}
try {
  log('loading');
  await page.goto('http://localhost:4174/liascript/index.html?http://localhost:4174/lia-freeze-v2/README.md#27', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.flex-child').length === 34 && window.__LIA_CANVAS_OCR__?.freeze);
  await page.waitForTimeout(6500);
  for (const index of [16, 17]) {
    log('opening-canvas', { index });
    await cell(index).locator('.lia-canvas-launch').click();
    await cell(index).locator('canvas.lia-draw[data-ready="1"]').waitFor({ state: 'visible' });
    await draw(index, 0);
  }
  await page.evaluate(() => {
    const api = window.__LIA_CANVAS_OCR__.freeze;
    const metrics = window.__canvasProgressMetrics;
    for (const name of ['exportAllCanvasFreezeStatesFromRoot', 'exportCanvasFreezeStateFromPair', 'exportCanvasFreezeStateFromEntry', 'listCanvasLiveStateRevisions', 'exportCanvasLiveStateByUID', 'getCanvasStoreEntry']) {
      const original = api[name];
      if (typeof original !== 'function') continue;
      api[name] = function measuredCanvasApi(...args) {
        const start = performance.now();
        try { return original.apply(this, args); } finally { metrics.record(name, start, typeof args[0] === 'string' ? args[0] : args[0]?.nodeName); }
      };
    }
  });
  result.scriptBundles = await page.evaluate(async () => Promise.all([...document.scripts].filter(script => script.src.startsWith('blob:')).map(async script => { const source = await (await fetch(script.src)).text(); const bytes = new TextEncoder().encode(source); const digest = await crypto.subtle.digest('SHA-256', bytes); return { url: script.src, bytes: bytes.length, sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }; })));
  result.initial = await states();
  result.api = await page.evaluate(() => Object.keys(window.__LIA_CANVAS_OCR__.freeze));
  if (label === 'inspect') { log('inspect', result.initial); await page.screenshot({ path: artifacts + '/inspect.png', fullPage: false }); }
  else {
    log('seeding-long-handwriting');
    result.seed = await page.evaluate(({ count, points }) => [16, 17].map(index => {
      const pair = document.querySelectorAll('.flex-child')[index].querySelector('.lia-canvas-pair');
      const api = window.__LIA_CANVAS_OCR__.freeze;
      const uid = api.getCanvasUidFromPair(pair);
      const entry = api.getCanvasStoreEntry(uid);
      const template = entry.ITEMS.find(item => item.kind === 'path');
      if (!template) throw new Error('Trusted pen stroke missing before seeding');
      for (let n = 0; n < count; n++) {
        const item = structuredClone(template);
        const key = ['pts', 'points'].find(key => Array.isArray(item[key]));
        if (!key) throw new Error('Unknown native path schema: ' + JSON.stringify(template));
        item[key] = Array.from({ length: points }, (_, i) => ({ ...item[key][0], x: 20 + (n % 5) * 60 + i * 1.7, y: 35 + (n % 8) * 23 + Math.sin(i * 0.7) * 8 }));
        entry.ITEMS.push(item);
      }
      return { uid, items: entry.ITEMS.length, seeded: count };
    }), { count: result.scenario.seededPathsPerCanvas, points: result.scenario.sampledPointsPerSeededPath });
    for (const index of [16, 17]) await draw(index, 1);
    await page.waitForTimeout(1800);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: result.scenario.cpuRate });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await cdp.send('Profiler.start');
    await phase('writing');
    for (let n = 0; n < result.scenario.measuredStrokes; n++) {
      // Canvas B remains unchanged during the final twelve strokes on Canvas A.
      await draw(n < 12 && n % 2 ? 17 : 16, n + 2);
      await page.waitForTimeout(result.scenario.pauseMs[n % 2]);
      if (n % 6 === 5) log('strokes', { completed: n + 1 });
    }
    await page.waitForTimeout(1500);
    await phase('');
    const { profile } = await cdp.send('Profiler.stop');
    await writeFile(artifacts + '/' + label + '.cpuprofile', JSON.stringify(profile));
    result.profile = { nodes: profile.nodes.length, samples: profile.samples?.length, elapsedMs: (profile.endTime - profile.startTime) / 1000 };
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    result.afterWriting = await states();
    const writingMetrics = await page.evaluate(() => window.__canvasProgressMetrics.entries.writing);
    if (label.startsWith('after')) {
      assert.equal(writingMetrics.calls.getImageData?.count || 0, 0, 'Live saves must not read pixels');
      assert.equal(writingMetrics.calls.exportAllCanvasFreezeStatesFromRoot?.count || 0, 0, 'Live saves must not raster export all Canvas');
      assert.equal(writingMetrics.calls.btoa?.count || 0, 0, 'Live saves must not repack Canvas path tokens');
      assert.equal(writingMetrics.calls.CompressionStream?.count || 0, 0, 'Live saves must not gzip all Canvas');
      assert.equal(writingMetrics.calls.exportCanvasLiveStateByUID?.whileDrawing || 0, 0, 'Deferred live saves must yield to resumed drawing');
    }
    if (label.startsWith('after') && !label.includes('normal')) {
      if (result.api.includes('exportCanvasLiveStateByUID')) {
        // Moving focus from B to A legitimately persists B once; settle it
        // before asserting reuse of B's now unchanged revision.
        await draw(16, 9);
        await page.waitForTimeout(650);
        const unchangedBefore = (await states()).find(state => state.index === 17);
        await phase('autosave-pauses');
        for (let n = 0; n < 3; n++) { await draw(16, 10 + n); await page.waitForTimeout(650); }
        await phase('');
        const positive = await page.evaluate(() => window.__canvasProgressMetrics.entries['autosave-pauses']);
        const unchangedAfter = (await states()).find(state => state.index === 17);
        assert.equal(unchangedAfter.revision, unchangedBefore.revision, 'Canvas B must truly have an unchanged revision during the reuse test');
        const uidA = result.initial.find(state => state.index === 16).uid;
        const uidB = result.initial.find(state => state.index === 17).uid;
        const exports = positive.calls.exportCanvasLiveStateByUID?.byDetail || {};
        assert((exports[uidA] || 0) >= 3, 'Every separated changed revision must be saved: ' + JSON.stringify(exports));
        assert.equal(exports[uidB] || 0, 0, 'Unchanged Canvas B must reuse its saved state');
        assert.equal(positive.calls.getImageData?.count || 0, 0);
        assert.equal(positive.calls.btoa?.count || 0, 0);
        result.regressions.autosavePauses = { changedAExports: exports[uidA], unchangedBExports: exports[uidB] || 0, unchangedBRevision: unchangedAfter.revision };
      }
      await phase('tools');
      const beforeUndo = (await states()).find(state => state.index === 16);
      await cell(16).locator('.lia-undo-btn').click();
      const undo = (await states()).find(state => state.index === 16);
      assert.equal(undo.count, beforeUndo.count - 1);
      await cell(16).locator('.lia-redo-btn').click();
      const redo = (await states()).find(state => state.index === 16);
      assert.equal(redo.count, beforeUndo.count);
      result.regressions.undoRedo = { before: beforeUndo.count, undo: undo.count, redo: redo.count };
      await cell(16).locator('.lia-eraser-btn').click();
      await cell(16).locator('[data-act="close"]').click();
      await draw(16, 6);
      const erased = (await states()).find(state => state.index === 16);
      assert(erased.last?.erase === true || erased.last?.tool === 'eraser', 'Eraser must append an erasing path: ' + JSON.stringify(erased.last));
      result.regressions.eraser = { count: erased.count, last: erased.last };
      await cell(16).locator('.lia-color-btn').click();
      await cell(16).locator('[data-act="close"]').click();
      const oldView = (await states()).find(state => state.index === 16).view;
      await draw(16, 3, 8, { button: 'right' });
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(250);
      const newView = (await states()).find(state => state.index === 16).view;
      assert.notDeepEqual(newView, oldView);
      result.regressions.panZoom = { before: oldView, after: newView };
      await cell(17).locator('.lia-eraser-btn').click();
      await cell(17).locator('[data-act="clear"]').click();
      await page.waitForTimeout(500);
      const cleared = (await states()).find(state => state.index === 17);
      assert.equal(cleared.count, 0);
      result.regressions.clear = cleared;
      await page.waitForTimeout(700);
      await phase('slide-return');
      const preSlide = (await states()).find(state => state.index === 16);
      await page.evaluate(() => { location.hash = '#26'; });
      await page.waitForTimeout(700);
      await page.evaluate(() => { location.hash = '#27'; });
      await page.waitForFunction(() => document.querySelectorAll('.flex-child').length === 34);
      await page.waitForTimeout(1700);
      if (!await cell(16).locator('canvas.lia-draw').count()) await cell(16).locator('.lia-canvas-launch').click();
      const postSlide = (await states()).find(state => state.index === 16);
      assert.equal(postSlide.count, preSlide.count);
      result.regressions.slideReturn = { before: preSlide.count, after: postSlide.count };
      await cell(16).locator('.lia-bgmenu-btn').click();
      await cell(16).locator('[data-act="bg"][data-mode="lined"]').click();
      if (!await cell(16).locator('[data-act="bg"][data-mode="grid"]').isVisible()) await cell(16).locator('.lia-bgmenu-btn').click();
      await cell(16).locator('[data-act="bg"][data-mode="grid"]').click();
      if (await cell(16).locator('[data-act="close"]').isVisible()) await cell(16).locator('[data-act="close"]').click();
      await page.evaluate(() => document.documentElement.style.setProperty('--canvas-accent', '#8048c8'));
      result.regressions.background = { mode: 'grid', expectedColor: 'rgba(128,72,200,0.65)' };
      // Provide the README submission controls beside the active Canvas,
      // so createLink runs immediately after pointerup without slide travel.
      await page.evaluate(() => {
        if (!document.getElementById('lia-name')) {
          const box = document.createElement('div'); box.dataset.snapshotAdmin = '1';
          box.innerHTML = '<input id="lia-name" data-snapshot-admin="1" value="Canvas Progress Regression"><button id="lia-create-link" data-snapshot-admin="1">Create Link</button><textarea id="lia-link" data-snapshot-admin="1"></textarea><div id="lia-status"></div>';
          document.body.append(box);
        }
      });
      await phase('submission');
      const beforeLast = (await states()).find(state => state.index === 16);
      await draw(16, 7);
      const submittedAt = Date.now();
      const immediate = await page.evaluate(() => { const delta = performance.now() - window.__canvasProgressMetrics.lastPointerUp; const style = getComputedStyle(document.documentElement); const actualAccent = style.getPropertyValue('--canvas-accent').trim() || style.getPropertyValue('--canvas-border').trim() || '#000'; document.getElementById('lia-create-link').click(); return { delta, actualAccent }; });
      const pointerUpToSubmitMs = immediate.delta;
      result.regressions.background.actualAccentBeforeSubmit = immediate.actualAccent;
      const accentHex = /^#([0-9a-f]{6})$/i.exec(immediate.actualAccent);
      const accentRgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(immediate.actualAccent);
      if (accentHex) result.regressions.background.expectedColor = 'rgba(' + [0, 2, 4].map(offset => Number.parseInt(accentHex[1].slice(offset, offset + 2), 16)).join(',') + ',0.65)';
      else if (accentRgb) result.regressions.background.expectedColor = 'rgba(' + accentRgb.slice(1, 4).join(',') + ',0.65)';
      await page.waitForFunction(() => document.getElementById('lia-link')?.value);
      const link = await page.locator('#lia-link').inputValue();
      result.regressions.immediateSubmission = { pointerUpToSubmitMs, linkLength: link.length, elapsedMs: Date.now() - submittedAt, expectedItems: beforeLast.count + 1 };
      await writeFile(artifacts + '/' + label + '-submission.txt', link);
      const outer = new URL(link);
      const course = new URL(decodeURIComponent(outer.search.slice(1)));
      const token = decodeURIComponent(course.hash.slice('#submission='.length));
      const payload = JSON.parse(token.startsWith('gz:') ? gunzipSync(Buffer.from(token.slice(3), 'base64url')).toString('utf8') : Buffer.from(token.replace(/^plain:/, ''), 'base64url').toString('utf8'));
      await writeFile(artifacts + '/' + label + '-payload.json', JSON.stringify(payload));
      const expanded = expandCanvasStatesForRestore((payload.s || []).flatMap(slide => slide.canvas || []));
      const submittedCanvas = expanded.find(state => state.u === beforeLast.uid);
      assert(submittedCanvas, 'Submission must contain active Canvas');
      assert.equal(submittedCanvas.it.length, beforeLast.count + 1, 'Submission must contain the last stroke');
      assert.equal(submittedCanvas.bg.m, 'grid');
      assert.equal(submittedCanvas.bg.c.replace(/\s+/g, ''), result.regressions.background.expectedColor, 'Submission background must retain the current custom accent');
      result.regressions.background.actualColor = submittedCanvas.bg.c;
      result.regressions.immediateSubmission.canvas = expanded.map(state => ({ uid: state.u, width: state.w, height: state.h, items: state.it.length }));
      const submittedEmpty = expanded.find(state => state.u === cleared.uid);
      assert(submittedEmpty, 'Cleared Canvas UID must remain represented in submission');
      assert.equal(submittedEmpty.it.length, 0, 'Cleared Canvas must remain empty in submission');
      await phase('');
      result.metrics = await page.evaluate(() => window.__canvasProgressMetrics.entries);
      log('shared-restore');
      await page.goto(link, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.body.classList.contains('lia-shared-freeze-link'));
      await page.evaluate(() => { location.hash = '#27'; });
      await page.waitForFunction(() => document.querySelectorAll('.flex-child').length === 34 && document.querySelectorAll('.lia-canvas-freeze-preview').length >= 1);
      await page.waitForTimeout(1200);
      result.regressions.sharedRestore = await page.evaluate(() => [...document.querySelectorAll('.flex-child')].map((cell, index) => {
        const preview = cell.querySelector('.lia-canvas-freeze-preview');
        if (!preview) return null;
        return { index, tag: preview.tagName, width: preview.width, height: preview.height, locked: preview.closest('[data-lia-freeze-locked="1"],[data-lia-freeze-canvas-locked="1"]') !== null };
      }).filter(Boolean));
      assert(result.regressions.sharedRestore.some(entry => entry.index === 16 && entry.width > 0), 'Shared preview must restore');
      await page.screenshot({ path: artifacts + '/' + label + '-restored.png', fullPage: false });
      // Exercise the older public cvf1 representation in the same complete course.
      const legacyPayload = structuredClone(payload);
      for (const slide of legacyPayload.s || []) if (slide.canvas) slide.canvas = expandCanvasStatesForRestore(slide.canvas);
      const legacyToken = 'gz:' + gzipSync(Buffer.from(JSON.stringify(legacyPayload))).toString('base64url');
      course.hash = '#submission=' + legacyToken;
      const legacyLink = outer.origin + outer.pathname + '?' + encodeURIComponent(course.href) + '#27';
      await writeFile(artifacts + '/' + label + '-cvf1-submission.txt', legacyLink);
      log('legacy-cvf1-restore');
      await page.goto(legacyLink, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.body.classList.contains('lia-shared-freeze-link'));
      await page.evaluate(() => { location.hash = '#27'; });
      await page.waitForFunction(() => document.querySelectorAll('.flex-child').length === 34 && document.querySelectorAll('.lia-canvas-freeze-preview').length >= 1);
      result.regressions.legacyCvF1Restore = await page.evaluate(() => ({ previews: document.querySelectorAll('.lia-canvas-freeze-preview').length, frozen: document.body.classList.contains('lia-course-frozen') }));
      assert(result.regressions.legacyCvF1Restore.frozen, 'Legacy cvf1 submission must restore as frozen');
    }
  }
  result.ok = true;
} catch (error) { result.ok = false; result.failure = String(error.stack || error); log('failed', result.failure); process.exitCode = 1; }
finally {
  try { result.metrics ||= await page.evaluate(() => window.__canvasProgressMetrics?.entries); } catch {}
  for (const entry of Object.values(result.metrics || {})) {
    entry.longtaskSummary = { count: entry.longtasks.length, totalMs: entry.longtasks.reduce((sum, item) => sum + item.duration, 0), maxMs: Math.max(0, ...entry.longtasks.map(item => item.duration)) };
  }
  await writeFile(artifacts + '/' + label + '-report.json', JSON.stringify(result, null, 2));
  log('summary', { ok: result.ok, failure: result.failure, metrics: Object.fromEntries(Object.entries(result.metrics || {}).map(([name, entry]) => [name, { longtasks: entry.longtaskSummary, calls: Object.fromEntries(Object.entries(entry.calls).map(([key, value]) => [key, { count: value.count, totalMs: Math.round(value.totalMs), maxMs: Math.round(value.maxMs), whileDrawing: value.whileDrawing }])) }])) });
  await browser.close();
}
