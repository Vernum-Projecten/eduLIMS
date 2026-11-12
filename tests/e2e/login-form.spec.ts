// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The login form on the form foundation (#84, S1): an error stays after a blur, a refused
// submit moves focus to the first invalid field, a server refusal shows at the top of the form,
// the page is axe-clean with an error showing in light, dark and Dutch, and the whole sign-in
// works with the keyboard alone.
import { expect, type Page, test } from "@playwright/test";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated, pressUntilFocused } from "./fixtures";
import { appUrl } from "./run-env";

/** Where the journeys save their screenshots, when the caller asks for them. */
const SHOTS = process.env["E2E_SHOTS_DIR"]?.trim();

const SUBMIT = "Sign in with a test account";

/** Opens the login page and waits until its test-account form is interactive. */
async function openLogin(page: Page, submit = SUBMIT) {
  await page.goto("/login");
  const button = page.getByRole("button", { name: submit });
  await expectHydrated(button);
  return button;
}

test("a field error stays after a blur, and a refused submit focuses the first invalid field (#84)", async ({
  page,
}) => {
  const submit = await openLogin(page);
  const email = page.getByLabel("Email address", { exact: true });
  const password = page.getByLabel("Password");

  // Nothing shows before the first submit.
  await email.focus();
  await email.blur();
  await expect(email).toHaveAttribute("aria-invalid", "false");

  await submit.click();
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  const emailError = page.getByRole("alert").filter({ hasText: "Enter a valid email address." });
  await expect(emailError).toBeVisible();

  // Leaving the field keeps its error.
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
  await expect(emailError).toBeVisible();
  await expect(email).toHaveAttribute("aria-invalid", "true");

  // Each change revalidates: a valid email clears its error, the empty password keeps its own.
  await email.fill("student@example.test");
  await expect(emailError).toHaveCount(0);
  await expect(email).toHaveAttribute("aria-invalid", "false");
  await submit.click();
  await expect(password).toBeFocused();
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/login$/);
});

test("a refused sign-in shows at the top of the form and the next change clears it (#84)", async ({
  page,
}) => {
  const submit = await openLogin(page);
  await page.getByLabel("Email address", { exact: true }).fill("nobody@example.test");
  const password = page.getByLabel("Password");
  await password.fill("not-the-password");
  await submit.click();

  const refusal = page.getByRole("alert");
  await expect(refusal).toHaveText("Incorrect email address or password.");
  await expect(refusal).toBeFocused();
  await expect(page).toHaveURL(/\/login$/);
  await axe(page);

  await password.fill("another-try");
  await expect(refusal).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`the login page with a field error is axe-clean in the ${theme} theme (#84)`, async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: "EDULIMS_THEME", value: theme, url: appUrl() }]);
    const submit = await openLogin(page);
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
    await submit.click();
    await expect(page.getByLabel("Email address", { exact: true })).toBeFocused();
    await expect(
      page.getByRole("alert").filter({ hasText: "Enter a valid email address." }),
    ).toBeVisible();
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/login-field-error-${theme}.png` });
  });
}

test("the login page with a field error is translated and axe-clean in Dutch (#84)", async ({
  page,
  context,
}) => {
  await context.addCookies([{ name: "EDULIMS_LOCALE", value: "nl", url: appUrl() }]);
  for (const theme of ["light", "dark"] as const) {
    await context.addCookies([{ name: "EDULIMS_THEME", value: theme, url: appUrl() }]);
    const submit = await openLogin(page, dutch("dev_login_submit"));
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    await submit.click();
    const email = page.getByLabel(dutch("field_email"), { exact: true });
    await expect(email).toBeFocused();
    await expect(
      page.getByRole("alert").filter({ hasText: dutch("validation_email") }),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: dutch("validation_password") }),
    ).toBeVisible();
    await axe(page);
  }
});

test("the test-account sign-in works with the keyboard alone (#84)", async ({ page }) => {
  const submit = await openLogin(page);
  const email = page.getByLabel("Email address", { exact: true });
  const password = page.getByLabel("Password");

  // The skip link comes first and lands in main.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await pressUntilFocused(page, "Tab", email, 12);

  // Enter on the empty form refuses it and keeps focus on the first invalid field.
  await page.keyboard.press("Enter");
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toBeFocused();

  await page.keyboard.type("student@example.test");
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(email).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.type("eduLIMS-dev-only");
  await page.keyboard.press("Tab");
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole("heading", { level: 1, name: "Student portal" })).toBeVisible();
});

test("a navigation right after devLogin lands on the page, not on the login form (#250)", async ({
  page,
}) => {
  await devLogin(page, "teacher@example.test");
  await page.goto("/teacher/classes");
  await expect(page).toHaveURL(/\/teacher\/classes$/);
  await expect(page.getByRole("heading", { level: 1, name: "Classes" })).toBeVisible();
  await axe(page);
});

test("a provider that refuses the start shows why, with focus on the message (#84)", async ({
  page,
}) => {
  // The answer of the sso guard for a disabled provider (403, `provider_disabled`). Disabling
  // the seeded provider for real would change the login page under the parallel specs.
  const pattern = "**/api/auth/sign-in/sso";
  await page.route(pattern, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            code: "provider_disabled",
            message: "Identity provider disabled",
          }),
        })
      : route.fallback(),
  );
  await openLogin(page);
  const keycloak = page.getByRole("button", { name: "Sign in with Keycloak", exact: true });
  await expectHydrated(keycloak);
  await keycloak.click();

  const refusal = page.getByRole("alert");
  await expect(refusal).toHaveText(
    "This sign-in option is switched off. Use another one, or contact an administrator.",
  );
  await expect(refusal).toBeFocused();
  await expect(keycloak).toBeEnabled();
  await expect(page).toHaveURL(/\/login$/);
  await axe(page);

  // A second refusal takes focus again.
  await keycloak.focus();
  await page.keyboard.press("Enter");
  await expect(refusal).toBeFocused();
});
