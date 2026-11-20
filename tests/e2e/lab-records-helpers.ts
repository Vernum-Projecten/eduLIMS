// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared steps of the patients and requests journeys (S11, S12, S16, #380). Test support only.
import { randomBytes } from "node:crypto";
import { expect, type Page, type Route } from "@playwright/test";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";
import { seedControlRequest, seedLabRecords } from "./lab-records-seed";
import { inEachLook, OTHER_LOOKS } from "./looks";
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
  await inEachLook(page, OTHER_LOOKS, async (locale) => {
    const heading = locale === "nl" ? dutch(key) : h1;
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  });
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

/**
 * Opens the records page of `link` in the main menu while every read of the lab fails, expects
 * the error state, and expects "Try again" to load the page once the reads work (#268, #380).
 */
export async function expectErrorStateRetries(page: Page, link: string): Promise<void> {
  const seeded = await seedLabRecords(suffix());
  await devLogin(page, seeded.student.email);
  const pattern = "**/_serverFn/**";
  const fail = (route: Route) => {
    const request = route.request();
    return request.method() === "GET" && decodeURIComponent(request.url()).includes(seeded.labId)
      ? route.fulfill({ status: 500, body: "forced failure" })
      : route.fallback();
  };
  await page.route(pattern, fail);
  const nav = page.getByRole("navigation", { name: "Main menu" });
  const item = nav.getByRole("link", { name: link, exact: true });
  await expectHydrated(item);
  await item.click();
  const heading = page.getByRole("heading", { level: 1, name: "Something went wrong" });
  await expect(heading).toBeVisible();
  await axe(page);
  await page.unroute(pattern, fail);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: link })).toBeVisible();
}

/**
 * Signs a student of a finished simulation in on `path` and expects the page to read but take
 * nothing new: the alert, and the primary `action` in the tab order with `aria-disabled`, where
 * a press opens nothing (#267, #380). Returns the seeded lab for the page's own checks.
 */
export async function expectReadOnly(page: Page, path: string, h1: string, action: string) {
  const seeded = await seedLabRecords(suffix(), "finished");
  await seedControlRequest(seeded);
  await devLogin(page, seeded.student.email);
  return {
    seeded,
    check: async () => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
      await expect(
        page.getByRole("alert").filter({ hasText: "The simulation is not running" }),
      ).toBeVisible();
      const button = page.getByRole("button", { name: action });
      await expectHydrated(button);
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await button.press("Enter");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    },
  };
}
