// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { DEMO_PRACTICALS, type DemoPractical } from "../../src/routes/dev/-practicals-demo";
import { expectNoA11yViolations } from "./fixtures";

// The chart foundation (#59), shown with fictional data on the development page /dev/charts.
const nl: Readonly<Record<string, string>> = JSON.parse(
  readFileSync(new URL("../../messages/nl.json", import.meta.url), "utf8"),
);

function dutch(key: string): string {
  const message = nl[key];
  if (message === undefined) throw new Error(`messages/nl.json has no "${key}"`);
  return message;
}

const SHOTS = process.env["CHART_SCREENSHOTS"];

/** Collects hydration errors and warnings from the console. */
function watchHydration(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (message) => {
    if (/hydrat/i.test(message.text())) messages.push(message.text());
  });
  return messages;
}

function chart(page: Page): Locator {
  return page.getByRole("img", { name: /^Scatter plot of 14 fictional practicals/ });
}

/** The chart's tooltip: the polite status region the chart host shows beside a focused point. */
function tooltip(page: Page): Locator {
  return page.locator(".ts-chart-host").getByRole("status");
}

function practical(id: string): DemoPractical {
  const found = DEMO_PRACTICALS.find((row) => row.id === id);
  if (!found) throw new Error(`no demo practical ${id}`);
  return found;
}

async function open(page: Page): Promise<void> {
  await page.goto("/dev/charts");
  await expect(page.getByRole("heading", { level: 1, name: "Chart examples" })).toBeVisible();
  await expect(chart(page)).toBeVisible();
  // The host adopts the server SVG after hydration; wait for its interactive layer.
  await page.waitForFunction(() => document.querySelector(".ts-chart-host svg circle") !== null);
}

test("the example scatter plot renders server-side and hydrates without warnings (#59)", async ({
  page,
}) => {
  const hydration = watchHydration(page);
  const response = await page.goto("/dev/charts");
  expect(response?.status()).toBe(200);
  const html = (await response?.text()) ?? "";
  // Server-rendered SVG: the points are in the HTML before any script runs.
  expect(html).toContain('aria-roledescription="chart"');
  expect(html).toMatch(/<circle[^>]+data-ts-key/);

  await open(page);
  await expect(page).toHaveTitle("Chart examples · eduLIMS");
  await expect(chart(page)).toHaveAccessibleDescription(/Each point is one practical/);
  const legend = page.getByRole("list", { name: "Legend" });
  await expect(legend.getByRole("listitem")).toHaveText(["Year 1", "Year 2", "Year 3"]);
  // One point per practical: circles for years 1 and 3, hexagons for year 2.
  await expect(page.locator(".ts-chart__dot circle")).toHaveCount(9);
  await expect(page.locator(".ts-chart__hexagon path")).toHaveCount(5);
  await page.waitForTimeout(500);
  expect(hydration).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/light.png`, fullPage: true });
});

test("hovering a point shows its typed row in the tooltip and the focus status (#59)", async ({
  page,
}) => {
  await open(page);
  const row = practical("p04");
  // The chart's own hit layer sits above the painted point, so move the pointer to its centre.
  const point = await page.locator(`[data-ts-key$=":${row.id}"]`).boundingBox();
  if (!point) throw new Error(`point ${row.id} is not painted`);
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);

  const tip = tooltip(page);
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(row.title);
  await expect(tip).toContainText("35");
  await expect(tip).toContainText("7.1");
  await expect(tip).toContainText("38");
  await expect(tip).toContainText("Year 1");
  await expect(page.getByRole("status").filter({ hasText: "Focused:" })).toHaveText(
    "Focused: Protein assay on the Epoch 2, 35 submissions, average grade 7.1, class size 38, year 1.",
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tooltip.png`, fullPage: true });
});

test("keyboard focus on the chart moves between points and shows the same tooltip (#59)", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "View as table" }).focus();
  await page.keyboard.press("Tab");
  await expect(chart(page)).toBeFocused();
  await page.keyboard.press("ArrowRight");

  const status = page.getByRole("status").filter({ hasText: "Focused:" });
  await expect(status).toBeVisible();
  const text = (await status.textContent()) ?? "";
  const focused = DEMO_PRACTICALS.find((row) => text.startsWith(`Focused: ${row.title},`));
  expect(focused, text).toBeDefined();
  await expect(tooltip(page)).toContainText(focused?.title ?? "");

  await page.keyboard.press("ArrowRight");
  await expect(status).not.toHaveText(text);
});

test("View as table shows the same values as the chart (#59)", async ({ page }) => {
  await open(page);
  const toggle = page.getByRole("button", { name: "View as table" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  const table = page.getByRole("table", { name: /Fictional practicals/ });
  await expect(table).toBeVisible();
  await expect(chart(page)).toBeHidden();
  await expect(table.getByRole("columnheader")).toHaveText([
    "Practical",
    "Submissions",
    "Average grade",
    "Class size",
    "Academic year",
  ]);
  const rows = table.getByRole("row");
  await expect(rows).toHaveCount(DEMO_PRACTICALS.length + 1);
  for (const [index, row] of DEMO_PRACTICALS.entries()) {
    const line = rows.nth(index + 1);
    await expect(line.getByRole("rowheader")).toHaveText(row.title);
    await expect(line.getByRole("cell")).toHaveText([
      String(row.submissions),
      row.averageGrade.toFixed(1),
      String(row.classSize),
      `Year ${row.academicYear}`,
    ]);
  }
  await expectNoA11yViolations(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/table.png`, fullPage: true });

  await toggle.click();
  await expect(chart(page)).toBeVisible();
});

test("the chart page is axe-clean in light (#59)", async ({ page }) => {
  await open(page);
  await expectNoA11yViolations(page);
});

test("the chart reflows to 320 CSS pixels without horizontal scrolling (SC 1.4.10, #59)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);
  const box = await chart(page).boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(320);
});

test("the chart page is axe-clean in dark (#59)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await expectNoA11yViolations(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dark.png`, fullPage: true });
});

test("the chart page reads in Dutch with Dutch number formats and stays axe-clean (#59)", async ({
  page,
}) => {
  await open(page);
  const trigger = page.getByRole("button", { name: "Language: English" });
  await trigger.click();
  await page.getByRole("menuitemradio", { name: "Nederlands" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(
    page.getByRole("heading", { level: 1, name: dutch("dev_charts_title") }),
  ).toBeVisible();

  await page.getByRole("button", { name: dutch("chart_view_as_table") }).click();
  const row = page.getByRole("row").filter({ hasText: practical("p04").title });
  await expect(row.getByRole("cell").nth(1)).toHaveText("7,1");
  await expectNoA11yViolations(page);
});
