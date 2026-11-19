// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The lab code and the student's labs (S10, #290): a teacher turns a lab's code on and sees it
// once, a student joins with it, a wrong code and a code of another lab of the simulation are
// refused at the field, the rate limit stops a guesser, the use count and a new code, the code
// turned off, and a student whose address waits lands in the lab from the overview. Axe in light,
// dark and Dutch, and reflow at 320 px. One journey: each step uses the labs the first step made.
import { randomBytes } from "node:crypto";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";
import { appUrl } from "./run-env";

test.describe.configure({ mode: "serial" });

const TEACHER = "teacher@example.test";
const STUDENT = "labcode-student@example.test";
const GUESSER = "labcode-guesser@example.test";
const WAITING = "labs-waiting@example.test";
const ID = randomBytes(4).toString("hex");
const SIMULATION = `Code journey ${ID}`;
const ALPHA = `Alpha ${ID}`;
const BETA = `Beta ${ID}`;
const CODE = /^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/;
/** A code of the right shape that no lab has (the odds of a match are about 1 in 10^15). */
const WRONG = "ZZZZZ-ZZZZ2";

let alphaUrl = "";
let betaUrl = "";
let alphaCode = "";
let betaCode = "";

async function preferences(context: BrowserContext, theme: "light" | "dark", locale: "en" | "nl") {
  await context.addCookies([
    { name: "EDULIMS_THEME", value: theme, url: appUrl() },
    { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
  ]);
}

function codePanel(page: Page) {
  return page.getByRole("region", { name: "Lab code", exact: true });
}

/** Signs in as a student and returns the join form of the overview, hydrated. */
async function joinForm(page: Page, email: string) {
  await devLogin(page, email);
  await expect(page).toHaveURL(/\/student$/);
  const form = page.getByRole("form", { name: "Join a lab with a code" });
  await expectHydrated(form.getByLabel("Lab code"));
  return form;
}

/** Sends the join form with Enter and waits for the server's answer. */
async function send(page: Page, field: ReturnType<Page["getByLabel"]>): Promise<void> {
  const answer = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("_serverFn"),
  );
  await field.press("Enter");
  await answer;
}

/** Turns the code of the open lab page on with the default settings and returns it. */
async function turnOn(page: Page): Promise<string> {
  const panel = codePanel(page);
  await panel.getByRole("button", { name: "Turn on lab code" }).click();
  const shown = panel.getByText(CODE);
  await expect(shown).toBeVisible();
  return (await shown.textContent()) ?? "";
}

async function createLab(page: Page, name: string): Promise<string> {
  const create = page.getByRole("button", { name: "Create lab" });
  await expectHydrated(create);
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Create a lab" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create lab" }).click();
  await expect(dialog).toBeHidden();
  const link = page.getByRole("link", { name, exact: true });
  const href = await link.getAttribute("href");
  if (href === null) throw new Error(`no link to lab ${name}`);
  return href;
}

async function openLab(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expectHydrated(codePanel(page).getByRole("button").first());
}

