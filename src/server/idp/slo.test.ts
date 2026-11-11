// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// SAML single logout through the sso plugin (#46, ADR 0015; security review M2): a LogoutRequest
// must be signed by the IdP, so an unsigned one leaves the session in place, and a disabled
// provider's single-logout endpoint is refused like its ACS.
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Auth } from "../auth.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { parseEnv } from "../env.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import { keyringOf } from "./crypto.ts";
import { invalidateProviderCache } from "./registry.ts";
import { createProvider, setProviderEnabled } from "./service.ts";

const BASE = VALID_ENV.BETTER_AUTH_URL;
const METADATA = readFileSync(
  new URL("../../../tests/fixtures/idp/saml-idp-metadata.xml", import.meta.url),
  "utf8",
);

/** An unsigned LogoutRequest from the fixture IdP, in the HTTP-Redirect encoding. */
function unsignedLogoutRequest(providerId: string): string {
  const xml = [
    '<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
    ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_slo-test-1" Version="2.0"',
    ` IssueInstant="${new Date().toISOString()}"`,
    ` Destination="${BASE}/api/auth/sso/saml2/sp/slo/${providerId}">`,
    "<saml:Issuer>https://idp.example.test/saml</saml:Issuer>",
    '<saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">subject-1</saml:NameID>',
    "</samlp:LogoutRequest>",
  ].join("");
  return deflateRawSync(Buffer.from(xml, "utf8")).toString("base64");
}

describe("SAML single logout (M2)", () => {
  let db: Kysely<DB>;
  let auth: Auth;
  let cookie: string;

  beforeAll(async () => {
    db = await createTestDb();
    const env = parseEnv(VALID_ENV);
    auth = await createTestAuth(env, { db, type: "postgres" });
    const ctx = {
      db,
      keyring: keyringOf(env),
      policy: { production: false, privateOrigins: [] },
      baseURL: BASE,
      actor: { type: "system" as const },
    };
    for (const providerId of ["campus-saml", "off-saml"]) {
      const created = await createProvider(ctx, {
        providerId,
        protocol: "saml",
        settings: {
          labelEn: providerId,
          labelNl: providerId,
          icon: "school",
          sortOrder: 0,
          roleClaim: "Role",
          roleMap: [],
          defaultRole: null,
          emailAuthoritative: false,
          domains: [],
        },
        saml: { metadataXml: METADATA, metadataUrl: "", spPrivateKey: "" },
      });
      expect(created).toEqual({ ok: true, providerId });
    }
    await setProviderEnabled(ctx, { providerId: "campus-saml", enabled: true });
    await auth.api.createUser({
      body: { email: "slo@example.test", name: "SLO", password: "slo-password-1", role: "teacher" },
    });
    const response = await auth.api.signInEmail({
      body: { email: "slo@example.test", password: "slo-password-1" },
      asResponse: true,
    });
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  });

  afterAll(async () => {
    invalidateProviderCache();
    await db?.destroy();
  });

  async function sessionAlive(): Promise<boolean> {
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    return session !== null;
  }

  async function logout(providerId: string): Promise<Response> {
    const query = new URLSearchParams({ SAMLRequest: unsignedLogoutRequest(providerId) });
    return auth.handler(
      new Request(`${BASE}/api/auth/sso/saml2/sp/slo/${providerId}?${query}`, {
        headers: { cookie },
      }),
    );
  }

  it("refuses an unsigned LogoutRequest and leaves the session in place", async () => {
    expect(await sessionAlive()).toBe(true);
    const response = await logout("campus-saml");
    expect(response.status).toBe(400);
    expect(await sessionAlive()).toBe(true);
  });

  it("refuses the single-logout endpoint of a disabled provider", async () => {
    const response = await logout("off-saml");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${BASE}/login?error=provider_disabled`);
    expect(await sessionAlive()).toBe(true);
  });
});
