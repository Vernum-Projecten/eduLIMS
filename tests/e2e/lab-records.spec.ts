// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A team's records from the paper form (S11, S12, S16, #268): a student registers a patient,
// records a request with a sample, sees and copies its lab number (announced, WCAG 4.1.3),
// corrects the request with a second tube, and records a control request; the teacher reads the
// correction. Axe in light, dark and Dutch. Every patient, test and value is invented (Q-PRIV-4).
import { randomBytes } from "node:crypto";
import { expect, type Page, type Route, test } from "@playwright/test";
import { axe, dutch, signedInElsewhere } from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";
import { seedLabRecords } from "./lab-records-seed";
import { appUrl } from "./run-env";

const LAB_NUMBER = /^\d{3} \d{3} \d{4}$/;

function suffix(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

async function openRecords(page: Page): Promise<void> {
  await page.goto("/student/patients");
  await expect(
    page.getByRole("heading", { level: 1, name: "Patients and requests" }),
  ).toBeVisible();
  await expectHydrated(page.getByRole("button", { name: "Register a patient" }));
}

test("a team registers a patient, records and corrects a request, and copies a lab number (S11, S12, S16)", async ({
  page,
  browser,
  context,
}) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const seeded = await seedLabRecords(suffix());
  await devLogin(page, seeded.student.email);
  await openRecords(page);
  await expect(page.getByText(`${seeded.lab}, in ${seeded.simulation}`)).toBeVisible();
  await expect(page.getByText("No patients yet", { exact: true })).toBeVisible();
  await axe(page);

  // Registering: a missing field and a date that is no date are named at their fields.
  await page.getByRole("button", { name: "Register a patient" }).click();
  const patientDialog = page.getByRole("dialog", { name: "Register a patient" });
  await patientDialog.getByLabel("Date of birth").fill("1984-02-30");
  await patientDialog.getByRole("button", { name: "Register a patient" }).click();
  await expect(
    patientDialog.getByText("Enter the patient's name as it stands on the form."),
  ).toBeVisible();
  await expect(
    patientDialog.getByText("Enter the date of birth as a date, for example 1984-03-21."),
  ).toBeVisible();
  await axe(page);
  await patientDialog.getByLabel("Name").fill("Bo Invented");
  await patientDialog.getByLabel("Date of birth").fill("1984-02-03");
  await patientDialog.getByRole("radio", { name: "Male", exact: true }).check();
  await patientDialog.getByLabel("Patient ID").fill("PID-E2E-1");
  await patientDialog.getByRole("button", { name: "Register a patient" }).click();
  await expect(patientDialog).toHaveCount(0);
  await expect(page.getByRole("rowheader", { name: "Bo Invented" })).toBeVisible();

  // Recording a request with one sample: the server gives the lab number.
  await page.getByRole("button", { name: "Record a request" }).click();
  const requestDialog = page.getByRole("dialog", { name: "Record a request" });
  await requestDialog.getByRole("combobox", { name: "Patient" }).click();
  await page.getByRole("option", { name: /Bo Invented/ }).click();
  await requestDialog.getByLabel("Requester").fill("Dr. Invented");
  await requestDialog.getByRole("checkbox", { name: new RegExp(seeded.test) }).check();
  await requestDialog.getByLabel("Sample number").fill("E2E-001");
  await requestDialog.getByLabel("Material").fill("plasma");
  await requestDialog.getByRole("button", { name: "Record a request" }).click();
  await expect(requestDialog).toHaveCount(0);
  const card = page.getByRole("article", { name: "Request for Bo Invented" });
  await expect(card).toBeVisible();
  const samples = card.getByRole("table", { name: "Samples of Request for Bo Invented" });
  const copy = samples.getByRole("button", { name: /^Copy lab number / });
  const label = (await copy.getAttribute("aria-label")) ?? "";
  const grouped = label.replace("Copy lab number ", "");
  expect(grouped).toMatch(LAB_NUMBER);

  // The copy action puts the digits on the clipboard and says so in the status region.
  await copy.click();
  await expect(
    page.getByRole("status").filter({ hasText: `Lab number ${grouped} copied.` }),
  ).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(grouped.replaceAll(" ", ""));

  // Correcting the request with the keyboard: a second tube gets its own lab number.
  await card.getByRole("button", { name: "Correct request: Request for Bo Invented" }).focus();
  await page.keyboard.press("Enter");
  const correction = page.getByRole("dialog", { name: "Correct the request" });
  await correction.getByRole("button", { name: "Add a sample" }).click();
  await expect(correction.getByLabel("Sample number").nth(1)).toBeFocused();
  await page.keyboard.type("E2E-001");
  await correction.getByLabel("Material").nth(1).fill("plasma");
  await correction.getByRole("button", { name: "Save the correction" }).click();
  await expect(correction).toHaveCount(0);
  await expect(samples.getByRole("button", { name: /^Copy lab number / })).toHaveCount(2);

  // A control request has no patient (S16).
  await page.getByRole("button", { name: "Record a request" }).click();
  const control = page.getByRole("dialog", { name: "Record a request" });
  await control.getByRole("radio", { name: "Control sample" }).check();
  await expect(control.getByRole("combobox", { name: "Patient" })).toHaveCount(0);
  await control.getByRole("checkbox", { name: new RegExp(seeded.test) }).check();
  await control.getByLabel("Sample number").fill("QC-LOW");
  await control.getByLabel("Material").fill("control material");
  await control.getByRole("button", { name: "Record a request" }).click();
  await expect(control).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Control sample" })).toBeVisible();

  // Axe on the filled page in dark and in Dutch.
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
    const heading = locale === "nl" ? dutch("records_requests_heading") : "Requests";
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    await axe(page);
  }

  // The teacher reads the correction on the simulation page.
  const teacher = await signedInElsewhere(browser, "teacher@example.test");
  await teacher.goto(`/teacher/simulations/${seeded.simulationId}`);
  const log = teacher.getByRole("table", { name: "Corrections" });
  await expect(log.getByRole("cell", { name: seeded.lab })).toBeVisible();
  await expect(log.getByText(/Sample added:/)).toBeVisible();
  await axe(teacher);
  await teacher.context().close();
});

test("the records page shows an error state and its retry loads it again (#268)", async ({
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
  const link = nav.getByRole("link", { name: "Patients and requests" });
  await expectHydrated(link);
  await link.click();
  const heading = page.getByRole("heading", { level: 1, name: "Something went wrong" });
  await expect(heading).toBeVisible();
  await axe(page);
  await page.unroute(pattern, fail);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "Patients" })).toBeVisible();
});
