// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The writer of a released result with the FerroEHR client mocked (#148, S15, reliability.md
// "Idempotent writes"): every attempt for one measurement sends the same contribution uid, and a
// retry after a commit or after a timeout finds the one composition instead of making a second.
import { describe, expect, it, vi } from "vitest";
import { parseRequestId } from "../../lib/lab-records.ts";
import { parseMeasurementId } from "../../lib/results.ts";
import type { EhrId } from "../lab-records/patient-ehr.ts";
import { finalResultContributionUid } from "./contribution.ts";
import { failure, type OpenEhrResult, success } from "./errors.ts";
import type { FinalLabResult } from "./lab-result.ts";
import {
  type LabResultClient,
  type LabResultWriteSettings,
  writeFinalLabResult,
} from "./lab-result-writer.ts";
import type { Contribution } from "./schemas.ts";

const EHR_ID = "01a1f79f-e2d0-77ea-8eac-fe74ff33c1a2";
const VERSION = "01a1f79f-e2e6-713c-878c-1f1b2f8278c6::ferroehr.local::1";
const SETTINGS: LabResultWriteSettings = {
  facility: { issuer: "urn:example:edulims-test-facility", id: "test-lab" },
  territory: "NL",
  committerName: "edulims-ferroehr",
};

function result(overrides: Partial<FinalLabResult> = {}): FinalLabResult {
  const measurementId = parseMeasurementId("0190f1c2-0000-7000-8000-0000000000c1");
  const requestId = parseRequestId("0190f1c2-0000-7000-8000-0000000000c2");
  if (measurementId === null || requestId === null) throw new Error("bad test ids");
  return {
    // A test-only EHR id; only ensurePatientEhr yields one in the server.
    ehrId: EHR_ID as EhrId,
    measurementId,
    requestId,
    requester: null,
    sample: { labNumber: "1234567890", sampleNumber: "S-001", material: "whole blood" },
    test: { name: "CRP (invented)", analyte: "CRP", unit: "mg/L" },
    value: "12",
    measuredAt: "2026-11-20T09:15:00.000Z",
    device: { kind: "afinion_2", serialNumber: "AF2-TEST-0001" },
    releasedAt: "2026-11-20T09:20:00.000Z",
    ...overrides,
  };
}

const UID = finalResultContributionUid(result().measurementId);

function contribution(uid = UID, versions = [VERSION]): Contribution {
  return { uid: { value: uid }, versions: versions.map((value) => ({ id: { value } })) };
}

/** A FerroEHR in memory that keeps one contribution per uid, as `contribution_create.yaml` asks. */
function memoryFerroEhr() {
  const stored = new Map<string, Contribution>();
  const client = {
    createContribution: vi.fn<LabResultClient["createContribution"]>(async (_, body) => {
      if (stored.has(body.uid.value)) return success({ outcome: "conflict" as const });
      const kept = contribution(body.uid.value);
      stored.set(body.uid.value, kept);
      return success({ outcome: "created" as const, contribution: kept });
    }),
    getContribution: vi.fn<LabResultClient["getContribution"]>(async (_, uid) =>
      success(stored.get(uid) ?? null),
    ),
  };
  return { client, stored };
}

const timeout = <T>(): OpenEhrResult<T> =>
  failure({ kind: "timeout", target: "ferroehr", cause: new DOMException("t", "TimeoutError") });

