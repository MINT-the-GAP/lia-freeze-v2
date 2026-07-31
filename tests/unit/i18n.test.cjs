const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { parseHTML } = require('linkedom');

function loadTypeScriptModule(fileName) {
  const source = readFileSync(fileName, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
    fileName,
  }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
}

const repoRoot = path.resolve(__dirname, '..', '..');
const i18nPromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'i18n.ts'));

const SUBMISSION_HTML = [
  '<html lang=en><body><div class=lia-submit-box>',
  '<h2>Create Submission Link</h2><label for=lia-name>Name</label>',
  '<input id=lia-name placeholder="Enter your name">',
  '<button id=lia-create-link>Create Link</button>',
  '<button id=lia-copy-link disabled>Copy Link</button>',
  '<button id=lia-print-pdf hidden disabled title="Open print">Save PDF</button>',
  '<label for=lia-link>Submission Link</label>',
  '<textarea id=lia-link readonly placeholder="Your link will appear here"></textarea>',
  '<div id=lia-status></div><div id=lia-frozen-note></div></div></body></html>',
].join('');

function submissionFixture() {
  return parseHTML(SUBMISSION_HTML).document;
}

test('normalizes and parses only supported leading course languages', async () => {
  const { normalizeCourseLanguage, parseCourseLanguage } = await i18nPromise;
  for (const value of ['de', ' DE ', 'de-DE', 'DE_de', 'German', 'deutsch']) {
    assert.equal(normalizeCourseLanguage(value), 'de', String(value));
  }
  for (const value of ['en', ' EN ', 'en-GB', 'EN_us', 'English', 'englisch']) {
    assert.equal(normalizeCourseLanguage(value), 'en', String(value));
  }
  for (const value of [undefined, null, 42, '', 'fr', 'deutschland', 'english-us']) {
    assert.equal(normalizeCourseLanguage(value), null, String(value));
  }
  assert.equal(parseCourseLanguage([
    '\uFEFF  <!--', 'author: Test', 'LaNgUaGe: DE-de', '-->', '# Deutscher Kurs',
  ].join('\n')), 'de');
  assert.equal(parseCourseLanguage('<!--\nlanguage: fr\n-->\n# Kurs'), 'en');
  assert.equal(parseCourseLanguage('<!--\nlanguage:\n-->'), 'en');
  assert.equal(parseCourseLanguage('<!-- author: Test -->\n```\nlanguage: de\n```'), null);
  assert.equal(parseCourseLanguage('# Kurs ohne Kopf\nlanguage: de'), null);
});

test('uses authored document language before the browser fallback', async () => {
  const { detectDocumentLanguage } = await i18nPromise;
  const { document } = parseHTML('<html lang=de-DE><body lang=en></body></html>');
  assert.equal(detectDocumentLanguage(document), 'de');
  document.documentElement.removeAttribute('lang');
  assert.equal(detectDocumentLanguage(document), 'en');
  document.documentElement.setAttribute('lang', 'fr');
  document.body.setAttribute('lang', 'de');
  assert.equal(detectDocumentLanguage(document), 'en');

  document.documentElement.removeAttribute('lang');
  document.body.removeAttribute('lang');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { language: 'de-DE' },
    });
    assert.equal(detectDocumentLanguage(document), 'de');
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('provides complete English and German dictionaries and safe fallbacks', async () => {
  const { freezeText, getFreezeLanguage, localeForLanguage, setFreezeLanguage } = await i18nPromise;
  const keys = [
    'submissionHeading', 'nameLabel', 'namePlaceholder', 'createLink',
    'creatingLink', 'copyLink', 'savePdf', 'savePdfTitle', 'submissionLink',
    'linkPlaceholder', 'submissionFrozen', 'submissionLinkCreated',
    'frozenNoteHtml', 'firstSlide', 'previousSlide', 'nextSlide',
    'evaluationSlide', 'printEvaluation', 'printEvaluationTitle',
    'frozenSubmissionReport', 'studentName', 'submissionDate', 'courseVersion',
    'linkCopied', 'copyFailed', 'timeLeft', 'exam', 'examIntro', 'startExam',
    'sendGrading', 'creatingSubmissionLink', 'submissionFailed', 'preparingPdf',
    'openingPrintDialog', 'printDialogClosed', 'printDialogFailed',
    'canvasImageAlt',
    'answerSaved', 'quizStatus', 'taskNumber', 'quiz', 'awardedPoints',
    'valueNotProvided', 'valueNotStored',
  ];
  const values = { time: '04:03', duration: 45, count: 2, number: 3, maximum: 5 };
  for (const language of ['en', 'de']) {
    for (const key of keys) {
      const value = freezeText(key, values, language);
      assert.equal(typeof value, 'string', language + ':' + key);
      assert.ok(value.trim(), language + ':' + key);
      assert.doesNotMatch(value, /\{(?:time|duration|count|number|maximum)\}/);
    }
  }
  assert.equal(freezeText('submissionHeading', {}, 'en'), 'Create Submission Link');
  assert.equal(freezeText('submissionHeading', {}, 'de'), 'Abgabelink erstellen');
  assert.equal(freezeText('taskNumber', { number: 7 }, 'en'), 'Task 7');
  assert.equal(freezeText('taskNumber', { number: 7 }, 'de'), 'Aufgabe 7');
  assert.equal(localeForLanguage('en'), 'en-US');
  assert.equal(localeForLanguage('de'), 'de-DE');
  try {
    assert.equal(setFreezeLanguage('DE_de'), 'de');
    assert.equal(getFreezeLanguage(), 'de');
    assert.equal(freezeText('createLink'), 'Link erstellen');
    assert.equal(setFreezeLanguage('unsupported'), 'en');
    assert.equal(getFreezeLanguage(), 'en');
  } finally {
    setFreezeLanguage('en');
  }
});

