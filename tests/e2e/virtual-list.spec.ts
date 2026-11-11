// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// `/dev/virtual` is a development-only route; the e2e build serves it because it runs with
// NODE_ENV=test (src/server/dev-tools.ts).
import { readFileSync } from "node:fs";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations } from "./fixtures";
import { appUrl } from "./run-env";

const nl: Readonly<Record<string, string>> = JSON.parse(
  readFileSync(new URL("../../messages/nl.json", import.meta.url), "utf8"),
);

/** Ceiling for rendered rows: one window plus overscan, far below the 10,000 in the set (#64). */
const MAX_DOM_ROWS = 50;

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

async function openDemo(page: Page) {
  await page.goto("/dev/virtual");
  const list = page.getByRole("list", { name: "Fictional measurements" });
  await expect(list).toBeVisible();
  // Rows switch to absolute positioning once the virtualizer has mounted.
  await expect(list.getByRole("listitem").first()).toHaveClass(/\babsolute\b/);
  return list;
}

test("the server renders the first window and hydrates it without a mismatch", async ({
  page,
  request,
}) => {
  const html = await (await request.get("/dev/virtual")).text();
  expect(html).toContain("VD-00001");
  expect(html).not.toContain("VD-10000");

  const hydration = watchHydration(page);
  const list = await openDemo(page);
  await expect(page).toHaveTitle("Virtual list demo | eduLIMS");
  await expect(page.getByRole("heading", { level: 1, name: "Virtual list demo" })).toBeVisible();
  await expect(list.getByRole("listitem").first()).toHaveAttribute("aria-setsize", "10000");
  await expect(list.getByRole("listitem").first()).toHaveAttribute("aria-posinset", "1");
  expect(hydration).toEqual([]);
});

test("scrolling through 10,000 rows keeps the DOM to one window", async ({ page }) => {
  const list = await openDemo(page);
  const rows = list.getByRole("listitem");
  expect(await rows.count()).toBeLessThanOrEqual(MAX_DOM_ROWS);

  const viewport = list.locator("..");
  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    await viewport.evaluate((element, f) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * f;
    }, fraction);
    await expect(rows.first()).not.toHaveAttribute("aria-posinset", "1");
    expect(await rows.count()).toBeLessThanOrEqual(MAX_DOM_ROWS);
  }
  await expect(list.getByText("VD-10000")).toBeVisible();
});

test("the keyboard reaches the last row and back, keeping focus on a rendered row", async ({
  page,
}) => {
  const list = await openDemo(page);

  // The list is one tab stop: Tab from the intro lands on the first row.
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("Tab");
  const focused = list.locator("li:focus");
  await expect(focused).toHaveAttribute("aria-posinset", "1");

  await page.keyboard.press("ArrowDown");
  await expect(focused).toHaveAttribute("aria-posinset", "2");
  await page.keyboard.press("PageDown");
  await expect(focused).not.toHaveAttribute("aria-posinset", "2");

  await page.keyboard.press("End");
  await expect(focused).toHaveAttribute("aria-posinset", "10000");
  await expect(focused).toContainText("VD-10000");
  await expect(focused).toBeInViewport();
  expect(await list.getByRole("listitem").count()).toBeLessThanOrEqual(MAX_DOM_ROWS);

  await page.keyboard.press("ArrowUp");
  await expect(focused).toHaveAttribute("aria-posinset", "9999");
  await page.keyboard.press("PageUp");
  await expect(focused).toBeInViewport();

  await page.keyboard.press("Home");
  await expect(focused).toHaveAttribute("aria-posinset", "1");
  await expect(focused).toBeInViewport();

  // Tab leaves the list instead of walking 10,000 rows.
  await page.keyboard.press("Tab");
  await expect(list.locator("li:focus")).toHaveCount(0);
});

test("has no WCAG A/AA violations in the light theme, scrolled to the end", async ({
  page,
  context,
}) => {
  await setThemeCookie(context, "light");
  const list = await openDemo(page);
  await expectNoA11yViolations(page);
  await list.getByRole("listitem").first().focus();
  await page.keyboard.press("End");
  await expect(list.locator("li:focus")).toHaveAttribute("aria-posinset", "10000");
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
    await page.goto("/dev/virtual");
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    const list = page.getByRole("list", { name: nl["dev_virtual_list_label"] ?? "" });
    await expect(list).toBeVisible();
    await expect(page).toHaveTitle(`${nl["dev_virtual_title"] ?? ""} | eduLIMS`);
    await expect(list.getByText(nl["dev_virtual_in_range"] ?? "").first()).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
