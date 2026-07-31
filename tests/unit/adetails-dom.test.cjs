const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

function loadTypeScriptModule(fileName) {
  const source = readFileSync(fileName, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ES2020,
    },
    fileName,
  }).outputText;
  const encoded = Buffer.from(compiled, 'utf8').toString('base64');
  return import('data:text/javascript;base64,' + encoded);
}

const repoRoot = path.resolve(__dirname, '..', '..');
const adetailsDomPromise = loadTypeScriptModule(
  path.join(repoRoot, 'src', 'adetails-dom.ts')
);

function fixture(markup, bodyClass = '') {
  const { document, window } = parseHTML(
    `<html><body class=${bodyClass}><main id=content>${markup}</main></body></html>`
  );
  window.location = { hash: '#1' };
  // Linkedom emits document-order bits but does not expose their Node constants.
  window.Node.DOCUMENT_POSITION_FOLLOWING = 2;
  window.Node.DOCUMENT_POSITION_PRECEDING = 4;
  return { document, window, host: document.querySelector('#content') };
}

function quizMarkup(id) {
  return `<section id='${id}' class='lia-quiz open'>` +
    `<div class='lia-quiz__answers'><input value=''></div>` +
    `<div class='lia-quiz__control'>` +
    `<button class='lia-quiz__check' type='button'>Check</button>` +
    `</div></section>`;
}

function assignmentMetadataAttributes(element) {
  return Array.from(element.attributes)
    .map(attribute => attribute.name)
    .filter(name => name.startsWith('data-adetail'));
}

function delay(milliseconds = 20) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

test('owns the badge in the marker shadow root without mutating Lia quiz controls', async () => {
  const {
    getAssignmentDetailSidecar,
    refreshAssignmentDetailSidecars,
  } = await adetailsDomPromise;
  const { host } = fixture(`
    ${quizMarkup('quiz-one')}
    <span class='lia-assignment-details' data-adetails='2 | 3; Tags: algebra, linear'></span>
  `);
  const quiz = host.querySelector('#quiz-one');
  const control = quiz.querySelector('.lia-quiz__control');
  const check = quiz.querySelector('.lia-quiz__check');
  const marker = host.querySelector('[data-adetails]');
  const quizBefore = quiz.outerHTML;

  refreshAssignmentDetailSidecars(host);

  const sidecar = getAssignmentDetailSidecar(marker);
  assert.ok(sidecar);
  assert.strictEqual(sidecar.shadow.host, marker);
  assert.strictEqual(marker.shadowRoot, sidecar.shadow);
  assert.strictEqual(sidecar.quizRoot, quiz);
  assert.equal(sidecar.badge.textContent, '5 BE');
  assert.equal(sidecar.badge.hidden, false);
  assert.equal(sidecar.badge.closest('.lia-quiz__control'), null);
  assert.equal(control.contains(sidecar.badge), false);
  assert.equal(host.querySelector('.lia-adetails-points'), null);
  assert.equal(host.querySelectorAll('[data-adetails-owner]').length, 0);
  assert.equal(
    marker.shadowRoot.querySelectorAll('[data-adetails-owner]').length,
    2
  );
  assert.equal(quiz.outerHTML, quizBefore);
  assert.deepEqual(assignmentMetadataAttributes(quiz), []);
  assert.deepEqual(assignmentMetadataAttributes(control), []);
  assert.deepEqual(assignmentMetadataAttributes(check), []);
});

