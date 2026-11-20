// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { Role } from "../lib/roles.ts";
import {
  hasAnyRole,
  hasRole,
  landingPortal,
  parseLastPortal,
  parseRoles,
  portalPathFor,
  type SessionUser,
  sessionRoles,
} from "./authz.ts";

function user(id: string, ...roles: Role[]): SessionUser {
  return { id, name: id, email: `${id}@example.test`, roles, lastPortal: null };
}

describe("parseRoles", () => {
  it.each([
    [null, []],
    [undefined, []],
    ["", []],
    ["student", ["student"]],
    ["teacher, admin", ["teacher", "admin"]],
    ["teacher,teacher", ["teacher"]],
    ["superuser,Student,teacher", ["teacher"]],
  ] as const)("parses %j", (input, expected) => {
    expect(parseRoles(input)).toEqual(expected);
  });
});

describe("hasRole / hasAnyRole", () => {
  it("is false without a user", () => {
    expect(hasRole(null, "student")).toBe(false);
    expect(hasAnyRole(undefined, ["student", "teacher"])).toBe(false);
  });

  it("checks role membership", () => {
    const teacher = user("t1", "teacher");
    expect(hasRole(teacher, "teacher")).toBe(true);
    expect(hasRole(teacher, "admin")).toBe(false);
    expect(hasAnyRole(teacher, ["student", "teacher"])).toBe(true);
    expect(hasAnyRole(teacher, [])).toBe(false);
  });
});

describe("portalPathFor", () => {
  it.each([
    [["student"], "/student"],
    [["teacher"], "/teacher"],
    [["admin"], "/admin"],
    [["teacher", "admin"], "/teacher"],
    [["admin", "teacher"], "/teacher"],
    [[], null],
  ] as const)("roles %j land on %s on a first sign-in", (roles, expected) => {
    expect(portalPathFor({ roles })).toBe(expected);
  });

  it("lands on the saved portal", () => {
    expect(portalPathFor({ roles: ["teacher", "admin"], lastPortal: "admin" })).toBe("/admin");
  });
});

describe("landingPortal (ADR 0012)", () => {
  it("prefers the saved portal while the user holds its role", () => {
    expect(landingPortal({ roles: ["teacher", "admin"], lastPortal: "admin" })).toBe("admin");
    expect(landingPortal({ roles: ["teacher", "admin"], lastPortal: "teacher" })).toBe("teacher");
  });

  it("falls back teacher, then admin, then student without a saved portal", () => {
    expect(landingPortal({ roles: ["admin", "teacher"], lastPortal: null })).toBe("teacher");
    expect(landingPortal({ roles: ["admin"], lastPortal: null })).toBe("admin");
    expect(landingPortal({ roles: ["student"] })).toBe("student");
  });

  it("ignores a saved portal whose role the user no longer holds", () => {
    expect(landingPortal({ roles: ["teacher"], lastPortal: "admin" })).toBe("teacher");
    expect(landingPortal({ roles: ["admin"], lastPortal: "teacher" })).toBe("admin");
    expect(landingPortal({ roles: [], lastPortal: "admin" })).toBeNull();
  });
});

describe("sessionRoles", () => {
  it.each([
    ["student", ["student"]],
    ["teacher", ["teacher"]],
    ["admin", ["admin"]],
    ["teacher,admin", ["teacher", "admin"]],
    ["admin, teacher", ["teacher", "admin"]],
    ["student,teacher", []],
    ["student,admin", []],
    ["student,teacher,admin", []],
    ["superuser", []],
    [null, []],
  ] as const)("reads %j as %j", (role, expected) => {
    expect(sessionRoles(role)).toEqual(expected);
  });
});

describe("parseLastPortal", () => {
  it.each([
    ["teacher", "teacher"],
    ["admin", "admin"],
    ["student", "student"],
    ["Admin", null],
    ["", null],
    [null, null],
    [42, null],
  ])("reads %j as %j", (value, expected) => {
    expect(parseLastPortal(value)).toBe(expected);
  });
});
