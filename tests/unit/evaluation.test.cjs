const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

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
const evaluationPromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'evaluation.ts'));
const codecPromise = loadTypeScriptModule(path.join(repoRoot, 'src', 'codec.ts'));
const fixturePath = path.join(repoRoot, 'tests', 'e2e', 'native-quizzes.md');
const flexFixturePath = path.join(repoRoot, 'tests', 'e2e', 'adetails-flex-mixed.md');
const sendFixturePath = path.join(repoRoot, 'tests', 'e2e', 'send-mode.md');
const kachelFixturePath = path.join(repoRoot, 'tests', 'e2e', 'kachel-quizzes.md');
const orthographyFixturePaths = [
  path.join(repoRoot, 'tests', 'e2e', 'orthography-main.md'),
  path.join(repoRoot, 'tests', 'e2e', 'orthography-proposals.md'),
];
const matheFractionFixturePaths = [
  path.join(repoRoot, 'tests', 'e2e', 'mathe-main.md'),
  path.join(repoRoot, 'tests', 'e2e', 'mathe-0.0.2.md'),
  path.join(repoRoot, 'tests', 'e2e', 'mathe-css-changes.md'),
];
const matheProposalsFixturePath =
  path.join(repoRoot, 'tests', 'e2e', 'mathe-proposals.md');
const markerFixturePaths = [
  path.join(repoRoot, 'tests', 'e2e', 'marker-main.md'),
  path.join(repoRoot, 'tests', 'e2e', 'marker-proposals.md'),
  path.join(repoRoot, 'tests', 'e2e', 'marker-0.0.1.md'),
];
const coordinateCombinedFixturePath =
  path.join(repoRoot, 'tests', 'e2e', 'coordinate-proposal-combined.md');
const readmePath = path.join(repoRoot, 'README.md');

const coordinateQuizNames = [
  'CreatePoint',
  'ErzeugePunkt',
  'PointOnGraph',
  'PunktGraph',
  'PointsOnGraph',
  'PunkteAufGraph',
  'Rekonstruktion',
  'Reconstruction',
  'PerimeterQuiz',
  'UmfangQuiz',
  'AreaQuiz',
  'FlaecheQuiz',
  'ConstructionQuiz',
  'KonstruktionQuiz',
  'KoordQuiz',
  'GeometrieQuiz',
  'CoordinateQuiz',
  'GeometryQuiz',
];

function buildCoordinateCourse() {
  const lines = ['# Coordinate Proposal'];
  coordinateQuizNames.forEach((name, index) => {
    lines.push('@' + name + '(`board-' + index + '`, `<!-- -->`)');
    lines.push('@ADetails(' + (index + 1) + ';Coord-' + (index + 1) + ')');
  });
  return lines.join('\n');
}

function buildPayload(elementsBySection, surveyBySection = {}) {
  const slides = Array.from({ length: 8 }, (_, index) => ({ h: '#' + (index + 1) }));
  for (const [section, elements] of Object.entries(elementsBySection)) {
    const index = Number(section);
    slides[index].quiz = { [index]: elements };
  }
  for (const [section, survey] of Object.entries(surveyBySection)) {
    const index = Number(section);
    slides[index].survey = { [index]: survey };
  }
  return { v: 2, sh: '#8', s: slides };
}

function buildFallbackPayload(elementsBySection) {
  const payload = buildPayload({});
  for (const [section, elements] of Object.entries(elementsBySection)) {
    const index = Number(section);
    payload.s[index].quizEval = { [index]: elements };
  }
  return payload;
}

test('parses Send case-insensitively while ignoring fenced and commented examples', async () => {
  const { parseEvaluationOptions } = await evaluationPromise;
  const markdown = [
    '<!-- @Auswertung(Send) -->',
    '# Kurs',
    '@Auswertung(F12;Tab)',
    '~~~markdown',
    '@Auswertung(Time;Send)',
    '~~~',
    '@Auswertung(time;sEnD)',
  ].join('\n');

  assert.deepEqual(parseEvaluationOptions(markdown), {
    trackF12: true,
    trackTab: true,
    trackTime: true,
    deferFeedback: true,
  });
  assert.deepEqual(parseEvaluationOptions('# Kurs\n@Auswertung'), {
    trackF12: false,
    trackTab: false,
    trackTime: false,
    deferFeedback: false,
  });
});

test('validates and renders exact per-task Send Check counts independently of native trials', async () => {
  const {
    parseDeclaredSlides,
    parseEvaluationDeclarations,
    readFrozenSendCheckCounts,
    renderEvaluationSlide,
  } = await evaluationPromise;
  const markdown = readFileSync(sendFixturePath, 'utf8');
  const declarations = parseEvaluationDeclarations(markdown);
  const payload = buildPayload({
    1: [{ solved: 1, trial: 99 }],
    2: [{ solved: 0, trial: 99 }],
  });
  payload.sendChecks = {
    version: 1,
    items: [
      { hash: '#3', taskIndex: 0, count: 1 },
      { hash: '#2', taskIndex: 0, count: 2 },
    ],
  };

  const evidence = readFrozenSendCheckCounts(payload.sendChecks);
  assert.ok(evidence);
  assert.equal(evidence.total, 3);
  assert.deepEqual(evidence.items, [
    { hash: '#2', taskIndex: 0, count: 2 },
    { hash: '#3', taskIndex: 0, count: 1 },
  ]);

  const html = renderEvaluationSlide({
    payload,
    evalDecl: declarations,
    slides: parseDeclaredSlides(markdown),
  });
  assert.match(html, /data-lia-send-check-total="3"/);
  assert.match(html, /data-lia-send-check-task="#2::send::0" data-lia-send-check-count="2"/);
  assert.match(html, /data-lia-send-check-task="#3::send::0" data-lia-send-check-count="1"/);
  assert.match(html, /data-lia-send-check-task="#4::send::0" data-lia-send-check-count="0"/);
  assert.match(html, /automatic Freeze grading do not increase these values/);

  const legacyPayload = { ...payload };
  delete legacyPayload.sendChecks;
  assert.doesNotMatch(renderEvaluationSlide({
    payload: legacyPayload,
    evalDecl: declarations,
    slides: parseDeclaredSlides(markdown),
  }), /data-lia-send-check-summary/);

  const malformed = {
    version: 1,
    items: [
      { hash: '#2', taskIndex: 0, count: 1 },
      { hash: '#2', taskIndex: 0, count: 2 },
    ],
  };
  assert.equal(readFrozenSendCheckCounts(malformed), null);
  assert.doesNotMatch(renderEvaluationSlide({
    payload: { ...payload, sendChecks: malformed },
    evalDecl: declarations,
  }), /data-lia-send-check-summary/);
});

