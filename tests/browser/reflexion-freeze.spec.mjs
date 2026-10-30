import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

const origin = "http://localhost:4174";
const courseUrl = origin + "/lia-freeze-v2/tests/browser/fixtures/reflexion-freeze.md";
// Use the production macros and bundle without importing unrelated demo plugins.
const template = readFileSync(new URL("../../README.md", import.meta.url), "utf8")
  .match(/^<!--[\s\S]*?-->/u)[0]
  .replace(/^import:.*$/gmu, "")
  .replace(/^script:.*$/mu, "script: " + origin + "/lia-freeze-v2/dist/index.js")
  .replace(/^language:.*$/mu, "language: de")
  .replace("-->", "mode: Presentation\n-->");
const feedback = "Vielen Dank fuer die Praxisbeispiele.";

function courseMarkdown(multipleSections = false) {
  return `${template}

# Reflexion

@Auswertung(Send)

---

---
${multipleSections ? "\n## Rueckmeldungen\n" : ""}
Wie war der Aufbau?

- [( )] Hervorragend
- [( )] Gut
- [( )] Mittel

---

Wie waren die Abschnitte?

- [(Gut) (Mittel)]
- [( ) ( )] Einfuehrung
- [( ) ( )] Praxis

---

Ihre Rueckmeldung:

[[___ ___ ___]]

---

---

@Abgabe
`;
}

async function routeCourse(page, multipleSections = false, delayMetadata = false) {
  let requests = 0;
  let release;
  const metadataGate = new Promise(resolve => { release = resolve; });
  await page.route(courseUrl + "*", async route => {
    requests += 1;
    // LiaScript loads the source first; Freeze's optional metadata fetch follows.
    if (delayMetadata && requests > 1) await metadataGate;
    await route.fulfill({
      body: courseMarkdown(multipleSections),
      contentType: "text/markdown; charset=utf-8",
    });
  });
  return { release, requests: () => requests };
}

function snapshot(link) {
  const url = new URL(decodeURIComponent(new URL(link).search.slice(1)));
  const token = decodeURIComponent(url.hash.slice("#submission=".length));
  expect(token).toMatch(/^gz:/u);
  return JSON.parse(gunzipSync(Buffer.from(token.slice(3), "base64url")).toString("utf8"));
}

function linkWithSnapshot(link, payload, hash) {
  const viewer = new URL(link);
  const source = new URL(decodeURIComponent(viewer.search.slice(1)));
  source.hash = "submission=gz:" + gzipSync(JSON.stringify(payload)).toString("base64url");
  viewer.search = "?" + encodeURIComponent(source.toString());
  viewer.hash = hash;
  return viewer.toString();
}

async function expectAnswers(page) {
  const single = page.locator(".lia-quiz-single-choice input");
  const matrix = page.locator(".lia-quiz-matrix input");
  for (let index = 0; index < 3; index += 1) {
    await expect(single.nth(index)).toBeChecked({ checked: index === 1 });
    await expect(single.nth(index)).toBeDisabled();
  }
  for (let index = 0; index < 4; index += 1) {
    await expect(matrix.nth(index)).toBeChecked({ checked: index === 0 || index === 3 });
    await expect(matrix.nth(index)).toBeDisabled();
  }
  await expect(page.locator("textarea.lia-quiz__input")).toHaveValue(feedback);
  await expect(page.locator("textarea.lia-quiz__input")).toHaveAttribute("readonly");
}

async function submit(page, multipleSections = false) {
  await routeCourse(page, multipleSections);
  const hash = multipleSections ? "#2" : "#1";
  await page.goto(origin + "/liascript/index.html?" + encodeURIComponent(courseUrl) + hash);
  await expect.poll(() => page.evaluate(() =>
    window.__liaFreezeLearningStateV1__?.read().phase,
  )).toBe("collect");
  await page.locator(".lia-quiz-single-choice input").nth(1).check();
  await page.locator(".lia-quiz-matrix input").nth(0).check();
  await page.locator(".lia-quiz-matrix input").nth(3).check();
  await page.locator("textarea.lia-quiz__input").fill(feedback);
  await page.locator("#lia-name").fill("Reflexion Regression");
  // Deliberately submit without clicking individual quiz/survey Check buttons.
  await page.locator("#lia-create-link").click();
  await expect(page.locator("#lia-link")).not.toHaveValue("");
  const link = await page.locator("#lia-link").inputValue();
  const payload = snapshot(link);
  expect(payload.nativeDom.slides[hash]).toHaveLength(3);
  expect(payload.nativeDom.slides[hash][0].controls.map(control => control.checked)).toEqual([0, 1, 0]);
  expect(payload.nativeDom.slides[hash][1].controls.map(control => control.checked)).toEqual([1, 0, 0, 1]);
  expect(payload.nativeDom.slides[hash][2].controls[0].value).toBe(feedback);
  return { link, payload };
}

