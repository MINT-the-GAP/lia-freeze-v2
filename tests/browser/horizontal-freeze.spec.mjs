import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

// Hosted LiaScript registers a service worker; it must not bypass fixture routes on reload.
test.use({ serviceWorkers: "block" });

const origin = "https://raw.githubusercontent.com/freeze-regression/lia-freeze-v2/main";
// The installed devserver uses an older parser that cannot reproduce this bug.
const viewer = "https://liascript.github.io/course/";
const courseUrl = origin + "/tests/browser/fixtures/horizontal-freeze.md";
const freezeUrl = origin + "/README.md";
const boardBase = "https://raw.githubusercontent.com/MINT-the-GAP/lia-board-mode/012f1565c41a0411f63f35b9ddf8db1ecab44847/";
// Import the real production definitions; embedding them in the course header
// bypasses the LiaScript parser path responsible for this regression.
const freezeTemplate = readFileSync(new URL("../../README.md", import.meta.url), "utf8")
  .match(/^<!--[\s\S]*?-->/u)[0]
  .replace(/^import:.*$/gmu, "")
  .replace(/^script:.*$/mu, "script: " + origin + "/dist/index.js")
  + "\n\n# Freeze test import\n";
const selections = [2, 1, 1, 0, 2, 4];
const matrixSelections = [2, 6, 11, 18, 20, 26, 34, 37];
const feedback = "Mehr Zeit fuer die Praxis.";
const body = readFileSync(new URL("./fixtures/horizontal-reflexion.md", import.meta.url), "utf8")
  .replace(/^<!--[\s\S]*?-->\s*/u, "");
const course = `<!--
version: 1.0.0
language: de
mode: Presentation
import: ${boardBase}README.md
        ${freezeUrl}
-->

${body}`;
const freezeBundle = readFileSync(new URL("../../dist/index.js", import.meta.url));
const cors = { "access-control-allow-origin": "*" };
let boardTemplate;
let boardBundle;

test.beforeAll(async ({ request }) => {
  const [template, bundle] = await Promise.all([
    request.get(boardBase + "README.md"), request.get(boardBase + "dist/index.js"),
  ]);
  expect(template.ok()).toBeTruthy();
  expect(bundle.ok()).toBeTruthy();
  boardTemplate = await template.text();
  boardBundle = await bundle.body();
});

function rewriteSnapshot(link, transform) {
  const viewerUrl = new URL(link);
  const sourceUrl = new URL(decodeURIComponent(viewerUrl.search.slice(1)));
  const token = decodeURIComponent(sourceUrl.hash.slice("#submission=".length));
  expect(token).toMatch(/^gz:/u);
  const payload = JSON.parse(gunzipSync(Buffer.from(token.slice(3), "base64url")).toString("utf8"));
  expect(payload.nativeDom.slides["#1"]).toHaveLength(8);
  transform(payload);
  sourceUrl.hash = "submission=gz:" + gzipSync(JSON.stringify(payload)).toString("base64url");
  viewerUrl.search = "?" + encodeURIComponent(sourceUrl.toString());
  return viewerUrl.toString();
}

function legacyDomOnlyLink(link) {
  return rewriteSnapshot(link, payload => {
    for (const section of payload.s) {
      delete section.quiz;
      delete section.survey;
    }
  });
}

function nativeOnlyLink(link) {
  return rewriteSnapshot(link, payload => {
    // Exercise Quiz/Survey.Json DB load replies independently of DOM fallback.
    delete payload.nativeDom;
    const singleChoice = selection => ({ SingleChoice: Array.from({ length: 5 }, (_, index) => index === selection) });
    const matrix = { Matrix: matrixSelections.map((selection, row) => singleChoice(selection - row * 5)) };
    const states = [
      ...selections.slice(0, 3).map(singleChoice), matrix,
      ...selections.slice(3).map(singleChoice),
    ];
    const section = payload.s.find(item => item.h === "#1");
    section.quiz = { 0: states.map(state => ({ solved: 0, trial: 1, hint: 0, error_msg: "", state })) };
    section.survey = { 0: [{ submitted: false, state: { Text: feedback } }] };
  });
}

async function routeResources(page, legacy = false) {
  // A previously submitted link must also restore against the fixed template.
  const template = legacy ? freezeTemplate.replace(/^@Auswertung:[^\r\n]*$/mu,
    '@Auswertung\n<div data-snapshot-eval="1" style="display:none;"></div>\n@end') : freezeTemplate;
  await page.route(origin + "/dist/index.js", route => route.fulfill({ body: freezeBundle, contentType: "text/javascript; charset=utf-8", headers: cors }));
  await page.route(courseUrl + "*", route => route.fulfill({ body: course, contentType: "text/markdown; charset=utf-8", headers: cors }));
  await page.route(freezeUrl, route => route.fulfill({ body: template, contentType: "text/markdown; charset=utf-8", headers: cors }));
  await page.route(boardBase + "README.md", route => route.fulfill({ body: boardTemplate, contentType: "text/markdown; charset=utf-8", headers: cors }));
  await page.route(boardBase + "dist/index.js", route => route.fulfill({ body: boardBundle, contentType: "text/javascript; charset=utf-8", headers: cors }));
}

