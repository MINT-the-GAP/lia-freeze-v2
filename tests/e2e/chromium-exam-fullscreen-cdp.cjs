const endpoint = process.argv[2];
if (!endpoint) {
  console.error('Usage: node chromium-exam-fullscreen-cdp.cjs <page-websocket-url>');
  process.exit(2);
}

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

socket.addEventListener('open', async () => {
  try {
    const rect = await evaluate([
      'new Promise(resolve => setTimeout(() => {',
      '  const input = document.querySelector(".lia-exam-name-input");',
      '  const button = document.querySelector(".lia-exam-start-btn");',
      '  if (!input || !button) return resolve(null);',
      '  input.value = "Chromium Student";',
      '  input.dispatchEvent(new Event("input", { bubbles: true }));',
      '  button.scrollIntoView({ block: "center", inline: "center" });',
      '  const box = button.getBoundingClientRect();',
      '  resolve({ x: box.left + box.width / 2, y: box.top + box.height / 2 });',
      '}, 1000))',
    ].join('\n'));
    if (!rect) throw new Error('Exam Start UI did not appear');

    const pointer = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      button: 'left',
      clickCount: 1,
    };
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...pointer });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pointer });

    const started = await evaluate([
      'new Promise(resolve => setTimeout(() => resolve({',
      '  fullscreen: document.fullscreenElement === document.documentElement,',
      '  hash: location.hash,',
      '  countdown: document.getElementById("lia-exam-countdown")?.textContent || ""',
      '}), 500))',
    ].join('\n'));

    const sharedUrl = await evaluate([
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
    ].join('\n'));
    if (!sharedUrl) throw new Error('Chromium did not create a local shared link');

    await command('Page.navigate', { url: sharedUrl });
    await new Promise(resolve => setTimeout(resolve, 350));
    const shared = await evaluate([
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
    socket.close();
  }
});
