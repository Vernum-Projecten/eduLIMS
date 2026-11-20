// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The teacher dashboard (D11, D13, G-01, G-03, #271, #386): the running simulation's board in
// the leaderboard order and by lab name, a cell's details on focus, a release that arrives
// without a reload and keeps focus, the empty state, the error state, and a student kept out.
// Axe in light, dark and Dutch, and reflow at 320 px. Every name and value is invented
// (Q-PRIV-4).
import { randomBytes } from "node:crypto";
import { expect, type Page, type Route, test } from "@playwright/test";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { axe, dutch } from "./admin-users-helpers";
import { type DashboardWorld, seedDashboard } from "./dashboard-seed";
import { devLogin, expectHydrated } from "./fixtures";
import { appUrl } from "./run-env";
import { finishRunningSimulations } from "./running-simulation";

const TEACHER = "teacher@example.test";

function suffix(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

function board(page: Page, world: DashboardWorld) {
  return page.getByRole("region", { name: `Board of ${world.simulation}` });
}

/** The lab names of the board's rows, top to bottom. */
async function rowOrder(page: Page, world: DashboardWorld): Promise<string[]> {
  const headers = board(page, world).getByRole("rowheader");
  return (await headers.allInnerTexts()).map((text) => text.trim());
}

async function openDashboard(page: Page): Promise<void> {
  await page.goto("/teacher/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
}

/** Releases the open cell of the first lab, as its team would (test set-up only). */
async function releaseOpenCell(world: DashboardWorld): Promise<void> {
  const url = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_DATABASE_URL is not set; playwright.config.ts sets it.");
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
  try {
    const open = await db
      .selectFrom("samples as s")
      .innerJoin("request_tests as rt", "rt.request_id", "s.request_id")
      .select(["s.id", "s.request_id", "s.lab_id", "s.simulation_id", "rt.test_id"])
      .where("s.sample_number", "=", world.samples[1])
      .executeTakeFirstOrThrow();
    const { id: measurementId } = await db
      .insertInto("measurements")
      .values({
        simulation_id: open.simulation_id,
        lab_id: open.lab_id,
        request_id: open.request_id,
        test_id: open.test_id,
        sample_id: open.id,
        value: "10.8",
        source: "manual",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const tolerance = await db
      .selectFrom("lab_tolerances")
      .select("id")
      .where("lab_id", "=", open.lab_id)
      .executeTakeFirstOrThrow();
    await db
      .updateTable("request_tests")
      .set({ released_measurement_id: measurementId, released_tolerance_id: tolerance.id })
      .where("request_id", "=", open.request_id)
      .execute();
  } finally {
    await db.destroy();
  }
}

test.afterEach(async () => {
  await finishRunningSimulations();
});

test("a teacher follows the running simulation on one board, by the keyboard (D11, G-01, G-03)", async ({
  page,
}) => {
  const world = await seedDashboard(suffix());
  await devLogin(page, TEACHER);
  await openDashboard(page);
  await expect(page.getByText(`${world.simulation}, running since`)).toBeVisible();
  await expect(page.getByText(/^Last updated /)).toBeVisible();

  // The leaderboard order: most green first; the position is a header-labelled column.
  expect(await rowOrder(page, world)).toEqual([world.first, world.second]);
  const region = board(page, world);
  await expect(region.getByRole("columnheader", { name: "Median turnaround" })).toBeVisible();

  // Each cell is named "lab, sample, test: value, status", with an icon and text beside it.
  const green = region.getByRole("button", {
    name: `${world.first}, ${world.samples[0]}, ${world.test}: 10.4 mmol/L, Green`,
  });
  const red = region.getByRole("button", {
    name: `${world.second}, ${world.samples[0]}, ${world.test}: 12 mmol/L, Red`,
  });
  const open = region.getByRole("button", {
    name: new RegExp(`^${world.first}, ${world.samples[1]}, ${world.test}: Open, `),
  });
  await expect(green).toBeVisible();
  await expect(red).toBeVisible();
  await expect(open).toBeVisible();
  await expect(
    region.getByRole("button", {
      name: `${world.second}, ${world.samples[1]}, ${world.test}: not requested`,
    }),
  ).toBeVisible();

  // The keyboard reaches the region, then the cells; focus shows the cell's details.
  await expectHydrated(green);
  await region.focus();
  await expect(region).toBeFocused();
  await green.focus();
  await expect(page.getByRole("tooltip")).toContainText("Correct value");
  await expect(page.getByRole("tooltip")).toContainText("10 mmol/L");
  await page.keyboard.press("Tab");
  await expect(open).toBeFocused();
  await releaseOpenCell(world);
  const releasedName = `${world.first}, ${world.samples[1]}, ${world.test}: 10.8 mmol/L, Yellow`;
  await expect(region.getByRole("button", { name: releasedName })).toBeFocused({
    timeout: 25_000,
  });
  await expect(page.getByRole("status").filter({ hasText: "Results released since" })).toHaveText(
    "Results released since the last update: 1.",
  );
});

test("the board reflows at 320 px and passes axe in light, dark and Dutch (WCAG 1.4.10)", async ({
  page,
}) => {
  const world = await seedDashboard(suffix());
  await devLogin(page, TEACHER);
  await page.setViewportSize({ width: 320, height: 720 });
  await openDashboard(page);
  await expect(board(page, world)).toBeVisible();
  const scrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(scrolls).toBe(false);
  await axe(page);
  for (const [theme, locale] of [
    ["dark", "en"],
    ["light", "nl"],
    ["dark", "nl"],
  ] as const) {
    await page.context().addCookies([
      { name: "EDULIMS_THEME", value: theme, url: appUrl() },
      { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
    ]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const name = locale === "nl" ? dutch("nav_dashboard") : "Dashboard";
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await axe(page);
  }
});

test("with no simulation running the dashboard says so and links to the simulations (#386)", async ({
  page,
}) => {
  await finishRunningSimulations();
  await devLogin(page, TEACHER);
  await openDashboard(page);
  await expect(
    page.getByRole("heading", { level: 2, name: "No simulation is running" }),
  ).toBeVisible();
  await axe(page);
  await page.getByRole("link", { name: "Open your simulations" }).click();
  await expect(page).toHaveURL(/\/teacher\/simulations$/);
});

test("the dashboard shows its error state and the retry recovers", async ({ page }) => {
  const world = await seedDashboard(suffix());
  await devLogin(page, TEACHER);
  await expect(page).toHaveURL(/\/teacher$/);
  const pattern = "**/_serverFn/**";
  const handler = async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = await response.text();
    return body.includes(world.simulation)
      ? route.fulfill({ status: 500, body: "forced failure" })
      : route.fulfill({ response, body });
  };
  await page.route(pattern, handler);
  const link = page.getByRole("link", { name: "Dashboard" }).first();
  await expectHydrated(link);
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
  await page.unroute(pattern, handler);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(board(page, world)).toBeVisible();
});

test("a student does not reach the dashboard (D11, Q-SIM-1)", async ({ page }) => {
  const world = await seedDashboard(suffix());
  await devLogin(page, "student@example.test");
  await page.goto("/teacher/dashboard");
  await expect(page.getByText(world.simulation)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toHaveCount(0);
});
