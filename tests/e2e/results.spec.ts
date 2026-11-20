// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Measurements and the release of a result (S14, S15, #270). A student enters measurements with
// the keyboard alone, sees each refusal at its field, opens the release of a value inside, below
// and above the team's own tolerance (the warning with an icon and text), cancels with Escape and
// releases after all; focus returns to the opener and, once the button is gone, to the test's
// heading. A refusal from the server closes the dialog and shows at the test. A student of
// another lab sees none of it; the teacher sees every measurement with the released one marked.
// Axe in light, dark and Dutch, at 320 px wide and 256 px high, the read's error state with its
// retry, and the state of a finished simulation. Everything is invented (Q-PRIV-4).
import { randomBytes } from "node:crypto";
import { expect, type Page, type Route, test } from "@playwright/test";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated, pressUntilFocused } from "./fixtures";
import {
  changeTolerance,
  finishResults,
  type ResultsWorld,
  releaseElsewhere,
  seedResults,
  setPatientEhr,
} from "./results-seed";
import { appUrl } from "./run-env";

test.describe.configure({ mode: "serial" });

const SUFFIX = randomBytes(3).toString("hex").toUpperCase();
let world: ResultsWorld;

test.beforeAll(async () => {
  world = await seedResults(SUFFIX);
});

function measurements(page: Page, name: string) {
  return page.getByRole("table", { name: `Measurements of ${name}` });
}

function heading(page: Page, name: string) {
  return page.getByRole("heading", { level: 4, name: `${name} (mmol/L)` });
}

function releaseOf(page: Page, name: string, value: string) {
  return measurements(page, name)
    .getByRole("row")
    .filter({ hasText: value })
    .getByRole("button", {
      name: new RegExp(`^Release the measurement ${value.replace(".", "\\.")} `),
    });
}

function releaseDialog(page: Page, name: string) {
  return page.getByRole("alertdialog", { name: `Release the result of ${name}?` });
}

