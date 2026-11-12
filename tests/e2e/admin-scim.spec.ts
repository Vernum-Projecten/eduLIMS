// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Provisioning with SCIM (#45, ADR 0017): an administrator creates a provider's SCIM token on
// its detail page and sees it once, the identity provider provisions a user with it, the Users
// screen shows that user as provisioned and never signed in, and the token is replaced and
// revoked with a confirmation. Every state is axe-clean.
import { expect, type Page, test } from "@playwright/test";
import { devLogin, expectHydrated, expectNoA11yViolations } from "./fixtures";
import { appUrl } from "./run-env";

const PROVIDER_PAGE = "/admin/system/identity-providers/keycloak";

async function axe(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  await expectNoA11yViolations(page);
}

async function openScim(page: Page): Promise<void> {
  await page.goto(PROVIDER_PAGE);
  await expect(page.getByRole("heading", { level: 2, name: "Provisioning (SCIM)" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("an administrator issues a SCIM token once, the directory provisions a user, the token is replaced and revoked", async ({
  page,
  request,
}) => {
  await devLogin(page, "admin@example.test");
  await expect(page).toHaveURL(/\/admin$/);
  await openScim(page);
  await expect(page.getByRole("textbox", { name: "SCIM endpoint (tenant URL)" })).toHaveValue(
    `${appUrl()}/api/auth/scim/v2`,
  );

  // A token left by an earlier run is revoked first, so the journey starts from none.
  const leftover = page.getByRole("button", { name: "Revoke token" });
  if (await leftover.isVisible()) {
    await leftover.click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Revoke token" }).click();
  }
  await expect(page.getByText("No SCIM token.", { exact: false })).toBeVisible();
  await axe(page);

  const create = page.getByRole("button", { name: "Create token" });
  await expectHydrated(create);
  await create.click();
  const tokenField = page.getByRole("textbox", { name: "SCIM token", exact: true });
  await expect(tokenField).toHaveValue(/^edulims_scim_[A-Za-z0-9_-]{43}$/);
  const token = await tokenField.inputValue();
  await expect(page.getByText(/Token created .*, expires .*, last used never\./)).toBeVisible();
  await expect(page.getByText(/^This token expires /)).toBeVisible();
  await axe(page);

  // The identity provider provisions a user with it, before that user ever signs in.
  const email = `scim-${Date.now()}@example.test`;
  const created = await request.post(`${appUrl()}/api/auth/scim/v2/Users`, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/scim+json" },
    data: {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      externalId: `e2e-${Date.now()}`,
      userName: email,
      displayName: "Provisioned Student",
      emails: [{ value: email, primary: true }],
      active: true,
    },
  });
  expect(created.status()).toBe(201);

  // Shown once: after "I have copied it" nothing on the page holds it any more.
  await page.getByRole("button", { name: "I have copied it" }).click();
  await expect(tokenField).toHaveCount(0);
  await page.reload();
  await expect(page.locator("body")).not.toContainText(token);

  await page.goto(`/admin/users?q=${encodeURIComponent(email)}`);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row.getByText("Provisioned by Keycloak")).toBeVisible();
  await expect(row.getByText("Never signed in")).toBeVisible();
  await axe(page);

  await openScim(page);
  await page.getByRole("button", { name: "Replace token" }).click();
  const replace = page.getByRole("alertdialog", { name: "Replace the SCIM token?" });
  await expect(replace).toBeVisible();
  await axe(page);
  await replace.getByRole("button", { name: "Replace token" }).click();
  await expect(tokenField).not.toHaveValue(token);
  await expect(tokenField).toHaveValue(/^edulims_scim_/);
  // The previous token keeps working for one hour, so the IdP switches without a gap.
  await expect(page.getByText(/^The previous token keeps working until /).first()).toBeVisible();
  const asOld = { headers: { authorization: `Bearer ${token}` } };
  expect((await request.get(`${appUrl()}/api/auth/scim/v2/Users`, asOld)).status()).toBe(200);
  await axe(page);

  await page.getByRole("button", { name: "Revoke token" }).click();
  const revoke = page.getByRole("alertdialog", { name: "Revoke the SCIM token?" });
  await revoke.getByRole("button", { name: "Revoke token" }).click();
  await expect(page.getByText("SCIM token revoked").first()).toBeVisible();
  await expect(page.getByText("No SCIM token.", { exact: false })).toBeVisible();
  // Revoking ends the overlapping previous token at once too.
  expect((await request.get(`${appUrl()}/api/auth/scim/v2/Users`, asOld)).status()).toBe(401);
});

test("the SCIM endpoint refuses a request without a token", async ({ request }) => {
  const response = await request.get(`${appUrl()}/api/auth/scim/v2/Users`);
  expect(response.status()).toBe(401);
});
