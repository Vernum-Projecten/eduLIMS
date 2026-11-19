// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The administrator's read-only list of simulations (B5, #291): the overview tile, the search
// and the pages on the server, the detail page with its teachers and labs, the marker of a
// simulation without an active teacher, a teacher refused, axe in light, dark and Dutch, and
// reflow at 320 px.
import { randomBytes } from "node:crypto";
import { type BrowserContext, expect, type Page, type Route, test } from "@playwright/test";
import { type SeededSimulations, seedAdminSimulations } from "./admin-simulations-seed";
import { axe, dutch, signInAsAdmin } from "./admin-users-helpers";
import { devLogin, expectHydrated, pressUntilFocused } from "./fixtures";
import { appUrl } from "./run-env";

let seeded: SeededSimulations;

test.beforeAll(async () => {
  seeded = await seedAdminSimulations(randomBytes(4).toString("hex"));
});

function list(page: Page) {
  return page.getByRole("table", { name: /^Simulations, newest first/ });
}

function rowOf(page: Page, name: string) {
  return list(page)
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name, exact: true }) });
}

async function searchFor(page: Page, text: string): Promise<void> {
  const search = page.getByRole("searchbox", { name: "Search simulations by name" });
  await expectHydrated(search);
  await search.fill(text);
  await search.press("Enter");
  await expect(page).toHaveURL(/[?&]q=/);
}

test("an administrator finds a simulation from the overview tile, by name and by page (B5)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  const tile = page.getByRole("link", { name: "All simulations" });
  await expectHydrated(tile);
  await tile.click();
  await expect(page).toHaveURL(/\/admin\/simulations$/);
  await expect(page.getByRole("heading", { level: 1, name: "Simulations" })).toBeVisible();
  await expect(page).toHaveTitle("Simulations | Admin portal | eduLIMS");
  await axe(page);

  await searchFor(page, seeded.paged);
  await expect(page.getByRole("status").filter({ hasText: "Simulations found: 12." })).toHaveCount(
    1,
  );
  // Newest first: number 12 opens the first page of 25, number 01 closes it.
  const names = list(page).getByRole("link");
  await expect(names).toHaveCount(12);
  await expect(names.first()).toHaveText(`${seeded.paged} 12`);
  await expect(names.last()).toHaveText(`${seeded.paged} 01`);

  // Ten a page: the second page holds the two oldest.
  await page.goto(`/admin/simulations?q=${encodeURIComponent(seeded.paged)}&size=10`);
  await expect(list(page).getByRole("link")).toHaveCount(10);
  const next = page.getByRole("button", { name: "Next page" });
  await expectHydrated(next);
  await next.click();
  await expect(page).toHaveURL(/page=2/);
  await expect(list(page).getByRole("link")).toHaveCount(2);
  await expect(list(page).getByRole("link").first()).toHaveText(`${seeded.paged} 02`);
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();

  // The paged simulations have an active teacher: no marker.
  await expect(list(page).getByText("No active teacher")).toHaveCount(0);

  // A search that matches nothing says so.
  await searchFor(page, `${seeded.paged} none`);
  await expect(page.getByRole("heading", { name: "No simulations match" })).toBeVisible();
});

test("the detail page shows the teachers and the labs with their students, read-only (B5)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/simulations?q=${encodeURIComponent(seeded.withLab)}`);
  const row = rowOf(page, seeded.withLab);
  await expect(row).toContainText("Test Teacher");
  await expect(row.getByRole("cell").nth(2)).toHaveText("1");
  await expect(row.getByRole("cell").nth(3)).toHaveText("2");

  const link = row.getByRole("link", { name: seeded.withLab, exact: true });
  await expectHydrated(link);
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: seeded.withLab })).toBeVisible();
  await expect(page).toHaveTitle(`${seeded.withLab} | Simulations | Admin portal | eduLIMS`);
  await expect(page.getByRole("list", { name: `Teachers of ${seeded.withLab}` })).toHaveText(
    "Test Teacher",
  );
  const labs = page.getByRole("table", { name: `Labs of ${seeded.withLab}` });
  await expect(labs.getByRole("row").filter({ hasText: seeded.lab })).toContainText("2");
  // No action anywhere, and nothing of a student or an address.
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText("E2E member");
  await expect(page.getByRole("main")).not.toContainText("@");
  await expect(page.getByText("No active teacher")).toHaveCount(0);
  await axe(page);

  await page.getByRole("link", { name: "Back to simulations" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Simulations" })).toBeVisible();
});

