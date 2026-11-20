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
import {
  seedControlRequest,
  seedForeignLab,
  seedLabRecords,
  seedSecondLab,
} from "./lab-records-seed";
import { appUrl } from "./run-env";

const LAB_NUMBER = /^\d{3} \d{3} \d{4}$/;

function suffix(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

/** Asserts that the page scrolls only vertically (WCAG 1.4.10). */
async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
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
  await axe(page);
  await birth.fill("1984-02-03");
  await patientDialog.getByRole("button", { name: "Register a patient" }).click();
  await expect(patientDialog).toHaveCount(0);
  await expect(register).toBeFocused();
  await expect(page.getByRole("rowheader", { name: "Bo Invented" })).toBeVisible();
  // The date of birth shows in the reader's notation (en-US here).
  await expect(page.getByRole("cell", { name: /1984/ }).locator("time")).toHaveAttribute(
    "datetime",
    "1984-02-03",
  );

  // Recording a request with one sample: the server gives the lab number.
  const record = page.getByRole("button", { name: "Record a request" });
  const requestDialog = page.getByRole("dialog", { name: "Record a request" });
  await record.click();
  await page.keyboard.press("Escape");
  await expect(record).toBeFocused();
  await record.click();
  await requestDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(record).toBeFocused();
  await record.click();
  await requestDialog.getByRole("combobox", { name: "Patient" }).click();
  await page.getByRole("option", { name: /Bo Invented/ }).click();
  await requestDialog.getByLabel("Requester").fill("Dr. Invented");
  await requestDialog.getByRole("checkbox", { name: new RegExp(seeded.test) }).check();
  const first = requestDialog.getByRole("group", { name: "Sample 1" });
  await first.getByLabel("Sample number").fill("E2E-001");
  await first.getByLabel("Material").fill("plasma");
  await requestDialog.getByRole("button", { name: "Record a request" }).click();
  await expect(requestDialog).toHaveCount(0);
  await expect(record).toBeFocused();
  const card = page.getByRole("article", { name: "Request for Bo Invented" });
  await expect(card).toBeVisible();
  const samples = card.getByRole("table", { name: "Samples of Request for Bo Invented" });
  const copy = samples.getByRole("button", { name: /^Copy lab number / });
  // The name spells the digits one by one (maintainer, 2026-11-20).
  const label = (await copy.getAttribute("aria-label")) ?? "";
  expect(label).toMatch(/^Copy lab number (\d ){9}\d$/);
  const digits = label.replace("Copy lab number ", "").replaceAll(" ", "");
  const grouped = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  expect(grouped).toMatch(LAB_NUMBER);
  await expect(samples.getByText(grouped, { exact: true })).toBeVisible();

  // The copy action puts the digits on the clipboard and says so in the status region.
  await copy.click();
  await expect(
    page.getByRole("status").filter({ hasText: `Lab number ${grouped} copied.` }),
  ).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(grouped.replaceAll(" ", ""));

  // Correcting the request with the keyboard: a second tube gets its own lab number.
  const correct = card.getByRole("button", { name: "Correct request: Request for Bo Invented" });
  await correct.focus();
  await page.keyboard.press("Enter");
  const correction = page.getByRole("dialog", { name: "Correct the request" });
  await correction.getByRole("button", { name: "Add a sample" }).click();
  const second = correction.getByRole("group", { name: "Sample 2" });
  await expect(second.getByLabel("Sample number")).toBeFocused();
  await page.keyboard.type("E2E-001");
  await second.getByLabel("Material").fill("plasma");
  await correction.getByRole("button", { name: "Save the correction" }).click();
  await expect(correction).toHaveCount(0);
  await expect(correct).toBeFocused();
  await expect(samples.getByRole("button", { name: /^Copy lab number / })).toHaveCount(2);

  // A control request has no patient (S16).
  await page.getByRole("button", { name: "Record a request" }).click();
  const control = page.getByRole("dialog", { name: "Record a request" });
  await control.getByRole("radio", { name: "Control sample" }).check();
  await expect(control.getByRole("combobox", { name: "Patient" })).toHaveCount(0);
  await control.getByRole("checkbox", { name: new RegExp(seeded.test) }).check();
  const qc = control.getByRole("group", { name: "Sample 1" });
  await qc.getByLabel("Sample number").fill("QC-LOW");
  await qc.getByLabel("Material").fill("control material");
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

  // At 320 px the page scrolls only vertically; the tables scroll in their own regions.
  await page.context().addCookies([
    { name: "EDULIMS_THEME", value: "light", url: appUrl() },
    { name: "EDULIMS_LOCALE", value: "en", url: appUrl() },
  ]);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Requests" })).toBeVisible();
  await expectNoPageOverflow(page);
  await axe(page);

  // The teacher reads the correction on the simulation page.
  const teacher = await signedInElsewhere(browser, "teacher@example.test");
  await teacher.goto(`/teacher/simulations/${seeded.simulationId}`);
  const log = teacher.getByRole("table", { name: "Corrections" });
  await expect(log.getByRole("cell", { name: seeded.lab })).toBeVisible();
  await expect(log.getByText(/Sample added:/)).toBeVisible();
  // The log names the request by its lab numbers (maintainer, 2026-11-20).
  await expect(
    log.getByRole("cell", { name: /^Request with lab number \d{3} \d{3} \d{4}/ }),
  ).toBeVisible();
  await axe(teacher);
  await teacher.setViewportSize({ width: 320, height: 800 });
  await teacher.reload();
  await expect(teacher.getByRole("table", { name: "Corrections" })).toBeVisible();
  await expectNoPageOverflow(teacher);
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

test("a refused clipboard says so in the status region (WCAG 4.1.3)", async ({ page }) => {
  const seeded = await seedLabRecords(suffix());
  const labNumber = await seedControlRequest(seeded);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await devLogin(page, seeded.student.email);
  await openRecords(page);
  const copy = page.getByRole("button", { name: `Copy lab number ${[...labNumber].join(" ")}` });
  await expectHydrated(copy);
  await copy.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "The lab number could not be copied. Type it from the screen." }),
  ).toBeVisible();
  await axe(page);
});

