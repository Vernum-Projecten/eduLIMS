// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";
import { devLogin, expectNoA11yViolations } from "./fixtures";

test("home page renders with landmarks and a skip link", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "eduLIMS" })).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await expectNoA11yViolations(page);
});

test("login page offers each configured identity provider without WCAG A/AA violations", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page).toHaveTitle("Sign in | eduLIMS");
  await expect(page.getByRole("button", { name: "Sign in with Microsoft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Keycloak" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("login form announces validation errors", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in with a test account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "valid email address" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
  await expectNoA11yViolations(page);
});

test("responses carry security headers", async ({ request }) => {
  const response = await request.get("/login");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["strict-transport-security"]).toContain("max-age=");
});

test("session-dependent responses are never cached, built assets are (#41)", async ({
  page,
  request,
}) => {
  await devLogin(page, "teacher@example.test");
  await expect(page.getByRole("heading", { level: 1, name: "Teacher portal" })).toBeVisible();

  const portal = await page.request.get("/teacher");
  expect(portal.headers()["cache-control"]).toBe("no-store");

  // A client-side navigation re-reads the session through a server function.
  const serverFn = page.waitForResponse((response) => response.url().includes("/_serverFn/"));
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("link", { name: "Practicals" })
    .click();
  expect((await serverFn).headers()["cache-control"]).toBe("no-store");

  expect((await request.get("/login")).headers()["cache-control"]).toBe("no-store");

  const script = await page.locator("script[src*='/assets/']").first().getAttribute("src");
  const asset = await request.get(script ?? "/assets/missing.js");
  expect(asset.status()).toBe(200);
  expect(asset.headers()["cache-control"] ?? "").not.toContain("no-store");
});

test("an IdP sign-in without an eduLIMS role is explained", async ({ page }) => {
  await page.goto("/login?error=no_edulims_role");
  await expect(page.getByRole("alert")).toContainText("no role in eduLIMS");
  await expectNoA11yViolations(page);
});

test("anonymous visitors are redirected from /teacher to /login", async ({ page }) => {
  await page.goto("/teacher");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fteacher$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("a student cannot open the teacher portal", async ({ page }) => {
  await devLogin(page, "student@example.test");
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole("heading", { level: 1, name: "Student portal" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main menu" })).not.toContainText("Teacher");
  await expectNoA11yViolations(page);

  await page.goto("/teacher");
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole("heading", { name: "Teacher portal" })).toHaveCount(0);
});

test("a teacher lands on the teacher portal and can sign out", async ({ page }) => {
  await devLogin(page, "teacher@example.test");
  await expect(page.getByRole("heading", { level: 1, name: "Teacher portal" })).toBeVisible();
  // Signing out lives in the user menu at the foot of the sidebar.
  await page.getByRole("button", { name: /teacher@example\.test/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/teacher");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fteacher$/);
});

test("an unknown page shows a not-found page inside the app shell", async ({ page }) => {
  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the home page" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("the header shows the brand mark beside the name, and the icons are served", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const home = page.getByRole("banner").getByRole("link", { name: "eduLIMS", exact: true });
  await expect(home).toBeVisible();
  await expect(home.locator("svg")).toHaveAttribute("aria-hidden", "true");
  for (const path of [
    "/favicon.svg",
    "/favicon.ico",
    "/apple-touch-icon.png",
    "/manifest.webmanifest",
  ]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});
