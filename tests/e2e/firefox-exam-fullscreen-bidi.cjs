const endpoint = process.argv[2] || 'ws://127.0.0.1:9234/session';
const socket = new WebSocket(endpoint);
let nextId = 1;
let sessionStarted = false;
const pending = new Map();

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function remoteValue(value) {
  if (!value || typeof value !== 'object') return value;
  if ('value' in value) {
    if (value.type === 'array') return value.value.map(remoteValue);
    if (value.type === 'object') {
      return Object.fromEntries(value.value.map(([key, entry]) => [
        typeof key === 'string' ? key : remoteValue(key),
        remoteValue(entry),
      ]));
    }
    return value.value;
  }
  if (value.type === 'null') return null;
  if (value.type === 'undefined') return undefined;
  return value;
}

async function evaluate(context, expression) {
  const response = await command('script.evaluate', {
    expression,
    target: { context },
    awaitPromise: true,
    resultOwnership: 'none',
    serializationOptions: { maxObjectDepth: 4 },
  });
  if (response.type !== 'success') {
    throw new Error('Firefox evaluation failed: ' + JSON.stringify(response));
  }
  return remoteValue(response.result);
}

socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (!('id' in message)) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.type === 'error') waiter.reject(new Error(JSON.stringify(message)));
  else waiter.resolve(message.result || {});
});

socket.addEventListener('error', error => {
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
});

socket.addEventListener('open', async () => {
  try {
    await command('session.new', { capabilities: {} });
    sessionStarted = true;
    const tree = await command('browsingContext.getTree', {});
    const context = tree.contexts.find(entry =>
      String(entry.url || '').includes('exam-fullscreen.html')
    )?.context;
    if (!context) throw new Error('No local Exam harness browsing context found');

    const rect = await evaluate(context, [
      'new Promise(resolve => setTimeout(() => {',
      '  const input = document.querySelector(".lia-exam-name-input");',
      '  const button = document.querySelector(".lia-exam-start-btn");',
      '  if (!input || !button) return resolve(null);',
      '  input.value = "Firefox Student";',
      '  input.dispatchEvent(new Event("input", { bubbles: true }));',
      '  button.scrollIntoView({ block: "center", inline: "center" });',
      '  const box = button.getBoundingClientRect();',
      '  resolve({ x: box.left + box.width / 2, y: box.top + box.height / 2 });',
      '}, 1200))',
    ].join('\n'));
    if (!rect) throw new Error('Exam Start UI did not appear');

    await command('input.performActions', {
      context,
      actions: [{
        type: 'pointer',
        id: 'mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          { type: 'pointerMove', x: Math.round(rect.x), y: Math.round(rect.y), duration: 0, origin: 'viewport' },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ],
      }],
    });
    await command('input.releaseActions', { context });

    const started = await evaluate(context, [
      'new Promise(resolve => setTimeout(() => resolve({',
      '  fullscreen: document.fullscreenElement === document.documentElement,',
      '  hash: location.hash,',
      '  countdown: document.getElementById("lia-exam-countdown")?.textContent || ""',
      '}), 500))',
    ].join('\n'));

    await evaluate(context, [
      'document.exitFullscreen().then(() => new Promise(resolve => {',
      '  location.hash = "#3";',
      '  setTimeout(() => document.getElementById("lia-create-link").click(), 150);',
      '  let attempts = 0;',
      '  const timer = setInterval(() => {',
      '    const link = document.getElementById("lia-link").value;',
      '    if (!link && ++attempts < 100) return;',
      '    clearInterval(timer);',
      '    if (!link) return resolve("");',
      '    const outer = new URL(link);',
      '    const course = new URL(decodeURIComponent(outer.search.slice(1)));',
      '    const token = course.hash.slice("#submission=".length);',
      '    resolve(location.origin + location.pathname + "#3&submission=" + encodeURIComponent(token));',
      '  }, 100);',
      '}))',
    ].join('\n')).then(async sharedUrl => {
      if (!sharedUrl) throw new Error('Firefox did not create a local shared link');
      await command('browsingContext.navigate', {
        context,
        url: sharedUrl,
        wait: 'complete',
      });
    });

    const shared = await evaluate(context, [
      'new Promise(resolve => setTimeout(() => {',
      '  const text = document.getElementById("lia-eval-placeholder")?.innerText || "";',
      '  resolve({',
      '    shared: document.body.classList.contains("lia-shared-freeze-link"),',
      '    fullscreen: !!document.fullscreenElement,',
      '    start: !!document.querySelector(".lia-exam-start-btn"),',
      '    exit: text.includes("Fullscreen mode was left once during the exam")',
      '  });',
      '}, 1200))',
    ].join('\n'));

    process.stdout.write(JSON.stringify({ started, shared }, null, 2));
  } catch (error) {
    console.error(error.stack || String(error));
    process.exitCode = 1;
  } finally {
    if (sessionStarted) {
      try { await command('session.end', {}); } catch { /* browser may close first */ }
    }
    socket.close();
  }
});
