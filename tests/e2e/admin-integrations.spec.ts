// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The integration status of the Admin portal (B3, #35, #227): each integration with its state on
// the card's title row, FerroEHR's three steps, FerroBRIDGE's readiness, the quiet check status
// beside Check now, and axe in light, dark and Dutch. The journeys run in order: only they assert
// a state, and the stub on this run's integration port (integration-stub.ts) is theirs alone.
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { axe, dutch, signInAsAdmin } from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";
import { clearIntegrationChecks } from "./integration-checks";
import { HEALTHY, type IntegrationStub, startIntegrationStub } from "./integration-stub";
import { appUrl } from "./run-env";

test.describe.configure({ mode: "serial" });

async function openStatus(page: Page): Promise<void> {
  await page.goto("/admin/integrations");
  await expectHydrated(page.getByRole("button", { name: "Check now" }));
}

function card(page: Page, name: string) {
  return page.locator('[data-slot="card"]', {
    has: page.getByRole("heading", { level: 3, name }),
  });
}

/** The state badge on a card's title row (its `CardAction`). */
function badge(page: Page, name: string) {
  return card(page, name).locator('[data-slot="card-action"]');
}

function step(page: Page, name: string) {
  return card(page, "FerroEHR")
    .getByRole("list", { name: "Checks" })
    .getByRole("listitem")
    .filter({ has: page.getByText(name, { exact: true }) });
}

async function setPreferences(
  context: BrowserContext,
  theme: "light" | "dark",
  locale: "en" | "nl",
): Promise<void> {
  await context.addCookies([
    { name: "EDULIMS_THEME", value: theme, url: appUrl() },
    { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
  ]);
}

async function checkNow(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByText("Integrations checked.")).toBeVisible();
}

test("the status screen shows each integration with an icon and text, and Check now (B3)", async ({
  page,
}) => {
  // No check has ever succeeded: a stub journey of an earlier attempt or repeat leaves its success.
  await clearIntegrationChecks();
  await signInAsAdmin(page);
  await openStatus(page);
  await expect(page.getByRole("heading", { level: 2, name: "Integration status" })).toBeVisible();
  await checkNow(page);
  // Nothing listens on this run's integration port outside the stub journeys below.
  for (const name of ["FerroEHR", "FerroBRIDGE"]) {
    await expect(card(page, name)).toContainText("Unavailable");
    await expect(card(page, name)).toContainText("No connection to the service.");
    await expect(card(page, name)).toContainText("Last check");
    await expect(card(page, name)).toContainText("Never");
  }
  await expect(page.getByRole("status").filter({ hasText: "FerroEHR: Unavailable." })).toHaveCount(
    1,
  );
  // #227: the badge sits on the title row; later steps are skipped, never shown as passed.
  await expect(badge(page, "FerroEHR")).toHaveText("Unavailable");
  await expect(step(page, "Reachable")).toContainText("Failed");
  await expect(step(page, "Signed in")).toContainText("Not checked: an earlier check failed");
  await expect(page.locator('[data-slot="check-status"]')).toHaveText(/^Checked /);
  await axe(page);
});

