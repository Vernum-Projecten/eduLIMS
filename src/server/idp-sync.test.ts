// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { NO_ROLE_ERROR, ROLE_CONFLICT_ERROR } from "../lib/identity-providers.ts";
import { parseRoleMap } from "./idp-roles.ts";
import { createIdpRoleSync } from "./idp-sync.ts";

type Sync = ReturnType<typeof createIdpRoleSync>;
type Data = Parameters<Sync>[0];
type Ctx = Parameters<Sync>[1];

const roleMap = parseRoleMap("edulims-student:student,edulims-teacher:teacher,edulims-admin:admin");
const claimPaths = { microsoft: "roles", keycloak: "realm_access.roles" };

function setup(defaultRole?: "student") {
  const updateUser = vi.fn(async () => null);
  const ctx = { context: { internalAdapter: { updateUser } } } as unknown as Ctx;
  const sync = createIdpRoleSync({ claimPaths, roleMap, defaultRole });
  return { sync, ctx, updateUser };
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