test("a simulation without an active teacher carries the marker in the list and the detail (#291)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/simulations?q=${encodeURIComponent(seeded.orphan)}`);
  const row = rowOf(page, seeded.orphan);
  await expect(row).toContainText("No active teacher");
  await expect(row).toContainText(seeded.formerTeacher);
  const link = row.getByRole("link", { name: seeded.orphan, exact: true });
  await expectHydrated(link);
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: seeded.orphan })).toBeVisible();
  const alert = page.getByRole("alert").filter({ hasText: "No active teacher" });
  await expect(alert).toContainText("at the identity provider or in Users and roles");
  await axe(page);
  await alert.getByRole("link", { name: "Open Users and roles" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Users and roles" })).toBeVisible();
});

test("the keyboard alone searches, opens a simulation and comes back (B5, WCAG 2.1.1)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/admin/simulations");
  const search = page.getByRole("searchbox", { name: "Search simulations by name" });
  await expectHydrated(search);
  await search.focus();
  await page.keyboard.type(seeded.orphan);
  await page.keyboard.press("Enter");
  const link = rowOf(page, seeded.orphan).getByRole("link", { name: seeded.orphan, exact: true });
  await expect(link).toBeVisible();
  await pressUntilFocused(page, "Tab", link, 6);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: seeded.orphan })).toBeVisible();
  const back = page.getByRole("link", { name: "Back to simulations" });
  await expectHydrated(back);
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Simulations" })).toBeVisible();
});

test("a failing list read shows the error state and its retry recovers (B5)", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/simulations");
  const pattern = "**/_serverFn/**";
  const handler = (route: Route) =>
    route.request().method() === "GET" &&
    decodeURIComponent(route.request().url()).includes("no-such-simulation")
      ? route.fulfill({ status: 500, body: "forced failure" })
      : route.fallback();
  await page.route(pattern, handler);
  await searchFor(page, "no-such-simulation");
  const heading = page.getByRole("heading", { level: 1, name: "Something went wrong" });
  await expect(heading).toBeVisible();
  await page.unroute(pattern, handler);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No simulations match" })).toBeVisible();
});

test("an unknown simulation shows Not found (B5)", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/simulations/01960000-0000-7000-8000-000000000001");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to simulations" })).toBeVisible();
});

test("a teacher and a student cannot open the administrator's simulations (B5, A01)", async ({
  browser,
}) => {
  for (const email of ["teacher@example.test", "student@example.test"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await devLogin(page, email);
    await expect(page).not.toHaveURL(/\/login/);
    for (const path of ["/admin/simulations", `/admin/simulations?q=${seeded.orphan}`]) {
      await page.goto(path);
      await expect(page).not.toHaveURL(/\/admin/);
      await expect(page.getByText(seeded.orphan)).toHaveCount(0);
    }
    await context.close();
  }
});

async function usePreferences(
  context: BrowserContext,
  theme: "light" | "dark",
  locale: "en" | "nl",
): Promise<void> {
  await context.addCookies([
    { name: "EDULIMS_THEME", value: theme, url: appUrl() },
    { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
  ]);
}

for (const [theme, locale] of [
  ["light", "en"],
  ["dark", "en"],
  ["light", "nl"],
  ["dark", "nl"],
] as const) {
  test(`the list and the detail are axe-clean in ${theme}, ${locale} (B5, Q-ACC-1)`, async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);
    await usePreferences(context, theme, locale);
    const t = (key: string, english: string) => (locale === "nl" ? dutch(key) : english);
    await page.goto(`/admin/simulations?q=${encodeURIComponent(seeded.orphan)}`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      page.getByRole("heading", { level: 1, name: t("nav_simulations", "Simulations") }),
    ).toBeVisible();
    const marker = page
      .getByRole("table")
      .getByText(t("admin_simulations_no_active_teacher", "No active teacher"));
    await expect(marker).toBeVisible();
    await axe(page);
    await page.getByRole("link", { name: seeded.orphan, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: seeded.orphan })).toBeVisible();
    await axe(page);
  });
}

test("the list and the detail reflow at 320 px without horizontal scrolling (WCAG 1.4.10)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.setViewportSize({ width: 320, height: 800 });
  for (const [path, heading] of [
    [`/admin/simulations?q=${encodeURIComponent(seeded.paged)}`, "Simulations"],
    ["/admin", "Admin portal"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, heading).toBeLessThanOrEqual(0);
  }
  await page.goto(`/admin/simulations?q=${encodeURIComponent(seeded.orphan)}`);
  const link = page.getByRole("link", { name: seeded.orphan, exact: true });
  await expectHydrated(link);
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: seeded.orphan })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "detail").toBeLessThanOrEqual(0);
});
