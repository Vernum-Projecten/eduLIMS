// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The test catalogue of the Admin portal (D9, S4, #266; owner 2026-11-20 on #393): add, edit,
// retire and restore a test with the keyboard alone, the UCUM unit as a searchable list, the
// Afinion 2 analyte that fills its unit, the starter set, refusals at their field, and axe in
// light, dark and Dutch. Every test a journey adds is invented for it (Q-PRIV-4).
import { randomBytes } from "node:crypto";
import { expect, type Page, type Route, test } from "@playwright/test";
import { axe, dutch, signInAsAdmin } from "./admin-users-helpers";
import {
  devLogin,
  expectHydrated,
  openDialogWithKeyboard,
  pressUntilFocused,
  THEMES_AND_LOCALES,
  usePreferences,
} from "./fixtures";

/** A test name no other journey uses, so parallel journeys never meet. */
function testName(base: string): string {
  return `${base} ${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function openCatalogue(page: Page, q?: string): Promise<void> {
  await page.goto(q ? `/admin/catalogue?q=${encodeURIComponent(q)}` : "/admin/catalogue");
  await expectHydrated(page.getByRole("button", { name: "Add test" }));
}

function rowOf(page: Page, name: string) {
  return page.getByRole("table").getByRole("row").filter({ hasText: name });
}

/**
 * Chooses a unit in the open dialog's unit list with the keyboard: typing `search` filters the
 * list, and the first match, `option`, is taken.
 */
async function chooseUnit(page: Page, search: string, option: string): Promise<void> {
  const unit = page.getByRole("dialog").getByRole("combobox", { name: "Unit" });
  await unit.fill(search);
  await expect(page.getByRole("option", { name: option })).toBeVisible();
  await unit.press("ArrowDown");
  await unit.press("Enter");
  await expect(unit).toHaveValue(option);
}

test("an administrator adds, edits, retires and restores a test with the keyboard (D9, S4)", async ({
  page,
}) => {
  const name = testName("Glucose");
  await signInAsAdmin(page);
  await openCatalogue(page);
  await expect(page.getByRole("heading", { level: 1, name: "Test catalogue" })).toBeVisible();

  const dialog = page.getByRole("dialog", { name: "Add a test" });
  await openDialogWithKeyboard(
    page,
    page.getByRole("button", { name: "Add test" }),
    dialog,
    dialog.getByLabel("Name"),
  );
  await page.keyboard.type(name);
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
  // The select hands focus back to its trigger after its close animation (#321).
  await expect(source).toBeFocused();
  // The calculator shows for an Epoch 2 test only, and the analyte does not (D9, S4).
  await expect(dialog.getByRole("combobox", { name: "Analyte on the Afinion 2" })).toHaveCount(0);

  // The unit is a searchable list of UCUM units (#393).
  const unit = dialog.getByRole("combobox", { name: "Unit" });
  await page.keyboard.press("Tab");
  await expect(unit).toBeFocused();
  await page.keyboard.type("millimole per");
  await expect(page.getByRole("option", { name: "mmol/L (millimole per litre)" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(unit).toHaveValue("mmol/L (millimole per litre)");

  const team = dialog.getByRole("radio", { name: "The lab calculates" });
  await pressUntilFocused(page, "Tab", team);
  await page.keyboard.press("Space");
  await expect(team).toBeChecked();
  await pressUntilFocused(page, "Tab", dialog.getByRole("button", { name: "Add test" }));
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`${name} added to the catalogue.`)).toBeVisible();

  await openCatalogue(page, name);
  const row = rowOf(page, name);
  // The table shows a unit by its symbol (UI review of #404).
  await expect(row.getByRole("cell", { name: "mmol/L", exact: true })).toBeVisible();
  await expect(row).toContainText("plasma");
  await expect(row).toContainText("Epoch 2 upload");
  await expect(row).toContainText("The lab calculates");
  await expect(row).toContainText("Active");

  // Edit: switch who calculates and change the material (D9).
  const menu = row.getByRole("button", { name: `Actions for ${name}` });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeFocused();
  await page.keyboard.press("Enter");
  const edit = page.getByRole("dialog", { name: `Edit ${name}` });
  await expect(edit.getByLabel("Name")).toHaveValue(name);
  await expect(edit.getByRole("combobox", { name: "Unit" })).toHaveValue(
    "mmol/L (millimole per litre)",
  );
  await pressUntilFocused(page, "Tab", edit.getByLabel("Material"));
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("serum");
  await pressUntilFocused(page, "Tab", edit.getByRole("radio", { name: "The lab calculates" }), 8);
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
  // Focus returns to the row's menu button after the confirmation (WCAG 2.4.3).
  await expect(menu).toBeFocused();

  // A retired test can be restored.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Restore" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(row).toContainText("Active");
});

test("a fresh installation carries the Afinion 2 tests with their UCUM units (#393)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await openCatalogue(page, "cholesterol");
  await expect(
    rowOf(page, "Total cholesterol").getByRole("cell", { name: "mmol/L", exact: true }),
  ).toBeVisible();
  await expect(rowOf(page, "Total cholesterol")).toContainText("Analyte Chol");
  await openCatalogue(page, "Cholesterol/HDL ratio");
  await expect(
    rowOf(page, "Cholesterol/HDL ratio").getByRole("cell", { name: "No unit" }),
  ).toBeVisible();
  await axe(page);
});

test("an Afinion 2 analyte fills its unit, which the analyser may fix (D9, #393)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await openCatalogue(page);
  await page.getByRole("button", { name: "Add test" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a test" });
  await dialog.getByRole("button", { name: "Add test" }).click();
  await expect(dialog.getByText("Enter the name of the test.")).toBeVisible();
  await expect(dialog.getByText("Choose where the measurements come from.")).toBeVisible();
  await expect(dialog.getByLabel("Name")).toBeFocused();

  await dialog.getByLabel("Name").fill(testName("CRP"));
  await dialog.getByLabel("Material").fill("blood");
  await dialog.getByRole("combobox", { name: "Source of the measurements" }).click();
  await page.getByRole("option", { name: "Afinion 2" }).click();
  // The select hands focus back to its trigger after its close animation; a field used before
  // then loses focus to it (#321).
  await expect(dialog.getByRole("combobox", { name: "Source of the measurements" })).toBeFocused();
  await dialog.getByRole("button", { name: "Add test" }).click();
  await expect(dialog.getByText("Choose the analyte the Afinion 2 sends.")).toBeVisible();

  const analyte = dialog.getByRole("combobox", { name: "Analyte on the Afinion 2" });
  const unit = dialog.getByRole("combobox", { name: "Unit" });
  await analyte.click();
  await page.getByRole("option", { name: "CRP", exact: true }).click();
  // CRP comes in mg/L only: the unit is filled in and read-only, with the reason beside it.
  await expect(unit).toHaveValue("mg/L (milligram per litre)");
  await expect(unit).toHaveAttribute("aria-readonly", "true");
  await expect(
    dialog.getByText("The Afinion 2 sends this analyte in this unit only."),
  ).toBeVisible();

  await analyte.click();
  await page.getByRole("option", { name: "HbA1c", exact: true }).click();
  await expect(analyte).toBeFocused();
  // The analyser sets the HbA1c unit, so it stays open to change.
  await expect(unit).toHaveValue("% (percent)");
  await expect(unit).not.toHaveAttribute("aria-readonly", "true");
  await chooseUnit(page, "mmol/mol", "mmol/mol (millimole per mole)");

  // The starter set holds the active HbA1c test, so a second one is refused at its field.
  await dialog.getByRole("button", { name: "Add test" }).click();
  await expect(analyte).toHaveAttribute("aria-invalid", "true");
  await expect(
    dialog.getByText("Another active Afinion 2 test already has this analyte name."),
  ).toBeVisible();
  await axe(page);
});

test("a taken name is refused at its field (D9)", async ({ page }) => {
  await signInAsAdmin(page);
  await openCatalogue(page);
  await page.getByRole("button", { name: "Add test" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a test" });
  // The starter set holds "CRP".
  await dialog.getByLabel("Name").fill("crp");
  await dialog.getByLabel("Material").fill("blood");
  await dialog.getByRole("combobox", { name: "Source of the measurements" }).click();
  await page.getByRole("option", { name: "Entry by hand" }).click();
  // The select hands focus back to its trigger after its close animation; a field used before
  // then loses focus to it (#321).
  await expect(dialog.getByRole("combobox", { name: "Source of the measurements" })).toBeFocused();
  await chooseUnit(page, "mg/L", "mg/L (milligram per litre)");
  await dialog.getByRole("button", { name: "Add test" }).click();
  await expect(dialog.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
  await expect(
    dialog.getByText("Another test in the catalogue already has this name."),
  ).toBeVisible();
});

test("a failing catalogue read shows the error state and its retry recovers (D9)", async ({
  page,
}) => {
  await signInAsAdmin(page);
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
  await expect(page.getByRole("heading", { level: 2, name: "No tests match" })).toBeVisible();
  // The filtered empty state is axe-clean. The unfiltered one never shows here: the starter set
  // fills every installation's catalogue.
  await axe(page);
});

test("a ratio without a unit shows no unit in words (D9; maintainer 2026-11-19)", async ({
  page,
}) => {
  const name = testName("Ratio");
  await signInAsAdmin(page);
  await openCatalogue(page);
  await page.getByRole("button", { name: "Add test" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a test" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Material").fill("blood");
  await dialog.getByRole("combobox", { name: "Source of the measurements" }).click();
  await page.getByRole("option", { name: "Entry by hand" }).click();
  // The select hands focus back to its trigger after its close animation; a field used before
  // then loses focus to it (#321).
  await expect(dialog.getByRole("combobox", { name: "Source of the measurements" })).toBeFocused();
  await dialog.getByRole("combobox", { name: "Unit" }).click();
  await page.getByRole("option", { name: "No unit" }).click();
  await dialog.getByRole("button", { name: "Add test" }).click();
  await expect(dialog).toHaveCount(0);
  await openCatalogue(page, name);
  await expect(rowOf(page, name).getByRole("cell", { name: "No unit" })).toBeVisible();
  await axe(page);
});

for (const [theme, locale] of THEMES_AND_LOCALES) {
  test(`the catalogue and its form are axe-clean in ${theme}, ${locale} (D9, Q-ACC-1)`, async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);
    await usePreferences(context, theme, locale);
    const t = (key: string, english: string) => (locale === "nl" ? dutch(key) : english);
    await page.goto("/admin/catalogue");
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
    // The unit list, open and unfiltered, is axe-clean, and so is its empty state.
    const unit = dialog.getByRole("combobox", { name: t("catalogue_unit", "Unit") });
    await unit.click();
    await expect(dialog.getByRole("listbox")).toBeVisible();
    await axe(page);
    await unit.fill("zzz");
    await expect(
      dialog.getByText(t("catalogue_unit_empty", "No unit matches your search.")),
    ).toBeVisible();
    await axe(page);
  });
}

test("the catalogue reflows at 320 px without horizontal scrolling (WCAG 1.4.10)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await signInAsAdmin(page);
  await openCatalogue(page);
  await page.getByRole("button", { name: "Add test" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a test" });
  await expect(dialog).toBeVisible();
  // The dialog's content and the open unit list, measured inside the dialog.
  await dialog.getByRole("combobox", { name: "Unit" }).click();
  const list = dialog.getByRole("listbox");
  await expect(list).toBeVisible();
  const widths = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const listbox = element.querySelector('[role="listbox"]')?.getBoundingClientRect();
    return {
      overflow: element.scrollWidth - element.clientWidth,
      listInside: listbox !== undefined && listbox.left >= box.left && listbox.right <= box.right,
    };
  });
  expect(widths).toEqual({ overflow: 0, listInside: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});

test("a student and a teacher cannot open the catalogue (D9, A01, #393)", async ({ browser }) => {
  for (const email of ["student@example.test", "teacher@example.test"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await devLogin(page, email);
    await page.goto("/admin/catalogue");
    await expect(page.getByRole("button", { name: "Add test" })).toHaveCount(0);
    // The Teacher portal's old page is gone (#393).
    await page.goto("/teacher/catalogue");
    await expect(page.getByRole("button", { name: "Add test" })).toHaveCount(0);
    await context.close();
  }
});
