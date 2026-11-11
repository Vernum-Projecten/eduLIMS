// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { ANALYSER_ROUTES, ANALYSER_STATUSES } from "../analysers.ts";
import { CHECK_ERROR_CLASSES, INTEGRATIONS } from "../integrations.ts";
import {
  analyserErrorMessage,
  analyserRouteLabel,
  analyserStatusLabel,
  checkErrorLabel,
  integrationDescription,
  integrationLabel,
  integrationStateLabel,
} from "./analyser-labels.ts";

describe("the B3 labels (English source)", () => {
  it("names every state of an integration in text, beside its icon (WCAG 1.4.1)", () => {
    expect(integrationStateLabel("available")).toBe("Available");
    expect(integrationStateLabel("unavailable")).toBe("Unavailable");
    expect(integrationStateLabel("refused")).toBe("Refused (authentication)");
    expect(integrationStateLabel("not_checked")).toBe("Not checked yet");
    expect(integrationStateLabel("unknown")).toBe("Unknown: no check in the last 5 minutes");
  });

  it("explains a refusal of the credentials without naming an address or a secret", () => {
    const text = checkErrorLabel("auth_refused");
    expect(text).toContain("401 or 403");
    expect(text).not.toMatch(/https?:/);
  });

  it("has a text for every error class, integration, route and status", () => {
    for (const errorClass of CHECK_ERROR_CLASSES) expect(checkErrorLabel(errorClass)).not.toBe("");
    for (const integration of INTEGRATIONS) {
      expect(integrationLabel(integration)).not.toBe("");
      expect(integrationDescription(integration)).not.toBe("");
    }
    for (const route of ANALYSER_ROUTES) expect(analyserRouteLabel(route)).not.toBe("");
    for (const status of ANALYSER_STATUSES) expect(analyserStatusLabel(status)).not.toBe("");
  });

  it("maps every refusal of a register change, and anything else to a retry", () => {
    expect(analyserErrorMessage("serial_taken")).toContain("serial number");
    expect(analyserErrorMessage("retired")).toContain("retired");
    expect(analyserErrorMessage("not_found")).toContain("no longer exists");
    expect(analyserErrorMessage("anything")).toBe("The change could not be saved. Try again.");
  });
});
