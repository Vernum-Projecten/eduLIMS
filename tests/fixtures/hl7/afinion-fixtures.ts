// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The input of every static HL7 fixture in this directory. A unit test builds each one and
// compares it byte for byte with its file, so a fixture cannot drift from the builder (#159).
// Every lab number, serial number, operator ID, lot, time and value is invented.
import {
  type AckInput,
  type AfinionOruInput,
  buildAck,
  buildAfinionOru,
  inventedLabNumber,
} from "./afinion-oru.ts";

/** The invented analyser serial numbers (OBX-18); the `AF99` range marks them as made up. */
export const SERIALS = { first: "AF99000001", second: "AF99000002" } as const;

/** The invented operator ID entered on the analyser (OBX-16). */
export const OPERATOR_ID = "SIM001";

/** Invented lab numbers in the format of #268: nine digits and a Damm check digit. */
export const LAB_NUMBERS = {
  crpPid: inventedLabNumber("305718642"),
  crpPv1: inventedLabNumber("481926305"),
  crpQc: inventedLabNumber("719264038"),
  hba1c: inventedLabNumber("560193847"),
  hba1cQc: inventedLabNumber("842617093"),
  hba1cHigh: inventedLabNumber("136975284"),
  acrLow: inventedLabNumber("927350461"),
  acrNoValue: inventedLabNumber("274801596"),
  lipid: inventedLabNumber("613058729"),
} as const;

const RECEIVER = { receivingApplication: "FERROBRIDGE", receivingFacility: "SIMLAB" } as const;

