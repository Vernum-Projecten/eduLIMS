// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The teacher's simulation screens (D10, S10, #289, #381): a simulation with two labs, a pasted
// list whose outcome shows per line before anything is stored, a student who lands in the lab at
// sign-in, moving and removing with the keyboard alone, the error state with its retry, axe in
// light, dark and Dutch on every page of a simulation, and reflow at 320 px.
import { randomBytes } from "node:crypto";
import { type BrowserContext, expect, type Page, type Route, test } from "@playwright/test";
import { copyAccount } from "./accounts";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated, pressUntilFocused } from "./fixtures";
import { appUrl } from "./run-env";

const TEACHER = "teacher@example.test";
const STUDENT = "student@example.test";

/** A suffix no other run of a journey uses, so parallel and repeated runs never meet. */
function suffix(): string {
  return randomBytes(4).toString("hex");
}

async function signInAsTeacher(page: Page): Promise<void> {
  await devLogin(page, TEACHER);
  await expect(page).toHaveURL(/\/teacher$/);
}

/** Waits for every animation (a dialog, a toast) so axe and focus checks see the end state. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
}

/** Creates a simulation from the list page and returns its id, read from the page it lands on. */
async function createSimulation(page: Page, name: string): Promise<string> {
  await page.goto("/teacher/simulations");
  const create = page.getByRole("button", { name: "Create simulation" });
  await expectHydrated(create);
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Create a simulation" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create simulation" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(simulationNav(page, name)).toBeVisible();
  const id = /\/teacher\/simulations\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
  if (id === undefined) throw new Error(`no simulation id in ${page.url()}`);
  return id;
}

/** The navigation between the pages of the simulation `name` (#381). */
function simulationNav(page: Page, name: string) {
  return page.getByRole("navigation", { name: `Pages of ${name}` });
}

/** Opens a page of the simulation from its navigation and waits for its focused h1 (#381). */
async function openPage(page: Page, simulation: string, label: string): Promise<void> {
  const link = simulationNav(page, simulation).getByRole("link", { name: label, exact: true });
  await expectHydrated(link);
  await link.click();
  const heading = page.getByRole("heading", { level: 1, name: label, exact: true });
  await expect(heading).toBeVisible();
  await expect(link).toHaveAttribute("aria-current", "page");
}

async function createLab(page: Page, name: string): Promise<void> {
  const create = page.getByRole("button", { name: "Create lab" });
  await expectHydrated(create);
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Create a lab" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create lab" }).click();
  await expect(dialog).toBeHidden();
  await expect(labsTable(page).getByRole("link", { name, exact: true })).toBeVisible();
}

function labsTable(page: Page) {
  return page.getByRole("table", { name: /^Labs of / });
}

