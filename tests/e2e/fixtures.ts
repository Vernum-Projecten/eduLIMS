// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Seeded by `pnpm db:seed` (src/server/db/seed.ts). */
export const DEV_PASSWORD = "eduLIMS-dev-only";

/** Signs in with a seeded dev account through the English login form. */
export async function devLogin(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
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
