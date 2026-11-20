// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The state of a simulation and its correct values (D10, D13, #267, #381): a teacher enters one
// value, pastes more, changes one with the keyboard, sets a test's limits on the correct-values
// page, starts and finishes the simulation from the overview behind a confirmation, and sees the
// catalogue lock the test; a student reaches none of it. Axe in light, dark and Dutch. Every
// test, value and limit is invented (Q-PRIV-4).
import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { copyAccount } from "./accounts";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";
import { seatStudent } from "./lab-records-seed";
import { appUrl } from "./run-env";

const TEACHER = "teacher@example.test";

function suffix(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

/** Waits for every animation (a dialog, a toast) so focus checks see the end state. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
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
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  const id = /\/teacher\/simulations\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
  if (id === undefined) throw new Error(`no simulation id in ${page.url()}`);
  return id;
}

/** The column header of one test in the grid of correct values, with its limits (#401). */
function testHeader(page: Page, test: string) {
  return page
    .getByRole("region", { name: "Correct values per sample and test" })
    .getByRole("columnheader")
    .filter({ has: page.getByRole("button", { name: `Set accuracy limits for ${test}` }) });
}

/** The cell of one test and sample in the grid, named by both (#401). */
function cell(page: Page, test: string, sample: string) {
  return page.getByRole("button", { name: new RegExp(`^${test} of sample ${sample}: `) });
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
  await addCatalogueTest(page, testName);
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

  // No correct values yet: the empty state holds the one action, pasting the grid (#401).
  await openPage(page, simulation, "Correct values");
  await expect(page.getByText("No correct values yet", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Only the teachers of this simulation see these values. Students never do."),
  ).toBeVisible();
  const pasteValues = page.getByRole("button", { name: "Paste values" });
  await expect(pasteValues).toHaveCount(1);
  await expectHydrated(pasteValues);
  await pasteValues.click();
  const pasteDialog = page.getByRole("dialog", { name: "Paste the grid" });
  const grid = pasteDialog.getByLabel("Grid to paste");

  // An unknown test is refused at its header, and a value that is no number at its cell; the
  // preview marks each, and nothing is stored (WCAG 3.3.1). The paste takes no more test
  // columns than the catalogue has tests, so each case is its own paste.
  await grid.fill(`Sample\tNo such test ${id}\nS-101\t1`);
  await pasteDialog.getByRole("button", { name: "Save values" }).click();
  await expect(
    pasteDialog.getByText("1 part of the paste needs a fix. It is marked in the preview."),
  ).toBeVisible();
  const preview = pasteDialog.getByRole("region", { name: "Preview of the paste" });
  await expect(preview.getByRole("columnheader", { name: /No such test/ })).toContainText(
    `The catalogue has no active test named “No such test ${id}”.`,
  );
  await grid.fill(`Sample\t${testName}\nS-101\t5,250\nS-102\tlow`);
  await pasteDialog.getByRole("button", { name: "Save values" }).click();
  await expect(preview.getByRole("cell", { name: /^low/ })).toContainText("Enter a number");
  await expect(preview.getByRole("cell", { name: /^5,250/ })).toContainText("(stored as 5.25)");
  await axe(page);

  // The fixed grid is stored in one write; an empty cell is not requested.
  await grid.fill(`Sample\t${testName}\nS-101\t5,250\nS-102\t6.1\nS-103\t`);
  await pasteDialog.getByRole("button", { name: "Save values" }).click();
  await expect(pasteDialog).toBeHidden();
  // The page says what the paste stored in a status line, beside the toast (WCAG 4.1.3).
  await expect(
    page
      .getByRole("main")
      .getByRole("status")
      .filter({ hasText: "Correct values saved: 2 added, 0 changed, 0 unchanged." }),
  ).toBeVisible();
  // Focus returns to the opener, now in the page's header (WCAG 2.4.3).
  await expect(page.getByRole("button", { name: "Paste values" })).toBeFocused();
  await expect(cell(page, testName, "S-101")).toHaveAccessibleName(
    `${testName} of sample S-101: 5.250 mmol/L`,
  );
  await expect(page.getByRole("rowheader", { name: "S-103" })).toHaveCount(0);

  // Edit a cell with the keyboard alone: Enter edits, Escape cancels, Enter saves (WCAG 2.1.1).
  const s101 = cell(page, testName, "S-101");
  await s101.focus();
  await page.keyboard.press("Enter");
  const field = page.getByLabel(`Correct value of ${testName} for sample S-101`);
  await expect(field).toBeFocused();
  await page.keyboard.type("9");
  await page.keyboard.press("Escape");
  await expect(s101).toBeFocused();
  await expect(s101).toHaveAccessibleName(`${testName} of sample S-101: 5.250 mmol/L`);
  await page.keyboard.press("Enter");
  await expect(field).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("5.3");
  await page.keyboard.press("Enter");
  await expect(s101).toHaveAccessibleName(`${testName} of sample S-101: 5.3 mmol/L`);
  await expect(
    page
      .getByRole("main")
      .getByRole("status")
      .filter({ hasText: `Saved ${testName} of sample S-101: 5.3 mmol/L.` }),
  ).toBeVisible();
  await expect(s101).toBeFocused();
  // The arrow keys move between cells.
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, testName, "S-102")).toBeFocused();

  // An open editor with a refused value is axe-clean, and keeps focus in its field.
  await page.keyboard.press("Enter");
  const s102 = page.getByLabel(`Correct value of ${testName} for sample S-102`);
  await expect(s102).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("low");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Enter a number with at most 9 digits/)).toBeVisible();
  await expect(s102).toBeFocused();
  await axe(page);
  await page.keyboard.press("Escape");
  await expect(cell(page, testName, "S-102")).toBeFocused();

  // The page and the paste dialog reflow at 320 px (WCAG 1.4.10).
  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Paste values" }).click();
  const narrowPaste = page.getByRole("dialog", { name: "Paste the grid" });
  await narrowPaste.getByLabel("Grid to paste").fill(`Sample\t${testName}\nS-9\t1,5`);
  await expect(narrowPaste.getByRole("region", { name: "Preview of the paste" })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await narrowPaste.getByRole("button", { name: "Cancel" }).click();
  await page.setViewportSize({ width: 1280, height: 720 });

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
  const section = testHeader(page, testName);
  await expect(section).toContainText("No accuracy limits yet");
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
  await page.goto(`/teacher/catalogue?q=${encodeURIComponent(testName)}`);
  await expect(
    page.getByRole("table").getByRole("row").filter({ hasText: testName }),
  ).toContainText("In a running simulation");

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
  await cell(page, testName, "S-101").click();
  await expect(page.getByLabel(`Correct value of ${testName} for sample S-101`)).toBeEditable();
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
