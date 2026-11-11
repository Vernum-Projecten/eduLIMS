// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { IDP_MESSAGE_CODES, idpSchemas } from "./input.ts";

const schemas = idpSchemas(IDP_MESSAGE_CODES);

const settings = {
  labelEn: "Sign in",
  labelNl: "Inloggen",
  icon: "key-round",
  sortOrder: 0,
  roleClaim: "roles",
  roleMap: [{ value: "edulims-admin", role: "admin" }],
  defaultRole: null,
  emailAuthoritative: false,
  domains: [],
};

const oidc = {
  providerId: "entra",
  protocol: "oidc",
  settings,
  oidc: {
    issuer: "https://login.example.test/t/v2.0",
    clientId: "c",
    clientSecret: "s",
    attestPkce: false,
  },
};

/** Returns the message codes of the issues of a parse, or `[]` when it passes. */
function codes(
  schema: { safeParse: (value: unknown) => { error?: { issues: { message: string }[] } } },
  value: unknown,
) {
  return schema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];
}

describe("provider input (#46)", () => {
  it.each(["entra", "keycloak-saml", "ab"])("accepts the provider id %j", (id) => {
    expect(schemas.providerIdSchema.safeParse(id).success).toBe(true);
  });

  it.each(["local", "credential", "Entra", "1abc", "a", "a_b", `a${"b".repeat(40)}`])(
    "refuses the provider id %j",
    (id) => {
      expect(codes(schemas.providerIdSchema, id)).toContain("idp_error_provider_id");
    },
  );

  it("accepts an OIDC provider and requires its client secret on create", () => {
    expect(schemas.createProviderInput.safeParse(oidc).success).toBe(true);
    const noSecret = { ...oidc, oidc: { ...oidc.oidc, clientSecret: " " } };
    expect(codes(schemas.createProviderInput, noSecret)).toEqual(["idp_error_client_secret"]);
    expect(schemas.updateProviderInput.safeParse(noSecret).success).toBe(true);
  });

  it("takes no PKCE, scope or UserInfo setting from the input (they are fixed)", () => {
    const extra = { ...oidc, oidc: { ...oidc.oidc, pkce: false } };
    expect(schemas.createProviderInput.safeParse(extra).success).toBe(false);
    expect(
      schemas.createProviderInput.safeParse({ ...oidc, scopes: ["offline_access"] }).success,
    ).toBe(false);
  });

  it("requires SAML metadata as XML or a URL, and a PEM private key when one is given", () => {
    const saml = {
      providerId: "campus",
      protocol: "saml",
      settings: { ...settings, roleClaim: "Role" },
      saml: { metadataXml: "", metadataUrl: "", spPrivateKey: "" },
    };
    expect(codes(schemas.createProviderInput, saml)).toEqual(["idp_error_metadata_required"]);
    const withUrl = { ...saml, saml: { ...saml.saml, metadataUrl: "https://idp.example/md" } };
    expect(schemas.createProviderInput.safeParse(withUrl).success).toBe(true);
    const badKey = { ...withUrl, saml: { ...withUrl.saml, spPrivateKey: "not a key" } };
    expect(codes(schemas.createProviderInput, badKey)).toEqual(["idp_error_pem"]);
  });

  it("refuses a role mapped twice, an unknown role and an empty IdP value", () => {
    const twice = [
      { value: "x", role: "admin" },
      { value: "x", role: "teacher" },
    ];
    expect(codes(schemas.providerSettingsSchema, { ...settings, roleMap: twice })).toEqual([
      "idp_error_role_map_duplicate",
    ]);
    const unknown = [{ value: "x", role: "superuser" }];
    expect(
      schemas.providerSettingsSchema.safeParse({ ...settings, roleMap: unknown }).success,
    ).toBe(false);
    const empty = [{ value: " ", role: "admin" }];
    expect(codes(schemas.providerSettingsSchema, { ...settings, roleMap: empty })).toEqual([
      "idp_error_role_value",
    ]);
  });

  it("lowercases domains and refuses malformed or repeated ones", () => {
    const parsed = schemas.providerSettingsSchema.parse({ ...settings, domains: ["Example.EDU"] });
    expect(parsed.domains).toEqual(["example.edu"]);
    expect(
      codes(schemas.providerSettingsSchema, { ...settings, domains: ["not a domain"] }),
    ).toEqual(["idp_error_domain"]);
    expect(
      codes(schemas.providerSettingsSchema, { ...settings, domains: ["a.edu", "A.edu"] }),
    ).toEqual(["idp_error_domain_duplicate"]);
  });

  it("refuses a role claim with spaces and an overlong label", () => {
    expect(
      codes(schemas.providerSettingsSchema, { ...settings, roleClaim: "realm roles" }),
    ).toEqual(["idp_error_role_claim"]);
    expect(codes(schemas.providerSettingsSchema, { ...settings, labelEn: "x".repeat(61) })).toEqual(
      ["idp_error_label"],
    );
  });

  it("validates the institution email and the test id", () => {
    expect(codes(schemas.institutionEmailInput, { email: "nope" })).toEqual(["validation_email"]);
    expect(schemas.testResultInput.safeParse({ providerId: "entra", test: "x" }).success).toBe(
      false,
    );
  });
});
