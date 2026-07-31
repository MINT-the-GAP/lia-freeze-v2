const endpoint = process.argv[2] || 'ws://127.0.0.1:9233/session';
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
      String(entry.url || '').includes('localhost:3022')
    )?.context;
    if (!context) throw new Error('No local LiaScript browsing context found');

    await evaluate(context, `
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'F12',
        code: 'F12',
        bubbles: true
      }));
      location.hash = '#3';
      new Promise(resolve => setTimeout(() => resolve(true), 1200));
    `);

    await command('input.performActions', {
      context,
      actions: [{
        type: 'key',
        id: 'keyboard',
        actions: [
          { type: 'keyDown', value: '\uE009' },
          { type: 'keyDown', value: '\uE008' },
          { type: 'keyDown', value: 'i' },
          { type: 'keyUp', value: 'i' },
          { type: 'keyUp', value: '\uE008' },
          { type: 'keyUp', value: '\uE009' },
        ],
      }],
    });
    await command('input.releaseActions', { context });

    const link = await evaluate(context, `
      (() => {
        const input = document.querySelector('#lia-name');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'Firefox E2E');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#lia-create-link').click();
        return new Promise(resolve => setTimeout(
          () => resolve(document.querySelector('#lia-link').value),
          2200
        ));
      })()
    `);
    if (typeof link !== 'string' || !link.includes('submission')) {
      throw new Error('Firefox did not create a submission link');
    }

    await command('browsingContext.navigate', {
      context,
      url: link,
      wait: 'complete',
    });
    const result = await evaluate(context, `
      new Promise(resolve => setTimeout(() => {
        const text = document.body.innerText;
        resolve({
          title: document.title,
          hash: location.hash,
          signal: text.includes('DevTools-related browser signals detected'),
          one: text.includes('1 signal incident.'),
          shortcut: text.includes('Trusted shortcut candidates: 1'),
          firefox: text.includes('Browser family: Firefox'),
          notProof: text.includes('not proof that DevTools were opened'),
          categorical: text.includes('Fraud attempt detected: DevTools')
            || text.includes('DevTools (F12) were opened'),
        });
      }, 5000))
    `);
    process.stdout.write(JSON.stringify(result, null, 2));
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
