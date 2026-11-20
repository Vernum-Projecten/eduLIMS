// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One released result as a COMPOSITION of the operational template `eduLIMS-lab.v1`, in the
// canonical JSON of ITS-REST 1.1.0 (`Resources.md`, "JSON Format"). The paths are those of the
// CKM archetypes the template pins (docs/architecture.md, "Template `eduLIMS-lab`"). It carries
// the fictional patient's result and nothing about a student or a teacher (Q-PRIV-1), and no
// correct value, tolerance or accuracy status (Q-SIM-1).
import "@tanstack/react-start/server-only";
import { parseDecimal } from "../../lib/decimal.ts";
import type { RequestId } from "../../lib/lab-records.ts";
import type { MeasurementId } from "../../lib/results.ts";
import type { EhrId } from "../lab-records/patient-ehr.ts";
import type { JsonObject, JsonValue } from "./json.ts";

/** The template every composition eduLIMS writes is of. */
export const LAB_RESULT_TEMPLATE_ID = "eduLIMS-lab.v1";

/** The issuer of an analyser's identifier: its serial number in the analyser register (#146). */
export const ANALYSER_ID_ISSUER = "https://edulims.eu/id/analyser";

/**
 * The device a measurement came from. An analyser is named by the serial number of the analyser
 * register (B3), `null` while eduLIMS does not know which analyser measured.
 */
export type ResultDevice =
  | { kind: "afinion_2"; serialNumber: string | null }
  | { kind: "epoch_2"; serialNumber: string | null }
  | { kind: "manual" };

/** What the release writes to the patient's record for one released measurement (S15). */
export interface FinalLabResult {
  /** The patient's EHR; only a resolved EHR yields an `EhrId` (#364). */
  ehrId: EhrId;
  /** The released measurement; the write is idempotent on it. */
  measurementId: MeasurementId;
  /** The request, eduLIMS's own order identifier (maintainer, 2026-11-20 on #148). */
  requestId: RequestId;
  /**
   * The requester as typed from the paper form (fictional), or `null`. It stays in eduLIMS and is
   * not written: the request id names the request (maintainer, 2026-11-20 on #148).
   */
  requester: string | null;
  sample: {
    /** The lab number eduLIMS gave the sample (S12), unique across the teams. */
    labNumber: string;
    /** The sample number printed on the request form. */
    sampleNumber: string;
    material: string;
  };
  test: {
    name: string;
    /** The analyte name: the catalogue's Afinion 2 analyte, or the test name. */
    analyte: string;
    /** The unit, or `null` for a dimensionless result (maintainer, 2026-11-19 on #266). */
    unit: string | null;
  };
  /** The released value as a canonical decimal, as stored. */
  value: string;
  /** When the measurement was recorded, from the database clock (ISO 8601). */
  measuredAt: string;
  device: ResultDevice;
  /** The time of release, from the database clock (ISO 8601). */
  releasedAt: string;
}

/** The deployment's settings a composition needs. */
export interface LabResultSettings {
  /** The facility of the system client's `facilities` in FerroEHR (#146). */
  facility: { issuer: string; id: string };
  /** The ISO 3166-1 alpha-2 code of the territory the composition is written in. */
  territory: string;
}

/** Why a result cannot be built into a composition the template and FerroEHR accept. */
export type LabResultBuildError = "no_device_identifier" | "value_invalid";

/** The outcome of {@link buildFinalLabResult}. */
export type LabResultBuild =
  | { ok: true; composition: JsonObject }
  | { ok: false; error: LabResultBuildError };

const ARCHETYPES = {
  composition: "openEHR-EHR-COMPOSITION.report-result.v1",
  observation: "openEHR-EHR-OBSERVATION.laboratory_test_result.v1",
  specimen: "openEHR-EHR-CLUSTER.specimen.v1",
  analyte: "openEHR-EHR-CLUSTER.laboratory_test_analyte.v1",
  device: "openEHR-EHR-CLUSTER.device.v1",
} as const;

const DEVICE_NAMES = { afinion_2: "Afinion 2", epoch_2: "Epoch 2" } as const;

/**
 * The fixed device identity of a result entered by hand: no person, and an identifier under the
 * analyser issuer, so FerroEHR admits it as a device act (maintainer, 2026-11-20 on #148).
 */
export const MANUAL_ENTRY_DEVICE = { name: "eduLIMS manual entry", id: "manual" } as const;