test('localizes Abgabe idempotently without replacing values or controls', async () => {
  const { localizeSubmissionUi } = await i18nPromise;
  const document = submissionFixture();
  const box = document.querySelector('.lia-submit-box');
  const name = document.getElementById('lia-name');
  const create = document.getElementById('lia-create-link');
  const copy = document.getElementById('lia-copy-link');
  const print = document.getElementById('lia-print-pdf');
  const link = document.getElementById('lia-link');
  const status = document.getElementById('lia-status');
  const note = document.getElementById('lia-frozen-note');
  const elements = new Map([
    ['lia-name', name], ['lia-create-link', create], ['lia-copy-link', copy],
    ['lia-print-pdf', print], ['lia-link', link], ['lia-status', status],
    ['lia-frozen-note', note],
  ]);

  name.value = 'Ada Lovelace';
  create.disabled = true;
  link.value = 'https://example.test/frozen';
  status.textContent = 'Technical status';
  note.style.display = 'none';
  localizeSubmissionUi(document, 'de');

  assert.equal(box.querySelector('h2').textContent, 'Abgabelink erstellen');
  assert.equal(box.querySelector('label[for=lia-name]').textContent, 'Name');
  assert.equal(name.getAttribute('placeholder'), 'Gib deinen Namen ein');
  assert.equal(create.textContent, 'Link erstellen');
  assert.equal(copy.textContent, 'Link kopieren');
  assert.equal(print.textContent, 'Kurs und Auswertung als PDF speichern');
  assert.equal(print.getAttribute('title'),
    'Druckdialog \u00f6ffnen und \u201eAls PDF speichern\u201c w\u00e4hlen');
  assert.equal(box.querySelector('label[for=lia-link]').textContent, 'Abgabelink');
  assert.equal(link.getAttribute('placeholder'), 'Dein Link erscheint hier');
  assert.equal(name.value, 'Ada Lovelace');
  assert.equal(create.disabled, true);
  assert.equal(copy.disabled, true);
  assert.equal(print.hidden, true);
  assert.equal(print.disabled, true);
  assert.equal(link.value, 'https://example.test/frozen');
  assert.equal(link.hasAttribute('readonly'), true);
  assert.equal(status.textContent, 'Technical status');
  assert.equal(note.style.display, 'none');
  for (const [id, element] of elements) assert.strictEqual(document.getElementById(id), element);

  const localizedMarkup = box.innerHTML;
  localizeSubmissionUi(document, 'de');
  assert.equal(box.innerHTML, localizedMarkup);
  localizeSubmissionUi(document, 'en');
  assert.equal(box.querySelector('h2').textContent, 'Create Submission Link');
  assert.equal(create.textContent, 'Create Link');
  assert.equal(copy.textContent, 'Copy Link');
  assert.equal(link.getAttribute('placeholder'), 'Your link will appear here');
  assert.equal(name.value, 'Ada Lovelace');
  assert.equal(link.value, 'https://example.test/frozen');
});

test('localizes creating and frozen Abgabe states while preserving state', async () => {
  const { localizeSubmissionUi } = await i18nPromise;
  const document = submissionFixture();
  const box = document.querySelector('.lia-submit-box');
  const create = document.getElementById('lia-create-link');
  const name = document.getElementById('lia-name');
  const link = document.getElementById('lia-link');
  const note = document.getElementById('lia-frozen-note');

  name.value = 'Max Mustermann';
  link.value = 'https://example.test/submission';
  create.disabled = true;
  create.setAttribute('data-lia-freeze-state', 'creating');
  localizeSubmissionUi(document, 'de');
  assert.equal(create.textContent, 'Link wird erstellt\u2026');
  create.setAttribute('data-lia-freeze-state', 'frozen');
  note.setAttribute('data-lia-freeze-state', 'frozen');
  note.style.display = 'block';
  localizeSubmissionUi(document, 'de');
  assert.equal(create.textContent, 'Abgabe eingefroren');
  assert.match(note.textContent, /eingefrorene Abgabe/);
  assert.match(note.textContent, /Aufgaben und Eingaben sind gesperrt/);
  assert.equal(note.querySelector('strong').textContent, 'eingefrorene Abgabe');
  assert.equal(note.style.display, 'block');
  assert.equal(name.value, 'Max Mustermann');
  assert.equal(link.value, 'https://example.test/submission');
  assert.equal(create.disabled, true);

  const frozenMarkup = box.innerHTML;
  localizeSubmissionUi(document, 'de');
  assert.equal(box.innerHTML, frozenMarkup);
  localizeSubmissionUi(document, 'en');
  assert.equal(create.textContent, 'Submission frozen');
  assert.match(note.textContent, /frozen submission/);
  assert.equal(note.querySelector('strong').textContent, 'frozen submission');
  assert.equal(name.value, 'Max Mustermann');
  assert.equal(link.value, 'https://example.test/submission');
});
