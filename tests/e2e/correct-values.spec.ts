// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The state of a simulation and its correct values (D10, D13, #267): a teacher enters one value,
// pastes more, changes one with the keyboard, sets a test's limits, starts and finishes the
// simulation behind a confirmation, and sees the catalogue lock the test; a student reaches none
// of it. Axe in light, dark and Dutch. Every test, value and limit is invented (Q-PRIV-4).
import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated, pressUntilFocused } from "./fixtures";
import { appUrl } from "./run-env";

const TEACHER = "teacher@example.test";
const STUDENT = "student@example.test";

function suffix(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

async function addCatalogueTest(page: Page, name: string): Promise<void> {
  await page.goto("/teacher/catalogue");
  const add = page.getByRole("button", { name: "Add test" });
  await expectHydrated(add);
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add a test" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Unit").fill("mmol/L");
  await dialog.getByLabel("Material").fill("plasma");
  await dialog.getByRole("combobox", { name: "Source of the measurements" }).click();
  await page.getByRole("option", { name: "Entry by hand" }).click();
  await dialog.getByRole("button", { name: "Add test" }).click();
  await expect(dialog).toHaveCount(0);
}

async function createSimulation(page: Page, name: string): Promise<string> {
  await page.goto("/teacher/simulations");
  const create = page.getByRole("button", { name: "Create simulation" });
  await expectHydrated(create);
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Create a simulation" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create simulation" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const id = /\/teacher\/simulations\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
  if (id === undefined) throw new Error(`no simulation id in ${page.url()}`);
  return id;
}

function valuesTable(page: Page) {
  return page.getByRole("table", { name: "Correct values per sample number and test" });
}

function limitsTable(page: Page) {
  return page.getByRole("table", { name: "Accuracy limits per test" });
}

