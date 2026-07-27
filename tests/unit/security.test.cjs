const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..', '..');
const securityPath = path.join(repoRoot, 'src', 'security.ts');
let moduleNonce = 0;

async function loadSecurityModule() {
  const source = readFileSync(securityPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ES2020,
    },
    fileName: securityPath,
  }).outputText;
  const encoded = Buffer.from(compiled, 'utf8').toString('base64');
  moduleNonce += 1;
  return import('data:text/javascript;base64,' + encoded + '#' + moduleNonce);
}

class EventHub {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener.call(this, event);
    }
  }

  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }
}

class FakeClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.timers = new Map();
  }

  setTimeout(fn, delay = 0) {
    return this.add(fn, delay, 0);
  }

  setInterval(fn, delay = 0) {
    const interval = Math.max(1, Number(delay) || 0);
    return this.add(fn, interval, interval);
  }

  add(fn, delay, interval) {
    const id = this.nextId++;
    this.timers.set(id, {
      id,
      fn,
      at: this.now + Math.max(0, Number(delay) || 0),
      interval,
    });
    return id;
  }

  clear(id) {
    this.timers.delete(id);
  }

  advance(duration) {
    const target = this.now + duration;
    let guard = 0;
    while (true) {
      let next = null;
      for (const timer of this.timers.values()) {
        if (timer.at > target) continue;
        if (!next || timer.at < next.at || (timer.at === next.at && timer.id < next.id)) {
          next = timer;
        }
      }
      if (!next) break;
      if (++guard > 100000) throw new Error('fake timer loop');
      this.now = next.at;
      if (next.interval > 0) next.at += next.interval;
      else this.timers.delete(next.id);
      next.fn();
    }
    this.now = target;
  }
}

function defineGlobal(name, value, saved) {
  saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function restoreGlobals(saved) {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}

async function withEnvironment(options, run) {
  const clock = new FakeClock();
  const document = new EventHub();
  let frozen = false;
  let focused = true;
  const bodyClasses = new Set();
  document.body = {
    classList: {
      contains: name => (name === 'lia-snapshot-mode' && frozen) || bodyClasses.has(name),
      add: name => bodyClasses.add(name),
      remove: name => bodyClasses.delete(name),
    },
  };
  document.documentElement = {};
  document.fullscreenElement = null;
  document.webkitFullscreenElement = null;
  document.fullscreenEnabled = true;
  document.visibilityState = 'visible';
  document.hasFocus = () => focused;
  document.activeElement = null;
  document.querySelector = () => null;

  const window = new EventHub();
  Object.assign(window, {
    outerWidth: options.outerWidth ?? 1400,
    outerHeight: options.outerHeight ?? 900,
    innerWidth: options.innerWidth ?? 1360,
    innerHeight: options.innerHeight ?? 860,
    devicePixelRatio: 1,
    visualViewport: { scale: 1 },
    performance: { now: () => clock.now },
    document,
    setTimeout: (fn, delay) => clock.setTimeout(fn, delay),
    setInterval: (fn, delay) => clock.setInterval(fn, delay),
    clearTimeout: id => clock.clear(id),
    clearInterval: id => clock.clear(id),
    location: { href: 'https://course.example/course.md' },
  });
  window.parent = window;
  window.top = options.iframe ? {} : window;
  document.defaultView = window;

  const navigator = {
    userAgent: options.userAgent || 'Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36',
    platform: options.platform || 'Win32',
    maxTouchPoints: options.maxTouchPoints || 0,
  };

  const saved = new Map();
  defineGlobal('window', window, saved);
  defineGlobal('document', document, saved);
  defineGlobal('navigator', navigator, saved);
  defineGlobal('performance', window.performance, saved);

  const env = {
    clock,
    document,
    window,
    setFrozen(value) { frozen = value; },
    setFocused(value) { focused = value; },
    setVisibility(value) { document.visibilityState = value; },
    setBodyClass(name, value) {
      if (value) bodyClasses.add(name);
      else bodyClasses.delete(name);
    },
    enterFullscreen(kind = 'standard', eventName) {
      if (kind === 'webkit') document.webkitFullscreenElement = document.documentElement;
      else document.fullscreenElement = document.documentElement;
      document.emit(eventName || (kind === 'webkit' ? 'webkitfullscreenchange' : 'fullscreenchange'), {});
    },
    exitFullscreen(kind = 'standard', eventName) {
      if (kind === 'webkit') document.webkitFullscreenElement = null;
      else document.fullscreenElement = null;
      document.emit(eventName || (kind === 'webkit' ? 'webkitfullscreenchange' : 'fullscreenchange'), {});
    },
    key(overrides = {}) {
      window.emit('keydown', {
        key: '',
        code: '',
        keyCode: 0,
        which: 0,
        isTrusted: true,
        repeat: false,
        isComposing: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        timeStamp: -999999,
        ...overrides,
      });
    },
    resize() {
      window.emit('resize', {});
    },
  };

  try {
    const security = await loadSecurityModule();
    await run(security, env);
  } finally {
    restoreGlobals(saved);
  }
}

const chromeWindows =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const edgeWindows = chromeWindows + ' Edg/150.0.0.0';
const firefoxWindows =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0';
const chromeMac =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const firefoxMac =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.0; rv:153.0) Gecko/20100101 Firefox/153.0';
const safariMac =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/19.0 Safari/605.1.15';

