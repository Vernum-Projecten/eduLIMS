// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { NO_ROLE_ERROR, providerIdOf, ROLE_CONFLICT_ERROR } from "../lib/identity-providers.ts";
import { decideSignInRoles } from "./role-ownership.ts";

const none = { kind: "none" } as const;

describe("decideSignInRoles (hybrid role ownership, owner decision on #32)", () => {
  it("lets a mapped IdP role replace any stored set", () => {
    expect(
      decideSignInRoles(
        { kind: "roles", roles: ["admin"] },
        { role: "teacher", roleSource: "local" },
        "student",
      ),
    ).toEqual({ kind: "idp", roles: ["admin"] });
  });

  it("refuses a conflicting IdP set, even over local roles", () => {
    expect(
      decideSignInRoles({ kind: "conflict" }, { role: "teacher", roleSource: "local" }, undefined),
    ).toEqual({ kind: "refused", reason: ROLE_CONFLICT_ERROR });
  });

  it("keeps an allowed local set when the IdP sends none", () => {
    expect(
      decideSignInRoles(none, { role: "teacher,admin", roleSource: "local" }, "student"),
    ).toEqual({ kind: "local", roles: ["teacher", "admin"] });
  });

  it("does not keep a set the IdP sent before (A07)", () => {
    expect(
      decideSignInRoles(none, { role: "teacher", roleSource: providerIdOf("entra") }, undefined),
    ).toEqual({
      kind: "refused",
      reason: NO_ROLE_ERROR,
    });
  });

  it("does not keep a stored local set that is not allowed", () => {
    expect(
      decideSignInRoles(none, { role: "student,admin", roleSource: "local" }, undefined),
    ).toEqual({ kind: "refused", reason: NO_ROLE_ERROR });
  });

  it("falls back to the default role, then refuses", () => {
    expect(decideSignInRoles(none, null, "student")).toEqual({
      kind: "default",
      roles: ["student"],
    });
    expect(decideSignInRoles(none, null, undefined)).toEqual({
      kind: "refused",
      reason: NO_ROLE_ERROR,
    });
  });

  describe("SCIM is authoritative for a user it provisioned (#45, second review finding 5)", () => {
    const campus = providerIdOf("campus");
    const scimTeacher = {
      role: "teacher",
      roleSource: campus,
      roleChannel: "scim" as const,
      provisionedBy: campus,
    };

    it("keeps the stored set when the sign-in carries no mapped role", () => {
      expect(decideSignInRoles(none, scimTeacher, "student", campus)).toEqual({
        kind: "scim",
        roles: ["teacher"],
      });
    });

    it("never adds a role a claim maps, admin included", () => {
      expect(
        decideSignInRoles({ kind: "roles", roles: ["admin"] }, scimTeacher, undefined, campus),
      ).toEqual({ kind: "scim", roles: ["teacher"] });
    });

    it("never refuses on a conflicting claim either: the claim does not count", () => {
      expect(decideSignInRoles({ kind: "conflict" }, scimTeacher, undefined, campus)).toEqual({
        kind: "scim",
        roles: ["teacher"],
      });
    });

    it("keeps a local set an administrator assigned", () => {
      expect(
        decideSignInRoles(
          { kind: "roles", roles: ["admin"] },
          { role: "student", roleSource: "local", roleChannel: "local", provisionedBy: campus },
          undefined,
          campus,
        ),
      ).toEqual({ kind: "scim", roles: ["student"] });
    });

    it("has no roles, and no default role, until the directory or an administrator gives one", () => {
      expect(
        decideSignInRoles(
          { kind: "roles", roles: ["teacher"] },
          { role: null, roleSource: "local", roleChannel: "local", provisionedBy: campus },
          "student",
          campus,
        ),
      ).toEqual({ kind: "refused", reason: NO_ROLE_ERROR });
    });
  });

  describe("a user SCIM did not provision keeps the claim rules (finding 5, the other way)", () => {
    const campus = providerIdOf("campus");

    it("drops admin a claim gave once the next sign-in has no mapped claim (B1, V8.2.1)", () => {
      expect(
        decideSignInRoles(
          none,
          { role: "admin", roleSource: campus, roleChannel: "claim", provisionedBy: null },
          undefined,
          campus,
        ),
      ).toEqual({ kind: "refused", reason: NO_ROLE_ERROR });
    });

    it("lets a mapped claim replace the set", () => {
      expect(
        decideSignInRoles(
          { kind: "roles", roles: ["admin"] },
          { role: "teacher", roleSource: campus, roleChannel: "claim", provisionedBy: null },
          undefined,
          campus,
        ),
      ).toEqual({ kind: "idp", roles: ["admin"] });
    });

    it("treats a user another provider provisioned like any other user", () => {
      expect(
        decideSignInRoles(
          none,
          {
            role: "teacher",
            roleSource: campus,
            roleChannel: "scim",
            provisionedBy: campus,
          },
          "student",
          providerIdOf("other"),
        ),
      ).toEqual({ kind: "default", roles: ["student"] });
    });
  });
});
