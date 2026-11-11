// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reusable data table on the Users screen (#58): column visibility, the row menu, bulk
// actions, optimistic updates and their rollback, keyboard-only use, Dutch and dark, 320 px.
import { expect, type Page, test } from "@playwright/test";
import {
  axe,
  dutch,
  failServerWrites,
  signedInElsewhere,
  signInAsAdmin,
  userRow,
  usersTable,
} from "./admin-users-helpers";
import { expectHydrated } from "./fixtures";
import { appUrl } from "./run-env";

const SEARCH = "Search by name or email address";

/** Opens the users list filtered by `text`, ready for clicks: the server HTML takes none. */
async function search(page: Page, text: string): Promise<void> {
  await page.goto(`/admin/users?q=${encodeURIComponent(text)}`);
  await expect(usersTable(page).locator("tbody tr").first()).toBeVisible();
  await expectHydrated(usersTable(page));
}

test("View hides and shows columns, and the choice survives a reload (#58)", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/users");
  const sessions = page.getByRole("columnheader", { name: /^Active sessions/ });
  await expect(sessions).toBeVisible();
  const view = page.getByRole("button", { name: "View", exact: true });
  await expectHydrated(view);
  await view.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemcheckbox", { name: "Active sessions" })).toBeChecked();
  await expect(menu.getByRole("menuitemcheckbox", { name: "Name" })).toHaveCount(0);
  await axe(page);
  await menu.getByRole("menuitemcheckbox", { name: "Active sessions" }).click();
  await expect(menu.getByRole("menuitemcheckbox", { name: "Active sessions" })).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(sessions).toHaveCount(0);

  // Hide from the column's own header menu as well.
  await page.getByRole("button", { name: "Sign-in methods", exact: true }).click();
  await page.getByRole("menuitem", { name: "Hide column" }).click();
  await expect(page.getByRole("columnheader", { name: /^Sign-in methods/ })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("columnheader", { name: /^Roles/ })).toBeVisible();
  await expect(sessions).toHaveCount(0);
  await expectHydrated(view);
  await view.click();
  await page.getByRole("menuitemcheckbox", { name: "Active sessions" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Sign-in methods" }).click();
  await page.keyboard.press("Escape");
  await expect(sessions).toBeVisible();
});

test("the row menu ends sessions optimistically and rolls back a failure (#58, #63)", async ({
  page,
  browser,
}) => {
  const elsewhere = [
    await signedInElsewhere(browser, "rollback@example.test"),
    await signedInElsewhere(browser, "rollback@example.test"),
  ];
  await signInAsAdmin(page);
  await search(page, "Rollback Test Teacher");
  const row = userRow(page, "Rollback Test Teacher");
  const sessionsCell = row.getByRole("cell").nth(6);
  await expect(sessionsCell).toHaveText("2");

  const menuButton = row.getByRole("button", { name: "Actions for Rollback Test Teacher" });
  await menuButton.click();
  await expect(page.getByRole("menuitem", { name: "View details" })).toBeVisible();
  await axe(page);
  await page.getByRole("menuitem", { name: "End all sessions" }).click();
  const confirm = page.getByRole("alertdialog", { name: "End all sessions" });
  await expect(confirm).toBeVisible();

  // A failing server: the count drops at once, then comes back with an error.
  const restore = await failServerWrites(page);
  await confirm.getByRole("button", { name: "End all sessions" }).click();
  await expect(menuButton).toBeFocused();
  await expect(page.getByText("The action failed. Try again.")).toBeVisible();
  await expect(sessionsCell).toHaveText("2");
  await restore();

  await menuButton.click();
  await page.getByRole("menuitem", { name: "End all sessions" }).click();
  await page
    .getByRole("alertdialog", { name: "End all sessions" })
    .getByRole("button", { name: "End all sessions" })
    .click();
  await expect(page.getByText("All sessions of Rollback Test Teacher have ended.")).toBeVisible();
  await expect(sessionsCell).toHaveText("0");
  for (const other of elsewhere) {
    await other.reload();
    await expect(other).toHaveURL(/\/login/);
    await other.context().close();
  }
});

test("a role change rolls back when the server fails, and shows why at the field (#63)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await search(page, "Rollback Test Teacher");
  const row = userRow(page, "Rollback Test Teacher");
  await row.getByRole("button", { name: "Actions for Rollback Test Teacher" }).click();
  await page.getByRole("menuitem", { name: "View details" }).click();
  const sheet = page.getByRole("dialog", { name: "Rollback Test Teacher" });
  const roles = sheet.getByRole("region", { name: "Roles" });
  const editor = roles.getByRole("group", { name: "Change roles" });
  await editor.getByLabel("Administrator").check();
  await roles.getByRole("button", { name: "Save roles" }).click();

  const restore = await failServerWrites(page);
  await page
    .getByRole("alertdialog", { name: "Change the roles of Rollback Test Teacher?" })
    .getByRole("button", { name: "Save roles" })
    .click();
  // The refusal shows twice: in the toast and at the field.
  await expect(page.getByText("The action failed. Try again.")).toHaveCount(2);
  await expect(roles.getByText("The action failed. Try again.")).toBeVisible();
  await expect(roles.getByRole("list").getByText("Administrator")).toHaveCount(0);
  await expect(roles.getByRole("list").getByText("Teacher")).toBeVisible();
  await restore();
});

