// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Seeded by `pnpm db:seed` (src/server/db/seed.ts). */
export const DEV_PASSWORD = "eduLIMS-dev-only";

export async function devLogin(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByLabel("Wachtwoord").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Inloggen met testaccount" }).click();
}

/** Asserts the page has no WCAG 2.1 A/AA violations detectable by axe. */
export async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}
