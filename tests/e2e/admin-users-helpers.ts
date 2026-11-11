// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared steps of the Users screen's journeys (#34, #58).
import { readFileSync } from "node:fs";
import { type Browser, expect, type Locator, type Page } from "@playwright/test";
import { devLogin, expectNoA11yViolations } from "./fixtures";

const nl: Readonly<Record<string, string>> = JSON.parse(
  readFileSync(new URL("../../messages/nl.json", import.meta.url), "utf8"),
);

/** Returns the Dutch message `key`, so a missing translation fails the journey. */
export function dutch(key: string): string {
  const message = nl[key];
  if (message === undefined) throw new Error(`messages/nl.json has no "${key}"`);
  return message;
}

export const ADMIN = "admin@example.test";

/** Runs the axe scan once every animation (a sheet, a dialog, a toast) has finished. */
export async function axe(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  await expectNoA11yViolations(page);
}

export async function signInAsAdmin(page: Page): Promise<void> {
  await devLogin(page, ADMIN);
  await expect(page).toHaveURL(/\/admin$/);
}

/** Waits until React has hydrated `locator`, so keys typed into it are not lost. */
export async function whenHydrated(locator: Locator): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps"))),
    )
    .toBe(true);
}

export function usersTable(page: Page) {
  return page.getByRole("table");
}

/** Returns the body row of the user called `name`. */
export function userRow(page: Page, name: string) {
  return usersTable(page)
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name, exact: true }) });
}

/** Opens the detail sheet of the seeded user `name` through a search. */
export async function openUser(page: Page, name: string) {
  await page.goto(`/admin/users?q=${encodeURIComponent(name)}`);
  await usersTable(page).getByRole("link", { name }).click();
  const sheet = page.getByRole("dialog", { name });
  await expect(sheet).toBeVisible();
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return sheet;
}

/** Signs `email` in, in a browser context of its own, and returns that page. */
export async function signedInElsewhere(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await devLogin(page, email);
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

/**
 * Makes every server function write (a POST) fail with a 500 until the returned function is
 * called, to prove an optimistic update rolls back. Reads (GET) pass.
 */
export async function failServerWrites(page: Page): Promise<() => Promise<void>> {
  const pattern = "**/_serverFn/**";
  const handler = (route: import("@playwright/test").Route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 500, body: "forced failure" })
      : route.fallback();
  await page.route(pattern, handler);
  return () => page.unroute(pattern, handler);
}
