import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

// MINT-the-GAP/Wochenaufgabe at 96e8c1842784c346c874ae7d29e675bce78f1e44,
// 5/Mathematik/Lia5_01.md. Only the Freeze import points to this local build.
const origin = "http://localhost:4174";
const courseUrl = origin + "/lia-freeze-v2/tests/browser/fixtures/Lia5_01.md";
const viewerUrl = origin + "/liascript/index.html?" + encodeURIComponent(courseUrl);
const course = readFileSync(new URL("./fixtures/Lia5_01.md", import.meta.url), "utf8")
  .replace(
    "https://raw.githubusercontent.com/MINT-the-GAP/lia-freeze-v2/main/README.md",
    origin + "/lia-freeze-v2/README.md",
  );

const plans = [
  { slide: 2, title: "Aufgabe 1: Zahlen verstehen", quizzes: 4,
    inputs: ["603048", "7", "0", "4", "2", "0", "5", "385000"], dropdown: 2 },
  { slide: 3, title: "Aufgabe 2: Rechnen und Muster nutzen", quizzes: 6,
    inputs: ["834", "525", "900", "108", "62", "176", "352"] },
  { slide: 4, title: "Aufgabe 3: Größen im Alltag", quizzes: 5,
    inputs: ["3450", "2250", "1080", "45", "95"] },
  { slide: 5, title: "Aufgabe 4: Raum und Form", quizzes: 4,
    inputs: ["40", "26", "24"], radio: "Jedes Quadrat ist ein Rechteck." },
  { slide: 6, title: "Aufgabe 5: Daten und Zufall", quizzes: 4,
    inputs: ["24", "4"], dropdown: 1,
    radio: "Das ausgewählte Kind hat einen Apfel gewählt." },
  { slide: 7, title: "Aufgabe 6: Sachaufgabe zum Schulgarten", quizzes: 3,
    inputs: ["168", "125", "43"] },
];

async function routeCourse(page) {
  await page.route(courseUrl + "*", route => route.fulfill({
    body: course,
    contentType: "text/markdown; charset=utf-8",
  }));
}

async function waitForSlide(page, slide, title) {
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#" + slide);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
}

async function nativeNext(page, slide, title) {
  await page.locator('button[title="weiter"]').click();
  await waitForSlide(page, slide, title);
}

async function answerSlide(page, plan) {
  await expect(page.locator(".lia-quiz__check")).toHaveCount(plan.quizzes);
  await expect(page.locator("input.lia-quiz__input")).toHaveCount(plan.inputs.length);
  for (const [index, answer] of plan.inputs.entries()) {
    await page.locator("input.lia-quiz__input").nth(index).fill(answer);
  }
  if (plan.dropdown !== undefined) {
    await page.locator(".lia-dropdown").click();
    await page.locator(".lia-dropdown__option").nth(plan.dropdown).click();
  }
  if (plan.radio) {
    await page.locator("label.lia-label")
      .filter({ hasText: plan.radio })
      .locator('input[type="radio"]')
      .check();
  }
  for (let index = 0; index < plan.quizzes; index += 1) {
    await page.locator(".lia-quiz__check").nth(index).click();
  }
}

function readSnapshot(link) {
  const url = new URL(link);
  const sourceUrl = new URL(decodeURIComponent(url.search.slice(1)));
  const token = decodeURIComponent(sourceUrl.hash.slice("#submission=".length));
  expect(token).toMatch(/^gz:/u);
  return JSON.parse(gunzipSync(Buffer.from(token.slice(3), "base64url")).toString("utf8"));
}

async function expectFrozenAnswers(page, plan) {
  await page.evaluate(slide => { location.hash = "#" + slide; }, plan.slide);
  await waitForSlide(page, plan.slide, plan.title);
  const inputs = page.locator("input.lia-quiz__input");
  await expect(inputs).toHaveCount(plan.inputs.length);
  for (const [index, answer] of plan.inputs.entries()) {
    await expect(inputs.nth(index)).toHaveValue(answer);
    await expect(inputs.nth(index)).toHaveAttribute("readonly");
  }
  if (plan.dropdown !== undefined) {
    await expect(page.locator(".lia-dropdown__selected")).not.toContainText("Auswahl");
  }
  if (plan.radio) {
    await expect(
      page.locator("label.lia-label")
        .filter({ hasText: plan.radio })
        .locator('input[type="radio"]'),
    ).toBeChecked();
    await expect(
      page.locator("label.lia-label")
        .filter({ hasText: plan.radio })
        .locator('input[type="radio"]'),
    ).toBeDisabled();
  }
  await expect(page.locator("body")).toHaveClass(/lia-course-frozen/u);
}

