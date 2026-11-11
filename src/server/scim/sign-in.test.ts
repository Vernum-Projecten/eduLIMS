// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Which value of a sign-in is the directory's externalId (#45, ADR 0017): the account key, a
// configured ID-token claim (OIDC, by dot path) or a SAML attribute (by its exact name).
import { describe, expect, it } from "vitest";
import { directoryIdOf } from "./sign-in.ts";

const REFERENCE = {
  providerId: "campus",
  source: { type: "configured" as const },
  authenticationConfigurationFingerprint: "f",
};
const USER = { email: "s.visser@example.test", emailVerified: true, name: "Sanne Visser" };

const OIDC = {
  protocol: "oidc" as const,
  providerId: "campus",
  accountKey: { issuer: "https://idp.example.test", accountId: "pairwise-sub" },
  providerUser: USER,
  providerReference: REFERENCE,
  providerClaims: {},
  verifiedIdTokenClaims: { oid: "object-id-1", ext: { employee: "E-7" }, list: ["first", "x"] },
};

const SAML = {
  protocol: "saml" as const,
  providerId: "campus",
  accountKey: { issuer: "https://idp.example.test/saml", accountId: "name-id-1" },
  providerUser: USER,
  providerReference: REFERENCE,
  providerAttributes: { "urn:oid:0.9.2342.19200300.100.1.1": ["uid-1"], empty: "" },
};

describe("directoryIdOf", () => {
  it("uses the account key without a configured claim", () => {
    expect(directoryIdOf(OIDC, null)).toBe("pairwise-sub");
    expect(directoryIdOf(SAML, null)).toBe("name-id-1");
  });

  it("reads an OIDC claim by dot path, from the verified ID token", () => {
    expect(directoryIdOf(OIDC, "oid")).toBe("object-id-1");
    expect(directoryIdOf(OIDC, "ext.employee")).toBe("E-7");
    expect(directoryIdOf(OIDC, "list")).toBe("first");
  });

  it("reads a SAML attribute by its exact name, dots included", () => {
    expect(directoryIdOf(SAML, "urn:oid:0.9.2342.19200300.100.1.1")).toBe("uid-1");
  });

  it("returns null when the sign-in does not carry it", () => {
    expect(directoryIdOf(OIDC, "missing")).toBeNull();
    expect(directoryIdOf(SAML, "empty")).toBeNull();
  });
});