test("bulk actions end sessions and block the selected users, never the administrator (#58)", async ({
  page,
  browser,
}) => {
  const elsewhere = await signedInElsewhere(browser, "bulk-one@example.test");
  await signInAsAdmin(page);

  // The administrator's own row has no checkbox and no block in its menu.
  await search(page, "Test Administrator");
  const self = userRow(page, "Test Administrator");
  await expect(self.getByRole("checkbox")).toHaveCount(0);
  await self.getByRole("button", { name: "Actions for Test Administrator" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["View details"]);
  await page.keyboard.press("Escape");

  await search(page, "Bulk Test Student");
  await expect(usersTable(page).locator("tbody tr")).toHaveCount(2);
  await page.getByRole("checkbox", { name: "Select all rows on this page" }).check();
  await expect(page.getByRole("checkbox", { name: "Select Bulk Test Student One" })).toBeChecked();
  const bar = page.getByRole("region", { name: "Actions for the selected rows" });
  await expect(bar).toContainText("Selected: 2");
  await axe(page);

  await bar.getByRole("button", { name: "End sessions" }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "End all sessions of the selected users?",
  });
  await expect(confirm).toContainText("Selected: 2.");
  await axe(page);
  await confirm.getByRole("button", { name: "End all sessions" }).click();
  await expect(page.getByText("Sessions ended. Users: 2.")).toBeVisible();
  await expect(bar).toHaveCount(0);
  await elsewhere.reload();
  await expect(elsewhere).toHaveURL(/\/login/);
  await elsewhere.context().close();

  await page.getByRole("checkbox", { name: "Select Bulk Test Student One" }).check();
  await page.getByRole("checkbox", { name: "Select Bulk Test Student Two" }).check();
  await bar.getByRole("button", { name: "Block" }).click();
  const block = page.getByRole("alertdialog", { name: "Block the selected users?" });
  await block.getByLabel("Reason").fill("Exam fraud under investigation");
  await block.getByRole("button", { name: "Block", exact: true }).click();
  await expect(page.getByText("Users blocked: 2.")).toBeVisible();
  for (const name of ["Bulk Test Student One", "Bulk Test Student Two"]) {
    await expect(userRow(page, name)).toContainText("Blocked");
  }
});

test("the data table works with the keyboard alone (#58)", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/users");
  const searchbox = page.getByRole("searchbox", { name: SEARCH });
  await expectHydrated(searchbox);
  await searchbox.focus();
  await page.keyboard.type("Test");
  await expect(page).toHaveURL(/q=Test/);

  // A facet: open with Enter, move with the arrows, choose with Enter, close with Escape.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Role", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "Role" })).toBeVisible();
  await page.keyboard.type("Teach");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/role=%5B%22teacher%22%5D/);
  await expect(page.getByRole("button", { name: /^Role 1 selected: Teacher$/ })).toBeFocused();

  // Sort from the header menu.
  const header = page.getByRole("button", { name: "Last sign-in", exact: true });
  await header.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Descending" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/sort=lastSignIn/);
  await expect(page).toHaveURL(/dir=desc/);
  // The URL changes before the router commits the new search; until then the table still
  // shows the old sort, and a selection made there is dropped when the sorted list arrives.
  await expect(page.getByRole("columnheader", { name: "Last sign-in" })).toHaveAttribute(
    "aria-sort",
    "descending",
  );

  // Select a row with Space, clear the selection, then Reset.
  const checkbox = page.getByRole("checkbox", { name: "Select Test Teacher", exact: true });
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await page.getByRole("button", { name: "Clear selection" }).focus();
  await page.keyboard.press("Enter");
  await expect(checkbox).not.toBeChecked();
  await page.getByRole("button", { name: "Reset search and filters" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/role=/);
});

test.describe("in the dark theme and in Dutch", () => {
  test("the toolbar, a facet, the row menu and the bulk bar are translated and axe-clean", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);
    await context.addCookies([
      { name: "EDULIMS_THEME", value: "dark", url: appUrl() },
      { name: "EDULIMS_LOCALE", value: "nl", url: appUrl() },
    ]);
    await page.goto("/admin/users?q=Test%20Teacher");
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    await expect(page.getByRole("button", { name: dutch("data_table_view") })).toBeVisible();
    const statusFacet = page
      .getByRole("search")
      .getByRole("button", { name: dutch("admin_users_filter_status"), exact: true });
    await expectHydrated(statusFacet);
    await statusFacet.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await axe(page);
    await page.keyboard.press("Escape");

    await page.getByRole("checkbox", { name: "Test Teacher selecteren", exact: true }).check();
    await expect(
      page.getByRole("region", { name: dutch("data_table_bulk_actions") }),
    ).toBeVisible();
    await axe(page);
    await page.getByRole("button", { name: "Acties voor Test Teacher", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: dutch("admin_users_view_details") }),
    ).toBeVisible();
    await axe(page);
  });
});

test.describe("at 320 CSS px wide (WCAG 1.4.10)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the toolbar wraps and the table scrolls inside its own region", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/users");
    await expect(page.getByRole("searchbox", { name: SEARCH })).toBeVisible();
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(320);
    const region = page.getByRole("region", { name: /^Users, sorted by/ });
    const overflow = await region.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(true);
    await page.getByRole("search").getByRole("button", { name: "Status", exact: true }).click();
    await expect(page.getByRole("listbox", { name: "Status" })).toBeVisible();
    await axe(page);
  });
});
