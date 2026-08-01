import { expect, test } from "@playwright/test";

const testOrigin = "http://localhost:4174";
const editorPath = "/liascript/index.html";
const freezeImport = "../../../README.md";
const lootCommit = "1202075afaa0d72b94657a3ac92bc9cf1742b7bc";
const lootImport =
  "https://raw.githubusercontent.com/MINT-the-GAP/lia-loot/"
  + lootCommit
  + "/README.md";
const requiredChromiumVersion = "131.0.6778.204";
const configuredChromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "";
const exactChromiumVersion =
  process.env.EXPECTED_CHROMIUM_VERSION
  || (configuredChromiumPath.includes(requiredChromiumVersion)
    ? requiredChromiumVersion
    : "");

const fixtures = [
  {
    heading: "Importlauf Loot vor Freeze",
    imports: [lootImport, freezeImport],
    name: "lia-loot vor lia-freeze-v2",
    slug: "loot-freeze",
  },
  {
    heading: "Importlauf Freeze vor Loot",
    imports: [freezeImport, lootImport],
    name: "lia-freeze-v2 vor lia-loot",
    slug: "freeze-loot",
  },
];

function courseMarkdown(fixture) {
  return [
    "<!--",
    "author: MINT-the-GAP",
    "version: 1.0.0",
    "language: de",
    "comment: Browser-Regression für lia-loot und lia-freeze-v2.",
    "",
    "import: " + fixture.imports[0],
    "import: " + fixture.imports[1],
    "-->",
    "",
    "# " + fixture.heading,
    "",
    "@Ressourcen(0, 0)",
    "",
    "@Schluessel(gelb)",
    "",
    "@Abgabe",
    "",
    "@Schloss(freeze, gelb)",
    "",
    "# Lifecycle-Kontrollfolie",
    "",
    "Kontrolliert den Folienwechsel ohne einen zweiten Freeze-Boot.",
    "",
  ].join("\n");
}

function editorUrl(courseUrl) {
  return testOrigin + editorPath + "?" + encodeURIComponent(courseUrl);
}

async function installThemeObserverMetrics(page) {
  await page.addInitScript(() => {
    const NativeMutationObserver = window.MutationObserver;
    const metrics = {
      active: 0,
      callbacks: 0,
      created: 0,
      peakActive: 0,
    };

    class InstrumentedMutationObserver {
      constructor(callback) {
        this.activeThemeObserver = false;
        this.everObservedTheme = false;
        this.nativeObserver = new NativeMutationObserver((records) => {
          if (this.everObservedTheme) metrics.callbacks += 1;
          callback(records, this);
        });
      }

      observe(target, options = {}) {
        const filter = Array.isArray(options.attributeFilter)
          ? options.attributeFilter
          : [];
        const observesRootTheme =
          target === document.documentElement
          && options.attributes === true
          && filter.includes("class")
          && filter.includes("style")
          && filter.includes("data-theme");

        if (observesRootTheme && !this.everObservedTheme) {
          this.everObservedTheme = true;
          metrics.created += 1;
        }
        if (observesRootTheme && !this.activeThemeObserver) {
          this.activeThemeObserver = true;
          metrics.active += 1;
          metrics.peakActive = Math.max(metrics.peakActive, metrics.active);
        }
        this.nativeObserver.observe(target, options);
      }

      disconnect() {
        if (this.activeThemeObserver) {
          this.activeThemeObserver = false;
          metrics.active -= 1;
        }
        this.nativeObserver.disconnect();
      }

      takeRecords() {
        return this.nativeObserver.takeRecords();
      }
    }

    window.MutationObserver = InstrumentedMutationObserver;
    window.__FREEZE_THEME_METRICS__ = metrics;
  });
}

