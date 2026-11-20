// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The student's requests page (S12, S16, #268, #380, #398): a team records a request with a
// sample and a test not offered, sees and copies its lab number (announced, WCAG 4.1.3), reads it
// in the details sheet, corrects it with a second tube, and records a control request; the
// teacher reads the correction and the tests not offered. Axe in light, dark and Dutch, reflow at
// 320 px. Every patient, test and value is invented (Q-PRIV-4).
import { expect, test } from "@playwright/test";
import { axe, signedInElsewhere } from "./admin-users-helpers";
import { devLogin, expectHydrated } from "./fixtures";
import {
  axeInEveryLook,
  expectErrorStateRetries,
  expectNoPageOverflow,
  expectReadOnly,
  openRequests,
  suffix,
} from "./lab-records-helpers";
import { seedControlRequest, seedLabRecords, seedPatient } from "./lab-records-seed";

const LAB_NUMBER = /^\d{3} \d{3} \d{4}$/;

test("a team records, reads and corrects a request, and copies a lab number (S12, S16, #398)", async ({
  page,
  browser,
  context,
}) => {
  test.setTimeout(150_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const seeded = await seedLabRecords(suffix());
  await seedPatient(seeded, "Bo Invented");
  await devLogin(page, seeded.student.email);
  await openRequests(page);
  await expect(page.getByText(`${seeded.lab}, in ${seeded.simulation}`)).toBeVisible();
  await expect(page.getByText("No requests yet", { exact: true })).toBeVisible();
  await axe(page);

  // The dialog gives the focus back to the button that opened it (WCAG 2.4.3).
  const record = page.getByRole("button", { name: "Record a request" });
  const requestDialog = page.getByRole("dialog", { name: "Record a request" });
  await record.click();
  await page.keyboard.press("Escape");
  await expect(record).toBeFocused();
  await record.click();
  await requestDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(record).toBeFocused();

  // Recording a request with one sample and a test the lab does not offer (#398).
  await record.click();
  await requestDialog.getByRole("combobox", { name: "Patient" }).click();
  await page.getByRole("option", { name: /Bo Invented/ }).click();
  await requestDialog.getByLabel("Requester").fill("Dr. Invented");
  await requestDialog.getByRole("checkbox", { name: new RegExp(seeded.test) }).check();
  await requestDialog.getByRole("button", { name: "Add a test not offered" }).click();
  const notOffered = requestDialog.getByRole("group", { name: "Test not offered 1" });
  // The new row takes the focus, and the change is announced (WCAG 2.4.3, 4.1.3).
  await expect(notOffered.getByLabel("Test as on the form")).toBeFocused();
  await expect(
    requestDialog.getByRole("status").filter({ hasText: "Test not offered 1 added." }),
  ).toHaveCount(1);
  // A second row moves up and is removed again: each change is announced, and the focus stays
  // on the moved row's control, then goes to the remaining row (WCAG 2.4.3, 4.1.3).
  await requestDialog.getByRole("button", { name: "Add a test not offered" }).click();
  await page.keyboard.type("Invented test X");
  await requestDialog.getByRole("button", { name: "Move Test not offered 2 up" }).click();
  await expect(
    requestDialog
      .getByRole("status")
      .filter({ hasText: "Test not offered 2 moved to position 1 of 2." }),
  ).toHaveCount(1);
  await expect(
    requestDialog.getByRole("button", { name: "Move Test not offered 1 down" }),
  ).toBeFocused();
  await expect(notOffered.getByLabel("Test as on the form")).toHaveValue("Invented test X");
  await requestDialog.getByRole("button", { name: "Remove Test not offered 1" }).click();
  await expect(
    requestDialog.getByRole("status").filter({ hasText: "Test not offered 1 removed." }),
  ).toHaveCount(1);
  await expect(notOffered.getByLabel("Test as on the form")).toBeFocused();
  await expect(notOffered.getByLabel("Test as on the form")).toHaveValue("");
  // An empty entry is refused at its field.
  const first = requestDialog.getByRole("group", { name: "Sample 1" });
  await first.getByLabel("Sample number").fill("E2E-001");
  await first.getByLabel("Material").fill("plasma");
  await requestDialog.getByRole("button", { name: "Record a request" }).click();
  await expect(
    notOffered.getByText("Enter the test as it stands on the form, or remove this row."),
  ).toBeVisible();
  await expect(notOffered.getByLabel("Test as on the form")).toBeFocused();
  await axe(page);
  await page.keyboard.type("Invented test Q");
  await notOffered.getByLabel("Remark (optional)").fill("second page");
  await requestDialog.getByRole("button", { name: "Record a request" }).click();
  await expect(requestDialog).toHaveCount(0);
  await expect(record).toBeFocused();

  const list = page.getByRole("table", { name: `Requests of ${seeded.lab}` });
  const row = list.getByRole("row").filter({ hasText: "Request for Bo Invented" });
  await expect(row).toBeVisible();
  await expect(row.getByText("1 test not offered")).toBeVisible();
  // Only the exception has a badge: no result is released yet.
  await expect(row.getByText("Result released")).toHaveCount(0);
  const copy = row.getByRole("button", { name: /^Copy lab number / });
  // The name spells the digits one by one (maintainer, 2026-11-20).
  const label = (await copy.getAttribute("aria-label")) ?? "";
  expect(label).toMatch(/^Copy lab number (\d ){9}\d$/);
  const digits = label.replace("Copy lab number ", "").replaceAll(" ", "");
  const grouped = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  expect(grouped).toMatch(LAB_NUMBER);
  await expect(row.getByText(grouped, { exact: true })).toBeVisible();

  // The copy action puts the digits on the clipboard and says so in the status region.
  await copy.click();
  await expect(
    page.getByRole("status").filter({ hasText: `Lab number ${grouped} copied.` }),
  ).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(grouped.replaceAll(" ", ""));

  // The details sheet holds everything the team typed, and gives the focus back to its opener.
  const open = row.getByRole("button", { name: "Request for Bo Invented", exact: true });
  await open.click();
  const sheet = page.getByRole("dialog", { name: "Request for Bo Invented" });
  await expect(sheet.getByText("Invented test Q (second page)")).toBeVisible();
  await expect(sheet.getByText("Dr. Invented")).toBeVisible();
  const samples = sheet.getByRole("table", { name: "Samples of Request for Bo Invented" });
  await expect(samples.getByText(grouped, { exact: true })).toBeVisible();
  // The sheet shows no empty field: no phone-through and no remarks were given.
  await expect(sheet.getByText("Phone the result through")).toHaveCount(0);
  await expect(sheet.getByText("Remarks")).toHaveCount(0);
  await axe(page);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(open).toBeFocused();

  // Correcting the request with the keyboard from the row's menu: a second tube gets its own
  // lab number, and the test not offered is changed.
  // The menu's name adds the time of entry, so two requests for one patient differ.
  const actions = row.getByRole("button", {
    name: /^Actions for Request for Bo Invented, entered /,
  });
  await actions.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Correct" }).press("Enter");
  const correction = page.getByRole("dialog", { name: "Correct the request" });
  // A correction never removes a requested test (maintainer on #268): it stays ticked and fixed.
  const requested = correction.getByRole("checkbox", { name: new RegExp(seeded.test) });
  await expect(requested).toBeChecked();
  await expect(requested).toBeDisabled();
  await expect(correction.getByText("On the request; a correction keeps it.")).toBeVisible();
  await expect(
    correction.getByText("A correction can add a test, never remove one.", { exact: false }),
  ).toBeVisible();
  await expect(
    correction.getByRole("group", { name: "Test not offered 1" }).getByLabel("Test as on the form"),
  ).toHaveValue("Invented test Q");
  await axe(page);
  await correction.getByRole("button", { name: "Add a sample" }).click();
  const second = correction.getByRole("group", { name: "Sample 2" });
  await expect(second.getByLabel("Sample number")).toBeFocused();
  await page.keyboard.type("E2E-001");
  await second.getByLabel("Material").fill("plasma");
  await correction
    .getByRole("group", { name: "Test not offered 1" })
    .getByLabel("Test as on the form")
    .fill("Invented test R");
  await correction.getByRole("button", { name: "Save the correction" }).click();
  await expect(correction).toHaveCount(0);
  await expect(actions).toBeFocused();
  await expect(row.getByRole("button", { name: /^Copy lab number / })).toHaveCount(2);

  // A second correction, from the sheet's footer, starts from the first one as saved, and the
  // dialog gives the focus back to the sheet's opener.
  await open.click();
  await sheet.getByRole("button", { name: "Correct" }).click();
  await expect(
    correction.getByRole("group", { name: "Sample 2" }).getByLabel("Sample number"),
  ).toHaveValue("E2E-001");
  await expect(
    correction.getByRole("group", { name: "Test not offered 1" }).getByLabel("Test as on the form"),
  ).toHaveValue("Invented test R");
  await page.keyboard.press("Escape");
  await expect(correction).toHaveCount(0);
  await expect(open).toBeFocused();

  // A request links to its patient (#380).
  await actions.click();
  await page.getByRole("menuitem", { name: "Open the patient" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Patients" })).toBeVisible();
  await expect(page.getByText("Showing patient Bo Invented.")).toBeVisible();
  await expect(page.getByRole("link", { name: "1 request" })).toBeVisible();
  await page.getByRole("link", { name: "1 request" }).click();
  await expect(page.getByText("Showing the requests of Bo Invented.")).toBeVisible();
  // A new request from the filtered list starts with that patient.
  await page.getByRole("button", { name: "Record a request" }).click();
  await expect(requestDialog.getByRole("combobox", { name: "Patient" })).toContainText(
    "Bo Invented",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Show all requests" }).click();

  // A control request has no patient (S16).
  await openRequests(page);
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
  await expect(list.getByRole("button", { name: "Control sample", exact: true })).toBeVisible();

  await axeInEveryLook(page, "Requests", "nav_requests");
  // At 320 px the details sheet fits the width too (WCAG 1.4.10).
  await list
    .getByRole("row")
    .filter({ hasText: "Request for Bo Invented" })
    .getByRole("button", { name: "Request for Bo Invented", exact: true })
    .click();
  await expect(
    sheet.getByRole("table", { name: "Samples of Request for Bo Invented" }),
  ).toBeVisible();
  await expectNoPageOverflow(page);
  await axe(page);
  await page.keyboard.press("Escape");

  // The teacher reads the correction on the simulation's Corrections page (#381) and the tests
  // not offered on the lab's page (D11, #398).
  const teacher = await signedInElsewhere(browser, "teacher@example.test");
  await teacher.goto(`/teacher/simulations/${seeded.simulationId}/corrections`);
  const log = teacher.getByRole("table", { name: "Corrections" });
  await expect(log.getByRole("cell", { name: seeded.lab })).toBeVisible();
  await expect(log.getByText(/Sample added:/)).toBeVisible();
  await expect(
    log.getByText(
      "Tests not offered: Invented test Q (second page) → Invented test R (second page)",
    ),
  ).toBeVisible();
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
  await teacher.goto(`/teacher/simulations/${seeded.simulationId}/labs/${seeded.labId}`);
  await expect(teacher.getByText("Tests not offered: Invented test R (second page)")).toBeVisible();
  await axe(teacher);
  await teacher.context().close();
});

test("the requests page shows an error state and its retry loads it again (#268, #380)", async ({
  page,
}) => {
  await expectErrorStateRetries(page, "Requests");
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
  await openRequests(page);
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

test("a finished simulation reads but takes no new requests (#267, #380)", async ({ page }) => {
  const { seeded, check } = await expectReadOnly(
    page,
    "/student/requests",
    "Requests",
    "Record a request",
  );
  await check();
  // The request still reads, and its correction is disabled in the row's menu.
  const list = page.getByRole("table", { name: `Requests of ${seeded.lab}` });
  await expect(list.getByRole("button", { name: "Control sample", exact: true })).toBeVisible();
  await list.getByRole("button", { name: /^Actions for Control sample, entered / }).click();
  await expect(page.getByRole("menuitem", { name: "Correct" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await axe(page);
});
