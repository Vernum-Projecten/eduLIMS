// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of the records (S11, S12, S16): only what a real LIMS refuses is refused, a missing
// required field, a date that is no date, a text past its bound; nothing is filled in.
import { describe, expect, it } from "vitest";
import {
  correctRequestInput,
  patientDetailsSchema,
  recordRequestInput,
  registerPatientInput,
} from "./schemas.ts";

const LAB = "01960000-0000-7000-8000-0000000000a1";
const PATIENT = "01960000-0000-7000-8000-0000000000b1";
const TEST = "01960000-0000-7000-8000-0000000000c1";
const OTHER_TEST = "01960000-0000-7000-8000-0000000000c2";

const details = {
  name: "Ada Testpatient",
  dateOfBirth: "1984-03-21",
  sex: "female",
  identifier: "PID-000117",
};

const request = {
  kind: "patient",
  labId: LAB,
  patientId: PATIENT,
  requester: "Dr. Invented",
  phoneThrough: false,
  remarks: "",
  testIds: [TEST],
  samples: [{ sampleNumber: "S-001", material: "whole blood" }],
};

describe("the patient's details (S11)", () => {
  it("keep what the team typed, trimmed", () => {
    expect(patientDetailsSchema.parse({ ...details, name: "  Ada Testpatient " })).toEqual(details);
  });

  it("refuse a missing field and a date that is no date", () => {
    for (const field of ["name", "dateOfBirth", "identifier"] as const) {
      expect(patientDetailsSchema.safeParse({ ...details, [field]: " " }).success).toBe(false);
    }
    expect(patientDetailsSchema.safeParse({ ...details, dateOfBirth: "1984-02-30" }).success).toBe(
      false,
    );
    expect(patientDetailsSchema.safeParse({ ...details, sex: "" }).success).toBe(false);
  });

  it("refuse a name past its bound and a control character", () => {
    expect(patientDetailsSchema.safeParse({ ...details, name: "A".repeat(101) }).success).toBe(
      false,
    );
    expect(patientDetailsSchema.safeParse({ ...details, name: "Ada\u0000" }).success).toBe(false);
  });

  it("need a lab id to register", () => {
    expect(registerPatientInput.safeParse(details).success).toBe(false);
    expect(registerPatientInput.safeParse({ ...details, labId: LAB }).success).toBe(true);
  });
});

describe("a new request (S12, S16)", () => {
  it("turns empty remarks into nothing", () => {
    const parsed = recordRequestInput.parse(request);
    expect(parsed.remarks).toBeNull();
  });

  it("needs a patient and a requester for a patient request", () => {
    expect(recordRequestInput.safeParse({ ...request, patientId: undefined }).success).toBe(false);
    expect(recordRequestInput.safeParse({ ...request, requester: "" }).success).toBe(false);
  });

  it("takes a control request without a patient and without a requester (S16)", () => {
    const { patientId: _patient, ...control } = request;
    const parsed = recordRequestInput.parse({ ...control, kind: "control", requester: "" });
    expect(parsed).toEqual(expect.objectContaining({ kind: "control", requester: null }));
    expect(parsed).not.toHaveProperty("patientId");
  });

  it("needs one test at least, each once, and one sample at least", () => {
    expect(recordRequestInput.safeParse({ ...request, testIds: [] }).success).toBe(false);
    expect(recordRequestInput.safeParse({ ...request, testIds: [TEST, TEST] }).success).toBe(false);
    expect(recordRequestInput.safeParse({ ...request, testIds: [TEST, OTHER_TEST] }).success).toBe(
      true,
    );
    expect(recordRequestInput.safeParse({ ...request, samples: [] }).success).toBe(false);
  });

  it("takes the same sample number twice: a second tube (S12)", () => {
    const tube = { sampleNumber: "S-001", material: "whole blood" };
    expect(recordRequestInput.safeParse({ ...request, samples: [tube, tube] }).success).toBe(true);
  });

  it("strips a time the client sends: the server takes the time of entry (Q-SIM-2)", () => {
    const parsed = recordRequestInput.parse({ ...request, enteredAt: "2000-01-01T00:00:00Z" });
    expect(parsed).not.toHaveProperty("enteredAt");
  });
});

/** NUL, VT, ESC, RIGHT-TO-LEFT OVERRIDE and ZERO WIDTH SPACE (security review of #351, S1). */
const HIDDEN = ["\u0000", "\u000b", "\u001b", "\u202e", "\u200b"];

describe("control and format characters (review of #351, S1)", () => {
  it.each(HIDDEN.map((char) => [JSON.stringify(char), char]))(
    "refuses %s in the remarks, the requester, the sample and the patient",
    (_name, char) => {
      const text = `Fast${char}ing`;
      expect(recordRequestInput.safeParse({ ...request, remarks: text }).success).toBe(false);
      expect(recordRequestInput.safeParse({ ...request, requester: text }).success).toBe(false);
      expect(
        recordRequestInput.safeParse({
          ...request,
          samples: [{ sampleNumber: text, material: "plasma" }],
        }).success,
      ).toBe(false);
      expect(
        recordRequestInput.safeParse({
          ...request,
          samples: [{ sampleNumber: "S-1", material: text }],
        }).success,
      ).toBe(false);
      for (const field of ["name", "identifier"] as const) {
        expect(patientDetailsSchema.safeParse({ ...details, [field]: text }).success).toBe(false);
      }
    },
  );

  it("names the refused remarks with the translated message", () => {
    const parsed = recordRequestInput.safeParse({ ...request, remarks: "A\u0000B" });
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
      "Remove the control characters from this field.",
    ]);
  });

  it("keeps a line break and a tab in the remarks", () => {
    const parsed = recordRequestInput.parse({
      ...request,
      remarks: "Fasting.\n\tHaemolysed.\r\nOk",
    });
    expect(parsed.remarks).toBe("Fasting.\n\tHaemolysed.\r\nOk");
  });
});

describe("a correction of a request (S12)", () => {
  const correction = {
    labId: LAB,
    requestId: PATIENT,
    requester: "Dr. Invented",
    phoneThrough: true,
    remarks: "",
    testIds: [TEST],
    samples: [{ sampleId: TEST, sampleNumber: "S-001", material: "whole blood" }],
  };

  it("takes a known sample and a new one", () => {
    const parsed = correctRequestInput.parse({
      ...correction,
      samples: [...correction.samples, { sampleNumber: "S-001", material: "whole blood" }],
    });
    expect(parsed.samples).toHaveLength(2);
  });

  it("refuses the same sample twice", () => {
    expect(
      correctRequestInput.safeParse({
        ...correction,
        samples: [...correction.samples, ...correction.samples],
      }).success,
    ).toBe(false);
  });
});
