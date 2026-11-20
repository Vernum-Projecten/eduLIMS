// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A team's own tolerances (S13, #269): a student sets a test's lower and upper limit with the
// keyboard alone, sees each refusal at its field, and changes it; a student of another lab sees
// none of it and cannot open the lab; the teacher sees both rows, the one in force marked with an
// icon and text; a finished simulation takes no change. Axe in light, dark and Dutch, and the
// read's error state with its retry. Every lab, test and limit is invented (Q-PRIV-4).
import { randomBytes } from "node:crypto";
import { expect, type Page, type Route, test } from "@playwright/test";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated, pressUntilFocused } from "./fixtures";
import { ALL_LOOKS, inEachLook } from "./looks";
import { finishTolerances, seedTolerances, type ToleranceWorld } from "./tolerances-seed";

test.describe.configure({ mode: "serial" });

const SUFFIX = randomBytes(3).toString("hex").toUpperCase();
let world: ToleranceWorld;

test.beforeAll(async () => {
  world = await seedTolerances(SUFFIX);
});

function tolerances(page: Page, lab: string) {
  return page.getByRole("table", { name: `Tolerances of ${lab}, per test` });
}

function testRow(page: Page) {
  return tolerances(page, world.lab).getByRole("row").filter({ hasText: world.testName });
}

test("a student sets and changes the lab's own tolerance with the keyboard (S13)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await devLogin(page, world.student.email);
  await page.goto("/student/tolerances");
  await expect(page.getByRole("heading", { level: 1, name: "Tolerances" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: `Tolerances of ${world.lab}` }),
  ).toBeVisible();
  await expect(testRow(page)).toContainText("No tolerance yet");
  await axe(page);

  // Open the form from the keyboard; it starts empty: no default, no hint (W7).
  const edit = testRow(page).getByRole("button", {
    name: `Set the tolerance of ${world.testName}`,
  });
  await expectHydrated(edit);
  await edit.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Tolerance of ${world.testName}` });
  const lower = dialog.getByLabel("Lower limit");
  const upper = dialog.getByLabel("Upper limit");
  await expect(lower).toHaveValue("");
  await expect(upper).toHaveValue("");

  // Each refusal is named at its field (WCAG 3.3.1).
  await dialog.getByRole("button", { name: "Save tolerance" }).click();
  await expect(dialog.getByText("Enter the lower limit.")).toBeVisible();
  await expect(dialog.getByText("Enter the upper limit.")).toBeVisible();
  await lower.fill("six");
  await upper.fill("5");
  await expect(
    dialog.getByText("Enter a number with at most 9 digits before and 6 after the decimal point."),
  ).toBeVisible();
  await lower.fill("6");
  await expect(dialog.getByText("The lower limit cannot be above the upper limit.")).toBeVisible();
  await axe(page);

  // Type both limits and save with Enter; a decimal comma reads as the separator.
  await pressUntilFocused(page, "Shift+Tab", lower);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("4,2");
  await page.keyboard.press("Tab");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("6.35");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`Tolerance of ${world.testName} saved.`)).toBeVisible();
  await expect(edit).toBeFocused();
  await expect(testRow(page)).toContainText("4.2");
  await expect(testRow(page)).toContainText("6.35");

  // A change is a new tolerance; the form opens with the lab's own current limits.
  await edit.click();
  await expect(lower).toHaveValue("4.2");
  await lower.fill("4.5");
  await dialog.getByRole("button", { name: "Save tolerance" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(testRow(page)).toContainText("4.5");
});

test("a student of another lab sees none of it and cannot open the lab (S13, S10)", async ({
  page,
}) => {
  await devLogin(page, world.otherStudent.email);
  await page.goto("/student/tolerances");
  const own = tolerances(page, world.otherLab).getByRole("row").filter({
    hasText: world.testName,
  });
  await expect(own).toContainText("No tolerance yet");
  await expect(page.getByText(world.lab)).toHaveCount(0);

  // NOTE: #379; a lab id in the URL changes nothing, the server picks the student's own lab.
  await page.goto(`/student/tolerances?lab=${world.labId}`);
  await expect(own).toContainText("No tolerance yet");
  await expect(page.getByText(world.lab)).toHaveCount(0);
  await expect(page.getByText("4.5")).toHaveCount(0);
  await axe(page);
});

test("the teacher sees the lab's tolerances and their changes (S13)", async ({ page }) => {
  await devLogin(page, "teacher@example.test");
  await page.goto(`/teacher/simulations/${world.simulationId}/labs/${world.labId}`);
  const current = page.getByRole("table", {
    name: `Tolerances of ${world.lab} in force, per test`,
  });
  await expect(current.getByRole("row")).toHaveCount(2);
  await expect(current.getByRole("row").nth(1)).toContainText("4.5");
  const table = page.getByRole("table", {
    name: `Changes to the tolerances of ${world.lab}, newest first, page 1 of 1`,
  });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByRole("row").nth(1)).toContainText("4.5");
  await expect(table.getByRole("row").nth(1)).toContainText("In force");
  await expect(table.getByRole("row").nth(2)).toContainText("4.2");
  await expect(table.getByRole("row").nth(2)).toContainText("Replaced");
  await axe(page);

  await page.goto(`/teacher/simulations/${world.simulationId}/labs/${world.otherLabId}`);
  await expect(page.getByText("This lab has not set a tolerance yet.").first()).toBeVisible();
});

test("the tolerance page shows its error state and the retry recovers", async ({ page }) => {
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
  const link = page.getByRole("link", { name: "Tolerances" }).first();
  await expectHydrated(link);
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
  await page.unroute(pattern, handler);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(testRow(page)).toContainText("4.5");
});

test("a finished simulation takes no change, in light, dark and Dutch (S13)", async ({ page }) => {
  await finishTolerances(world.simulationId);
  await devLogin(page, world.student.email);
  await page.goto("/student/tolerances");
  await expect(
    page.getByText(
      `${world.simulation} is not running. Your lab can set its tolerances only while it runs.`,
    ),
  ).toBeVisible();
  await expect(testRow(page)).toContainText("4.5");
  await expect(
    page.getByRole("button", { name: `Set the tolerance of ${world.testName}` }),
  ).toHaveCount(0);
  await inEachLook(page, ALL_LOOKS, async (locale) => {
    const heading =
      locale === "nl"
        ? dutch("tolerances_heading").replace("{lab}", world.lab)
        : `Tolerances of ${world.lab}`;
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  });
});
