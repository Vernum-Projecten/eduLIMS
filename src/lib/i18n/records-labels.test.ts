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

  it("name every field a correction can change", () => {
    const fields = [...PLAIN_FIELDS, "tests", "sample_number", "material", "sample_added"] as const;
    distinct(fields.map(correctionFieldLabel));
  });
});
