// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { roles } from "./roles.ts";

describe("admin access control (B1, R-01)", () => {
  it.each(["impersonate", "impersonate-admins", "set-password", "set-email", "set-phone"] as const)(
    "refuses user:%s",
    (action) => {
      expect(roles.admin.authorize({ user: [action] }).success).toBe(false);
    },
  );

  it("allows the user management B1 needs", () => {
    expect(
      roles.admin.authorize({ user: ["create", "list", "get", "update", "set-role", "ban"] })
        .success,
    ).toBe(true);
    expect(roles.admin.authorize({ session: ["list", "revoke"] }).success).toBe(true);
  });

  it.each(["student", "teacher"] as const)("gives %s no admin actions", (role) => {
    expect(roles[role].authorize({ user: ["list"] }).success).toBe(false);
    expect(roles[role].authorize({ user: ["impersonate"] }).success).toBe(false);
  });
});
