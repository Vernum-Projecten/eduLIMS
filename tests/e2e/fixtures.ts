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
