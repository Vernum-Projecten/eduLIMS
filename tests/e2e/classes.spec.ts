// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Classes, invitations and lab groups (#28): create a class, invite by paste and by CSV with a
// preview, join on sign-in, lab groups by keyboard, archive and copy, and the axe scan in the
// light and dark theme and in Dutch. One journey: each step builds on the class the last made.
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated, expectNoA11yViolations } from "./fixtures";
import { appUrl } from "./run-env";

test.describe.configure({ mode: "serial" });

/** Where the journey saves screenshots of the class page, when the caller asks for them. */
const SHOTS = process.env["E2E_SHOTS_DIR"]?.trim();

const OWNER = "classes-owner@example.test";
const JOINER = "classes-join@example.test";
const CLASS = `LS-${Date.now().toString(36).slice(-5).toUpperCase()}`;

/** The class name as a screen reader reads it: the name, then ", academic year" and the year. */
function yearName(year: string): string {
  return `${CLASS}, academic year ${year}`;
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
}

async function axe(page: Page): Promise<void> {
  await settle(page);
  await expectNoA11yViolations(page);
}

async function preferences(context: BrowserContext, theme: "light" | "dark", locale: "en" | "nl") {
  await context.addCookies([
    { name: "EDULIMS_THEME", value: theme, url: appUrl() },
    { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
  ]);
}

async function signInAsOwner(page: Page): Promise<void> {
  await devLogin(page, OWNER);
  await expect(page).toHaveURL(/\/teacher$/);
}

/** Opens the class page of the journey's class from the class list. */
async function openClass(page: Page): Promise<void> {
  await page.goto("/teacher/classes");
  await page
    .getByRole("link", { name: new RegExp(`^${CLASS}`) })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(CLASS) })).toBeVisible();
  await expectHydrated(page.getByRole("tablist"));
}

test("a teacher creates a class and lands on its page (#28)", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/teacher/classes");
  await expect(page.getByRole("heading", { level: 1, name: "Classes" })).toBeVisible();
  await axe(page);
  const create = page.getByRole("button", { name: "New class" });
  await expectHydrated(create);
  await create.click();
  const dialog = page.getByRole("dialog", { name: "New class" });
  await dialog.getByRole("button", { name: "Create class" }).click();
  await expect(dialog.getByText("Enter a class name.")).toBeVisible();
  await dialog.getByLabel("Class name").fill(CLASS);
  await dialog.getByLabel("Academic year").fill("2026-2028");
  await dialog.getByRole("button", { name: "Create class" }).click();
  await expect(dialog.getByText("Enter two consecutive years, such as 2026-2027.")).toBeVisible();
  await dialog.getByLabel("Academic year").fill("2026-2027");
  await dialog.getByRole("button", { name: "Create class" }).click();
  await expect(page).toHaveURL(/\/teacher\/classes\/[0-9a-f-]{36}$/);
  // The name with the academic year, read as one name (owner decision on #28).
  await expect(
    page.getByRole("heading", { level: 1, name: yearName("2026–2027"), exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Members (1)" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await axe(page);
});

test("a teacher invites by paste and by CSV, after a preview (#28)", async ({ page }) => {
  await signInAsOwner(page);
  await openClass(page);
  await page.getByRole("tab", { name: /^Invitations/ }).click();
  const form = page.getByRole("form", { name: "Invite people" });
  const emails = form.getByLabel("Email addresses");
  await emails.fill(`${JOINER}, not-an-address, ${JOINER}, classes-ada@example.test`);
  await emails.press("Enter");
  await form.getByLabel("Or read addresses from a CSV file").setInputFiles({
    name: "students.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("classes-bo@example.test\nnot-valid@\n"),
  });
  await expect(page.getByText("2 addresses added from the file.")).toBeVisible();
  await form.getByRole("button", { name: "Check list" }).click();
  const preview = form.getByRole("region", { name: "Check before inviting" });
  await expect(preview.getByRole("status")).toHaveText("3 to invite, 2 left out.");
  await expect(preview.getByText("Not a valid email address")).toHaveCount(2);
  await axe(page);
  await form.getByRole("button", { name: "Invite 3" }).click();
  await expect(page.getByText("3 invitations created.")).toBeVisible();
  const pending = page.getByRole("table", { name: "Pending invitations" });
  await expect(pending.getByRole("row")).toHaveCount(4);
  await expect(pending.getByRole("cell", { name: JOINER, exact: true })).toBeVisible();
  await axe(page);
});

test("a student joins every inviting class on sign-in, without an accept step (#28)", async ({
  page,
  context,
}) => {
  for (const email of [JOINER, "classes-ada@example.test"]) {
    await context.clearCookies();
    await devLogin(page, email);
    await expect(page).toHaveURL(/\/student$/);
    const classes = page.getByRole("region", { name: "Your classes" });
    await expect(classes.getByText(yearName("2026–2027"), { exact: true })).toBeAttached();
  }
  await axe(page);
});

test("lab groups are created and filled with the keyboard (#28)", async ({ page }) => {
  await signInAsOwner(page);
  await openClass(page);
  await expect(page.getByRole("tab", { name: "Members (3)" })).toBeVisible();
  const groupsTab = page.getByRole("tab", { name: "Lab groups" });
  await groupsTab.focus();
  await page.keyboard.press("Enter");
  await expect(groupsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "No lab groups yet" })).toBeVisible();

  const create = page.getByRole("button", { name: "Create groups" });
  await create.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Create groups" });
  await expect(dialog.getByLabel("Group set")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Pairs");
  await page.keyboard.press("Enter");
  await expect(page.getByText("2 groups created.")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Groups in Pairs" })).toBeVisible();

  const picker = page.getByRole("combobox", { name: "Group of Ada Classes Test" });
  await picker.focus();
  await picker.selectOption({ label: "Group 2" });
  await expect(page.getByText("The group is saved.")).toBeVisible();
  const group = page.getByRole("group", { name: "Group 2" });
  await expect(group.getByText("Ada Classes Test")).toBeVisible();
  await axe(page);
});

for (const theme of ["light", "dark"] as const) {
  test(`every tab of the class page is axe-clean in the ${theme} theme (#28)`, async ({
    page,
    context,
  }) => {
    await signInAsOwner(page);
    await preferences(context, theme, "en");
    await openClass(page);
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
    for (const [tab, name] of [
      [/^Members/, "members"],
      [/^Invitations/, "invitations"],
      [/^Lab groups/, "groups"],
    ] as const) {
      await page.getByRole("tab", { name: tab }).click();
      await axe(page);
      if (SHOTS)
        await page.screenshot({ path: `${SHOTS}/class-${name}-${theme}.png`, fullPage: true });
    }
  });
}

test("a failed read of the class page shows the error state and its retry (#28)", async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.goto("/teacher/classes");
  const link = page.getByRole("link", { name: new RegExp(`^${CLASS}`) }).first();
  await expectHydrated(link);
  const classId = (await link.getAttribute("href"))?.split("/").at(-1) ?? "";
  expect(classId).toMatch(/^[0-9a-f-]{36}$/);
  const pattern = "**/_serverFn/**";
  await page.route(pattern, (route) =>
    route.request().method() === "GET" &&
    decodeURIComponent(route.request().url()).includes(classId)
      ? route.fulfill({ status: 500, body: "forced failure" })
      : route.fallback(),
  );
  await link.click();
  const heading = page.getByRole("heading", { level: 1, name: "Something went wrong" });
  await expect(heading).toBeVisible();
  await axe(page);
  await page.unroute(pattern);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 1, name: yearName("2026–2027"), exact: true }),
  ).toBeVisible();
});

