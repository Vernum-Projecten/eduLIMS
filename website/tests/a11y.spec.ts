// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** One page per template and section, in both locales, including an English fallback page under /nl/. */
const PAGES = [
  "/",
  "/get-started/introduction/",
  "/get-started/quick-start/",
  "/guides/student/",
  "/guides/administrator/",
  "/operations/configuration/",
  "/operations/install/",
  "/development/architecture/",
  "/development/requirements/",
  "/development/decisions/",
  "/nl/",
  "/nl/guides/student/",
  "/nl/guides/teacher/",
  "/nl/operations/install/",
  "/404.html",
];

for (const path of PAGES) {
  test(`${path} has no WCAG 2.1 A or AA violations`, async ({ page }) => {
    await page.goto(path);
    // Expressive Code makes an overflowing code block focusable from a script after load.
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".expressive-code pre")].every(
        (pre) => pre.scrollWidth <= pre.clientWidth || pre.hasAttribute("tabindex"),
      ),
    );
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}

test("the Dutch fallback page says it is only available in English", async ({ page }) => {
  await page.goto("/nl/operations/install/");
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(page.getByText("Deze pagina is alleen in het Engels beschikbaar.")).toBeVisible();
});
