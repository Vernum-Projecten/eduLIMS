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
      "A simulation",
      "A lab",
      "A test",
      "An upload",
      "Identity provider Keycloak (lab)",
      "An administrator grant",
      "An analyser",
      "A provisioned user",
      "A directory group",
      "Integration keycloak",
    ]);
    expect(activityTargetLabel({ type: "integration", id: "ferroehr" })).toBe(
      "Integration FerroEHR",
    );
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

  it("shows an inherited property name as a code, never as a label", () => {
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

  it("summarises an integration's change of state in words (B3, #227)", () => {
    expect(
      activityDetails({
        reason: "auth_refused",
        provider: null,
        metadata: {
          check_state: "refused",
          previous_check_state: "available",
          check_step: "signed_in",
          auth_reason: "invalid_client",
        },
      }),
    ).toEqual([
      "Reason: credentials refused",
      "State: Refused (authentication)",
      "Previous state: Available",
      "Failed check: Signed in",
      "Refusal code: invalid_client",
    ]);
    expect(activityReasonLabel("template_missing")).toBe("template not in FerroEHR");
    expect(activityReasonLabel("readiness_down")).toBe("FerroBRIDGE not ready");
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

  it("summarises the simulation metadata (D10, S10): ids as ids, codes in words", () => {
    expect(
      activityDetails({
        reason: "in_other_lab",
        provider: null,
        metadata: {
          simulation_id: "01960000-0000-7000-8000-000000000001",
          user_id: "u-1",
          previous_lab_id: "01960000-0000-7000-8000-000000000002",
          join_via: "email",
          count: 3,
        },
      }),
    ).toEqual([
      "Reason: the student is already in another lab of the simulation",
      "Simulation 01960000-0000-7000-8000-000000000001",
      "Person u-1",
      "Previous lab 01960000-0000-7000-8000-000000000002",
      "Joined through the email list",
      "Number: 3",
    ]);
    expect(
      activityDetails({ reason: null, provider: null, metadata: { join_via: "code" } }),
    ).toEqual(["Joined through the lab code"]);
  });

  it("summarises a lab code's term and places, never the code (#288)", () => {
    expect(
      activityDetails({ reason: null, provider: null, metadata: { valid_days: 7, max_uses: 30 } }),
    ).toEqual(["Valid for 7 days", "At most 30 students"]);
  });

  it.each([
    ["unknown_code", "the code is not known"],
    ["malformed_code", "the code has the wrong shape"],
    ["code_expired", "the code has expired"],
    ["code_used_up", "the code has no places left"],
    ["lab_deleted", "the lab was deleted"],
    ["removed", "a teacher removed the student from the simulation"],
    ["not_a_student", "the account does not have only the student role"],
    ["rate_limited_user", "too many wrong codes from this student"],
    ["rate_limited_ip", "too many wrong codes from this network address"],
  ])("names the join-code reason %s (#288)", (code, words) => {
    expect(activityReasonLabel(code)).toBe(words);
  });

  it("names the refusals of the simulation service and the teacher delete guard (D10)", () => {
    expect(activityReasonLabel("has_students")).toBe("the simulation has students in its labs");
    expect(activityReasonLabel("last_teacher")).toBe("the simulation would have no teacher left");
    expect(activityReasonLabel("not_a_teacher")).toBe("the account does not have the teacher role");
    expect(activityReasonLabel("only_simulation_teacher")).toBe(
      "the user is the only teacher of a simulation",
    );
  });

  it("names the refusal of deleting one's own account (#318)", () => {
    expect(activityReasonLabel("cannot_delete_self")).toBe("nobody can delete their own account");
  });

  it("says when the metadata cannot be read, and returns nothing for an event without details", () => {
    expect(activityDetails({ reason: null, provider: null, metadata: "unreadable" })).toEqual([
      "The details of this event could not be read.",
    ]);
    expect(activityDetails({ reason: null, provider: null, metadata: null })).toEqual([]);
  });
});
