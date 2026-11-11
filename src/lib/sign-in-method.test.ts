// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { providerIdOf } from "./identity-providers.ts";
import { isLocallyEditable, parseRoleSource } from "./role-source.ts";
import { offeredSignInMethod, parseSignInMethod } from "./sign-in-method.ts";

const keycloak = providerIdOf("keycloak");
const entra = providerIdOf("entra");

describe("offeredSignInMethod (the login hint, #34)", () => {
  it("returns a configured identity provider from the cookie", () => {
    expect(offeredSignInMethod("keycloak", [entra, keycloak], false)).toBe("keycloak");
  });

  it("gives no hint for a provider that is no longer configured", () => {
    expect(offeredSignInMethod("keycloak", [entra], true)).toBeNull();
  });

  it("names the development login only while it is on", () => {
    expect(offeredSignInMethod("credential", [], true)).toBe("credential");
    expect(offeredSignInMethod("credential", [], false)).toBeNull();
  });

  it("ignores a missing or tampered cookie", () => {
    expect(offeredSignInMethod(undefined, [entra], true)).toBeNull();
    expect(offeredSignInMethod("<script>", [entra], true)).toBeNull();
    expect(parseSignInMethod("Email Login")).toBeNull();
    expect(parseSignInMethod("local")).toBeNull();
  });
});

describe("role sources (owner decision on #32)", () => {
  it("parses the stored sources and nothing else", () => {
    expect(parseRoleSource("local")).toBe("local");
    expect(parseRoleSource("keycloak")).toBe("keycloak");
    expect(parseRoleSource("credential")).toBeNull();
    expect(parseRoleSource("Not A Slug")).toBeNull();
  });

  it("takes any provider id as a role source (ADR 0015), never a reserved id", () => {
    expect(parseRoleSource("entra")).toBe("entra");
    expect(parseRoleSource("keycloak-saml")).toBe("keycloak-saml");
  });

  it("allows editing a local set only", () => {
    expect(isLocallyEditable("local")).toBe(true);
    expect(isLocallyEditable(entra)).toBe(false);
    expect(isLocallyEditable(null)).toBe(false);
  });
});