test('refresh is idempotent and updates existing sidecar content in place', async () => {
  const {
    getAssignmentDetailSidecar,
    refreshAssignmentDetailSidecars,
  } = await adetailsDomPromise;
  const { host } = fixture(`
    ${quizMarkup('quiz-one')}
    <span class='lia-assignment-details' data-adetails='1 | 2; Tags: old'></span>
  `);
  const marker = host.querySelector('[data-adetails]');

  refreshAssignmentDetailSidecars(host);
  const first = getAssignmentDetailSidecar(marker);
  refreshAssignmentDetailSidecars(host);
  const second = getAssignmentDetailSidecar(marker);

  assert.strictEqual(second.shadow, first.shadow);
  assert.strictEqual(second.badge, first.badge);
  assert.equal(
    marker.shadowRoot.querySelectorAll('[data-lia-freeze-adetails-sidecar]').length,
    1
  );
  assert.equal(first.badge.textContent, '3 BE');

  marker.setAttribute('data-adetails', 'Points: 7; Tags: new, updated');
  refreshAssignmentDetailSidecars(host);
  const updated = getAssignmentDetailSidecar(marker);
  const root = marker.shadowRoot.querySelector('[data-lia-freeze-adetails-sidecar]');

  assert.strictEqual(updated.badge, first.badge);
  assert.equal(updated.badge.textContent, '7 BE');
  assert.equal(root.getAttribute('data-adetails-raw'), 'Points: 7; Tags: new, updated');
  assert.equal(root.getAttribute('data-adetails-points'), '7');
  assert.equal(root.getAttribute('data-adetails-point-parts'), '[7]');
  assert.deepEqual(JSON.parse(root.getAttribute('data-adetail-tags')), ['new', 'updated']);
});

test('keeps two quiz sidecars and their status or feedback isolated', async () => {
  const {
    assignmentDetailMarkerForQuiz,
    getAssignmentDetailSidecar,
    refreshAssignmentDetailSidecars,
    setAssignmentDetailFeedback,
    setAssignmentDetailSendStatus,
  } = await adetailsDomPromise;
  const { host } = fixture(`
    ${quizMarkup('quiz-one')}
    <span id='marker-one' class='lia-assignment-details' data-adetails='2'></span>
    ${quizMarkup('quiz-two')}
    <span id='marker-two' class='lia-assignment-details' data-adetails='4'></span>
  `);
  const quizOne = host.querySelector('#quiz-one');
  const quizTwo = host.querySelector('#quiz-two');
  const markerOne = host.querySelector('#marker-one');
  const markerTwo = host.querySelector('#marker-two');

  refreshAssignmentDetailSidecars(host);
  const first = getAssignmentDetailSidecar(markerOne);
  const second = getAssignmentDetailSidecar(markerTwo);

  assert.strictEqual(assignmentDetailMarkerForQuiz(quizOne, host), markerOne);
  assert.strictEqual(assignmentDetailMarkerForQuiz(quizTwo, host), markerTwo);
  assert.strictEqual(first.quizRoot, quizOne);
  assert.strictEqual(second.quizRoot, quizTwo);
  assert.notEqual(first.ownerId, second.ownerId);
  assert.equal(first.badge.textContent, '2 BE');
  assert.equal(second.badge.textContent, '4 BE');

  assert.equal(setAssignmentDetailSendStatus(quizOne, host, 'Sent once'), true);
  assert.equal(setAssignmentDetailFeedback(quizOne, host, {
    text: 'First feedback',
    hidden: false,
    appearance: ['success'],
  }), true);
  assert.equal(first.status.textContent, 'Sent once');
  assert.equal(first.feedback.textContent, 'First feedback');
  assert.equal(first.feedback.classList.contains('success'), true);
  assert.equal(second.status.textContent, '');
  assert.equal(second.status.hidden, true);
  assert.equal(second.feedback.textContent, '');
  assert.equal(second.feedback.hidden, true);

  markerOne.setAttribute('data-adetails', '6');
  refreshAssignmentDetailSidecars(host);
  assert.equal(first.badge.textContent, '6 BE');
  assert.equal(second.badge.textContent, '4 BE');
});