test("a student in two labs switches with ?lab=, and a foreign lab falls back to the newest (S10)", async ({
  page,
}) => {
  const id = suffix();
  const seeded = await seedLabRecords(id);
  const second = await seedSecondLab(seeded.student.id, id);
  const foreign = await seedForeignLab(id);
  await devLogin(page, seeded.student.email);
  await openRecords(page);
  const picker = page.getByRole("navigation", { name: "Your labs" });
  const newest = picker.getByRole("link", { name: `${second.lab}, in ${second.simulation}` });
  const older = picker.getByRole("link", { name: `${seeded.lab}, in ${seeded.simulation}` });
  // With no ?lab=, the newest lab shows.
  await expect(newest).toHaveAttribute("aria-current", "page");
  await expect(older).not.toHaveAttribute("aria-current", "page");
  await older.click();
  await expect(page).toHaveURL(new RegExp(`lab=${seeded.labId}`));
  await expect(older).toHaveAttribute("aria-current", "page");
  await axe(page);
  // A lab the student is not in shows the newest of their own labs, and nothing of that lab.
  await page.goto(`/student/patients?lab=${foreign}`);
  await expect(newest).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(`Foreign lab ${id}`)).toHaveCount(0);
});

test("a finished simulation reads but takes no new records (#267)", async ({ page }) => {
  const seeded = await seedLabRecords(suffix(), "finished");
  await seedControlRequest(seeded);
  await devLogin(page, seeded.student.email);
  await page.goto("/student/patients");
  await expect(
    page.getByRole("heading", { level: 1, name: "Patients and requests" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "The simulation is not running" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Register a patient" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Record a request" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Correct request:/ })).toBeDisabled();
  await expect(page.getByRole("article", { name: "Control sample" })).toBeVisible();
  await axe(page);
});
