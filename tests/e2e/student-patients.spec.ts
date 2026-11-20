// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The student's patients page (S11, #268, #380): a team registers and corrects a patient, the
// refusals show at their fields, every dialog gives the focus back to its opener, and a patient
// links to its requests and back. Axe in light, dark and Dutch, and reflow at 320 px. Every
// patient is invented (Q-PRIV-4).
import { expect, type Route, test } from "@playwright/test";
import { axe } from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";
import { axeInEveryLook, openPatients, suffix } from "./lab-records-helpers";
import {
  seedControlRequest,
  seedForeignLab,
  seedLabRecords,
  seedSecondLab,
} from "./lab-records-seed";

test("a team registers and corrects a patient, and opens its requests (S11, #380)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedLabRecords(suffix());
  await devLogin(page, seeded.student.email);
  await openPatients(page);
  await expect(page.getByText(`${seeded.lab}, in ${seeded.simulation}`)).toBeVisible();
  await expect(page.getByText("No patients yet", { exact: true })).toBeVisible();
  await axe(page);

  // The dialog gives the focus back to the button that opened it (WCAG 2.4.3).
  const register = page.getByRole("button", { name: "Register a patient" });
  const patientDialog = page.getByRole("dialog", { name: "Register a patient" });
  await register.click();
  await page.keyboard.press("Escape");
  await expect(patientDialog).toHaveCount(0);
  await expect(register).toBeFocused();
  await register.click();
  await patientDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(register).toBeFocused();

  // Registering: the missing fields are named at their fields, and focus goes to the first.
  await register.click();
  await patientDialog.getByRole("button", { name: "Register a patient" }).click();
  await expect(
    patientDialog.getByText("Enter the patient's name as it stands on the form."),
  ).toBeVisible();
  await expect(patientDialog.getByLabel("Name")).toBeFocused();
  await expect(
    patientDialog.getByText("Enter the full date of birth: day, month and year."),
  ).toBeVisible();
  await axe(page);
  await patientDialog.getByLabel("Name").fill("Bo Invented");

  // The date of birth is the browser's date input, typed with the keyboard; a date after today
  // is refused by the server at its field (maintainer, 2026-11-20).
  const birth = patientDialog.getByLabel("Date of birth");
  await expect(birth).toHaveAttribute("type", "date");
  await patientDialog.getByLabel("Name").press("Tab");
  await expect(birth).toBeFocused();
  // Day and month alike, so the order of the segments in the browser's locale does not matter.
  await page.keyboard.type("11112099");
  await expect(birth).toHaveValue("2099-11-11");
  await patientDialog.getByRole("radio", { name: "Male", exact: true }).check();
  await patientDialog.getByLabel("Patient ID").fill("PID-E2E-1");
  await patientDialog.getByRole("button", { name: "Register a patient" }).click();
  await expect(
    patientDialog.getByText("The date of birth lies after today. Check it against the form."),
  ).toBeVisible();
  await expect(birth).toHaveAttribute("aria-invalid", "true");
  await axe(page);
  await birth.fill("1984-02-03");
  await patientDialog.getByRole("button", { name: "Register a patient" }).click();
  await expect(patientDialog).toHaveCount(0);
  await expect(register).toBeFocused();
  const patients = page.getByRole("table", { name: `Patients of ${seeded.lab}` });
  const row = patients.getByRole("row").filter({ hasText: "Bo Invented" });
  await expect(row).toBeVisible();
  // The date of birth shows in the reader's notation (en-US here).
  await expect(row.getByRole("cell", { name: /1984/ }).locator("time")).toHaveAttribute(
    "datetime",
    "1984-02-03",
  );
  // The state is an icon and text (WCAG 1.4.1).
  await expect(row.getByText("Can be corrected")).toBeVisible();

  // Correcting from the row's menu with the keyboard; the dialog closes back to the menu button.
  const actions = row.getByRole("button", { name: "Actions for Bo Invented" });
  await actions.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Correct" }).press("Enter");
  const correction = page.getByRole("dialog", { name: "Correct the patient" });
  await expect(correction.getByLabel("Name")).toHaveValue("Bo Invented");
  await page.keyboard.press("Escape");
  await expect(correction).toHaveCount(0);
  await expect(actions).toBeFocused();
  await actions.click();
  await page.getByRole("menuitem", { name: "Correct" }).click();
  await correction.getByLabel("Patient ID").fill("PID-E2E-2");
  await correction.getByRole("button", { name: "Save the correction" }).click();
  await expect(correction).toHaveCount(0);
  await expect(actions).toBeFocused();
  await expect(row.getByRole("cell", { name: "PID-E2E-2" })).toBeVisible();

  // The patient links to its requests, and the filtered list links back to every patient.
  await row.getByRole("link", { name: "0 requests" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
  await expect(page.getByText("Showing the requests of Bo Invented.")).toBeVisible();
  await expect(page.getByText("No requests for this patient yet")).toBeVisible();
  await axe(page);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Patients" })).toBeVisible();

  await axeInEveryLook(page, "Patients", "nav_patients");
});

test("the patients page shows an error state and its retry loads it again (#268, #380)", async ({
  page,
}) => {
  const seeded = await seedLabRecords(suffix());
  await devLogin(page, seeded.student.email);
  const pattern = "**/_serverFn/**";
  const fail = (route: Route) => {
    const request = route.request();
    return request.method() === "GET" && decodeURIComponent(request.url()).includes(seeded.labId)
      ? route.fulfill({ status: 500, body: "forced failure" })
      : route.fallback();
  };
  await page.route(pattern, fail);
  const nav = page.getByRole("navigation", { name: "Main menu" });
  const link = nav.getByRole("link", { name: "Patients", exact: true });
  await expectHydrated(link);
  await link.click();
  const heading = page.getByRole("heading", { level: 1, name: "Something went wrong" });
  await expect(heading).toBeVisible();
  await axe(page);
  await page.unroute(pattern, fail);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Patients" })).toBeVisible();
});

test("a student sees the lab of their running simulation, with no picker and no lab in the URL (S10, #379)", async ({
  page,
}) => {
  const id = suffix();
  // One simulation at a time: the first one is finished before the student joins the second.
  const seeded = await seedLabRecords(id, "finished");
  const second = await seedSecondLab(seeded.student.id, id);
  const foreign = await seedForeignLab(id);
  await devLogin(page, seeded.student.email);
  for (const path of ["/student/patients", "/student/requests"]) {
    await page.goto(path);
    const current = page.getByText(`${second.lab}, in ${second.simulation}`, { exact: true });
    await expect(current).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Your labs" })).toHaveCount(0);
    await expect(page.getByText(`${seeded.lab}, in ${seeded.simulation}`)).toHaveCount(0);
    await axe(page);
    // A lab id in the URL changes nothing: the server picks the lab.
    for (const lab of [seeded.labId, foreign]) {
      await page.goto(`${path}?lab=${lab}`);
      await expect(current).toBeVisible();
      await expect(page.getByText(`Foreign lab ${id}`)).toHaveCount(0);
    }
  }
});

test("a finished simulation reads but takes no new patients (#267, #380)", async ({ page }) => {
  const seeded = await seedLabRecords(suffix(), "finished");
  await seedControlRequest(seeded);
  await devLogin(page, seeded.student.email);
  await page.goto("/student/patients");
  await expect(page.getByRole("heading", { level: 1, name: "Patients" })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "The simulation is not running" }),
  ).toBeVisible();
  // The button stays in the tab order with aria-disabled, and a click opens nothing.
  const register = page.getByRole("button", { name: "Register a patient" });
  await expectHydrated(register);
  await expect(register).toHaveAttribute("aria-disabled", "true");
  await register.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await axe(page);
});
