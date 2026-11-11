// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { parseRoleMap, readClaim, resolveIdpRoles } from "./idp-roles.ts";

const roleMap = parseRoleMap("edulims-student:student,edulims-teacher:teacher,lab-admins:admin");

describe("parseRoleMap", () => {
  it("parses entries, trimming whitespace and skipping empty ones", () => {
    expect([...parseRoleMap(" a:student , urn:x:teacher ,,b:admin")]).toEqual([
      ["a", "student"],
      ["urn:x", "teacher"],
      ["b", "admin"],
    ]);
  });

  it.each([
    ["", /at least one/],
    ["student", /invalid entry/],
    [":student", /invalid entry/],
    ["x:superuser", /invalid entry/],
    ["x:student,x:teacher", /duplicate/],
  ])("rejects %j", (text, error) => {
    expect(() => parseRoleMap(text)).toThrow(error);
  });
});

describe("readClaim", () => {
  const claims = { roles: ["a"], realm_access: { roles: ["b"] }, list: [{ x: 1 }] };

  it("reads top-level and nested claims", () => {
    expect(readClaim(claims, "roles")).toEqual(["a"]);
    expect(readClaim(claims, "realm_access.roles")).toEqual(["b"]);
  });

  it("returns undefined for missing paths and through arrays or scalars", () => {
    expect(readClaim(claims, "resource_access.edulims.roles")).toBeUndefined();
    expect(readClaim(claims, "list.x")).toBeUndefined();
    expect(readClaim(claims, "roles.length")).toBeUndefined();
  });
});

describe("resolveIdpRoles (ADR 0012)", () => {
  const resolve = (claims: Record<string, unknown>, claimPath = "roles", defaultRole?: "student") =>
    resolveIdpRoles({ claims, claimPath, roleMap, defaultRole });

  it("maps Entra app roles from the `roles` claim", () => {
    expect(resolve({ roles: ["edulims-teacher"] })).toEqual({ kind: "roles", roles: ["teacher"] });
  });

  it("maps every claim value to a role set, sorted", () => {
    const claims = { realm_access: { roles: ["lab-admins", "offline_access", "edulims-teacher"] } };
    expect(resolve(claims, "realm_access.roles")).toEqual({
      kind: "roles",
      roles: ["teacher", "admin"],
    });
  });

  it("maps two IdP names for the same role to one role", () => {
    const map = parseRoleMap("edulims-teacher:teacher,/Teachers:teacher");
    const claims = { roles: ["edulims-teacher", "/Teachers"] };
    expect(resolveIdpRoles({ claims, claimPath: "roles", roleMap: map })).toEqual({
      kind: "roles",
      roles: ["teacher"],
    });
  });

  it.each([
    [["edulims-student", "edulims-teacher"]],
    [["edulims-student", "lab-admins"]],
    [["edulims-student", "edulims-teacher", "lab-admins"]],
  ])("refuses the conflicting set %j instead of picking one role", (roles) => {
    expect(resolve({ roles })).toEqual({ kind: "conflict" });
    expect(resolve({ roles }, "roles", "student")).toEqual({ kind: "conflict" });
  });

  it("maps Keycloak client roles through a configured path", () => {
    const claims = { resource_access: { edulims: { roles: ["edulims-student"] } } };
    expect(resolve(claims, "resource_access.edulims.roles")).toEqual({
      kind: "roles",
      roles: ["student"],
    });
  });

  it("accepts a single string claim and ignores non-string entries", () => {
    expect(resolve({ role: "edulims-teacher" }, "role")).toEqual({
      kind: "roles",
      roles: ["teacher"],
    });
    expect(resolve({ roles: [42, null, "edulims-student"] })).toEqual({
      kind: "roles",
      roles: ["student"],
    });
  });

  it("denies when no role is mapped, matching names case-sensitively", () => {
    expect(resolve({ roles: ["EDULIMS-TEACHER"] })).toEqual({ kind: "none" });
    expect(resolve({})).toEqual({ kind: "none" });
    expect(resolve({ roles: {} })).toEqual({ kind: "none" });
  });

  it("falls back to the opt-in default role only when nothing is mapped", () => {
    expect(resolve({}, "roles", "student")).toEqual({ kind: "roles", roles: ["student"] });
    expect(resolve({ roles: ["edulims-teacher"] }, "roles", "student")).toEqual({
      kind: "roles",
      roles: ["teacher"],
    });
  });
});