function f12() {
  return { key: 'F12', code: 'F12', keyCode: 123, which: 123 };
}

function ctrlShift(letter) {
  return {
    key: letter.toLowerCase(),
    code: 'Key' + letter.toUpperCase(),
    ctrlKey: true,
    shiftKey: true,
  };
}

function metaAlt(letter, key = letter.toLowerCase()) {
  return {
    key,
    code: 'Key' + letter.toUpperCase(),
    metaKey: true,
    altKey: true,
  };
}

function metaShift(letter) {
  return {
    key: letter.toLowerCase(),
    code: 'Key' + letter.toUpperCase(),
    metaKey: true,
    shiftKey: true,
  };
}

function installExplainDom(env, href = 'https://example.org/explain.md', options = {}) {
  let open = false;
  const quiz = {
    getAttribute(name) {
      return name === 'data-lia-explain-enabled' && options.enabled !== false ? '1' : null;
    },
  };
  const hints = {
    closest(selector) {
      if (selector !== '.lia-quiz') return null;
      return options.detached ? {} : quiz;
    },
  };
  const hintItem = { parentElement: hints };
  const frame = {
    src: href,
    getAttribute(name) { return name === 'src' ? this.src : null; },
  };
  const overlay = {
    querySelector(selector) {
      return selector === 'iframe.lia-mathpath-explain-frame' ? frame : null;
    },
  };
  const link = {
    ownerDocument: env.document,
    href,
    getAttribute(name) {
      if (name === 'href' || name === 'data-lia-explain-href') return href;
      return null;
    },
    closest(selector) {
      if (selector === 'a.lia-mathpath-explain-link[data-lia-explain-href]') return this;
      if (selector === '.lia-mathpath-explain-list') return null;
      if (selector === 'li.lia-mathpath-no-glossary') return hintItem;
      if (selector === '.lia-quiz__hints') return hints;
      if (selector === '.lia-quiz') return quiz;
      return null;
    },
  };
  env.document.querySelector = selector =>
    open && selector === '.lia-mathpath-explain-overlay[data-open="1"]' ? overlay : null;
  const setOpen = value => {
    open = value;
    env.setBodyClass('lia-mathpath-overlay-open', value);
    if (value) {
      frame.src = href;
      env.document.activeElement = frame;
    } else {
      env.document.activeElement = null;
    }
  };
  return { frame, link, setOpen };
}

