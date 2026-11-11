// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The portal switcher and multiple roles (ADR 0012).
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

/** Seeded teacher-admin users: the suite switches portals only with SWITCHER. */
const COORDINATOR = "teacher-admin@example.test";
const SWITCHER = "switcher@example.test";

/** The portal switcher's trigger: its name starts with the current portal. */
function switcher(page: Page, portal = "Teacher portal") {
  return page.getByRole("button", { name: new RegExp(`^${portal} eduLIMS Switch portal`) });
}

async function openSwitcher(page: Page, portal?: string) {
  await switcher(page, portal).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return menu;
}

/** Stubs the browser platform before any script runs, as macOS or Windows reports it. */
async function emulatePlatform(context: BrowserContext, platform: "MacIntel" | "Win32") {
  await context.addInitScript((value) => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => value });
    Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => undefined });
  }, platform);
}

/** Waits for the switcher to save the portal on the account. */
function portalSaved(page: Page) {
  return page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/_serverFn/"),
  );
}

test("a teacher-admin lands on the teacher portal and the switcher lists both portals", async ({
  page,
}) => {
  await devLogin(page, COORDINATOR);
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole("heading", { level: 1, name: "Teacher portal" })).toBeVisible();
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.getByRole("link", { name: "Teacher portal" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main menu" });
  await expect(nav).not.toContainText("Admin portal");

  const trigger = switcher(page);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await expect(menu.getByText("Portals")).toBeVisible();
  const items = menu.getByRole("menuitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Teacher portal");
  await expect(items.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(items.nth(0)).toHaveAttribute("aria-keyshortcuts", "Alt+1");
  await expect(items.nth(1)).toContainText("Admin portal");
  await expect(items.nth(1)).toHaveAttribute("aria-keyshortcuts", "Alt+2");
  await expect(items.nth(1)).not.toHaveAttribute("aria-current", "true");
  await expectNoA11yViolations(page);

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.getByRole("button", { name: new RegExp(COORDINATOR.replace(".", "\\.")) }).click();
  const userMenu = page.getByRole("menu");
  await expect(userMenu.getByText("Teacher", { exact: true })).toBeVisible();
  await expect(userMenu.getByText("Administrator", { exact: true })).toBeVisible();
});

test("a single-role user sees the portal heading without a menu", async ({ page }) => {
  await devLogin(page, "teacher@example.test");
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole("button", { name: /Switch portal/ })).toHaveCount(0);
  await expect(page.locator("[data-sidebar=header]")).toContainText("Teacher portal");
  await page.keyboard.press("Alt+Digit2");
  await expect(page).toHaveURL(/\/teacher$/);
  await expectNoA11yViolations(page);
});

// One account switches in order, so the saved portal each test starts from is known.
test.describe
  .serial(`switching (${SWITCHER})`, () => {
    test("switching portals navigates, is remembered on the next sign-in, and has shortcuts", async ({
      page,
      browser,
      context,
    }) => {
      await emulatePlatform(context, "MacIntel");
      await devLogin(page, SWITCHER);
      await expect(page).toHaveURL(/\/teacher$/);

      const menu = await openSwitcher(page);
      await expect(menu.getByRole("menuitem").nth(1)).toContainText("⌥2");
      const saved = portalSaved(page);
      await menu.getByRole("menuitem", { name: /Admin portal/ }).click();
      await expect(page).toHaveURL(/\/admin$/);
      expect((await saved).ok()).toBe(true);
      await expect(page.getByRole("heading", { level: 1, name: "Admin portal" })).toBeVisible();
      await expect(
        page
          .getByRole("navigation", { name: "Breadcrumb" })
          .getByRole("link", { name: "Admin portal" }),
      ).toBeVisible();
      await expect(switcher(page, "Admin portal")).toBeVisible();

      // A fresh browser context signs in again and lands on the saved portal.
      const fresh = await browser.newContext();
      const second = await fresh.newPage();
      await devLogin(second, SWITCHER);
      await expect(second).toHaveURL(/\/admin$/);
      await second.goto("/");
      await expect(second).toHaveURL(/\/admin$/);
      await fresh.close();

      // ⌥1 on macOS: the same Alt+digit key press, shown with the macOS glyph.
      const back = portalSaved(page);
      await page.keyboard.press("Alt+Digit1");
      await expect(page).toHaveURL(/\/teacher$/);
      expect((await back).ok()).toBe(true);

      // A shortcut typed into a text field stays in the field.
      await page.evaluate(() => {
        const field = document.createElement("input");
        field.setAttribute("aria-label", "Scratch field");
        document.querySelector("main")?.append(field);
      });
      await page.getByRole("textbox", { name: "Scratch field" }).focus();
      await page.keyboard.press("Alt+Digit2");
      await expect(page).toHaveURL(/\/teacher$/);
    });

    test("on Windows the shortcut reads Alt+2 and switches with Alt+2", async ({
      page,
      context,
    }) => {
      await emulatePlatform(context, "Win32");
      await devLogin(page, SWITCHER);
      await expect(page).toHaveURL(/\/teacher$/);
      const menu = await openSwitcher(page);
      await expect(menu.getByRole("menuitem").nth(1)).toContainText("Alt+2");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Alt+Digit2");
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByRole("heading", { level: 1, name: "Admin portal" })).toBeVisible();
    });
  });