test("K5-011 preserves 26 answers and shared-link navigation", async ({ browser }) => {
  test.setTimeout(300_000);

  const student = await browser.newContext();
  const page = await student.newPage();
  await routeCourse(page);
  await page.goto(viewerUrl + "#1", { waitUntil: "domcontentloaded" });
  await waitForSlide(page, 1, "Wochenaufgabe 1 Klasse 5 - Mathematik");
  await expect.poll(() =>
    page.evaluate(() => Boolean(window.__liaFreezeV2LifecycleV1__?.themeRefresh))
  ).toBe(true);

  // Native arrows also work without a Freeze link.
  await nativeNext(page, 2, plans[0].title);
  await page.locator('button[title="zurück"]').click();
  await waitForSlide(page, 1, "Wochenaufgabe 1 Klasse 5 - Mathematik");
  await nativeNext(page, 2, plans[0].title);

  for (const [index, plan] of plans.entries()) {
    if (index) await nativeNext(page, plan.slide, plan.title);
    await answerSlide(page, plan);
  }

  const hiddenStudentKey = page.locator('lia-loot-key[data-loot-concealment="solid"]');
  await expect(hiddenStudentKey).toHaveCount(1);
  await expect(hiddenStudentKey).toHaveAttribute("aria-hidden", "true");
  const orangeKey = page.locator('button[data-loot-key-button][data-loot-key-color="orange"]');
  await expect(orangeKey).toBeVisible();
  await orangeKey.click();
  await nativeNext(page, 8, "Letzte Station: Selbsteinschätzung");
  await nativeNext(page, 9, "Abgabe");

  const highscore = page.locator("#lia-loot-highscore-dialog");
  if (await highscore.isVisible()) {
    await page.getByRole("button", { name: "Highscore schließen" }).click();
  }
  const lock = page.locator('[data-loot-lock-button][data-loot-lock-target="freeze"]');
  await expect(lock).toBeVisible();
  await lock.click();
  await page.locator("#lia-name").fill("K5-011 Regression");
  await page.locator("#lia-create-link").click();
  await expect(page.locator("#lia-link")).not.toHaveValue("");
  const link = await page.locator("#lia-link").inputValue();
  expect(new URL(link).hash).toBe("#9");

  const payload = readSnapshot(link);
  expect(payload.sh).toBe("#9");
  expect(Object.values(payload.nativeDom?.slides ?? {})
    .reduce((total, tasks) => total + tasks.length, 0)).toBe(26);
  for (const plan of plans) {
    const tasks = payload.nativeDom.slides["#" + plan.slide];
    expect(tasks).toHaveLength(plan.quizzes);
    expect(tasks.every(task => task.touched === 1)).toBe(true);
    expect(tasks.flatMap(task =>
      task.controls.filter(control => control.type === "text").map(control => control.value)
    )).toEqual(plan.inputs);
  }
  await student.close();

  const reviewer = await browser.newContext();
  const opened = await reviewer.newPage();
  await routeCourse(opened);
  await opened.goto(link, { waitUntil: "domcontentloaded" });
  await expect(opened.locator("body")).toHaveClass(/lia-shared-freeze-link/u);
  await waitForSlide(opened, 9, "Abgabe");

  // Native bottom arrows must keep the viewer hash numeric.
  const back = opened.locator('button[title="zurück"]');
  await back.click();
  await waitForSlide(opened, 8, "Letzte Station: Selbsteinschätzung");
  await back.click();
  await waitForSlide(opened, 7, plans[5].title);
  await opened.locator('button[title="weiter"]').click();
  await waitForSlide(opened, 8, "Letzte Station: Selbsteinschätzung");
  await opened.locator('button[title="weiter"]').click();
  await waitForSlide(opened, 9, "Abgabe");

  // The imported lia-navigation tree uses the viewer's original TOC links.
  await expect(opened.locator("#lia-bm-toc5")).toHaveCount(1, { timeout: 15000 });
  const tocButton = opened.locator('button[title="Inhaltsverzeichnis"]');
  if (await tocButton.getAttribute("aria-expanded") !== "true") {
    await tocButton.click({ timeout: 15000 });
  }
  const rootToggle = opened.locator('#lia-bm-toc5 .bm-row[data-key="h:1"] .bm-toggle');
  if (await rootToggle.getAttribute("aria-expanded") === "false") {
    await rootToggle.click({ timeout: 15000 });
  }
  await opened.locator('#lia-bm-toc5 a[href="#5"]').click({ timeout: 15000 });
  await waitForSlide(opened, 5, plans[3].title);

  for (const plan of plans) {
    await expectFrozenAnswers(opened, plan);
  }
  await expect(opened.locator('button[data-loot-key-color="purple"]')).toHaveCount(0);
  await opened.evaluate(() => { location.hash = "#1"; });
  await waitForSlide(opened, 1, "Wochenaufgabe 1 Klasse 5 - Mathematik");
  await expect(opened.getByRole("button", { name: /Board-Mode-Schriftsteuerung gesperrt/u })).toBeVisible();
  await expect(opened.getByRole("button", { name: /Textmarker-Werkzeug gesperrt/u })).toBeVisible();
  await expect(opened.getByRole("button", { name: /Classroom gesperrt/u })).toBeVisible();
  await expect(opened.getByRole("button", { name: /Roten Schl.*ssel einsammeln/u })).toBeDisabled();

  await opened.evaluate(() => { location.hash = "#9"; });
  await waitForSlide(opened, 9, "Abgabe");
  await opened.reload({ waitUntil: "domcontentloaded" });
  await expect(opened.locator("body")).toHaveClass(/lia-shared-freeze-link/u);
  await waitForSlide(opened, 9, "Abgabe");
  await reviewer.close();

  // A saved numeric position must open in a new browser context and survive reload.
  const directContext = await browser.newContext();
  const direct = await directContext.newPage();
  await routeCourse(direct);
  const savedPosition = link.slice(0, link.lastIndexOf("#")) + "#7";
  await direct.goto(savedPosition, { waitUntil: "domcontentloaded" });
  await expect(direct.locator("body")).toHaveClass(/lia-shared-freeze-link/u);
  await waitForSlide(direct, 7, plans[5].title);
  await expect(direct.locator("input.lia-quiz__input").first()).toHaveValue("168");
  await direct.reload({ waitUntil: "domcontentloaded" });
  await expect(direct.locator("body")).toHaveClass(/lia-shared-freeze-link/u);
  await waitForSlide(direct, 7, plans[5].title);
  await directContext.close();
});