test('DevTools tracking is conservative and browser-aware', async t => {
  await t.test('uses the documented Chrome, Edge, Brave, Firefox and Safari shortcut families', async () => {
    const profiles = [
      {
        name: 'Chrome Windows',
        userAgent: chromeWindows,
        platform: 'Win32',
        family: 'chromium',
        accepted: [f12(), ctrlShift('I'), ctrlShift('C'), ctrlShift('J')],
        details: ['F12', 'C-S-I', 'C-S-C', 'C-S-J'],
      },
      {
        name: 'Edge Windows',
        userAgent: edgeWindows,
        platform: 'Win32',
        family: 'chromium',
        accepted: [ctrlShift('I')],
        details: ['C-S-I'],
      },
      {
        name: 'Brave Windows',
        userAgent: chromeWindows,
        platform: 'Win32',
        family: 'chromium',
        accepted: [ctrlShift('J')],
        details: ['C-S-J'],
      },
      {
        name: 'Firefox Windows',
        userAgent: firefoxWindows,
        platform: 'Win32',
        family: 'firefox',
        accepted: [f12(), ctrlShift('I'), ctrlShift('C'), ctrlShift('J'), ctrlShift('K')],
        details: ['F12', 'C-S-I', 'C-S-C', 'C-S-J', 'C-S-K'],
      },
      {
        name: 'Chrome macOS',
        userAgent: chromeMac,
        platform: 'MacIntel',
        family: 'chromium',
        accepted: [metaAlt('I', '¡'), metaAlt('C'), metaAlt('J'), metaShift('C')],
        rejected: [f12(), metaAlt('K')],
        details: ['M-A-I', 'M-A-C', 'M-A-J', 'M-S-C'],
      },
      {
        name: 'Firefox macOS',
        userAgent: firefoxMac,
        platform: 'MacIntel',
        family: 'firefox',
        accepted: [f12(), metaAlt('I'), metaAlt('C'), metaAlt('K'), metaShift('J')],
        rejected: [metaAlt('J')],
        details: ['F12', 'M-A-I', 'M-A-C', 'M-A-K', 'M-S-J'],
      },
      {
        name: 'Safari macOS',
        userAgent: safariMac,
        platform: 'MacIntel',
        family: 'safari',
        accepted: [metaAlt('I'), metaAlt('C'), metaShift('C')],
        rejected: [f12(), metaAlt('J'), metaAlt('K')],
        details: ['M-A-I', 'M-A-C', 'M-S-C'],
      },
    ];

    for (const profile of profiles) {
      await withEnvironment(profile, async (security, env) => {
        security.installF12Tracking();
        for (const event of profile.accepted) env.key(event);
        for (const event of profile.rejected || []) env.key(event);
        const state = security.getSecurityState();
        assert.equal(state.devtools.b, profile.family, profile.name + ' family');
        assert.equal(state.devtools.k, profile.accepted.length, profile.name + ' shortcuts');
        assert.equal(state.f12, profile.accepted.length, profile.name + ' legacy count');
        assert.equal(state.devtools.g, 0, profile.name + ' geometry');
        assert.deepEqual(state.devtools.e.map(item => item[2]), profile.details, profile.name + ' details');
      });
    }
  });

  await t.test('rejects synthetic, repeated, composing, modified and duplicate events', async () => {
    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      security.installF12Tracking();
      env.key({ ...f12(), isTrusted: false });
      env.key({ ...f12(), isTrusted: undefined });
      env.key({ ...f12(), repeat: true });
      env.key({ ...f12(), isComposing: true });
      env.key({ ...ctrlShift('I'), altKey: true });
      assert.equal(security.getSecurityState().f12, 0);

      env.key({ ...ctrlShift('I'), timeStamp: Number.MAX_SAFE_INTEGER });
      env.key(ctrlShift('I'));
      assert.equal(security.getSecurityState().f12, 1);
      env.clock.advance(301);
      env.key({ ...ctrlShift('I'), timeStamp: -1 });
      const state = security.getSecurityState();
      assert.equal(state.f12, 2);
      assert.deepEqual(state.devtools.e.map(item => item[1]), [0, 301]);
    });
  });

  await t.test('calibrates an initially large browser gap without reporting it', async () => {
    await withEnvironment({
      userAgent: chromeWindows,
      outerWidth: 1400,
      outerHeight: 900,
      innerWidth: 900,
      innerHeight: 600,
    }, async (security, env) => {
      security.installF12Tracking();
      env.clock.advance(5000);
      const state = security.getSecurityState();
      assert.equal(state.f12, 0);
      assert.equal(state.devtools.g, 0);
      assert.deepEqual(state.devtools.e, []);
    });
  });

  await t.test('records only a stable one-axis anomaly and never repeats it while open', async () => {
    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      security.installF12Tracking();
      env.clock.advance(1500);
      env.window.innerWidth = 1000;
      env.resize();
      env.clock.advance(1500);
      let state = security.getSecurityState();
      assert.equal(state.devtools.g, 1);
      assert.equal(state.f12, 0);
      assert.equal(state.devtools.e[0][0], 'g');

      env.clock.advance(4000);
      assert.equal(security.getSecurityState().devtools.g, 1);

      env.window.innerWidth = 1360;
      env.resize();
      env.clock.advance(1200);
      env.window.innerWidth = 1000;
      env.resize();
      env.clock.advance(450);
      env.window.innerWidth = 1360;
      env.resize();
      env.clock.advance(2000);
      state = security.getSecurityState();
      assert.equal(state.devtools.g, 1, 'transient anomaly is ignored');
    });
  });

  await t.test('suppresses window resize, zoom, proportional resize and lifecycle noise', async () => {
    const cases = [
      {
        name: 'window resize',
        mutate(env) {
          env.window.outerWidth = 1100;
          env.window.innerWidth = 1060;
          env.resize();
        },
      },
      {
        name: 'DPR zoom',
        mutate(env) {
          env.window.devicePixelRatio = 1.25;
          env.window.innerWidth = 1000;
          env.resize();
        },
      },
      {
        name: 'proportional two-axis resize',
        mutate(env) {
          env.window.innerWidth = 1100;
          env.window.innerHeight = 690;
          env.resize();
        },
      },
      {
        name: 'zoom shortcut',
        mutate(env) {
          env.key({ key: '+', code: 'Equal', ctrlKey: true });
          env.window.innerWidth = 1000;
          env.resize();
        },
      },
      {
        name: 'pageshow',
        mutate(env) {
          env.window.emit('pageshow', {});
          env.window.innerWidth = 1000;
          env.resize();
        },
      },
    ];

    for (const entry of cases) {
      await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
        security.installF12Tracking();
        env.clock.advance(1500);
        entry.mutate(env);
        env.clock.advance(5000);
        const state = security.getSecurityState();
        assert.equal(state.devtools.g, 0, entry.name);
        assert.equal(state.f12, 0, entry.name + ' legacy');
      });
    }
  });

  await t.test('coalesces a trusted shortcut and matching dock geometry into one incident', async () => {
    await withEnvironment({ userAgent: edgeWindows }, async (security, env) => {
      security.installF12Tracking();
      env.clock.advance(1500);
      env.key(ctrlShift('I'));
      env.window.innerWidth = 1000;
      env.resize();
      env.clock.advance(1500);
      const state = security.getSecurityState();
      assert.equal(state.f12, 1);
      assert.equal(state.devtools.k, 1);
      assert.equal(state.devtools.g, 1);
      assert.equal(state.devtools.c, 1);
      assert.deepEqual(state.devtools.e, [['c', 1500, 'C-S-I+dock-x']]);
    });
  });

  await t.test('does not turn closing toggles into new opening incidents', async () => {
    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      security.installF12Tracking();
      env.clock.advance(1500);
      env.key(ctrlShift('I'));
      env.window.innerWidth = 1000;
      env.resize();
      env.clock.advance(1500);
      assert.equal(security.getSecurityState().f12, 1);

      env.key(f12());
      env.window.innerWidth = 1360;
      env.resize();
      env.clock.advance(1500);
      const state = security.getSecurityState();
      assert.equal(state.f12, 1);
      assert.equal(state.devtools.k, 1);
      assert.equal(state.devtools.g, 1);
    });
  });

  await t.test('discards a shortcut that closes a candidate viewport anomaly', async () => {
    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      security.installF12Tracking();
      env.clock.advance(1500);
      env.window.innerWidth = 1000;
      env.resize();
      env.clock.advance(350);
      env.key(f12());
      env.window.innerWidth = 1360;
      env.resize();
      env.clock.advance(2000);
      const state = security.getSecurityState();
      assert.equal(state.f12, 0);
      assert.equal(state.devtools.k, 0);
      assert.equal(state.devtools.g, 0);
    });
  });

  await t.test('gates collection, resets at exam start and ignores frozen rendering', async () => {
    let active = false;
    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      security.installF12Tracking({ isActive: () => active });
      env.key(f12());
      env.window.innerWidth = 1000;
      env.resize();
      env.clock.advance(3000);
      assert.equal(security.getSecurityState().f12, 0);
      assert.equal(security.getSecurityState().devtools.g, 0);

      active = true;
      security.resetF12Tracking();
      env.clock.advance(1500);
      env.key(f12());
      assert.equal(security.getSecurityState().f12, 1);

      env.setFrozen(true);
      env.clock.advance(301);
      env.key(f12());
      assert.equal(security.getSecurityState().f12, 1);

      env.setFrozen(false);
      security.resetF12Tracking();
      const reset = security.getSecurityState();
      assert.equal(reset.f12, 0);
      assert.deepEqual(reset.devtools, {
        v: 1,
        b: 'chromium',
        k: 0,
        g: 0,
        c: 0,
        e: [],
      });
    });
  });

  await t.test('skips geometry in mobile and iframe contexts', async () => {
    const cases = [
      {
        userAgent: safariMac.replace('Macintosh; Intel Mac OS X 15_0', 'iPhone; CPU iPhone OS 19_0 like Mac OS X'),
        platform: 'iPhone',
      },
      {
        userAgent: chromeWindows,
        platform: 'Win32',
        iframe: true,
      },
    ];
    for (const profile of cases) {
      await withEnvironment(profile, async (security, env) => {
        security.installF12Tracking();
        env.clock.advance(1500);
        env.window.innerWidth = 800;
        env.resize();
        env.clock.advance(4000);
        assert.equal(security.getSecurityState().devtools.g, 0);
      });
    }
  });

  await t.test('is idempotent, caps evidence and returns defensive copies', async () => {
    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      security.installF12Tracking();
      security.installF12Tracking();
      assert.equal(env.window.listenerCount('keydown'), 1);

      for (let index = 0; index < 30; index++) {
        if (index > 0) env.clock.advance(301);
        env.key(f12());
      }
      const state = security.getSecurityState();
      assert.equal(state.f12, 30);
      assert.equal(state.devtools.k, 30);
      assert.equal(state.devtools.e.length, 24);
      assert.ok(state.devtools.e[0][1] > 0);

      state.devtools.e[0][2] = 'poison';
      assert.notEqual(security.getSecurityState().devtools.e[0][2], 'poison');
    });
  });
});

