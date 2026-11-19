// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The simulated Afinion 2 messages of #159 against their builder and against the field layout of
// the Afinion 2 HL7 Connectivity Protocol v4.0 (§3.2 to §3.8, examples §4.1), for S5 and P-02.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACK_FIXTURES,
  buildAllFixtures,
  LAB_NUMBERS,
  OPERATOR_ID,
  ORU_FIXTURES,
  SERIALS,
} from "../fixtures/hl7/afinion-fixtures.ts";
import {
  type AfinionOruInput,
  buildAck,
  buildAfinionOru,
  dammCheckDigit,
  inventedLabNumber,
  messageBytes,
} from "../fixtures/hl7/afinion-oru.ts";

const DIR = join(import.meta.dirname, "..", "fixtures", "hl7");
const fixtureNames = readdirSync(DIR).filter((name) => name.endsWith(".hl7"));

/** Reads a fixture as the bytes a sender would put on the wire. */
const fixtureBytes = (name: string): Buffer => readFileSync(join(DIR, name));

/** Splits a message into segments, each into its fields as HL7 numbers them (MSH-1 is `|`). */
function parse(message: string): Map<string, string[][]> {
  const segments = new Map<string, string[][]>();
  for (const line of message.split("\r").filter((part) => part !== "")) {
    const parts = line.split("|");
    const id = parts[0] ?? "";
    const fields = id === "MSH" ? ["MSH", "|", ...parts.slice(1)] : parts;
    segments.set(id, [...(segments.get(id) ?? []), fields]);
  }
  return segments;
}

/** Returns the one segment `id` of a parsed message. */
function only(segments: Map<string, string[][]>, id: string): string[] {
  const found = segments.get(id) ?? [];
  expect(found).toHaveLength(1);
  return found[0] ?? [];
}

const text = (name: string): string => fixtureBytes(name).toString("latin1");

describe("the static HL7 fixtures (#159)", () => {
  it("has a builder input for every .hl7 file and a file for every input", () => {
    expect([...buildAllFixtures().keys()].sort()).toEqual([...fixtureNames].sort());
  });

  it.each(fixtureNames)("%s is byte for byte what the builder makes", (name) => {
    const built = buildAllFixtures().get(name);
    if (built === undefined) expect.fail(`no builder input for ${name}`);
    expect(fixtureBytes(name).equals(messageBytes(built))).toBe(true);
  });

  it.each(fixtureNames)("%s is printable ASCII with a CR after every segment", (name) => {
    const bytes = fixtureBytes(name);
    expect(bytes.every((byte) => byte === 0x0d || (byte >= 0x20 && byte <= 0x7e))).toBe(true);
    expect(bytes.at(-1)).toBe(0x0d);
    expect(bytes.includes(0x0a)).toBe(false);
  });
});