test('roundtrips Send metadata and defaults legacy version-1 links to immediate feedback', async () => {
  const {
    buildFrozenEvaluationMetadata,
    readFrozenEvaluationMetadata,
  } = await evaluationPromise;
  const slides = [{ h: '#1', t: 'Kurs' }];
  const metadata = buildFrozenEvaluationMetadata(
    {},
    slides,
    '#1',
    {
      trackF12: true,
      trackTab: true,
      trackTime: true,
      deferFeedback: true,
    },
    1,
  );

  assert.equal(readFrozenEvaluationMetadata(metadata).options.deferFeedback, true);
  assert.deepEqual(readFrozenEvaluationMetadata({
    ...metadata,
    options: {
      trackF12: true,
      trackTab: false,
      trackTime: true,
    },
  }).options, {
    trackF12: true,
    trackTab: false,
    trackTime: true,
    deferFeedback: false,
  });
});

test('detects all six baseline inputs and their ADetails weights', async () => {
  const { parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(readFileSync(fixturePath, 'utf8'));

  const expected = [
    ['#2', 1, 1, 'Eingabequiz'],
    ['#3', 1, 2, 'MultipleChoice'],
    ['#4', 1, 1, 'SingleChoice'],
    ['#5', 1, 0, 'FreeText'],
    ['#6', 1, 3, 'MatrixChoiceQuiz'],
    ['#7', 1, 1, 'AuswahlQuiz'],
  ];

  for (const [hash, taskCount, points, tag] of expected) {
    assert.equal(declarations[hash].tt, taskCount, hash + ' task count');
    assert.equal(declarations[hash].tb, points, hash + ' points');
    assert.deepEqual(declarations[hash].tl, [{
      be: points,
      tg: [tag],
      table: tag === 'FreeText' ? 'survey' : 'quiz',
    }]);
  }
});

test('detects the official unindented Single-Choice syntax', async () => {
  const { parseEvaluationDeclarations } = await evaluationPromise;
  const markdown = [
    '# Kurs',
    '## SingleChoice',
    '[( )] drei',
    '[(X)] vier',
    '[( )] fünf',
    '@ADetails(1;SingleChoice)',
  ].join('\n');
  const declarations = parseEvaluationDeclarations(markdown);
  assert.deepEqual(declarations['#2'].tl, [{
    be: 1,
    tg: ['SingleChoice'],
    table: 'quiz',
  }]);
});

test('keeps the documented Geography, Astronomy, OCR and Coordinates details aligned', async () => {
  const { buildEvaluationStats, parseEvaluationDeclarations } = await evaluationPromise;
  const markdown = [
    '# Course',
    '## Text tasks',
    'Capital: [[Berlin]]',
    '@ADetails(1;Geography)',
    'Planet: [[Jupiter]]',
    '@ADetails(1;Astronomy)',
    '## OCR',
    '2 + 1 = [[ 3 ]] @canvas',
    '@ADetails(1=BE;OCR)',
    '## Coordinates',
    '@CreatePoint(`A1;A;1;4`,`<!-- -->`)',
    '@ADetails(1;Coordinates)',
  ].join('\n');
  const declarations = parseEvaluationDeclarations(markdown);

  assert.deepEqual(declarations['#2'].tl.map(task => task.tg[0]), [
    'Geography',
    'Astronomy',
  ]);
  assert.deepEqual(declarations['#3'].tl[0], {
    be: 1,
    tg: ['OCR'],
    table: 'quiz',
  });
  assert.deepEqual(declarations['#4'].tl[0], {
    be: 1,
    tg: ['Coordinates'],
    table: 'quiz',
  });

  const payload = {
    v: 2,
    sh: '#4',
    s: [
      { h: '#1' },
      { h: '#2', quiz: { 1: [
        { solved: 1, trial: 1 },
        { solved: 1, trial: 1 },
      ] } },
      { h: '#3', quiz: { 2: [{ solved: 1, trial: 1 }] } },
      { h: '#4', quizEval: { 3: [{ solved: 1, trial: 1 }] } },
    ],
  };
  assert.deepEqual(buildEvaluationStats(payload, declarations), {
    total: 4,
    correct: 4,
    wrong: 0,
    resolved: 0,
    notMade: 0,
  });
});

test('scores all five solution-based quiz types while preserving FreeText as a survey', async () => {
  const { buildEvaluationStats, parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(readFileSync(fixturePath, 'utf8'));
  const payload = buildPayload(
    {
      1: [{ solved: 1, trial: 1 }],
      2: [{ solved: 1, trial: 1 }],
      3: [{ solved: 1, trial: 1 }],
      5: [{ solved: 1, trial: 1 }],
      6: [{ solved: 1, trial: 1 }],
    },
    { 4: ['Ein Freeze-Link enthält den gespeicherten Zustand.'] },
  );

  assert.deepEqual(buildEvaluationStats(payload, declarations), {
    total: 8,
    correct: 8,
    wrong: 0,
    resolved: 0,
    notMade: 0,
  });
});

test('keeps wrong, resolved and untouched ADetails points separated', async () => {
  const { buildEvaluationStats, parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(readFileSync(fixturePath, 'utf8'));
  const payload = buildPayload({
    1: [{ solved: 1, trial: 1 }],
    2: [{ solved: 0, trial: 1 }],
    3: [{ solved: -1, trial: 1 }],
    5: [{ solved: 0, trial: 0 }],
    6: [{ solved: 1, trial: 1 }],
  });

  assert.deepEqual(buildEvaluationStats(payload, declarations), {
    total: 8,
    correct: 2,
    wrong: 2,
    resolved: 1,
    notMade: 3,
  });
});

test('scores evaluation-only fallback elements without requiring native quiz state', async () => {
  const { buildEvaluationStats, parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(readFileSync(fixturePath, 'utf8'));
  const payload = buildFallbackPayload({
    1: [{ solved: 1, trial: 1 }],
    2: [{ solved: 0, trial: 1 }],
    3: [{ solved: -1, trial: 1 }],
    5: [{ solved: 0, trial: 0 }],
    6: [{ solved: 1, trial: 1 }],
  });

  assert.deepEqual(buildEvaluationStats(payload, declarations), {
    total: 8,
    correct: 2,
    wrong: 2,
    resolved: 1,
    notMade: 3,
  });
});

test('keeps quiz-to-ADetails mapping stable around FreeText on the same slide', async () => {
  const { buildEvaluationStats, parseEvaluationDeclarations } = await evaluationPromise;
  const markdown = [
    '# Kurs',
    '## Gemischt',
    '[[Berlin]]',
    '@ADetails(1;Eingabequiz)',
    '    [[___ ___]]',
    '@ADetails(2;FreeText)',
    '[( )] drei',
    '[(X)] vier',
    '@ADetails(3;SingleChoice)',
  ].join('\n');
  const declarations = parseEvaluationDeclarations(markdown);
  const payload = {
    v: 'test',
    sh: '#2',
    s: [
      { h: '#1' },
      {
        h: '#2',
        quizEval: {
          1: [
            { solved: 1, trial: 1 },
            { solved: 1, trial: 1 },
          ],
        },
      },
    ],
  };

  assert.deepEqual(declarations['#2'].tl.map(task => task.table), [
    'quiz',
    'survey',
    'quiz',
  ]);
  assert.deepEqual(buildEvaluationStats(payload, declarations), {
    total: 6,
    correct: 4,
    wrong: 0,
    resolved: 0,
    notMade: 2,
  });
});

test('recognizes the short indented FreeText survey form', async () => {
  const { parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations([
    '# Kurs',
    '## Kurze Umfrage',
    '    [[___]]',
    '@ADetails(0;FreeText)',
  ].join('\n'));

  assert.deepEqual(declarations['#2'].tl, [{
    be: 0,
    tg: ['FreeText'],
    table: 'survey',
  }]);
});

test('counts every public kachel form once and preserves ADetails weights', async () => {
  const { parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(readFileSync(kachelFixturePath, 'utf8'));
  const expected = [
    ['#2', 1, 'KachelNative'],
    ['#3', 1, 'KachelAuswahl'],
    ['#4', 2, 'KachelInline'],
    ['#5', 2, 'Kachelfolge'],
    ['#6', 2, 'KachelfolgeN'],
  ];

  for (const [hash, points, tag] of expected) {
    assert.equal(declarations[hash].tt, 1, hash + ' task count');
    assert.equal(declarations[hash].tb, points, hash + ' points');
    assert.deepEqual(declarations[hash].tl, [{
      be: points,
      tg: [tag],
      table: 'quiz',
    }]);
  }
});

test('counts all public Orthography forms on main and Proposals', async () => {
  const { parseEvaluationDeclarations } = await evaluationPromise;
  const expected = [
    ['#2', 2, 'Orthography'],
    ['#3', 3, 'OrthographyText'],
    ['#4', 1, 'Diktat'],
  ];

  for (const fixture of orthographyFixturePaths) {
    const declarations = parseEvaluationDeclarations(readFileSync(fixture, 'utf8'));
    for (const [hash, points, tag] of expected) {
      assert.equal(declarations[hash].tt, 1, fixture + ' ' + hash + ' task count');
      assert.equal(declarations[hash].tb, points, fixture + ' ' + hash + ' points');
      assert.deepEqual(declarations[hash].tl, [{
        be: points,
        tg: [tag],
        table: 'quiz',
      }]);
    }
  }
});

test('scores Orthography resolved, OrthographyText correct and Diktat wrong by ADetails', async () => {
  const { buildEvaluationStats, parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(
    readFileSync(orthographyFixturePaths[0], 'utf8')
  );
  const payload = buildPayload({
    1: [{ solved: -1, trial: 2 }],
    2: [{ solved: 1, trial: 1 }],
    3: [{ solved: 0, trial: 1 }],
  });

  assert.deepEqual(buildEvaluationStats(payload, declarations), {
    total: 6,
    correct: 3,
    wrong: 1,
    resolved: 2,
    notMade: 0,
  });
});

test('lets a DOM tile outcome override only its native quiz index', async () => {
  const { buildEvaluationStats, parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations([
    '# Kurs',
    '## Gemischt',
    '[[Berlin]]',
    '@ADetails(1;Text)',
    '@Kachelfolge(`[->[(A)]][->[(B)]]`)',
    '@ADetails(2;Kachel)',
  ].join('\n'));
  const payload = {
    v: 'test',
    sh: '#2',
    s: [
      { h: '#1' },
      {
        h: '#2',
        quiz: {
          1: [
            { solved: 1, trial: 1 },
            { solved: 0, trial: 0 },
          ],
        },
        quizEval: {
          1: [
            null,
            { solved: 1, trial: 1 },
          ],
        },
      },
    ],
  };

  assert.deepEqual(buildEvaluationStats(payload, declarations), {
    total: 3,
    correct: 3,
    wrong: 0,
    resolved: 0,
    notMade: 0,
  });
});

test('counts every public lia-Mathe fraction macro and preserves ADetails', async () => {
  const { parseEvaluationDeclarations } = await evaluationPromise;
  const expected = [
    ['#2', 1, 'CircleQuiz'],
    ['#3', 2, 'CircleQuizC'],
    ['#4', 3, 'RectQuiz'],
    ['#5', 4, 'RectQuizC'],
  ];

  for (const fixture of matheFractionFixturePaths) {
    const declarations = parseEvaluationDeclarations(readFileSync(fixture, 'utf8'));
    for (const [hash, points, tag] of expected) {
      assert.equal(declarations[hash].tt, 1, fixture + ' ' + hash + ' task count');
      assert.equal(declarations[hash].tb, points, fixture + ' ' + hash + ' points');
      assert.deepEqual(declarations[hash].tl, [{
        be: points,
        tg: [tag],
        table: 'quiz',
      }]);
    }
  }
});

test('counts Proposals liaQuiz/C including multiple formula inputs in order', async () => {
  const { parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(
    readFileSync(matheProposalsFixturePath, 'utf8')
  );

  [
    ['#2', 1, 'CircleQuiz'],
    ['#3', 2, 'CircleQuizC'],
    ['#4', 3, 'RectQuiz'],
    ['#5', 4, 'RectQuizC'],
  ].forEach(([hash, points, tag]) => {
    assert.deepEqual(declarations[hash].tl, [{
      be: points,
      tg: [tag],
      table: 'quiz',
    }]);
  });
  assert.deepEqual(declarations['#6'].tl, [{
    be: 5,
    tg: ['LiaQuiz'],
    table: 'quiz',
  }]);
  assert.deepEqual(declarations['#7'].tl, [{
    be: 6,
    tg: ['LiaQuizC'],
    table: 'quiz',
  }]);
  assert.deepEqual(declarations['#8'].tl, [
    { be: 7, tg: ['LiaQuizMehrfachA'], table: 'quiz' },
    { be: 8, tg: ['LiaQuizMehrfachB'], table: 'quiz' },
  ]);
});

test('scores all lia-Mathe macro families by their ADetails weights', async () => {
  const { buildEvaluationStats, parseEvaluationDeclarations } = await evaluationPromise;
  const fractionDeclarations = parseEvaluationDeclarations(
    readFileSync(matheFractionFixturePaths[0], 'utf8')
  );
  assert.deepEqual(buildEvaluationStats(buildPayload({
    1: [{ solved: 1, trial: 1 }],
    2: [{ solved: 0, trial: 1 }],
    3: [{ solved: -1, trial: 2 }],
    4: [{ solved: 0, trial: 0 }],
  }), fractionDeclarations), {
    total: 10,
    correct: 1,
    wrong: 2,
    resolved: 3,
    notMade: 4,
  });

  const proposalDeclarations = parseEvaluationDeclarations(
    readFileSync(matheProposalsFixturePath, 'utf8')
  );
  assert.deepEqual(buildEvaluationStats(buildPayload({
    1: [{ solved: 1, trial: 1 }],
    2: [{ solved: 0, trial: 1 }],
    3: [{ solved: -1, trial: 2 }],
    4: [{ solved: 0, trial: 0 }],
    5: [{ solved: 0, trial: 1 }],
    6: [{ solved: 0, trial: 0 }],
    7: [
      { solved: 1, trial: 1 },
      { solved: -1, trial: 2 },
    ],
  }), proposalDeclarations), {
    total: 36,
    correct: 8,
    wrong: 7,
    resolved: 11,
    notMade: 10,
  });
});

test('counts all 18 public lia-coordinate Proposal quiz names exactly once in authored order', async () => {
  const { parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(buildCoordinateCourse());

  assert.equal(declarations['#1'].tt, 18);
  assert.equal(declarations['#1'].tb, 171);
  assert.deepEqual(declarations['#1'].tl, coordinateQuizNames.map((_, index) => ({
    be: index + 1,
    tg: ['Coord-' + (index + 1)],
    table: 'quiz',
  })));
});

test('keeps all four combined geometry quiz aliases aligned with their ADetails', async () => {
  const { parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(
    readFileSync(coordinateCombinedFixturePath, 'utf8')
  );

  assert.deepEqual(declarations['#2'].tl, [
    { be: 1, tg: ['KoordQuiz'], table: 'quiz' },
    { be: 2, tg: ['GeometrieQuiz'], table: 'quiz' },
    { be: 4, tg: ['CoordinateQuiz'], table: 'quiz' },
    { be: 8, tg: ['GeometryQuiz'], table: 'quiz' },
  ]);
});

test('README contains every DGS quiz family once and twice as flex children', async () => {
  const { parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(readFileSync(readmePath, 'utf8'));

  const standalone = [
    ['#23', 'DGS-Area'],
    ['#24', 'DGS-Perimeter'],
    ['#25', 'DGS-Construction'],
    ['#26', 'DGS-Combined'],
  ];
  for (const [hash, tag] of standalone) {
    assert.deepEqual(declarations[hash].tl, [{
      be: 1,
      tg: [tag],
      table: 'quiz',
    }]);
  }

  assert.equal(declarations['#27'].tt, 34);
  assert.equal(declarations['#27'].tb, 32);
  assert.deepEqual(
    declarations['#27'].tl.slice(-8).map(task => task.tg[0]),
    [
      'Flex-DGS-Area-A',
      'Flex-DGS-Area-B',
      'Flex-DGS-Perimeter-A',
      'Flex-DGS-Perimeter-B',
      'Flex-DGS-Construction-A',
      'Flex-DGS-Construction-B',
      'Flex-DGS-Combined-A',
      'Flex-DGS-Combined-B',
    ]
  );
});

test('scores the four combined geometry aliases without ADetails index drift', async () => {
  const { buildEvaluationStats, parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(
    readFileSync(coordinateCombinedFixturePath, 'utf8')
  );
  const payload = buildPayload({
    1: [
      { solved: 1, trial: 1 },
      { solved: 0, trial: 1 },
      { solved: -1, trial: 1 },
      { solved: 0, trial: 0 },
    ],
  });

  assert.deepEqual(buildEvaluationStats(payload, declarations), {
    total: 15,
    correct: 1,
    wrong: 2,
    resolved: 4,
    notMade: 8,
  });
});

test('does not count public lia-coordinate non-quiz macros or quiz-name prefixes', async () => {
  const { parseEvaluationDeclarations } = await evaluationPromise;
  const nonQuizNames = [
    'CoordinateSystem', 'Koordinatensystem', 'AxisLabel', 'AchsenBeschriftung',
    'Point', 'Punkt', 'CoordText', 'KoordText', 'Strecke', 'distance',
    'Line', 'Gerade', 'Ray', 'Strahl', 'Vector', 'Vektor', 'Arc', 'Bogen',
    'Perpendicular', 'Orthogonale', 'Parallel', 'Parallele',
    'Midpoint', 'Mittelpunkt', 'Area', 'Flaeche', 'angle', 'Winkel',
    'Circle', 'Kreis', 'Tangent', 'Tangente', 'CircularSector', 'Sector',
    'CircleSegment', 'CircularSegment', 'Kreissektor', 'Kreissegment',
    'PlotFunction', 'PlotFunktion', 'Zeros', 'Nullstellen', 'Extrema',
    'Extrempunkte', 'InflectionPoints', 'Wendepunkte', 'OrdinateIntercept',
    'Ordinatenabschnitt', 'Ordinatenachsenabschnitt', 'Intersection',
    'Schnittpunkt', 'Slider', 'Regler', 'Schieberegler', 'PlotInput',
    'PlotEingabeLatex', 'Schar', 'Table', 'Tabelle', 'DGS', 'Compass',
    'Zirkel', 'SetSquare', 'Geodreieck', 'Regression', 'Regession',
    'PlotZeichnen', 'CreatePointPreview', 'PointOnGraphPreview',
    'ConstructionQuizHelper', 'KoordQuizHelper', 'GeometryQuizHelper',
  ];
  const markdown = [
    '# Coordinate helpers',
    ...nonQuizNames.map(name => '@' + name + '(`spec`)'),
    '[[answer]]',
    '@ADetails(2;Native)',
  ].join('\n');
  const declarations = parseEvaluationDeclarations(markdown);

  assert.deepEqual(declarations['#1'].tl, [{
    be: 2,
    tg: ['Native'],
    table: 'quiz',
  }]);
});

test('scores lia-coordinate Proposal aliases by ADetails weights without index drift', async () => {
  const { buildEvaluationStats, parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(buildCoordinateCourse());
  const elements = coordinateQuizNames.map((_, index) => {
    if (index % 4 === 0) return { solved: 1, trial: 1 };
    if (index % 4 === 1) return { solved: 0, trial: 1 };
    if (index % 4 === 2) return { solved: -1, trial: 1 };
    return { solved: 0, trial: 0 };
  });

  assert.deepEqual(buildEvaluationStats(buildPayload({ 0: elements }), declarations), {
    total: 171,
    correct: 45,
    wrong: 50,
    resolved: 36,
    notMade: 40,
  });
});

test('counts one quiz per TextmarkerQuiz and never counts mark or marked targets', async () => {
  const { parseEvaluationDeclarations } = await evaluationPromise;
  const expected = [
    ['#2', 2, 'MarkerFarben'],
    ['#3', 3, 'MarkerAny'],
    ['#4', 1, 'MarkerPrefill'],
  ];

  for (const fixture of markerFixturePaths) {
    const declarations = parseEvaluationDeclarations(readFileSync(fixture, 'utf8'));
    for (const [hash, points, tag] of expected) {
      assert.deepEqual(declarations[hash].tl, [{
        be: points,
        tg: [tag],
        table: 'quiz',
      }], fixture + ' ' + hash);
    }
  }
});

test('scores marker correct, wrong and resolved outcomes by their ADetails weights', async () => {
  const { buildEvaluationStats, parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(
    readFileSync(markerFixturePaths[0], 'utf8')
  );
  const payload = buildFallbackPayload({
    1: [{ solved: 1, score: 1, trial: 1 }],
    2: [{ solved: 0, score: 0, trial: 1 }],
    3: [{ solved: -1, score: 0, trial: 1 }],
  });

  assert.deepEqual(buildEvaluationStats(payload, declarations), {
    total: 6,
    correct: 2,
    wrong: 3,
    resolved: 1,
    notMade: 0,
  });
});

test('keeps all flex-child quizzes on one slide in authored ADetails order', async () => {
  const { parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(readFileSync(flexFixturePath, 'utf8'));

  assert.equal(declarations['#2'].tt, 6);
  assert.equal(declarations['#2'].tb, 21);
  assert.deepEqual(declarations['#2'].tl, [
    { be: 1, tg: ['Flex-Eingabe'], table: 'quiz' },
    { be: 6, tg: ['Flex-Auswahl'], table: 'quiz' },
    { be: 2, tg: ['Flex-Mehrfach'], table: 'quiz' },
    { be: 4, tg: ['Flex-Freitext'], table: 'survey' },
    { be: 3, tg: ['Flex-Einfach'], table: 'quiz' },
    { be: 5, tg: ['Flex-Matrix'], table: 'quiz' },
  ]);
});

test('counts corrected answers and teacher ADetails overrides on a mixed flex slide', async () => {
  const {
    buildEvaluationStats,
    buildEvaluationStatsByTag,
    makeManualAwardKey,
    parseEvaluationDeclarations,
  } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations(readFileSync(flexFixturePath, 'utf8'));
  const payload = buildPayload({
    1: [
      { solved: 1, score: 1, trial: 2 },
      { solved: 0, score: 0, trial: 1 },
      { solved: -1, score: 0, trial: 1 },
      { solved: 0, score: 0, trial: 0 },
      { solved: 1, score: 1, trial: 1 },
    ],
  }, {
    1: ['Eine begründete Freitextantwort.'],
  });

  assert.deepEqual(buildEvaluationStats(payload, declarations), {
    total: 21,
    correct: 6,
    wrong: 6,
    resolved: 2,
    notMade: 7,
  });

  const manualAwards = {
    [makeManualAwardKey('#2', 2)]: '2,5',
    [makeManualAwardKey('#2', 4)]: '3',
  };
  assert.deepEqual(buildEvaluationStats(payload, declarations, manualAwards), {
    total: 21,
    correct: 11.5,
    wrong: 4.5,
    resolved: 2,
    notMade: 3,
  });

  const tags = Object.fromEntries(
    buildEvaluationStatsByTag(payload, declarations, manualAwards)
      .map(entry => [entry.tag, entry])
  );
  assert.deepEqual(tags['Flex-Freitext'], {
    tag: 'Flex-Freitext',
    total: 4,
    tasks: 1,
    correct: 3,
    wrong: 1,
    resolved: 0,
  });
});

test('clamps manual awards, ignores surplus native quizzes and keeps zero-BE courses at zero', async () => {
  const {
    buildEvaluationStats,
    buildEvaluationStatsByTag,
    makeManualAwardKey,
    parseEvaluationDeclarations,
  } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations([
    '# Nullpunkte',
    '[[ja]]',
    '@ADetails(0;Zero)',
  ].join('\n'));
  const payload = buildPayload({
    0: [
      { solved: 1, trial: 1 },
      { solved: 1, trial: 1 },
    ],
  });

  assert.deepEqual(buildEvaluationStats(payload, declarations, {
    [makeManualAwardKey('#1', 1)]: '99',
  }), {
    total: 0,
    correct: 0,
    wrong: 0,
    resolved: 0,
    notMade: 0,
  });
  assert.deepEqual(buildEvaluationStatsByTag(payload, declarations), [{
    tag: 'Zero',
    total: 0,
    tasks: 1,
    correct: 0,
    wrong: 0,
    resolved: 0,
  }]);
});

test('declares H1 through H6 as printable LiaScript slides', async () => {
  const { parseDeclaredSlides } = await evaluationPromise;
  const markdown = [
    '# H1',
    '## H2',
    '``` markdown',
    '### ignored fenced H3',
    '```',
    '### H3',
    '#### H4',
    '##### H5',
    '###### H6',
    '@Auswertung',
  ].join('\n');

  assert.deepEqual(parseDeclaredSlides(markdown), [
    { h: '#1', t: 'H1' },
    { h: '#2', t: 'H2' },
    { h: '#3', t: 'H3' },
    { h: '#4', t: 'H4' },
    { h: '#5', t: 'H5' },
    { h: '#6', t: 'H6' },
    { h: '#7', t: 'Evaluation', vt: 'evaluation' },
  ]);
});
test('freezes ADetails declarations through the compressed submission-token roundtrip', async () => {
  const {
    buildEvaluationStats,
    buildFrozenEvaluationMetadata,
    parseAbgabeHash,
    parseDeclaredSlides,
    parseEvaluationDeclarations,
    parseEvaluationOptions,
    parseSectionCount,
    readFrozenEvaluationMetadata,
  } = await evaluationPromise;
  const { decodeToken, encodeToken } = await codecPromise;
  const markdown = readFileSync(flexFixturePath, 'utf8');
  const declarations = parseEvaluationDeclarations(markdown);
  const payload = buildPayload({
    1: [
      { solved: 1, trial: 2 },
      { solved: 0, trial: 1 },
      { solved: -1, trial: 1 },
      { solved: 0, trial: 0 },
      { solved: 1, trial: 1 },
    ],
  });
  payload.ev = buildFrozenEvaluationMetadata(
    declarations,
    parseDeclaredSlides(markdown),
    parseAbgabeHash(markdown),
    parseEvaluationOptions(markdown),
    parseSectionCount(markdown),
  );
  payload.sec = {
    trackF12: 0,
    trackTab: 1,
    f12: 0,
    tab: 1,
    fs: {
      v: 1,
      r: 1,
      x: 1,
      a: 1,
      e: [
        ['x', 1200, 'exit'],
        ['a', 2500, 'lia-mathpath-explain'],
      ],
    },
  };
  payload.sendChecks = {
    version: 1,
    items: [
      { hash: '#2', taskIndex: 0, count: 2 },
      { hash: '#2', taskIndex: 1, count: 1 },
    ],
  };

  const encoded = await encodeToken(payload);
  const decoded = await decodeToken(encoded.token);
  const frozen = readFrozenEvaluationMetadata(decoded.ev);
  assert.ok(frozen);
  assert.equal(frozen.abgabeHash, '#3');
  assert.equal(frozen.sectionCount, 3);
  assert.equal(frozen.declarations['#2'].tb, 21);
  assert.deepEqual(decoded.sec, payload.sec);
  assert.deepEqual(decoded.sendChecks, payload.sendChecks);
  assert.deepEqual(buildEvaluationStats(decoded, frozen.declarations), {
    total: 21,
    correct: 6,
    wrong: 6,
    resolved: 2,
    notMade: 7,
  });

  const changed = parseEvaluationDeclarations([
    '# Geänderter Kurs',
    '[[ja]]',
    '@ADetails(100;SpäterGeändert)',
  ].join('\n'));
  assert.equal(changed['#1'].tb, 100);
  assert.equal(frozen.declarations['#2'].tb, 21);
});

test('rejects malformed frozen evaluation metadata transactionally', async () => {
  const { readFrozenEvaluationMetadata } = await evaluationPromise;
  assert.equal(readFrozenEvaluationMetadata({
    v: 1,
    declarations: {
      '#2': {
        tl: [{ be: -1, tg: ['bad'], table: 'quiz' }],
      },
    },
    slides: [{ h: '#2', t: 'Bad' }],
    options: {},
    sectionCount: 2,
  }), null);
});

test('renders combined DevTools evidence as a technical indicator, never as proof', async () => {
  const { renderEvaluationSlide } = await evaluationPromise;
  const html = renderEvaluationSlide({
    payload: {
      v: 2,
      sh: '#1',
      s: [{ h: '#1' }],
      sec: {
        trackF12: 1,
        trackTab: 0,
        f12: 1,
        tab: 0,
        dt: {
          v: 1,
          b: 'chromium',
          k: 1,
          g: 1,
          c: 1,
          e: [['c', 1250, 'C-S-I+dock-x']],
        },
      },
    },
    evalDecl: {},
  });

  assert.match(html, /DevTools-related browser signals detected/);
  assert.match(html, /1 signal incident\./);
  assert.match(html, /Trusted shortcut candidates: 1/);
  assert.match(html, /stable viewport anomalies: 1/);
  assert.match(html, /combined signals: 1/);
  assert.match(html, /Chromium \(Chrome, Edge or Brave\)/);
  assert.match(html, /not proof that DevTools were opened/);
  assert.doesNotMatch(html, /Fraud attempt detected: DevTools/);
  assert.doesNotMatch(html, /DevTools \(F12\) were opened/);
});

test('shows geometry-only evidence even though the legacy F12 counter stays zero', async () => {
  const { renderEvaluationSlide } = await evaluationPromise;
  const html = renderEvaluationSlide({
    payload: {
      v: 2,
      sh: '#1',
      s: [{ h: '#1' }],
      sec: {
        trackF12: 1,
        trackTab: 0,
        f12: 0,
        tab: 0,
        dt: {
          v: 1,
          b: 'safari',
          k: 0,
          g: 1,
          c: 0,
          e: [['g', 2200, 'dock-y']],
        },
      },
    },
    evalDecl: {},
  });

  assert.match(html, /1 signal incident\./);
  assert.match(html, /Trusted shortcut candidates: 0/);
  assert.match(html, /stable viewport anomalies: 1/);
  assert.match(html, /Browser family: Safari/);
  assert.match(html, /technical indicators, not proof/);
});

test('uses validated versioned evidence instead of a contradictory legacy count', async () => {
  const { renderEvaluationSlide } = await evaluationPromise;
  const html = renderEvaluationSlide({
    payload: {
      v: 2,
      sh: '#1',
      s: [{ h: '#1' }],
      sec: {
        trackF12: 1,
        trackTab: 0,
        f12: 999,
        tab: 0,
        dt: {
          v: 1,
          b: 'firefox',
          k: 1,
          g: 0,
          c: 0,
          e: [['k', 50, 'C-S-K']],
        },
      },
    },
    evalDecl: {},
  });

  assert.match(html, /1 signal incident\./);
  assert.match(html, /Browser family: Firefox/);
  assert.doesNotMatch(html, /999/);
  assert.doesNotMatch(html, /Legacy F12/);
});

test('keeps old links readable with an explicitly unverified legacy warning', async () => {
  const { renderEvaluationSlide } = await evaluationPromise;
  const html = renderEvaluationSlide({
    payload: {
      v: 2,
      sh: '#1',
      s: [{ h: '#1' }],
      sec: { trackF12: 1, trackTab: 0, f12: 2, tab: 0 },
    },
    evalDecl: {},
  });

  assert.match(html, /Legacy F12\/DevTools signal detected \(2\)/);
  assert.match(html, /unverified indicator, not proof/);
  assert.doesNotMatch(html, /Fraud attempt detected: DevTools/);
});

test('rejects malformed DevTools evidence and never renders attacker-controlled details', async () => {
  const { renderEvaluationSlide } = await evaluationPromise;
  const malformed = {
    v: 1,
    b: 'chromium',
    k: 0,
    g: 0,
    c: 1,
    e: [['x', 1, '<img src=x onerror=alert(1)>']],
  };
  const fallback = renderEvaluationSlide({
    payload: {
      v: 2,
      sh: '#1',
      s: [{ h: '#1' }],
      sec: { trackF12: 1, trackTab: 0, f12: 1, tab: 0, dt: malformed },
    },
    evalDecl: {},
  });
  assert.match(fallback, /Legacy F12\/DevTools signal detected \(1\)/);
  assert.doesNotMatch(fallback, /img src|onerror|alert\(1\)/);

  const hidden = renderEvaluationSlide({
    payload: {
      v: 2,
      sh: '#1',
      s: [{ h: '#1' }],
      sec: { trackF12: 0, trackTab: 0, f12: 1, tab: 0, dt: malformed },
    },
    evalDecl: {},
  });
  assert.doesNotMatch(hidden, /DevTools-related|Legacy F12|img src|onerror/);
});

test('security evidence never changes ADetails scoring', async () => {
  const { buildEvaluationStats, parseEvaluationDeclarations } = await evaluationPromise;
  const declarations = parseEvaluationDeclarations([
    '# Aufgabe',
    '[[Berlin]]',
    '@ADetails(3;Ort)',
  ].join('\n'));
  const payload = buildPayload({ 0: [{ solved: 1, trial: 1 }] });
  const expected = buildEvaluationStats(payload, declarations);
  payload.sec = {
    trackF12: 1,
    trackTab: 0,
    f12: 1,
    tab: 0,
    dt: {
      v: 1,
      b: 'chromium',
      k: 1,
      g: 1,
      c: 1,
      e: [['c', 1000, 'C-S-I+dock-x']],
    },
    fs: {
      v: 1,
      r: 1,
      x: 1,
      a: 1,
      e: [
        ['x', 1200, 'exit'],
        ['a', 2400, 'lia-mathpath-explain'],
      ],
    },
  };
  assert.deepEqual(buildEvaluationStats(payload, declarations), expected);
});

test('renders confirmed fullscreen exits separately and never labels Explain as fraud', async () => {
  const { renderEvaluationSlide } = await evaluationPromise;
  const html = renderEvaluationSlide({
    payload: {
      v: 2,
      sh: '#1',
      s: [{ h: '#1' }],
      sec: {
        trackF12: 0,
        trackTab: 0,
        f12: 0,
        tab: 0,
        fs: {
          v: 1,
          r: 1,
          x: 1,
          a: 1,
          e: [
            ['x', 1500, 'exit'],
            ['a', 2300, 'lia-mathpath-explain'],
          ],
        },
      },
    },
    evalDecl: {},
  });

  assert.match(html, /Fullscreen mode was left once during the exam/);
  assert.match(html, /1 intended lia-mathpath @Explain transition was excluded/);
  assert.match(html, /is not treated as a violation/);
  assert.match(html, /does not change quiz points/);
  assert.doesNotMatch(html, /Fraud attempt detected:.*Explain/);
});

test('shows an allowed Explain transition and request failures neutrally', async () => {
  const { renderEvaluationSlide } = await evaluationPromise;
  const allowed = renderEvaluationSlide({
    payload: {
      v: 2,
      sh: '#1',
      s: [{ h: '#1' }],
      sec: {
        trackF12: 0,
        trackTab: 0,
        f12: 0,
        tab: 0,
        fs: {
          v: 1,
          r: 1,
          x: 0,
          a: 1,
          e: [['a', 2000, 'lia-mathpath-explain']],
        },
      },
    },
    evalDecl: {},
  });
  assert.match(allowed, /Intended @Explain transition excluded/);
  assert.match(allowed, /is not treated as a violation/);

  const denied = renderEvaluationSlide({
    payload: {
      v: 2,
      sh: '#1',
      s: [{ h: '#1' }],
      sec: {
        trackF12: 0,
        trackTab: 0,
        f12: 0,
        tab: 0,
        fs: { v: 1, r: 3, x: 0, a: 0, e: [] },
      },
    },
    evalDecl: {},
  });
  assert.match(denied, /Fullscreen request was not completed/);
  assert.match(denied, /No fullscreen exit is inferred/);
  assert.doesNotMatch(denied, /Fraud attempt/);

  const pending = renderEvaluationSlide({
    payload: {
      v: 2,
      sh: '#1',
      s: [{ h: '#1' }],
      sec: {
        trackF12: 0,
        trackTab: 0,
        f12: 0,
        tab: 0,
        fs: { v: 1, r: 4, x: 0, a: 0, e: [] },
      },
    },
    evalDecl: {},
  });
  assert.match(pending, /Fullscreen request was still pending/);
  assert.match(pending, /No fullscreen exit is inferred/);
});

test('renders tab data as a technical signal rather than a misconduct verdict', async () => {
  const { renderEvaluationSlide } = await evaluationPromise;
  const html = renderEvaluationSlide({
    payload: {
      v: 2,
      sh: '#1',
      s: [{ h: '#1' }],
      sec: { trackF12: 0, trackTab: 1, f12: 0, tab: 2 },
    },
    evalDecl: {},
  });
  assert.match(html, /Tab\/window focus or visibility signals detected/);
  assert.match(html, /2 signals were recorded/);
  assert.match(html, /technical indicators, not proof of misconduct/);
  assert.match(html, /Confirmed lia-mathpath @Explain transitions are excluded/);
  assert.doesNotMatch(html, /Fraud attempt/);
});

test('rejects malformed fullscreen evidence without rendering attacker data', async () => {
  const { renderEvaluationSlide } = await evaluationPromise;
  const html = renderEvaluationSlide({
    payload: {
      v: 2,
      sh: '#1',
      s: [{ h: '#1' }],
      sec: {
        trackF12: 0,
        trackTab: 0,
        f12: 0,
        tab: 0,
        fs: {
          v: 1,
          r: 1,
          x: 1,
          a: 0,
          e: [['x', 1, '<img src=x onerror=alert(1)>']],
        },
      },
    },
    evalDecl: {},
  });
  assert.doesNotMatch(html, /Fullscreen mode|img src|onerror|alert\(1\)/);
});

test('renders the complete evaluation surface in German when requested', async () => {
  const { renderEvaluationSlide } = await evaluationPromise;
  const html = renderEvaluationSlide({
    language: 'de-DE',
    title: 'Evaluation',
    name: 'Ada',
    slides: [{ h: '#1', t: 'Aufgabe' }],
    payload: {
      v: 2,
      sh: '#1',
      s: [{ h: '#1', quiz: { 0: [{ solved: 1 }] } }],
      slideTimeMs: { '#1': 65_000 },
      sendChecks: {
        version: 1,
        items: [{ hash: '#1', taskIndex: 0, count: 2 }],
      },
      sec: {
        trackF12: 1,
        trackTab: 1,
        f12: 1,
        tab: 1,
        dt: {
          v: 1,
          b: 'chromium',
          k: 1,
          g: 1,
          c: 1,
          e: [['c', 10, 'C-S-I']],
        },
        fs: {
          v: 1,
          r: 3,
          x: 0,
          a: 0,
          e: [],
        },
      },
    },
    evalDecl: {
      '#1': {
        tt: 1,
        tb: 1,
        tg: { Algebra: { total: 1, tasks: 1 } },
        tl: [{ be: 1, tg: ['Algebra'], table: 'quiz' }],
      },
    },
  });

  assert.match(html, />Auswertung</);
  assert.match(html, /Zusammenfassung der eingefrorenen Abgabe/);
  assert.match(html, />Richtig</);
  assert.match(html, />Falsch</);
  assert.match(html, />Lösung angezeigt</);
  assert.match(html, />Nicht bearbeitet</);
  assert.match(html, /Auswertung nach Tags/);
  assert.match(html, /Prüfen-Klicks pro Aufgabe/);
  assert.match(html, /Zeit pro Folie/);
  assert.match(html, /Browser-Signale mit möglichem DevTools-Bezug erkannt/);
  assert.match(html, /Signale zu Tab-\/Fensterfokus oder Sichtbarkeit erkannt/);
  assert.match(html, /Vollbildanforderung wurde nicht abgeschlossen/);
  assert.doesNotMatch(html, /Summary of the frozen submission|Time per Slide|Not done/);
});