async function setLook(page: Page, theme: "light" | "dark", locale: "en" | "nl") {
  await page.context().addCookies([
    { name: "EDULIMS_THEME", value: theme, url: appUrl() },
    { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
  ]);
}

test("a student measures and releases one result with the keyboard alone (S14, S15)", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const name = world.journey.name;
  await devLogin(page, world.student.email);
  await page.goto("/student/results");
  await expect(
    page.getByRole("heading", { level: 3, name: `Request for ${world.patient}` }),
  ).toBeVisible();
  await axe(page);

  // An Afinion 2 test takes no entry by hand; a test without a tolerance links to its lab's page.
  await expect(
    page.getByRole("button", { name: `Enter measurement for ${world.afinion.name}` }),
  ).toHaveCount(0);
  await expect(
    page.getByText("No measurement yet. Measurements of this test come from the Afinion 2."),
  ).toBeVisible();
  const links = page.getByRole("link", { name: "Set a tolerance" });
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute("href", "/student/tolerances");
  }

  const measure = page.getByRole("button", { name: `Enter measurement for ${name}` });
  await expectHydrated(measure);
  await measure.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Measurement of ${name}` });
  const value = dialog.getByLabel("Measured value");
  await pressUntilFocused(page, "Tab", value);

  // Each refusal is named at its field (WCAG 3.3.1); exponent form is no number here.
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("Enter the measured value.")).toBeVisible();
  await pressUntilFocused(page, "Tab", value);
  await page.keyboard.type("1e5");
  await expect(
    dialog.getByText(
      "Enter a number with at most 9 digits before and 6 after the decimal separator.",
    ),
  ).toBeVisible();
  await axe(page);
  // Escape returns the focus to the button that opened the form.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(measure).toBeFocused();

  // Three measurements, kept side by side (S14): inside, below and above the tolerance.
  for (const typed of ["5,1", "3.5", "7.2"]) {
    await page.keyboard.press("Enter");
    await pressUntilFocused(page, "Tab", value);
    await page.keyboard.type(typed);
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(measure).toBeFocused();
  }
  await expect(page.getByText(`Measurement of ${name} saved.`).first()).toBeVisible();
  await expect(measurements(page, name).getByRole("row")).toHaveCount(4);

  // Inside: the plain statement, and Escape gives the focus back to the release button.
  const confirm = releaseDialog(page, name);
  await releaseOf(page, name, "5.1").focus();
  await page.keyboard.press("Enter");
  await expect(
    confirm.getByText("The value is inside your tolerance of 4 to 6 mmol/L."),
  ).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Release result" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(releaseOf(page, name, "5.1")).toBeFocused();

  // Below: the warning with an icon and text (S15, Q-ACC-2).
  await releaseOf(page, name, "3.5").focus();
  await page.keyboard.press("Enter");
  await expect(confirm.getByText("Outside your tolerance")).toBeVisible();
  await expect(
    confirm.getByText(
      "The value is below your tolerance of 4 to 6 mmol/L. Check it before you release it.",
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(releaseOf(page, name, "3.5")).toBeFocused();

  // Above: the team decides and releases anyway; the warning never blocks.
  await releaseOf(page, name, "7.2").focus();
  await page.keyboard.press("Enter");
  await expect(
    confirm.getByText(
      "The value is above your tolerance of 4 to 6 mmol/L. Check it before you release it.",
    ),
  ).toBeVisible();
  await axe(page);
  const anyway = confirm.getByRole("button", { name: "Release anyway" });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(anyway).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm).toHaveCount(0);
  // NOTE: #148; this run's FerroEHR does not take the write, so the release stands as pending.
  await expect(
    page.getByText(
      `The result of ${name} is released. It is not in the patient's record yet; eduLIMS keeps trying.`,
    ),
  ).toBeVisible();
  await expect(heading(page, name)).toBeFocused();
  const rows = measurements(page, name).getByRole("row");
  await expect(rows.filter({ hasText: "7.2" })).toContainText("Released");
  await expect(measurements(page, name).getByRole("button")).toHaveCount(0);
  await expect(measure).toHaveCount(0);
  await expect(page.getByText("Tolerance at the release:")).toBeVisible();
  await expect(page.getByText("Released:").first()).toBeVisible();
  await expect(page.getByText("Patient's record:")).toBeVisible();
  await expect(page.getByText("Not yet: eduLIMS keeps trying")).toBeVisible();
  await axe(page);
});

