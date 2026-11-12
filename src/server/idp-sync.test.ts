// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NO_ROLE_ERROR,
  PROVIDER_DISABLED_ERROR,
  providerIdOf,
  ROLE_CONFLICT_ERROR,
  SAML_NAMEID_ERROR,
} from "../lib/identity-providers.ts";
import type { Role } from "../lib/roles.ts";
import { AuditRecorder } from "./audit/better-auth-hooks.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import type { ProviderSettingsView } from "./idp/registry.ts";
import { samlResponse } from "./idp/test-saml.ts";
import { PERSISTENT_NAME_ID } from "./idp/validate.ts";
import { parseRoleMap } from "./idp-roles.ts";
import { createIdpRoleSync, type IdpRoleSyncOptions } from "./idp-sync.ts";
import { setSecurityLogWriter } from "./security-log.ts";

/** Captures the security log lines until `restore` is called. */
function captureSecurityLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  return { lines, restore: setSecurityLogWriter((line) => lines.push(line)) };
}

/** Runs `act` and returns the security log lines it wrote. */
async function logged(act: () => Promise<unknown>): Promise<string[]> {
  const { lines, restore } = captureSecurityLog();
  try {
    await act();
  } finally {
    restore();
  }
  return lines;
}

/** The parsed security log lines of one event. */
function events(lines: readonly string[], event: string): unknown[] {
  return lines
    .map((line): unknown => JSON.parse(line))
    .filter(
      (line) => typeof line === "object" && line !== null && Reflect.get(line, "event") === event,
    );
}

type Sync = ReturnType<typeof createIdpRoleSync>;
type Data = Parameters<Sync>[0];
type Ctx = Parameters<Sync>[1];

const roleMap = parseRoleMap("edulims-student:student,edulims-teacher:teacher,edulims-admin:admin");

/** The providers the gate knows: an Entra-style and a Keycloak OIDC provider, and SAML. */
function provider(
  id: string,
  protocol: "oidc" | "saml",
  roleClaim: string,
  extra: Partial<ProviderSettingsView> = {},
): ProviderSettingsView {
  return {
    providerId: providerIdOf(id),
    protocol,
    enabled: true,
    roleClaim,
    roleMap,
    defaultRole: undefined,
    emailAuthoritative: false,
    endSessionEndpoint: null,
    scimExternalIdClaim: null,
    ...extra,
  };
}

function providersWith(defaultRole?: Role): IdpRoleSyncOptions["settingsOf"] {
  const known = [
    provider("microsoft", "oidc", "roles", { defaultRole }),
    provider("keycloak", "oidc", "realm_access.roles", { defaultRole }),
    provider("keycloak-saml", "saml", "Role", { defaultRole }),
    provider("disabled", "oidc", "roles", { enabled: false }),
  ];
  return async (id) => known.find((candidate) => candidate.providerId === id) ?? null;
}

/** The stored role set per user id, as better-auth's adapter returns it. */
type Stored = Readonly<
  Record<string, { role: string; roleSource: string; provisionedBy?: string }>
>;

function setup(defaultRole?: "student", stored: Stored = {}) {
  const updateUser = vi.fn(async () => null);
  const deleteUserSessions = vi.fn(async () => undefined);
  const findUserById = vi.fn(async (id: string) => stored[id] ?? null);
  const ctx = {
    context: { internalAdapter: { updateUser, deleteUserSessions, findUserById } },
    // The verified SAMLResponse of a SAML sign-in, with a persistent NameID (L8).
    body: { SAMLResponse: samlResponse(PERSISTENT_NAME_ID) },
  } as unknown as Ctx;
  const sync = createIdpRoleSync({ settingsOf: providersWith(defaultRole) });
  return { sync, ctx, updateUser, deleteUserSessions };
}

function oauth(
  action: "create-user" | "sign-in" | "link-account",
  providerId: string,
  profile: Record<string, unknown>,
  user: Data["user"] = { email: "u@example.test" },
): Data {
  const method = providerId === "keycloak-saml" ? "sso-saml" : "sso-oidc";
  return { user, source: { action, method, sso: { providerId, profile } } };
}