test("a teacher-admin may open both portals, a pure admin not the teacher portal", async ({
  page,
}) => {
  await devLogin(page, COORDINATOR);
  await expect(page).toHaveURL(/\/teacher$/);
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { level: 1, name: "Users and roles" })).toBeVisible();
  await page.goto("/student");
  await expect(page).toHaveURL(/\/teacher$/);
});

test("a pure administrator is sent away from the teacher portal", async ({ page }) => {
  await devLogin(page, "admin@example.test");
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/teacher/grading");
  await expect(page).toHaveURL(/\/admin$/);
});

test("an IdP sign-in with conflicting roles is explained", async ({ page }) => {
  await page.goto("/login?error=role_conflict");
  await expect(page.getByRole("alert")).toHaveText(
    "Your account has conflicting roles. Contact your administrator.",
  );
  await expectNoA11yViolations(page);
});

test.describe("axe with the switcher open", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`is clean in the ${theme} theme`, async ({ page, context }) => {
      await context.addCookies([
        { name: "EDULIMS_THEME", value: theme, url: "http://localhost:3100" },
      ]);
      await devLogin(page, COORDINATOR);
      await expect(page).toHaveURL(/\/teacher$/);
      await openSwitcher(page);
      await expectNoA11yViolations(page);
    });
  }

  test("is translated and clean in Dutch", async ({ page, context }) => {
    await devLogin(page, COORDINATOR);
    await expect(page).toHaveURL(/\/teacher$/);
    await context.addCookies([
      { name: "EDULIMS_LOCALE", value: "nl", url: "http://localhost:3100" },
    ]);
    await page.goto("/teacher");
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    const trigger = page.getByRole("button", { name: new RegExp(dutch("portal_switcher_open")) });
    await expect(trigger).toContainText(dutch("portal_teacher"));
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText(dutch("portal_switcher_label"))).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: new RegExp(dutch("portal_admin")) }),
    ).toBeVisible();
    await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await expectNoA11yViolations(page);
  });
});

test("on the collapsed rail the switcher shows the icon with the portal name as tooltip", async ({
  page,
}) => {
  await devLogin(page, COORDINATOR);
  await expect(page).toHaveURL(/\/teacher$/);
  await page.keyboard.press("ControlOrMeta+b");
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const trigger = switcher(page);
  await trigger.focus();
  await expect(page.getByRole("tooltip")).toHaveText("Teacher portal");
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await expectNoA11yViolations(page);
});

test.describe("on a phone (390 CSS px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the switcher works inside the sidebar sheet", async ({ page }) => {
    await devLogin(page, COORDINATOR);
    await expect(page).toHaveURL(/\/teacher$/);
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Show or hide the sidebar" })
      .click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: /Switch portal/ }).click();
    await expect(page.getByRole("menuitem", { name: /Admin portal/ })).toBeVisible();
  });
});
