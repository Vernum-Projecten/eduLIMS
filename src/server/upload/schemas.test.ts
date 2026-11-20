// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The caps of the upload inputs (security review of #372; ASVS V15.2.2, API4:2023): at most 96
// links and 96 results, a well of at most 3 characters, a lab number of at most 16.
import { describe, expect, it } from "vitest";
import { GEN5_FORM_FIELDS, gen5UploadInput, linkGen5Input, uploadGen5Input } from "./schemas.ts";

const LAB = "0193a1b2-0000-7000-8000-000000000001";
const UPLOAD = "0193a1b2-0000-7000-8000-000000000002";
const TEST = "0193a1b2-0000-7000-8000-000000000003";

function linkInput(links: number, results = 0, well = "A1", labNumber = "1234567890") {
  return {
    labId: LAB,
    uploadId: UPLOAD,
    links: Array.from({ length: links }, () => ({ well, labNumber })),
    results: Array.from({ length: results }, () => ({ labNumber, testId: TEST, value: "5.2" })),
  };
}

describe("the link input (#156)", () => {
  it("takes 96 links and 96 results", () => {
    expect(linkGen5Input.safeParse(linkInput(96, 96)).success).toBe(true);
  });

  it("refuses 97 links", () => {
    expect(linkGen5Input.safeParse(linkInput(97)).success).toBe(false);
  });

  it("refuses 97 results", () => {
    expect(linkGen5Input.safeParse(linkInput(0, 97)).success).toBe(false);
  });

  it("takes a well of 3 characters and refuses one of 4", () => {
    expect(linkGen5Input.safeParse(linkInput(1, 0, "H12")).success).toBe(true);
    expect(linkGen5Input.safeParse(linkInput(1, 0, "H120")).success).toBe(false);
  });

  it("takes a lab number of 16 characters and refuses one of 17", () => {
    expect(linkGen5Input.safeParse(linkInput(1, 0, "A1", "1".repeat(16))).success).toBe(true);
    expect(linkGen5Input.safeParse(linkInput(1, 0, "A1", "1".repeat(17))).success).toBe(false);
  });

  it("refuses a value of more than 32 characters", () => {
    const input = linkInput(0, 1);
    const long = { ...input, results: [{ labNumber: "1", testId: TEST, value: "1".repeat(33) }] };
    expect(linkGen5Input.safeParse(long).success).toBe(false);
  });

  it("lower-cases the ids, so an upper-case id reaches the same row", () => {
    const parsed = linkGen5Input.parse({ ...linkInput(0), labId: LAB.toUpperCase() });
    expect(parsed.labId).toBe(LAB);
  });
});

describe("the upload form (#156)", () => {
  it("takes the lab's id and one file", () => {
    const form = new FormData();
    form.set(GEN5_FORM_FIELDS.labId, LAB);
    form.set(GEN5_FORM_FIELDS.file, new File([new Uint8Array(4)], "plate.xlsx"));
    expect(uploadGen5Input.safeParse(form).success).toBe(true);
  });

  it("refuses a form without a file, or with text in its place", () => {
    const form = new FormData();
    form.set(GEN5_FORM_FIELDS.labId, LAB);
    expect(uploadGen5Input.safeParse(form).success).toBe(false);
    form.set(GEN5_FORM_FIELDS.file, "plate");
    expect(uploadGen5Input.safeParse(form).success).toBe(false);
  });

  it("refuses anything but a form", () => {
    expect(uploadGen5Input.safeParse({ labId: LAB }).success).toBe(false);
  });
});

describe("the read input", () => {
  it("takes two ids and refuses a malformed one", () => {
    expect(gen5UploadInput.safeParse({ labId: LAB, uploadId: UPLOAD }).success).toBe(true);
    expect(gen5UploadInput.safeParse({ labId: LAB, uploadId: "x" }).success).toBe(false);
  });
});
