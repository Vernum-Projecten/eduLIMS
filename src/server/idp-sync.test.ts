// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_ROLE_ERROR, ROLE_CONFLICT_ERROR } from "../lib/identity-providers.ts";
import { AuditRecorder } from "./audit/better-auth-hooks.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import { parseRoleMap } from "./idp-roles.ts";
import { createIdpRoleSync } from "./idp-sync.ts";

type Sync = ReturnType<typeof createIdpRoleSync>;
type Data = Parameters<Sync>[0];
type Ctx = Parameters<Sync>[1];

const roleMap = parseRoleMap("edulims-student:student,edulims-teacher:teacher,edulims-admin:admin");
const claimPaths = { microsoft: "roles", keycloak: "realm_access.roles" };

function setup(defaultRole?: "student") {
  const updateUser = vi.fn(async () => null);
  const deleteUserSessions = vi.fn(async () => undefined);
  const ctx = {
    context: { internalAdapter: { updateUser, deleteUserSessions } },
  } as unknown as Ctx;
  const sync = createIdpRoleSync({ claimPaths, roleMap, defaultRole });
  return { sync, ctx, updateUser, deleteUserSessions };
}

function oauth(
  action: "create-user" | "sign-in" | "link-account",
  providerId: string,
  profile: Record<string, unknown>,
  user: Data["user"] = { email: "u@example.test" },
): Data {
  return { user, source: { action, method: "oauth", oauth: { providerId, profile } } };
}

describe("createIdpRoleSync", () => {
  it("writes the mapped role onto a new user", async () => {
    const { sync, ctx } = setup();
    const data = oauth("create-user", "microsoft", { roles: ["edulims-teacher"] });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(data.user["role"]).toBe("teacher");
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
    expect(updateUser).toHaveBeenCalledWith("u1", { role: "student" });
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

  it("rejects providers without a configured claim path", async () => {
    const { sync, ctx } = setup("student");
    expect(await sync(oauth("create-user", "github", {}), ctx)).toMatchObject({
      error: NO_ROLE_ERROR,
    });
  });

  it("uses the opt-in default role when nothing is mapped", async () => {
    const { sync, ctx } = setup("student");
    const data = oauth("create-user", "microsoft", {});
    expect(await sync(data, ctx)).toBeUndefined();
    expect(data.user["role"]).toBe("student");
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
    const { sync, ctx, updateUser } = setup();
    const data = oauth(
      "sign-in",
      "microsoft",
      { roles: ["edulims-teacher", "edulims-admin"] },
      { id: "u1", role: "teacher" },
    );
    expect(await sync(data, ctx)).toBeUndefined();
    expect(updateUser).toHaveBeenCalledWith("u1", { role: "teacher,admin" });
  });

  it("does not write an unchanged role set", async () => {
    const { sync, ctx, updateUser } = setup();
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

describe("the activity log of the IdP role sync (B4)", () => {
  let db: Kysely<DB> | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await db?.destroy();
    db = undefined;
  });

  async function audited() {
    const database = await createTestDb();
    db = database;
    const ctx = {
      context: {
        internalAdapter: {
          updateUser: vi.fn(async () => null),
          deleteUserSessions: vi.fn(async () => undefined),
        },
        edulimsAudit: new AuditRecorder(database),
      },
      headers: new Headers({ "x-request-id": "req-idp" }),
    } as unknown as Ctx;
    const sync = createIdpRoleSync({ claimPaths, roleMap });
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
    const { sync, ctx, rows } = await audited();
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
    const { sync, ctx, rows } = await audited();
    const user = { id: "u4", role: "teacher" };
    await sync(oauth("sign-in", "microsoft", { roles: ["edulims-teacher"] }, user), ctx);
    expect(await rows()).toEqual([]);
  });
});
