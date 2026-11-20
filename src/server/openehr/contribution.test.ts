// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The CONTRIBUTION of a released result (#148): its `uid` is a UUIDv5 of the measurement (RFC 9562
// §5.5), the same for every attempt, and its committer names only the client (Q-PRIV-1).
import { describe, expect, it } from "vitest";
import { creationContribution, finalResultContributionUid, uuidV5 } from "./contribution.ts";

const MEASUREMENT = "0190f1c2-0000-7000-8000-0000000000a1";
const OTHER = "0190f1c2-0000-7000-8000-0000000000a2";

describe("uuidV5 (RFC 9562 §5.5)", () => {
  it("matches the RFC 9562 test vector (Appendix A.4: DNS namespace, www.example.com)", () => {
    expect(uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });

  it("sets version 5 and the RFC variant", () => {
    const uid = uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "anything");
    expect(uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("refuses a namespace that is not a UUID", () => {
    expect(() => uuidV5("not-a-uuid", "x")).toThrow(RangeError);
  });
});

describe("finalResultContributionUid (#148, idempotent on the measurement)", () => {
  it("gives every attempt for one measurement the same uid", () => {
    expect(finalResultContributionUid(MEASUREMENT)).toBe(finalResultContributionUid(MEASUREMENT));
  });

  it("gives two measurements two uids, neither the measurement id itself", () => {
    const first = finalResultContributionUid(MEASUREMENT);
    expect(first).not.toBe(finalResultContributionUid(OTHER));
    expect(first).not.toBe(MEASUREMENT);
  });
});

describe("creationContribution (ITS-REST 1.1.0, NewContribution.yaml)", () => {
  const composition = { _type: "COMPOSITION" };
  const body = creationContribution("uid-1", composition, "edulims-ferroehr");

  it("carries the uid, one version with the composition, complete (532) and a creation (249)", () => {
    expect(body.uid).toEqual({ _type: "HIER_OBJECT_ID", value: "uid-1" });
    expect(body.versions).toHaveLength(1);
    expect(body.versions[0]?.data).toBe(composition);
    expect(body.versions[0]?.lifecycle_state.defining_code.code_string).toBe("532");
    expect(body.audit.change_type.defining_code.code_string).toBe("249");
  });

  it("names the committer by the client's name only, in the version and the contribution (Q-PRIV-1)", () => {
    const committer = { _type: "PARTY_IDENTIFIED", name: "edulims-ferroehr" };
    expect(body.audit.committer).toEqual(committer);
    expect(body.versions[0]?.commit_audit.committer).toEqual(committer);
  });
});
