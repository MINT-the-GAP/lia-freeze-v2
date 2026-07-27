const wsUrl = process.argv[2];
const request = JSON.parse(
  Buffer.from(process.argv[3] || '', 'base64').toString('utf8') || '{}'
);

if (!wsUrl || typeof request.method !== 'string') {
  console.error('Usage: node cdp-call.cjs <websocket-url> <base64-json-request>');
  process.exit(2);
}

const socket = new WebSocket(wsUrl);
const requestId = 1;

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({
    id: requestId,
    method: request.method,
    params: request.params || {},
  }));
});

socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (message.id !== requestId) return;
  if (message.error) {
    console.error(JSON.stringify(message.error, null, 2));
    process.exitCode = 1;
  } else {
    process.stdout.write(JSON.stringify(message.result || {}, null, 2));
  }
  socket.close();
});

socket.addEventListener('error', error => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
