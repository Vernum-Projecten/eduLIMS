// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { devLogin, expectNoA11yViolations } from "./fixtures";

// The Dutch copy comes from the catalogue, so the assertions follow the translation.
const nl: Readonly<Record<string, string>> = JSON.parse(
  readFileSync(new URL("../../messages/nl.json", import.meta.url), "utf8"),
);

function dutch(key: string, params: Readonly<Record<string, string>> = {}): string {
  const message = nl[key];
  if (message === undefined) throw new Error(`messages/nl.json has no "${key}"`);
  return message.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`);
}

/** The only seeded account whose saved language the suite changes (src/server/db/seed.ts). */
const LANGUAGE_USER = "language@example.test";

/** Collects hydration errors from the console, so a test can assert there were none. */
function watchHydration(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

/** Opens the language menu with the keyboard from its trigger, named `trigger`. */
async function openLanguageMenuWithKeyboard(page: Page, trigger: string): Promise<void> {
  const button = page.getByRole("button", { name: trigger });
  await button.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // Lets the open animation finish, so axe measures the final colours.
  await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

/** Picks `language` (its endonym) in the language menu with the keyboard. */
async function pickLanguage(page: Page, trigger: string, language: string): Promise<void> {
  await openLanguageMenuWithKeyboard(page, trigger);
  const item = page.getByRole("menuitemradio", { name: language });
  for (let step = 0; step < 4; step += 1) {
    if (await item.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(item).toBeFocused();
  await page.keyboard.press("Enter");
}

test("the interface is English by default and the language menu works with the keyboard", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();

  const trigger = page.getByRole("button", { name: "Language: English" });
  await expect(trigger).toBeVisible();
  await openLanguageMenuWithKeyboard(page, "Language: English");

  const english = page.getByRole("menuitemradio", { name: "English" });
  const dutchItem = page.getByRole("menuitemradio", { name: "Nederlands" });
  await expect(english).toHaveAttribute("lang", "en");
  await expect(english).toHaveAttribute("aria-checked", "true");
  await expect(dutchItem).toHaveAttribute("lang", "nl");
  await expect(dutchItem).toHaveAttribute("aria-checked", "false");
  await expectNoA11yViolations(page);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("switching to Dutch changes the UI and <html lang>, and the choice sticks", async ({
  page,
}) => {
  const hydrationErrors = watchHydration(page);
  await page.goto("/login");
  await pickLanguage(page, "Language: English", "Nederlands");

  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(page.getByRole("heading", { level: 1, name: dutch("sign_in") })).toBeVisible();
  await expect(page).toHaveTitle(`${dutch("sign_in")} | eduLIMS`);
  await expect(page.getByRole("button", { name: dutch("login_microsoft") })).toBeVisible();
  await expect(page.getByRole("link", { name: dutch("skip_to_content") })).toBeAttached();
  const dutchTrigger = dutch("language_menu_trigger", { language: "Nederlands" });
  await expect(page.getByRole("button", { name: dutchTrigger })).toBeVisible();
  await expectNoA11yViolations(page);

  // The cookie keeps Dutch across navigations and reloads.
  await page.goto("/");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(page.getByRole("link", { name: dutch("sign_in") }).first()).toBeVisible();

  // Back to English.
  await pickLanguage(page, dutchTrigger, "English");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "Language: English" })).toBeVisible();
  expect(hydrationErrors).toEqual([]);
});

test("a signed-in user's language is saved and applied on the next sign-in", async ({
  page,
  browser,
}) => {
  await devLogin(page, LANGUAGE_USER);
  await expect(page.getByRole("heading", { level: 1, name: "Student portal" })).toBeVisible();
  await pickLanguage(page, "Language: English", "Nederlands");
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(
    page.getByRole("heading", { level: 1, name: dutch("portal_student") }),
  ).toBeVisible();

  // A fresh browser without the cookie, and an English Accept-Language.
  const context = await browser.newContext({ locale: "en-US" });
  try {
    const fresh = await context.newPage();
    const hydrationErrors = watchHydration(fresh);
    await devLogin(fresh, LANGUAGE_USER);
    await expect(
      fresh.getByRole("heading", { level: 1, name: dutch("portal_student") }),
    ).toBeVisible();
    await expect(fresh.locator("html")).toHaveAttribute("lang", "nl");
    await expectNoA11yViolations(fresh);
    // Signing out lives in the user menu at the foot of the sidebar.
    await fresh
      .getByRole("button", { name: new RegExp(LANGUAGE_USER.replace(".", "\\.")) })
      .click();
    await expect(fresh.getByRole("menuitem", { name: dutch("sign_out") })).toBeVisible();
    await fresh.keyboard.press("Escape");
    await expect(fresh.getByRole("menu")).toBeHidden();

    // Saving English again overrides the Dutch preference.
    await pickLanguage(
      fresh,
      dutch("language_menu_trigger", { language: "Nederlands" }),
      "English",
    );
    await expect(fresh.locator("html")).toHaveAttribute("lang", "en");
    await expect(fresh.getByRole("heading", { level: 1, name: "Student portal" })).toBeVisible();
    expect(hydrationErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test.describe("at 320 CSS px wide (WCAG 1.4.10)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the header and the open language menu fit without horizontal scrolling", async ({
    page,
  }) => {
    await page.goto("/login");
    await openLanguageMenuWithKeyboard(page, "Language: English");
    const box = await page.getByRole("menu").boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(320);
    await expectNoA11yViolations(page);
  });
});

test.describe("with a Dutch browser", () => {
  test.use({ locale: "nl-NL" });

  test("a first visit follows Accept-Language", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    await expect(page.getByRole("link", { name: dutch("sign_in") }).first()).toBeVisible();
  });

  test("the language choice overrides Accept-Language", async ({ page }) => {
    await page.goto("/login");
    await pickLanguage(page, dutch("language_menu_trigger", { language: "Nederlands" }), "English");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
