// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The administrator's class management (#37, B2): create a class on a teacher's behalf, import
// students from a CSV list after a preview, transfer the ownership, archive and reopen with the
// keyboard, search and filter the list, and the axe scan in light, dark and Dutch and at 320 px.
// One journey: each step builds on the class the first made.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { ADMIN_CLASSES_FORMERS } from "../../src/server/demo-accounts.ts";
import { axe, dutch, openUser, signInAsAdmin } from "./admin-users-helpers";
import { devLogin, expectHydrated, pressUntilFocused } from "./fixtures";
import { appUrl } from "./run-env";

test.describe.configure({ mode: "serial" });

/** Where the journey saves screenshots of the class pages, when the caller asks for them. */
const SHOTS = process.env["E2E_SHOTS_DIR"]?.trim();

const OWNER = "Admin Classes Test Owner";
const HEIR = "Admin Classes Test Heir";
/** Tells this worker's classes from every other worker's, in this run and the ones before. */
const STAMP = Date.now().toString(36).slice(-5).toUpperCase();

// Each `--repeat-each` repeat gets its own class, academic year and former owner (#195): the
// year and owner filters count this repeat's class alone, and the orphan journey takes the
// teacher role from its account. Set before every test from the repeat's index.
let CLASS = "";
let YEAR = "";
let YEAR_LABEL = "";
let FORMER = "";

test.beforeEach(() => {
  const { repeatEachIndex } = test.info();
  if (repeatEachIndex >= ADMIN_CLASSES_FORMERS) {
    throw new Error(
      `--repeat-each runs at most ${ADMIN_CLASSES_FORMERS} repeats: src/server/demo-accounts.ts seeds one former owner per repeat`,
    );
  }
  const start = 2031 + repeatEachIndex;
  CLASS = `ADM-${STAMP}R${repeatEachIndex}`;
  YEAR = `${start}-${start + 1}`;
  YEAR_LABEL = `${start}–${start + 1}`;
  FORMER = `Admin Classes Test Former R${repeatEachIndex}`;
});

async function preferences(context: BrowserContext, theme: "light" | "dark", locale: "en" | "nl") {
  await context.addCookies([
    { name: "EDULIMS_THEME", value: theme, url: appUrl() },
    { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
  ]);
}

/** Opens the journey's class from the administrator's list through a search. */
async function openClass(page: Page): Promise<void> {
  await page.goto(`/admin/classes?q=${CLASS}`);
  await page.getByRole("link", { name: new RegExp(`^${CLASS}`) }).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(CLASS) })).toBeVisible();
  await expectHydrated(page.getByRole("form", { name: "Import students" }));
}

/** Picks the teacher `name` in the owner field labelled `label` by mouse, after a search. */
async function choose(dialog: Locator, label: string, name: string): Promise<void> {
  const page = dialog.page();
  await dialog.getByRole("button", { name: new RegExp(`^${label} `) }).click();
  await page.getByRole("combobox", { name: label, exact: true }).fill(name);
  await page.getByRole("option", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: new RegExp(`^${label} ${name}`) })).toBeVisible();
}

async function screenshot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

test("the administrator creates a class on a teacher's behalf (#37, B2)", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/classes");
  await expect(page.getByRole("heading", { level: 1, name: "Classes" })).toBeVisible();
  await axe(page);
  const create = page.getByRole("button", { name: "New class" });
  await expectHydrated(create);
  await create.click();
  const dialog = page.getByRole("dialog", { name: "New class" });
  await dialog.getByRole("button", { name: "Create class" }).click();
  await expect(dialog.getByText("Choose a teacher.")).toBeVisible();
  await dialog.getByLabel("Class name").fill(CLASS);
  await dialog.getByLabel("Academic year").fill(YEAR);
  await axe(page);
  await choose(dialog, "Owner", OWNER);
  await dialog.getByRole("button", { name: "Create class" }).click();
  await expect(page).toHaveURL(/\/admin\/classes\/[0-9a-f-]{36}$/);
  await expect(page.getByText(`${CLASS} is created.`)).toBeVisible();
  const members = page.getByRole("table", { name: "Teachers of the class" });
  await expect(members.getByRole("row")).toHaveCount(2);
  await expect(members.getByRole("row", { name: `${OWNER} Owner` })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Teachers (1)" })).toBeVisible();
  await axe(page);
});

