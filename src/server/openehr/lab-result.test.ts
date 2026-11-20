// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The composition of a released result against the operational template `eduLIMS-lab.v1` (#148,
// Q-COMP-1, Q-TRACE-1, Q-PRIV-1, Q-SIM-1): every node the builder writes is a node of the OPT
// with an allowed type, every required node under a written one is there, and the content carries
// the result, Final, and nothing about a student or the teacher's simulation. Values are invented.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRequestId } from "../../lib/lab-records.ts";
import { parseMeasurementId } from "../../lib/results.ts";
import type { EhrId } from "../lab-records/patient-ehr.ts";
import type { JsonObject } from "./json.ts";
import {
  ANALYSER_ID_ISSUER,
  buildFinalLabResult,
  type FinalLabResult,
  LAB_RESULT_TEMPLATE_ID,
  type LabResultSettings,
  MANUAL_ENTRY_DEVICE,
  quantityOf,
} from "./lab-result.ts";
import { compositionNodes, optNodes } from "./test-opt.ts";

const OPT = readFileSync(
  new URL("../../../docker/ferroehr/definitions/eduLIMS-lab.v1.opt", import.meta.url),
  "utf8",
);
const TEMPLATE = optNodes(OPT);

const SETTINGS: LabResultSettings = {
  facility: { issuer: "urn:example:edulims-test-facility", id: "test-lab" },
  territory: "NL",
};

function ids() {
  const measurementId = parseMeasurementId("0190f1c2-0000-7000-8000-0000000000b1");
  const requestId = parseRequestId("0190f1c2-0000-7000-8000-0000000000b2");
  if (measurementId === null || requestId === null) throw new Error("bad test ids");
  return { measurementId, requestId };
}

function result(overrides: Partial<FinalLabResult> = {}): FinalLabResult {
  return {
    // A test-only EHR id; only ensurePatientEhr yields one in the server.
    ehrId: "01a1f79f-e2d0-77ea-8eac-fe74ff33c1a2" as EhrId,
    ...ids(),
    requester: "Invented GP practice",
    sample: { labNumber: "1234567890", sampleNumber: "S-001", material: "whole blood" },
    test: { name: "HbA1c (invented)", analyte: "HbA1c", unit: "mmol/mol" },
    value: "48.50",
    measuredAt: "2026-11-20T09:15:00.000Z",
    device: { kind: "afinion_2", serialNumber: "AF2-TEST-0001" },
    releasedAt: "2026-11-20T09:20:00.000Z",
    ...overrides,
  };
}

function composition(overrides: Partial<FinalLabResult> = {}): JsonObject {
  const built = buildFinalLabResult(result(overrides), SETTINGS);
  if (!built.ok) throw new Error(built.error);
  return built.composition;
}

/** Returns the value at `path` of a JSON document, following object keys and array indexes. */
function at(document: unknown, ...path: (string | number)[]): unknown {
  let current = document;
  for (const step of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[step];
  }
  return current;
}