describe("createIdpRoleSync", () => {
  it("writes the mapped role onto a new user", async () => {
    const { sync, ctx } = setup();
    const data = oauth("create-user", "microsoft", { roles: ["edulims-teacher"] });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(data.user["role"]).toBe("teacher");
    expect(data.user["roleSource"]).toBe("microsoft");
    expect(data.user["roleChannel"]).toBe("claim");
  });

  it("syncs the role of an existing user on every sign-in", async () => {
    const { sync, ctx, updateUser } = setup();
    const data = oauth(
      "sign-in",
      "keycloak",
      { realm_access: { roles: ["edulims-student"] } },
      {
        id: "u1",
        email: "u@example.test",
      },
    );
    expect(await sync(data, ctx)).toBeUndefined();
    // With no stored row to compare, the provider's email setting is written too (#46).
    expect(updateUser).toHaveBeenCalledWith("u1", {
      role: "student",
      roleSource: "keycloak",
      roleChannel: "claim",
      emailVerified: false,
    });
  });

  it("rejects a sign-in without a mapped role", async () => {
    const { sync, ctx, updateUser } = setup();
    const data = oauth("sign-in", "keycloak", { realm_access: { roles: ["other"] } }, { id: "u1" });
    expect(await sync(data, ctx)).toMatchObject({ error: NO_ROLE_ERROR });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("revokes the live sessions of an existing user refused for no role (A07)", async () => {
    const { sync, ctx, deleteUserSessions } = setup();
    const data = oauth("sign-in", "keycloak", { realm_access: { roles: [] } }, { id: "u1" });
    expect(await sync(data, ctx)).toMatchObject({ error: NO_ROLE_ERROR });
    expect(deleteUserSessions).toHaveBeenCalledWith("u1");
  });

  it("revokes the live sessions of an existing user refused for conflicting roles (A07)", async () => {
    const { sync, ctx, deleteUserSessions } = setup();
    const claims = { roles: ["edulims-student", "edulims-admin"] };
    const data = oauth("link-account", "microsoft", claims, { id: "u2" });
    const lines = await logged(async () => {
      expect(await sync(data, ctx)).toMatchObject({ error: ROLE_CONFLICT_ERROR });
    });
    expect(deleteUserSessions).toHaveBeenCalledWith("u2");
    expect(events(lines, "idp_role_conflict")).toEqual([
      expect.objectContaining({
        level: "warn",
        reason: ROLE_CONFLICT_ERROR,
        provider: "microsoft",
      }),
    ]);
  });

  it("revokes nothing for a refused first sign-in, which has no sessions", async () => {
    const { sync, ctx, deleteUserSessions } = setup();
    expect(await sync(oauth("create-user", "microsoft", {}), ctx)).toMatchObject({
      error: NO_ROLE_ERROR,
    });
    expect(deleteUserSessions).not.toHaveBeenCalled();
  });

  it("revokes nothing when the sign-in is allowed", async () => {
    const { sync, ctx, deleteUserSessions } = setup();
    const data = oauth("sign-in", "microsoft", { roles: ["edulims-teacher"] }, { id: "u1" });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(deleteUserSessions).not.toHaveBeenCalled();
  });

  it("refuses a provider eduLIMS does not know as disabled, whatever its default role", async () => {
    const { sync, ctx } = setup("student");
    expect(await sync(oauth("create-user", "github", {}), ctx)).toMatchObject({
      error: PROVIDER_DISABLED_ERROR,
    });
  });

  it("refuses a disabled provider (#46)", async () => {
    const { sync, ctx } = setup();
    const data = oauth("create-user", "disabled", { roles: ["edulims-teacher"] });
    expect(await sync(data, ctx)).toMatchObject({ error: PROVIDER_DISABLED_ERROR });
    expect(data.user["role"]).toBeUndefined();
  });

  it("reads a SAML role attribute by its exact name, multi-valued (sso-saml)", async () => {
    const { sync, ctx } = setup();
    const data = oauth("create-user", "keycloak-saml", {
      Role: ["edulims-teacher", "edulims-admin", "offline_access"],
    });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(data.user["role"]).toBe("teacher,admin");
    expect(data.user["roleSource"]).toBe("keycloak-saml");
  });

  it("reads a single-valued SAML role attribute", async () => {
    const { sync, ctx } = setup();
    const data = oauth("create-user", "keycloak-saml", { Role: "edulims-student" });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(data.user["role"]).toBe("student");
  });

  it("never reads a SAML attribute by dot path", async () => {
    const { sync, ctx } = setup();
    const data = oauth("create-user", "keycloak-saml", { Role: { x: "edulims-admin" } });
    expect(await sync(data, ctx)).toMatchObject({ error: NO_ROLE_ERROR });
  });

  it("ignores `oauth` sign-ins: every provider is an SSO provider (ADR 0015)", async () => {
    const { sync, ctx } = setup("student");
    const data: Data = {
      user: { email: "o@example.test" },
      source: {
        action: "create-user",
        method: "oauth",
        oauth: { providerId: "keycloak", profile: { realm_access: { roles: ["edulims-admin"] } } },
      },
    };
    expect(await sync(data, ctx)).toBeUndefined();
    expect(data.user["role"]).toBeUndefined();
  });

  it("uses the opt-in default role when nothing is mapped", async () => {
    const { sync, ctx } = setup("student");
    const data = oauth("create-user", "microsoft", {});
    expect(await sync(data, ctx)).toBeUndefined();
    expect(data.user["role"]).toBe("student");
    expect(data.user["roleSource"]).toBe("local");
  });

  it("writes the whole mapped role set, sorted, onto a new user (ADR 0012)", async () => {
    const { sync, ctx } = setup();
    const data = oauth("create-user", "keycloak", {
      realm_access: { roles: ["edulims-admin", "edulims-teacher"] },
    });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(data.user["role"]).toBe("teacher,admin");
  });

  it("syncs a changed role set onto an existing user", async () => {
    const { sync, ctx, updateUser } = setup(undefined, {
      u1: { role: "teacher", roleSource: "microsoft" },
    });
    const data = oauth(
      "sign-in",
      "microsoft",
      { roles: ["edulims-teacher", "edulims-admin"] },
      { id: "u1", role: "teacher" },
    );
    expect(await sync(data, ctx)).toBeUndefined();
    expect(updateUser).toHaveBeenCalledWith("u1", {
      role: "teacher,admin",
      roleSource: "microsoft",
      roleChannel: "claim",
    });
  });

  it("never adds admin from another provider's claim to a SCIM-provisioned user (#45, N2)", async () => {
    const { sync, ctx, updateUser } = setup("student", {
      u1: { role: "teacher", roleSource: "keycloak", provisionedBy: "keycloak" },
    });
    const claims = { roles: ["edulims-admin"] };
    const data = oauth("sign-in", "microsoft", claims, { id: "u1", role: "teacher" });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(updateUser).not.toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ role: expect.anything() }),
    );
  });

  it("does not write an unchanged role set", async () => {
    const { sync, ctx, updateUser } = setup(undefined, {
      u1: { role: "teacher,admin", roleSource: "microsoft" },
    });
    const claims = { roles: ["edulims-admin", "edulims-teacher"] };
    const data = oauth("sign-in", "microsoft", claims, { id: "u1", role: "teacher,admin" });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses a student with teacher or admin as role_conflict, logging no personal data", async () => {
    const { lines, restore } = captureSecurityLog();
    const { sync, ctx, updateUser } = setup("student");
    const data = oauth(
      "sign-in",
      "keycloak",
      { email: "u@example.test", realm_access: { roles: ["edulims-student", "edulims-teacher"] } },
      { id: "u1", email: "u@example.test", name: "Test Student" },
    );
    try {
      expect(await sync(data, ctx)).toMatchObject({ error: ROLE_CONFLICT_ERROR });
    } finally {
      restore();
    }
    expect(updateUser).not.toHaveBeenCalled();
    const conflicts = lines.filter((line) => line.includes('"event":"idp_role_conflict"'));
    expect(conflicts).toHaveLength(1);
    expect(JSON.parse(conflicts[0] ?? "null")).toMatchObject({
      reason: ROLE_CONFLICT_ERROR,
      provider: "keycloak",
    });
    expect(conflicts.join("")).not.toMatch(/u1|example\.test|Test Student/);
    expect(lines.join("")).not.toMatch(/example\.test|Test Student/);
  });

  it("refuses a conflicting set on a first sign-in too", async () => {
    const { sync, ctx } = setup();
    const data = oauth("create-user", "microsoft", { roles: ["edulims-student", "edulims-admin"] });
    const lines = await logged(async () => {
      expect(await sync(data, ctx)).toMatchObject({ error: ROLE_CONFLICT_ERROR });
    });
    expect(data.user["role"]).toBeUndefined();
    expect(events(lines, "idp_role_conflict")).toEqual([
      expect.objectContaining({ reason: ROLE_CONFLICT_ERROR, provider: "microsoft" }),
    ]);
  });

  it("leaves non-OAuth methods (dev login, admin) alone", async () => {
    const { sync, ctx, updateUser } = setup();
    const data: Data = {
      user: { email: "d@example.test" },
      source: { action: "create-user", method: "admin" },
    };
    expect(await sync(data, ctx)).toBeUndefined();
    expect(data.user["role"]).toBeUndefined();
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("first start, email trust and the test sign-in (#46, #48)", () => {
  function authoritative(extra: Partial<IdpRoleSyncOptions> = {}) {
    const updateUser = vi.fn(async () => null);
    const ctx = {
      context: {
        internalAdapter: {
          updateUser,
          deleteUserSessions: vi.fn(async () => undefined),
          findUserById: vi.fn(async () => ({
            role: "teacher",
            roleSource: "local",
            emailVerified: false,
          })),
        },
      },
    } as unknown as Ctx;
    const settings = provider("entra", "oidc", "roles", { emailAuthoritative: true });
    const sync = createIdpRoleSync({ settingsOf: async () => settings, ...extra });
    return { sync, ctx, updateUser };
  }

  it("applies a pending admin grant to a new user of an authoritative provider", async () => {
    const consumeAdminGrant = vi.fn(async () => true);
    const { sync, ctx } = authoritative({ consumeAdminGrant });
    const data = oauth("create-user", "entra", { roles: [] }, { email: "first@example.test" });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(consumeAdminGrant).toHaveBeenCalledWith("first@example.test", "entra");
    expect(data.user["role"]).toBe("admin");
    expect(data.user["roleSource"]).toBe("local");
    expect(data.user.emailVerified).toBe(true);
  });

  it("refuses with no_edulims_role when no grant is waiting", async () => {
    const { sync, ctx } = authoritative({ consumeAdminGrant: async () => false });
    const data = oauth("create-user", "entra", {}, { email: "x@example.test" });
    expect(await sync(data, ctx)).toMatchObject({ error: NO_ROLE_ERROR });
  });

  it("never consumes a grant through a provider whose email is not authoritative", async () => {
    const consumeAdminGrant = vi.fn(async () => true);
    const { ctx } = setup();
    const gated = createIdpRoleSync({ settingsOf: providersWith(), consumeAdminGrant });
    const data = oauth("create-user", "microsoft", {}, { email: "x@example.test" });
    expect(await gated(data, ctx)).toMatchObject({ error: NO_ROLE_ERROR });
    expect(consumeAdminGrant).not.toHaveBeenCalled();
  });

  it("grants only student to a new user with a pending class invitation (#28 (2))", async () => {
    const hasStudentInvitation = vi.fn(async () => true);
    const consumeAdminGrant = vi.fn(async () => true);
    const { sync, ctx } = authoritative({ hasStudentInvitation, consumeAdminGrant });
    const data = oauth("create-user", "entra", { roles: [] }, { email: "invited@example.test" });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(hasStudentInvitation).toHaveBeenCalledWith("invited@example.test");
    expect(consumeAdminGrant).not.toHaveBeenCalled();
    expect(data.user["role"]).toBe("student");
    expect(data.user["roleSource"]).toBe("local");
  });

  it("never grants an invitation's student role to a SCIM-provisioned user (#28, #45)", async () => {
    const hasStudentInvitation = vi.fn(async () => true);
    const { ctx } = setup(undefined, {
      u1: { role: "", roleSource: "keycloak", provisionedBy: "keycloak" },
    });
    const settings = provider("keycloak", "oidc", "realm_access.roles", {
      emailAuthoritative: true,
    });
    const sync = createIdpRoleSync({ settingsOf: async () => settings, hasStudentInvitation });
    const data = oauth("sign-in", "keycloak", {}, { id: "u1", email: "scim@example.test" });
    expect(await sync(data, ctx)).toMatchObject({ error: NO_ROLE_ERROR });
    expect(hasStudentInvitation).not.toHaveBeenCalled();
  });

  it("never restores a role the IdP took away from an existing user (#28 review)", async () => {
    const hasStudentInvitation = vi.fn(async () => true);
    const ctx = {
      context: {
        internalAdapter: {
          updateUser: vi.fn(async () => null),
          deleteUserSessions: vi.fn(async () => undefined),
          // A student set the IdP once sent and no longer does (A07).
          findUserById: vi.fn(async () => ({
            role: "student",
            roleSource: "entra",
            emailVerified: true,
          })),
        },
      },
    } as unknown as Ctx;
    const settings = provider("entra", "oidc", "roles", { emailAuthoritative: true });
    const sync = createIdpRoleSync({ settingsOf: async () => settings, hasStudentInvitation });
    const data = oauth("sign-in", "entra", { roles: [] }, { id: "u1", email: "back@example.test" });
    expect(await sync(data, ctx)).toMatchObject({ error: NO_ROLE_ERROR });
    expect(hasStudentInvitation).not.toHaveBeenCalled();
  });

  it("never lets an invitation override a role the IdP sends (#28 (2))", async () => {
    const hasStudentInvitation = vi.fn(async () => true);
    const { sync, ctx } = authoritative({ hasStudentInvitation });
    const data = oauth(
      "create-user",
      "entra",
      { roles: ["edulims-teacher"] },
      { email: "t@example.test" },
    );
    expect(await sync(data, ctx)).toBeUndefined();
    expect(hasStudentInvitation).not.toHaveBeenCalled();
    expect(data.user["role"]).toBe("teacher");
  });

  it("never asks for an invitation through a provider whose email is not authoritative", async () => {
    const hasStudentInvitation = vi.fn(async () => true);
    const { ctx } = setup();
    const gated = createIdpRoleSync({ settingsOf: providersWith(), hasStudentInvitation });
    const data = oauth("create-user", "microsoft", {}, { email: "x@example.test" });
    expect(await gated(data, ctx)).toMatchObject({ error: NO_ROLE_ERROR });
    expect(hasStudentInvitation).not.toHaveBeenCalled();
  });

  it("marks the email verified on a sign-in of an authoritative provider", async () => {
    const { sync, ctx, updateUser } = authoritative();
    const data = oauth("sign-in", "entra", {}, { id: "u1", email: "u@example.test" });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(updateUser).toHaveBeenCalledWith("u1", { emailVerified: true });
  });

  it("records a test sign-in's claim names and outcome, then refuses it, even when disabled", async () => {
    const recordTest = vi.fn(async () => undefined);
    const settings = provider("entra", "oidc", "roles", { enabled: false });
    const sync = createIdpRoleSync({
      settingsOf: async () => settings,
      testOf: async () => "t".repeat(32),
      recordTest,
    });
    const { ctx } = setup();
    const data = oauth("create-user", "entra", {
      sub: "s",
      roles: ["edulims-teacher"],
      email: "e",
    });
    expect(await sync(data, ctx)).toMatchObject({ error: "idp_test_complete" });
    expect(recordTest).toHaveBeenCalledWith("t".repeat(32), {
      outcome: "idp",
      roles: ["teacher"],
      claimNames: ["email", "roles", "sub"],
    });
    expect(data.user["role"]).toBeUndefined();
  });
});

describe("the security log of the sign-in gate (ASVS V16.3.1, V16.2.5)", () => {
  const TRANSIENT = "urn:oasis:names:tc:SAML:2.0:nameid-format:transient";
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  function capture(): string[] {
    const captured = captureSecurityLog();
    restore = captured.restore;
    return captured.lines;
  }

  it.each([
    ["a disabled provider", "disabled"],
    ["a provider eduLIMS does not know", "github"],
  ])("logs the refusal of %s as provider_disabled", async (_label, providerId) => {
    const lines = capture();
    const { sync, ctx } = setup();
    const data = oauth("sign-in", providerId, {}, { id: "u3", email: "u3@example.test" });
    expect(await sync(data, ctx)).toMatchObject({ error: PROVIDER_DISABLED_ERROR });
    expect(events(lines, "authn_login_fail")).toEqual([
      expect.objectContaining({
        level: "warn",
        outcome: "refused",
        actor_type: "anonymous",
        target_id: "u3",
        reason: PROVIDER_DISABLED_ERROR,
        provider: providerId,
      }),
    ]);
    expect(lines.join("")).not.toMatch(/example\.test/);
  });

  it("logs the refusal of a SAML sign-in without a persistent NameID", async () => {
    const lines = capture();
    const { sync, ctx } = setup();
    const transient = { ...ctx, body: { SAMLResponse: samlResponse(TRANSIENT) } } as Ctx;
    const data = oauth("create-user", "keycloak-saml", { Role: ["edulims-teacher"] });
    expect(await sync(data, transient)).toMatchObject({ error: SAML_NAMEID_ERROR });
    expect(events(lines, "authn_login_fail")).toEqual([
      expect.objectContaining({ reason: SAML_NAMEID_ERROR, provider: "keycloak-saml" }),
    ]);
    expect(lines.join("")).not.toMatch(/example\.test|SAMLResponse|edulims-teacher/);
  });

  it("logs a test sign-in with its outcome code only, never the claims or the test", async () => {
    const lines = capture();
    const settings = provider("entra", "oidc", "roles");
    const sync = createIdpRoleSync({
      settingsOf: async () => settings,
      testOf: async () => "t".repeat(32),
      recordTest: async () => undefined,
    });
    const { ctx } = setup();
    const data = oauth("create-user", "entra", {
      sub: "subject-1",
      roles: ["edulims-teacher"],
      email: "claim@example.test",
    });
    expect(await sync(data, ctx)).toMatchObject({ error: "idp_test_complete" });
    expect(events(lines, "idp_test_sign_in")).toEqual([
      expect.objectContaining({
        level: "info",
        reason: "idp_test_complete",
        test_outcome: "idp",
        provider: "entra",
      }),
    ]);
    expect(lines.join("")).not.toMatch(/t{32}|subject-1|example\.test|edulims-teacher/);
  });

  it("logs a test sign-in that a transient NameID ends", async () => {
    const lines = capture();
    const settings = provider("keycloak-saml", "saml", "Role");
    const sync = createIdpRoleSync({
      settingsOf: async () => settings,
      testOf: async () => "t".repeat(32),
      recordTest: async () => undefined,
    });
    const { ctx } = setup();
    const transient = { ...ctx, body: { SAMLResponse: samlResponse(TRANSIENT) } } as Ctx;
    await sync(oauth("create-user", "keycloak-saml", {}), transient);
    expect(events(lines, "idp_test_sign_in")).toEqual([
      expect.objectContaining({ test_outcome: SAML_NAMEID_ERROR }),
    ]);
  });
});

describe("hybrid role ownership (owner decision on #32, B1)", () => {
  it("keeps the local roles of an existing user when the IdP sends none", async () => {
    const { sync, ctx, updateUser, deleteUserSessions } = setup(undefined, {
      u1: { role: "teacher", roleSource: "local" },
    });
    const data = oauth("sign-in", "keycloak", { realm_access: { roles: [] } }, { id: "u1" });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(updateUser).not.toHaveBeenCalled();
    expect(deleteUserSessions).not.toHaveBeenCalled();
  });

  it("refuses a user whose IdP-sourced roles the IdP took away (A07)", async () => {
    const { sync, ctx, deleteUserSessions } = setup(undefined, {
      u1: { role: "teacher", roleSource: "keycloak" },
    });
    const data = oauth("sign-in", "keycloak", { realm_access: { roles: [] } }, { id: "u1" });
    expect(await sync(data, ctx)).toMatchObject({ error: NO_ROLE_ERROR });
    expect(deleteUserSessions).toHaveBeenCalledWith("u1");
  });

  it("lets a mapped IdP role overwrite a local role set and take over its source", async () => {
    const { sync, ctx, updateUser } = setup(undefined, {
      u1: { role: "teacher", roleSource: "local" },
    });
    const data = oauth("sign-in", "microsoft", { roles: ["edulims-admin"] }, { id: "u1" });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(updateUser).toHaveBeenCalledWith("u1", {
      role: "admin",
      roleSource: "microsoft",
      roleChannel: "claim",
    });
  });

  it("moves an unchanged set to the IdP as its source", async () => {
    const { sync, ctx, updateUser } = setup(undefined, {
      u1: { role: "teacher", roleSource: "local" },
    });
    const data = oauth("sign-in", "microsoft", { roles: ["edulims-teacher"] }, { id: "u1" });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(updateUser).toHaveBeenCalledWith("u1", {
      role: "teacher",
      roleSource: "microsoft",
      roleChannel: "claim",
    });
  });

  it("gives an existing user without a local role the default role as a local set", async () => {
    const { sync, ctx, updateUser } = setup("student", {
      u1: { role: "teacher", roleSource: "keycloak" },
    });
    const data = oauth("sign-in", "keycloak", { realm_access: { roles: [] } }, { id: "u1" });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(updateUser).toHaveBeenCalledWith("u1", {
      role: "student",
      roleSource: "local",
      roleChannel: "local",
    });
  });

  it("still refuses a conflicting IdP set when the user holds local roles", async () => {
    const { sync, ctx } = setup(undefined, { u1: { role: "teacher", roleSource: "local" } });
    const claims = { roles: ["edulims-student", "edulims-teacher"] };
    const data = oauth("sign-in", "microsoft", claims, { id: "u1" });
    const lines = await logged(async () => {
      expect(await sync(data, ctx)).toMatchObject({ error: ROLE_CONFLICT_ERROR });
    });
    expect(events(lines, "idp_role_conflict")).toEqual([
      expect.objectContaining({ reason: ROLE_CONFLICT_ERROR, provider: "microsoft" }),
    ]);
  });
});

describe("the activity log of the IdP role sync (B4)", () => {
  let db: Kysely<DB> | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await db?.destroy();
    db = undefined;
  });

  async function audited(stored: Stored = {}) {
    const database = await createTestDb();
    db = database;
    const ctx = {
      context: {
        internalAdapter: {
          updateUser: vi.fn(async () => null),
          deleteUserSessions: vi.fn(async () => undefined),
          findUserById: vi.fn(async (id: string) => stored[id] ?? null),
        },
        edulimsAudit: new AuditRecorder(database),
      },
      headers: new Headers({ "x-request-id": "req-idp" }),
    } as unknown as Ctx;
    const sync = createIdpRoleSync({ settingsOf: providersWith() });
    const rows = () =>
      database
        .selectFrom("audit_event")
        .select(["action", "actor_type", "target_id", "outcome", "reason_code", "provider"])
        .select(["request_id", "metadata"])
        .execute();
    return { sync, ctx, rows };
  }

  it("records a role_conflict refusal with the user id and the provider", async () => {
    const { sync, ctx, rows } = await audited();
    const claims = { roles: ["edulims-student", "edulims-admin"] };
    const lines = await logged(async () => {
      await sync(oauth("sign-in", "microsoft", claims, { id: "u2" }), ctx);
    });
    expect(events(lines, "authn_login_fail")).toEqual([
      expect.objectContaining({ target_id: "u2", reason: ROLE_CONFLICT_ERROR }),
    ]);
    expect(await rows()).toEqual([
      {
        action: "authn_login_fail",
        actor_type: "anonymous",
        target_id: "u2",
        outcome: "refused",
        reason_code: ROLE_CONFLICT_ERROR,
        provider: "microsoft",
        request_id: "req-idp",
        metadata: null,
      },
    ]);
  });

  it("sends a recorded refusal to the security log once, through the activity log", async () => {
    const { lines, restore } = captureSecurityLog();
    const { sync, ctx, rows } = await audited();
    try {
      await sync(oauth("sign-in", "disabled", {}, { id: "u4" }), ctx);
    } finally {
      restore();
    }
    expect(await rows()).toHaveLength(1);
    expect(events(lines, "authn_login_fail")).toEqual([
      expect.objectContaining({
        reason: PROVIDER_DISABLED_ERROR,
        target_id: "u4",
        request_id: "req-idp",
      }),
    ]);
  });

  it("records a no_edulims_role refusal of a first sign-in without a target", async () => {
    const { sync, ctx, rows } = await audited();
    await sync(oauth("create-user", "keycloak", { realm_access: { roles: [] } }), ctx);
    expect(await rows()).toEqual([
      expect.objectContaining({
        action: "authn_login_fail",
        target_id: null,
        reason_code: NO_ROLE_ERROR,
        provider: "keycloak",
      }),
    ]);
  });

  it("records a role change the IdP made, with the old and the new set", async () => {
    const { sync, ctx, rows } = await audited({ u3: { role: "student", roleSource: "microsoft" } });
    const user = { id: "u3", role: "student" };
    await sync(oauth("sign-in", "microsoft", { roles: ["edulims-teacher"] }, user), ctx);
    expect(await rows()).toEqual([
      expect.objectContaining({
        action: "authz_role_change",
        actor_type: "system",
        target_id: "u3",
        outcome: "success",
        metadata: { roles: "teacher", previous_roles: "student" },
      }),
    ]);
  });

  it("records nothing when the role is unchanged", async () => {
    const { sync, ctx, rows } = await audited({ u4: { role: "teacher", roleSource: "microsoft" } });
    const user = { id: "u4", role: "teacher" };
    await sync(oauth("sign-in", "microsoft", { roles: ["edulims-teacher"] }, user), ctx);
    expect(await rows()).toEqual([]);
  });
});
