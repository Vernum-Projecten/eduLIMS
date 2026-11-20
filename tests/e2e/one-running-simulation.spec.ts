// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One running simulation at a time (D11, owner 2026-11-20, #386): while another teacher's
// simulation runs, the overview of a prepared one says before the click that the start waits,
// with an icon and text, and names no other simulation. Axe in light, dark and Dutch. Every
// name is invented (Q-PRIV-4).
import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";
import { appUrl } from "./run-env";
import { finishRunningSimulations, seedAnotherRunning } from "./running-simulation";

const BLOCKED =
  "Another simulation is running. Only one simulation runs at a time, so this one can start once that one is finished.";

test.afterEach(async () => {
  await finishRunningSimulations();
});

test("the overview shows that another simulation runs before the start is tried (#386)", async ({
  page,
}) => {
  const world = await seedAnotherRunning(randomBytes(3).toString("hex").toUpperCase());
  await devLogin(page, "teacher@example.test");
  await page.goto(`/teacher/simulations/${world.preparedId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  const start = page.getByRole("button", { name: "Start simulation" });
  await expectHydrated(start);
  await expect(start).toBeDisabled();
  await expect(start).toHaveAccessibleDescription(BLOCKED);
  const stepOf = (title: string) =>
    page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  const step = stepOf("Start");
  await expect(step).toContainText("Blocks the start");
  await expect(step).toContainText(BLOCKED);
  await expect(page.getByText(world.running)).toHaveCount(0);
  await axe(page);

  for (const [theme, locale] of [
    ["dark", "en"],
    ["light", "nl"],
  ] as const) {
    await page.context().addCookies([
      { name: "EDULIMS_THEME", value: theme, url: appUrl() },
      { name: "EDULIMS_LOCALE", value: locale, url: appUrl() },
    ]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const nl = locale === "nl";
    const message = nl ? dutch("simulations_error_another_running") : BLOCKED;
    await expect(stepOf(nl ? dutch("simulation_step_start") : "Start")).toContainText(message);
    await axe(page);
  }
});