test("the administrator imports students from CSV after a preview (#37, B2)", async ({ page }) => {
  await signInAsAdmin(page);
  await openClass(page);
  const form = page.getByRole("form", { name: "Import students" });
  const emails = form.getByLabel("Student email addresses");
  await emails.fill("adm-one@example.test, not-an-address");
  await emails.press("Enter");
  await form.getByLabel("Or read student addresses from a CSV file").setInputFiles({
    name: "class.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("adm-two@example.test\nadm-three@example.test\nadm-one@example.test\n"),
  });
  await expect(page.getByText("2 addresses added from the file.")).toBeVisible();
  await form.getByRole("button", { name: "Check list" }).click();
  const preview = form.getByRole("region", { name: "Check before inviting" });
  await expect(preview.getByRole("status")).toHaveText("3 to invite, 1 left out.");
  await expect(preview.getByText("Not a valid email address")).toHaveCount(1);
  await expect(
    page.getByRole("table", { name: "Pending invitations" }).getByRole("row"),
  ).toHaveCount(2);
  await axe(page);
  await form.getByRole("button", { name: "Import 3" }).click();
  await expect(page.getByText("3 invitations created.")).toBeVisible();
  const pending = page.getByRole("table", { name: "Pending invitations" });
  await expect(pending.getByRole("row")).toHaveCount(4);
  await expect(
    pending.getByRole("cell", { name: "adm-two@example.test", exact: true }),
  ).toBeVisible();
  // Nobody joins before their own sign-in (#28): the members stay the owner alone.
  await expect(page.getByRole("heading", { level: 2, name: "Teachers (1)" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Students (0)" })).toBeVisible();

  await emails.fill("adm-two@example.test");
  await emails.press("Enter");
  await form.getByRole("button", { name: "Check list" }).click();
  await expect(preview.getByText("Already invited")).toBeVisible();
  await axe(page);
});

test("the administrator transfers the ownership; the old owner stays a co-teacher (#37)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await openClass(page);
  await page.getByRole("button", { name: "Transfer ownership" }).click();
  const dialog = page.getByRole("alertdialog", { name: `Transfer the ownership of ${CLASS}?` });
  await expect(dialog).toContainText(`${OWNER} stays as a co-teacher`);
  await dialog.getByRole("button", { name: "Transfer ownership" }).click();
  await expect(dialog.getByText("Choose a teacher.")).toBeVisible();
  await axe(page);
  // The owner search by keyboard alone: open, type, Enter picks the first match (WCAG 2.1.1).
  const owner = dialog.getByRole("button", { name: /^New owner / });
  await owner.focus();
  await page.keyboard.press("Enter");
  const searchBox = page.getByRole("combobox", { name: "New owner", exact: true });
  await expect(searchBox).toBeFocused();
  await page.keyboard.type(HEIR);
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option", { name: new RegExp(`^${OWNER}`) })).toHaveCount(0);
  await axe(page);
  await page.keyboard.press("Enter");
  await expect(owner).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: new RegExp(`^New owner ${HEIR}`) }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Transfer ownership" }).click();
  await expect(page.getByText(`The ownership of ${CLASS} is transferred.`)).toBeVisible();
  const members = page.getByRole("table", { name: "Teachers of the class" });
  await expect(members.getByRole("row", { name: `${HEIR} Owner` })).toBeVisible();
  await expect(members.getByRole("row", { name: `${OWNER} Co-teacher` })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Teachers (2)" })).toBeVisible();
});

test("the administrator archives and reopens a class with the keyboard (#37)", async ({ page }) => {
  await signInAsAdmin(page);
  await openClass(page);
  const archive = page.getByRole("button", { name: "Archive", exact: true });
  await archive.focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog", { name: `Archive ${CLASS}?` });
  await expect(confirm).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(archive).toBeFocused();
  await page.keyboard.press("Enter");
  await pressUntilFocused(page, "Tab", confirm.getByRole("button", { name: "Archive class" }));
  await page.keyboard.press("Enter");
  await expect(page.getByText(`${CLASS} is archived.`)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(CLASS) })).toContainText(
    "Archived",
  );
  await expect(page.getByRole("form", { name: "Import students" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Transfer ownership" })).toHaveCount(0);
  await axe(page);

  const reopen = page.getByRole("button", { name: "Reopen", exact: true });
  await reopen.focus();
  await page.keyboard.press("Enter");
  const again = page.getByRole("alertdialog", { name: `Reopen ${CLASS}?` });
  await pressUntilFocused(page, "Tab", again.getByRole("button", { name: "Reopen class" }));
  await page.keyboard.press("Space");
  await expect(page.getByText(`${CLASS} is reopened.`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
});

test("the class list searches and filters on the server (#37)", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/classes");
  const search = page.getByRole("searchbox", { name: "Search by class or teacher name" });
  await expectHydrated(search);
  await search.fill(CLASS);
  await expect(page).toHaveURL(new RegExp(`q=${CLASS}`));
  const table = page.getByRole("table", { name: /^All classes with their owner/ });
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByRole("row", { name: new RegExp(CLASS) })).toContainText(HEIR);

  // The list shows active classes by default; choosing Archived and dropping Active leaves none.
  await expect(page.getByRole("button", { name: /^Status 1 selected: Active/ })).toBeVisible();
  await page.getByRole("button", { name: /^Status/ }).click();
  const statuses = page.getByRole("listbox", { name: "Status" });
  await statuses.getByRole("option", { name: /^Archived/ }).click();
  // Each choice is a navigation, and the next one toggles from the filter the page shows. The URL
  // changes before the page renders the new search, so wait for the checked option as well (#130).
  await expect(page).toHaveURL(/status=%5B%22active%22%2C%22archived%22%5D/);
  await expect(statuses.getByRole("option", { name: /^Archived/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await statuses.getByRole("option", { name: /^Active/ }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/status=%5B%22archived%22%5D/);
  await expect(page.getByRole("heading", { level: 2, name: "No classes match" })).toBeVisible();
  await axe(page);
  await page.getByRole("link", { name: "Clear search and filters" }).click();
  await expect(page).toHaveURL(/\/admin\/classes\/?$/);

  await page.getByRole("button", { name: "Academic year", exact: true }).click();
  await page
    .getByRole("listbox", { name: "Academic year" })
    .getByRole("option", { name: new RegExp(`^${YEAR_LABEL}`) })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: new RegExp(`^Academic year 1 selected: ${YEAR_LABEL}`) }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Owner", exact: true }).click();
  await page
    .getByRole("listbox", { name: "Owner" })
    .getByRole("option", { name: new RegExp(`^${HEIR}`) })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Owner 1 selected/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: new RegExp(`^Academic year 1 selected: ${YEAR_LABEL}`) }),
  ).toBeVisible();
  await expect(table.getByRole("row", { name: new RegExp(CLASS) })).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(2);
  await axe(page);
});

test("a class whose owner is no longer a teacher is flagged on the overview (#37)", async ({
  page,
}) => {
  const former = FORMER;
  const orphan = `ORF-${CLASS.slice(4)}`;
  await signInAsAdmin(page);
  await page.goto("/admin/classes");
  const create = page.getByRole("button", { name: "New class" });
  await expectHydrated(create);
  await create.click();
  const dialog = page.getByRole("dialog", { name: "New class" });
  await dialog.getByLabel("Class name").fill(orphan);
  await dialog.getByLabel("Academic year").fill(YEAR);
  await choose(dialog, "Owner", former);
  await dialog.getByRole("button", { name: "Create class" }).click();
  await expect(page).toHaveURL(/\/admin\/classes\/[0-9a-f-]{36}$/);

  // The owner loses the teacher role; eduLIMS does not move the class by itself.
  const sheet = await openUser(page, former);
  const roles = sheet.getByRole("region", { name: "Roles" });
  const editor = roles.getByRole("group", { name: "Change roles" });
  await editor.getByLabel("Administrator").check();
  await editor.getByLabel("Teacher").uncheck();
  await roles.getByRole("button", { name: "Save roles" }).click();
  await page
    .getByRole("alertdialog", { name: `Change the roles of ${former}?` })
    .getByRole("button", { name: "Save roles" })
    .click();
  await expect(page.getByText(`The roles of ${former} are saved.`)).toBeVisible();

  await page.goto("/admin");
  const signal = page.getByRole("link", { name: "Classes whose owner is not a teacher" });
  await expect(signal).toBeVisible();
  await axe(page);
  await signal.click();
  await expect(page).toHaveURL(/ownerNotTeacher=true/);
  const toggle = page.getByRole("button", { name: /^Owner is not a teacher/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const table = page.getByRole("table", { name: /^All classes with their owner/ });
  await expect(table.getByRole("row", { name: new RegExp(orphan) })).toContainText(former);
  await expect(table.getByRole("row", { name: new RegExp(`^${CLASS},`) })).toHaveCount(0);
  await axe(page);

  // An administrator moves the class to a teacher; it leaves the filtered list.
  await table.getByRole("link", { name: new RegExp(`^${orphan}`) }).click();
  await page.getByRole("button", { name: "Transfer ownership" }).click();
  const transfer = page.getByRole("alertdialog", { name: `Transfer the ownership of ${orphan}?` });
  await expect(transfer).toContainText(
    `${former} stays as a co-teacher while they have the teacher role`,
  );
  await choose(transfer, "New owner", HEIR);
  await transfer.getByRole("button", { name: "Transfer ownership" }).click();
  await expect(page.getByText(`The ownership of ${orphan} is transferred.`)).toBeVisible();
  const members = page.getByRole("table", { name: "Teachers of the class" });
  await expect(members.getByRole("row", { name: new RegExp(former) })).toHaveCount(0);
  await page.goto(`/admin/classes?ownerNotTeacher=true&q=${orphan}`);
  await expect(page.getByRole("heading", { level: 2, name: "No classes match" })).toBeVisible();
});

test("a teacher never reaches the administrator's classes (#37, R-01)", async ({ page }) => {
  await devLogin(page, "admin-classes-heir@example.test");
  await expect(page).toHaveURL(/\/teacher$/);
  await page.goto("/admin/classes");
  await expect(page).not.toHaveURL(/\/admin\/classes/);
  await expect(page.getByRole("heading", { level: 1, name: "Classes" })).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  for (const locale of ["en", "nl"] as const) {
    test(`the class list and page are axe-clean in ${theme}, ${locale} (#37)`, async ({
      page,
      context,
    }) => {
      await signInAsAdmin(page);
      await preferences(context, theme, locale);
      await page.goto(`/admin/classes?q=${CLASS}`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const link = page.getByRole("link", { name: new RegExp(`^${CLASS}`) });
      await expect(link).toBeVisible();
      await axe(page);
      if (locale === "en") await screenshot(page, `admin-classes-list-${theme}`);
      await link.click();
      await expect(
        page.getByRole("heading", {
          level: 2,
          name: locale === "nl" ? dutch("classes_admin_import_title") : "Import students",
        }),
      ).toBeVisible();
      await axe(page);
      if (locale === "en") await screenshot(page, `admin-class-page-${theme}`);
    });
  }
}

test.describe("at 320 CSS px wide (WCAG 1.4.10)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the class list and the class page reflow without a horizontal scroll", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`/admin/classes?q=${CLASS}`);
    await expect(page.getByRole("link", { name: new RegExp(`^${CLASS}`) })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.getByRole("link", { name: new RegExp(`^${CLASS}`) }).click();
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(CLASS) })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.getByRole("button", { name: "Transfer ownership" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await axe(page);
  });
});
