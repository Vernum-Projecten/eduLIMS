// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The destructive colour in both themes (#54) and the translated names of the built-in
// sheet and dialog controls (#27, #55), each checked with axe in light, dark and Dutch.
import { readFileSync } from "node:fs";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { devLogin, expectNoA11yViolations } from "./fixtures";
import { appUrl } from "./run-env";

const nl: Readonly<Record<string, string>> = JSON.parse(
  readFileSync(new URL("../../messages/nl.json", import.meta.url), "utf8"),
);

function dutch(key: string): string {
  const message = nl[key];
  if (message === undefined) throw new Error(`messages/nl.json has no "${key}"`);
  return message;
}

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

async function usePreferences(
  context: BrowserContext,
  theme: Theme,
  locale: "en" | "nl",
): Promise<void> {
  await context.addCookies([
    { name: "EDULIMS_THEME", value: theme, url: appUrl() },
    { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
  ]);
}

/** Waits until every animation (a sheet, a dialog) has finished, so axe measures final colours. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
}

test.describe("the mobile sidebar sheet (#27)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const theme of THEMES) {
    test(`announces its Dutch title and description and is axe-clean in the ${theme} theme`, async ({
      page,
      context,
    }) => {
      await devLogin(page, "student@example.test");
      await expect(page).toHaveURL(/\/student$/);
      await usePreferences(context, theme, "nl");
      await page.goto("/student");
      await expect(page.locator("html")).toHaveAttribute("lang", "nl");
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));

      await page
        .getByRole("banner")
        .getByRole("button", { name: dutch("sidebar_toggle") })
        .click();
      const sheet = page.getByRole("dialog", { name: dutch("ui_sidebar_title") });
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAccessibleDescription(dutch("ui_sidebar_description"));
      await settle(page);
      await expectNoA11yViolations(page);
    });
  }

  test("announces its English title and description in English", async ({ page }) => {
    await devLogin(page, "student@example.test");
    await expect(page).toHaveURL(/\/student$/);
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Show or hide the sidebar" })
      .click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAccessibleDescription("The sections of this portal.");
  });
});

test.describe("destructive buttons in a sheet and a dialog (#54)", () => {
  for (const locale of ["en", "nl"] as const) {
    for (const theme of THEMES) {
      test(`the user sheet and the block dialog are axe-clean in ${locale}, ${theme}`, async ({
        page,
        context,
      }) => {
        await devLogin(page, "admin@example.test");
        await expect(page).toHaveURL(/\/admin$/);
        await usePreferences(context, theme, locale);
        await page.goto("/admin/users?q=Test%20Student");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await page
          .getByRole("table")
          .getByRole("link", { name: "Test Student", exact: true })
          .click();
        const sheet = page.getByRole("dialog", { name: "Test Student" });
        await expect(sheet).toBeVisible();
        await settle(page);
        await expectNoA11yViolations(page);

        const block = locale === "nl" ? dutch("admin_users_block") : "Block user";
        await sheet.getByRole("button", { name: block }).click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toBeVisible();
        await settle(page);
        await expectNoA11yViolations(page);

        await dialog
          .getByRole("button", { name: locale === "nl" ? dutch("admin_users_cancel") : "Cancel" })
          .click();
        await expect(dialog).toBeHidden();
      });
    }
  }
});

test.describe("a toast in the dark theme", () => {
  test("follows the app theme and is axe-clean", async ({ page, context }) => {
    await devLogin(page, "admin@example.test");
    await expect(page).toHaveURL(/\/admin$/);
    await usePreferences(context, "dark", "en");
    await page.goto("/admin");
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);

    // Saving the language fails, so the language menu shows its error toast and nothing changes.
    await page.route("**/_serverFn/**", (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await page.getByRole("button", { name: "Language: English" }).click();
    await page.getByRole("menuitemradio", { name: "Nederlands" }).click();
    await expect(
      page.getByText("Your language could not be saved. Please try again."),
    ).toBeVisible();
    await expect(page.locator("[data-sonner-toaster]")).toHaveAttribute(
      "data-sonner-theme",
      "dark",
    );
    await expect(page.getByRole("region", { name: /^Notifications/ })).toBeAttached();
    await settle(page);
    await expectNoA11yViolations(page);
  });
});