describe("the ORU^R01 layout (protocol §2.2, §3)", () => {
  const oruNames = Object.keys(ORU_FIXTURES);

  it.each(oruNames)("%s has MSH, PID, PV1, OBR, then the OBX segments, in order", (name) => {
    const ids = text(name)
      .split("\r")
      .filter((line) => line !== "")
      .map((line) => line.slice(0, 3));
    expect(ids.slice(0, 4)).toEqual(["MSH", "PID", "PV1", "OBR"]);
    expect(ids.slice(4).every((id) => id === "OBX")).toBe(true);
    expect(ids.length).toBeGreaterThan(4);
  });

  it.each(oruNames)("%s has the fixed MSH fields of §3.2", (name) => {
    const msh = only(parse(text(name)), "MSH");
    expect(msh[2]).toBe("^~\\&");
    expect(msh[3]).toBe("Afinion 2 Analyzer");
    expect(msh[9]).toBe("ORU^R01");
    expect(Number(msh[10])).toBeGreaterThanOrEqual(1000);
    expect(msh[12]).toBe("2.4");
    expect(msh[15]).toBe("AL");
    expect(msh[16]).toBe("NE");
    expect(msh[18]).toBe("8859/1");
    expect(msh).toHaveLength(19);
  });

  it.each(oruNames)("%s has as many fields per segment as the examples of §4.1", (name) => {
    const segments = parse(text(name));
    expect(only(segments, "PID")).toHaveLength(5);
    expect(only(segments, "PV1")).toHaveLength(21);
    expect(only(segments, "OBR")).toHaveLength(27);
    for (const obx of segments.get("OBX") ?? []) expect(obx).toHaveLength(21);
  });

  it.each(oruNames)("%s has the fixed OBR and OBX fields of §3.7 and §3.8", (name) => {
    const segments = parse(text(name));
    const obr = only(segments, "OBR");
    expect([obr[1], obr[11], obr[15], obr[25]]).toEqual(["1", "N", "ORH", "F"]);
    expect(obr[23]).toMatch(/^\^\d{8}$/);
    (segments.get("OBX") ?? []).forEach((obx, index) => {
      expect([obx[1], obx[2], obx[11]]).toEqual([String(index + 1), "ST", "F"]);
      expect(Object.values(SERIALS)).toContain(obx[18]);
      expect(obx[19]).toMatch(/^\d{14}$/);
    });
  });

  it("sends a patient result with MSH-11 P and a QC result with MSH-11 Q (§3.2)", () => {
    for (const name of ["crp-patient-pid3.hl7", "hba1c-patient.hl7"]) {
      expect(only(parse(text(name)), "MSH")[11]).toBe("P");
    }
    for (const name of ["crp-qc.hl7", "hba1c-qc.hl7"]) {
      expect(only(parse(text(name)), "MSH")[11]).toBe("Q");
    }
  });

  it("carries the lab number in PID-3 and leaves PV1-19 empty (§3.5)", () => {
    const segments = parse(text("crp-patient-pid3.hl7"));
    expect(only(segments, "PID")[3]).toBe(LAB_NUMBERS.crpPid);
    expect(only(segments, "PV1")[19]).toBe("");
  });

  it("carries the lab number in PV1-19 and leaves PID-3 empty (§3.6)", () => {
    const segments = parse(text("crp-patient-pv1-19.hl7"));
    expect(only(segments, "PID")[3]).toBe("");
    expect(only(segments, "PV1")[19]).toBe(LAB_NUMBERS.crpPv1);
  });

  it("carries no patient ID at all when none was entered (§4.1.9, #163)", () => {
    const segments = parse(text("hba1c-no-patient-id.hl7"));
    expect(only(segments, "PID")[3]).toBe("");
    expect(only(segments, "PV1")[19]).toBe("");
  });

  it("carries the operator ID in OBX-16 and the serial number in OBX-18 (§3.8)", () => {
    const obx = only(parse(text("hba1c-patient.hl7")), "OBX");
    expect(obx[16]).toBe(OPERATOR_ID);
    expect(obx[18]).toBe(SERIALS.second);
  });

  it("flags a value above the range with > in OBX-8 and the limit in OBX-5 (§3.8)", () => {
    const obx = only(parse(text("hba1c-above-range.hl7")), "OBX");
    expect([obx[3], obx[5], obx[6], obx[8]]).toEqual(["HbA1c", ">15.0", "%", ">"]);
  });

  it("flags values below the range with < in a multi-analyte result (§3.8, §4.1.3)", () => {
    const obx = parse(text("acr-below-range.hl7")).get("OBX") ?? [];
    expect(obx.map((fields) => [fields[3], fields[5], fields[6], fields[8]])).toEqual([
      ["ACR", "<5.6", "mg/g", "<"],
      ["Alb", "<5.0", "mg/L", "<"],
      ["Creat", "41.2", "mg/dL", ""],
    ]);
  });

  it('sends "--- " in OBX-5 for a value that cannot be calculated (§3.8, §4.1.4)', () => {
    const [acr] = parse(text("acr-no-value.hl7")).get("OBX") ?? [];
    expect([acr?.[5], acr?.[8]]).toEqual(["--- ", ""]);
  });

  it("reports the six analytes of the lipid panel with their units (§4.1.5)", () => {
    const obx = parse(text("lipid-panel.hl7")).get("OBX") ?? [];
    expect(obx.map((fields) => `${fields[3]} ${fields[6]}`)).toEqual([
      "Chol mmol/L",
      "LDL mmol/L",
      "HDL mmol/L",
      "Trig mmol/L",
      "non-HDL mmol/L",
      "Chol/HDL ",
    ]);
  });

  it.each(Object.values(LAB_NUMBERS))(
    "uses %s, an invented lab number of ten digits with a valid Damm check digit (#268)",
    (labNumber) => {
      expect(labNumber).toMatch(/^\d{10}$/);
      expect(dammCheckDigit(labNumber)).toBe(0);
    },
  );
});

