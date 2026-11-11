// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A real OIDC round trip through the development Keycloak, registered at runtime by
// `pnpm db:seed` (#46, ADR 0015): sign in with the Keycloak button, land in the portal of the
// mapped role, sign out, and return through Keycloak's end-session endpoint to the login page
// (RP-initiated logout, #25). Skipped when that Keycloak does not run (CI).
import { expect, test } from "@playwright/test";
import { expectHydrated, expectNoA11yViolations } from "./fixtures";
import { appUrl } from "./run-env";

const REALM = process.env["EDULIMS_E2E_KEYCLOAK_REALM"] ?? "http://localhost:8180/realms/edulims";

async function keycloakRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${REALM}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

test("a teacher signs in through Keycloak and signs out through it back to /login", async ({
  page,
}) => {
  test.skip(!(await keycloakRunning()), `no Keycloak realm at ${REALM}`);
  await page.goto("/login");
  const keycloak = page.getByRole("button", { name: "Sign in with Keycloak", exact: true });
  await expectHydrated(keycloak);
  await keycloak.click();
  await page.waitForURL(/\/realms\/edulims\//);
  await page.getByLabel(/Username or email/).fill("teacher");
  await page.getByLabel("Password", { exact: true }).fill("teacher");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/teacher$/);
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: /teacher@edulims\.test/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${appUrl()}/login`);
  // The Keycloak session ended too: the next sign-in asks for the password again.
  await page.getByRole("button", { name: "Sign in with Keycloak", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

test("a student refused for conflicting roles sees why on the login page", async ({ page }) => {
  test.skip(!(await keycloakRunning()), `no Keycloak realm at ${REALM}`);
  await page.goto("/login");
  const keycloak = page.getByRole("button", { name: "Sign in with Keycloak", exact: true });
  await expectHydrated(keycloak);
  await keycloak.click();
  await page.waitForURL(/\/realms\/edulims\//);
  await page.getByLabel(/Username or email/).fill("conflict");
  await page.getByLabel("Password", { exact: true }).fill("conflict");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/login\?error=role_conflict/);
  await expect(page.getByRole("alert")).toContainText("conflicting roles");
});
