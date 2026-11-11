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
  it("maps a group with an externalId on it alone, never on its display name (M2)", () => {
    expect(mapScimFacts([{ keys: ["grp-teachers"] }], MAP)).toEqual(["teacher"]);
    // A renamed group called "Students" does not become the student group.
    expect(mapScimFacts([{ keys: ["unmapped"] }], MAP)).toEqual([]);
  });

  it("maps a group without an externalId on its display name", () => {
    expect(mapScimFacts([{ keys: ["Students"] }], MAP)).toEqual(["student"]);
  });

  it("maps nothing the role map does not name, admin included", () => {
    expect(mapScimFacts([{ keys: ["admin"] }, { keys: [] }], MAP)).toEqual([]);
  });
});

describe("decideScimRoles (SCIM authoritative for its users)", () => {
  const local = { roleSource: "local" as const, roleChannel: "local" };

  it("stores a mapped set with the provider as its source and scim as its channel", () => {
    expect(decideScimRoles(["admin", "teacher"], local, CAMPUS)).toEqual({
      kind: "set",
      role: "teacher,admin",
      roleSource: CAMPUS,
      roleChannel: "scim",
    });
  });

  it("replaces a set a claim gave when SCIM maps one (SCIM's on a SCIM write)", () => {
    expect(
      decideScimRoles(["teacher"], { roleSource: CAMPUS, roleChannel: "claim" }, CAMPUS),
    ).toMatchObject({ kind: "set", role: "teacher", roleChannel: "scim" });
  });

  it("leaves no roles for a conflicting set (student with teacher)", () => {
    expect(decideScimRoles(["student", "teacher"], local, CAMPUS)).toEqual({
      kind: "set",
      role: null,
      roleSource: CAMPUS,
      roleChannel: "scim",
      reason: "role_conflict",
    });
  });

  it("takes away a set SCIM once wrote (A07)", () => {
    expect(decideScimRoles([], { roleSource: CAMPUS, roleChannel: "scim" }, CAMPUS)).toEqual({
      kind: "set",
      role: null,
      roleSource: "local",
      roleChannel: "local",
    });
  });

  it("takes away a set a claim gave too: SCIM is authoritative for its users (finding 5)", () => {
    expect(decideScimRoles([], { roleSource: CAMPUS, roleChannel: "claim" }, CAMPUS)).toEqual({
      kind: "set",
      role: null,
      roleSource: "local",
      roleChannel: "local",
    });
  });

  it("keeps a local set, or a set another provider owns", () => {
    expect(decideScimRoles([], local, CAMPUS)).toEqual({ kind: "unchanged" });
    expect(
      decideScimRoles([], { roleSource: providerIdOf("other"), roleChannel: "scim" }, CAMPUS),
    ).toEqual({ kind: "unchanged" });
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
