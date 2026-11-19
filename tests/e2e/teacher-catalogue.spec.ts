// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The test catalogue of the Teacher portal (D9, S4, #266): add, edit, retire and restore a test
// with the keyboard alone, the analyte and calculator fields that follow the source, a taken name
// at its field, and axe in light, dark and Dutch. All tests are invented for the journey.
import { randomBytes } from "node:crypto";
import { type BrowserContext, expect, type Page, type Route, test } from "@playwright/test";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated, pressUntilFocused } from "./fixtures";
import { appUrl } from "./run-env";

const TEACHER = "teacher@example.test";

/** A test name no other journey uses, so parallel journeys never meet. */
function testName(base: string): string {
  return `${base} ${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function signInAsTeacher(page: Page): Promise<void> {
  await devLogin(page, TEACHER);
  await expect(page).toHaveURL(/\/teacher$/);
}

async function openCatalogue(page: Page, q?: string): Promise<void> {
  await page.goto(q ? `/teacher/catalogue?q=${encodeURIComponent(q)}` : "/teacher/catalogue");
  await expectHydrated(page.getByRole("button", { name: "Add test" }));
}

function rowOf(page: Page, name: string) {
  return page.getByRole("table").getByRole("row").filter({ hasText: name });
}

test("a teacher adds, edits, retires and restores a test with the keyboard (D9, S4)", async ({
  page,
}) => {
  const name = testName("Glucose");
  await signInAsTeacher(page);
  await openCatalogue(page);
  await expect(page.getByRole("heading", { level: 1, name: "Test catalogue" })).toBeVisible();

  const add = page.getByRole("button", { name: "Add test" });
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add a test" });
  await expect(dialog.getByLabel("Name")).toBeFocused();
  // Escape closes the dialog without saving, and focus returns to "Add test".
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press("Tab");
  await page.keyboard.type("mmol/L");
  await page.keyboard.press("Tab");
  await page.keyboard.type("plasma");
  await page.keyboard.press("Tab");
  const source = dialog.getByRole("combobox", { name: "Source of the measurements" });
  await expect(source).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "Afinion 2" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Epoch 2 upload" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(source).toContainText("Epoch 2 upload");
  // The calculator shows for an Epoch 2 test only, and the analyte does not (D9, S4).
  await expect(dialog.getByLabel("Analyte name on the Afinion 2")).toHaveCount(0);
  const team = dialog.getByRole("radio", { name: "The team calculates" });
  await page.keyboard.press("Tab");
  await expect(team).toBeFocused();
  await page.keyboard.press("Space");
  await expect(team).toBeChecked();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Add test" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`${name} added to the catalogue.`)).toBeVisible();

  await openCatalogue(page, name);
  const row = rowOf(page, name);
  await expect(row).toContainText("mmol/L");
  await expect(row).toContainText("plasma");
  await expect(row).toContainText("Epoch 2 upload");
  await expect(row).toContainText("The team calculates");
  await expect(row).toContainText("Active");

  // Edit: switch who calculates and change the material (D9).
  const menu = row.getByRole("button", { name: `Actions for ${name}` });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeFocused();
  await page.keyboard.press("Enter");
  const edit = page.getByRole("dialog", { name: `Edit ${name}` });
  await expect(edit.getByLabel("Name")).toHaveValue(name);
  await pressUntilFocused(page, "Tab", edit.getByLabel("Material"));
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("serum");
  await pressUntilFocused(page, "Tab", edit.getByRole("radio", { name: "The team calculates" }));
  const edulims = edit.getByRole("radio", { name: "eduLIMS calculates" });
  await page.keyboard.press("ArrowDown");
  await expect(edulims).toBeFocused();
  await page.keyboard.press("Space");
  await expect(edulims).toBeChecked();
  await pressUntilFocused(page, "Tab", edit.getByRole("button", { name: "Save changes" }));
  await page.keyboard.press("Enter");
  await expect(edit).toHaveCount(0);
  await expect(row).toContainText("serum");
  await expect(row).toContainText("eduLIMS calculates");
  // Focus returns to the row's menu button (WCAG 2.4.3).
  await expect(menu).toBeFocused();

  // Retire behind a confirmation.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Retire" })).toBeFocused();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog", { name: `Retire ${name}?` });
  await expect(confirm).toContainText("New simulations no longer offer this test.");
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await axe(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(row).toContainText("Retired");
  await expect(page.getByText(`${name} retired.`)).toBeVisible();

  // A retired test can be restored.
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Restore" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(row).toContainText("Active");
});

test("an Afinion 2 test needs its analyte, and a taken name is refused at its field (D9)", async ({
  page,
}) => {
  const name = testName("CRP");
  await signInAsTeacher(page);
  await openCatalogue(page);
  await page.getByRole("button", { name: "Add test" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a test" });
  await dialog.getByRole("button", { name: "Add test" }).click();
  await expect(dialog.getByText("Enter the name of the test.")).toBeVisible();
  await expect(dialog.getByText("Choose where the measurements come from.")).toBeVisible();
  await expect(dialog.getByLabel("Name")).toBeFocused();

  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Unit").fill("mg/L");
  await dialog.getByLabel("Material").fill("blood");
  await dialog.getByRole("combobox", { name: "Source of the measurements" }).click();
  await page.getByRole("option", { name: "Afinion 2" }).click();
  await dialog.getByRole("button", { name: "Add test" }).click();
  await expect(dialog.getByText("Enter the analyte name the Afinion 2 sends.")).toBeVisible();
  await dialog.getByLabel("Analyte name on the Afinion 2").fill("CRP");
  await dialog.getByRole("button", { name: "Add test" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Add test" }).click();
  await dialog.getByLabel("Name").fill(name.toLowerCase());
  await dialog.getByLabel("Unit").fill("mg/L");
  await dialog.getByLabel("Material").fill("blood");
  await dialog.getByRole("combobox", { name: "Source of the measurements" }).click();
  await page.getByRole("option", { name: "Entry by hand" }).click();
  await dialog.getByRole("button", { name: "Add test" }).click();
  await expect(dialog.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
  await expect(
    dialog.getByText("Another test in the catalogue already has this name."),
  ).toBeVisible();
});

test("a failing catalogue read shows the error state and its retry recovers (D9)", async ({
  page,
}) => {
  await signInAsTeacher(page);
  await openCatalogue(page);
  const pattern = "**/_serverFn/**";
  const handler = (route: Route) =>
    route.request().method() === "GET" &&
    decodeURIComponent(route.request().url()).includes("no-such-test")
      ? route.fulfill({ status: 500, body: "forced failure" })
      : route.fallback();
  await page.route(pattern, handler);
  const search = page.getByRole("searchbox", { name: "Search name, unit, material or analyte" });
  await expectHydrated(search);
  await search.fill("no-such-test");
  await search.press("Enter");
  const heading = page.getByRole("heading", { level: 1, name: "Something went wrong" });
  await expect(heading).toBeVisible();
  await page.unroute(pattern, handler);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No tests match" })).toBeVisible();
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
  test(`the catalogue and its form are axe-clean in ${theme}, ${locale} (D9, Q-ACC-1)`, async ({
    page,
    context,
  }) => {
    await signInAsTeacher(page);
    await usePreferences(context, theme, locale);
    const t = (key: string, english: string) => (locale === "nl" ? dutch(key) : english);
    await page.goto("/teacher/catalogue");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      page.getByRole("heading", { level: 1, name: t("nav_test_catalogue", "Test catalogue") }),
    ).toBeVisible();
    await axe(page);
    const add = page.getByRole("button", { name: t("catalogue_add", "Add test") });
    await expectHydrated(add);
    await add.click();
    const dialog = page.getByRole("dialog", {
      name: t("catalogue_create_title", "Add a test"),
    });
    await dialog
      .getByRole("combobox", { name: t("catalogue_source", "Source of the measurements") })
      .click();
    await page
      .getByRole("option", { name: t("catalogue_source_epoch_upload", "Epoch 2 upload") })
      .click();
    await dialog.getByRole("button", { name: t("catalogue_create", "Add test") }).click();
    await expect(
      dialog.getByText(
        t("catalogue_calculated_by_required", "Choose who calculates the concentration."),
      ),
    ).toBeVisible();
    await axe(page);
  });
}

test("a student and an administrator cannot open the catalogue (D9, A01)", async ({ browser }) => {
  for (const email of ["student@example.test", "admin@example.test"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await devLogin(page, email);
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto("/teacher/catalogue");
    await expect(page.getByRole("button", { name: "Add test" })).toHaveCount(0);
    await context.close();
  }
});