test('routes markerless quiz status and feedback through a body-level shadow portal', async () => {
  const {
    clearAssignmentDetailSendStatuses,
    disconnectAssignmentDetailObserver,
    materializeAssignmentDetailSidecarsForPrint,
    refreshAssignmentDetailSidecars,
    setAssignmentDetailFeedback,
    setAssignmentDetailSendStatus,
  } = await adetailsDomPromise;
  const { document, host } = fixture(quizMarkup('quiz-without-details'));
  const quiz = host.querySelector('#quiz-without-details');
  const quizBefore = quiz.outerHTML;

  assert.equal(setAssignmentDetailSendStatus(quiz, host, 'Stored safely'), true);
  const portal = document.body.querySelector('[data-lia-freeze-quiz-sidecars]');
  assert.ok(portal);
  assert.strictEqual(portal.parentElement, document.body);
  assert.equal(portal.childNodes.length, 0);
  assert.equal(portal.closest('.lia-quiz,.lia-quiz__control'), null);
  assert.equal(portal.shadowRoot.querySelector('.lia-send-status').textContent, 'Stored safely');

  assert.equal(setAssignmentDetailFeedback(quiz, host, {
    text: 'Restored safely',
    hidden: false,
    appearance: ['success'],
  }), true);
  const feedback = portal.shadowRoot.querySelector('.lia-quiz__feedback');
  assert.equal(feedback.textContent, 'Restored safely');
  assert.equal(feedback.classList.contains('success'), true);
  assert.equal(quiz.outerHTML, quizBefore);

  const printClone = host.cloneNode(true);
  materializeAssignmentDetailSidecarsForPrint(host, printClone);
  const printed = printClone.querySelector('.lia-freeze-generic-print-sidecar');
  assert.ok(printed);
  assert.match(printed.textContent, /Stored safely/);
  assert.match(printed.textContent, /Restored safely/);
  assert.equal(printed.closest('.lia-quiz__control'), null);

  clearAssignmentDetailSendStatuses(document);
  assert.equal(portal.shadowRoot.querySelector('.lia-send-status').hidden, true);
  assert.equal(portal.isConnected, true, 'visible feedback keeps the portal alive');
  assert.equal(setAssignmentDetailFeedback(quiz, host, null), true);
  assert.equal(portal.isConnected, false);

  setAssignmentDetailSendStatus(quiz, host, 'Temporary');
  const orphanPortal = document.body.querySelector('[data-lia-freeze-quiz-sidecars]');
  quiz.remove();
  refreshAssignmentDetailSidecars(host);
  assert.equal(orphanPortal.isConnected, false);

  host.appendChild(quiz);
  setAssignmentDetailSendStatus(quiz, host, 'Dispose me');
  const disposablePortal = document.body.querySelector('[data-lia-freeze-quiz-sidecars]');
  disconnectAssignmentDetailObserver(document);
  assert.equal(disposablePortal.isConnected, false);
});

test('shared-link award input stays editable and refresh does not duplicate listeners', async () => {
  const { refreshAssignmentDetailSidecars } = await adetailsDomPromise;
  const { host, window } = fixture(`
    ${quizMarkup('quiz-one')}
    <span class='lia-assignment-details' data-adetails='5'></span>
  `, 'lia-shared-freeze-link');
  const marker = host.querySelector('[data-adetails]');
  const values = new Map();
  const writes = [];
  let changes = 0;
  const award = {
    getHash: () => '#4',
    getDefaultAward: (_hash, taskIndex, maximum) => maximum - taskIndex,
    getValue: key => values.get(key),
    setValue: (key, value) => {
      writes.push([key, value]);
      values.set(key, value);
    },
    onChange: () => { changes += 1; },
  };

  refreshAssignmentDetailSidecars(host, { award });
  const input = marker.shadowRoot.querySelector('.lia-adetails-award-input');
  assert.ok(input);
  assert.equal(input.value, '4');
  assert.equal(input.hasAttribute('disabled'), false);
  assert.equal(input.hasAttribute('readonly'), false);
  assert.equal(input.getAttribute('data-adetails-award-key'), '#4::task::1');
  assert.equal(input.getAttribute('aria-label'), 'Awarded points (maximum 5 BE)');

  refreshAssignmentDetailSidecars(host, { award });
  refreshAssignmentDetailSidecars(host, { award });
  assert.strictEqual(
    marker.shadowRoot.querySelector('.lia-adetails-award-input'),
    input
  );

  input.value = '3.5';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(writes, [['#4::task::1', '3.5']]);
  assert.equal(changes, 1);

  refreshAssignmentDetailSidecars(host, { award });
  assert.equal(input.value, '3.5');
  input.value = '2';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(writes, [
    ['#4::task::1', '3.5'],
    ['#4::task::1', '2'],
  ]);
  assert.equal(changes, 2);

  marker.remove();
  refreshAssignmentDetailSidecars(host, { award });
  input.value = '1';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(writes.length, 2, 'the detached input listener must be disposed');
  assert.equal(changes, 2);

  host.appendChild(marker);
  refreshAssignmentDetailSidecars(host, { award });
  const remountedInput = marker.shadowRoot.querySelector('.lia-adetails-award-input');
  assert.ok(remountedInput);
  assert.notStrictEqual(remountedInput, input);
  assert.equal(
    marker.shadowRoot.querySelectorAll('.lia-adetails-award-input').length,
    1
  );
  remountedInput.value = '1';
  remountedInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(writes.at(-1), ['#4::task::1', '1']);
  assert.equal(writes.length, 3);
  assert.equal(changes, 3);
});

