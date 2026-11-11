// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { Role } from "../lib/roles.ts";
import {
  canViewResultsOf,
  hasAnyRole,
  hasRole,
  parseRoles,
  portalPathFor,
  type SessionUser,
} from "./authz.ts";

function user(id: string, ...roles: Role[]): SessionUser {
  return { id, name: id, email: `${id}@example.test`, roles };
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
    [["student", "admin"], "/admin"],
    [["student", "teacher"], "/teacher"],
    [[], null],
  ] as const)("roles %j land on %s", (roles, expected) => {
    expect(portalPathFor({ roles })).toBe(expected);
  });
});

describe("canViewResultsOf", () => {
  const scope = { ownerId: "s1", teacherId: "t1" };

  it("lets a student see only their own results", () => {
    expect(canViewResultsOf(user("s1", "student"), scope)).toBe(true);
    expect(canViewResultsOf(user("s2", "student"), scope)).toBe(false);
  });

  it("lets a teacher see results of their own lab courses only", () => {
    expect(canViewResultsOf(user("t1", "teacher"), scope)).toBe(true);
    expect(canViewResultsOf(user("t2", "teacher"), scope)).toBe(false);
  });

  it("does not let a student id match the teacher slot", () => {
    expect(canViewResultsOf(user("t1", "student"), scope)).toBe(false);
  });

  it("denies admins, users without roles and anonymous visitors", () => {
    expect(canViewResultsOf(user("a1", "admin"), { ownerId: "a1", teacherId: "a1" })).toBe(false);
    expect(canViewResultsOf(user("s1"), scope)).toBe(false);
    expect(canViewResultsOf(null, scope)).toBe(false);
  });
});
