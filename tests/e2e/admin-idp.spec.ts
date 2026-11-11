// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Admin → System → Identity providers (#46, ADR 0015): an administrator adds a SAML provider from
// its metadata, enables it, sees its button on the sign-in page, and disables it again; the
// screens are axe-clean in light, dark and Dutch, and closed to other roles. The SAML metadata is
// the synthetic fixture, so the journey needs no running identity provider.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { devLogin, expectNoA11yViolations } from "./fixtures";
import { appUrl } from "./run-env";

const nl: Readonly<Record<string, string>> = JSON.parse(
  readFileSync(new URL("../../messages/nl.json", import.meta.url), "utf8"),
);
const METADATA = readFileSync(
  new URL("../fixtures/idp/saml-idp-metadata.xml", import.meta.url),
  "utf8",
);

function dutch(key: string): string {
  const message = nl[key];
  if (message === undefined) throw new Error(`messages/nl.json has no "${key}"`);
  return message;
}

async function axe(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  await expectNoA11yViolations(page);
}

async function signInAsAdmin(page: Page): Promise<void> {
  await devLogin(page, "admin@example.test");
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe.configure({ mode: "serial" });

test("an administrator adds a SAML provider, enables it, and the sign-in page shows it", async ({
  page,
  browser,
}) => {
  await signInAsAdmin(page);
  await page.getByRole("link", { name: "System" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
  await axe(page);
  await page.getByRole("link", { name: "Identity providers" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Identity providers" })).toBeVisible();
  await axe(page);

  await page.getByRole("link", { name: "Add SAML provider" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Add a SAML 2.0 provider" }),
  ).toBeVisible();
  await axe(page);

  // An empty form is refused at its fields, in text.
  await page.getByRole("button", { name: "Add provider" }).click();
  await expect(page.getByText("Paste the metadata XML or enter its URL.")).toBeVisible();
  await expect(page.getByLabel("Provider id")).toHaveAttribute("aria-invalid", "true");

  await page.getByLabel("Provider id").fill("e2e-campus");
  await page.getByLabel("Name in English").fill("E2E Campus");
  await page.getByLabel("Name in Dutch").fill("E2E Campus NL");
  await page.getByLabel("Identity provider metadata (XML)").fill(METADATA);
  await page.getByLabel("Role attribute").fill("Role");
  await page.getByRole("button", { name: "Add a value" }).click();
  await page.getByLabel("Value from the provider, row 1").fill("e2e-teacher");
  await page.getByLabel("eduLIMS role, row 1").selectOption("teacher");
  await page.getByRole("button", { name: "Add provider" }).click();

  await expect(page).toHaveURL(/\/admin\/system\/identity-providers\/e2e-campus$/);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Campus" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Assertion consumer service URL" })).toHaveValue(
    `${appUrl()}/api/auth/sso/saml2/sp/acs/e2e-campus`,
  );
  await expect(page.getByText("Disabled", { exact: true })).toBeVisible();
  await axe(page);

  // Switched off, the sign-in page does not offer it.
  const visitor = await browser.newPage();
  await visitor.goto("/login");
  await expect(visitor.getByRole("button", { name: "Sign in with E2E Campus" })).toHaveCount(0);

  await page.getByRole("button", { name: "Enable" }).click();
  await expect(
    page.getByText("E2E Campus is enabled and shows on the sign-in page."),
  ).toBeVisible();
  await visitor.goto("/login");
  await expect(visitor.getByRole("button", { name: "Sign in with E2E Campus" })).toBeVisible();

  await page.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText("E2E Campus is disabled. Nobody can sign in with it.")).toBeVisible();
  await visitor.goto("/login");
  await expect(visitor.getByRole("button", { name: "Sign in with E2E Campus" })).toHaveCount(0);
  await visitor.close();

  // The list shows it, and deleting it asks first.
  await page.getByRole("link", { name: "All identity providers" }).click();
  await expect(page.getByRole("link", { name: "E2E Campus" })).toBeVisible();
  await page.getByRole("link", { name: "E2E Campus" }).click();
  await page.getByRole("button", { name: "Delete provider" }).click();
  await expect(page.getByRole("alertdialog", { name: "Delete E2E Campus?" })).toBeVisible();
  await axe(page);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/system\/identity-providers$/);
  await expect(page.getByRole("link", { name: "E2E Campus" })).toHaveCount(0);
});

test("the provider screens are translated and axe-clean in the dark theme and Dutch", async ({
  page,
  context,
}) => {
  await signInAsAdmin(page);
  await context.addCookies([
    { name: "EDULIMS_THEME", value: "dark", url: appUrl() },
    { name: "EDULIMS_LOCALE", value: "nl", url: appUrl() },
  ]);
  await page.goto("/admin/system/identity-providers");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.getByRole("heading", { level: 1, name: dutch("idp_title") })).toBeVisible();
  await axe(page);
  await page.goto("/admin/system/identity-providers/new?protocol=oidc");
  await expect(
    page.getByRole("heading", { level: 1, name: dutch("idp_new_oidc_title") }),
  ).toBeVisible();
  await axe(page);
  await page.goto("/admin/system/identity-providers/keycloak");
  await expect(
    page.getByRole("heading", { level: 2, name: dutch("idp_urls_title") }),
  ).toBeVisible();
  await axe(page);
});

test("the provider screens are closed to a teacher", async ({ page }) => {
  await devLogin(page, "teacher@example.test");
  await expect(page).toHaveURL(/\/teacher$/);
  await page.goto("/admin/system/identity-providers");
  await expect(page.getByRole("heading", { level: 1, name: "Identity providers" })).toHaveCount(0);
});
