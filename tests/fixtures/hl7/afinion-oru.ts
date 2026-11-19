// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Builds the HL7 v2.4 messages the Afinion 2 sends and the ACK it accepts, field by field as the
// Afinion 2 HL7 Connectivity Protocol v4.0 (docs/vendor/afinion/) lays them out in §3 and shows
// them in §4.1 (#159, S5). Test support only: nothing under src/ imports it.

/** The segment terminator of HL7 v2: a carriage return after every segment (protocol §4.1). */
export const SEGMENT_TERMINATOR = "\r";

/** The sending application the Afinion 2 always names in MSH-3 (protocol §3.2). */
export const AFINION_SENDING_APPLICATION = "Afinion 2 Analyzer";

/** MSH-11: `P` for a patient result, `Q` for a quality control result (protocol §3.2). */
export type ProcessingId = "P" | "Q";

/** The comparators OBX-8 may carry: "Only '<' and '>' will be supported" (protocol §3.8). */
export type Comparator = "<" | ">";

/** OBR-15, the specimen source the analyser reports (protocol §3.7). */
export type SpecimenSource = "ORH" | "BLDC" | "BLDV";

/**
 * Units per assay and analyte, as the protocol's examples show them (§4.1.1 to §4.1.9). The
 * Chol/HDL ratio has no unit.
 */
export const AFINION_ASSAYS = {
  CRP: [{ name: "CRP", unit: "mg/L" }],
  ACR: [
    { name: "ACR", unit: "mg/g" },
    { name: "Alb", unit: "mg/L" },
    { name: "Creat", unit: "mg/dL" },
  ],
  "Lipid Panel": [
    { name: "Chol", unit: "mmol/L" },
    { name: "LDL", unit: "mmol/L" },
    { name: "HDL", unit: "mmol/L" },
    { name: "Trig", unit: "mmol/L" },
    { name: "non-HDL", unit: "mmol/L" },
    { name: "Chol/HDL", unit: "" },
  ],
  HbA1c: [{ name: "HbA1c", unit: "%" }],
} as const;

/** The assay name in OBR-4 (protocol §3.7). */
export type AfinionAssay = keyof typeof AFINION_ASSAYS;

/** The analyte names in OBX-3 of one assay. */
export type AnalyteOf<A extends AfinionAssay> = (typeof AFINION_ASSAYS)[A][number]["name"];

/**
 * One OBX-5 result: a number as the analyser prints it, a value outside the measuring range with
 * its comparator, or no value (`--- `) when it cannot be calculated or measured (protocol §3.8).
 */
export type ObservationValue =
  | { readonly kind: "number"; readonly value: string }
  | { readonly kind: "outside-range"; readonly comparator: Comparator; readonly limit: string }
  | { readonly kind: "no-value" };

/** The results of one assay, one value per analyte the assay reports. */
export type AssayResults = {
  [A in AfinionAssay]: {
    readonly assay: A;
    readonly values: { readonly [N in AnalyteOf<A>]: ObservationValue };
  };
}[AfinionAssay];

/** Where the analyser puts the entered patient ID: "configurable, to use PID or visitnumber". */
export type PatientIdField = "PID-3" | "PV1-19";

/** The input of {@link buildAfinionOru}; every value is invented test data. */
export type AfinionOruInput = AssayResults & {
  /** MSH-11. */
  readonly processingId: ProcessingId;
  /** MSH-10, a consecutive number starting at 1000 (protocol §3.2). */
  readonly controlId: number;
  /** MSH-7, `YYYYMMDDHHMMSS`. */
  readonly messageTime: string;
  /** MSH-5, configured on the analyser; empty in examples 4.1.8 and 4.1.9. */
  readonly receivingApplication?: string;
  /** MSH-6, configured on the analyser. */
  readonly receivingFacility?: string;
  /** The entered patient ID and its field, or `null` when none was entered (example 4.1.9). */
  readonly patientId: { readonly field: PatientIdField; readonly value: string } | null;
  /** OBR-3, the run number of the analyser. */
  readonly runNumber: number;
  /** OBR-15; every example shows `ORH`. */
  readonly specimenSource?: SpecimenSource;
  /** OBR-23.2, the reagent lot. */
  readonly reagentLot: string;
  /** OBX-16, the operator ID entered on the analyser, or `null` when none was entered. */
  readonly operatorId: string | null;
  /** OBX-18, the analyser's serial number. */
  readonly serialNumber: string;
  /** OBX-19, the time of the measurement, `YYYYMMDDHHMMSS`. */
  readonly measuredAt: string;
};

