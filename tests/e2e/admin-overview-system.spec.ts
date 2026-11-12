// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Admin portal's overview and its system page (#36): the tiles and their links, the latest
// activity, the keyboard path, the 2-second load, the system page without a secret, axe in
// light, dark and Dutch, and reflow at 320 px.
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { axe, dutch, signInAsAdmin } from "./admin-users-helpers";
import { devLogin, expectHydrated, pressUntilFocused } from "./fixtures";
import { appUrl, E2E_SECRETS } from "./run-env";

/** The client secrets the e2e providers are stored with: the dev realm's, or the test default. */
const STORED_CLIENT_SECRETS = ["edulims-dev-secret", "test-client-secret"];

async function usePreferences(
  context: BrowserContext,
  theme: "light" | "dark",
  locale: "en" | "nl",
): Promise<void> {
  await context.addCookies([
    { name: "EDULIMS_THEME", value: theme, url: appUrl() },
    { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
  ]);
}

function section(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

test("the overview shows the counts, the integrations and the latest activity (#36)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await expect(page.getByRole("heading", { level: 1, name: "Admin portal" })).toBeVisible();
  const accounts = section(page, "Accounts");
  const tiles = [
    "All users",
    "Students",
    "Teachers",
    "Administrators",
    "Blocked users",
    "Active classes",
    "Pending class invitations",
  ];
  for (const tile of tiles) {
    await expect(accounts.getByRole("link", { name: tile, exact: true })).toBeVisible();
  }
  await expect(accounts.getByRole("heading", { level: 3, name: "Active sessions" })).toBeVisible();

  const integrations = section(page, "Integrations");
  await expect(integrations.getByRole("link", { name: "FerroEHR" })).toBeVisible();
  await expect(integrations.getByRole("link", { name: "FerroBRIDGE" })).toBeVisible();

  const activity = section(page, "Latest activity");
  await expect(activity.getByRole("listitem")).toHaveCount(10);
  await expect(activity.getByRole("link", { name: "Full activity log" })).toBeVisible();
  await axe(page);
});

test("the overview's links open their screens with the filter in the URL (#36)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  const accounts = section(page, "Accounts");
  await expectHydrated(accounts.getByRole("link", { name: "Students", exact: true }));
  await accounts.getByRole("link", { name: "Students", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users\?/);
  expect(new URL(page.url()).searchParams.get("role")).toBe('["student"]');
  await expect(page.getByRole("heading", { level: 1, name: "Users and roles" })).toBeVisible();

  await page.goto("/admin");
  await section(page, "Accounts").getByRole("link", { name: "Blocked users" }).click();
  await expect(page).toHaveURL(/\/admin\/users\?/);
  expect(new URL(page.url()).searchParams.get("status")).toBe('["blocked"]');

  // The class tiles open the class list (#28), the active-classes tile filtered on active (#37).
  await page.goto("/admin");
  await section(page, "Accounts").getByRole("link", { name: "Active classes" }).click();
  await expect(page).toHaveURL(/\/admin\/classes\/?\?/);
  expect(new URL(page.url()).searchParams.get("status")).toBe('["active"]');
  await expect(page.getByRole("heading", { level: 1, name: "Classes" })).toBeVisible();

  await page.goto("/admin");
  await section(page, "Integrations").getByRole("link", { name: "FerroEHR" }).click();
  await expect(page).toHaveURL(/\/admin\/integrations$/);

  await page.goto("/admin");
  await section(page, "Latest activity").getByRole("link", { name: "Full activity log" }).click();
  await expect(page).toHaveURL(/\/admin\/activity$/);
});

test("the overview works with the keyboard alone (#36, WCAG 2.1.1)", async ({ page }) => {
  await signInAsAdmin(page);
  const allUsers = section(page, "Accounts").getByRole("link", { name: "All users" });
  await expectHydrated(allUsers);
  await page.getByRole("heading", { level: 1, name: "Admin portal" }).click();
  await pressUntilFocused(page, "Tab", allUsers, 10);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/users$/);

  await page.goto("/admin");
  const fullLog = section(page, "Latest activity").getByRole("link", { name: "Full activity log" });
  await expectHydrated(fullLog);
  // The tiles come first, then the integrations, then the link to the full log.
  await page.getByRole("heading", { level: 1, name: "Admin portal" }).click();
  await pressUntilFocused(page, "Tab", fullLog, 12);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/activity$/);
});

// NOTE: the requirements' performance criterion and #36: the overview loads within 2 seconds
// with the seeded data (the e2e database holds `pnpm db:seed`'s demo set).
test("the overview loads within 2 seconds with the seeded data (#36)", async ({ page }) => {
  await signInAsAdmin(page);
  const start = Date.now();
  await page.goto("/admin", { waitUntil: "load" });
  await expect(section(page, "Latest activity").getByRole("listitem")).toHaveCount(10);
  const elapsed = Date.now() - start;
  test.info().annotations.push({ type: "overview load ms", description: String(elapsed) });
  expect(elapsed).toBeLessThan(2_000);
});

test("the system page shows the providers and the build, and no secret (#36)", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/system");
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Identity providers" })).toBeVisible();
  const providers = section(page, "Enabled identity providers");
  await expect(
    providers.getByRole("heading", { level: 3, name: "Keycloak", exact: true }),
  ).toBeVisible();
  await expect(providers).toContainText(`${appUrl()}/api/auth/sso/callback/keycloak`);
  await expect(providers).toContainText(`${appUrl()}/api/auth/sso/saml2/sp/acs/keycloak-saml`);
  await expect(providers).toContainText("realm_access.roles");
  await expect(
    providers.getByRole("table", { name: "Role map" }).first().getByRole("columnheader"),
  ).toHaveText(["Value from the provider", "eduLIMS role"]);
  // The e2e server is no release image, so it has no version, commit or provenance.
  await expect(section(page, "Version and build").getByText("Not available")).toHaveCount(4);

  const html = await page.content();
  for (const secret of [...Object.values(E2E_SECRETS), ...STORED_CLIENT_SECRETS]) {
    expect(html).not.toContain(secret);
  }
  await axe(page);

  await page.getByRole("link", { name: "Identity providers" }).click();
  await expect(page).toHaveURL(/\/admin\/system\/identity-providers$/);
});

for (const [theme, locale] of [
  ["light", "en"],
  ["dark", "en"],
  ["light", "nl"],
  ["dark", "nl"],
] as const) {
  test(`the overview and the system page are axe-clean in ${theme}, ${locale} (#36, Q-ACC-1)`, async ({
    page,
    context,
  }) => {
    await devLogin(page, "admin@example.test");
    await expect(page).toHaveURL(/\/admin$/);
    await usePreferences(context, theme, locale);
    const t = (key: string, english: string) => (locale === "nl" ? dutch(key) : english);

    await page.goto("/admin");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: t("admin_overview_activity_heading", "Latest activity"),
      }),
    ).toBeVisible();
    await axe(page);

    await page.goto("/admin/system");
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: t("admin_system_build_heading", "Version and build"),
      }),
    ).toBeVisible();
    await axe(page);
  });
}

test("both pages reflow at 320 px without horizontal scrolling (#36, WCAG 1.4.10)", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of ["/admin", "/admin/system"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test("a student and a teacher see neither page (#36, A01)", async ({ browser }) => {
  for (const email of ["student@example.test", "teacher@example.test"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await devLogin(page, email);
    await expect(page).not.toHaveURL(/\/login/);
    for (const path of ["/admin", "/admin/system"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Accounts" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Version and build" })).toHaveCount(0);
    }
    await context.close();
  }
});