async function layout(page, width) {
  await page.setViewportSize({ width, height: 1000 });
  // Allow native and Boardmode resize handlers to finish before checking state.
  await page.waitForTimeout(1000);
  await expect(page.locator("main .lia-quiz[horizontal-quiz]")).toHaveCount(selections.length);
  await expect(page.locator("main .lia-quiz .lia-quiz")).toHaveCount(0);
  await expect.poll(() => page.locator("main .lia-quiz[horizontal-quiz]").evaluateAll(quizzes => quizzes.map(quiz => {
    const answers = quiz.querySelector(":scope > .lia-quiz__answers");
    const boxes = [...answers.querySelectorAll(":scope > .lia-label")].map(label => {
      const box = label.getBoundingClientRect();
      return { top: box.top, width: box.width, height: box.height };
    });
    return { direction: getComputedStyle(answers).flexDirection, boxes };
  })).then(rows => rows.every(row => row.boxes.length === 5 && row.boxes.every(box => box.width > 0 && box.height > 0)
    && (width > 760
      ? row.direction === "row" && row.boxes.every(box => Math.abs(box.top - row.boxes[0].top) < 2 && Math.abs(box.width - row.boxes[0].width) < 2)
      : row.direction === "column" && row.boxes.every((box, index) => !index || box.top > row.boxes[index - 1].top))
  ))).toBeTruthy();
}

async function savedAnswers(page) {
  const choices = selections.map(selection => Array.from({ length: 5 }, (_, index) => [index === selection, true]));
  const matrix = Array.from({ length: 40 }, (_, index) => [matrixSelections.includes(index), true]);
  // Read all controlled values in one turn, avoiding hundreds of protocol
  // round trips while still checking selected and unselected disabled inputs.
  await expect.poll(() => page.evaluate(() => {
    const state = controls => [...controls].map(input => [input.checked, input.disabled]);
    const text = document.querySelector("textarea.lia-quiz__input");
    return {
      choices: [...document.querySelectorAll("main .lia-quiz[horizontal-quiz]")].map(quiz => state(quiz.querySelectorAll("input"))),
      matrix: state(document.querySelectorAll("main .lia-quiz-matrix input")),
      text: text?.value,
      readOnly: text?.readOnly,
      cornerCards: document.querySelectorAll("lia-freeze-quiz-sidecars").length,
    };
  }), { timeout: 5000 }).toEqual({ choices, matrix, text: feedback, readOnly: true, cornerCards: 0 });
}

for (const mode of ["new", "legacy DOM-only", "native-only"]) {
  test(`${mode} horizontal answers keep structure and layout in a fresh Freeze link`, async ({ browser, browserName, page }) => {
    test.skip(mode === "native-only" && browserName !== "chromium", "Native DB protocol is verified once independently of DOM fallback.");
    await routeResources(page, mode === "legacy DOM-only");
    await page.goto(viewer + "?" + encodeURIComponent(courseUrl) + "#1");
    await expect.poll(() => page.evaluate(() => window.__liaFreezeLearningStateV1__?.read().phase)).toBe("collect");
    expect(await page.evaluate(() => window.LIA?.version)).toBe("2.5.0");
    await layout(page, 1600);
    for (const [index, selection] of selections.entries()) {
      await page.locator("main .lia-quiz[horizontal-quiz]").nth(index).locator("input").nth(selection).check();
    }
    for (const selection of matrixSelections) {
      await page.locator("main .lia-quiz-matrix input").nth(selection).check();
    }
    await page.locator("textarea.lia-quiz__input").fill(feedback);
    await page.locator("#lia-name").fill("Horizontal regression");
    await page.locator("#lia-create-link").click();
    await expect(page.locator("#lia-link")).not.toHaveValue("");
    const link = await page.locator("#lia-link").inputValue();
    const reviewer = await browser.newContext({ serviceWorkers: "block" });
    try {
      const opened = await reviewer.newPage();
      await routeResources(opened);
      await opened.goto(mode === "legacy DOM-only" ? legacyDomOnlyLink(link) : mode === "native-only" ? nativeOnlyLink(link) : link);
      await expect(opened.locator("#lia-eval-placeholder")).toBeVisible();
      await opened.locator("#lia-freeze-first").click();
      await expect(opened.locator("#lia-eval-placeholder")).toBeHidden();
      await layout(opened, 1600);
      await savedAnswers(opened);
      // Freeze originally retried DOM restoration only during the first six seconds.
      // Resizing later must not let LiaScript repaint empty native model values.
      await opened.waitForTimeout(8000);
      await layout(opened, 640);
      await savedAnswers(opened);
      await layout(opened, 1600);
      await opened.locator("#lia-freeze-last").click();
      await opened.locator("#lia-freeze-prev").click();
      await layout(opened, 1600);
      await savedAnswers(opened);
      await opened.reload();
      await expect(opened.locator("#lia-eval-placeholder")).toBeVisible();
      await opened.locator("#lia-freeze-first").click();
      await layout(opened, 1600);
      await savedAnswers(opened);
    } finally {
      await reviewer.close();
    }
  });
}