async function openLab(page: Page, name: string): Promise<void> {
  await labsTable(page).getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/** Types a list into the paste panel and checks it; nothing is stored yet. */
async function checkList(page: Page, lines: readonly string[]): Promise<void> {
  const field = page.getByLabel("Email addresses", { exact: true });
  await expectHydrated(field);
  await field.fill(lines.join("\n"));
  await field.press("Enter");
  await page.getByRole("button", { name: "Check the list" }).click();
  await expect(page.getByRole("table", { name: "Outcome per line" })).toBeVisible();
}

function outcomeRow(page: Page, address: string) {
  return page
    .getByRole("table", { name: "Outcome per line" })
    .getByRole("row")
    .filter({ hasText: address });
}

function membersTable(page: Page) {
  return page.getByRole("table", { name: /^Students of lab / });
}

function waitingTable(page: Page) {
  return page.getByRole("table", { name: /^Addresses waiting for lab / });
}

test("a teacher prepares a simulation with a lab of six, and the student lands in it (D10, S10)", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const id = suffix();
  // NOTE: #379; a student of its own, since one in another unfinished simulation cannot be added.
  const student = await copyAccount("student@example.test", "journey-student");
  const simulation = `Journey simulation ${id}`;
  const alpha = `Alpha ${id}`;
  const beta = `Beta ${id}`;
  const taken = `taken.${id}@example.test`;
  const invented = [1, 2, 3, 4, 5].map((n) => `member${n}.${id}@example.test`);

  await signInAsTeacher(page);
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("link", { name: "Simulations" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Simulations" })).toBeVisible();
  await expect(page).toHaveTitle("Simulations | Teacher portal | eduLIMS");

  // An empty name is refused at its field before anything is sent.
  await page.getByRole("button", { name: "Create simulation" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create a simulation" });
  await createDialog.getByRole("button", { name: "Create simulation" }).click();
  await expect(createDialog.getByText("Enter a name for the simulation.")).toBeVisible();
  await axe(page);
  await createDialog.getByRole("button", { name: "Cancel" }).click();

  const simulationId = await createSimulation(page, simulation);
  await expect(page).toHaveTitle(`${simulation} | Simulations | Teacher portal | eduLIMS`);
  // The overview's checklist names the first missing step and links to its page (#381).
  await expect(page.getByText("Next step: Labs and students.")).toBeVisible();
  await expect(page.getByText("No labs yet. Create a lab for each team.")).toBeVisible();
  await axe(page);
  await openPage(page, simulation, "Labs");
  await expect(page).toHaveTitle(`Labs | ${simulation} | Simulations | Teacher portal | eduLIMS`);
  // A navigation inside the simulation moves focus to the new page's h1 (WCAG 2.4.3).
  await expect(page.getByRole("heading", { level: 1, name: "Labs" })).toBeFocused();
  await expect(page.getByText("No labs yet", { exact: true })).toBeVisible();
  await createLab(page, alpha);
  await createLab(page, beta);

  // A lab name is unique within the simulation, whatever its case; the refusal is at the field.
  await page.getByRole("button", { name: "Create lab" }).click();
  const labDialog = page.getByRole("dialog", { name: "Create a lab" });
  await labDialog.getByLabel("Name").fill(alpha.toUpperCase());
  await labDialog.getByRole("button", { name: "Create lab" }).click();
  await expect(
    labDialog.getByText("Another lab of this simulation already has this name."),
  ).toBeVisible();
  await labDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(labDialog).toBeHidden();

  // A lab deleted from its row menu: focus goes to the page's Labs heading (WCAG 2.4.3).
  const delta = `Delta ${id}`;
  await createLab(page, delta);
  await page.getByRole("button", { name: `Actions for ${delta}` }).click();
  await page.getByRole("menuitem", { name: "Delete lab" }).click();
  const deleteDelta = page.getByRole("alertdialog", { name: `Delete lab ${delta}?` });
  await axe(page);
  await deleteDelta.getByRole("button", { name: "Delete lab" }).click();
  await expect(labsTable(page).getByRole("link", { name: delta })).toHaveCount(0);
  await settle(page);
  await expect(page.getByRole("heading", { level: 1, name: "Labs", exact: true })).toBeFocused();

  // One address waits in Beta, so the list for Alpha can name it as taken.
  await openLab(page, beta);
  await checkList(page, [taken]);
  await page.getByRole("button", { name: "Add the new addresses (1)" }).click();
  await expect(waitingTable(page).getByRole("cell", { name: taken, exact: true })).toBeVisible();

  await openPage(page, simulation, "Labs");
  await openLab(page, alpha);
  await expect(page.getByText("No students in this lab yet", { exact: true })).toBeVisible();
  await checkList(page, [student.email, ...invented, "not-an-address", taken]);
  await expect(page.getByText("Checked: 6 can be added, 2 cannot.").first()).toBeAttached();
  await expect(outcomeRow(page, "not-an-address")).toContainText("Not added: not an email address");
  await expect(outcomeRow(page, taken)).toContainText(`Not added: already in lab ${beta}`);
  await expect(outcomeRow(page, student.email)).toContainText("Will be added");
  // The outcome is a preview: nothing waits for Alpha yet.
  await expect(page.getByText("No addresses are waiting", { exact: true })).toBeVisible();
  await axe(page);

  await page.getByRole("button", { name: "Add the new addresses (6)" }).click();
  await expect(page.getByText(`Addresses now waiting for lab ${alpha}: 6.`)).toBeVisible();
  await expect(waitingTable(page).getByRole("row")).toHaveCount(7);
  await expect(page.getByRole("table", { name: "Outcome per line" })).toHaveCount(0);
  await expect(page.getByLabel("Email addresses", { exact: true })).toBeFocused();
  await expect(page.getByRole("form", { name: "Addresses to check" })).toBeVisible();

  // The student signs in elsewhere and is linked to Alpha at sign-in (S10).
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await devLogin(studentPage, student.email);
  await studentContext.close();
  await page.reload();
  await expect(
    membersTable(page).getByRole("cell", { name: student.name, exact: true }),
  ).toBeVisible();
  await expect(membersTable(page)).toContainText("By email address");
  await expect(waitingTable(page).getByRole("row")).toHaveCount(6);

  const waiting = invented[0] ?? "";
  const removeWaiting = page.getByRole("button", { name: `Remove ${waiting}` });
  await expectHydrated(removeWaiting);
  await removeWaiting.click();
  await page
    .getByRole("alertdialog", { name: `Remove ${waiting}?` })
    .getByRole("button", { name: "Remove address" })
    .click();
  await expect(page.getByText(`${waiting} no longer waits for this lab.`)).toBeVisible();
  await expect(waitingTable(page).getByRole("row")).toHaveCount(5);
  await settle(page);
  await expect(
    page.getByRole("heading", { level: 2, name: "Waiting addresses", exact: true }),
  ).toBeFocused();

  // A simulation with a student in a lab cannot be deleted; the refusal says why.
  await openPage(page, simulation, "Settings");
  await page.getByRole("button", { name: "Delete simulation" }).click();
  await page
    .getByRole("alertdialog", { name: `Delete ${simulation}?` })
    .getByRole("button", { name: "Delete simulation" })
    .click();
  const refusal = page.getByText("This simulation has students in its labs");
  await expect(refusal).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  // An error toast stays past Sonner's 4 s until it is closed (WCAG 2.2.1, #328).
  await page.waitForTimeout(5_000);
  await expect(refusal).toBeVisible();
  await page
    .getByRole("region", { name: /Notifications/ })
    .getByRole("button", { name: "Close" })
    .click();
  await expect(refusal).toHaveCount(0);

  // Move the student to Beta with the keyboard alone (WCAG 2.1.1).
  await openPage(page, simulation, "Labs");
  await openLab(page, alpha);
  const actions = page.getByRole("button", { name: `Actions for ${student.name}` });
  await expectHydrated(actions);
  await actions.focus();
  await page.keyboard.press("Enter");
  const move = page.getByRole("menuitem", { name: "Move to another lab" });
  await pressUntilFocused(page, "ArrowDown", move);
  await page.keyboard.press("Enter");
  const moveDialog = page.getByRole("dialog", { name: `Move ${student.name}` });
  await expect(moveDialog.getByRole("radio", { name: beta })).toBeChecked();
  await axe(page);
  await pressUntilFocused(page, "Tab", moveDialog.getByRole("button", { name: "Move student" }), 6);
  await page.keyboard.press("Enter");
  await expect(page.getByText(`${student.name} moved to lab ${beta}.`)).toBeVisible();
  await expect(page.getByText("No students in this lab yet", { exact: true })).toBeVisible();
  await settle(page);
  await expect(
    page.getByRole("heading", { level: 2, name: "Students", exact: true }),
  ).toBeFocused();

  // Remove the student from the simulation with the keyboard alone, after a confirmation.
  await openPage(page, simulation, "Labs");
  await openLab(page, beta);
  const betaActions = page.getByRole("button", { name: `Actions for ${student.name}` });
  await expectHydrated(betaActions);
  await betaActions.focus();
  await page.keyboard.press("Enter");
  const remove = page.getByRole("menuitem", { name: "Remove from the simulation" });
  await pressUntilFocused(page, "ArrowDown", remove);
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog", {
    name: `Remove ${student.name} from the simulation?`,
  });
  // The safe choice takes the first focus (WCAG 3.3.4).
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await axe(page);
  await pressUntilFocused(page, "Tab", confirm.getByRole("button", { name: "Remove student" }));
  await page.keyboard.press("Enter");
  await expect(page.getByText(`${student.name} removed from the simulation.`)).toBeVisible();
  await expect(page.getByText("No students in this lab yet", { exact: true })).toBeVisible();
  await settle(page);
  await expect(
    page.getByRole("heading", { level: 2, name: "Students", exact: true }),
  ).toBeFocused();

  // Rename the lab from its menu with the keyboard alone; focus returns to the menu's button.
  const renamed = `Gamma ${id}`;
  const labMenu = page.getByRole("button", { name: `Actions for ${beta}` });
  await labMenu.focus();
  await page.keyboard.press("Enter");
  await pressUntilFocused(page, "ArrowDown", page.getByRole("menuitem", { name: "Rename" }));
  await page.keyboard.press("Enter");
  const renameDialog = page.getByRole("dialog", { name: `Rename lab ${beta}` });
  const nameField = renameDialog.getByLabel("Name");
  await pressUntilFocused(page, "Tab", nameField);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(renamed);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
  await settle(page);
  await expect(page.getByRole("button", { name: `Actions for ${renamed}` })).toBeFocused();

  // Delete the lab, which lands on the labs, then the simulation, each after a confirmation.
  await page.getByRole("button", { name: `Actions for ${renamed}` }).click();
  await page.getByRole("menuitem", { name: "Delete lab" }).click();
  await page
    .getByRole("alertdialog", { name: `Delete lab ${renamed}?` })
    .getByRole("button", { name: "Delete lab" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Labs" })).toBeVisible();
  await expect(labsTable(page).getByRole("link", { name: renamed })).toHaveCount(0);
  await openPage(page, simulation, "Settings");
  await page.getByRole("button", { name: "Delete simulation" }).click();
  await page
    .getByRole("alertdialog", { name: `Delete ${simulation}?` })
    .getByRole("button", { name: "Delete simulation" })
    .click();
  await expect(page).toHaveURL(/\/teacher\/simulations$/);
  await expect(page.getByRole("link", { name: simulation })).toHaveCount(0);
  await page.goto(`/teacher/simulations/${simulationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
  await expect(page).toHaveTitle("Not found | Simulations | Teacher portal | eduLIMS");
});

/** Makes every server function read whose payload carries `text` fail with a 500. */
async function failReadsWith(page: Page, text: string): Promise<() => Promise<void>> {
  const pattern = "**/_serverFn/**";
  const handler = (route: Route) => {
    const request = route.request();
    return request.method() === "GET" && decodeURIComponent(request.url()).includes(text)
      ? route.fulfill({ status: 500, body: "forced failure" })
      : route.fallback();
  };
  await page.route(pattern, handler);
  return () => page.unroute(pattern, handler);
}

test("a simulation page that fails to load shows the error state, and its retry recovers (#289)", async ({
  page,
}) => {
  const name = `Error state ${suffix()}`;
  await signInAsTeacher(page);
  const simulationId = await createSimulation(page, name);
  await page.goto("/teacher/simulations");
  const link = page.getByRole("link", { name, exact: true });
  await expectHydrated(link);

  const restore = await failReadsWith(page, simulationId);
  await link.click();
  const heading = page.getByRole("heading", { level: 1, name: "Something went wrong" });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("An unexpected error occurred.");
  await axe(page);

  await restore();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(simulationNav(page, name)).toBeVisible();
});

test("another teacher's simulation answers not found (D11)", async ({ page, browser }) => {
  const name = `Private ${suffix()}`;
  await signInAsTeacher(page);
  const simulationId = await createSimulation(page, name);
  const context = await browser.newContext();
  const other = await context.newPage();
  await devLogin(other, "teacher-admin@example.test");
  await other.goto(`/teacher/simulations/${simulationId}`);
  await expect(other.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
  await expect(other).toHaveTitle("Not found | Simulations | Teacher portal | eduLIMS");
  await expect(other.getByText(name)).toHaveCount(0);
  // Every page of the simulation answers the same (#381).
  for (const path of ["labs", "values", "corrections", "settings", `labs/${simulationId}`]) {
    await other.goto(`/teacher/simulations/${simulationId}/${path}`);
    await expect(other.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
    await expect(other).toHaveTitle("Not found | Simulations | Teacher portal | eduLIMS");
    await expect(other.getByText(name)).toHaveCount(0);
  }
  await context.close();
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
  test(`the three screens are axe-clean in ${theme}, ${locale} (Q-ACC-1)`, async ({
    page,
    context,
  }) => {
    const t = (key: string, english: string) => (locale === "nl" ? dutch(key) : english);
    await signInAsTeacher(page);
    await usePreferences(context, theme, locale);

    // The seeded demo simulation of the dev teacher: Lab Aurora has six students.
    await page.goto("/teacher/simulations");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
    await expect(
      page.getByRole("heading", { level: 1, name: t("nav_simulations", "Simulations") }),
    ).toBeVisible();
    await axe(page);
    const simulationLink = page.getByRole("link", { name: "Demo simulation", exact: true });
    await expectHydrated(simulationLink);
    await simulationLink.click();
    const nav = page.getByRole("navigation", {
      name: t("simulation_nav_label", "Pages of {name}").replace("{name}", "Demo simulation"),
    });
    await expect(nav).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: t("simulation_nav_overview", "Overview") }),
    ).toBeVisible();
    await axe(page);
    // Every page of the simulation, in the order of its navigation (#381).
    for (const [key, english] of [
      ["simulation_nav_values", "Correct values"],
      ["simulation_nav_corrections", "Corrections"],
      ["simulation_nav_settings", "Settings"],
      ["simulation_nav_labs", "Labs"],
    ] as const) {
      const label = t(key, english);
      const link = nav.getByRole("link", { name: label, exact: true });
      await expectHydrated(link);
      await link.click();
      await expect(page.getByRole("heading", { level: 1, name: label, exact: true })).toBeFocused();
      await axe(page);
    }
    await page.getByRole("link", { name: "Lab Aurora", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Lab Aurora" })).toBeVisible();
    await expect(
      page
        .getByRole("table", {
          name: t("labs_members_caption", "Students of lab {lab}").replace("{lab}", "Lab Aurora"),
        })
        .getByRole("row"),
    ).toHaveCount(7);
    // The outcome of a list is part of the screen too; checking it stores nothing.
    const field = page.getByLabel(t("labs_paste_label", "Email addresses"), { exact: true });
    await expectHydrated(field);
    await field.fill(`not-an-address\n${STUDENT}`);
    await field.press("Enter");
    await page.getByRole("button", { name: t("labs_paste_check", "Check the list") }).click();
    await expect(
      page.getByRole("table", { name: t("labs_paste_caption", "Outcome per line") }),
    ).toBeVisible();
    await axe(page);
  });
}

test("the three screens reflow at 320 px without horizontal scrolling (WCAG 1.4.10)", async ({
  page,
}) => {
  await signInAsTeacher(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/teacher/simulations");
  // Each step: the link to follow, then the h1 it lands on (#381).
  const steps = [
    [null, "Simulations"],
    ["Demo simulation", "Overview"],
    ["Correct values", "Correct values"],
    ["Corrections", "Corrections"],
    ["Settings", "Settings"],
    ["Labs", "Labs"],
    ["Lab Aurora", "Lab Aurora"],
  ] as const;
  for (const [link, heading] of steps) {
    if (link) {
      const target = page.getByRole("link", { name: link, exact: true }).first();
      await expectHydrated(target);
      await target.click();
    }
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, heading).toBeLessThanOrEqual(0);
  }
});

test("a student who opens the teacher's simulations lands on the Student portal (D11, A01)", async ({
  page,
}) => {
  await devLogin(page, STUDENT);
  await page.goto("/teacher/simulations");
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole("heading", { level: 1, name: "Student portal" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Simulations" })).toHaveCount(0);
});

test("the administrator's simulations entry opens its page, axe-clean (B5, #291)", async ({
  page,
}) => {
  await devLogin(page, "admin@example.test");
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("link", { name: "Simulations" })
    .click();
  await expect(page).toHaveURL(/\/admin\/simulations$/);
  await expect(page.getByRole("heading", { level: 1, name: "Simulations" })).toBeVisible();
  await expect(page).toHaveTitle("Simulations | Admin portal | eduLIMS");
  await axe(page);
});

test("a pasted address that is too long is refused at the field, naming its place (#328, #357)", async ({
  page,
}) => {
  await signInAsTeacher(page);
  await page.goto("/teacher/simulations");
  const simulationLink = page.getByRole("link", { name: "Demo simulation", exact: true });
  await expectHydrated(simulationLink);
  await simulationLink.click();
  await openPage(page, "Demo simulation", "Labs");
  await page.getByRole("link", { name: "Lab Aurora", exact: true }).click();
  const field = page.getByLabel("Email addresses", { exact: true });
  await expectHydrated(field);
  const long = `${"y".repeat(320)}@example.test`;
  await field.fill(long);
  await field.press("Enter");
  await page.getByRole("button", { name: "Check the list" }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Address 1 is longer than 320 characters.")).toBeVisible();
  await expect(page.getByRole("table", { name: "Outcome per line" })).toHaveCount(0);
});

test("a teacher adds, removes and leaves as a teacher of a simulation (D10, #328)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const id = suffix();
  const name = `Teachers ${id}`;
  await signInAsTeacher(page);
  await createSimulation(page, name);
  await openPage(page, name, "Settings");
  const teachers = page.getByRole("table", { name: `Teachers of ${name}` });
  const opener = page.getByRole("button", { name: "Add teacher" });
  const dialog = page.getByRole("dialog", { name: "Add a teacher" });
  const form = dialog.getByRole("form", { name: "Add a teacher" });
  const address = form.getByLabel("Email address of the teacher");
  await expectHydrated(opener);
  await opener.click();

  // A student's address and an unknown one get the same answer at the field: no account is
  // revealed.
  for (const email of [STUDENT, `nobody.${id}@example.test`]) {
    await address.fill(email);
    await form.getByRole("button", { name: "Add teacher" }).click();
    await expect(form.getByText("No teacher account uses this address.")).toBeVisible();
    await expect(address).toHaveAttribute("aria-invalid", "true");
  }
  await axe(page);

  // An added teacher closes the dialog, and focus returns to its opener (WCAG 2.4.3).
  await address.fill("teacher-admin@example.test");
  await form.getByRole("button", { name: "Add teacher" }).click();
  await expect(dialog).toBeHidden();
  await expect(teachers.getByRole("cell", { name: "Test Coordinator", exact: true })).toBeVisible();
  await settle(page);
  await expect(opener).toBeFocused();
  await opener.click();
  await address.fill("teacher-admin@example.test");
  await form.getByRole("button", { name: "Add teacher" }).click();
  await expect(form.getByText("This person already teaches this simulation.")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  // Removing a teacher from the row's menu asks first, and focus goes to the Teachers heading.
  await page.getByRole("button", { name: "Actions for Test Coordinator" }).click();
  await page.getByRole("menuitem", { name: "Remove Test Coordinator" }).click();
  const remove = page.getByRole("alertdialog", { name: "Remove Test Coordinator as a teacher?" });
  await axe(page);
  await remove.getByRole("button", { name: "Remove teacher" }).click();
  await expect(teachers.getByRole("cell", { name: "Test Coordinator", exact: true })).toHaveCount(
    0,
  );
  await settle(page);
  await expect(
    page.getByRole("heading", { level: 2, name: "Teachers", exact: true }),
  ).toBeFocused();

  // With a second teacher back, the teacher leaves and lands on their list without it.
  await opener.click();
  await address.fill("teacher-admin@example.test");
  await form.getByRole("button", { name: "Add teacher" }).click();
  await expect(teachers.getByRole("cell", { name: "Test Coordinator", exact: true })).toBeVisible();
  await teachers.getByRole("row").filter({ hasText: "You" }).getByRole("button").click();
  // The keyboard picks the item: the toasts of the last two actions may cover the open menu.
  await pressUntilFocused(
    page,
    "ArrowDown",
    page.getByRole("menuitem", { name: "Leave this simulation" }),
  );
  await page.keyboard.press("Enter");
  await page
    .getByRole("alertdialog", { name: "Leave this simulation?" })
    .getByRole("button", { name: "Leave simulation" })
    .click();
  await expect(page).toHaveURL(/\/teacher\/simulations$/);
  await expect(page.getByText("You left the simulation.")).toBeVisible();
  await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
});

test("an identity provider that does not exist has a not-found title (WCAG 2.4.2, #328)", async ({
  page,
}) => {
  await devLogin(page, "admin@example.test");
  await page.goto("/admin/system/identity-providers/does-not-exist");
  await expect(page.getByRole("alert")).toContainText("This provider no longer exists.");
  await expect(page).toHaveTitle(/^Provider not found \| /);
});
