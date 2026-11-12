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
    ).toEqual(["Previous owner: user old-owner-id"]);
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
  });

  it("says when the metadata cannot be read, and returns nothing for an event without details", () => {
    expect(activityDetails({ reason: null, provider: null, metadata: "unreadable" })).toEqual([
      "The details of this event could not be read.",
    ]);
    expect(activityDetails({ reason: null, provider: null, metadata: null })).toEqual([]);
  });
});
