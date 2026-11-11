// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  formatRoles,
  isRole,
  type Role,
  roles,
  sortRoles,
  validateRoleSet,
  validateRoleValue,
} from "./roles.ts";

describe("validateRoleSet (ADR 0012: student is exclusive)", () => {
  it.each([
    [["student"], ["student"]],
    [["teacher"], ["teacher"]],
    [["admin"], ["admin"]],
    [
      ["teacher", "admin"],
      ["teacher", "admin"],
    ],
    [
      ["admin", "teacher"],
      ["teacher", "admin"],
    ],
  ] as const)("allows %j", (set, sorted) => {
    expect(validateRoleSet(set)).toEqual({ ok: true, roles: sorted });
  });

  it.each([
    [["student", "teacher"]],
    [["student", "admin"]],
    [["student", "teacher", "admin"]],
  ] as const)("refuses %j as a conflict", (set) => {
    expect(validateRoleSet(set)).toEqual({ ok: false, reason: "conflict" });
  });

  it("refuses the empty set", () => {
    expect(validateRoleSet([])).toEqual({ ok: false, reason: "empty" });
  });

  it("ignores duplicates", () => {
    expect(validateRoleSet(["teacher", "teacher", "admin"])).toEqual({
      ok: true,
      roles: ["teacher", "admin"],
    });
  });
});

describe("sortRoles / formatRoles", () => {
  it("orders student, teacher, admin and drops duplicates", () => {
    const set: Role[] = ["admin", "teacher", "admin"];
    expect(sortRoles(set)).toEqual(["teacher", "admin"]);
    expect(formatRoles(set)).toBe("teacher,admin");
  });
});

describe("validateRoleValue (the role column)", () => {
  it.each([
    ["teacher,admin", ["teacher", "admin"]],
    ["admin, teacher", ["teacher", "admin"]],
    [
      ["admin", "teacher"],
      ["teacher", "admin"],
    ],
    ["student", ["student"]],
  ] as const)("accepts %j", (value, sorted) => {
    expect(validateRoleValue(value)).toEqual({ ok: true, roles: sorted });
  });

  it.each([["student,teacher"], [["student", "admin"]]])("refuses %j as a conflict", (value) => {
    expect(validateRoleValue(value)).toEqual({ ok: false, reason: "conflict" });
  });

  it.each([["user"], ["teacher,superuser"], [""], [null], [42], [["teacher", 1]]])(
    "refuses %j as unknown",
    (value) => {
      expect(validateRoleValue(value)).toEqual({ ok: false, reason: "unknown" });
    },
  );
});

describe("isRole", () => {
  it("accepts the three role names only", () => {
    expect(["student", "teacher", "admin"].every(isRole)).toBe(true);
    expect(["Admin" as unknown, "user", null, 1].some(isRole)).toBe(false);
  });
});

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
