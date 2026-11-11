// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// `/dev/virtual-table` is a development-only route; the e2e build serves it because it runs
// with NODE_ENV=test (src/server/dev-tools.ts). Q-PERF-1, #76.
import { readFileSync } from "node:fs";
import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { expectHydrated, expectNoA11yViolations } from "./fixtures";
import { appUrl } from "./run-env";

const nl: Readonly<Record<string, string>> = JSON.parse(
  readFileSync(new URL("../../messages/nl.json", import.meta.url), "utf8"),
);

/** Rows in the demo plus its one header row: the table's `aria-rowcount`. */
const ROW_COUNT = 10_001;

/** Ceiling for rendered body rows: one window plus overscan, far below the 10,000 in the set. */
const MAX_DOM_ROWS = 40;

/** Collects hydration errors from the console, so a test can assert there were none. */
function watchHydration(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

async function setThemeCookie(context: BrowserContext, theme: "light" | "dark"): Promise<void> {
  await context.addCookies([{ name: "EDULIMS_THEME", value: theme, url: appUrl() }]);
}

/** Opens the demo and returns its table once the virtualizer positions the rows. */
async function openDemo(page: Page, name = "10,000 fictional measurements"): Promise<Locator> {
  await page.goto("/dev/virtual-table");
  const table = page.getByRole("table", { name: new RegExp(`^${name}`) });
  await expect(table).toBeVisible();
  await expectHydrated(table);
  // Body rows switch to absolute positioning once the virtualizer has mounted.
  await expect(bodyRows(table).first()).toHaveClass(/\babsolute\b/);
  return table;
}

function bodyRows(table: Locator): Locator {
  return table.locator("tbody > tr");
}

test("the server renders the first window and hydrates it without a mismatch", async ({
  page,
  request,
}) => {
  const html = await (await request.get("/dev/virtual-table")).text();
  expect(html).toContain("VD-00001");
  expect(html).not.toContain("VD-10000");

  const hydration = watchHydration(page);
  const table = await openDemo(page);
  await expect(page).toHaveTitle("Virtual table demo | eduLIMS");
  await expect(page.getByRole("heading", { level: 1, name: "Virtual table demo" })).toBeVisible();
  await expect(table).toHaveAttribute("aria-rowcount", String(ROW_COUNT));
  await expect(table.getByRole("row").first()).toHaveAttribute("aria-rowindex", "1");
  await expect(bodyRows(table).first()).toHaveAttribute("aria-rowindex", "2");
  await expect(table.getByRole("columnheader", { name: "Sample ID" })).toBeVisible();
  expect(hydration).toEqual([]);
});

test("scrolling through 10,000 rows keeps the DOM to one window", async ({ page }) => {
  const table = await openDemo(page);
  const rows = bodyRows(table);
  expect(await rows.count()).toBeLessThanOrEqual(MAX_DOM_ROWS);

  const viewport = table.locator("xpath=ancestor::section[1]");
  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    await viewport.evaluate((element, f) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * f;
    }, fraction);
    await expect(rows.first()).not.toHaveAttribute("aria-rowindex", "2");
    expect(await rows.count()).toBeLessThanOrEqual(MAX_DOM_ROWS);
  }
  const last = table.getByRole("row", { name: /VD-10000/ });
  await expect(last).toBeInViewport();
  await expect(last).toHaveAttribute("aria-rowindex", String(ROW_COUNT));
});

test("the header stays in place and lines up with the body columns", async ({ page }) => {
  const table = await openDemo(page);
  const header = table.getByRole("columnheader", { name: "Value" });
  const before = await header.boundingBox();
  await table
    .locator("xpath=ancestor::section[1]")
    .evaluate((element) => element.scrollBy(0, 5_000));
  await expect(bodyRows(table).first()).not.toHaveAttribute("aria-rowindex", "2");
  const after = await header.boundingBox();
  if (before === null || after === null) throw new Error("the Value header is not rendered");
  expect(after.y).toBeCloseTo(before.y, 0);

  const cell = await bodyRows(table).nth(3).getByRole("cell").nth(2).boundingBox();
  if (cell === null) throw new Error("the Value cell is not rendered");
  expect(cell.x).toBeCloseTo(after.x, 0);
  expect(cell.width).toBeCloseTo(after.width, 0);
});

