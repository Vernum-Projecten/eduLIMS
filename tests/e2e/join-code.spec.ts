// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The class join code (#49): a teacher turns the code on, a student joins with it, a wrong code
// is refused, the rate limit stops a guesser, and the axe scan in the light and dark theme and
// in Dutch. One journey: each step uses the class and the code the first step made.
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated, expectNoA11yViolations } from "./fixtures";
import { appUrl } from "./run-env";

test.describe.configure({ mode: "serial" });

/** Where the journey saves screenshots, when the caller asks for them. */
const SHOTS = process.env["E2E_SHOTS_DIR"]?.trim();

const OWNER = "joincode-owner@example.test";
const STUDENT = "joincode-student@example.test";
const GUESSER = "joincode-guesser@example.test";
const CLASS = `JC-${Date.now().toString(36).slice(-5).toUpperCase()}`;
const CODE = /^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/;
/** A code of the right shape that no class has (the odds of a match are about 1 in 10^15). */
const WRONG = "ZZZZZ-ZZZZ2";

let code = "";

async function axe(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  await expectNoA11yViolations(page);
}

async function preferences(context: BrowserContext, theme: "light" | "dark", locale: "en" | "nl") {
  await context.addCookies([
    { name: "EDULIMS_THEME", value: theme, url: appUrl() },
    { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
  ]);
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** Opens the invitations tab of the journey's class as its owner. */
async function openInvitations(page: Page, tab = /^Invitations/): Promise<void> {
  await devLogin(page, OWNER);
  await expect(page).toHaveURL(/\/teacher$/);
  await page.goto("/teacher/classes");
  await page
    .getByRole("link", { name: new RegExp(`^${CLASS}`) })
    .first()
    .click();
  await expectHydrated(page.getByRole("tablist"));
  await page.getByRole("tab", { name: tab }).click();
}

/** Signs in as a student and returns the join form of the overview. */
async function joinForm(page: Page, email: string, name = "Join a class") {
  await devLogin(page, email);
  await expect(page).toHaveURL(/\/student$/);
  const form = page.getByRole("form", { name });
  await expectHydrated(form);
  return form;
}

test("a teacher turns the join code on and sees it once (#49)", async ({ page, context }) => {
  await preferences(context, "light", "en");
  await devLogin(page, OWNER);
  await expect(page).toHaveURL(/\/teacher$/);
  await page.goto("/teacher/classes");
  const create = page.getByRole("button", { name: "New class" });
  await expectHydrated(create);
  await create.click();
  const dialog = page.getByRole("dialog", { name: "New class" });
  await dialog.getByLabel("Class name").fill(CLASS);
  await dialog.getByLabel("Academic year").fill("2026-2027");
  await dialog.getByRole("button", { name: "Create class" }).click();
  await expect(page).toHaveURL(/\/teacher\/classes\/[0-9a-f-]{36}$/);
  await expectHydrated(page.getByRole("tablist"));
  await page.getByRole("tab", { name: /^Invitations/ }).click();

  const section = page.getByRole("region", { name: "Join code" });
  await expect(section.getByText("The join code is off.")).toBeVisible();
  const form = section.getByRole("form", { name: "Join code" });
  await expect(form.getByLabel("Valid for (days)")).toHaveValue("7");
  await expect(form.getByLabel("Most students who can join")).toHaveValue("100");
  await form.getByLabel("Valid for (days)").fill("31");
  await form.getByRole("button", { name: "Turn on join code" }).click();
  await expect(form.getByText("Enter a whole number of days from 1 to 30.")).toBeVisible();
  await axe(page);
  await form.getByLabel("Valid for (days)").fill("14");
  await form.getByRole("button", { name: "Turn on join code" }).click();
  await expect(page.getByText("The join code is on.", { exact: true })).toBeVisible();
  const shown = section.getByText(CODE);
  await expect(shown).toBeVisible();
  code = (await shown.textContent()) ?? "";
  expect(code).toMatch(CODE);
  await expect(section.getByText(/^On until /)).toBeVisible();
  await expect(section.getByText("0 of 100 students joined with this code.")).toBeVisible();
  await axe(page);
  await shot(page, "teacher-code-panel-light");

  // After a reload only the hash is left: the state shows, the code does not.
  await page.reload();
  await expectHydrated(page.getByRole("tablist"));
  await page.getByRole("tab", { name: /^Invitations/ }).click();
  await expect(section.getByText(/^On until /)).toBeVisible();
  await expect(section.getByText(CODE)).toHaveCount(0);
});

test("a student joins with the code; a wrong code is refused (#49)", async ({ page }) => {
  expect(code).toMatch(CODE);
  const form = await joinForm(page, STUDENT);
  await axe(page);
  const field = form.getByLabel("Join code");
  await form.getByRole("button", { name: "Join class" }).click();
  await expect(form.getByText("Enter the join code your teacher gave you.")).toBeVisible();
  await field.fill(WRONG);
  await form.getByRole("button", { name: "Join class" }).click();
  await expect(
    form.getByText("This code does not work. Check it with your teacher."),
  ).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await axe(page);

  await field.fill(code.toLowerCase().replace("-", " "));
  await form.getByRole("button", { name: "Join class" }).click();
  await expect(page.getByText(`You joined ${CLASS}`)).toBeVisible();
  const classes = page.getByRole("region", { name: "Your classes" });
  await expect(
    classes.getByText(`${CLASS}, academic year 2026–2027`, { exact: true }),
  ).toBeAttached();

  await field.fill(code);
  await form.getByRole("button", { name: "Join class" }).click();
  await expect(page.getByText(`You are already a member of ${CLASS}`)).toBeVisible();
});

test("the rate limit stops a student who guesses (#49, ASVS V2.4.1)", async ({ page }) => {
  expect(code).toMatch(CODE);
  const form = await joinForm(page, GUESSER);
  const field = form.getByLabel("Join code");
  const limited = form.getByText("Too many wrong codes. Wait 15 minutes and try again.");
  /** Sends the field with Enter, from the keyboard, and waits for the server's answer. */
  async function send(): Promise<void> {
    const answer = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("_serverFn"),
    );
    await field.press("Enter");
    await answer;
  }
  // The per-student limit is 10 wrong codes; a retried run may already be over it.
  for (let i = 0; i < 11 && !(await limited.isVisible()); i += 1) {
    await field.fill(WRONG);
    await send();
    await expect(form.getByText(/This code does not work|Too many wrong codes/)).toBeVisible();
  }
  await expect(limited).toBeVisible();
  // Over the limit, even the right code is refused and the student joins nothing.
  await field.fill(code);
  await send();
  await expect(limited).toBeVisible();
  await expect(page.getByText(`You joined ${CLASS}`)).toHaveCount(0);
  await axe(page);
});

test("the owner sees the join counted and makes a new code (#49)", async ({ page, context }) => {
  await preferences(context, "dark", "en");
  await openInvitations(page);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  const section = page.getByRole("region", { name: "Join code" });
  await expect(section.getByText("1 of 100 students joined with this code.")).toBeVisible();
  await section.getByRole("button", { name: "New code" }).click();
  const dialog = page.getByRole("dialog", { name: "Make a new join code" });
  await axe(page);
  await dialog.getByRole("button", { name: "Make new code" }).click();
  await expect(dialog).toBeHidden();
  const shown = section.getByText(CODE);
  await expect(shown).toBeVisible();
  const fresh = (await shown.textContent()) ?? "";
  expect(fresh).not.toBe(code);
  code = fresh;
  await expect(section.getByText("0 of 100 students joined with this code.")).toBeVisible();
  await axe(page);
  await shot(page, "teacher-code-panel-dark");
});

for (const theme of ["light", "dark"] as const) {
  test(`the join form is axe-clean in the ${theme} theme (#49)`, async ({ page, context }) => {
    await preferences(context, theme, "en");
    await joinForm(page, STUDENT);
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
    await axe(page);
    await shot(page, `student-join-form-${theme}`);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`the code panel and the join form are axe-clean in Dutch, ${theme} (#49)`, async ({
    page,
    context,
  }) => {
    // The dev login form is English; the Dutch preference applies from the next page on.
    await devLogin(page, OWNER);
    await expect(page).toHaveURL(/\/teacher$/);
    await preferences(context, theme, "nl");
    await page.goto("/teacher/classes");
    await page
      .getByRole("link", { name: new RegExp(`^${CLASS}`) })
      .first()
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    await expectHydrated(page.getByRole("tablist"));
    const tab = dutch("classes_tab_invitations").split(" (")[0] ?? "";
    await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
    const section = page.getByRole("region", { name: dutch("classes_join_title") });
    await expect(
      section.getByRole("button", { name: dutch("classes_join_regenerate") }),
    ).toBeVisible();
    await axe(page);
    await shot(page, `teacher-code-panel-nl-${theme}`);

    await context.clearCookies();
    await devLogin(page, STUDENT);
    await expect(page).toHaveURL(/\/student$/);
    await preferences(context, theme, "nl");
    await page.goto("/student");
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    const form = page.getByRole("form", { name: dutch("classes_join_student_title") });
    await expectHydrated(form);
    await axe(page);
    await shot(page, `student-join-form-nl-${theme}`);
  });
}

test("the owner turns the code off and it stops working (#49)", async ({ page, context }) => {
  await openInvitations(page);
  const section = page.getByRole("region", { name: "Join code" });
  await section.getByRole("button", { name: "Turn off" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Turn off code" }).click();
  await expect(section.getByText("The join code is off.")).toBeVisible();
  await context.clearCookies();
  const form = await joinForm(page, STUDENT);
  await form.getByLabel("Join code").fill(code);
  await form.getByRole("button", { name: "Join class" }).click();
  await expect(
    form.getByText("This code does not work. Check it with your teacher."),
  ).toBeVisible();
});