test('localizes Freeze-owned ADetails labels without changing the English default', async () => {
  const {
    configureAssignmentDetailLanguage,
    refreshAssignmentDetailSidecars,
    setAssignmentDetailSendStatus,
  } = await adetailsDomPromise;

  configureAssignmentDetailLanguage('de-DE');
  try {
    const awardFixture = fixture(`
      ${quizMarkup('quiz-de')}
      <span class='lia-assignment-details' data-adetails='5'></span>
    `, 'lia-shared-freeze-link');
    const award = {
      getHash: () => '#1',
      getDefaultAward: () => 5,
      getValue: () => undefined,
      setValue() {},
      onChange() {},
    };
    refreshAssignmentDetailSidecars(awardFixture.host, { award });
    const marker = awardFixture.host.querySelector('[data-adetails]');
    assert.equal(
      marker.shadowRoot.querySelector('.lia-adetails-award-input').getAttribute('aria-label'),
      'Vergebene Punkte (maximal 5 BE)'
    );

    const genericFixture = fixture(quizMarkup('generic-de'));
    const quiz = genericFixture.host.querySelector('#generic-de');
    setAssignmentDetailSendStatus(quiz, genericFixture.host, 'Gespeichert');
    const portal = genericFixture.document.body.querySelector(
      '[data-lia-freeze-quiz-sidecars]'
    );
    assert.equal(portal.getAttribute('aria-label'), 'Aufgabenstatus');
    assert.equal(
      portal.shadowRoot.querySelector('.lia-freeze-generic-sidecar-label').textContent,
      'Aufgabe 1'
    );
  } finally {
    configureAssignmentDetailLanguage('en');
  }
});

test('cleans detached sidecars and remounts one fresh shadow root child', async () => {
  const {
    disconnectAssignmentDetailObserver,
    getAssignmentDetailSidecar,
    observeAssignmentDetailSidecars,
    refreshAssignmentDetailSidecars,
  } = await adetailsDomPromise;
  const { document, host } = fixture(`
    ${quizMarkup('quiz-one')}
    <span class='lia-assignment-details' data-adetails='3'></span>
  `);
  const marker = host.querySelector('[data-adetails]');

  refreshAssignmentDetailSidecars(host);
  const shadow = marker.shadowRoot;
  const firstRoot = shadow.querySelector('[data-lia-freeze-adetails-sidecar]');
  marker.remove();
  refreshAssignmentDetailSidecars(host);
  assert.equal(getAssignmentDetailSidecar(marker), null);
  assert.equal(shadow.querySelector('[data-lia-freeze-adetails-sidecar]'), null);

  host.appendChild(marker);
  refreshAssignmentDetailSidecars(host);
  const secondRoot = shadow.querySelector('[data-lia-freeze-adetails-sidecar]');
  assert.strictEqual(marker.shadowRoot, shadow);
  assert.notStrictEqual(secondRoot, firstRoot);
  assert.equal(
    shadow.querySelectorAll('[data-lia-freeze-adetails-sidecar]').length,
    1
  );
  assert.equal(getAssignmentDetailSidecar(marker).badge.textContent, '3 BE');

  observeAssignmentDetailSidecars(document, () => refreshAssignmentDetailSidecars(host));
  disconnectAssignmentDetailObserver(document);
  assert.equal(getAssignmentDetailSidecar(marker), null);
  assert.equal(shadow.querySelector('[data-lia-freeze-adetails-sidecar]'), null);

  refreshAssignmentDetailSidecars(host);
  const thirdRoot = shadow.querySelector('[data-lia-freeze-adetails-sidecar]');
  assert.strictEqual(marker.shadowRoot, shadow);
  assert.notStrictEqual(thirdRoot, secondRoot);
  assert.equal(
    shadow.querySelectorAll('[data-lia-freeze-adetails-sidecar]').length,
    1
  );
  assert.equal(getAssignmentDetailSidecar(marker).badge.textContent, '3 BE');
});

