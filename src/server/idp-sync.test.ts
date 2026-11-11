// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NO_ROLE_ERROR,
  PROVIDER_DISABLED_ERROR,
  providerIdOf,
  ROLE_CONFLICT_ERROR,
} from "../lib/identity-providers.ts";
import type { Role } from "../lib/roles.ts";
import { AuditRecorder } from "./audit/better-auth-hooks.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import type { ProviderSettingsView } from "./idp/registry.ts";
import { parseRoleMap } from "./idp-roles.ts";
import { createIdpRoleSync, type IdpRoleSyncOptions } from "./idp-sync.ts";

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
type Stored = Readonly<Record<string, { role: string; roleSource: string }>>;

function setup(defaultRole?: "student", stored: Stored = {}) {
  const updateUser = vi.fn(async () => null);
  const deleteUserSessions = vi.fn(async () => undefined);
  const findUserById = vi.fn(async (id: string) => stored[id] ?? null);
  const ctx = {
    context: { internalAdapter: { updateUser, deleteUserSessions, findUserById } },
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sync, ctx, deleteUserSessions } = setup();
    const claims = { roles: ["edulims-student", "edulims-admin"] };
    const data = oauth("link-account", "microsoft", claims, { id: "u2" });
    expect(await sync(data, ctx)).toMatchObject({ error: ROLE_CONFLICT_ERROR });
    expect(deleteUserSessions).toHaveBeenCalledWith("u2");
    vi.restoreAllMocks();
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
    });
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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sync, ctx, updateUser } = setup("student");
    const data = oauth(
      "sign-in",
      "keycloak",
      { email: "u@example.test", realm_access: { roles: ["edulims-student", "edulims-teacher"] } },
      { id: "u1", email: "u@example.test", name: "Test Student" },
    );
    expect(await sync(data, ctx)).toMatchObject({ error: ROLE_CONFLICT_ERROR });
    expect(updateUser).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(ROLE_CONFLICT_ERROR);
    expect(logged).not.toMatch(/u1|example\.test|Test Student/);
    warn.mockRestore();
  });

  it("refuses a conflicting set on a first sign-in too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sync, ctx } = setup();
    const data = oauth("create-user", "microsoft", { roles: ["edulims-student", "edulims-admin"] });
    expect(await sync(data, ctx)).toMatchObject({ error: ROLE_CONFLICT_ERROR });
    expect(data.user["role"]).toBeUndefined();
    vi.restoreAllMocks();
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
    expect(updateUser).toHaveBeenCalledWith("u1", { role: "admin", roleSource: "microsoft" });
  });

  it("moves an unchanged set to the IdP as its source", async () => {
    const { sync, ctx, updateUser } = setup(undefined, {
      u1: { role: "teacher", roleSource: "local" },
    });
    const data = oauth("sign-in", "microsoft", { roles: ["edulims-teacher"] }, { id: "u1" });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(updateUser).toHaveBeenCalledWith("u1", { role: "teacher", roleSource: "microsoft" });
  });

  it("gives an existing user without a local role the default role as a local set", async () => {
    const { sync, ctx, updateUser } = setup("student", {
      u1: { role: "teacher", roleSource: "keycloak" },
    });
    const data = oauth("sign-in", "keycloak", { realm_access: { roles: [] } }, { id: "u1" });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(updateUser).toHaveBeenCalledWith("u1", { role: "student", roleSource: "local" });
  });

  it("still refuses a conflicting IdP set when the user holds local roles", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sync, ctx } = setup(undefined, { u1: { role: "teacher", roleSource: "local" } });
    const claims = { roles: ["edulims-student", "edulims-teacher"] };
    const data = oauth("sign-in", "microsoft", claims, { id: "u1" });
    expect(await sync(data, ctx)).toMatchObject({ error: ROLE_CONFLICT_ERROR });
    vi.restoreAllMocks();
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sync, ctx, rows } = await audited();
    const claims = { roles: ["edulims-student", "edulims-admin"] };
    await sync(oauth("sign-in", "microsoft", claims, { id: "u2" }), ctx);
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