/** Returns the `value` of the ELEMENT at `path` of the built composition. */
function elementValue(built: JsonObject, path: string): unknown {
  const visit = (node: unknown, prefix: string): unknown => {
    if (typeof node !== "object" || node === null) return undefined;
    for (const [attr, child] of Object.entries(node)) {
      for (const item of Array.isArray(child) ? child : [child]) {
        if (typeof item !== "object" || item === null || !("archetype_node_id" in item)) continue;
        const next = `${prefix}/${attr}[${String(item.archetype_node_id)}]`;
        if (next === path) return "value" in item ? item.value : undefined;
        const found = visit(item, next);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  return visit(built, "");
}

const OBS = "/content[openEHR-EHR-OBSERVATION.laboratory_test_result.v1]";
const TREE = `${OBS}/data[at0001]/events[at0002]/data[at0003]`;
const SPECIMEN = `${TREE}/items[openEHR-EHR-CLUSTER.specimen.v1]`;
const ANALYTE = `${TREE}/items[openEHR-EHR-CLUSTER.laboratory_test_analyte.v1]`;
const PROTOCOL = `${OBS}/protocol[at0004]`;
const DEVICE = `${PROTOCOL}/items[openEHR-EHR-CLUSTER.device.v1]`;

describe("the OPT reader of the tests", () => {
  it("finds the template's nodes, their types and the required ones", () => {
    expect(TEMPLATE.get(`${ANALYTE}/items[at0005]`)?.valueTypes).toEqual(
      new Set(["DV_CODED_TEXT"]),
    );
    expect(TEMPLATE.get(`${SPECIMEN}/items[at0001]`)?.lower).toBe(1);
    expect(TEMPLATE.get(`${SPECIMEN}/items[at0029]`)?.lower).toBe(0);
    expect(TEMPLATE.get(OBS)?.rmTypes).toEqual(new Set(["OBSERVATION"]));
  });
});

describe("buildFinalLabResult against eduLIMS-lab.v1 (Q-COMP-1)", () => {
  const built = composition();
  const written = compositionNodes(built as Record<string, unknown>);

  it.each(written.map((node) => [node.path || "(root)", node] as const))(
    "%s is a node of the template, of an allowed type",
    (_, node) => {
      const allowed = TEMPLATE.get(node.path);
      expect(allowed, node.path).toBeDefined();
      // NOTE: RM EHR IM, POINT_EVENT is an EVENT; the OPT constrains the abstract EVENT.
      const type = node.type === "POINT_EVENT" ? "EVENT" : node.type;
      expect(allowed?.rmTypes.has(type) || allowed?.rmTypes.has(node.type)).toBe(true);
      if (node.valueType !== undefined) {
        expect(allowed?.valueTypes.has(node.valueType), node.path).toBe(true);
      }
    },
  );

  /** Returns the required template nodes missing under the nodes `nodes` writes. */
  const missingUnder = (nodes: readonly { path: string }[]) => {
    const paths = new Set(nodes.map((node) => node.path));
    return [...TEMPLATE.entries()]
      .filter(([path, node]) => node.lower >= 1 && path !== "")
      .filter(([path]) => paths.has(path.slice(0, path.lastIndexOf("/"))))
      .map(([path]) => path)
      .filter((path) => !paths.has(path));
  };

  it("writes every required node under every node it writes", () => {
    expect(missingUnder(written)).toEqual([]);
  });

  it("would see a required node left out (the check is not vacuous)", () => {
    const without = written.filter((node) => node.path !== `${SPECIMEN}/items[at0001]`);
    expect(missingUnder(without)).toEqual([`${SPECIMEN}/items[at0001]`]);
  });

  it("names the template and the root archetype", () => {
    expect(at(built, "archetype_details", "template_id", "value")).toBe(LAB_RESULT_TEMPLATE_ID);
    expect(built["archetype_node_id"]).toBe("openEHR-EHR-COMPOSITION.report-result.v1");
  });
});

describe("the content of a released result (S15, Q-TRACE-1)", () => {
  const built = composition();

  it("has the status Final (local at0018) at the time of release", () => {
    expect(elementValue(built, `${ANALYTE}/items[at0005]`)).toEqual({
      _type: "DV_CODED_TEXT",
      value: "Final",
      defining_code: {
        _type: "CODE_PHRASE",
        terminology_id: { _type: "TERMINOLOGY_ID", value: "local" },
        code_string: "at0018",
      },
    });
    expect(elementValue(built, `${ANALYTE}/items[at0006]`)).toEqual({
      _type: "DV_DATE_TIME",
      value: "2026-11-20T09:20:00.000Z",
    });
  });

  it("carries the value with its unit and its typed decimal places", () => {
    expect(elementValue(built, `${ANALYTE}/items[at0001]`)).toEqual({
      _type: "DV_QUANTITY",
      magnitude: 48.5,
      units: "mmol/mol",
      precision: 2,
    });
    expect(elementValue(built, `${ANALYTE}/items[at0024]`)).toEqual({
      _type: "DV_TEXT",
      value: "HbA1c",
    });
  });

  it("puts the lab number in the laboratory's identifier, the form's number beside it, and the material", () => {
    expect(at(elementValue(built, `${SPECIMEN}/items[at0001]`), "id")).toBe("1234567890");
    expect(at(elementValue(built, `${SPECIMEN}/items[at0088]`), "id")).toBe("S-001");
    expect(at(elementValue(built, `${SPECIMEN}/items[at0029]`), "value")).toBe("whole blood");
  });

  it("names the request as the requester order identifier (maintainer, 2026-11-20)", () => {
    const order = `${PROTOCOL}/items[at0094]/items[at0062]`;
    expect(at(elementValue(built, order), "id")).toBe(ids().requestId);
  });

  it("names the analyser in the device cluster and as the composer of a device act", () => {
    const deviceId = { _type: "DV_IDENTIFIER", issuer: ANALYSER_ID_ISSUER, id: "AF2-TEST-0001" };
    expect(at(elementValue(built, `${DEVICE}/items[at0001]`), "value")).toBe("Afinion 2");
    expect(at(elementValue(built, `${DEVICE}/items[at0020]`), "value")).toBe("AF2-TEST-0001");
    expect(elementValue(built, `${DEVICE}/items[at0024]`)).toEqual(deviceId);
    expect(built["composer"]).toEqual({
      _type: "PARTY_IDENTIFIED",
      name: "Afinion 2",
      identifiers: [deviceId],
    });
    expect(at(built, "feeder_audit", "originating_system_audit", "system_id")).toBe(
      "AF2-TEST-0001",
    );
  });

  it("names the Epoch 2 as the device of an Epoch result", () => {
    const epoch = composition({ device: { kind: "epoch_2", serialNumber: "EP2-TEST-0001" } });
    expect(at(elementValue(epoch, `${DEVICE}/items[at0001]`), "value")).toBe("Epoch 2");
  });

  it("names the configured facility and territory", () => {
    expect(at(built, "context", "health_care_facility", "identifiers", 0)).toEqual({
      _type: "DV_IDENTIFIER",
      issuer: "urn:example:edulims-test-facility",
      id: "test-lab",
    });
    expect(at(built, "territory", "code_string")).toBe("NL");
  });

  it("times the event at the measurement", () => {
    expect(at(built, "content", 0, "data", "events", 0, "time", "value")).toBe(
      "2026-11-20T09:15:00.000Z",
    );
  });
});

describe("a result entered by hand (maintainer, 2026-11-20 on #148)", () => {
  const manual = composition({ device: { kind: "manual" } });
  const manualId = { _type: "DV_IDENTIFIER", issuer: ANALYSER_ID_ISSUER, id: "manual" };

  it("names the fixed device identity as the composer, with no person", () => {
    expect(MANUAL_ENTRY_DEVICE).toEqual({ name: "eduLIMS manual entry", id: "manual" });
    expect(manual["composer"]).toEqual({
      _type: "PARTY_IDENTIFIED",
      name: "eduLIMS manual entry",
      identifiers: [manualId],
    });
    expect(at(manual, "feeder_audit", "originating_system_audit", "system_id")).toBe("manual");
  });

  it("names it in the device cluster, with no serial number", () => {
    expect(at(elementValue(manual, `${DEVICE}/items[at0001]`), "value")).toBe(
      "eduLIMS manual entry",
    );
    expect(elementValue(manual, `${DEVICE}/items[at0024]`)).toEqual(manualId);
    expect(elementValue(manual, `${DEVICE}/items[at0020]`)).toBeUndefined();
  });

  it.each(
    compositionNodes(manual as Record<string, unknown>).map(
      (node) => [node.path || "(root)", node] as const,
    ),
  )("%s is a node of the template", (_, node) => {
    expect(TEMPLATE.get(node.path), node.path).toBeDefined();
  });
});

describe("the requester as typed (maintainer, 2026-11-20 on #148)", () => {
  it("stays in eduLIMS: the composition names the request by its id only", () => {
    const text = JSON.stringify(composition({ requester: "Invented GP practice" }));
    expect(text).not.toContain("Invented GP practice");
    expect(text).toContain(ids().requestId);
  });
});

describe("what a composition never carries (Q-PRIV-1, Q-SIM-1)", () => {
  it("holds no student, no tolerance, no correct value and no accuracy status", () => {
    const text = JSON.stringify(composition());
    for (const word of ["student", "teacher", "@", "tolerance", "correct", "accuracy"]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });
});

describe("refusals of the builder", () => {
  it("refuses an analyser result without its serial number", () => {
    const device = { kind: "afinion_2", serialNumber: null } as const;
    expect(buildFinalLabResult(result({ device }), SETTINGS)).toEqual({
      ok: false,
      error: "no_device_identifier",
    });
  });

  it.each(["4,5", "1e3", "abc", "", " 5.0", "1234567890"])("refuses the value %j", (value) => {
    expect(buildFinalLabResult(result({ value }), SETTINGS)).toEqual({
      ok: false,
      error: "value_invalid",
    });
  });
});

describe("quantityOf (RM DV_QUANTITY)", () => {
  it("gives a result without a unit the UCUM unity 1 (#266)", () => {
    expect(quantityOf("3.2", null)).toMatchObject({ units: "1", magnitude: 3.2, precision: 1 });
  });

  it("keeps an integer at precision 0 and a negative value", () => {
    expect(quantityOf("-7", "mg/L")).toMatchObject({ magnitude: -7, precision: 0 });
  });

  it("keeps the most digits a value may have exactly", () => {
    expect(quantityOf("999999999.999999", "U")).toMatchObject({
      magnitude: 999999999.999999,
      precision: 6,
    });
  });
});