test('observer refreshes a sidecar when a quiz is inserted later', async () => {
  const {
    getAssignmentDetailSidecar,
    observeAssignmentDetailSidecars,
    refreshAssignmentDetailSidecars,
  } = await adetailsDomPromise;
  const { document, host } = fixture(`
    <div class='flex-child'>${quizMarkup('prior-flex-quiz')}</div>
    <div id='late-flex' class='flex-child'>
      <span id='late-marker' class='lia-assignment-details' data-adetails='8'></span>
    </div>
  `);
  const marker = host.querySelector('#late-marker');
  refreshAssignmentDetailSidecars(host);
  const initialSidecar = getAssignmentDetailSidecar(marker);
  assert.ok(initialSidecar);
  assert.equal(initialSidecar.quizRoot, null);
  assert.equal(initialSidecar.badge.hidden, true);
  assert.notStrictEqual(initialSidecar.quizRoot, host.querySelector('#prior-flex-quiz'));
  let refreshes = 0;
  const disconnect = observeAssignmentDetailSidecars(document, () => {
    refreshes += 1;
    refreshAssignmentDetailSidecars(host);
  });

  try {
    await new Promise(resolve => setTimeout(() => {
      marker.insertAdjacentHTML('beforebegin', quizMarkup('late-quiz'));
      resolve();
    }, 0));
    await delay();

    const sidecar = getAssignmentDetailSidecar(marker);
    assert.ok(refreshes >= 1);
    assert.ok(sidecar);
    assert.strictEqual(sidecar.quizRoot, host.querySelector('#late-quiz'));
    assert.equal(sidecar.badge.textContent, '8 BE');
  } finally {
    disconnect();
  }
});

test('materializes visible badge, status, and feedback in a print clone', async () => {
  const {
    materializeAssignmentDetailSidecarsForPrint,
    refreshAssignmentDetailSidecars,
    setAssignmentDetailFeedback,
    setAssignmentDetailSendStatus,
  } = await adetailsDomPromise;
  const { host } = fixture(`
    ${quizMarkup('quiz-one')}
    <span class='lia-assignment-details' data-adetails='5'></span>
  `);
  const quiz = host.querySelector('#quiz-one');
  const sourceMarker = host.querySelector('[data-adetails]');
  refreshAssignmentDetailSidecars(host);
  setAssignmentDetailSendStatus(quiz, host, 'Sent twice');
  setAssignmentDetailFeedback(quiz, host, {
    text: 'Correct answer',
    hidden: false,
  });
  const clone = host.cloneNode(true);

  materializeAssignmentDetailSidecarsForPrint(host, clone);

  const cloneMarker = clone.querySelector('[data-adetails]');
  const output = cloneMarker.querySelector('.lia-adetails-print-sidecar');
  assert.ok(output);
  assert.match(output.textContent, /5 BE/);
  assert.match(output.textContent, /Sent twice/);
  assert.match(output.textContent, /Correct answer/);
  assert.equal(cloneMarker.style.getPropertyValue('display'), 'inline-flex');
  assert.equal(cloneMarker.style.getPropertyValue('visibility'), 'visible');
  assert.equal(sourceMarker.querySelector('.lia-adetails-print-sidecar'), null);
  assert.equal(clone.querySelectorAll('.lia-adetails-print-sidecar').length, 1);
  assert.deepEqual(
    assignmentMetadataAttributes(clone.querySelector('#quiz-one')),
    []
  );
});
