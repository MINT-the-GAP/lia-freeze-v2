const endpoint = process.argv[2];
if (!endpoint) {
  console.error('Usage: node chromium-print-report-cdp.cjs <page-websocket-url>');
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    const frozen = await evaluate([
      'new Promise(resolve => setTimeout(() => {',
      '  const name = document.getElementById("lia-name");',
      '  name.value = "Ada Lovelace";',
      '  name.dispatchEvent(new Event("input", { bubbles: true }));',
      '  document.getElementById("lia-create-link").click();',
      '  let attempts = 0;',
      '  const timer = setInterval(() => {',
      '    const link = document.getElementById("lia-link")?.value || "";',
      '    const button = document.getElementById("lia-print-pdf");',
      '    if (!link && ++attempts < 150) return;',
      '    clearInterval(timer);',
      '    resolve({',
      '      link,',
      '      printVisible: !!button && !button.hidden,',
      '      printEnabled: !!button && !button.disabled',
      '    });',
      '  }, 100);',
      '}, 900))',
    ].join('\n'));

    assert(frozen.link, 'Live mode did not create a frozen link');
    assert(frozen.printVisible, 'PDF button stayed hidden after Freeze creation');
    assert(frozen.printEnabled, 'PDF button stayed disabled after Freeze creation');

    await command('Emulation.setEmulatedMedia', { media: 'print' });
    const live = await evaluate([
      'new Promise((resolve, reject) => {',
      '  const deadline = Date.now() + 30000;',
      '  document.getElementById("lia-print-pdf").click();',
      '  const poll = () => {',
      '    const probe = window.__freezePrintProbe;',
      '    if (probe?.calls === 1) return resolve({',
      '      probe,',
      '      printClassAfter: document.body.classList.contains("lia-print-report"),',
      '      evaluationAfter: document.getElementById("lia-eval-placeholder")?.style.display || ""',
      '    });',
      '    if (Date.now() >= deadline) {',
      '      return reject(new Error("Timed out waiting for live print probe"));',
      '    }',
      '    setTimeout(poll, 50);',
      '  };',
      '  poll();',
      '})',
    ].join('\n'));
    const livePrint = live.probe.atPrint;
    assert(live.probe.calls === 1, 'Live PDF button did not call print exactly once');
    assert(livePrint.printClass, 'Live print mode was not active during print()');
    assert(livePrint.headerText.includes('Ada Lovelace'), 'Print header missed student name');
    assert(livePrint.headerText.includes('9.4.2'), 'Print header missed frozen course version');
    assert(livePrint.headerText.includes('Druckbarer Freeze-Kurs'), 'Print header missed course title');
    assert(livePrint.headerDisplay === 'block', 'Print header was hidden in print media');
    assert(livePrint.evaluationPosition === 'static', 'Evaluation stayed fixed in print media');
    assert(livePrint.evaluationMaxHeight === 'none', 'Evaluation remained height-clipped');
    assert(livePrint.evaluationOverflow === 'visible', 'Evaluation remained scroll-clipped');
    assert(livePrint.liveButtonDisplay === 'none', 'Live PDF control was printed');
    assert(!live.printClassAfter, 'Live print class was not cleaned after afterprint');
    assert(live.evaluationAfter === 'none', 'Live evaluation was not restored after printing');

    await command('Emulation.setEmulatedMedia', { media: 'screen' });
    await command('Page.navigate', { url: frozen.link });
    await new Promise(resolve => setTimeout(resolve, 1800));
    await command('Emulation.setEmulatedMedia', { media: 'print' });

    const shared = await evaluate([
      'new Promise((resolve, reject) => {',
      '  const button = document.getElementById("lia-freeze-print");',
      '  if (!button) return resolve({ missing: true });',
      '  const deadline = Date.now() + 30000;',
      '  button.click();',
      '  const poll = () => {',
      '    const probe = window.__freezePrintProbe;',
      '    if (probe?.calls === 1) return resolve({',
      '      missing: false,',
      '      probe,',
      '      shared: document.body.classList.contains("lia-shared-freeze-link"),',
      '      printClassAfter: document.body.classList.contains("lia-print-report"),',
      '      evaluationAfter: document.getElementById("lia-eval-placeholder")?.style.display || ""',
      '    });',
      '    if (Date.now() >= deadline) {',
      '      return reject(new Error("Timed out waiting for shared print probe"));',
      '    }',
      '    setTimeout(poll, 50);',
      '  };',
      '  poll();',
      '})',
    ].join('\n'));

    assert(!shared.missing, 'Shared Freeze bar has no PDF button');
    assert(shared.shared, 'Generated link did not boot shared Freeze mode');
    assert(shared.probe.calls === 1, 'Shared PDF button did not call print exactly once');
    assert(shared.probe.atPrint.headerText.includes('Ada Lovelace'), 'Shared print lost student name');
    assert(shared.probe.atPrint.headerText.includes('9.4.2'), 'Shared print lost course version');
    assert(shared.probe.atPrint.freezeBarDisplay === 'none', 'Freeze navigation was printed');
    assert(!shared.printClassAfter, 'Shared print class was not cleaned after afterprint');
    assert(shared.evaluationAfter === 'block', 'Previously open shared evaluation was closed');

    process.stdout.write(JSON.stringify({ live, shared }, null, 2));
  } catch (error) {
    console.error(error.stack || String(error));
    process.exitCode = 1;
  } finally {
    socket.close();
  }
});
