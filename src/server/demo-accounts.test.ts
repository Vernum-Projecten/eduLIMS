// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DEV_PASSWORD, demoAccountsFor } from "./demo-accounts";

describe("demoAccountsFor", () => {
  it("returns no demo data when the development login is off", () => {
    expect(demoAccountsFor(false, [{ id: "keycloak" }, { id: "microsoft" }])).toBeNull();
    expect(demoAccountsFor(false, [])).toBeNull();
  });

  it("lists one dev-login account per role with the shared password", () => {
    const accounts = demoAccountsFor(true, []);
    expect(accounts?.devLogin).toEqual([
      { role: "student", username: "student@example.test", password: DEV_PASSWORD },
      { role: "teacher", username: "teacher@example.test", password: DEV_PASSWORD },
      { role: "admin", username: "admin@example.test", password: DEV_PASSWORD },
    ]);
  });

  it("lists the Keycloak realm users only when Keycloak is configured", () => {
    expect(demoAccountsFor(true, [{ id: "microsoft" }])?.keycloak).toBeNull();
    expect(demoAccountsFor(true, [{ id: "keycloak", label: "Campus" }])?.keycloak).toEqual({
      realm: "edulims",
      accounts: [
        { role: "student", username: "student", password: "student" },
        { role: "teacher", username: "teacher", password: "teacher" },
        { role: "admin", username: "admin", password: "admin" },
      ],
    });
  });
});