describe("writeFinalLabResult (ITS-REST 1.1.0, Create CONTRIBUTION with a supplied uid)", () => {
  it("commits the composition in a contribution under the measurement's uid", async () => {
    const { client } = memoryFerroEhr();
    expect(await writeFinalLabResult(client, result(), SETTINGS)).toEqual({
      outcome: "written",
      versionUid: VERSION,
      committed: "now",
      contributionUid: UID,
    });
    const [ehrId, body] = client.createContribution.mock.calls[0] ?? [];
    expect(ehrId).toBe(EHR_ID);
    expect(body?.uid.value).toBe(UID);
    expect(body?.versions[0]?.data["_type"]).toBe("COMPOSITION");
    expect(body?.audit.committer).toEqual({ _type: "PARTY_IDENTIFIED", name: "edulims-ferroehr" });
  });

  it("finds the first write on a retry after it committed: one composition, the same version", async () => {
    const { client, stored } = memoryFerroEhr();
    await writeFinalLabResult(client, result(), SETTINGS);
    expect(await writeFinalLabResult(client, result(), SETTINGS)).toEqual({
      outcome: "written",
      versionUid: VERSION,
      committed: "before",
      contributionUid: UID,
    });
    expect(stored.size).toBe(1);
    expect(client.getContribution).toHaveBeenCalledWith(EHR_ID, UID);
  });

  it("finds the write on a retry after a timeout whose commit landed: still one composition", async () => {
    const { client, stored } = memoryFerroEhr();
    const commitThenTimeout: LabResultClient["createContribution"] = async (_, body) => {
      stored.set(body.uid.value, contribution(body.uid.value));
      return timeout();
    };
    client.createContribution.mockImplementationOnce(commitThenTimeout);
    const first = await writeFinalLabResult(client, result(), SETTINGS);
    expect(first).toMatchObject({ outcome: "failed", error: { kind: "openehr" } });
    const second = await writeFinalLabResult(client, result(), SETTINGS);
    expect(second).toMatchObject({ outcome: "written", committed: "before", versionUid: VERSION });
    expect(stored.size).toBe(1);
  });

  it("commits on a retry after a timeout whose commit never landed", async () => {
    const { client, stored } = memoryFerroEhr();
    client.createContribution.mockImplementationOnce(async () => timeout());
    await writeFinalLabResult(client, result(), SETTINGS);
    expect(await writeFinalLabResult(client, result(), SETTINGS)).toMatchObject({
      outcome: "written",
      committed: "now",
    });
    expect(stored.size).toBe(1);
  });

  it("gives a second measurement of the same requested test its own composition (S14)", async () => {
    const { client, stored } = memoryFerroEhr();
    const other = parseMeasurementId("0190f1c2-0000-7000-8000-0000000000c3");
    if (other === null) throw new Error("bad test id");
    await writeFinalLabResult(client, result(), SETTINGS);
    await writeFinalLabResult(client, result({ measurementId: other }), SETTINGS);
    expect(stored.size).toBe(2);
  });

  it("reports a 409 whose uid the EHR does not hold as a conflict it cannot resolve", async () => {
    const client = {
      createContribution: vi.fn<LabResultClient["createContribution"]>(async () =>
        success({ outcome: "conflict" as const }),
      ),
      getContribution: vi.fn<LabResultClient["getContribution"]>(async () => success(null)),
    };
    expect(await writeFinalLabResult(client, result(), SETTINGS)).toEqual({
      outcome: "failed",
      error: { kind: "uid_conflict" },
      contributionUid: UID,
    });
  });

  it("reports a failed read-back after a 409 as a FerroEHR failure", async () => {
    const { client } = memoryFerroEhr();
    await writeFinalLabResult(client, result(), SETTINGS);
    client.getContribution.mockImplementationOnce(async () => timeout());
    expect(await writeFinalLabResult(client, result(), SETTINGS)).toMatchObject({
      outcome: "failed",
      error: { kind: "openehr", error: { kind: "timeout" } },
    });
  });

  it("refuses a contribution FerroEHR returns under another uid or with two versions", async () => {
    for (const answer of [
      contribution("0b241ba5-f50e-4087-bd35-6eea1e04e11c"),
      contribution(UID, [VERSION, VERSION]),
    ]) {
      const client = {
        createContribution: vi.fn<LabResultClient["createContribution"]>(async () =>
          success({ outcome: "created" as const, contribution: answer }),
        ),
        getContribution: vi.fn<LabResultClient["getContribution"]>(),
      };
      expect(await writeFinalLabResult(client, result(), SETTINGS)).toMatchObject({
        outcome: "failed",
        error: { kind: "foreign_contribution" },
      });
    }
  });

  it("reports a refusal of FerroEHR, such as a 422, with its code", async () => {
    const client = {
      createContribution: vi.fn<LabResultClient["createContribution"]>(async () =>
        failure({ kind: "refused", target: "ferroehr", status: 422, code: "validation-failed" }),
      ),
      getContribution: vi.fn<LabResultClient["getContribution"]>(),
    };
    expect(await writeFinalLabResult(client, result(), SETTINGS)).toMatchObject({
      outcome: "failed",
      error: { kind: "openehr", error: { status: 422, code: "validation-failed" } },
    });
    expect(client.getContribution).not.toHaveBeenCalled();
  });

  it("calls FerroEHR not at all for a result it cannot build", async () => {
    const { client } = memoryFerroEhr();
    expect(
      await writeFinalLabResult(client, result({ device: { kind: "manual" } }), SETTINGS),
    ).toEqual({
      outcome: "failed",
      error: { kind: "build", reason: "no_device_identifier" },
      contributionUid: UID,
    });
    expect(client.createContribution).not.toHaveBeenCalled();
  });
});
