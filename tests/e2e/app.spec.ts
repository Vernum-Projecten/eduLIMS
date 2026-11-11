// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";
import { devLogin, expectNoA11yViolations } from "./fixtures";

test("home page renders with landmarks and a skip link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "eduLIMS" })).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Naar de hoofdinhoud" })).toBeFocused();
  await expectNoA11yViolations(page);
});

test("login page has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Inloggen met Hanze-account" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("login form announces validation errors", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Inloggen met testaccount" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "geldig e-mailadres" })).toBeVisible();
  await expect(page.getByLabel("E-mailadres")).toHaveAttribute("aria-invalid", "true");
  await expectNoA11yViolations(page);
});

test("responses carry security headers", async ({ request }) => {
  const response = await request.get("/login");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["strict-transport-security"]).toContain("max-age=");
});

test("anonymous visitors are redirected from /docent to /login", async ({ page }) => {
  await page.goto("/docent");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdocent$/);
  await expect(page.getByRole("heading", { name: "Inloggen" })).toBeVisible();
});

test("a student cannot open the docent portal", async ({ page }) => {
  await devLogin(page, "student@example.test");
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole("heading", { level: 1, name: "Studentportaal" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hoofdmenu" })).not.toContainText("Docent");
  await expectNoA11yViolations(page);

  await page.goto("/docent");
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole("heading", { name: "Docentportaal" })).toHaveCount(0);
});

test("a docent lands on the docent portal and can log out", async ({ page }) => {
  await devLogin(page, "docent@example.test");
  await expect(page.getByRole("heading", { level: 1, name: "Docentportaal" })).toBeVisible();
  await page.getByRole("button", { name: "Uitloggen" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/docent");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdocent$/);
});