test("archiving makes the class read-only; a copy starts a new year (#28)", async ({ page }) => {
  await signInAsOwner(page);
  await openClass(page);
  await page.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive class" }).click();
  await expect(page.getByText(`${CLASS} is archived.`)).toBeVisible();
  await expect(page.getByText("This class is archived and read-only.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Archived");
  await page.getByRole("tab", { name: /^Invitations/ }).click();
  await expect(page.getByRole("form", { name: "Invite people" })).toHaveCount(0);

  await page.goto("/teacher/classes");
  await expect(page.getByRole("link", { name: new RegExp(`^${CLASS}`) })).toHaveCount(0);
  await page.getByRole("link", { name: "Archived", exact: true }).click();
  await page.getByRole("link", { name: new RegExp(`^${CLASS}`) }).click();
  await expectHydrated(page.getByRole("button", { name: "Copy to a new year" }));
  await page.getByRole("button", { name: "Copy to a new year" }).click();
  const dialog = page.getByRole("dialog", { name: "Copy to a new academic year" });
  await expect(dialog.getByLabel("Academic year")).toHaveValue("2027-2028");
  await dialog.getByRole("button", { name: "Copy class" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: yearName("2027–2028"), exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Members (1)" })).toBeVisible();
  await page.getByRole("tab", { name: "Lab groups" }).click();
  await expect(page.getByRole("heading", { name: "Groups in Pairs" })).toBeVisible();
  await axe(page);
});

test("the administrator sees every class, read-only (#28, R-01)", async ({ page }) => {
  await devLogin(page, "admin@example.test");
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/classes");
  const table = page.getByRole("table", {
    name: "All classes with their owner, co-teachers and counts",
  });
  await expect(table.getByRole("row", { name: new RegExp(`${CLASS}.*2026–2027`) })).toContainText(
    "Classes Test Owner",
  );
  await expect(table.getByRole("button")).toHaveCount(0);
  await axe(page);
});

for (const theme of ["light", "dark"] as const) {
  test(`the class page is axe-clean in the ${theme} theme and in Dutch (#28)`, async ({
    page,
    context,
  }) => {
    await signInAsOwner(page);
    await preferences(context, theme, "nl");
    await page.goto("/teacher/classes?archived=true");
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    await page.getByRole("link", { name: new RegExp(`^${CLASS}`) }).click();
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(CLASS) })).toContainText(
      dutch("classes_archived"),
    );
    for (const key of ["classes_tab_groups", "classes_tab_members"] as const) {
      await page
        .getByRole("tab", { name: new RegExp(`^${dutch(key).replace(" ({count})", "")}`) })
        .click();
      await axe(page);
    }
  });
}

test("the owner reopens an archived class; the top bar names it (#28)", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/teacher/classes?archived=true");
  await page.getByRole("link", { name: `${yearName("2026–2027")}, archived` }).click();
  const crumbs = page.getByRole("banner").getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "Classes" })).toBeVisible();
  await expect(crumbs).toContainText(`${CLASS} 2026–2027 (archived)`);
  const reopen = page.getByRole("button", { name: "Reopen" });
  await expectHydrated(reopen);
  await reopen.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reopen class" }).click();
  await expect(page.getByText(`${CLASS} is reopened.`)).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: yearName("2026–2027"), exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  await axe(page);
});
