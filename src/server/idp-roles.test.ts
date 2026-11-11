// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { highestRole, parseRoleMap, readClaim, resolveIdpRole } from "./idp-roles.ts";

const roleMap = parseRoleMap("edulims-student:student,edulims-docent:docent,beheer:beheerder");

describe("parseRoleMap", () => {
  it("parses entries, trimming whitespace and skipping empty ones", () => {
    expect([...parseRoleMap(" a:student , urn:x:docent ,,b:beheerder")]).toEqual([
      ["a", "student"],
      ["urn:x", "docent"],
      ["b", "beheerder"],
    ]);
  });

  it.each([
    ["", /at least one/],
    ["student", /invalid entry/],
    [":student", /invalid entry/],
    ["x:admin", /invalid entry/],
    ["x:student,x:docent", /duplicate/],
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

describe("highestRole", () => {
  it("prefers beheerder over docent over student", () => {
    expect(highestRole(["student", "beheerder", "docent"])).toBe("beheerder");
    expect(highestRole(["student", "docent"])).toBe("docent");
    expect(highestRole([])).toBeNull();
  });
});

describe("resolveIdpRole", () => {
  it("maps Entra app roles from the `roles` claim", () => {
    const claims = { roles: ["edulims-docent"] };
    expect(resolveIdpRole({ claims, claimPath: "roles", roleMap })).toBe("docent");
  });

  it("maps Keycloak realm roles and keeps the highest", () => {
    const claims = { realm_access: { roles: ["offline_access", "edulims-student", "beheer"] } };
    expect(resolveIdpRole({ claims, claimPath: "realm_access.roles", roleMap })).toBe("beheerder");
  });

  it("maps Keycloak client roles through a configured path", () => {
    const claims = { resource_access: { edulims: { roles: ["edulims-student"] } } };
    const claimPath = "resource_access.edulims.roles";
    expect(resolveIdpRole({ claims, claimPath, roleMap })).toBe("student");
  });

  it("accepts a single string claim and ignores non-string entries", () => {
    expect(resolveIdpRole({ claims: { role: "edulims-docent" }, claimPath: "role", roleMap })).toBe(
      "docent",
    );
    const claims = { roles: [42, null, "edulims-student"] };
    expect(resolveIdpRole({ claims, claimPath: "roles", roleMap })).toBe("student");
  });

  it("denies (null) when no role is mapped, matching names case-sensitively", () => {
    expect(
      resolveIdpRole({ claims: { roles: ["EDULIMS-DOCENT"] }, claimPath: "roles", roleMap }),
    ).toBeNull();
    expect(resolveIdpRole({ claims: {}, claimPath: "roles", roleMap })).toBeNull();
    expect(resolveIdpRole({ claims: { roles: {} }, claimPath: "roles", roleMap })).toBeNull();
  });

  it("falls back to the opt-in default role only when nothing is mapped", () => {
    expect(
      resolveIdpRole({ claims: {}, claimPath: "roles", roleMap, defaultRole: "student" }),
    ).toBe("student");
    const claims = { roles: ["edulims-docent"] };
    expect(resolveIdpRole({ claims, claimPath: "roles", roleMap, defaultRole: "student" })).toBe(
      "docent",
    );
  });
});