test("a teacher enters, pastes and changes correct values, sets limits, starts and finishes (D10, D13)", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const id = suffix();
  const testName = `Glucose ${id}`;
  const simulation = `Values journey ${id}`;
  await devLogin(page, TEACHER);
  await expect(page).toHaveURL(/\/teacher$/);
  await addCatalogueTest(page, testName);
  const simulationId = await createSimulation(page, simulation);

  // A new simulation is prepared, with no correct values yet.
  await expect(page.getByText("Prepared", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("No correct values yet", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Only the teachers of this simulation see these values. Students never do."),
  ).toBeVisible();

  // Every missing field is named at its field (WCAG 3.3.1).
  const one = page.getByRole("form", { name: "Enter a correct value" });
  const save = one.getByRole("button", { name: "Save value" });
  await expectHydrated(save);
  await save.click();
  await expect(one.getByText("Enter the sample number.")).toBeVisible();
  await expect(one.getByText("Choose a test.")).toBeVisible();
  await expect(one.getByText("Enter the correct value.")).toBeVisible();
  await axe(page);

  // One value, with a decimal comma: stored and shown with every digit.
  await one.getByLabel("Sample number").fill("S-101");
  await one.getByRole("combobox", { name: "Test" }).click();
  await page.getByRole("option", { name: `${testName} (mmol/L)` }).click();
  await one.getByLabel("Correct value").fill("5,250");
  await save.click();
  await expect(
    page.getByText("Correct values saved: 1 added, 0 changed, 0 unchanged."),
  ).toBeVisible();
  await expect(valuesTable(page).getByRole("row").filter({ hasText: "S-101" })).toContainText(
    "5.250 mmol/L",
  );

  // A paste names the line that does not read, and stores nothing until every line reads.
  const paste = page.getByRole("form", { name: "Paste correct values" });
  const rows = paste.getByLabel("Rows to paste");
  await rows.fill(`S-102\t${testName}\t6.1\nS-103\tNo such test ${id}\t1`);
  await paste.getByRole("button", { name: "Save pasted values" }).click();
  await expect(
    paste.getByText(`Line 2: the catalogue has no active test named “No such test ${id}”.`),
  ).toBeVisible();
  await expect(valuesTable(page).getByRole("row").filter({ hasText: "S-102" })).toHaveCount(0);
  await rows.fill(`S-102\t${testName}\t6.1\ns-101;${testName};5.250`);
  await paste.getByRole("button", { name: "Save pasted values" }).click();
  await expect(
    page.getByText("Correct values saved: 1 added, 0 changed, 1 unchanged."),
  ).toBeVisible();
  await expect(valuesTable(page).getByRole("row")).toHaveCount(3);

  // Change a value with the keyboard alone (WCAG 2.1.1).
  const item = `${testName} of sample S-101`;
  const change = page.getByRole("button", { name: `Change the correct value of ${item}` });
  await change.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Change the correct value of ${item}` });
  const field = dialog.getByLabel("Correct value");
  await pressUntilFocused(page, "Tab", field);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("5.3");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(change).toBeFocused();
  await expect(valuesTable(page).getByRole("row").filter({ hasText: "S-101" })).toContainText(
    "5.3 mmol/L",
  );

  // Limits: red closer than yellow is refused at its field, compared as decimals (D13).
  const testRow = limitsTable(page).getByRole("row").filter({ hasText: testName });
  await expect(testRow).toContainText("No limits yet");
  await testRow.getByRole("button", { name: `Set the limits of ${testName}` }).click();
  const limits = page.getByRole("dialog", { name: `Limits of ${testName}` });
  await limits.getByLabel("Yellow limit").fill("0,30");
  await limits.getByLabel("Red limit").fill("0.29");
  await limits.getByRole("button", { name: "Save limits" }).click();
  await expect(
    limits.getByText("The red limit cannot be smaller than the yellow limit."),
  ).toBeVisible();
  await axe(page);
  await limits.getByLabel("Red limit").fill("10");
  await limits.getByRole("button", { name: "Save limits" }).click();
  await expect(limits).toHaveCount(0);
  await expect(testRow).toContainText("Yellow beyond 0.30%, red beyond 10%");

  // Start behind a confirmation whose safe choice takes the first focus (WCAG 3.3.4).
  await page.getByRole("button", { name: "Start simulation" }).click();
  const start = page.getByRole("alertdialog", { name: `Start ${simulation}?` });
  await expect(start.getByRole("button", { name: "Cancel" })).toBeFocused();
  await axe(page);
  await start.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText(`Started ${simulation}.`)).toBeVisible();
  await expect(page.getByText("Running", { exact: true }).first()).toBeVisible();

  // The catalogue shows the lock with an icon and text (D9).
  await page.goto(`/teacher/catalogue?q=${encodeURIComponent(testName)}`);
  await expect(
    page.getByRole("table").getByRole("row").filter({ hasText: testName }),
  ).toContainText("In a running simulation");

  // A student reaches neither the page nor its values (Q-SIM-1).
  const context = await browser.newContext();
  const student = await context.newPage();
  await devLogin(student, STUDENT);
  await student.goto(`/teacher/simulations/${simulationId}`);
  await expect(student.getByText("5.3")).toHaveCount(0);
  await expect(student.getByText(testName)).toHaveCount(0);
  await context.close();

  // Finish; the values stay changeable (D10).
  await page.goto(`/teacher/simulations/${simulationId}`);
  const finish = page.getByRole("button", { name: "Finish simulation" });
  await expectHydrated(finish);
  await finish.click();
  await page
    .getByRole("alertdialog", { name: `Finish ${simulation}?` })
    .getByRole("button", { name: "Finish", exact: true })
    .click();
  await expect(page.getByText(`Finished ${simulation}.`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start simulation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finish simulation" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: `Change the correct value of ${item}` }),
  ).toBeEnabled();

  // Axe on the filled page in dark and in Dutch.
  for (const [theme, locale] of [
    ["dark", "en"],
    ["light", "nl"],
    ["dark", "nl"],
  ] as const) {
    await page.context().addCookies([
      { name: "EDULIMS_THEME", value: theme, url: appUrl() },
      { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
    ]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const heading = locale === "nl" ? dutch("correct_values_heading") : "Correct values";
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    await axe(page);
  }
});