/** The ORU^R01 fixtures by file name, with the protocol example each one follows. */
export const ORU_FIXTURES = {
  // §4.1.1 (a single analyte) with the patient ID in PID-3 as §4.1.2 places it (§3.5).
  "crp-patient-pid3.hl7": {
    ...RECEIVER,
    processingId: "P",
    controlId: 1000,
    messageTime: "20261116091512",
    patientId: { field: "PID-3", value: LAB_NUMBERS.crpPid },
    runNumber: 1,
    assay: "CRP",
    values: { CRP: { kind: "number", value: "12" } },
    reagentLot: "99001234",
    operatorId: OPERATOR_ID,
    serialNumber: SERIALS.first,
    measuredAt: "20261116091330",
  },
  // §4.1.1: the patient ID in PV1-19, PID-3 empty (§3.6).
  "crp-patient-pv1-19.hl7": {
    ...RECEIVER,
    processingId: "P",
    controlId: 1001,
    messageTime: "20261116092240",
    patientId: { field: "PV1-19", value: LAB_NUMBERS.crpPv1 },
    runNumber: 2,
    assay: "CRP",
    values: { CRP: { kind: "number", value: "37" } },
    reagentLot: "99001234",
    operatorId: OPERATOR_ID,
    serialNumber: SERIALS.first,
    measuredAt: "20261116092101",
  },
  // §4.1.8: a quality control result (MSH-11 Q, §3.2), here for CRP.
  "crp-qc.hl7": {
    ...RECEIVER,
    processingId: "Q",
    controlId: 1002,
    messageTime: "20261116080405",
    patientId: { field: "PID-3", value: LAB_NUMBERS.crpQc },
    runNumber: 3,
    assay: "CRP",
    values: { CRP: { kind: "number", value: "21" } },
    reagentLot: "99001234",
    operatorId: OPERATOR_ID,
    serialNumber: SERIALS.first,
    measuredAt: "20261116080220",
  },
  // §4.1.8 as a patient result: HbA1c with an operator ID in OBX-16 (§3.8).
  "hba1c-patient.hl7": {
    ...RECEIVER,
    processingId: "P",
    controlId: 1003,
    messageTime: "20261117101845",
    patientId: { field: "PID-3", value: LAB_NUMBERS.hba1c },
    runNumber: 4,
    assay: "HbA1c",
    values: { HbA1c: { kind: "number", value: "5.8" } },
    reagentLot: "99005678",
    operatorId: OPERATOR_ID,
    serialNumber: SERIALS.second,
    measuredAt: "20261117101602",
  },
  // §4.1.8: a quality control result for HbA1c (MSH-11 Q).
  "hba1c-qc.hl7": {
    processingId: "Q",
    controlId: 1004,
    messageTime: "20261117075930",
    patientId: { field: "PID-3", value: LAB_NUMBERS.hba1cQc },
    runNumber: 5,
    assay: "HbA1c",
    values: { HbA1c: { kind: "number", value: "7.1" } },
    reagentLot: "99005678",
    operatorId: OPERATOR_ID,
    serialNumber: SERIALS.second,
    measuredAt: "20261117075712",
  },
  // §4.1.9: above the measuring range, `>` in OBX-8 and with the limit in OBX-5 (§3.8).
  "hba1c-above-range.hl7": {
    ...RECEIVER,
    processingId: "P",
    controlId: 1005,
    messageTime: "20261117103310",
    patientId: { field: "PID-3", value: LAB_NUMBERS.hba1cHigh },
    runNumber: 6,
    assay: "HbA1c",
    values: { HbA1c: { kind: "outside-range", comparator: ">", limit: "15.0" } },
    reagentLot: "99005678",
    operatorId: OPERATOR_ID,
    serialNumber: SERIALS.second,
    measuredAt: "20261117103041",
  },
  // §4.1.9: no patient ID entered, in neither PID-3 nor PV1-19 (#163, "it is missing").
  "hba1c-no-patient-id.hl7": {
    ...RECEIVER,
    processingId: "P",
    controlId: 1006,
    messageTime: "20261117104452",
    patientId: null,
    runNumber: 7,
    assay: "HbA1c",
    values: { HbA1c: { kind: "number", value: "6.4" } },
    reagentLot: "99005678",
    operatorId: null,
    serialNumber: SERIALS.second,
    measuredAt: "20261117104220",
  },
  // §4.1.3: three analytes, two below the measuring range with `<` (§3.8).
  "acr-below-range.hl7": {
    ...RECEIVER,
    processingId: "P",
    controlId: 1007,
    messageTime: "20261118110230",
    patientId: { field: "PID-3", value: LAB_NUMBERS.acrLow },
    runNumber: 8,
    assay: "ACR",
    values: {
      ACR: { kind: "outside-range", comparator: "<", limit: "5.6" },
      Alb: { kind: "outside-range", comparator: "<", limit: "5.0" },
      Creat: { kind: "number", value: "41.2" },
    },
    reagentLot: "99003456",
    operatorId: OPERATOR_ID,
    serialNumber: SERIALS.first,
    measuredAt: "20261118105948",
  },
  // §4.1.4: the ratio cannot be calculated, `--- ` in OBX-5 (§3.8).
  "acr-no-value.hl7": {
    ...RECEIVER,
    processingId: "P",
    controlId: 1008,
    messageTime: "20261118111515",
    patientId: { field: "PID-3", value: LAB_NUMBERS.acrNoValue },
    runNumber: 9,
    assay: "ACR",
    values: {
      ACR: { kind: "no-value" },
      Alb: { kind: "outside-range", comparator: "<", limit: "5.0" },
      Creat: { kind: "outside-range", comparator: "<", limit: "16.4" },
    },
    reagentLot: "99003456",
    operatorId: OPERATOR_ID,
    serialNumber: SERIALS.first,
    measuredAt: "20261118111237",
  },
  // §4.1.5: six analytes of the lipid panel; the Chol/HDL ratio has no unit.
  "lipid-panel.hl7": {
    ...RECEIVER,
    processingId: "P",
    controlId: 1009,
    messageTime: "20261118130842",
    patientId: { field: "PID-3", value: LAB_NUMBERS.lipid },
    runNumber: 10,
    assay: "Lipid Panel",
    values: {
      Chol: { kind: "number", value: "4.85" },
      LDL: { kind: "number", value: "2.91" },
      HDL: { kind: "number", value: "1.22" },
      Trig: { kind: "number", value: "1.57" },
      "non-HDL": { kind: "number", value: "3.63" },
      "Chol/HDL": { kind: "number", value: "4.0" },
    },
    reagentLot: "99007890",
    operatorId: OPERATOR_ID,
    serialNumber: SERIALS.first,
    measuredAt: "20261118130610",
  },
} as const satisfies Readonly<Record<string, AfinionOruInput>>;

/** The ACK fixtures by file name: the two codes the analyser accepts (§3.4). */
export const ACK_FIXTURES = {
  "ack-aa.hl7": {
    code: "AA",
    acknowledgedControlId: "1000",
    controlId: "50001",
    messageTime: "20261116091513",
    sendingApplication: "FERROBRIDGE",
  },
  "ack-ca.hl7": {
    code: "CA",
    acknowledgedControlId: "1000",
    controlId: "50002",
    messageTime: "20261116091513",
    sendingApplication: "FERROBRIDGE",
  },
} as const satisfies Readonly<Record<string, AckInput>>;

/** Returns the text of every fixture by file name, built from its input. */
export function buildAllFixtures(): ReadonlyMap<string, string> {
  return new Map([
    ...Object.entries(ORU_FIXTURES).map(([name, input]) => [name, buildAfinionOru(input)] as const),
    ...Object.entries(ACK_FIXTURES).map(([name, input]) => [name, buildAck(input)] as const),
  ]);
}