/** MSA-1 codes of HL7 v2.4; the analyser accepts only `AA` and `CA` (protocol §3.4). */
export type AckCode = "AA" | "AE" | "AR" | "CA" | "CE" | "CR";

/** The input of {@link buildAck}. */
export interface AckInput {
  /** MSA-1. */
  readonly code: AckCode;
  /** MSA-2, the MSH-10 of the message acknowledged. */
  readonly acknowledgedControlId: string;
  /** MSH-10 of the ACK itself. */
  readonly controlId: string;
  /** MSH-7, `YYYYMMDDHHMMSS`. */
  readonly messageTime: string;
  /** MSH-3, the receiving system that answers. */
  readonly sendingApplication: string;
}

const TIMESTAMP = /^\d{14}$/;
const NUMBER = /^\d+(\.\d+)?$/;
/** The HL7 delimiters of MSH-1 and MSH-2 as the Afinion 2 sends them (protocol §3.2). */
const HL7_DELIMITERS: ReadonlySet<string> = new Set(["|", "^", "~", "\\", "&"]);

/**
 * Tells whether a character is printable ASCII (0x20 to 0x7E), compared by code point so no
 * control character has to appear in the source.
 */
function isPrintableAscii(character: string): boolean {
  const code = character.codePointAt(0) ?? -1;
  return code >= 0x20 && code <= 0x7e;
}

/**
 * Tells whether `value` can stand in one HL7 field: printable ASCII only, so no CR, MLLP block
 * byte (0x0B, 0x1C) or DEL breaks the message, and no HL7 delimiter splits the field.
 */
export function isPlainField(value: string): boolean {
  return [...value].every(
    (character) => isPrintableAscii(character) && !HL7_DELIMITERS.has(character),
  );
}

/** Returns `value` when it is a field value without HL7 delimiters or non-ASCII characters. */
function field(name: string, value: string): string {
  if (!isPlainField(value)) {
    throw new RangeError(`${name} holds a character outside printable ASCII or an HL7 delimiter`);
  }
  return value;
}

/** Returns `value` when it is an HL7 timestamp of the form the examples show. */
function timestamp(name: string, value: string): string {
  if (!TIMESTAMP.test(value)) throw new RangeError(`${name} is not YYYYMMDDHHMMSS`);
  return value;
}

/** Returns `value` when it is a decimal number as the analyser prints it. */
function decimal(name: string, value: string): string {
  if (!NUMBER.test(value)) throw new RangeError(`${name} is not a decimal number`);
  return value;
}

/** Joins fields 1..n of a segment and adds the trailing separator the examples show. */
function segment(id: string, fields: readonly string[], trailing: boolean): string {
  return [id, ...fields].join("|") + (trailing ? "|" : "");
}

/** Returns an array of `length` fields with `values` at their 1-based HL7 field numbers. */
function fieldsAt(length: number, values: Readonly<Record<number, string>>): string[] {
  return Array.from({ length }, (_, index) => values[index + 1] ?? "");
}

