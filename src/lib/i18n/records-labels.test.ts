// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The words of a team's records (#268): every refusal, sex, kind and correction field has its
// own translated message, never an empty string or a code.
import { describe, expect, it } from "vitest";
import { PATIENT_SEXES, REQUEST_KINDS } from "@/lib/lab-records";
import { RECORDS_ACTION_ERRORS } from "@/server/lab-records/access";
import { PLAIN_FIELDS } from "@/server/lab-records/corrections";
import {
  correctionFieldLabel,
  recordsErrorMessage,
  requestKindLabel,
  requestRefusal,
  sexLabel,
} from "./records-labels";

function distinct(values: readonly string[]): void {
  for (const value of values) expect(value.length).toBeGreaterThan(0);
  expect(new Set(values).size).toBe(values.length);
}

describe("the records labels (#268)", () => {
  it("give every refusal and a failure a message of its own", () => {
    const messages = [...RECORDS_ACTION_ERRORS, null].map(recordsErrorMessage);
    distinct(messages);
    expect(recordsErrorMessage("released")).toBe(
      "A result is released, so this can no longer be corrected.",
    );
  });

  it("name every sex and kind of request", () => {
    distinct(PATIENT_SEXES.map(sexLabel));
    distinct(REQUEST_KINDS.map(requestKindLabel));
    expect(requestKindLabel("control")).toBe("Control sample");
  });

  it("put a request refusal at the field it is about, else at the top (WCAG 3.3.1)", () => {
    expect(requestRefusal("test_retired")).toEqual({
      fields: { testIds: "A chosen test is retired and cannot be requested." },
    });
    expect(requestRefusal("test_not_found").fields).toHaveProperty("testIds");
    expect(requestRefusal("patient_not_found").fields).toHaveProperty("patientId");
    expect(requestRefusal("requester_required").fields).toHaveProperty("requester");
    expect(requestRefusal("sample_not_found").fields).toHaveProperty("samples");
    expect(requestRefusal("released")).toEqual({
      form: "A result is released, so this can no longer be corrected.",
    });
    expect(requestRefusal(null)).toEqual({ form: "Saving failed. Try again." });
  });

  it("name every field a correction can change", () => {
    const fields = [...PLAIN_FIELDS, "tests", "sample_number", "material", "sample_added"] as const;
    distinct(fields.map(correctionFieldLabel));
  });
});
