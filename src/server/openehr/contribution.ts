// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The CONTRIBUTION eduLIMS commits a composition in (ITS-REST 1.1.0, EHR API, "Create
// CONTRIBUTION", `schemas/ehr/NewContribution.yaml`). Its `uid` is derived from the eduLIMS record
// it writes, so a retry of the same write carries the same `uid` and FerroEHR refuses the second
// one with `409` (`contribution_create.yaml`): the write is idempotent (reliability.md).
import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import type { JsonObject } from "./json.ts";

/** A CONTRIBUTION to commit, as `NewContribution.yaml` names its members. */
export interface NewContribution {
  uid: { _type: "HIER_OBJECT_ID"; value: string };
  versions: readonly {
    lifecycle_state: CodedText;
    commit_audit: UpdateAudit;
    data: JsonObject;
  }[];
  audit: UpdateAudit;
}

interface CodedText {
  _type: "DV_CODED_TEXT";
  value: string;
  defining_code: {
    _type: "CODE_PHRASE";
    terminology_id: { _type: "TERMINOLOGY_ID"; value: "openehr" };
    code_string: string;
  };
}

/** `schemas/common/UpdateAudit.yaml`: the committer and the change type. */
interface UpdateAudit {
  _type: "UPDATE_AUDIT";
  change_type: CodedText;
  committer: { _type: "PARTY_IDENTIFIED"; name: string };
}

// NOTE: no openEHR spec governs this value: our own design (#148). A fixed random UUID, the
// namespace of every contribution uid eduLIMS derives (RFC 9562 §5.5, §6.6).
const CONTRIBUTION_NAMESPACE = "0b241ba5-f50e-4087-bd35-6eea1e04e11c";

/**
 * Returns the name-based UUID (version 5, RFC 9562 §5.5) of `name` in `namespace`: SHA-1 over the
 * namespace's 16 bytes and the name in UTF-8, with the version and variant bits set.
 *
 * @throws RangeError when `namespace` is not a UUID.
 */
export function uuidV5(namespace: string, name: string): string {
  const hex = namespace.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new RangeError("the namespace is not a UUID");
  const digest = createHash("sha1")
    .update(Buffer.from(hex, "hex"))
    .update(Buffer.from(name, "utf8"))
    .digest();
  const bytes = digest.subarray(0, 16);
  bytes.writeUInt8(((bytes.readUInt8(6) & 0x0f) | 0x50) >>> 0, 6);
  bytes.writeUInt8(((bytes.readUInt8(8) & 0x3f) | 0x80) >>> 0, 8);
  const out = bytes.toString("hex");
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

/**
 * Returns the `uid` of the CONTRIBUTION that writes the released result of `measurementId`: the
 * same for every attempt, and different from any other record eduLIMS writes.
 */
export function finalResultContributionUid(measurementId: string): string {
  return uuidV5(CONTRIBUTION_NAMESPACE, `final-result:${measurementId}`);
}

function openehrCode(value: string, code: string): CodedText {
  return {
    _type: "DV_CODED_TEXT",
    value,
    defining_code: {
      _type: "CODE_PHRASE",
      terminology_id: { _type: "TERMINOLOGY_ID", value: "openehr" },
      code_string: code,
    },
  };
}

/**
 * Returns the CONTRIBUTION that creates `composition` as the first version of a new object,
 * under the contribution `uid`.
 *
 * The committer is the client eduLIMS signs in as, by name only: FerroEHR writes the committer of
 * a system client itself and accepts a stated one that "states nothing the server's does not"
 * (FerroEHR book v5.7.0, `security/committer.md`, "What a client may still send"). No student or
 * teacher is named (Q-PRIV-1).
 */
export function creationContribution(
  uid: string,
  composition: JsonObject,
  committerName: string,
): NewContribution {
  // NOTE: RM common 1.1.0, terminology group `audit change type` (249 creation) and `version
  // lifecycle state` (532 complete).
  const audit: UpdateAudit = {
    _type: "UPDATE_AUDIT",
    change_type: openehrCode("creation", "249"),
    committer: { _type: "PARTY_IDENTIFIED", name: committerName },
  };
  return {
    uid: { _type: "HIER_OBJECT_ID", value: uid },
    versions: [
      { lifecycle_state: openehrCode("complete", "532"), commit_audit: audit, data: composition },
    ],
    audit,
  };
}
