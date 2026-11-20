// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Writes one released result to the patient's EHR as a composition, idempotently on the released
// measurement (S15, #148, reliability.md "Idempotent writes"). ITS-REST 1.1.0 gives a composition
// create no idempotency, so eduLIMS commits the composition in a CONTRIBUTION whose `uid` it
// derives from the measurement: a retry carries the same `uid`, FerroEHR answers `409`
// (`contribution_create.yaml`), and eduLIMS reads that contribution back to learn the version it
// wrote. It logs nothing; the caller logs ids.
import "@tanstack/react-start/server-only";
import type { OpenEhrClient } from "./client.ts";
import { creationContribution, finalResultContributionUid } from "./contribution.ts";
import type { OpenEhrError } from "./errors.ts";
import {
  buildFinalLabResult,
  type FinalLabResult,
  type LabResultBuildError,
  type LabResultSettings,
} from "./lab-result.ts";
import type { Contribution } from "./schemas.ts";

/** The FerroEHR operations the writer needs. */
export type LabResultClient = Pick<OpenEhrClient, "createContribution" | "getContribution">;

/** The settings of a write: those of the composition, and the client's name as committer. */
export interface LabResultWriteSettings extends LabResultSettings {
  /** The client id eduLIMS signs in to FerroEHR with; FerroEHR names the committer by it. */
  committerName: string;
}

/**
 * Why a write did not land, as a discriminated union on `kind`:
 *
 * - `build`: the result cannot be a valid composition yet ({@link LabResultBuildError}).
 * - `openehr`: FerroEHR failed or refused the commit or the read-back.
 * - `uid_conflict`: FerroEHR answered `409`, and the EHR holds no contribution with the `uid`, so
 *   the conflict is not an earlier attempt of this write.
 * - `foreign_contribution`: the contribution FerroEHR returned is not the one eduLIMS sent.
 */
export type LabResultWriteError =
  | { kind: "build"; reason: LabResultBuildError }
  | { kind: "openehr"; error: OpenEhrError }
  | { kind: "uid_conflict" }
  | { kind: "foreign_contribution" };

/** The outcome of {@link writeFinalLabResult}. */
export type LabResultWrite =
  | {
      outcome: "written";
      /** The version id FerroEHR gave the composition (`<object id>::<system>::<version>`). */
      versionUid: string;
      /** Whether this call committed it, or found it committed by an earlier attempt. */
      committed: "now" | "before";
      contributionUid: string;
    }
  | { outcome: "failed"; error: LabResultWriteError; contributionUid: string };

/**
 * Writes the Final result of `result` to its EHR, or finds it written by an earlier attempt
 * (ITS-REST 1.1.0, EHR API, "Create CONTRIBUTION" with a supplied `uid`, then "Get
 * CONTRIBUTION" on a `409`). Every attempt for the same measurement sends the same composition
 * under the same contribution `uid`, so FerroEHR holds at most one.
 */
export async function writeFinalLabResult(
  client: LabResultClient,
  result: FinalLabResult,
  settings: LabResultWriteSettings,
): Promise<LabResultWrite> {
  const contributionUid = finalResultContributionUid(result.measurementId);
  const failed = (error: LabResultWriteError): LabResultWrite => ({
    outcome: "failed",
    error,
    contributionUid,
  });
  const built = buildFinalLabResult(result, settings);
  if (!built.ok) return failed({ kind: "build", reason: built.error });
  const body = creationContribution(contributionUid, built.composition, settings.committerName);
  const sent = await client.createContribution(result.ehrId, body);
  if (!sent.ok) return failed({ kind: "openehr", error: sent.error });
  if (sent.value.outcome === "created") {
    return (
      written(sent.value.contribution, contributionUid, "now") ??
      failed({ kind: "foreign_contribution" })
    );
  }
  const found = await client.getContribution(result.ehrId, contributionUid);
  if (!found.ok) return failed({ kind: "openehr", error: found.error });
  if (found.value === null) return failed({ kind: "uid_conflict" });
  return (
    written(found.value, contributionUid, "before") ?? failed({ kind: "foreign_contribution" })
  );
}

/** Returns the written outcome of `contribution`, or `null` when it is not the one sent. */
function written(
  contribution: Contribution,
  contributionUid: string,
  committed: "now" | "before",
): LabResultWrite | null {
  const [version, ...more] = contribution.versions;
  if (
    contribution.uid.value.toLowerCase() !== contributionUid ||
    version === undefined ||
    more.length > 0
  ) {
    return null;
  }
  return { outcome: "written", versionUid: version.id.value, committed, contributionUid };
}
