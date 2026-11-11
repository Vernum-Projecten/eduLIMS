// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The activity log screen (#36, B4): filtering on outcome, action, user and period, a shared
// URL that opens the same view, paging, the link to the user sheet, the error state and its
// retry, keyboard use, Dutch and dark, 320 px, and the refusal for a student and a teacher.
import { expect, type Page, type Route, test } from "@playwright/test";
import { axe, dutch, signInAsAdmin } from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";
import { appUrl } from "./run-env";

/** Where the journeys save their screenshots, when the caller asks for them. */
const SHOTS = process.env["E2E_SHOTS_DIR"]?.trim();

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const COLUMNS = { time: 0, action: 1, outcome: 2, actor: 3, target: 4, details: 5 } as const;

function toolbar(page: Page) {
  return page.getByRole("search");
}

function bodyRows(page: Page) {
  return page.getByRole("table").locator("tbody tr");
}

/** Returns the text of `column` in every body row. */
async function columnTexts(page: Page, column: keyof typeof COLUMNS): Promise<string[]> {
  return bodyRows(page)
    .locator(`td:nth-child(${COLUMNS[column] + 1})`)
    .allInnerTexts();
}

async function openLog(page: Page, query = ""): Promise<void> {
  await page.goto(`/admin/activity${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Activity log" })).toBeVisible();
  await expect(bodyRows(page).first()).toBeVisible();
  await expectHydrated(toolbar(page).getByRole("button").first());
}

/** Picks `option` in the facet `facet` of the toolbar. */
async function chooseFacet(page: Page, facet: string, option: RegExp): Promise<void> {
  await toolbar(page).getByRole("button", { name: facet, exact: true }).click();
  await page.getByRole("option", { name: option }).click();
  await page.keyboard.press("Escape");
}

test("the log opens newest first with every column, axe-clean (#36)", async ({ page }) => {
  await signInAsAdmin(page);
  await openLog(page);
  await expect(page).toHaveTitle("Activity log | Admin portal | eduLIMS");
  await expect(
    page.getByRole("region", { name: /^Activity log, newest first, page 1 of / }),
  ).toBeVisible();
  for (const name of ["Time", "Action", "Outcome", "By", "About", "Details"]) {
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  const times = await bodyRows(page)
    .locator("time")
    .evaluateAll((els) => els.map((el) => el.getAttribute("datetime") ?? ""));
  expect(times.length).toBe(25);
  expect([...times].sort().reverse()).toEqual(times);
  // Metadata reads as sentences, never as JSON.
  await expect(page.getByRole("table")).not.toContainText("{");
  await axe(page);
  await shot(page, "activity-light");
});

test("filters on outcome and action, and the URL carries the view (#36)", async ({ page }) => {
  await signInAsAdmin(page);
  await openLog(page);
  await chooseFacet(page, "Outcome", /^Refused/);
  await expect(page).toHaveURL(/outcome=%5B%22refused%22%5D/);
  await expect.poll(() => columnTexts(page, "outcome")).not.toContain("Succeeded");
  expect(new Set(await columnTexts(page, "outcome"))).toEqual(new Set(["Refused"]));

  await chooseFacet(page, "Action", /^Sign-in failed/);
  await expect(page).toHaveURL(/action=%5B%22authn_login_fail%22%5D/);
  await expect
    .poll(async () => new Set(await columnTexts(page, "action")))
    .toEqual(new Set(["Sign-in failed"]));
  await expect(page.getByRole("table")).toContainText("Reason: no eduLIMS role");

  // The facet keeps offering its other values, with counts from the server.
  await toolbar(page)
    .getByRole("button", { name: /^Outcome/ })
    .click();
  await expect(page.getByRole("option", { name: /^Failed \d+$/ })).toBeVisible();
  await axe(page);
  await page.keyboard.press("Escape");

  await toolbar(page).getByRole("button", { name: "Reset search and filters" }).click();
  await expect(page).not.toHaveURL(/outcome=|action=/);
});

test("a shared URL opens the same filtered page (#36)", async ({ page, browser }) => {
  await signInAsAdmin(page);
  await openLog(page, "?outcome=failure&outcome=refused&dir=asc&page=2&size=25");
  const first = await columnTexts(page, "time");
  const actions = await columnTexts(page, "action");
  const url = page.url();

  const context = await browser.newContext();
  const other = await context.newPage();
  await devLogin(other, "teacher-admin@example.test");
  await expect(other).not.toHaveURL(/\/login/);
  await other.goto(url);
  await expect(other.getByRole("heading", { level: 1, name: "Activity log" })).toBeVisible();
  await expect(other.getByRole("region", { name: /oldest first, page 2 of / })).toBeVisible();
  await expect.poll(() => columnTexts(other, "time")).toEqual(first);
  expect(await columnTexts(other, "action")).toEqual(actions);
  await expect(
    other.getByRole("search").getByRole("button", { name: /^Outcome.*2 selected/ }),
  ).toBeVisible();
  await context.close();
});

test("pages through the log and changes the page size (#36)", async ({ page }) => {
  await signInAsAdmin(page);
  await openLog(page);
  const pager = page.getByRole("navigation", { name: "Pages of the activity log" });
  await expect(pager).toContainText(/Showing 1 to 25 of [\d,]+ events/);
  const firstPage = await columnTexts(page, "time");
  await pager.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(pager).toContainText(/Showing 26 to 50 of/);
  await expect.poll(() => columnTexts(page, "time")).not.toEqual(firstPage);

  await pager.getByRole("combobox", { name: "Rows per page" }).click();
  await page.getByRole("option", { name: "50" }).click();
  await expect(page).toHaveURL(/size=50/);
  await expect(page).not.toHaveURL(/page=/);
  await expect(bodyRows(page)).toHaveCount(50);
  await pager.getByRole("button", { name: "Last page" }).click();
  await expect(page).toHaveURL(/page=\d+/);
  await expect(pager.getByRole("button", { name: "Next page" })).toBeDisabled();
});

test("filters on a user found by name and opens their user sheet (#36)", async ({ page }) => {
  await signInAsAdmin(page);
  await openLog(page);
  await toolbar(page).getByRole("button", { name: "By user", exact: true }).click();
  const searchBox = page.getByRole("combobox", { name: "By user" });
  await expect(page.getByRole("status").filter({ hasText: "Type part of a name" })).toBeVisible();
  await searchBox.fill("admin@example");
  const option = page.getByRole("option", { name: /Test Administrator/ });
  await expect(option).toBeVisible();
  await axe(page);
  await option.click();
  await expect(page).toHaveURL(/actor=/);
  await expect(
    toolbar(page).getByRole("button", { name: /^By user.*Test Administrator/ }),
  ).toBeVisible();
  await expect
    .poll(async () => new Set(await columnTexts(page, "actor")))
    .toEqual(new Set(["Test Administrator"]));

  // The period: one day picked in the calendar is that day alone.
  await toolbar(page).getByRole("button", { name: "Period", exact: true }).click();
  await page.getByRole("button", { name: /^Today, / }).click();
  await expect(page).toHaveURL(/from=(\d{4}-\d{2}-\d{2}).*to=\1/);
  await axe(page);
  await page.keyboard.press("Escape");
  await expect(bodyRows(page).first()).toContainText("Signed in");

  await bodyRows(page).first().getByRole("link", { name: "Test Administrator" }).first().click();
  await expect(page).toHaveURL(/\/admin\/users\/[^/?]+/);
  await expect(page.getByRole("dialog", { name: "Test Administrator" })).toBeVisible();
});

test("the user sheet links to that user's events (#36)", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/users?q=Test%20Administrator");
  await page.getByRole("table").getByRole("link", { name: "Test Administrator" }).click();
  const sheet = page.getByRole("dialog", { name: "Test Administrator" });
  await sheet.getByRole("link", { name: "Events by this user" }).click();
  await expect(page).toHaveURL(/\/admin\/activity\?actor=/);
  await expect
    .poll(async () => new Set(await columnTexts(page, "actor")))
    .toEqual(new Set(["Test Administrator"]));
});

test("the keyboard alone filters the log (WCAG 2.1.1)", async ({ page }) => {
  await signInAsAdmin(page);
  await openLog(page);
  const outcome = toolbar(page).getByRole("button", { name: "Outcome", exact: true });
  await outcome.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "Outcome" })).toBeVisible();
  await page.keyboard.type("Fail");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/outcome=%5B%22failure%22%5D/);
  await page.keyboard.press("Escape");
  await expect(toolbar(page).getByRole("button", { name: /^Outcome/ })).toBeFocused();
});

test("a failed read shows the error state and its retry loads the log (#62)", async ({ page }) => {
  await signInAsAdmin(page);
  await openLog(page);
  const pattern = "**/_serverFn/**";
  const fail = (route: Route) =>
    route.request().method() === "GET" &&
    decodeURIComponent(route.request().url()).includes("refused")
      ? route.fulfill({ status: 500, body: "forced failure" })
      : route.fallback();
  await page.route(pattern, fail);
  await chooseFacet(page, "Outcome", /^Refused/);
  await expect(page.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
  await axe(page);
  await page.unroute(pattern, fail);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Activity log" })).toBeVisible();
  await expect(bodyRows(page).first()).toContainText("Refused");
});

test("a filter that matches nothing shows the empty state with a way back (#36)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await openLog(page, "?action=class_archived");
  await expect(page.getByRole("heading", { level: 2, name: "No events match" })).toBeVisible();
  await axe(page);
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/admin\/activity$/);
  await expect(bodyRows(page)).toHaveCount(25);
});

test.describe("in the dark theme and in Dutch", () => {
  test("the log, a facet, the user search and the calendar are translated and axe-clean", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);
    await context.addCookies([{ name: "EDULIMS_THEME", value: "dark", url: appUrl() }]);
    await page.goto("/admin/activity");
    await expect(page.getByRole("heading", { level: 1, name: "Activity log" })).toBeVisible();
    await axe(page);
    await shot(page, "activity-dark");

    await context.addCookies([{ name: "EDULIMS_LOCALE", value: "nl", url: appUrl() }]);
    await page.goto("/admin/activity?outcome=refused");
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    await expect(
      page.getByRole("heading", { level: 1, name: dutch("nav_activity_log") }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toContainText(dutch("admin_activity_outcome_refused"));
    await axe(page);
    await shot(page, "activity-dark-nl");
    await expectHydrated(toolbar(page).getByRole("button").first());
    await toolbar(page)
      .getByRole("button", { name: dutch("admin_activity_filter_target"), exact: true })
      .click();
    await expect(page.getByText(dutch("admin_activity_user_search_hint"))).toBeVisible();
    await axe(page);
    await page.keyboard.press("Escape");
    await toolbar(page)
      .getByRole("button", { name: dutch("admin_activity_filter_period"), exact: true })
      .click();
    await expect(page.getByRole("button", { name: /^Vandaag, / })).toBeVisible();
    await axe(page);
  });
});

test.describe("at 320 CSS px wide (WCAG 1.4.10)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the toolbar wraps and the table scrolls inside its own region", async ({ page }) => {
    await signInAsAdmin(page);
    await openLog(page);
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(320);
    await toolbar(page).getByRole("button", { name: "Period", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Today, / })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await axe(page);
  });
});

for (const email of ["student@example.test", "teacher@example.test"]) {
  test(`${email} cannot open the activity log (A01)`, async ({ page }) => {
    await devLogin(page, email);
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto("/admin/activity");
    await expect(page).not.toHaveURL(/\/admin/);
    await expect(page.getByRole("heading", { level: 1, name: "Activity log" })).toHaveCount(0);
  });
}