async function waitForImportedRuntimes(page, fixture) {
  await expect(
    page.getByRole("heading", { name: fixture.heading, exact: true }),
  ).toBeVisible();

  await expect.poll(() => page.evaluate(() => ({
    freezeStyles: document.querySelectorAll(
      "#lia-submission-runtime-style",
    ).length,
    lifecycle: Boolean(
      window.__liaFreezeV2LifecycleV1__?.themeRefresh,
    ),
    lootStatus: window.__LIA_LOOT_RUNTIME__?.status ?? null,
    lootStyles: document.querySelectorAll(
      "#lia-loot-highscore-style",
    ).length,
    rootObservers: window.__FREEZE_THEME_METRICS__?.active ?? 0,
    submissionBoxes: document.querySelectorAll(".lia-submit-box").length,
  }))).toEqual({
    freezeStyles: 1,
    lifecycle: true,
    lootStatus: "ready",
    lootStyles: 1,
    rootObservers: 1,
    submissionBoxes: 1,
  });
}

async function singletonState(page) {
  return page.evaluate(() => ({
    bars: document.querySelectorAll("#lia-freeze-bar").length,
    boxes: document.querySelectorAll(".lia-submit-box").length,
    freezeStyles: document.querySelectorAll(
      "#lia-submission-runtime-style",
    ).length,
    lootStyles: document.querySelectorAll(
      "#lia-loot-highscore-style",
    ).length,
    rootActive: window.__FREEZE_THEME_METRICS__.active,
    rootCreated: window.__FREEZE_THEME_METRICS__.created,
    rootPeak: window.__FREEZE_THEME_METRICS__.peakActive,
  }));
}

async function expectSingletons(page, expectedBars) {
  await expect.poll(() => singletonState(page)).toEqual({
    bars: expectedBars,
    boxes: 1,
    freezeStyles: 1,
    lootStyles: 1,
    rootActive: 1,
    rootCreated: 1,
    rootPeak: 1,
  });
}

async function exerciseSlideRemount(page, fixture) {
  await page.evaluate(() => {
    window.location.hash = "#2";
  });
  await expect(
    page.getByRole("heading", {
      name: "Lifecycle-Kontrollfolie",
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    freezeStyles: document.querySelectorAll(
      "#lia-submission-runtime-style",
    ).length,
    lootStyles: document.querySelectorAll(
      "#lia-loot-highscore-style",
    ).length,
    rootActive: window.__FREEZE_THEME_METRICS__.active,
    rootCreated: window.__FREEZE_THEME_METRICS__.created,
    rootPeak: window.__FREEZE_THEME_METRICS__.peakActive,
  }))).toEqual({
    freezeStyles: 1,
    lootStyles: 1,
    rootActive: 1,
    rootCreated: 1,
    rootPeak: 1,
  });

  await page.evaluate(() => {
    window.location.hash = "#1";
  });
  await waitForImportedRuntimes(page, fixture);
  await expectSingletons(page, 0);
}

async function reloadFreezeBundle(page) {
  await page.evaluate(async () => {
    const bundleUrl = "/lia-freeze-v2/dist/index.js";
    const response = await fetch(bundleUrl);
    if (!response.ok) {
      throw new Error("Freeze bundle source could not be inspected");
    }
    const source = await response.text();
    const parcelName = source.match(
      /"(parcelRequire[^"]+)",\{\}\);\s*(?:\/\/# sourceMappingURL=.*)?\s*$/u,
    )?.[1];
    if (
      !parcelName
      || typeof window[parcelName] !== "function"
      || window[parcelName].isParcelRequire !== true
    ) {
      throw new Error("Freeze Parcel runtime could not be identified");
    }

    const previousRuntime = window[parcelName];
    if (!delete window[parcelName]) {
      throw new Error("Freeze Parcel runtime could not be isolated");
    }

    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = bundleUrl;
      script.onload = () => {
        if (window[parcelName] === previousRuntime) {
          reject(new Error("Freeze bundle did not create a fresh runtime"));
          return;
        }
        resolve(true);
      };
      script.onerror = () => reject(new Error("Freeze bundle remount failed"));
      document.head.appendChild(script);
    });
  });
}

