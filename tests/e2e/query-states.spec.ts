// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer on screen (#62): the error state with its retry on each data route,
// the "Updating…" indicator of a background refetch, and the optimistic preference saves that
// roll back with a toast when the server fails.
import { expect, type Page, type Route, test } from "@playwright/test";
import { axe, failServerWrites, signInAsAdmin, usersTable } from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";

/** Where the journeys save their screenshots, when the caller asks for them. */
const SHOTS = process.env["E2E_SHOTS_DIR"]?.trim();

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Whether a server function read (a GET) carries `text` in its payload. */
function readWith(route: Route, text: string): boolean {
  const request = route.request();
  return request.method() === "GET" && decodeURIComponent(request.url()).includes(text);
}

/** Makes every server function read whose payload carries `text` fail with a 500. */
async function failReadsWith(page: Page, text: string): Promise<() => Promise<void>> {
  const pattern = "**/_serverFn/**";
  const handler = (route: Route) =>
    readWith(route, text)
      ? route.fulfill({ status: 500, body: "forced failure" })
      : route.fallback();
  await page.route(pattern, handler);
  return () => page.unroute(pattern, handler);
}

/** Types `text` into the users search, as a user would (a client-side navigation). */
async function searchUsers(page: Page, text: string): Promise<void> {
  const search = page.getByRole("searchbox", { name: "Search by name or email address" });
  await expectHydrated(search);
  await search.fill(text);
  await search.press("Enter");
}

test("the users list shows an error state and its retry loads the list again (#62)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/admin/users");
  await expect(usersTable(page)).toBeVisible();

  const restore = await failReadsWith(page, "Administrator");
  await searchUsers(page, "Administrator");
  const heading = page.getByRole("heading", { level: 1, name: "Something went wrong" });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("An unexpected error occurred.");
  // The app shell stays around the error, so the user can still navigate.
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await axe(page);
  await shot(page, "users-error-state");

  await restore();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading).toHaveCount(0);
  await expect(
    usersTable(page).getByRole("link", { name: "Test Administrator", exact: true }),
  ).toBeVisible();
});

/** Makes every server function read whose answer carries `text` fail with a 500. */
async function failReadsAnswering(page: Page, text: string): Promise<() => Promise<void>> {
  const pattern = "**/_serverFn/**";
  const handler = async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = await response.text();
    return body.includes(text)
      ? route.fulfill({ status: 500, body: "forced failure" })
      : route.fulfill({ response, body });
  };
  await page.route(pattern, handler);
  return () => page.unroute(pattern, handler);
}

for (const [name, from, link, answer, heading] of [
  ["overview", "/admin/users", "Overview", "activeSessions", "Latest activity"],
  ["system page", "/admin", "System", "provenance", "Version and build"],
] as const) {
  test(`the admin ${name} shows an error state and its retry recovers (#36)`, async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(from);
    const nav = page.getByRole("navigation", { name: "Main menu" });
    await expectHydrated(nav.getByRole("link", { name: link, exact: true }));
    const restore = await failReadsAnswering(page, answer);
    await nav.getByRole("link", { name: link, exact: true }).click();
    const error = page.getByRole("heading", { level: 1, name: "Something went wrong" });
    await expect(error).toBeVisible();
    await axe(page);

    await restore();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(error).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  });
}

