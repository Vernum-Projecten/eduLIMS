// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The state of a simulation and its correct values (D10, D13, #267, #381): a teacher enters one
// value, pastes more, changes one with the keyboard, sets a test's limits on the correct-values
// page, starts and finishes the simulation from the overview behind a confirmation, and an
// administrator sees the catalogue lock the test (#393); a student reaches none of it. Axe in
// light, dark and Dutch. Every test, value and limit is invented (Q-PRIV-4).
import { randomBytes } from "node:crypto";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { copyAccount } from "./accounts";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated, pressUntilFocused } from "./fixtures";
import { seatStudent } from "./lab-records-seed";
import { appUrl } from "./run-env";

const TEACHER = "teacher@example.test";
const ADMIN = "admin@example.test";

function suffix(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

/** Waits for every animation (a dialog, a toast) so focus checks see the end state. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
}

/** Adds a test to the catalogue as an administrator, who manages it (#393). */
async function addCatalogueTest(browser: Browser, name: string): Promise<void> {
  await asAdmin(browser, async (page) => {
    await page.goto("/admin/catalogue");
    const add = page.getByRole("button", { name: "Add test" });
    await expectHydrated(add);
    await add.click();
    const dialog = page.getByRole("dialog", { name: "Add a test" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Material").fill("plasma");
    await dialog.getByRole("combobox", { name: "Source of the measurements" }).click();
    await page.getByRole("option", { name: "Entry by hand" }).click();
    // The select hands focus back to its trigger after its close animation; a field used before
    // then loses focus to it (#321).
    await expect(
      dialog.getByRole("combobox", { name: "Source of the measurements" }),
    ).toBeFocused();
    // The unit list filters as you type; the first match is the one (#393).
    const unit = dialog.getByRole("combobox", { name: "Unit" });
    await unit.fill("mmol/L");
    await expect(page.getByRole("option", { name: "mmol/L (millimole per litre)" })).toBeVisible();
    await unit.press("ArrowDown");
    await unit.press("Enter");
    await expect(unit).toHaveValue("mmol/L (millimole per litre)");
    await dialog.getByRole("button", { name: "Add test" }).click();
    await expect(dialog).toHaveCount(0);
  });
}

/** Runs `work` in a page of its own, signed in as the administrator. */
async function asAdmin(browser: Browser, work: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await devLogin(page, ADMIN);
    await work(page);
  } finally {
    await context.close();
  }
}

async function createSimulation(page: Page, name: string): Promise<string> {
  await page.goto("/teacher/simulations");
  const create = page.getByRole("button", { name: "Create simulation" });
  await expectHydrated(create);
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Create a simulation" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create simulation" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  const id = /\/teacher\/simulations\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
  if (id === undefined) throw new Error(`no simulation id in ${page.url()}`);
  return id;
}

/** The table of one test's correct values on the correct-values page (#381). */
function valuesTable(page: Page, test: string) {
  return page.getByRole("table", { name: `Correct values of ${test}` });
}

/** The section of one test: its heading, its limits and its table (#381). */
function testSection(page: Page, test: string) {
  return page.getByRole("region", { name: new RegExp(`^${test}`) });
}

/** Opens a page of the simulation from its navigation (#381). */
async function openPage(page: Page, simulation: string, label: string): Promise<void> {
  const link = page
    .getByRole("navigation", { name: `Pages of ${simulation}` })
    .getByRole("link", { name: label, exact: true });
  await expectHydrated(link);
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: label, exact: true })).toBeVisible();
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
  await addCatalogueTest(browser, testName);
  const simulationId = await createSimulation(page, simulation);

  // A new simulation is prepared. Start stays focusable while a step blocks it, says why, and
  // sends focus to the first blocking step (#394, WCAG 2.4.3).
  await expect(page.getByText("Prepared", { exact: true }).first()).toBeVisible();
  const startButton = page.getByRole("button", { name: "Start simulation" });
  await expectHydrated(startButton);
  await expect(startButton).toHaveAttribute("aria-disabled", "true");
  await expect(startButton).toHaveAccessibleDescription("Add a student to a lab first. Open labs");
  // The button stays focusable while blocked, so Enter reaches it (pointer: the unit test).
  await startButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  const labsStep = page.getByRole("heading", { level: 3, name: "Labs and students" });
  await expect(labsStep).toBeFocused();
  // The focused step says why it blocks the start (the UI review of #403).
  await expect(labsStep).toHaveAccessibleDescription(
    "Blocks the start No labs yet. Create a lab for each team and add its students.",
  );
  await axe(page);

  // A lab with one student; the student comes from the run's own accounts.
  const lab = `Lab ${id}`;
  await openPage(page, simulation, "Labs");
  const createLab = page.getByRole("button", { name: "Create lab" });
  await expectHydrated(createLab);
  await createLab.click();
  const labDialog = page.getByRole("dialog", { name: "Create a lab" });
  await labDialog.getByLabel("Name").fill(lab);
  await labDialog.getByRole("button", { name: "Create lab" }).click();
  await expect(page.getByRole("link", { name: lab, exact: true })).toBeVisible();
  await seatStudent(simulationId, lab);

  // No correct values yet: the empty state holds the one action that adds the first.
  await openPage(page, simulation, "Correct values");
  await expect(page.getByText("No correct values yet", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Only the teachers of this simulation see these values. Students never do."),
  ).toBeVisible();

  // Every missing field is named at its field (WCAG 3.3.1).
  const addValue = page.getByRole("button", { name: "Add correct value" });
  await expect(addValue).toHaveCount(1);
  await expectHydrated(addValue);
  await addValue.click();
  const addDialog = page.getByRole("dialog", { name: "Enter one value" });
  const one = addDialog.getByRole("form", { name: "Enter a correct value" });
  const save = one.getByRole("button", { name: "Save value" });
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
  // The dialog stays open over the toasts' layer and says itself what it saved (WCAG 4.1.3).
  await expect(
    addDialog.getByRole("status").filter({ hasText: "Saved the correct value" }),
  ).toHaveText(`Saved the correct value of ${testName} for sample S-101.`);
  // The dialog stays open, empty, with focus on its first field for the next value; closing it
  // returns focus to the opener, now in the page's header.
  await expect(one.getByLabel("Sample number")).toHaveValue("");
  await expect(one.getByLabel("Sample number")).toBeFocused();
  await addDialog.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(addDialog).toBeHidden();
  await expect(addValue).toBeFocused();
  await expect(
    valuesTable(page, testName).getByRole("row").filter({ hasText: "S-101" }),
  ).toContainText("5.250 mmol/L");

  // A paste names the line that does not read, and stores nothing until every line reads.
  await page.getByRole("button", { name: "Paste rows" }).click();
  const pasteDialog = page.getByRole("dialog", { name: "Paste many values" });
  const paste = pasteDialog.getByRole("form", { name: "Paste correct values" });
  const rows = paste.getByLabel("Rows to paste");
  await rows.fill(`S-102\t${testName}\t6.1\nS-103\tNo such test ${id}\t1`);
  await paste.getByRole("button", { name: "Save pasted values" }).click();
  await expect(
    paste.getByText(`Line 2: the catalogue has no active test named “No such test ${id}”.`),
  ).toBeVisible();
  await expect(
    valuesTable(page, testName).getByRole("row").filter({ hasText: "S-102" }),
  ).toHaveCount(0);
  await rows.fill(`S-102\t${testName}\t6.1\ns-101;${testName};5.250`);
  await paste.getByRole("button", { name: "Save pasted values" }).click();
  await expect(
    page.getByText("Correct values saved: 1 added, 0 changed, 1 unchanged."),
  ).toBeVisible();
  await expect(pasteDialog).toBeHidden();
  await expect(valuesTable(page, testName).getByRole("row")).toHaveCount(3);

  // Change a value from its row's menu with the keyboard alone (WCAG 2.1.1).
  const item = `${testName} of sample S-101`;
  const change = page.getByRole("button", { name: `Actions for ${item}` });
  await expectHydrated(change);
  await change.focus();
  await page.keyboard.press("Enter");
  await pressUntilFocused(page, "ArrowDown", page.getByRole("menuitem", { name: "Change value" }));
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Change the correct value of ${item}` });
  const field = dialog.getByLabel("Correct value");
  await pressUntilFocused(page, "Tab", field);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("5.3");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(change).toBeFocused();
  await expect(
    valuesTable(page, testName).getByRole("row").filter({ hasText: "S-101" }),
  ).toContainText("5.3 mmol/L");

  // Before the limits, the overview names the test that blocks the start, and Start waits for
  // it, saying why beside the button; the checklist reads the server's verdict (#381).
  await openPage(page, simulation, "Overview");
  const missing = page.getByText(`Before you can start, set the accuracy limits of: ${testName}.`);
  await expect(missing).toBeVisible();
  await expect(page.getByText("Blocks the start").first()).toBeVisible();
  await expect(startButton).toHaveAttribute("aria-disabled", "true");
  await expect(startButton).toHaveAccessibleDescription(
    "Set the accuracy limits first. Open correct values",
  );
  await axe(page);
  // The prepared overview in Dutch, with its blocking step (Q-ACC-1).
  await page.context().addCookies([{ name: "EDULIMS_LOCALE", value: "nl", url: appUrl() }]);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(
    page.getByRole("heading", { level: 1, name: dutch("simulation_nav_overview") }),
  ).toBeVisible();
  await axe(page);
  await page.context().addCookies([{ name: "EDULIMS_LOCALE", value: "en", url: appUrl() }]);
  await page.reload();
  await expect(missing).toBeVisible();

  // Limits: red closer than yellow is refused at its field, compared as decimals (D13).
  await page.getByRole("link", { name: "Open correct values" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Correct values" })).toBeVisible();
  const section = testSection(page, testName);
  await expect(section).toContainText("No accuracy limits yet: this blocks the start.");
  await section.getByRole("button", { name: `Set accuracy limits for ${testName}` }).click();
  const limits = page.getByRole("dialog", { name: `Accuracy limits of ${testName}` });
  await limits.getByLabel("Yellow limit").fill("0,30");
  await limits.getByLabel("Red limit").fill("0.29");
  await limits.getByRole("button", { name: "Save accuracy limits" }).click();
  await expect(
    limits.getByText("The red limit cannot be smaller than the yellow limit."),
  ).toBeVisible();
  await axe(page);
  await limits.getByLabel("Red limit").fill("10");
  await limits.getByRole("button", { name: "Save accuracy limits" }).click();
  await expect(limits).toHaveCount(0);
  await expect(section).toContainText("Yellow beyond 0.30%, red beyond 10%");
  await expect(
    section.getByRole("button", { name: `Set accuracy limits for ${testName}` }),
  ).toBeFocused();

  // Start behind a confirmation whose safe choice takes the first focus (WCAG 3.3.4).
  await openPage(page, simulation, "Overview");
  await expect(missing).toHaveCount(0);
  await expect(
    page.getByText("Nothing blocks the start. Start when the labs are ready."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start simulation" }).click();
  const start = page.getByRole("alertdialog", { name: `Start ${simulation}?` });
  await expect(start.getByRole("button", { name: "Cancel" })).toBeFocused();
  await axe(page);
  await start.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText(`Started ${simulation}.`)).toBeVisible();
  await expect(page.getByText("Running", { exact: true }).first()).toBeVisible();
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Open the dashboard" })).toHaveAttribute(
    "href",
    "/teacher/dashboard",
  );

  // A running simulation is never deleted, whatever its members (maintainer 2026-11-20).
  await openPage(page, simulation, "Settings");
  await page.getByRole("button", { name: "Delete simulation" }).click();
  await page
    .getByRole("alertdialog", { name: `Delete ${simulation}?` })
    .getByRole("button", { name: "Delete simulation" })
    .click();
  await expect(
    page.getByText("This simulation is running, so it cannot be deleted. Finish it first."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  // The catalogue shows the lock with an icon and text (D9).
  await asAdmin(browser, async (admin) => {
    await admin.goto(`/admin/catalogue?q=${encodeURIComponent(testName)}`);
    await expect(
      admin.getByRole("table").getByRole("row").filter({ hasText: testName }),
    ).toContainText("In a running simulation");
  });

  // A student reaches neither the page nor its values (Q-SIM-1).
  const context = await browser.newContext();
  const student = await context.newPage();
  // NOTE: #379; a student of its own, so no other journey's simulation can meet this one.
  const account = await copyAccount("student@example.test", "values-student");
  await devLogin(student, account.email);
  for (const path of ["", "/values", "/labs", "/corrections", "/settings"]) {
    await student.goto(`/teacher/simulations/${simulationId}${path}`);
    await expect(student).toHaveURL(/\/student$/);
    await expect(student.getByText("5.3")).toHaveCount(0);
    await expect(student.getByText(testName)).toHaveCount(0);
  }
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
  // A finished simulation has nothing live on the dashboard: the overview points to corrections.
  await expect(page.getByRole("link", { name: "Open corrections" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the dashboard" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start simulation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finish simulation" })).toHaveCount(0);
  await openPage(page, simulation, "Correct values");
  await page.getByRole("button", { name: `Actions for ${item}` }).click();
  await expect(page.getByRole("menuitem", { name: "Change value" })).toBeEnabled();
  await page.keyboard.press("Escape");

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
    const heading = locale === "nl" ? dutch("simulation_nav_values") : "Correct values";
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await axe(page);
  }
});
