// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The unit field of the test catalogue's form (D9; UI review of #404): Escape closes the open list
// and keeps the dialog, "No unit" is a choice and an empty unit is refused, and an analyte's unit
// never outlives the analyte. Nothing is saved; the starter set's tests are left alone.
import { expect, type Page, test } from "@playwright/test";
import { signInAsAdmin } from "./admin-users-helpers";
import { expectHydrated } from "./fixtures";

/** Opens the add dialog with a name and material typed, and returns it. */
async function openForm(page: Page) {
  await signInAsAdmin(page);
  await page.goto("/admin/catalogue");
  const add = page.getByRole("button", { name: "Add test" });
  await expectHydrated(add);
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add a test" });
  await dialog.getByLabel("Name").fill("Unit field journey");
  await dialog.getByLabel("Material").fill("plasma");
  return dialog;
}

/** Chooses `option` in the source select and waits for focus to return to it (#321, #406). */
async function chooseSource(page: Page, option: string): Promise<void> {
  const source = page.getByRole("dialog").getByRole("combobox", {
    name: "Source of the measurements",
  });
  await source.click();
  await page.getByRole("option", { name: option }).click();
  await expect(source).toBeFocused();
}

test("Escape closes the open unit list and keeps the dialog with its values (WCAG 2.1.2)", async ({
  page,
}) => {
  const dialog = await openForm(page);
  const unit = dialog.getByRole("combobox", { name: "Unit" });
  await unit.click();
  await expect(dialog.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("listbox")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Name")).toHaveValue("Unit field journey");
  await expect(dialog.getByLabel("Material")).toHaveValue("plasma");
  // A second Escape, with the list closed, closes the dialog.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("an empty unit is no choice: clearing it and leaving is refused, never saved as No unit", async ({
  page,
}) => {
  const dialog = await openForm(page);
  await chooseSource(page, "Entry by hand");
  const unit = dialog.getByRole("combobox", { name: "Unit" });
  await unit.fill("mmol");
  await unit.fill("");
  await page.keyboard.press("Tab");
  await dialog.getByRole("button", { name: "Add test" }).click();
  await expect(unit).toHaveAttribute("aria-invalid", "true");
  await expect(
    dialog.getByText("Choose a unit, or No unit for a result without one, such as a ratio."),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
});

test("leaving the Afinion 2 clears the analyte, so its unit no longer holds (UI review of #404)", async ({
  page,
}) => {
  const dialog = await openForm(page);
  const unit = dialog.getByRole("combobox", { name: "Unit" });
  const analyte = dialog.getByRole("combobox", { name: "Analyte on the Afinion 2" });

  await chooseSource(page, "Afinion 2");
  await analyte.click();
  await page.getByRole("option", { name: "CRP", exact: true }).click();
  await expect(unit).toHaveValue("mg/L (milligram per litre)");
  await expect(unit).toHaveAttribute("aria-readonly", "true");

  await chooseSource(page, "Entry by hand");
  await expect(analyte).toHaveCount(0);
  await expect(unit).not.toHaveAttribute("aria-readonly", "true");
  await unit.fill("mmol/L");
  await expect(dialog.getByRole("option", { name: "mmol/L (millimole per litre)" })).toBeVisible();
  await unit.press("ArrowDown");
  await unit.press("Enter");
  await expect(unit).toHaveValue("mmol/L (millimole per litre)");

  // Back on the Afinion 2 the analyte is empty again, so nothing holds the unit to CRP's.
  await chooseSource(page, "Afinion 2");
  await expect(analyte).toContainText("Choose an analyte");
  await expect(unit).toHaveValue("mmol/L (millimole per litre)");
  await expect(unit).not.toHaveAttribute("aria-readonly", "true");
  await dialog.getByRole("button", { name: "Add test" }).click();
  await expect(dialog.getByText("Choose the analyte the Afinion 2 sends.")).toBeVisible();

  // Choosing CRP again sets its one unit.
  await analyte.click();
  await page.getByRole("option", { name: "CRP", exact: true }).click();
  await expect(unit).toHaveValue("mg/L (milligram per litre)");
  await expect(unit).toHaveAttribute("aria-readonly", "true");
});
