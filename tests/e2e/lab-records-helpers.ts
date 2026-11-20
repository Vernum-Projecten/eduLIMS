// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared steps of the patients and requests journeys (S11, S12, S16, #380). Test support only.
import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { axe, dutch } from "./admin-users-helpers";
import { expectHydrated } from "./fixtures";
import { appUrl } from "./run-env";

/** Returns a run-unique suffix for the names a journey seeds. */
export function suffix(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

/** Asserts that the page scrolls only vertically (WCAG 1.4.10). */
export async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Opens the student's patients page and waits until its one action works. */
export async function openPatients(page: Page): Promise<void> {
  await page.goto("/student/patients");
  await expect(page.getByRole("heading", { level: 1, name: "Patients" })).toBeVisible();
  await expectHydrated(page.getByRole("button", { name: "Register a patient" }));
}

/** Opens the student's requests page and waits until its one action works. */
export async function openRequests(page: Page): Promise<void> {
  await page.goto("/student/requests");
  await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
  await expectHydrated(page.getByRole("button", { name: "Record a request" }));
}

/**
 * Runs axe on the page in dark, in Dutch and in both, then at 320 px wide in light English, where
 * the page must scroll only vertically (WCAG 1.4.10). `h1` is the page's English heading and
 * `key` its message key for the Dutch one.
 */
export async function axeInEveryLook(page: Page, h1: string, key: string): Promise<void> {
  for (const [theme, locale] of [
    ["dark", "en"],
    ["light", "nl"],
    ["dark", "nl"],
  ] as const) {
    await page.context().addCookies([
      { name: "EDULIMS_THEME", value: theme, url: appUrl() },
      { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
    ]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const heading = locale === "nl" ? dutch(key) : h1;
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await axe(page);
  }
  await page.context().addCookies([
    { name: "EDULIMS_THEME", value: "light", url: appUrl() },
    { name: "EDULIMS_LOCALE", value: "en", url: appUrl() },
  ]);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
  await expectNoPageOverflow(page);
  await axe(page);
}