async function expectResponsiveStability(page, durationMs, label) {
  const started = await page.evaluate(
    () => window.__FREEZE_THEME_METRICS__.callbacks,
  );
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(Math.min(5_000, deadline - Date.now()));
    expect(
      await page.evaluate(() => 6 * 7),
      label + " event loop",
    ).toBe(42);
  }

  const settled = await page.evaluate(
    () => window.__FREEZE_THEME_METRICS__.callbacks,
  );
  await page.waitForTimeout(1_000);
  const finalCount = await page.evaluate(
    () => window.__FREEZE_THEME_METRICS__.callbacks,
  );
  expect(finalCount, label + " callback count after settling").toBe(settled);
  expect(
    settled - started,
    label + " sustained callback rate",
  ).toBeLessThan(50);
}

async function expectLockedForMouseAndKeyboard(page) {
  const createButton = page.locator("#lia-create-link");
  await expect(createButton).toHaveAttribute("tabindex", "-1");
  expect(await createButton.evaluate((element) => element.inert)).toBe(true);

  await page.evaluate(() => {
    window.__LOCKED_CREATE_CLICKS__ = 0;
    document.getElementById("lia-create-link").addEventListener(
      "click",
      () => {
        window.__LOCKED_CREATE_CLICKS__ += 1;
      },
    );
  });

  const box = await createButton.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(100);
  expect(
    await page.evaluate(() => window.__LOCKED_CREATE_CLICKS__),
  ).toBe(0);
  await expect(page.locator("#lia-link")).toHaveValue("");

  expect(await createButton.evaluate((element) => {
    element.focus();
    return document.activeElement === element;
  })).toBe(false);
  await page.keyboard.press("Enter");
  expect(
    await page.evaluate(() => window.__LOCKED_CREATE_CLICKS__),
  ).toBe(0);
}

async function collectKeyAndUnlock(page) {
  const key = page.getByRole("button", {
    name: "Gelben Schlüssel einsammeln",
  });
  await expect(key).toHaveCount(1);
  await key.focus();
  await expect(key).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.locator(
      '#lia-loot-key-inventory [data-loot-key-color="yellow"]',
    ),
  ).toHaveCount(1);

  const lock = page.locator(
    '[data-loot-lock-button][data-loot-lock-target="freeze"]',
  );
  await expect(lock).toHaveCount(1);
  await lock.focus();
  await expect(lock).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(lock).toHaveCount(0);

  const createButton = page.locator("#lia-create-link");
  expect(await createButton.evaluate((element) => element.inert)).toBe(false);
  await expect(createButton).not.toHaveAttribute("tabindex", "-1");
  await createButton.focus();
  await expect(createButton).toBeFocused();
  await expect(createButton).toBeEnabled();
}

async function applyExternalThemeStress(page) {
  const before = await page.evaluate(
    () => window.__FREEZE_THEME_METRICS__.callbacks,
  );
  await page.evaluate(async () => {
    const root = document.documentElement;
    for (let index = 0; index < 100; index += 1) {
      root.classList.toggle("freeze-theme-stress-a", index % 2 === 0);
      root.dataset.theme = "freeze-stress-" + (index % 3);
      root.style.setProperty("--freeze-external-stress", String(index));
      if (index % 10 === 9) {
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }
    root.style.setProperty("--color-highlight", "rgb(12, 34, 56)");
    window.__FREEZE_EXTERNAL_MUTATIONS__ = 100;
  });
  await expect.poll(() => page.evaluate(
    () => document.documentElement.style.getPropertyValue(
      "--lia-submit-bg-rgb",
    ),
  )).toBe("12, 34, 56");
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    callbacks: window.__FREEZE_THEME_METRICS__.callbacks,
    externalMutations: window.__FREEZE_EXTERNAL_MUTATIONS__,
  }));
  expect(after.externalMutations).toBe(100);
  expect(after.callbacks).toBeGreaterThan(before);
  expect(after.callbacks - before).toBeLessThan(50);
}

async function expectBfcacheAndFinalCleanup(page) {
  const state = await page.evaluate(() => {
    const pageHide = (persisted) => {
      const event = new Event("pagehide");
      Object.defineProperty(event, "persisted", { value: persisted });
      window.dispatchEvent(event);
    };

    pageHide(true);
    const activeAfterPersisted = window.__FREEZE_THEME_METRICS__.active;
    pageHide(false);
    return {
      activeAfterFinal: window.__FREEZE_THEME_METRICS__.active,
      activeAfterPersisted,
    };
  });
  expect(state).toEqual({
    activeAfterFinal: 0,
    activeAfterPersisted: 1,
  });
}

