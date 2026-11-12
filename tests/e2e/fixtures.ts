// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, type Response } from "@playwright/test";

/** Seeded by `pnpm db:seed` (src/server/db/seed.ts). */
export const DEV_PASSWORD = "eduLIMS-dev-only";

/**
 * Waits until React has hydrated `element`, so its handlers are attached.
 *
 * A server-rendered form takes input before hydration, and hydration then resets its
 * controlled fields: under parallel load the test typed an email that hydration erased. React
 * marks every hydrated node with a `__reactProps$<id>` key, and the user has no other signal.
 */
export async function expectHydrated(element: Locator): Promise<void> {
  await expect
    .poll(() =>
      element.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$"))),
    )
    .toBe(true);
}

/**
 * Presses `key` until `target` has focus, at most `maxPresses` times, waiting after each press
 * until the focus has left the element it was on.
 *
 * A Radix menu moves its roving focus in a `setTimeout` after the key event, so reading
 * `document.activeElement` right after a press still sees the old item under load, and the next
 * press then moves from that old item again.
 */
export async function pressUntilFocused(
  page: Page,
  key: string,
  target: Locator,
  maxPresses = 4,
): Promise<void> {
  for (let presses = 0; presses < maxPresses; presses += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    const before = await page.evaluateHandle(() => document.activeElement);
    await page.keyboard.press(key);
    await expect.poll(() => before.evaluate((el) => el !== document.activeElement)).toBe(true);
    await before.dispose();
  }
  await expect(target).toBeFocused();
}

/**
 * Submits the English login form for a seeded dev account and returns once the server has
 * answered the sign-in request, whatever its answer. For a sign-in the journey expects to be
 * refused; every other journey uses {@link devLogin}.
 */
export async function submitDevLogin(page: Page, email: string): Promise<Response> {
  await page.goto("/login");
  await expectHydrated(page.getByRole("form", { name: "Sign in with a test account" }));
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/auth/sign-in/email",
  );
  await page.getByRole("button", { name: "Sign in with a test account" }).click();
  return answered;
}

/**
 * Signs in with a seeded dev account through the English login form and returns once the app
 * has left `/login`, so the caller can navigate at once: a navigation during the sign-in
 * request aborts it and lands on the login form (#250).
 */
export async function devLogin(page: Page, email: string): Promise<void> {
  const response = await submitDevLogin(page, email);
  expect(response.ok(), `the dev sign-in of ${email} answered ${response.status()}`).toBe(true);
  await expect(page, `the dev sign-in of ${email} stayed on /login`).not.toHaveURL(
    (url) => url.pathname === "/login",
  );
}

/** Asserts the page has no WCAG 2.1 A/AA violations detectable by axe. */
export async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}
