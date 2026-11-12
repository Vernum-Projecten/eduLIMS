// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Users and roles screen and the user detail sheet (#34, B1). The data table's own
// journeys (#58) are in admin-users-table.spec.ts.
import { expect, test } from "@playwright/test";
import {
  axe,
  dutch,
  openUser,
  signedInElsewhere,
  signInAsAdmin,
  usersTable,
} from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";
import { appUrl } from "./run-env";

const SEARCH = "Search by name or email address";

test("the users table searches while typing, filters, sorts and pages on the server (B1, #58)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  const started = Date.now();
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { level: 1, name: "Users and roles" })).toBeVisible();
  await expect(usersTable(page).getByRole("row").nth(1)).toBeVisible();
  // NOTE: Q-PERF-1, a page loads within 2 seconds; the DB test times 1,200 users.
  expect(Date.now() - started).toBeLessThan(2000);
  await expect(page).toHaveTitle("Users and roles | Admin portal | eduLIMS");
  for (const name of ["Name", "Roles", "Sign-in methods", "Status", "Last sign-in"]) {
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await expect(page.getByRole("columnheader", { name: /^Name/ })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await expect(page.getByText(/^Showing 1 to 25 of \d+ users$/)).toBeVisible();
  await axe(page);

  // Search while typing: no button, the URL follows after the debounce.
  await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveCount(0);
  // The server HTML takes input before hydration, and hydration then resets the field.
  const searchbox = page.getByRole("searchbox", { name: SEARCH });
  await expectHydrated(searchbox);
  await searchbox.fill("teacher-admin@example");
  await expect(page).toHaveURL(/q=teacher-admin%40example/);
  await expect(
    usersTable(page).getByRole("link", { name: "Test Coordinator", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Users found" })).toHaveText(
    "Users found: 1.",
  );

  // Reset clears the search and every facet.
  await page.getByRole("button", { name: "Reset search and filters" }).click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.getByRole("searchbox", { name: SEARCH })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Reset search and filters" })).toHaveCount(0);

  // A facet: multi-select with a count per value; the button shows the choice.
  await page.getByRole("search").getByRole("button", { name: "Status", exact: true }).click();
  const statusList = page.getByRole("listbox", { name: "Status" });
  await expect(statusList.getByRole("option", { name: /^Blocked \d+$/ })).toBeVisible();
  await axe(page);
  await statusList.getByRole("option", { name: /^Blocked/ }).click();
  await expect(statusList.getByRole("option", { name: /^Blocked/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/status=%5B%22blocked%22%5D/);
  await expect(page.getByRole("button", { name: /^Status 1 selected: Blocked$/ })).toBeVisible();
  const rows = usersTable(page).locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  // Retrying assertions: the previous page stays on screen while the next loads (keepPreviousData).
  await expect(rows.filter({ hasNotText: "Blocked" })).toHaveCount(0);

  // Two values of one facet are OR; facets combine with AND.
  await page
    .getByRole("search")
    .getByRole("button", { name: /^Status/ })
    .click();
  await page
    .getByRole("listbox", { name: "Status" })
    .getByRole("option", { name: /^Never signed in/ })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: /^Status 2 selected: Blocked Never signed in$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Role", exact: true }).click();
  await page
    .getByRole("listbox", { name: "Role" })
    .getByRole("option", { name: /^Administrator/ })
    .click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/role=%5B%22admin%22%5D/);
  await expect(rows.first()).toBeVisible();
  await expect(rows.filter({ hasNotText: /Blocked|Never signed in/ })).toHaveCount(0);
  await expect(rows.filter({ hasNotText: "Administrator" })).toHaveCount(0);
  await page.getByRole("searchbox", { name: SEARCH }).fill("nobody-matches-this");
  await expect(page.getByRole("heading", { level: 2, name: "No users match" })).toBeVisible();
  await axe(page);

  // An older single-value link still filters; sort through the header menu.
  await page.goto("/admin/users?provider=keycloak");
  const nameHeader = page.getByRole("button", { name: "Name", exact: true });
  await expectHydrated(nameHeader);
  await nameHeader.click();
  await page.getByRole("menuitem", { name: "Descending" }).click();
  await expect(page).toHaveURL(/dir=desc/);
  await expect(page.getByRole("columnheader", { name: /^Name/ })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await expect(rows.filter({ hasNotText: "Keycloak" })).toHaveCount(0);
  // The previous header menu animates out; open the next one once it is gone.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByRole("button", { name: "Last sign-in", exact: true }).click();
  await page.getByRole("menuitem", { name: "Ascending" }).click();
  await expect(page).toHaveURL(/sort=lastSignIn/);
  await expect(page.getByRole("columnheader", { name: /^Last sign-in/ })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await expect(page.getByRole("columnheader", { name: /^Name/ })).not.toHaveAttribute(
    "aria-sort",
    /./,
  );

  // Rows per page, then next, last, previous and first page; the page survives a reload.
  await page.goto("/admin/users");
  const pageSize = page.getByRole("combobox", { name: "Rows per page" });
  await expectHydrated(pageSize);
  await pageSize.click();
  await page.getByRole("option", { name: "10", exact: true }).click();
  await expect(page).toHaveURL(/size=10/);
  // The URL changes before the table applies the size; page on once it shows 10 rows.
  await expect(page.getByText(/^Showing 1 to 10 of \d+ users$/)).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/size=10/);
  await expect(page.getByText(/^Showing 11 to 20 of \d+ users$/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/^Showing 11 to 20 of \d+ users$/)).toBeVisible();
  const lastPage = page.getByRole("button", { name: "Last page" });
  await expectHydrated(lastPage);
  await lastPage.click();
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await expect(page.getByText(/^Page (\d+) of \1$/)).toBeVisible();
  await page.getByRole("button", { name: "First page" }).click();
  await expect(page.getByText(/^Showing 1 to 10 of \d+ users$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
});

test("an administrator ends one session and all sessions of a user", async ({ page, browser }) => {
  const first = await signedInElsewhere(browser, "sessions@example.test");
  const second = await signedInElsewhere(browser, "sessions@example.test");
  await signInAsAdmin(page);
  const sheet = await openUser(page, "Sessions Test Teacher");
  await expect(page).toHaveURL(/\/admin\/users\/[^/?]+\?q=/);
  const sessions = sheet.getByRole("region", { name: "Active sessions" });
  await expect(sessions.getByRole("listitem")).toHaveCount(2);
  await axe(page);

  await sessions
    .getByRole("button", { name: /^End session/ })
    .first()
    .click();
  const confirm = page.getByRole("alertdialog", { name: "End this session?" });
  await expect(confirm).toBeVisible();
  await axe(page);
  await confirm.getByRole("button", { name: "End session" }).click();
  await expect(page.getByText("The session has ended.")).toBeVisible();
  await expect(sessions.getByRole("listitem")).toHaveCount(1);

  await sessions.getByRole("button", { name: "End all sessions" }).click();
  await page
    .getByRole("alertdialog", { name: "End all sessions" })
    .getByRole("button", { name: "End all sessions" })
    .click();
  await expect(page.getByText("All sessions of Sessions Test Teacher have ended.")).toBeVisible();
  await expect(sheet.getByText("No active sessions.")).toBeVisible();

  for (const other of [first, second]) {
    await other.reload();
    await expect(other).toHaveURL(/\/login/);
    await other.context().close();
  }
});

test("an administrator blocks a user with a reason and an end date, and unblocks them", async ({
  page,
  browser,
}) => {
  await signInAsAdmin(page);
  const sheet = await openUser(page, "Blocked Test Student");
  await sheet.getByRole("button", { name: "Block user" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Block Blocked Test Student?" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Block", exact: true }).click();
  await expect(dialog.getByText("Enter the reason for the block.")).toBeVisible();
  await expect(dialog.getByLabel("Reason")).toHaveAttribute("aria-invalid", "true");

  await dialog.getByLabel("Reason").fill("Account shared with another person");
  await dialog.getByLabel("Last day of the block").click();
  const calendar = page.getByRole("grid");
  await expect(calendar).toBeVisible();
  await axe(page);
  await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await calendar.getByRole("button", { name: /15/ }).first().click();
  await expect(dialog.getByLabel("Last day of the block")).not.toHaveText("No end date");
  await axe(page);
  await dialog.getByRole("button", { name: "Block", exact: true }).click();
  await expect(page.getByText("Blocked Test Student is blocked.")).toBeVisible();
  await expect(sheet.getByText(/^Blocked until /).first()).toBeVisible();
  await expect(sheet.getByText("Account shared with another person")).toBeVisible();

  const other = await (await browser.newContext()).newPage();
  await devLogin(other, "blocked@example.test");
  await expect(other.getByRole("alert")).toHaveText(
    "Your account is blocked. Contact an administrator.",
  );
  await expect(other).toHaveURL(/\/login/);

  await sheet.getByRole("button", { name: "Unblock" }).click();
  await page
    .getByRole("alertdialog", { name: "Unblock Blocked Test Student?" })
    .getByRole("button", { name: "Unblock" })
    .click();
  await expect(page.getByText("Blocked Test Student is unblocked.")).toBeVisible();
  await devLogin(other, "blocked@example.test");
  await expect(other).toHaveURL(/\/student$/);
  await other.context().close();
});

test("an administrator changes a local role set after confirming it (owner decision on #32)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  const sheet = await openUser(page, "Roles Test Teacher");
  const roles = sheet.getByRole("region", { name: "Roles" });
  await expect(roles.getByText("From eduLIMS")).toBeVisible();
  const editor = roles.getByRole("group", { name: "Change roles" });
  await expect(editor.getByLabel("Teacher")).toBeChecked();

  await editor.getByLabel("Student").check();
  await expect(editor.getByLabel("Teacher")).not.toBeChecked();
  await editor.getByLabel("Teacher").check();
  await expect(editor.getByLabel("Student")).not.toBeChecked();
  await editor.getByLabel("Administrator").check();
  await roles.getByRole("button", { name: "Save roles" }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "Change the roles of Roles Test Teacher?",
  });
  await expect(confirm).toContainText("Teacher · Administrator");
  await confirm.getByRole("button", { name: "Save roles" }).click();
  await expect(page.getByText("The roles of Roles Test Teacher are saved.")).toBeVisible();
  await expect(
    sheet.getByRole("region", { name: "Recent activity" }).getByText("Roles changed").first(),
  ).toBeVisible();
  await expect(roles.getByRole("list").getByText("Administrator")).toBeVisible();
});

test("roles from an identity provider and the administrator's own roles cannot be edited", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/admin/users?provider=keycloak");
  await usersTable(page).locator("tbody tr").first().getByRole("link").click();
  const sheet = page.getByRole("dialog");
  await expect(
    sheet.getByText(/manages these roles and sets them again at every sign-in/),
  ).toBeVisible();
  await expect(sheet.getByRole("group", { name: "Change roles" })).toHaveCount(0);
  await expect(sheet.getByText(/^From Keycloak( \(SAML\))?$/)).toBeVisible();

  const own = await openUser(page, "Test Administrator");
  await expect(
    own.getByText("You cannot change your own roles. Ask another administrator."),
  ).toBeVisible();
  await expect(own.getByRole("group", { name: "Change roles" })).toHaveCount(0);
  await expect(own.getByText("You cannot block your own account.")).toBeVisible();
  await expect(own.getByRole("button", { name: "Block user" })).toHaveCount(0);
  await expect(own.getByText("This session")).toBeVisible();
  await axe(page);
});

test("the user sheet is deep-linkable and works with the keyboard alone", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/users");
  const search = page.getByLabel("Search by name or email address");
  await expectHydrated(search);
  await search.focus();
  await page.keyboard.type("Test Teacher");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/q=Test/);
  const link = usersTable(page).getByRole("link", { name: "Test Teacher", exact: true });
  await link.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Test Teacher" });
  await expect(sheet).toBeVisible();
  await expect(page).toHaveTitle("Test Teacher | Users and roles | Admin portal | eduLIMS");
  const url = page.url();

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/admin\/users\?q=/);
  await expect(link).toBeFocused();

  await page.goto(url);
  await expect(page.getByRole("dialog", { name: "Test Teacher" })).toBeVisible();
  await page.goto("/admin/users/does-not-exist");
  await expect(page.getByRole("dialog", { name: "User not found" })).toBeVisible();
});

