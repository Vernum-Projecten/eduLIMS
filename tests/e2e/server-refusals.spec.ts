// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server refusals on the form foundation stay until the user changes the form (#120, Q-ACC-1,
// WCAG 3.3.1): a form refusal sent with Enter stays visible and focused, an unchanged value can
// be sent again, and the first click on submit after a field refusal submits. The test-account
// form shows the form refusal; the analyser dialog shows the field refusal.
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { axe, dutch, signInAsAdmin } from "./admin-users-helpers";
import { expectHydrated } from "./fixtures";
import { appUrl } from "./run-env";

const TAKEN = "An analyser of this model with this serial number is already in the register.";

async function setPreferences(context: BrowserContext, theme: "light" | "dark", locale: string) {
  await context.addCookies([
    { name: "EDULIMS_THEME", value: theme, url: appUrl() },
    { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
  ]);
}

/** Counts the server function writes (POST) the page sends from now on. */
function countServerWrites(page: Page): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/_serverFn/")) count += 1;
  });
  return () => count;
}

/** Fills the test-account form with a password that is refused, and sends it with Enter. */
async function refusedSignIn(
  page: Page,
  labels: { email: string; password: string; submit: string },
) {
  await page.goto("/login");
  await expectHydrated(page.getByRole("button", { name: labels.submit }));
  await page.getByLabel(labels.email, { exact: true }).fill("nobody@example.test");
  const password = page.getByLabel(labels.password);
  await password.fill("not-the-password");
  await password.press("Enter");
  return password;
}

test("a form refusal sent with Enter stays visible and focused until a field changes (#120)", async ({
  page,
}) => {
  const password = await refusedSignIn(page, {
    email: "Email address",
    password: "Password",
    submit: "Sign in with a test account",
  });
  const refusal = page.getByRole("alert");
  await expect(refusal).toHaveText("Incorrect email address or password.");
  await expect(refusal).toBeFocused();
  // The field lost focus to the refusal; the refusal stays, and so does its focus.
  await page.waitForTimeout(500);
  await expect(refusal).toHaveText("Incorrect email address or password.");
  await expect(refusal).toBeFocused();

  // Leaving it for another control keeps it on screen.
  await page.keyboard.press("Shift+Tab");
  await expect(refusal).toBeVisible();

  // Sending the same values again is refused again, and focus returns to the refusal.
  await password.press("Enter");
  await expect(refusal).toBeFocused();
  await expect(refusal).toHaveText("Incorrect email address or password.");

  // A change clears it.
  await password.fill("another-try");
  await expect(refusal).toHaveCount(0);
});

/** Returns the English text, or the Dutch message `key` in the nl locale. */
function say(locale: "en" | "nl", key: string, english: string): string {
  return locale === "nl" ? dutch(key) : english;
}

/** Adds an analyser whose serial number the model already has, sent with Enter from the field. */
async function refuseTakenSerial(
  page: Page,
  locale: "en" | "nl" = "en",
  afterSignIn: () => Promise<void> = async () => undefined,
) {
  await signInAsAdmin(page);
  await afterSignIn();
  await page.goto("/admin/integrations");
  const add = page.getByRole("button", {
    name: say(locale, "admin_analysers_add", "Add analyser"),
  });
  await expectHydrated(add);
  await add.click();
  const dialog = page.getByRole("dialog", {
    name: say(locale, "admin_analysers_create_title", "Add an analyser"),
  });
  await dialog.getByLabel(say(locale, "admin_analysers_model", "Model")).fill("Abbott Afinion 2");
  await dialog.getByLabel(say(locale, "admin_analysers_location", "Location")).fill("Lab A");
  await dialog
    .getByRole("combobox", { name: say(locale, "admin_analysers_route", "Route to FerroEHR") })
    .click();
  await page
    .getByRole("option", {
      name: say(locale, "admin_analysers_route_hl7", "HL7 through FerroBRIDGE"),
    })
    .click();
  const serial = dialog.getByLabel(say(locale, "admin_analysers_serial", "Serial number"));
  await serial.fill("AF2-DEMO-0001");
  const writes = countServerWrites(page);
  await serial.press("Enter");
  const refusal = dialog.getByText(say(locale, "admin_analysers_error_serial_taken", TAKEN));
  await expect(serial).toHaveAttribute("aria-invalid", "true");
  await expect(refusal).toBeVisible();
  await expect.poll(writes).toBe(1);
  return { dialog, serial, writes, refusal };
}

test("an unchanged value refused at its field can be sent again (#120)", async ({ page }) => {
  const { serial, writes, refusal } = await refuseTakenSerial(page);
  await serial.press("Enter");
  await expect.poll(writes).toBe(2);
  await expect(refusal).toBeVisible();
  await expect(serial).toHaveAttribute("aria-invalid", "true");
});

test("the first click on submit after a field refusal submits (#120)", async ({ page }) => {
  const { dialog, serial, writes, refusal } = await refuseTakenSerial(page);
  const submit = dialog.getByRole("button", { name: "Add analyser" });
  await submit.scrollIntoViewIfNeeded();
  const before = await submit.boundingBox();
  if (before === null) throw new Error("The submit button has no box.");
  // A real mouse click: the press blurs the field, and the release must land on the same button.
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await expect(refusal).toBeVisible();
  expect(await submit.boundingBox()).toEqual(before);
  await page.mouse.up();
  await expect.poll(writes).toBe(2);
  await expect(refusal).toBeVisible();

  // A change of the refused field clears its refusal.
  await serial.fill("AF2-DEMO-0001-B");
  await expect(refusal).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`a kept form refusal is axe-clean in the ${theme} theme (#120)`, async ({
    page,
    context,
  }) => {
    await setPreferences(context, theme, "en");
    await refusedSignIn(page, {
      email: "Email address",
      password: "Password",
      submit: "Sign in with a test account",
    });
    await expect(page.getByRole("alert")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("alert")).toBeVisible();
    await axe(page);
  });
}

test("a kept form refusal is translated and axe-clean in Dutch (#120)", async ({
  page,
  context,
}) => {
  for (const theme of ["light", "dark"] as const) {
    await setPreferences(context, theme, "nl");
    await refusedSignIn(page, {
      email: dutch("field_email"),
      password: dutch("field_password"),
      submit: dutch("dev_login_submit"),
    });
    const refusal = page.getByRole("alert");
    await expect(refusal).toHaveText(dutch("dev_login_failed"));
    await expect(refusal).toBeFocused();
    await axe(page);
  }
});

for (const [theme, locale] of [
  ["light", "en"],
  ["dark", "en"],
  ["light", "nl"],
] as const) {
  test(`a kept field refusal is axe-clean in the ${theme} theme, ${locale} (#120)`, async ({
    page,
    context,
  }) => {
    // The sign-in helper reads English labels; the preferences apply from the next page.
    const { serial, refusal } = await refuseTakenSerial(page, locale, () =>
      setPreferences(context, theme, locale),
    );
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
    await serial.blur();
    await expect(refusal).toBeVisible();
    await axe(page);
  });
}