/** Returns OBX-5 and OBX-8 for one value (protocol §3.8, examples 4.1.3, 4.1.4, 4.1.9). */
function observation(analyte: string, value: ObservationValue): { obx5: string; obx8: string } {
  switch (value.kind) {
    case "number":
      return { obx5: decimal(`${analyte} value`, value.value), obx8: "" };
    case "outside-range":
      return {
        obx5: `${value.comparator}${decimal(`${analyte} limit`, value.limit)}`,
        obx8: value.comparator,
      };
    case "no-value":
      return { obx5: "--- ", obx8: "" };
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

/** Returns the MSH segment of an ORU^R01 (protocol §3.2): 18 fields, no trailing separator. */
function oruHeader(input: AfinionOruInput): string {
  if (!Number.isInteger(input.controlId) || input.controlId < 1000) {
    throw new RangeError("MSH-10 is a consecutive number starting at 1000");
  }
  // MSH-1 is the separator itself, so the fields after "MSH" start at MSH-2.
  return segment(
    "MSH",
    fieldsAt(17, {
      1: "^~\\&",
      2: AFINION_SENDING_APPLICATION,
      4: field("MSH-5", input.receivingApplication ?? ""),
      5: field("MSH-6", input.receivingFacility ?? ""),
      6: timestamp("MSH-7", input.messageTime),
      8: "ORU^R01",
      9: String(input.controlId),
      10: input.processingId,
      11: "2.4",
      14: "AL",
      15: "NE",
      17: "8859/1",
    }),
    false,
  );
}

/**
 * Builds an Afinion 2 ORU^R01 message as the protocol's examples show it: MSH, PID, PV1, OBR and
 * one OBX per analyte, each segment ended by a carriage return (protocol §2.2, §3, §4.1).
 *
 * @throws {RangeError} when a value is no valid field for its place in the message.
 */
export function buildAfinionOru(input: AfinionOruInput): string {
  const patientId = input.patientId === null ? null : field("patient ID", input.patientId.value);
  const pid3 = input.patientId?.field === "PID-3" ? patientId : null;
  const pv119 = input.patientId?.field === "PV1-19" ? patientId : null;
  const values: Readonly<Record<string, ObservationValue>> = input.values;
  const operatorId = input.operatorId === null ? "" : field("OBX-16", input.operatorId);
  const serial = field("OBX-18", input.serialNumber);
  const measuredAt = timestamp("OBX-19", input.measuredAt);

  const observations = AFINION_ASSAYS[input.assay].map(({ name, unit }, index) => {
    const value = values[name];
    if (value === undefined) throw new RangeError(`no value for ${name}`);
    const { obx5, obx8 } = observation(name, value);
    return segment(
      "OBX",
      fieldsAt(19, {
        1: String(index + 1),
        2: "ST",
        3: name,
        5: obx5,
        6: unit,
        8: obx8,
        11: "F",
        16: operatorId,
        18: serial,
        19: measuredAt,
      }),
      true,
    );
  });

  if (!Number.isInteger(input.runNumber) || input.runNumber < 1) {
    throw new RangeError("OBR-3 is a positive run number");
  }
  const segments = [
    oruHeader(input),
    segment("PID", fieldsAt(3, { 1: "1", 3: pid3 ?? "" }), true),
    segment("PV1", fieldsAt(19, { 1: "1", 19: pv119 ?? "" }), true),
    segment(
      "OBR",
      fieldsAt(25, {
        1: "1",
        3: String(input.runNumber),
        4: input.assay,
        11: "N",
        15: input.specimenSource ?? "ORH",
        23: `^${field("OBR-23.2", input.reagentLot)}`,
        25: "F",
      }),
      true,
    ),
    ...observations,
  ];
  return segments.map((line) => line + SEGMENT_TERMINATOR).join("");
}

/**
 * Builds the ACK a receiving system returns for an ORU^R01: MSH and MSA (protocol §2.3, §3.4).
 *
 * The protocol shows no MSH of an ACK; this one follows HL7 v2.4 with `ACK^R01` in MSH-9.
 */
export function buildAck(input: AckInput): string {
  const header = segment(
    "MSH",
    fieldsAt(11, {
      1: "^~\\&",
      2: field("MSH-3", input.sendingApplication),
      4: AFINION_SENDING_APPLICATION,
      6: timestamp("MSH-7", input.messageTime),
      8: "ACK^R01",
      9: field("MSH-10", input.controlId),
      10: "P",
      11: "2.4",
    }),
    false,
  );
  const msa = segment("MSA", [input.code, field("MSA-2", input.acknowledgedControlId)], false);
  return [header, msa].map((line) => line + SEGMENT_TERMINATOR).join("");
}

/**
 * Returns the bytes of a built message in ISO 8859-1, the character set of MSH-18.
 *
 * @throws {RangeError} when the message holds a character outside ASCII, which the fixtures never
 *   use, so they are the same bytes in ASCII and ISO 8859-1.
 */
export function messageBytes(message: string): Buffer {
  const allowed = (character: string) =>
    character === SEGMENT_TERMINATOR || isPrintableAscii(character);
  if (![...message].every(allowed)) {
    throw new RangeError("the message holds a character outside printable ASCII and CR");
  }
  return Buffer.from(message, "latin1");
}

// The Damm quasigroup of order 10 (H. M. Damm, 2004), as the lab number of #268 uses it.
const DAMM_TABLE: readonly (readonly number[])[] = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

/**
 * Returns the Damm check digit of a string of decimal digits.
 *
 * @throws {RangeError} when `digits` is empty or holds anything but 0 to 9.
 */
export function dammCheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) throw new RangeError("Damm takes decimal digits only");
  let interim = 0;
  for (const digit of digits) {
    const next = DAMM_TABLE[interim]?.[Number(digit)];
    if (next === undefined) throw new RangeError("Damm table lookup out of range");
    interim = next;
  }
  return interim;
}

/**
 * Returns an invented lab number in the format of #268: nine digits and their Damm check digit.
 *
 * @throws {RangeError} when `body` is not nine decimal digits.
 */
export function inventedLabNumber(body: string): string {
  if (!/^\d{9}$/.test(body)) throw new RangeError("a lab number body is nine decimal digits");
  return `${body}${dammCheckDigit(body)}`;
}