test("a refusal shows at its field, and one that ends the dialog shows at the test (S15)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const name = world.refused.name;
  await devLogin(page, world.student.email);
  await page.goto("/student/results");

  // A sample of another request: the server's refusal shows at the sample field.
  const pattern = "**/_serverFn/**";
  const other = "01960000-0000-7000-8000-00000000beef";
  const swap = (route: Route) => {
    const request = route.request();
    const body = request.postData();
    return request.method() === "POST" && body?.includes(world.sampleId)
      ? route.continue({ postData: body.replaceAll(world.sampleId, other) })
      : route.fallback();
  };
  await page.route(pattern, swap);
  const measure = page.getByRole("button", { name: `Enter measurement for ${name}` });
  await expectHydrated(measure);
  await measure.click();
  const form = page.getByRole("dialog", { name: `Measurement of ${name}` });
  await form.getByLabel("Measured value").fill("5.2");
  await form.getByRole("button", { name: "Save measurement" }).click();
  await expect(form.getByText("Choose a sample of this request.")).toBeVisible();
  await page.unroute(pattern, swap);
  await page.keyboard.press("Escape");
  await expect(measure).toBeFocused();

  // The patient's record is not created yet: the dialog stays and says so, nothing is released.
  const confirm = releaseDialog(page, name);
  await setPatientEhr(world, null);
  await releaseOf(page, name, "5").click();
  await confirm.getByRole("button", { name: "Release result" }).click();
  await expect(
    confirm.getByRole("alert").filter({
      hasText:
        "The patient's record is not created yet, so this result cannot be released. Try again in a minute.",
    }),
  ).toBeVisible();
  await axe(page);
  await setPatientEhr(world, world.ehrId);
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  // Nothing was released: the measurement can still be released.
  await expect(releaseOf(page, name, "5")).toBeVisible();

  // The tolerance changed after the dialog opened: the dialog closes, the page says why.
  await releaseOf(page, name, "5").click();
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await changeTolerance(world, world.refused.id);
  await confirm.getByRole("button", { name: "Release result" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(
    page.getByText(
      "Your team changed the tolerance of this test. Check the new tolerance and release again.",
    ),
  ).toBeVisible();
  await expect(heading(page, name)).toBeFocused();
  await expect(page.getByText("4.5 to 5.5 mmol/L")).toBeVisible();

  // A classmate released it meanwhile: the dialog closes on that too.
  await releaseOf(page, name, "5").click();
  await expect(confirm).toBeVisible();
  await releaseElsewhere(world, world.refused.id);
  await confirm.getByRole("button", { name: "Release result" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(
    page.getByText("The result of this test is already released and is final."),
  ).toBeVisible();
  await expect(heading(page, name)).toBeFocused();
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

test("the teacher sees every measurement with the released one marked, also at 320 px (D11)", async ({
  page,
}) => {
  await devLogin(page, "teacher@example.test");
  await page.goto(`/teacher/simulations/${world.simulationId}/labs/${world.labId}`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Measurements and results" }),
  ).toBeVisible();
  const rows = measurements(page, world.journey.name).getByRole("row");
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: "7.2" })).toContainText("Released");
  await expect(rows.filter({ hasText: "5.1" })).not.toContainText("Released");
  await expect(page.getByRole("main").getByRole("button", { name: /^Release/ })).toHaveCount(0);
  await expect(page.getByText("Released:").first()).toBeVisible();
  await axe(page);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  await expect(measurements(page, world.journey.name)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
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
  await expect(measurements(page, world.journey.name).getByRole("row")).toHaveCount(4);
});

test("the page and the release dialog reflow at 320 px, in light, dark and Dutch (WCAG 1.4.10)", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await devLogin(page, world.student.email);
  for (const [theme, locale] of [
    ["light", "en"],
    ["dark", "en"],
    ["light", "nl"],
    ["dark", "nl"],
  ] as const) {
    await page.setViewportSize({ width: 320, height: 800 });
    await setLook(page, theme, locale);
    await page.goto("/student/results");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const requestHeading =
      locale === "nl"
        ? dutch("records_request_for").replace("{name}", world.patient)
        : `Request for ${world.patient}`;
    await expect(page.getByRole("heading", { level: 3, name: requestHeading })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // The table scrolls in its own named region, which the keyboard reaches (WCAG 2.1.1).
    const tableName = (test: string) =>
      locale === "nl"
        ? dutch("results_measurements_of").replace("{test}", test)
        : `Measurements of ${test}`;
    const region = page.getByRole("region", { name: tableName(world.narrow.name) });
    await region.focus();
    await expect(region).toBeFocused();
    await axe(page);

    // The open release dialog, in a window 256 px high: the title and both buttons are reached.
    await page.setViewportSize({ width: 320, height: 256 });
    const button = page
      .getByRole("table", { name: tableName(world.narrow.name) })
      .getByRole("button");
    await button.focus();
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    for (const target of [
      confirm.getByRole("heading"),
      confirm.getByRole("button").first(),
      confirm.getByRole("button").last(),
    ]) {
      await target.scrollIntoViewIfNeeded();
      await expect(target).toBeInViewport();
    }
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(button).toBeFocused();
  }
});

test("a finished simulation takes no measurement and no release (D10)", async ({ page }) => {
  await finishResults(world);
  await devLogin(page, world.student.email);
  await setLook(page, "light", "en");
  await page.goto("/student/results");
  await expect(page.getByText("The simulation is not running", { exact: true })).toBeVisible();
  await expect(
    page.getByText("You cannot measure or release while the simulation is not running."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Enter measurement for / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Release the measurement / })).toHaveCount(0);
  await axe(page);
});
