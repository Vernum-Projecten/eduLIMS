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

  describe("a user the provider provisioned over SCIM (#45)", () => {
    const campus = providerIdOf("campus");

    it("keeps the set its SCIM groups mapped when the sign-in carries no mapped role", () => {
      expect(
        decideSignInRoles(
          none,
          { role: "teacher", roleSource: campus, roleChannel: "scim", provisionedBy: campus },
          "student",
          campus,
        ),
      ).toEqual({ kind: "scim", roles: ["teacher"] });
    });

    it("drops admin a claim gave once the next sign-in has no mapped claim (B1, V8.2.1)", () => {
      expect(
        decideSignInRoles(
          none,
          { role: "admin", roleSource: campus, roleChannel: "claim", provisionedBy: campus },
          "student",
          campus,
        ),
      ).toEqual({ kind: "refused", reason: NO_ROLE_ERROR });
    });

    it("has no roles, and no default role, until the directory or an administrator gives one", () => {
      expect(
        decideSignInRoles(
          none,
          { role: null, roleSource: "local", provisionedBy: campus },
          "student",
          campus,
        ),
      ).toEqual({ kind: "refused", reason: NO_ROLE_ERROR });
      expect(
        decideSignInRoles(
          none,
          { role: null, roleSource: campus, roleChannel: "scim", provisionedBy: campus },
          "student",
          campus,
        ),
      ).toEqual({ kind: "refused", reason: NO_ROLE_ERROR });
    });

    it("keeps a local set an administrator assigned", () => {
      expect(
        decideSignInRoles(
          none,
          { role: "student", roleSource: "local", provisionedBy: campus },
          undefined,
          campus,
        ),
      ).toEqual({ kind: "local", roles: ["student"] });
    });

    it("lets a mapped claim of the same provider replace the set", () => {
      expect(
        decideSignInRoles(
          { kind: "roles", roles: ["admin"] },
          { role: "teacher", roleSource: campus, roleChannel: "scim", provisionedBy: campus },
          undefined,
          campus,
        ),
      ).toEqual({ kind: "idp", roles: ["admin"] });
    });

    it("treats a sign-in through another provider like any other user", () => {
      const other = providerIdOf("other");
      expect(
        decideSignInRoles(
          none,
          { role: "teacher", roleSource: campus, provisionedBy: campus },
          "student",
          other,
        ),
      ).toEqual({ kind: "default", roles: ["student"] });
    });
  });
});
