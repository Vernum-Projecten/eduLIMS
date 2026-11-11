// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { DEV_PASSWORD, expectNoA11yViolations } from "./fixtures";

// The Dutch copy comes from the catalogue, so the assertions follow the translation.
const nl: Readonly<Record<string, string>> = JSON.parse(
  readFileSync(new URL("../../messages/nl.json", import.meta.url), "utf8"),
);

function dutch(key: string): string {
  const message = nl[key];
  if (message === undefined) throw new Error(`messages/nl.json has no "${key}"`);
  return message;
}

test("the interface is English by default", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "English" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("switching to Dutch changes the UI and <html lang>, and the choice sticks", async ({
  page,
}) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });

  await page.goto("/login");
  const switcher = page.getByRole("group", { name: "Language" });
  await switcher.getByRole("button", { name: "Nederlands" }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(page.getByRole("heading", { level: 1, name: dutch("sign_in") })).toBeVisible();
  await expect(page).toHaveTitle(`${dutch("sign_in")} | eduLIMS`);
  await expect(page.getByRole("button", { name: dutch("login_microsoft") })).toBeVisible();
  await expect(page.getByRole("link", { name: dutch("skip_to_content") })).toBeAttached();
  await expect(
    page
      .getByRole("group", { name: dutch("language_switcher_label") })
      .getByRole("button", { name: "Nederlands" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectNoA11yViolations(page);

  // The cookie keeps Dutch across navigations, including the server-rendered portal.
  await page.getByLabel(dutch("field_email")).fill("student@example.test");
  await page.getByLabel(dutch("field_password")).fill(DEV_PASSWORD);
  await page.getByRole("button", { name: dutch("dev_login_submit") }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: dutch("portal_student") }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(page.getByRole("button", { name: dutch("sign_out") })).toBeVisible();

  // Back to English.
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "Student portal" })).toBeVisible();
  expect(hydrationErrors).toEqual([]);
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
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
