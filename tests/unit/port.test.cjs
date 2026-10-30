const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

const source = readFileSync(path.resolve(__dirname, '../../src/port.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
}).outputText;
const port = import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

test('restores quiz and survey vectors using the native DB load reply contract', async () => {
  const { sendRestoreEvent } = await port;
  const quiz = [{
    solved: 0, trial: 1, hint: 0, error_msg: '',
    state: { SingleChoice: [false, true, false] },
  }];
  const survey = [{ submitted: false, state: { Text: 'Saved reflection' } }];
  const received = [];
  const previous = global.window;
  global.window = { LIA: { send: event => received.push(event) } };
  try {
    sendRestoreEvent('quiz', 0, quiz);
    sendRestoreEvent('survey', 2, survey);
    assert.deepEqual(received.map(event => [event.reply, event.service, event.track]), [
      [true, 'db', [['quiz', 0]]],
      [true, 'db', [['survey', 2]]],
    ]);
    // Quiz.Json.toVector and Survey.Json.toVector decode arrays directly,
    // exactly as Database.handle replaces the original load request param.
    for (const event of received) {
      assert.equal(event.message.cmd, 'load');
      assert.ok(Array.isArray(event.message.param), 'request envelopes are not valid load replies');
    }
    assert.deepEqual(received[0].message.param[0].state.SingleChoice, [false, true, false]);
    assert.equal(received[1].message.param[0].state.Text, 'Saved reflection');
  } finally {
    if (previous === undefined) delete global.window;
    else global.window = previous;
  }
});
