// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { type IdentityProviderOption, providerIdOf } from "../lib/identity-providers.ts";
import { validateRoleSet } from "../lib/roles.ts";
import { DEV_PASSWORD, DEV_USERS, demoAccountsFor } from "./demo-accounts";

function option(id: string): IdentityProviderOption {
  return { id: providerIdOf(id), label: id, icon: "key-round", protocol: "oidc" };
}

describe("demoAccountsFor", () => {
  it("returns no demo data when the development login is off", () => {
    expect(demoAccountsFor(false, [option("keycloak"), option("entra")])).toBeNull();
    expect(demoAccountsFor(false, [])).toBeNull();
  });

  it("lists one dev-login account per allowed role set with the shared password", () => {
    const accounts = demoAccountsFor(true, []);
    expect(accounts?.devLogin).toEqual([
      { roles: ["student"], username: "student@example.test", password: DEV_PASSWORD },
      { roles: ["teacher"], username: "teacher@example.test", password: DEV_PASSWORD },
      { roles: ["admin"], username: "admin@example.test", password: DEV_PASSWORD },
      {
        roles: ["teacher", "admin"],
        username: "teacher-admin@example.test",
        password: DEV_PASSWORD,
      },
    ]);
  });

  it("lists the Keycloak realm users only when Keycloak is configured", () => {
    expect(demoAccountsFor(true, [option("entra")])?.keycloak).toBeNull();
    const keycloak = demoAccountsFor(true, [option("keycloak-saml")])?.keycloak;
    expect(keycloak?.realm).toBe("edulims");
    expect(
      keycloak?.accounts.map((a) => [a.username, a.roles, a.grant ?? null, a.refusal ?? null]),
    ).toEqual([
      ["student", ["student"], "groups", null],
      ["teacher", ["teacher"], "groups", null],
      ["admin", ["admin"], "direct", null],
      ["coordinator", ["teacher", "admin"], "groups", null],
      ["teacher-direct", ["teacher"], "direct", null],
      ["mixed", ["teacher", "admin"], "groups-and-direct", null],
      ["conflict", [], "groups", "conflict"],
      ["norole", [], null, "no-role"],
    ]);
    expect(keycloak?.accounts.every((account) => account.password === account.username)).toBe(true);
  });

  it("seeds only allowed role sets (ADR 0012)", () => {
    for (const user of DEV_USERS) expect(validateRoleSet(user.roles).ok).toBe(true);
  });
});
