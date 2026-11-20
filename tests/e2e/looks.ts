// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The themes and languages a journey runs its axe scan in. Test support only.
import { expect, type Page } from "@playwright/test";
import { axe } from "./admin-users-helpers";
import { appUrl } from "./run-env";

/** A theme and a language a page is scanned in. */
export type Look = readonly ["light" | "dark", "en" | "nl"];

/** Dark, Dutch, and both: the looks after a journey that ran in light English. */
export const OTHER_LOOKS: readonly Look[] = [
  ["dark", "en"],
  ["light", "nl"],
  ["dark", "nl"],
];

/** Every look, light English first. */
export const ALL_LOOKS: readonly Look[] = [["light", "en"], ...OTHER_LOOKS];

/**
 * Reloads `page` in each of `looks`, waits for its language, runs `check` (which waits for the
 * page's own content in that language), then the axe scan.
 */
export async function inEachLook(
  page: Page,
  looks: readonly Look[],
  check: (locale: Look[1]) => Promise<void>,
): Promise<void> {
  for (const [theme, locale] of looks) {
    await page.context().addCookies([
      { name: "EDULIMS_THEME", value: theme, url: appUrl() },
      { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
    ]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await check(locale);
    await axe(page);
  }
}
