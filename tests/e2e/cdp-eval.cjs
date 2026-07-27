const wsUrl = process.argv[2];
const expression = Buffer.from(process.argv[3] || '', 'base64').toString('utf8');

if (!wsUrl || !expression) {
  console.error('Usage: node cdp-eval.cjs <websocket-url> <base64-expression>');
  process.exit(2);
}

const socket = new WebSocket(wsUrl);
const requestId = 1;

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({
    id: requestId,
    method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true },
  }));
});

socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (message.id !== requestId) return;

  if (message.error || message.result?.exceptionDetails) {
    console.error('Expression:', JSON.stringify(expression));
    console.error(JSON.stringify(message.error || message.result.exceptionDetails, null, 2));
    process.exitCode = 1;
  } else {
    const result = message.result?.result;
    process.stdout.write(JSON.stringify(result?.value ?? result, null, 2));
  }
  socket.close();
});

socket.addEventListener('error', error => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