test("a teacher turns a lab's code on and sees it once (S10, #290)", async ({ page, context }) => {
  await preferences(context, "light", "en");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await devLogin(page, TEACHER);
  await page.goto("/teacher/simulations");
  const create = page.getByRole("button", { name: "Create simulation" });
  await expectHydrated(create);
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Create a simulation" });
  await dialog.getByLabel("Name").fill(SIMULATION);
  await dialog.getByRole("button", { name: "Create simulation" }).click();
  await expect(page.getByRole("heading", { level: 1, name: SIMULATION })).toBeVisible();
  alphaUrl = await createLab(page, ALPHA);
  betaUrl = await createLab(page, BETA);

  await openLab(page, alphaUrl, ALPHA);
  const panel = codePanel(page);
  await expect(panel.getByText("The lab code is off.", { exact: true })).toBeVisible();
  const form = panel.getByRole("form", { name: "Turn on the lab code" });
  await expect(form.getByLabel("Valid for (days)")).toHaveValue("7");
  await expect(form.getByLabel("Most students who can join")).toHaveValue("100");
  await form.getByLabel("Valid for (days)").fill("31");
  await form.getByRole("button", { name: "Turn on lab code" }).click();
  await expect(form.getByText("Enter a whole number of days from 1 to 30.")).toBeVisible();
  await expect(form.getByLabel("Valid for (days)")).toHaveAttribute("aria-invalid", "true");
  await axe(page);
  await form.getByLabel("Valid for (days)").fill("14");
  alphaCode = await turnOn(page);
  expect(alphaCode).toMatch(CODE);
  // The new code takes focus, so the teacher lands on it (WCAG 2.4.3).
  await expect(panel.getByRole("heading", { name: "The new lab code" })).toBeFocused();
  await expect(panel.getByText(/^On until /)).toBeVisible();
  await expect(panel.getByText("0 of 100 students joined with this code.")).toBeVisible();

  // Copying is announced as a status message (WCAG 4.1.3).
  await panel.getByRole("button", { name: "Copy code" }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Code copied." })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(alphaCode);
  await axe(page);

  // After a reload only the hash is left: the state shows, the code does not.
  await page.reload();
  await expect(panel.getByText(/^On until /)).toBeVisible();
  await expect(panel.getByText(CODE)).toHaveCount(0);
  await expect(panel.getByText(/showed the code once, when it was made/)).toBeVisible();

  // Beta gets a code of its own, for the refusal of a second lab in one simulation.
  await openLab(page, betaUrl, BETA);
  betaCode = await turnOn(page);
  expect(betaCode).toMatch(CODE);
});

test("a student joins with the code; a wrong code is refused at the field (S10)", async ({
  page,
}) => {
  expect(alphaCode).toMatch(CODE);
  const form = await joinForm(page, STUDENT);
  const labs = page.getByRole("region", { name: "Your labs" });
  await expect(labs.getByText(ALPHA, { exact: true })).toHaveCount(0);
  await axe(page);

  // An empty code and one of the wrong shape are refused before anything is sent.
  const field = form.getByLabel("Lab code");
  await expect(field).toHaveAccessibleDescription(/such as ABCDE-FGH23/);
  await form.getByRole("button", { name: "Join lab" }).click();
  await expect(form.getByText("Enter the lab code your teacher gave you.")).toBeVisible();
  await field.fill("ABC");
  await form.getByRole("button", { name: "Join lab" }).click();
  await expect(
    form.getByText("A lab code has 10 letters and digits, such as ABCDE-FGH23."),
  ).toBeVisible();

  await field.fill(WRONG);
  await send(page, field);
  await expect(
    form.getByText("This code does not work. Check it with your teacher."),
  ).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await axe(page);

  await field.fill(alphaCode.toLowerCase().replace("-", " "));
  await send(page, field);
  await expect(page.getByText(`You joined lab ${ALPHA} of ${SIMULATION}.`)).toBeVisible();
  await expect(labs.getByText(ALPHA, { exact: true })).toBeVisible();
  await expect(labs.getByText(`Simulation: ${SIMULATION}`, { exact: true })).toBeVisible();
  await expect(field).toHaveValue("");

  await field.fill(alphaCode);
  await send(page, field);
  await expect(page.getByText(`You are already in lab ${ALPHA} of ${SIMULATION}.`)).toBeVisible();
});

test("a code of another lab of the same simulation is refused at the field (S10, #288)", async ({
  page,
}) => {
  expect(betaCode).toMatch(CODE);
  const form = await joinForm(page, STUDENT);
  const field = form.getByLabel("Lab code");
  await field.fill(betaCode);
  await send(page, field);
  await expect(form.getByText("You are already in another lab of this simulation.")).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const labs = page.getByRole("region", { name: "Your labs" });
  await expect(labs.getByText(BETA, { exact: true })).toHaveCount(0);
  await expect(labs.getByText(ALPHA, { exact: true })).toBeVisible();
});

test("the rate limit stops a student who guesses (S10, ASVS V2.4.1)", async ({ page }) => {
  expect(alphaCode).toMatch(CODE);
  const form = await joinForm(page, GUESSER);
  const field = form.getByLabel("Lab code");
  const limited = form.getByText("Too many wrong codes. Wait a while, then try again.");
  // The per-student limit is 10 wrong codes; a retried run may already be over it.
  for (let i = 0; i < 11 && !(await limited.isVisible()); i += 1) {
    await field.fill(WRONG);
    await send(page, field);
    await expect(form.getByText(/This code does not work|Too many wrong codes/)).toBeVisible();
  }
  await expect(limited).toBeVisible();
  // Over the limit, even the right code is refused and the student joins nothing.
  await field.fill(alphaCode);
  await send(page, field);
  await expect(limited).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(`You joined lab ${ALPHA}`)).toHaveCount(0);
  await axe(page);
});

