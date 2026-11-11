// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The keyboard shortcuts dialog (`?`) and the shortcut rules (#63).
import { readFileSync } from "node:fs";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { devLogin, expectNoA11yViolations } from "./fixtures";

const nl: Readonly<Record<string, string>> = JSON.parse(
  readFileSync(new URL("../../messages/nl.json", import.meta.url), "utf8"),
);

function dutch(key: string): string {
  const message = nl[key];
  if (message === undefined) throw new Error(`messages/nl.json has no "${key}"`);
  return message;
}

/** A teacher-admin with two portals; these tests never switch, so the landing portal holds. */
const COORDINATOR = "teacher-admin@example.test";

/** Stubs the browser platform before any script runs, as macOS or Windows reports it. */
async function emulatePlatform(context: BrowserContext, platform: "MacIntel" | "Win32") {
  await context.addInitScript((value) => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => value });
    Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => undefined });
  }, platform);
}

async function signIn(page: Page) {
  await devLogin(page, COORDINATOR);
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole("heading", { level: 1, name: "Teacher portal" })).toBeVisible();
}

async function settled(page: Page) {
  await page.waitForFunction(() => document.getAnimations().length === 0);
}

/** Presses `?` (Shift+/ on the US layout Playwright types with). */
async function pressQuestionMark(page: Page) {
  await page.keyboard.press("Shift+Slash");
}

/** The keys a row of the dialog shows, by the action's name. */
function keysOf(page: Page, action: string) {
  return page
    .getByRole("dialog", { name: "Keyboard shortcuts" })
    .getByRole("term")
    .filter({ hasText: action })
    .locator("xpath=following-sibling::dd[1]");
}

test.describe("the keyboard shortcuts dialog", () => {
  test("? opens it with the macOS keys, and ? or Escape closes it", async ({ page, context }) => {
    await emulatePlatform(context, "MacIntel");
    await signIn(page);
    await pressQuestionMark(page);
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expect(keysOf(page, "Go to the Teacher portal")).toContainText("⌥1");
    await expect(keysOf(page, "Go to the Admin portal")).toContainText("⌥2");
    await expect(keysOf(page, "Show the keyboard shortcuts")).toContainText("?");
    await expect(keysOf(page, "Go to the search field")).toContainText("/");
    await expect(keysOf(page, "Go to the search field")).toContainText("⌘K");
    // Screen readers get the key names, not the glyphs.
    await expect(keysOf(page, "Go to the Admin portal")).toContainText("Alt+2");
    await expect(keysOf(page, "Go to the search field")).toContainText("Meta+K");

    await pressQuestionMark(page);
    await expect(dialog).toBeHidden();
    await pressQuestionMark(page);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("shows the Windows keys on Windows", async ({ page, context }) => {
    await emulatePlatform(context, "Win32");
    await signIn(page);
    await pressQuestionMark(page);
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await expect(keysOf(page, "Go to the Teacher portal")).toContainText("Alt1");
    await expect(keysOf(page, "Go to the search field")).toContainText("CtrlK");
    await expect(keysOf(page, "Go to the search field")).toContainText("Control+K");
    await expect(keysOf(page, "Go to the search field")).not.toContainText("⌘");
  });

  test("portal shortcuts are suspended while it is open", async ({ page }) => {
    await signIn(page);
    await pressQuestionMark(page);
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Alt+Digit2");
    await expect(page).toHaveURL(/\/teacher$/);
  });

  test("opens from the user menu and returns focus to it", async ({ page }) => {
    await signIn(page);
    const trigger = page.getByRole("button", { name: new RegExp(COORDINATOR.replace(".", "\\.")) });
    await trigger.click();
    const item = page.getByRole("menuitem", { name: "Keyboard shortcuts" });
    await expect(item).toHaveAttribute("aria-keyshortcuts", "?");
    await item.click();
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await settled(page);
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("single-key shortcuts can be turned off (WCAG 2.1.4)", async ({ page }) => {
    await signIn(page);
    await pressQuestionMark(page);
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    const toggle = dialog.getByRole("switch", { name: "Single-key shortcuts" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await pressQuestionMark(page);
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Teacher portal" })).toBeVisible();
    await pressQuestionMark(page);
    await expect(dialog).toBeHidden();

    // The user menu still opens it, and the switch turns them back on.
    await page.getByRole("button", { name: new RegExp(COORDINATOR.replace(".", "\\.")) }).click();
    await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
    await dialog.getByRole("switch", { name: "Single-key shortcuts" }).click();
    await page.keyboard.press("Escape");
    await pressQuestionMark(page);
    await expect(dialog).toBeVisible();
  });
});

test("nothing fires while typing in a text field", async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => {
    const field = document.createElement("input");
    field.setAttribute("aria-label", "Scratch field");
    document.querySelector("main")?.append(field);
  });
  const field = page.getByRole("textbox", { name: "Scratch field" });
  await field.focus();
  await pressQuestionMark(page);
  await page.keyboard.press("Slash");
  await page.keyboard.press("Alt+Digit2");
  await expect(field).toHaveValue("?/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(field).toBeFocused();
});

test("? does nothing while a menu is open", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /Switch portal/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await pressQuestionMark(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test.describe("axe with the shortcuts dialog open", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`is clean in the ${theme} theme`, async ({ page, context }) => {
      await context.addCookies([
        { name: "EDULIMS_THEME", value: theme, url: "http://localhost:3100" },
      ]);
      await signIn(page);
      await pressQuestionMark(page);
      await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
      await settled(page);
      await expectNoA11yViolations(page);
    });
  }

  test("is translated and clean in Dutch", async ({ page, context }) => {
    await signIn(page);
    await context.addCookies([
      { name: "EDULIMS_LOCALE", value: "nl", url: "http://localhost:3100" },
    ]);
    await page.goto("/teacher");
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    await pressQuestionMark(page);
    const dialog = page.getByRole("dialog", { name: dutch("shortcuts_dialog_title") });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(dutch("shortcut_show_shortcuts"))).toBeVisible();
    await expect(
      dialog.getByRole("switch", { name: dutch("shortcuts_character_keys_label") }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: dutch("shortcuts_close") })).toBeVisible();
    await settled(page);
    await expectNoA11yViolations(page);
  });
});

test.describe("at 320 CSS px (WCAG 1.4.10)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the dialog reflows without horizontal scrolling", async ({ page }) => {
    await signIn(page);
    await pressQuestionMark(page);
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await settled(page);
    const box = await dialog.boundingBox();
    expect(box?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(320);
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expectNoA11yViolations(page);
  });
});
