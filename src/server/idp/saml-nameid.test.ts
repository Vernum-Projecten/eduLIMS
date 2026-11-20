// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Only a persistent SAML NameID signs in (#46, ADR 0015; security review L8).
import { describe, expect, it } from "vitest";
import { providerIdOf, SAML_NAMEID_ERROR } from "../../lib/identity-providers.ts";
import { parseRoleMap } from "../idp-roles.ts";
import { createIdpRoleSync, rawEmailOf } from "../idp-sync.ts";
import { hasPersistentNameId, samlNameIdFormats, samlNameIdValue } from "./saml-nameid.ts";
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

/** A base64 SAMLResponse whose subject holds the given NameID elements. */
function withNameIds(...nameIds: string[]): string {
  const subject = nameIds.map(
    (text) => `<saml:NameID Format="${PERSISTENT_NAME_ID}">${text}</saml:NameID>`,
  );
  return Buffer.from(`<saml:Assertion>${subject.join("")}</saml:Assertion>`).toString("base64");
}

describe("samlNameIdValue (#324)", () => {
  it("reads the NameID as sent, with its character and entity references resolved", () => {
    expect(samlNameIdValue(samlResponse(PERSISTENT_NAME_ID))).toBe("subject-1");
    expect(samlNameIdValue(withNameIds("&#x212A;im@example.test"))).toBe("Kim@example.test");
    expect(samlNameIdValue(withNameIds("&#8490;im&amp;co&lt;&gt;&quot;&apos;"))).toBe(
      "Kim&co<>\"'",
    );
    expect(samlNameIdValue(withNameIds("same", "same"))).toBe("same");
  });

  it.each([
    ["no response", undefined],
    ["an empty response", ""],
    ["no NameID", Buffer.from("<saml:EncryptedID/>").toString("base64")],
    ["two different NameIDs", withNameIds("a", "b")],
    ["markup inside the NameID", withNameIds("<![CDATA[a]]>")],
    ["an unknown entity", withNameIds("&nbsp;a")],
    ["a bare ampersand", withNameIds("a&b")],
    ["a reference past Unicode", withNameIds("&#x110000;")],
  ])("gives no address for %s", (_case, response) => {
    expect(samlNameIdValue(response)).toBeNull();
  });
});

describe("rawEmailOf (#324)", () => {
  const response = withNameIds("&#x212A;im@example.test");

  it("reads the first non-empty email claim of an ID token", () => {
    expect(rawEmailOf("sso-oidc", { email: "A@example.test" }, undefined)).toBe("A@example.test");
    expect(rawEmailOf("sso-oidc", { email: ["", "B@example.test"] }, undefined)).toBe(
      "B@example.test",
    );
    expect(rawEmailOf("sso-oidc", { email: 7 }, undefined)).toBeNull();
    expect(rawEmailOf("sso-oidc", {}, response)).toBeNull();
  });

  it("reads the first SAML email value, else the NameID, as the sso plugin does", () => {
    expect(rawEmailOf("sso-saml", { email: ["C@example.test", "x"] }, response)).toBe(
      "C@example.test",
    );
    expect(rawEmailOf("sso-saml", { email: "D@example.test" }, response)).toBe("D@example.test");
    expect(rawEmailOf("sso-saml", { email: [""] }, response)).toBe("Kim@example.test");
    expect(rawEmailOf("sso-saml", {}, response)).toBe("Kim@example.test");
    expect(rawEmailOf("sso-saml", { email: [{ v: 1 }] }, response)).toBeNull();
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
              scimExternalIdClaim: null,
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
        sso: { providerId: "campus-saml", profile: { Role: ["staff"], email: ["t@example.test"] } },
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