test("the teacher sees the join counted and makes a new code (S10, #290)", async ({
  page,
  context,
}) => {
  await preferences(context, "dark", "en");
  await devLogin(page, TEACHER);
  await openLab(page, alphaUrl, ALPHA);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  const panel = codePanel(page);
  await expect(panel.getByText("1 of 100 students joined with this code.")).toBeVisible();

  // Cancelling the new code changes nothing and gives focus back to its button.
  const regenerate = panel.getByRole("button", { name: "New code" });
  await regenerate.click();
  const dialog = page.getByRole("dialog", { name: `Make a new code for lab ${ALPHA}?` });
  await expect(dialog.getByText("The current code stops working at once.")).toBeVisible();
  await axe(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(regenerate).toBeFocused();

  await regenerate.click();
  await dialog.getByRole("button", { name: "Make new code" }).click();
  await expect(dialog).toBeHidden();
  const shown = panel.getByText(CODE);
  await expect(shown).toBeVisible();
  const fresh = (await shown.textContent()) ?? "";
  expect(fresh).toMatch(CODE);
  expect(fresh).not.toBe(alphaCode);
  await expect(panel.getByRole("heading", { name: "The new lab code" })).toBeFocused();
  await expect(panel.getByText("0 of 100 students joined with this code.")).toBeVisible();
  await axe(page);

  // The old code stopped working at once.
  const old = alphaCode;
  alphaCode = fresh;
  await context.clearCookies();
  const form = await joinForm(page, STUDENT);
  const field = form.getByLabel("Lab code");
  await field.fill(old);
  await send(page, field);
  await expect(
    form.getByText("This code does not work. Check it with your teacher."),
  ).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`the code panel and the student's overview are axe-clean in Dutch, ${theme} (E2)`, async ({
    page,
    context,
  }) => {
    // The dev login form is English; the Dutch preference applies from the next page on.
    await devLogin(page, TEACHER);
    await preferences(context, theme, "nl");
    await page.goto(alphaUrl);
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
    const panel = page.getByRole("region", { name: dutch("labs_code_heading"), exact: true });
    await expect(panel.getByRole("button", { name: dutch("labs_code_regenerate") })).toBeVisible();
    await expect(panel.getByText(dutch("labs_code_hidden"))).toBeVisible();
    await axe(page);

    await context.clearCookies();
    await devLogin(page, STUDENT);
    await preferences(context, theme, "nl");
    await page.goto("/student");
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    await expect(
      page
        .getByRole("region", { name: dutch("student_labs_heading") })
        .getByText(ALPHA, { exact: true }),
    ).toBeVisible();
    const form = page.getByRole("form", { name: dutch("labs_join_heading") });
    await expectHydrated(form.getByLabel(dutch("labs_join_field")));
    await form.getByRole("button", { name: dutch("labs_join_submit") }).click();
    await expect(form.getByText(dutch("labs_join_code_required"))).toBeVisible();
    await axe(page);
  });
}

test("the overview and the lab page reflow at 320 px without horizontal scrolling (WCAG 1.4.10)", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  await devLogin(page, STUDENT);
  await expect(page.getByRole("region", { name: "Your labs" }).getByText(ALPHA)).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await context.clearCookies();
  await devLogin(page, TEACHER);
  await openLab(page, alphaUrl, ALPHA);
  await codePanel(page).scrollIntoViewIfNeeded();
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test("the teacher turns the code off and it stops working (S10)", async ({ page, context }) => {
  await devLogin(page, TEACHER);
  await openLab(page, alphaUrl, ALPHA);
  const panel = codePanel(page);
  await panel.getByRole("button", { name: "Turn off", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: `Turn off the code of lab ${ALPHA}?` });
  // The safe choice takes the first focus (WCAG 3.3.4).
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await axe(page);
  await confirm.getByRole("button", { name: "Turn off code" }).click();
  await expect(panel.getByText("The lab code is off.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Lab code", exact: true }),
  ).toBeFocused();
  await expect(panel.getByRole("form", { name: "Turn on the lab code" })).toBeVisible();

  await context.clearCookies();
  const form = await joinForm(page, STUDENT);
  const field = form.getByLabel("Lab code");
  await field.fill(alphaCode);
  await send(page, field);
  await expect(
    form.getByText("This code does not work. Check it with your teacher."),
  ).toBeVisible();
});

test("a signed-in student whose address a teacher adds lands in the lab from the overview (S10)", async ({
  page,
  browser,
}) => {
  // The student signs in first, while their address waits nowhere.
  const studentContext = await browser.newContext();
  const student = await studentContext.newPage();
  await devLogin(student, WAITING);
  await expect(student).toHaveURL(/\/student$/);
  await expect(
    student.getByRole("region", { name: "Your labs" }).getByText(BETA, { exact: true }),
  ).toHaveCount(0);

  // The teacher adds the address to Beta.
  await devLogin(page, TEACHER);
  await openLab(page, betaUrl, BETA);
  const list = page.getByLabel("Email addresses", { exact: true });
  await expectHydrated(list);
  await list.fill(WAITING);
  await list.press("Enter");
  await page.getByRole("button", { name: "Check the list" }).click();
  await page.getByRole("button", { name: "Add the new addresses (1)" }).click();
  await expect(page.getByText(`Addresses now waiting for lab ${BETA}: 1.`)).toBeVisible();

  // Opening the overview again links the address, with no second sign-in (S10).
  await student.goto("/student");
  const labs = student.getByRole("region", { name: "Your labs" });
  await expect(labs.getByText(BETA, { exact: true })).toBeVisible();
  await expect(student.getByText("Labs your teacher added you to: 1.")).toBeVisible();
  await studentContext.close();

  await page.reload();
  await expect(
    page
      .getByRole("table", { name: `Students of lab ${BETA}` })
      .getByRole("cell", { name: "Waiting Address Test Student", exact: true }),
  ).toBeVisible();
});
