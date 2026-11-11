// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Only a persistent SAML NameID signs in (#46, ADR 0015; security review L8).
import { describe, expect, it } from "vitest";
import { providerIdOf, SAML_NAMEID_ERROR } from "../../lib/identity-providers.ts";
import { parseRoleMap } from "../idp-roles.ts";
import { createIdpRoleSync } from "../idp-sync.ts";
import { hasPersistentNameId, samlNameIdFormats } from "./saml-nameid.ts";
import { samlResponse } from "./test-saml.ts";
import { PERSISTENT_NAME_ID } from "./validate.ts";

const TRANSIENT = "urn:oasis:names:tc:SAML:2.0:nameid-format:transient";
const EMAIL = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";

describe("samlNameIdFormats", () => {
  it("reads the Format of the NameID, and none for a NameID without one", () => {
    expect(samlNameIdFormats(samlResponse(PERSISTENT_NAME_ID))).toEqual([PERSISTENT_NAME_ID]);
    expect(samlNameIdFormats(samlResponse(null))).toEqual([""]);
    expect(samlNameIdFormats(undefined)).toEqual([]);
  });

  it("does not take a NameIDPolicy or NameIDFormat element for a NameID", () => {
    const xml = `<samlp:NameIDPolicy Format="${PERSISTENT_NAME_ID}"/><md:NameIDFormat>x</md:NameIDFormat>`;
    expect(samlNameIdFormats(Buffer.from(xml).toString("base64"))).toEqual([]);
  });

  it.each([
    ["transient", samlResponse(TRANSIENT)],
    ["email", samlResponse(EMAIL)],
    ["unspecified", samlResponse(null)],
    ["missing (an EncryptedID)", Buffer.from("<saml:EncryptedID/>").toString("base64")],
  ])("refuses a %s NameID", (_name, response) => {
    expect(hasPersistentNameId(response)).toBe(false);
  });

  it("accepts a persistent NameID", () => {
    expect(hasPersistentNameId(samlResponse(PERSISTENT_NAME_ID))).toBe(true);
  });
});

describe("the sign-in gate (L8)", () => {
  type Sync = ReturnType<typeof createIdpRoleSync>;

  function gate() {
    const sync = createIdpRoleSync({
      settingsOf: async (id) =>
        id === "campus-saml"
          ? {
              providerId: providerIdOf(id),
              protocol: "saml",
              enabled: true,
              roleClaim: "Role",
              roleMap: parseRoleMap("staff:teacher"),
              defaultRole: undefined,
              emailAuthoritative: false,
              endSessionEndpoint: null,
            }
          : null,
    });
    return { sync };
  }

  function data(): Parameters<Sync>[0] {
    return {
      user: { email: "t@example.test" },
      source: {
        action: "create-user",
        method: "sso-saml",
        sso: { providerId: "campus-saml", profile: { Role: ["staff"] } },
      },
    };
  }

  it("refuses a SAML sign-in whose NameID is transient, whatever its roles", async () => {
    const { sync } = gate();
    const ctx = { context: {}, body: { SAMLResponse: samlResponse(TRANSIENT) } };
    expect(await sync(data(), ctx as unknown as Parameters<Sync>[1])).toEqual({
      error: SAML_NAMEID_ERROR,
      errorDescription: "SAML NameID is not persistent",
    });
  });

  it("lets a persistent NameID through to the role mapping", async () => {
    const { sync } = gate();
    const ctx = { context: {}, body: { SAMLResponse: samlResponse(PERSISTENT_NAME_ID) } };
    const input = data();
    expect(await sync(input, ctx as unknown as Parameters<Sync>[1])).toBeUndefined();
    expect(input.user["role"]).toBe("teacher");
  });
});
