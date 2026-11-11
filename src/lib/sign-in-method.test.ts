// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { idpRoleSource, isLocallyEditable, parseRoleSource } from "./role-source.ts";
import { offeredSignInMethod, parseSignInMethod } from "./sign-in-method.ts";

describe("offeredSignInMethod (the login hint, #34)", () => {
  it("returns a configured identity provider from the cookie", () => {
    expect(offeredSignInMethod("keycloak", ["microsoft", "keycloak"], false)).toBe("keycloak");
  });

  it("gives no hint for a provider that is no longer configured", () => {
    expect(offeredSignInMethod("keycloak", ["microsoft"], true)).toBeNull();
  });

  it("names the development login only while it is on", () => {
    expect(offeredSignInMethod("credential", [], true)).toBe("credential");
    expect(offeredSignInMethod("credential", [], false)).toBeNull();
  });

  it("ignores a missing or tampered cookie", () => {
    expect(offeredSignInMethod(undefined, ["microsoft"], true)).toBeNull();
    expect(offeredSignInMethod("<script>", ["microsoft"], true)).toBeNull();
    expect(parseSignInMethod("email")).toBeNull();
  });
});

describe("role sources (owner decision on #32)", () => {
  it("parses the stored sources and nothing else", () => {
    expect(parseRoleSource("local")).toBe("local");
    expect(parseRoleSource("keycloak")).toBe("keycloak");
    expect(parseRoleSource("idp")).toBeNull();
  });

  it("maps a provider id to its role source, never to local", () => {
    expect(idpRoleSource("microsoft")).toBe("microsoft");
    expect(idpRoleSource("local")).toBeNull();
    expect(idpRoleSource("github")).toBeNull();
  });

  it("allows editing a local set only", () => {
    expect(isLocallyEditable("local")).toBe(true);
    expect(isLocallyEditable("microsoft")).toBe(false);
    expect(isLocallyEditable(null)).toBe(false);
  });
});
