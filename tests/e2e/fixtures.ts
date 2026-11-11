// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

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

/** Signs in with a seeded dev account through the English login form. */
export async function devLogin(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await expectHydrated(page.getByRole("form", { name: "Sign in with a test account" }));
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in with a test account" }).click();
}

/** Asserts the page has no WCAG 2.1 A/AA violations detectable by axe. */
export async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}
