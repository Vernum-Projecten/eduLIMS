// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Measurements and the release of a result (S14, S15, #270): a student enters two measurements
// with the keyboard alone, sees a refusal at its field, gets the warning against the team's own
// tolerance with an icon and text, cancels, and releases after all; focus returns to the opener
// and, once the button is gone, to the test's heading. A student of another lab sees none of it;
// the teacher sees both measurements with the released one marked. Axe in light, dark and Dutch,
// at 320 px wide, and the read's error state with its retry. Everything is invented (Q-PRIV-4).
import { randomBytes } from "node:crypto";
import { expect, type Page, type Route, test } from "@playwright/test";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";
import { type ResultsWorld, seedResults } from "./results-seed";
import { appUrl } from "./run-env";

test.describe.configure({ mode: "serial" });

const SUFFIX = randomBytes(3).toString("hex").toUpperCase();
let world: ResultsWorld;

test.beforeAll(async () => {
  world = await seedResults(SUFFIX);
});

function measurements(page: Page) {
  return page.getByRole("table", { name: `Measurements of ${world.testName}` });
}

test("a student measures twice and releases one result with the keyboard (S14, S15)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await devLogin(page, world.student.email);
  await page.goto("/student/results");
  await expect(
    page.getByRole("heading", { level: 3, name: `Request for ${world.patient}` }),
  ).toBeVisible();
  await expect(page.getByText("No measurement yet.")).toBeVisible();
  await expect(page.getByText("4 to 6 mmol/L")).toBeVisible();
  await axe(page);

  const measure = page.getByRole("button", { name: `Enter measurement for ${world.testName}` });
  await expectHydrated(measure);
  await measure.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Measurement of ${world.testName}` });
  const value = dialog.getByLabel("Measured value");
  await expect(value).toHaveValue("");

  // A refusal is named at its field (WCAG 3.3.1); exponent form is no number here.
  await dialog.getByRole("button", { name: "Save measurement" }).click();
  await expect(dialog.getByText("Enter the measured value.")).toBeVisible();
  await value.fill("1e5");
  await expect(
    dialog.getByText(
      "Enter a number with at most 9 digits before and 6 after the decimal separator.",
    ),
  ).toBeVisible();
  await axe(page);
  await value.fill("5,1");
  await value.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`Measurement of ${world.testName} saved.`)).toBeVisible();
  await expect(measure).toBeFocused();

  // A second measurement is kept beside the first (S14).
  await page.keyboard.press("Enter");
  await value.fill("7.2");
  await value.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(measurements(page).getByRole("row")).toHaveCount(3);

  // The value outside the team's own tolerance shows the warning, with an icon and text (S15).
  const releaseHigh = measurements(page)
    .getByRole("row")
    .filter({ hasText: "7.2" })
    .getByRole("button", { name: /Release the measurement 7\.2/ });
  await releaseHigh.focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog", {
    name: `Release the result of ${world.testName}?`,
  });
  await expect(confirm.getByText("Outside your tolerance")).toBeVisible();
  await expect(
    confirm.getByText(
      "The value is above your tolerance of 4 to 6 mmol/L. Check it before you release it.",
    ),
  ).toBeVisible();
  await axe(page);
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(releaseHigh).toBeFocused();

  // The team decides: it releases the value anyway (the warning never blocks).
  await page.keyboard.press("Enter");
  await confirm.getByRole("button", { name: "Release anyway" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText(`The result of ${world.testName} is released.`)).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 4, name: `${world.testName} (mmol/L)` }),
  ).toBeFocused();
  const released = measurements(page).getByRole("row").filter({ hasText: "7.2" });
  await expect(released).toContainText("Released");
  await expect(measurements(page).getByRole("button")).toHaveCount(0);
  await expect(measure).toHaveCount(0);
  await expect(page.getByText("Tolerance at the release:")).toBeVisible();
  await axe(page);
});

test("a student of another lab sees none of it (S10, Q-SIM-1)", async ({ page }) => {
  await devLogin(page, world.otherStudent.email);
  await page.goto("/student/results");
  await expect(page.getByText("No requests yet")).toBeVisible();
  await page.goto(`/student/results?lab=${world.labId}`);
  await expect(page.getByText(world.patient)).toHaveCount(0);
  await expect(page.getByText("7.2")).toHaveCount(0);
  await axe(page);
});

test("the teacher sees every measurement with the released one marked (D11)", async ({ page }) => {
  await devLogin(page, "teacher@example.test");
  await page.goto(`/teacher/simulations/${world.simulationId}/labs/${world.labId}`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Measurements and results" }),
  ).toBeVisible();
  const rows = measurements(page).getByRole("row");
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "7.2" })).toContainText("Released");
  await expect(rows.filter({ hasText: "5.1" })).not.toContainText("Released");
  await expect(measurements(page).getByRole("button")).toHaveCount(0);
  await axe(page);
});

test("the results page shows its error state and the retry recovers", async ({ page }) => {
  await devLogin(page, world.student.email);
  await expect(page).toHaveURL(/\/student$/);
  const pattern = "**/_serverFn/**";
  const handler = (route: Route) => {
    const request = route.request();
    return request.method() === "GET" && decodeURIComponent(request.url()).includes(world.labId)
      ? route.fulfill({ status: 500, body: "forced failure" })
      : route.fallback();
  };
  await page.route(pattern, handler);
  const link = page.getByRole("link", { name: "Measurements and results" }).first();
  await expectHydrated(link);
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
  await page.unroute(pattern, handler);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(measurements(page).getByRole("row")).toHaveCount(3);
});

test("the results page reflows at 320 px, in light, dark and Dutch (WCAG 1.4.10)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await devLogin(page, world.student.email);
  for (const [theme, locale] of [
    ["light", "en"],
    ["dark", "en"],
    ["light", "nl"],
    ["dark", "nl"],
  ] as const) {
    await page.context().addCookies([
      { name: "EDULIMS_THEME", value: theme, url: appUrl() },
      { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
    ]);
    await page.goto("/student/results");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const heading =
      locale === "nl"
        ? dutch("records_request_for").replace("{name}", world.patient)
        : `Request for ${world.patient}`;
    await expect(page.getByRole("heading", { level: 3, name: heading })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // The table scrolls in its own named region, which the keyboard reaches (WCAG 2.1.1).
    const region = page.getByRole("region", {
      name:
        locale === "nl"
          ? dutch("results_measurements_of").replace("{test}", world.testName)
          : `Measurements of ${world.testName}`,
    });
    await region.focus();
    await expect(region).toBeFocused();
    await axe(page);
  }
});
