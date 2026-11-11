// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { NO_ROLE_ERROR } from "../lib/identity-providers.ts";
import { parseRoleMap } from "./idp-roles.ts";
import { createIdpRoleSync } from "./idp-sync.ts";

type Sync = ReturnType<typeof createIdpRoleSync>;
type Data = Parameters<Sync>[0];
type Ctx = Parameters<Sync>[1];

const roleMap = parseRoleMap("edulims-student:student,edulims-docent:docent");
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
    const data = oauth("create-user", "microsoft", { roles: ["edulims-docent"] });
    expect(await sync(data, ctx)).toBeUndefined();
    expect(data.user["role"]).toBe("docent");
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
