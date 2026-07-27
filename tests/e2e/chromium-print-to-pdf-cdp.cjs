const { writeFileSync } = require('node:fs');

const endpoint = process.argv[2];
const outputPath = process.argv[3];

if (!endpoint || !outputPath) {
  console.error(
    'Usage: node chromium-print-to-pdf-cdp.cjs <page-websocket-url> <target-pdf>'
  );
  process.exit(2);
}

const socket = new WebSocket(endpoint);
const requestId = 1;
let finished = false;

function closeSocket() {
  if (
    socket.readyState === WebSocket.CONNECTING
    || socket.readyState === WebSocket.OPEN
  ) {
    socket.close();
  }
}

function fail(error) {
  if (finished) return;
  finished = true;
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
  closeSocket();
}

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({
    id: requestId,
    method: 'Page.printToPDF',
    params: {
      printBackground: true,
      preferCSSPageSize: true,
    },
  }));
});

socket.addEventListener('message', event => {
  if (finished) return;

  try {
    const message = JSON.parse(String(event.data));
    if (message.id !== requestId) return;
    if (message.error) {
      throw new Error('Page.printToPDF failed: ' + JSON.stringify(message.error));
    }

    const encoded = message.result?.data;
    if (typeof encoded !== 'string' || encoded.length === 0) {
      throw new Error('Page.printToPDF returned no PDF data');
    }

    const pdf = Buffer.from(encoded, 'base64');
    if (pdf.length === 0) {
      throw new Error('Page.printToPDF returned an empty PDF');
    }

    writeFileSync(outputPath, pdf);
    finished = true;
    process.stdout.write(String(pdf.length) + '\n');
    closeSocket();
  } catch (error) {
    fail(error);
  }
});

socket.addEventListener('error', fail);

socket.addEventListener('close', () => {
  if (!finished) {
    fail(new Error('CDP socket closed before Page.printToPDF completed'));
  }
});