for (const email of ["student@example.test", "teacher@example.test"]) {
  test(`${email.split("@")[0]} cannot reach the users screen (A01)`, async ({ page }) => {
    await devLogin(page, email);
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto("/admin/users");
    await expect(page).not.toHaveURL(/\/admin/);
    await expect(page.getByRole("heading", { level: 1, name: "Users and roles" })).toHaveCount(0);
  });
}

test("the login page says how this browser signed in last time", async ({ page }) => {
  await devLogin(page, "teacher@example.test");
  await expect(page).toHaveURL(/\/teacher$/);
  await page.context().clearCookies({ name: /better-auth/ });
  await page.goto("/login");
  await expect(page.getByText("Last time you signed in with Test account.")).toBeVisible();
  await axe(page);
});

test.describe("in the dark theme and in Dutch", () => {
  test("the list, the sheet and the block dialog are translated and axe-clean", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);
    await context.addCookies([
      { name: "EDULIMS_THEME", value: "dark", url: appUrl() },
      { name: "EDULIMS_LOCALE", value: "nl", url: appUrl() },
    ]);
    await page.goto("/admin/users?q=Test%20Student");
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    await expect(page.getByRole("columnheader", { name: /^Naam/ })).toBeVisible();
    await axe(page);

    // Before hydration the link loads the sheet as a new document, whose buttons do nothing yet.
    const studentLink = usersTable(page).getByRole("link", { name: "Test Student", exact: true });
    await expectHydrated(studentLink);
    await studentLink.click();
    const sheet = page.getByRole("dialog", { name: "Test Student" });
    await expect(
      sheet.getByRole("heading", { name: dutch("admin_users_section_profile") }),
    ).toBeVisible();
    await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await axe(page);

    await sheet.getByRole("button", { name: dutch("admin_users_block") }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await axe(page);
  });
});

test.describe("at 320 CSS px wide (WCAG 1.4.10)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the users page and the sheet reflow without horizontal page scrolling", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(320);
    await usersTable(page).locator("tbody tr").first().getByRole("link").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    const sheetWidth = await sheet.evaluate((el) => el.scrollWidth);
    expect(sheetWidth).toBeLessThanOrEqual(320);
  });
});