test('Exam fullscreen and MathPath allowances are transition-based and conservative', async t => {
  await t.test('requires a canonical header import and an authored non-fenced Explain hint', async () => {
    await withEnvironment({ userAgent: chromeWindows }, async security => {
      const canonical = [
        '<!--',
        'import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/Proposal/README.md',
        '-->',
        'Question: [[answer]]',
        '[[?]] @Explain',
      ].join('\n');
      assert.equal(security.courseUsesMathpathExplain(canonical), true);
      assert.equal(
        security.courseUsesMathpathExplain(canonical.replace('/Proposal/', '/master/')),
        true,
      );
      assert.equal(
        security.courseUsesMathpathExplain(canonical.replace(
          '/Proposal/',
          '/refs/heads/Proposal/',
        )),
        true,
      );
      assert.equal(
        security.courseUsesMathpathExplain(canonical.replace(
          '/Proposal/',
          '/refs/heads/master/',
        )),
        true,
      );
      assert.equal(
        security.courseUsesMathpathExplain(canonical.replace(
          '/Proposal/',
          '/6163778668edd181c503db224e2e285bb1a08d01/',
        )),
        true,
      );
      assert.equal(
        security.courseUsesMathpathExplain(canonical.replace('/Proposal/', '/unreviewed-branch/')),
        false,
      );

      const fence = String.fromCharCode(96).repeat(3);
      const documentationOnly = [
        '<!--',
        'import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/main/README.md',
        '-->',
        fence + ' markdown',
        '[[?]] @Explain',
        fence,
      ].join('\n');
      assert.equal(security.courseUsesMathpathExplain(documentationOnly), false);
      const longFence = String.fromCharCode(96).repeat(4);
      assert.equal(security.courseUsesMathpathExplain([
        '<!--',
        'import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/master/README.md',
        '-->',
        longFence + ' markdown',
        fence + ' markdown',
        '[[?]] @Explain',
        fence,
        longFence,
      ].join('\n')), false);
      assert.equal(security.courseUsesMathpathExplain([
        '<!--',
        'import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/master/README.md',
        '-->',
        '<!-- [[?]] @Explain -->',
      ].join('\n')), false);
      assert.equal(security.courseUsesMathpathExplain([
        '<!--',
        'import: https://example.org/lia-mathpath/README.md',
        '-->',
        '[[?]] @Explain',
      ].join('\n')), false);
    });
  });

  await t.test('records only confirmed entry-to-exit transitions and deduplicates events', async () => {
    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      let requests = 0;
      env.document.documentElement.requestFullscreen = () => {
        requests += 1;
        env.enterFullscreen();
        return Promise.resolve();
      };
      security.installExamFullscreenTracking({ isActive: () => true });
      assert.equal(await security.requestExamFullscreen(), 'entered');
      assert.equal(requests, 1);
      assert.deepEqual(security.getSecurityState().fullscreen, {
        v: 1, r: 1, x: 0, a: 0, e: [],
      });

      env.exitFullscreen();
      env.document.emit('webkitfullscreenchange', {});
      assert.equal(security.getSecurityState().fullscreen.x, 1);

      env.enterFullscreen();
      env.exitFullscreen();
      const state = security.getSecurityState();
      assert.equal(state.fullscreen.x, 2);
      assert.deepEqual(state.fullscreen.e.map(item => item[0]), ['x', 'x']);

      state.fullscreen.e[0][2] = 'lia-mathpath-explain';
      assert.equal(security.getSecurityState().fullscreen.e[0][2], 'exit');
    });
  });

  await t.test('supports WebKit and treats unsupported or rejected requests as non-exits', async () => {
    await withEnvironment({ userAgent: safariMac }, async (security, env) => {
      env.document.documentElement.webkitRequestFullscreen = () => {
        env.enterFullscreen('webkit');
      };
      security.installExamFullscreenTracking({ isActive: () => true });
      await security.requestExamFullscreen();
      assert.equal(security.getSecurityState().fullscreen.r, 1);
      env.exitFullscreen('webkit');
      assert.equal(security.getSecurityState().fullscreen.x, 1);
    });

    await withEnvironment({ userAgent: safariMac }, async (security, env) => {
      env.document.documentElement.webkitRequestFullScreen = () => undefined;
      security.installExamFullscreenTracking({ isActive: () => true });
      assert.equal(await security.requestExamFullscreen(), 'pending');
      assert.equal(security.getSecurityState().fullscreen.r, 4);
      env.clock.advance(1200);
      assert.equal(security.getSecurityState().fullscreen.r, 4);
      env.enterFullscreen('webkit');
      env.clock.advance(800);
      assert.equal(security.getSecurityState().fullscreen.r, 1);
    });

    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      security.installExamFullscreenTracking({ isActive: () => true });
      assert.equal(await security.requestExamFullscreen(), 'unsupported');
      assert.deepEqual(security.getSecurityState().fullscreen, {
        v: 1, r: 2, x: 0, a: 0, e: [],
      });

      security.resetExamFullscreenTracking();
      env.document.documentElement.requestFullscreen = () => Promise.reject(new Error('denied'));
      assert.equal(await security.requestExamFullscreen(), 'denied');
      assert.deepEqual(security.getSecurityState().fullscreen, {
        v: 1, r: 3, x: 0, a: 0, e: [],
      });
      env.document.fullscreenElement = {};
      env.document.emit('fullscreenchange', {});
      env.document.fullscreenElement = null;
      env.document.emit('fullscreenchange', {});
      assert.equal(security.getSecurityState().fullscreen.x, 0);
    });

    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      env.document.documentElement.requestFullscreen = () => {
        throw new Error('sync-denied');
      };
      security.installExamFullscreenTracking({ isActive: () => true });
      assert.equal(await security.requestExamFullscreen(), 'denied');
      env.document.emit('fullscreenerror', {});
      assert.equal(security.getSecurityState().fullscreen.r, 3);
      assert.equal(security.getSecurityState().fullscreen.x, 0);
    });
  });

  await t.test('ignores exits outside the active exam and after freezing', async () => {
    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      let active = false;
      env.document.documentElement.requestFullscreen = () => {
        env.enterFullscreen();
        return Promise.resolve();
      };
      security.installExamFullscreenTracking({ isActive: () => active });
      await security.requestExamFullscreen();
      env.exitFullscreen();
      assert.equal(security.getSecurityState().fullscreen.x, 0);

      active = true;
      env.enterFullscreen();
      env.exitFullscreen();
      assert.equal(security.getSecurityState().fullscreen.x, 1);

      env.enterFullscreen();
      env.setFrozen(true);
      env.exitFullscreen();
      assert.equal(security.getSecurityState().fullscreen.x, 1);
    });
  });

  await t.test('excludes one confirmed Explain transition but not lookalikes or repeats', async () => {
    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      env.document.documentElement.requestFullscreen = () => {
        env.enterFullscreen();
        return Promise.resolve();
      };
      security.installExamFullscreenTracking({
        isActive: () => true,
        allowMathpathExplain: true,
      });
      await security.requestExamFullscreen();
      env.clock.advance(1000);
      const explain = installExplainDom(env);
      const click = {
        isTrusted: true,
        button: 0,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: explain.link,
      };

      env.document.emit('click', click);
      explain.setOpen(true);
      await Promise.resolve();
      env.exitFullscreen();
      let fs = security.getSecurityState().fullscreen;
      assert.equal(fs.x, 0);
      assert.equal(fs.a, 1);
      assert.deepEqual(fs.e[0], ['a', 1000, 'lia-mathpath-explain']);

      env.enterFullscreen();
      env.exitFullscreen();
      fs = security.getSecurityState().fullscreen;
      assert.equal(fs.x, 1);
      assert.equal(fs.a, 1);

      env.enterFullscreen();
      explain.setOpen(true);
      env.document.emit('keydown', {
        isTrusted: true,
        key: 'Escape',
        target: explain.link,
      });
      explain.setOpen(false);
      env.exitFullscreen();
      assert.equal(security.getSecurityState().fullscreen.a, 2);

      env.enterFullscreen();
      env.document.emit('click', { ...click, isTrusted: false });
      explain.setOpen(true);
      await Promise.resolve();
      env.exitFullscreen();
      assert.equal(security.getSecurityState().fullscreen.x, 2);

      env.enterFullscreen();
      const lookalike = installExplainDom(
        env,
        'https://example.org/lookalike.md',
        { detached: true },
      );
      env.document.emit('click', { ...click, target: lookalike.link });
      lookalike.setOpen(true);
      await Promise.resolve();
      env.exitFullscreen();
      assert.equal(security.getSecurityState().fullscreen.x, 3);

      env.enterFullscreen();
      const master = installExplainDom(
        env,
        'https://example.org/master.md',
        { enabled: false },
      );
      env.document.emit('click', { ...click, target: master.link });
      master.setOpen(true);
      await Promise.resolve();
      env.exitFullscreen();
      assert.equal(security.getSecurityState().fullscreen.a, 3);

      env.enterFullscreen();
      const slowExplain = installExplainDom(
        env,
        'https://example.org/slow-master.md',
        { enabled: false },
      );
      env.document.emit('click', { ...click, target: slowExplain.link });
      slowExplain.setOpen(true);
      await Promise.resolve();
      env.clock.advance(3000);
      env.exitFullscreen();
      assert.equal(security.getSecurityState().fullscreen.a, 4);

      env.enterFullscreen();
      const modifiedEscape = installExplainDom(env, 'https://example.org/modifier.md');
      env.document.emit('click', { ...click, target: modifiedEscape.link });
      modifiedEscape.setOpen(true);
      await Promise.resolve();
      env.document.emit('keydown', {
        isTrusted: true,
        key: 'Escape',
        ctrlKey: true,
        target: modifiedEscape.link,
      });
      modifiedEscape.setOpen(false);
      env.exitFullscreen();
      assert.equal(security.getSecurityState().fullscreen.x, 4);
    });
  });

  await t.test('exempts a confirmed iframe-focus blur once but never a hidden tab', async () => {
    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      security.installTabTracking({
        isActive: () => true,
        allowMathpathExplain: true,
      });
      const explain = installExplainDom(env);
      const click = {
        isTrusted: true,
        button: 0,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: explain.link,
      };
      env.document.emit('click', click);
      explain.setOpen(true);
      await Promise.resolve();

      env.setFocused(false);
      env.window.emit('blur', {});
      env.clock.advance(80);
      assert.equal(security.getSecurityState().tab, 0);

      env.setFocused(true);
      env.window.emit('focus', {});
      env.setFocused(false);
      env.window.emit('blur', {});
      env.clock.advance(80);
      assert.equal(security.getSecurityState().tab, 1);
    });

    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      security.installTabTracking({
        isActive: () => true,
        allowMathpathExplain: true,
      });
      const explain = installExplainDom(env);
      env.document.emit('click', {
        isTrusted: true,
        button: 0,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: explain.link,
      });
      explain.setOpen(true);
      await Promise.resolve();
      env.setVisibility('hidden');
      env.document.emit('visibilitychange', {});
      assert.equal(security.getSecurityState().tab, 1);
    });
  });

  await t.test('gates and resets Tab collection at the exam boundary', async () => {
    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      let active = false;
      security.installTabTracking({ isActive: () => active });
      env.setVisibility('hidden');
      env.document.emit('visibilitychange', {});
      assert.equal(security.getSecurityState().tab, 0);

      env.setVisibility('visible');
      env.setFocused(true);
      active = true;
      security.resetTabTracking();
      env.setVisibility('hidden');
      env.document.emit('visibilitychange', {});
      assert.equal(security.getSecurityState().tab, 1);

      env.setVisibility('visible');
      security.resetTabTracking();
      assert.equal(security.getSecurityState().tab, 0);
    });
  });

  await t.test('does not double-count fullscreen focus artifacts and still records hidden tabs', async () => {
    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      env.document.documentElement.requestFullscreen = () => {
        env.enterFullscreen();
        return Promise.resolve();
      };
      security.installExamFullscreenTracking({ isActive: () => true });
      security.installTabTracking({ isActive: () => true });
      await security.requestExamFullscreen();
      env.clock.advance(1000);
      env.exitFullscreen();

      env.setFocused(false);
      env.window.emit('blur', {});
      env.clock.advance(80);
      assert.equal(security.getSecurityState().fullscreen.x, 1);
      assert.equal(security.getSecurityState().tab, 0);

      env.enterFullscreen();
      env.setFocused(true);
      env.window.emit('focus', {});
      env.clock.advance(1000);
      env.setFocused(false);
      env.window.emit('blur', {});
      env.exitFullscreen();
      env.clock.advance(80);
      assert.equal(security.getSecurityState().fullscreen.x, 2);
      assert.equal(security.getSecurityState().tab, 0);

      env.clock.advance(901);
      env.setFocused(true);
      env.window.emit('focus', {});
      env.setFocused(false);
      env.window.emit('blur', {});
      env.clock.advance(80);
      assert.equal(security.getSecurityState().tab, 1);
    });

    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      let settle;
      env.document.documentElement.requestFullscreen = () =>
        new Promise(resolve => { settle = resolve; });
      security.installExamFullscreenTracking({ isActive: () => true });
      security.installTabTracking({ isActive: () => true });
      const pending = security.requestExamFullscreen();
      assert.equal(security.getSecurityState().fullscreen.r, 4);

      env.setFocused(false);
      env.window.emit('blur', {});
      env.clock.advance(80);
      assert.equal(security.getSecurityState().tab, 0);

      env.setVisibility('hidden');
      env.document.emit('visibilitychange', {});
      assert.equal(security.getSecurityState().tab, 1);
      settle();
      assert.equal(await pending, 'denied');
    });

    await withEnvironment({ userAgent: chromeWindows }, async (security, env) => {
      env.document.documentElement.requestFullscreen = () => new Promise(() => {});
      security.installExamFullscreenTracking({ isActive: () => true });
      const pending = security.requestExamFullscreen();
      env.clock.advance(4999);
      assert.equal(security.getSecurityState().fullscreen.r, 4);
      env.clock.advance(1);
      assert.equal(await pending, 'denied');
      assert.equal(security.getSecurityState().fullscreen.r, 3);
    });
  });
});