describe("the ACK fixtures (protocol §2.3, §3.4)", () => {
  it.each(Object.keys(ACK_FIXTURES))("%s is MSH and MSA with an accepted code", (name) => {
    const segments = parse(text(name));
    const msh = only(segments, "MSH");
    expect([msh[9], msh[12]]).toEqual(["ACK^R01", "2.4"]);
    const msa = only(segments, "MSA");
    expect(["AA", "CA"]).toContain(msa[1]);
    expect(msa[2]).toBe(String(ORU_FIXTURES["crp-patient-pid3.hl7"].controlId));
  });
});

describe("buildAfinionOru refusals", () => {
  const base: AfinionOruInput = ORU_FIXTURES["crp-patient-pid3.hl7"];

  it("refuses a control ID below 1000 (§3.2)", () => {
    expect(() => buildAfinionOru({ ...base, controlId: 999 })).toThrow(RangeError);
  });

  it("refuses a time that is not YYYYMMDDHHMMSS", () => {
    expect(() => buildAfinionOru({ ...base, measuredAt: "2026-11-16" })).toThrow(RangeError);
  });

  it("refuses a patient ID with an HL7 delimiter", () => {
    const patientId = { field: "PID-3", value: "12|34" } as const;
    expect(() => buildAfinionOru({ ...base, patientId })).toThrow(RangeError);
  });

  it("refuses a value that is no decimal number", () => {
    const values = { CRP: { kind: "number", value: "1,5" } } as const;
    expect(() => buildAfinionOru({ ...base, assay: "CRP", values })).toThrow(RangeError);
  });

  it("refuses a run number below 1", () => {
    expect(() => buildAfinionOru({ ...base, runNumber: 0 })).toThrow(RangeError);
  });

  it("refuses a message with a character outside ASCII when it becomes bytes", () => {
    expect(() => messageBytes("MSH|é\r")).toThrow(RangeError);
  });

  it("builds an ACK with the code it is given", () => {
    const ack = buildAck({ ...ACK_FIXTURES["ack-aa.hl7"], code: "AE" });
    expect(only(parse(ack), "MSA")[1]).toBe("AE");
  });
});

describe("the Damm check digit of the fixture lab numbers", () => {
  it("gives 4 for 572, the worked example of the algorithm", () => {
    expect(dammCheckDigit("572")).toBe(4);
  });

  it("appends the check digit to nine digits", () => {
    expect(inventedLabNumber("000000572")).toBe("0000005724");
  });

  it("catches every single wrong digit in a fixture lab number", () => {
    const labNumber = LAB_NUMBERS.crpPid;
    for (let position = 0; position < labNumber.length; position += 1) {
      for (let digit = 0; digit <= 9; digit += 1) {
        if (String(digit) === labNumber[position]) continue;
        const typo = `${labNumber.slice(0, position)}${digit}${labNumber.slice(position + 1)}`;
        expect(dammCheckDigit(typo)).not.toBe(0);
      }
    }
  });

  it("refuses a body that is not nine digits", () => {
    expect(() => inventedLabNumber("12345678")).toThrow(RangeError);
    expect(() => dammCheckDigit("12a")).toThrow(RangeError);
  });
});