test.describe("with the stub answering (#227)", () => {
  let stub: IntegrationStub;

  test.beforeAll(async () => {
    stub = await startIntegrationStub();
  });

  test.afterAll(async () => {
    await stub.close();
  });

  test("a missing template and a FerroBRIDGE indicator that is down show as not ready", async ({
    page,
  }, testInfo) => {
    stub.set({
      templates: { status: 200, body: [] },
      readiness: {
        status: 503,
        body: {
          state: "down",
          phase: "serving",
          indicators: [
            { name: "cdr", state: "up" },
            { name: "terminology", state: "down" },
          ],
        },
      },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(page);
    await openStatus(page);
    await checkNow(page);
    const ferroehr = card(page, "FerroEHR");
    await expect(badge(page, "FerroEHR")).toHaveText("Not ready");
    await expect(step(page, "Reachable")).toContainText("Passed");
    await expect(step(page, "Signed in")).toContainText("Passed");
    await expect(step(page, "Template eduLIMS-lab.v1 loaded")).toContainText(
      "Not loaded in FerroEHR",
    );
    await expect(ferroehr).toContainText("This is not an error in eduLIMS");
    await expect(ferroehr).toContainText("5.7.0");
    await expect(ferroehr).toContainText("1.1.0");
    await expect(badge(page, "FerroBRIDGE")).toHaveText("Not ready");
    await expect(card(page, "FerroBRIDGE")).toContainText("Indicators not up");
    await expect(card(page, "FerroBRIDGE").getByRole("listitem")).toHaveText(["terminology"]);
    await expect(
      page.getByRole("status").filter({ hasText: "FerroBRIDGE: Not ready." }),
    ).toHaveCount(1);
    await axe(page);
    await page.screenshot({ path: testInfo.outputPath("integration-status-1440x900.png") });
  });

  test("a refused token shows Refused (authentication) with its reason code, no secret", async ({
    page,
  }) => {
    stub.set({
      token: { status: 401, body: { error: "invalid_client", error_description: "bad secret" } },
    });
    await signInAsAdmin(page);
    await openStatus(page);
    await checkNow(page);
    const ferroehr = card(page, "FerroEHR");
    await expect(badge(page, "FerroEHR")).toHaveText("Refused (authentication)");
    await expect(step(page, "Reachable")).toContainText("Passed");
    await expect(step(page, "Signed in")).toContainText("Refused (authentication)");
    await expect(ferroehr).toContainText("Reason code");
    await expect(ferroehr.getByText("invalid_client", { exact: true })).toBeVisible();
    await expect(ferroehr).toContainText("The token endpoint (sign-in service)");
    // The whole document, the dehydrated query data included.
    const text = await page.content();
    for (const secret of ["bad secret", "e2e-only-ferroehr-client-secret", "e2e-stub-token"]) {
      expect(text).not.toContain(secret);
    }
    await axe(page);
  });

  test("Check now shows Updating… beside the button, then when it checked", async ({ page }) => {
    stub.set({ ...HEALTHY, delayMs: 1_500 });
    await signInAsAdmin(page);
    await openStatus(page);
    const status = page.locator('[data-slot="check-status"]');
    const before = await status.boundingBox();
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(status).toHaveText("Updating…");
    // The status keeps its width, so the button beside it does not move.
    expect((await status.boundingBox())?.width).toBe(before?.width);
    await expect(page.getByText("Integrations checked.")).toBeVisible();
    await expect(status).toHaveText(/^Checked /);
    await expect(badge(page, "FerroEHR")).toHaveText("Available");
    await expect(badge(page, "FerroBRIDGE")).toHaveText("Available");
    for (const name of ["Reachable", "Signed in", "Template eduLIMS-lab.v1 loaded"]) {
      await expect(step(page, name)).toContainText("Passed");
    }
    await expect(page.getByRole("status").filter({ hasText: "FerroEHR: Available." })).toHaveCount(
      1,
    );
  });

  test("each change of state is in the activity log (B4)", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/activity");
    await expect(
      page.getByRole("table").getByText("Integration status changed").first(),
    ).toBeVisible();
    await expect(page.getByRole("table")).toContainText("Integration FerroEHR");
    // A change Check now found names the administrator who pressed it (#247).
    await expect(
      page
        .getByRole("table")
        .getByRole("row")
        .filter({ hasText: "Integration status changed" })
        .filter({ hasText: "Test Administrator" })
        .first(),
    ).toBeVisible();
    await expect(page.getByRole("table")).not.toContainText("e2e-stub-token");
  });

  for (const [theme, locale] of [
    ["dark", "en"],
    ["light", "nl"],
    ["dark", "nl"],
  ] as const) {
    test(`the steps and the not-ready state are axe-clean in ${theme}, ${locale} (Q-ACC-1)`, async ({
      page,
      context,
    }) => {
      stub.set({
        templates: { status: 200, body: [] },
        readiness: {
          status: 503,
          body: { state: "down", phase: "booting", indicators: [{ name: "cdr", state: "down" }] },
        },
      });
      await devLogin(page, "admin@example.test");
      // The sign-in lands first; a navigation before it aborts the sign-in request.
      await expect(page).toHaveURL(/\/admin$/);
      await setPreferences(context, theme, locale);
      const t = (key: string, english: string) => (locale === "nl" ? dutch(key) : english);
      await page.goto("/admin/integrations");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const check = page.getByRole("button", {
        name: t("admin_integrations_check_now", "Check now"),
      });
      await expectHydrated(check);
      await check.click();
      // The previous variant left the same state, so the badge alone does not show this check.
      await expect(
        page.getByText(t("admin_integrations_checked", "Integrations checked.")),
      ).toBeVisible();
      await expect(badge(page, "FerroEHR")).toHaveText(
        t("admin_integrations_state_not_ready", "Not ready"),
      );
      await expect(card(page, "FerroBRIDGE")).toContainText(
        t("admin_integrations_phase_booting", "Starting up"),
      );
      await axe(page);
    });
  }
});