/** The device a composition names: its name, its identifier and, for an analyser, its serial. */
interface DeviceIdentity {
  name: string;
  id: string;
  serial: string | null;
}

/** Returns the identity of `device`, or `null` for an analyser whose serial number is unknown. */
function deviceIdentity(device: ResultDevice): DeviceIdentity | null {
  if (device.kind === "manual") return { ...MANUAL_ENTRY_DEVICE, serial: null };
  if (device.serialNumber === null) return null;
  return { name: DEVICE_NAMES[device.kind], id: device.serialNumber, serial: device.serialNumber };
}

const text = (value: string): JsonObject => ({ _type: "DV_TEXT", value });
const dateTime = (value: string): JsonObject => ({ _type: "DV_DATE_TIME", value });
const code = (terminology: string, codeString: string): JsonObject => ({
  _type: "CODE_PHRASE",
  terminology_id: { _type: "TERMINOLOGY_ID", value: terminology },
  code_string: codeString,
});
const coded = (value: string, terminology: string, codeString: string): JsonObject => ({
  _type: "DV_CODED_TEXT",
  value,
  defining_code: code(terminology, codeString),
});
const identifier = (id: string, issuer?: string): JsonObject => ({
  _type: "DV_IDENTIFIER",
  ...(issuer === undefined ? {} : { issuer }),
  id,
});
const element = (nodeId: string, name: string, value: JsonValue): JsonObject => ({
  _type: "ELEMENT",
  archetype_node_id: nodeId,
  name: text(name),
  value,
});
const archetyped = (archetypeId: string, templateId?: string): JsonObject => ({
  _type: "ARCHETYPED",
  archetype_id: { _type: "ARCHETYPE_ID", value: archetypeId },
  ...(templateId === undefined ? {} : { template_id: { _type: "TEMPLATE_ID", value: templateId } }),
  rm_version: "1.1.0",
});
const cluster = (archetypeId: string, name: string, items: JsonObject[]): JsonObject => ({
  _type: "CLUSTER",
  archetype_node_id: archetypeId,
  name: text(name),
  archetype_details: archetyped(archetypeId),
  items,
});

/**
 * Returns the magnitude, the precision and the units of a released value as a `DV_QUANTITY`
 * (RM data types 1.1.0), or `null` when it is not a canonical decimal.
 */
export function quantityOf(value: string, unit: string | null): JsonObject | null {
  const canonical = parseDecimal(value);
  if (canonical === null || canonical !== value) return null;
  const fraction = canonical.split(".")[1] ?? "";
  return {
    _type: "DV_QUANTITY",
    // NOTE: RM data types 1.1.0, DV_QUANTITY.magnitude is a Real; 15 significant digits (9 + 6,
    // src/lib/decimal.ts) round-trip through a double, and `precision` keeps the typed places.
    magnitude: Number(canonical),
    // NOTE: RM DV_QUANTITY.units is mandatory and UCUM; UCUM's unity "1" names a dimensionless
    // result, a test without a unit (maintainer, 2026-11-19 on #266). Our own reading.
    units: unit ?? "1",
    precision: fraction.length,
  };
}

/**
 * Builds the COMPOSITION of one released result: status Final (`at0018`), the device as the
 * composer and in the device cluster (the analyser, or {@link MANUAL_ENTRY_DEVICE} for a result
 * entered by hand), the lab's facility in the context.
 *
 * `no_device_identifier` when an analyser's serial number is unknown: FerroEHR accepts a system
 * client's composition only as a device act whose composer names the device (FerroEHR book
 * v5.7.0, `identity-providers.md`, "Who the caller is"). `value_invalid` for a value that is not
 * a canonical decimal.
 */