test("single-section reflection returns from evaluation to every saved answer", async ({ browser, page }) => {
  const { link } = await submit(page);
  const reviewer = await browser.newContext();
  const opened = await reviewer.newPage();
  const source = await routeCourse(opened, false, true);
  try {
    await opened.goto(link, { waitUntil: "domcontentloaded" });
    await expect(opened.locator("#lia-eval-placeholder")).toBeVisible();
    await expect(opened.locator("#lia-freeze-head")).toContainText("2 / 2");
    await expect(opened.locator("#lia-freeze-prev")).toBeEnabled();
    await expect(opened.locator("#lia-freeze-first")).toBeEnabled();
    await expect.poll(source.requests).toBeGreaterThan(1);
    await opened.locator("#lia-freeze-prev").click();
    await expect(opened.locator("#lia-eval-placeholder")).toBeHidden();
    await expect(opened.locator("main.lia-slide__content")).toHaveCSS("opacity", "1");
    await expect(opened.locator("#lia-freeze-head")).toContainText("1 / 2");
    await expect(opened).toHaveURL(/#1$/u);
    await expectAnswers(opened);

    // Finishing the source fetch and the delayed initial restore must retain content view.
    source.release();
    await expect.poll(() => opened.evaluate(() =>
      window.__liaFreezeLearningStateV1__?.read().phase,
    )).toBe("review");
    await opened.waitForTimeout(400);
    await expect(opened.locator("#lia-eval-placeholder")).toBeHidden();
    for (const enter of ["#lia-freeze-next", "#lia-freeze-last"]) {
      await opened.locator(enter).click();
      await expect(opened.locator("#lia-eval-placeholder")).toBeVisible();
      await expect(opened.locator("#lia-freeze-head")).toContainText("2 / 2");
      await opened.locator("#lia-freeze-first").click();
      await expect(opened.locator("#lia-eval-placeholder")).toBeHidden();
      await expect(opened.locator("#lia-freeze-head")).toContainText("1 / 2");
      await expectAnswers(opened);
      await expect(opened).toHaveURL(/#1$/u);
    }
    await expectAnswers(page);
    await expect(page.locator("#lia-link")).toHaveValue(link);
  } finally {
    source.release();
    await reviewer.close();
  }
});

test("early evaluation macro and legacy hash collision preserve real section two", async ({ browser, page }) => {
  const { link, payload } = await submit(page, true);
  expect(payload.ev.slides.map(slide => slide.h)).toEqual(["#1", "#2", "#3"]);
  // Before the fix, an early @Auswertung reused #2 for its virtual section.
  payload.ev.slides.find(slide => slide.vt === "evaluation").h = "#2";
  // Keep a different submission section so opening #2 explicitly requests content.
  payload.ev.abgabeHash = "#1";
  const reviewer = await browser.newContext();
  const opened = await reviewer.newPage();
  await routeCourse(opened, true);
  try {
    await opened.goto(linkWithSnapshot(link, payload, "#2"));
    await expect.poll(() => opened.evaluate(() =>
      window.__liaFreezeLearningStateV1__?.read().phase,
    )).toBe("review");
    await expect(opened.locator("#lia-eval-placeholder")).toBeHidden();
    await expectAnswers(opened);
    await expect(opened.locator("#lia-freeze-head")).toContainText("2 / 3");
    await opened.locator("#lia-freeze-first").click();
    await expect(opened).toHaveURL(/#1$/u);
    await opened.locator("#lia-freeze-next").click();
    await expect(opened).toHaveURL(/#2$/u);
    await expect(opened.locator("#lia-eval-placeholder")).toBeHidden();
    await expectAnswers(opened);
    await opened.locator("#lia-freeze-next").click();
    await expect(opened.locator("#lia-eval-placeholder")).toBeVisible();
    await expect(opened.locator("#lia-freeze-head")).toContainText("3 / 3");
    await opened.locator("#lia-freeze-prev").click();
    await expect(opened).toHaveURL(/#2$/u);
    await expect(opened.locator("#lia-eval-placeholder")).toBeHidden();
    await expectAnswers(opened);
  } finally {
    await reviewer.close();
  }
});
