// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Hybrid role ownership for SCIM-provisioned users (owner decision on #32, #45, ADR 0012).
import { describe, expect, it } from "vitest";
import { providerIdOf } from "../../lib/identity-providers.ts";
import { parseRoleMap } from "../idp-roles.ts";
import { scimRoleValues } from "./provisioning.ts";
import { decideScimRoles, mapScimFacts } from "./roles.ts";

const CAMPUS = providerIdOf("campus");
const MAP = parseRoleMap("grp-teachers:teacher,Students:student,grp-admins:admin");

describe("mapScimFacts", () => {
  it("maps a group by its externalId first, then its display name", () => {
    expect(mapScimFacts([{ keys: ["grp-teachers", "Staff"] }], MAP)).toEqual(["teacher"]);
    expect(mapScimFacts([{ keys: ["unmapped", "Students"] }], MAP)).toEqual(["student"]);
  });

  it("maps nothing the role map does not name, admin included", () => {
    expect(mapScimFacts([{ keys: ["admin", "Administrators"] }], MAP)).toEqual([]);
  });
});

describe("decideScimRoles", () => {
  it("stores a mapped set with the provider as its source", () => {
    expect(decideScimRoles(["admin", "teacher"], { roleSource: "local" }, CAMPUS)).toEqual({
      kind: "set",
      role: "teacher,admin",
      roleSource: CAMPUS,
    });
  });

  it("leaves no roles for a conflicting set (student with teacher)", () => {
    expect(decideScimRoles(["student", "teacher"], { roleSource: "local" }, CAMPUS)).toEqual({
      kind: "set",
      role: null,
      roleSource: CAMPUS,
      reason: "role_conflict",
    });
  });

  it("takes away a set this provider once sent (A07)", () => {
    expect(decideScimRoles([], { roleSource: CAMPUS }, CAMPUS)).toEqual({
      kind: "set",
      role: null,
      roleSource: "local",
    });
  });

  it("keeps a local set, or a set another provider owns", () => {
    expect(decideScimRoles([], { roleSource: "local" }, CAMPUS)).toEqual({ kind: "unchanged" });
    expect(decideScimRoles([], { roleSource: providerIdOf("other") }, CAMPUS)).toEqual({
      kind: "unchanged",
    });
  });
});

describe("scimRoleValues", () => {
  it("reads the `roles` values of a stored SCIM User", () => {
    const stored = JSON.stringify({ roles: [{ value: "grp-teachers" }, { value: "" }, {}] });
    expect(scimRoleValues(stored)).toEqual(["grp-teachers"]);
  });

  it("returns nothing for no attributes, bad JSON or a non-list", () => {
    expect(scimRoleValues(null)).toEqual([]);
    expect(scimRoleValues("{")).toEqual([]);
    expect(scimRoleValues(JSON.stringify({ roles: "teacher" }))).toEqual([]);
  });
});
