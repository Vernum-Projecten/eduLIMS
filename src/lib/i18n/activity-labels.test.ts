// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { providerIdOf } from "@/lib/identity-providers";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@/server/audit/events";
import {
  activityDetails,
  activityNonUserActorLabel,
  activityOutcomeLabel,
  activityReasonLabel,
  activityTargetLabel,
  activityTestOutcomeLabel,
} from "./activity-labels";
import { auditActionLabel } from "./user-labels";

const LABELS = { keycloak: "Keycloak (lab)", entra: "Entra ID" };

describe("activity log labels (#36)", () => {
  it("names every action the log accepts, never as Other activity", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(auditActionLabel(action), action).not.toBe("Other activity");
    }
  });

  it("names every outcome and the non-user actors", () => {
    expect(activityOutcomeLabel("success")).toBe("Succeeded");
    expect(activityOutcomeLabel("failure")).toBe("Failed");
    expect(activityOutcomeLabel("refused")).toBe("Refused");
    expect(activityNonUserActorLabel("system")).toBe("eduLIMS");
    expect(activityNonUserActorLabel("anonymous")).toBe("Not signed in");
  });

  it("names every kind of target other than a user, an identity provider by its label", () => {
    const names = AUDIT_TARGET_TYPES.flatMap((type) =>
      type === "user" ? [] : [activityTargetLabel({ type, id: "keycloak" }, LABELS)],
    );
    expect(names).toEqual([
      "A session",
      "A class",
      "An invitation",
      "An upload",
      "Identity provider Keycloak (lab)",
      "An administrator grant",
      "An analyser",
      "A provisioned user",
      "A directory group",
    ]);
    expect(activityTargetLabel({ type: "identity_provider", id: "gone" })).toBe(
      "Identity provider gone",
    );
  });

  it("puts known reasons in words and shows an unknown one as its code", () => {
    expect(activityReasonLabel("role_conflict")).toBe("the roles do not go together");
    expect(activityReasonLabel("no_edulims_role")).toBe("no eduLIMS role");
    expect(activityReasonLabel("admin_revoke")).toBe(
      "the administrator role was withdrawn on the host",
    );
    expect(activityReasonLabel("rate_limited")).toBe("code rate_limited");
  });

  it("puts the reasons of a refused join with a code in words (#49)", () => {
    expect(activityReasonLabel("removed")).toBe("a teacher removed the student from the class");
    expect(activityReasonLabel("unknown_code")).toBe("no class has this join code");
    expect(activityReasonLabel("rate_limited_ip")).toBe(
      "too many wrong join codes from one address",
    );
    expect(activityReasonLabel("class_archived")).toBe("the class is archived");
    expect(activityReasonLabel("toString")).toBe("code toString");
  });

  it("puts the result of a provider's test sign-in in words", () => {
    expect(activityTestOutcomeLabel("roles")).toBe("roles from the identity provider");
    expect(activityTestOutcomeLabel("local")).toBe("roles assigned in eduLIMS");
    expect(activityTestOutcomeLabel("default")).toBe("the provider's default role");
    expect(activityTestOutcomeLabel("role_conflict")).toBe("the roles do not go together");
  });

  it("summarises the reason, sign-in method and metadata as sentences, never JSON", () => {
    expect(
      activityDetails(
        {
          reason: "cannot_change_own_roles",
          provider: providerIdOf("keycloak"),
          metadata: { roles: "teacher,admin", previous_roles: "student" },
        },
        LABELS,
      ),
    ).toEqual([
      "Reason: nobody can change their own roles",
      "Through Keycloak (lab)",
      "Roles: Teacher · Administrator",
      "Previous roles: Student",
    ]);
    expect(
      activityDetails({
        reason: null,
        provider: null,
        metadata: { ban_expires_at: "2026-11-20T23:00:00.000Z" },
      }),
    ).toEqual([expect.stringMatching(/^Blocked until Nov 21, 2026/)]);
  });

  it("names the previous owner of a transferred class by id (#37)", () => {
    expect(
      activityDetails({
        reason: null,
        provider: null,
        metadata: { user_id: "new-owner-id", previous_user_id: "old-owner-id" },
      }),
    ).toEqual(["Person new-owner-id", "Previous owner old-owner-id"]);
    expect(activityReasonLabel("already_owner")).toBe("the chosen teacher already owns the class");
    expect(activityReasonLabel("not_archived")).toBe("the class is not archived");
    expect(activityReasonLabel("not_a_teacher")).toBe(
      "the chosen owner does not have the teacher role",
    );
  });

  it("summarises the identity provider metadata", () => {
    expect(
      activityDetails(
        {
          reason: null,
          provider: null,
          metadata: {
            provider_id: "entra",
            protocol: "oidc",
            fields: ["issuer", "client_id"],
            attest_pkce: true,
            sessions_ended: 3,
            test_outcome: "roles",
          },
        },
        LABELS,
      ),
    ).toEqual([
      "Identity provider: Entra ID",
      "Protocol: OIDC",
      "Settings changed: issuer, client_id",
      "PKCE confirmed by an administrator",
      "Sessions ended: 3",
      "Test result: roles from the identity provider",
    ]);
    expect(
      activityDetails({ reason: null, provider: null, metadata: { attest_pkce: false } }),
    ).toEqual(["PKCE confirmation withdrawn"]);
  });

  it("summarises an analyser's status and the counts of a retention run", () => {
    expect(
      activityDetails({
        reason: null,
        provider: null,
        metadata: { analyser_status: "maintenance" },
      }),
    ).toEqual(["Status: In maintenance"]);
    expect(
      activityDetails({
        reason: null,
        provider: null,
        metadata: { removed_audit_events: 1200, removed_sessions: 4, removed_admin_grants: 0 },
      }),
    ).toEqual(["Events removed: 1,200", "Sessions removed: 4", "Administrator grants removed: 0"]);
    expect(
      activityDetails({
        reason: null,
        provider: null,
        metadata: { resealed_providers: 2, resealed_id_tokens: 31 },
      }),
    ).toEqual(["Identity providers re-encrypted: 2", "ID tokens re-encrypted: 31"]);
  });

  it("summarises a SCIM token's dates, a refusal's count and the SCIM reasons (#45)", () => {
    expect(
      activityDetails(
        {
          reason: "token_unknown",
          provider: null,
          metadata: { provider_id: "keycloak", refused_count: 600 },
        },
        LABELS,
      ),
    ).toEqual([
      "Reason: the SCIM token is not known",
      "Identity provider: Keycloak (lab)",
      "Refused requests: 600",
    ]);
    expect(
      activityDetails({
        reason: null,
        provider: null,
        metadata: {
          token_expires_at: "2027-05-10T09:30:00.000Z",
          previous_token_valid_until: "2026-11-11T10:30:00.000Z",
        },
      }),
    ).toEqual([
      expect.stringMatching(/^Token expires /),
      expect.stringMatching(/^The previous token works until /),
    ]);
    for (const reason of [
      "token_missing",
      "token_revoked",
      "token_expired",
      "token_refused",
      "provider_disabled",
      "address_domain",
      "uniqueness",
      "http_404",
      "user_deprovisioned",
      "account_deprovisioned",
    ]) {
      expect(activityReasonLabel(reason), reason).not.toMatch(/^code /);
    }
  });

  it("summarises the class metadata (#28): ids as ids, codes in words", () => {
    expect(
      activityDetails({
        reason: "forbidden",
        provider: null,
        metadata: {
          class_id: "01960000-0000-7000-8000-000000000001",
          class_role: "teacher",
          user_id: "u-1",
          group_change: "split",
          team_id: "01960000-0000-7000-8000-000000000002",
          count: 3,
          removed_invitations: 2,
        },
      }),
    ).toEqual([
      "Reason: the class role does not allow it",
      "Class 01960000-0000-7000-8000-000000000001",
      "Class role: Co-teacher",
      "Person u-1",
      "Lab groups: the class split into groups",
      "Lab group 01960000-0000-7000-8000-000000000002",
      "Number: 3",
      "2 ended class invitations removed",
    ]);
  });

  it("names the refusals of the class service and the class-owner delete guard (#28)", () => {
    expect(activityReasonLabel("archived")).toBe("the class is archived");
    expect(activityReasonLabel("forbidden")).toBe("the class role does not allow it");
    expect(activityReasonLabel("has_work")).toBe("the class has practicals, submissions or grades");
    expect(activityReasonLabel("owns_class")).toBe("the user owns a class");
  });

  it("says when the metadata cannot be read, and returns nothing for an event without details", () => {
    expect(activityDetails({ reason: null, provider: null, metadata: "unreadable" })).toEqual([
      "The details of this event could not be read.",
    ]);
    expect(activityDetails({ reason: null, provider: null, metadata: null })).toEqual([]);
  });
});
