// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The code panel of a lab in a finished simulation (coordinator on #399): no action to turn a
// code on or make a new one, and one sentence that says why. Axe in English and Dutch.
import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { axe, dutch } from "./admin-users-helpers";
import { devLogin } from "./fixtures";
import { seedLabRecords } from "./lab-records-seed";
import { appUrl } from "./run-env";

const SENTENCE =
  "This simulation is finished, so its labs get no code: a finished simulation takes no new students.";

test("a lab of a finished simulation offers no code, and says why (S10, #399)", async ({
  page,
  context,
}) => {
  const seeded = await seedLabRecords(randomBytes(4).toString("hex"), "finished");
  const url = `/teacher/simulations/${seeded.simulationId}/labs/${seeded.labId}`;
  await devLogin(page, "teacher@example.test");
  await page.goto(url);
  const panel = page.getByRole("region", { name: "Lab code", exact: true });
  await expect(panel.getByText(SENTENCE, { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Turn on lab code" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "New code" })).toHaveCount(0);
  await axe(page);

  await context.addCookies([{ name: "EDULIMS_LOCALE", value: "nl", url: appUrl() }]);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(page.getByText(dutch("labs_code_finished"), { exact: true })).toBeVisible();
  await axe(page);
});