test("the user sheet shows an error state with a retry (#62)", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/users?q=${encodeURIComponent("Rollback Test Teacher")}`);
  const link = usersTable(page).getByRole("link", { name: "Rollback Test Teacher" });
  await expectHydrated(link);
  const href = await link.getAttribute("href");
  const userId = href?.split("/").at(-1)?.split("?").at(0) ?? "";
  expect(userId).not.toBe("");

  const restore = await failReadsWith(page, userId);
  await link.click();
  const sheet = page.getByRole("dialog", { name: "Something went wrong" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("alert")).toContainText("An unexpected error occurred.");
  await axe(page);

  await restore();
  await sheet.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("dialog", { name: "Rollback Test Teacher" })).toBeVisible();
});

test("a background refetch shows Updating… over the table without moving it (#62)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/admin/users");
  const table = usersTable(page);
  await expect(table).toBeVisible();
  const before = await table.boundingBox();

  // Holds the next list read until the indicator has been checked.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pattern = "**/_serverFn/**";
  await page.route(pattern, async (route) => {
    if (readWith(route, "Teacher")) await held;
    await route.fallback();
  });

  await searchUsers(page, "Teacher");
  const updating = page.getByText("Updating…");
  await expect(updating).toBeVisible();
  await expect(table).toHaveAttribute("aria-busy", "true");
  expect(await table.boundingBox()).toEqual(before);
  await shot(page, "users-updating");

  release();
  await expect(updating).toBeHidden();
  await expect(table).not.toHaveAttribute("aria-busy", "true");
  await page.unroute(pattern);
});

test("the language menu shows the pick at once and rolls back with a toast when saving fails (#62)", async ({
  page,
}) => {
  await devLogin(page, "student@example.test");
  await expect(page.getByRole("heading", { level: 1, name: "Student portal" })).toBeVisible();

  // The save fails, but only once the optimistic state has been checked.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pattern = "**/_serverFn/**";
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await held;
    return route.fulfill({ status: 500, body: "forced failure" });
  });

  const trigger = page.getByRole("button", { name: "Language: English" });
  await expectHydrated(trigger);
  await trigger.click();
  await page.getByRole("menuitemradio", { name: "Nederlands" }).click();
  await expect(page.getByRole("button", { name: "Language: Nederlands" })).toBeDisabled();

  release();
  await expect(page.getByText("Your language could not be saved. Please try again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Language: English" })).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.unroute(pattern);
});

test("switching portals keeps the navigation and rolls back the saved portal when saving fails (#62)", async ({
  page,
}) => {
  await devLogin(page, "teacher-admin@example.test");
  await expect(page).toHaveURL(/\/teacher$/);
  const trigger = page.getByRole("button", { name: /^Teacher portal eduLIMS Switch portal/ });
  await expectHydrated(trigger);

  const restore = await failServerWrites(page);
  await trigger.click();
  await page.getByRole("menuitem", { name: /^Admin portal/ }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(
    page.getByText(
      "Your portal choice could not be saved. You will land on your usual portal next time.",
    ),
  ).toBeVisible();
  await restore();

  // The server kept the old landing portal.
  await page.goto("/");
  await expect(page).toHaveURL(/\/teacher$/);
});

test("/ and Mod+K focus the users search, but not in a text field or over a dialog (#62, #63)", async ({
  page,
  context,
}) => {
  // Windows, so Mod is Control whatever the host runs (the shortcuts journeys cover macOS).
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "Win32" });
    Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => undefined });
  });
  await signInAsAdmin(page);
  await page.goto(`/admin/users?q=${encodeURIComponent("Test Administrator")}`);
  const search = page.getByRole("searchbox", { name: "Search by name or email address" });
  const heading = page.getByRole("heading", { level: 1, name: "Users and roles" });
  await expectHydrated(search);
  await expect(search).toHaveAttribute("aria-keyshortcuts", "/ Control+K");

  await heading.click();
  await page.keyboard.press("Slash");
  await expect(search).toBeFocused();
  // The shortcut's own key never lands in the field.
  await expect(search).toHaveValue("Test Administrator");

  await heading.click();
  await expect(search).not.toBeFocused();
  await page.keyboard.press("Control+KeyK");
  await expect(search).toBeFocused();

  // Over an open dialog (the user sheet), neither key reaches the search behind it.
  await usersTable(page).getByRole("link", { name: "Test Administrator" }).click();
  const sheet = page.getByRole("dialog", { name: "Test Administrator" });
  await expect(sheet).toBeVisible();
  // The modal sheet hides the page from the accessibility tree, so find the field by type.
  const hiddenSearch = page.locator('input[type="search"]');
  const focusInSheet = () =>
    page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
  await page.keyboard.press("Slash");
  await expect(hiddenSearch).not.toBeFocused();
  await page.keyboard.press("Control+KeyK");
  await expect(hiddenSearch).not.toBeFocused();
  expect(await focusInSheet()).toBe(true);
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // In a text field, / is a character, not a shortcut.
  await search.fill("a");
  await page.keyboard.type("/b");
  await expect(search).toHaveValue("a/b");
});

test("the login page shows an error state and its retry loads the sign-in options again (#84)", async ({
  page,
}) => {
  await page.goto("/");
  const signIn = page.getByRole("main").getByRole("link", { name: "Sign in" });
  await expectHydrated(signIn);

  // Only the login options fail: theirs is the one payload that names the email routing.
  const pattern = "**/_serverFn/**";
  const handler = async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    if ((await response.text()).includes("emailRouting")) {
      return route.fulfill({ status: 500, body: "forced failure" });
    }
    return route.fulfill({ response });
  };
  await page.route(pattern, handler);
  await signIn.click();

  const heading = page.getByRole("heading", { level: 1, name: "Something went wrong" });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("An unexpected error occurred.");
  // The login frame stays around the error: the main landmark and the display menus.
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("button", { name: "Theme: System" })).toBeVisible();
  await axe(page);
  await shot(page, "login-error-state");

  await page.unroute(pattern, handler);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with a test account" })).toBeVisible();
});
