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
    ["docent, beheerder", ["docent", "beheerder"]],
    ["docent,docent", ["docent"]],
    ["admin,Student,docent", ["docent"]],
  ] as const)("parses %j", (input, expected) => {
    expect(parseRoles(input)).toEqual(expected);
  });
});

describe("hasRole / hasAnyRole", () => {
  it("is false without a user", () => {
    expect(hasRole(null, "student")).toBe(false);
    expect(hasAnyRole(undefined, ["student", "docent"])).toBe(false);
  });

  it("checks role membership", () => {
    const docent = user("d1", "docent");
    expect(hasRole(docent, "docent")).toBe(true);
    expect(hasRole(docent, "beheerder")).toBe(false);
    expect(hasAnyRole(docent, ["student", "docent"])).toBe(true);
    expect(hasAnyRole(docent, [])).toBe(false);
  });
});

describe("portalPathFor", () => {
  it.each([
    [["student"], "/student"],
    [["docent"], "/docent"],
    [["beheerder"], "/beheer"],
    [["student", "beheerder"], "/beheer"],
    [["student", "docent"], "/docent"],
    [[], null],
  ] as const)("roles %j land on %s", (roles, expected) => {
    expect(portalPathFor({ roles })).toBe(expected);
  });
});

describe("canViewResultsOf", () => {
  const scope = { ownerId: "s1", docentId: "d1" };

  it("lets a student see only their own results", () => {
    expect(canViewResultsOf(user("s1", "student"), scope)).toBe(true);
    expect(canViewResultsOf(user("s2", "student"), scope)).toBe(false);
  });

  it("lets a docent see results of their own practica only", () => {
    expect(canViewResultsOf(user("d1", "docent"), scope)).toBe(true);
    expect(canViewResultsOf(user("d2", "docent"), scope)).toBe(false);
  });

  it("does not let a student id match the docent slot", () => {
    expect(canViewResultsOf(user("d1", "student"), scope)).toBe(false);
  });

  it("denies beheerders, users without roles and anonymous visitors", () => {
    expect(canViewResultsOf(user("b1", "beheerder"), { ownerId: "b1", docentId: "b1" })).toBe(
      false,
    );
    expect(canViewResultsOf(user("s1"), scope)).toBe(false);
    expect(canViewResultsOf(null, scope)).toBe(false);
  });
});