for (const fixture of fixtures) {
  test(
    "stabilisiert Theme und Freeze mit " + fixture.name,
    async ({ browser, browserName, page }) => {
      const exactRun = Boolean(exactChromiumVersion);
      test.skip(
        exactRun && browserName !== "chromium",
        "Die exakte ausführbare Chromium-Version gilt nur im Chromium-Projekt.",
      );
      test.setTimeout(
        exactRun ? 300_000 : 180_000,
      );
      if (exactRun) {
        expect(browser.version()).toBe(exactChromiumVersion);
      }

      const runtimeErrors = [];
      page.on("pageerror", error => runtimeErrors.push(String(error)));
      page.on("console", message => {
        if (
          message.type() === "error"
          && /LIA-(?:FREEZE|LOOT)|uncaught|unhandled/iu.test(message.text())
        ) {
          runtimeErrors.push(message.text());
        }
      });

      await installThemeObserverMetrics(page);
      const fixtureUrl =
        testOrigin
        + "/lia-freeze-v2/tests/browser/fixtures/"
        + fixture.slug
        + ".md";
      await page.route(fixtureUrl + "*", route => route.fulfill({
        body: courseMarkdown(fixture),
        contentType: "text/markdown; charset=utf-8",
        status: 200,
      }));

      await page.goto(editorUrl(fixtureUrl), {
        timeout: 30_000,
        waitUntil: "domcontentloaded",
      });
      await waitForImportedRuntimes(page, fixture);
      await expectSingletons(page, 0);
      await expect(
        page.locator(
          '[data-loot-lock-button][data-loot-lock-target="freeze"]',
        ),
      ).toHaveCount(1);

      await reloadFreezeBundle(page);
      await expectSingletons(page, 0);
      await exerciseSlideRemount(page, fixture);

      const idleWindow =
        exactRun ? 30_000 : 1_000;
      await expectResponsiveStability(
        page,
        idleWindow,
        fixture.name + " before Freeze",
      );

      await expectLockedForMouseAndKeyboard(page);
      await collectKeyAndUnlock(page);

      await page.reload({
        timeout: 30_000,
        waitUntil: "domcontentloaded",
      });
      await waitForImportedRuntimes(page, fixture);
      await expectSingletons(page, 0);
      await expect(
        page.locator(
          '[data-loot-lock-button][data-loot-lock-target="freeze"]',
        ),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: "Gelben Schlüssel einsammeln",
        }),
      ).toHaveCount(0);

      const createButton = page.locator("#lia-create-link");
      await createButton.focus();
      await expect(createButton).toBeFocused();
      await page.locator("#lia-name").fill("Theme Stability");
      await createButton.click();
      await expect(page.locator("#lia-link")).not.toHaveValue("");
      await expect(page.locator("body")).toHaveClass(/lia-course-frozen/u);
      await expectSingletons(page, 1);

      await applyExternalThemeStress(page);
      const activeWindow =
        exactRun ? 30_000 : 5_000;
      await expectResponsiveStability(
        page,
        activeWindow,
        fixture.name + " after Freeze",
      );
      expect(await page.evaluate(() => 6 * 7)).toBe(42);

      const frozenLink = await page.locator("#lia-link").inputValue();
      await page.goto(frozenLink, {
        timeout: 30_000,
        waitUntil: "domcontentloaded",
      });
      await waitForImportedRuntimes(page, fixture);
      await expect(page.locator("body")).toHaveClass(
        /lia-shared-freeze-link/u,
      );
      await expectSingletons(page, 1);

      await page.reload({
        timeout: 30_000,
        waitUntil: "domcontentloaded",
      });
      await waitForImportedRuntimes(page, fixture);
      await expect(page.locator("body")).toHaveClass(
        /lia-shared-freeze-link/u,
      );
      await expectSingletons(page, 1);
      expect(await page.evaluate(() => 6 * 7)).toBe(42);
      expect(runtimeErrors).toEqual([]);
      await expectBfcacheAndFinalCleanup(page);
    },
  );
}