test("the keyboard reaches the last row and back, keeping focus on a rendered row", async ({
  page,
}) => {
  const table = await openDemo(page);
  const rows = bodyRows(table);
  await rows.first().focus();
  const focused = table.locator("tbody > tr:focus");
  await expect(focused).toHaveAttribute("aria-rowindex", "2");

  await page.keyboard.press("ArrowDown");
  await expect(focused).toHaveAttribute("aria-rowindex", "3");
  await page.keyboard.press("PageDown");
  await expect(focused).not.toHaveAttribute("aria-rowindex", "3");

  await page.keyboard.press("End");
  await expect(focused).toHaveAttribute("aria-rowindex", String(ROW_COUNT));
  await expect(focused).toContainText("VD-10000");
  await expect(focused).toBeInViewport();
  expect(await rows.count()).toBeLessThanOrEqual(MAX_DOM_ROWS);

  await page.keyboard.press("ArrowUp");
  await expect(focused).toHaveAttribute("aria-rowindex", String(ROW_COUNT - 1));
  await page.keyboard.press("PageUp");
  await expect(focused).toBeInViewport();

  await page.keyboard.press("Home");
  await expect(focused).toHaveAttribute("aria-rowindex", "2");
  await expect(focused).toContainText("VD-00001");
  await expect(focused).toBeInViewport();

  // Tab leaves the table instead of walking 10,000 rows; Shift+Tab comes back to the row.
  await page.keyboard.press("Tab");
  await expect(table.locator("tbody > tr:focus")).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  await expect(focused).toHaveAttribute("aria-rowindex", "2");
});

test("sorts by a column from its header menu", async ({ page }) => {
  const table = await openDemo(page);
  const sample = table.getByRole("columnheader", { name: "Sample ID" });
  await expect(sample).not.toHaveAttribute("aria-sort");

  await sample.getByRole("button", { name: "Sample ID" }).click();
  await page
    .getByRole("menu", { name: "Sample ID" })
    .getByRole("menuitem", { name: "Descending" })
    .click();
  await expect(sample).toHaveAttribute("aria-sort", "descending");
  await expect(bodyRows(table).first()).toContainText("VD-10000");
  await expect(bodyRows(table).first()).toHaveAttribute("aria-rowindex", "2");

  const status = table.getByRole("columnheader", { name: "Status" });
  await status.getByRole("button", { name: "Status" }).click();
  await page
    .getByRole("menu", { name: "Status" })
    .getByRole("menuitem", { name: "Descending" })
    .click();
  await expect(status).toHaveAttribute("aria-sort", "descending");
  await expect(sample).not.toHaveAttribute("aria-sort");
  await expect(bodyRows(table).first()).toContainText("Out of range");
  expect(await bodyRows(table).count()).toBeLessThanOrEqual(MAX_DOM_ROWS);
});

test("has no WCAG A/AA violations in the light theme, also at the last row", async ({
  page,
  context,
}) => {
  await setThemeCookie(context, "light");
  const table = await openDemo(page);
  await expectNoA11yViolations(page);
  await bodyRows(table).first().focus();
  await page.keyboard.press("End");
  await expect(table.locator("tbody > tr:focus")).toHaveAttribute(
    "aria-rowindex",
    String(ROW_COUNT),
  );
  await expectNoA11yViolations(page);
});

test("has no WCAG A/AA violations in the dark theme", async ({ page, context }) => {
  await setThemeCookie(context, "dark");
  await openDemo(page);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expectNoA11yViolations(page);
});

test.describe("with a Dutch browser", () => {
  test.use({ locale: "nl-NL" });

  test("is translated and has no WCAG A/AA violations", async ({ page }) => {
    const hydration = watchHydration(page);
    const table = await openDemo(page, "10.000 fictieve metingen");
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    await expect(page).toHaveTitle(`${nl["dev_virtual_table_title"] ?? ""} | eduLIMS`);
    await expect(
      table.getByRole("columnheader", { name: nl["dev_virtual_table_col_sample"] ?? "" }),
    ).toBeVisible();
    await expect(table.getByText(nl["dev_virtual_in_range"] ?? "").first()).toBeVisible();
    await expectNoA11yViolations(page);
    expect(hydration).toEqual([]);
  });
});