export function buildFinalLabResult(
  result: FinalLabResult,
  settings: LabResultSettings,
): LabResultBuild {
  const device = deviceIdentity(result.device);
  if (device === null) return { ok: false, error: "no_device_identifier" };
  const quantity = quantityOf(result.value, result.test.unit);
  if (quantity === null) return { ok: false, error: "value_invalid" };
  const deviceId = identifier(device.id, ANALYSER_ID_ISSUER);
  return {
    ok: true,
    composition: {
      _type: "COMPOSITION",
      archetype_node_id: ARCHETYPES.composition,
      name: text("Result report"),
      archetype_details: archetyped(ARCHETYPES.composition, LAB_RESULT_TEMPLATE_ID),
      // NOTE: the template's language is `en` (eduLIMS-lab.v1.opt, `language`).
      language: code("ISO_639-1", "en"),
      territory: code("ISO_3166-1", settings.territory),
      category: coded("event", "openehr", "433"),
      // NOTE: #146, #148; a device act names the device in `composer`, with the identifier that
      // is also `feeder_audit.originating_system_audit.system_id` (FerroEHR book v5.7.0).
      composer: { _type: "PARTY_IDENTIFIED", name: device.name, identifiers: [deviceId] },
      feeder_audit: {
        _type: "FEEDER_AUDIT",
        originating_system_audit: { _type: "FEEDER_AUDIT_DETAILS", system_id: device.id },
      },
      context: {
        _type: "EVENT_CONTEXT",
        start_time: dateTime(result.releasedAt),
        setting: coded("other care", "openehr", "238"),
        health_care_facility: {
          _type: "PARTY_IDENTIFIED",
          identifiers: [identifier(settings.facility.id, settings.facility.issuer)],
        },
      },
      content: [observation(result, quantity, device, deviceId)],
    },
  };
}

function observation(
  result: FinalLabResult,
  quantity: JsonObject,
  device: DeviceIdentity,
  deviceId: JsonObject,
): JsonObject {
  return {
    _type: "OBSERVATION",
    archetype_node_id: ARCHETYPES.observation,
    name: text("Laboratory test result"),
    archetype_details: archetyped(ARCHETYPES.observation),
    language: code("ISO_639-1", "en"),
    encoding: code("IANA_character-sets", "UTF-8"),
    subject: { _type: "PARTY_SELF" },
    data: {
      _type: "HISTORY",
      archetype_node_id: "at0001",
      name: text("Event Series"),
      origin: dateTime(result.measuredAt),
      events: [
        {
          _type: "POINT_EVENT",
          archetype_node_id: "at0002",
          name: text("Any event"),
          time: dateTime(result.measuredAt),
          data: {
            _type: "ITEM_TREE",
            archetype_node_id: "at0003",
            name: text("Tree"),
            items: [
              element("at0005", "Test name", text(result.test.name)),
              specimen(result.sample),
              analyte(result, quantity),
            ],
          },
        },
      ],
    },
    protocol: {
      _type: "ITEM_TREE",
      archetype_node_id: "at0004",
      name: text("Tree"),
      items: [
        // NOTE: maintainer, 2026-11-20 on #148; the request id names the request, and the
        // requester as typed stays in eduLIMS (the template closes the Requester slot, at0090).
        {
          _type: "CLUSTER",
          archetype_node_id: "at0094",
          name: text("Test request details"),
          items: [element("at0062", "Requester order identifier", identifier(result.requestId))],
        },
        cluster(ARCHETYPES.device, "Medical device", [
          element("at0001", "Device name", text(device.name)),
          ...(device.serial === null
            ? []
            : [element("at0020", "Serial number", text(device.serial))]),
          element("at0024", "Other identifier", deviceId),
        ]),
      ],
    },
  };
}

function specimen(sample: FinalLabResult["sample"]): JsonObject {
  // NOTE: CKM specimen.v1 1.1.3; at0001 is "normally assigned by the laboratory" (the lab
  // number, S12), at0088 "assigned by a party external to the laboratory" (the form's number).
  return cluster(ARCHETYPES.specimen, "Specimen", [
    element("at0029", "Specimen type", text(sample.material)),
    element("at0001", "Laboratory specimen identifier", identifier(sample.labNumber)),
    element("at0088", "External identifier", identifier(sample.sampleNumber)),
  ]);
}

function analyte(result: FinalLabResult, quantity: JsonObject): JsonObject {
  return cluster(ARCHETYPES.analyte, "Laboratory analyte result", [
    element("at0024", "Analyte name", text(result.test.analyte)),
    element("at0001", "Analyte result", quantity),
    element("at0031", "Analysis performed time", dateTime(result.measuredAt)),
    // NOTE: CKM laboratory_test_analyte.v1 1.2.3, Result status: local at0018 "Final"; a
    // released result is final (S15).
    element("at0005", "Result status", coded("Final", "local", "at0018")),
    element("at0006", "Result status time", dateTime(result.releasedAt)),
  ]);
}
