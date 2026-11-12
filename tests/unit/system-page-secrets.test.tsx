// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The system page shows no secret (#36 acceptance criterion): the rendered configuration is
// checked against the value of every secret variable and against the stored client secrets.
import type { Kysely } from "kysely";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { SystemBuild, SystemProviders } from "@/components/admin-system/system-configuration";
import type { DB } from "@/server/db/schema.gen";
import { createTestDb } from "@/server/db/test-db";
import { keyringOf } from "@/server/idp/crypto";
import { insertTestProvider } from "@/server/idp/test-providers";
import { readSystemConfiguration } from "@/server/system/queries";

const BASE_URL = "https://edulims.example.test";
const CLIENT_SECRET = "oidc-client-secret-known-test-value-7f3a";

/** Every secret variable of the server, set to a known test value. */
const SECRET_ENV = {
  BETTER_AUTH_SECRET: "system-page-test-auth-secret-0123456789abcdef",
  // Public test-only keys: 32 bytes, base64.
  EDULIMS_DATA_KEY: "c3lzdGVtLXBhZ2UtdGVzdC1kYXRhLWtleS0wMTIzNDU=",
  EDULIMS_DATA_KEY_PREVIOUS: "c3lzdGVtLXBhZ2UtdGVzdC1wcmV2LWtleS0wMTIzNDU=",
  DATABASE_URL: "postgres://edulims:db-password-known-test-value@localhost:5432/edulims",
  EDULIMS_IDP_CLIENT_SECRET: "cli-client-secret-known-test-value-9c1e",
} as const;

const RELEASE_ENV = {
  EDULIMS_BUILD_VERSION: "1.2.3",
  EDULIMS_BUILD_REVISION: "0123456789abcdef0123456789abcdef01234567",
  EDULIMS_BUILD_CREATED: "2026-11-12T09:30:00.000Z",
  EDULIMS_BUILD_PROVENANCE: "oci://ghcr.io/vernum-projecten/edulims:1.2.3",
};

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function renderedPage(): Promise<{ html: string; stored: string[] }> {
  db = await createTestDb();
  const keyring = keyringOf({ EDULIMS_DATA_KEY: SECRET_ENV.EDULIMS_DATA_KEY });
  await insertTestProvider(db, keyring, { providerId: "campus", clientSecret: CLIENT_SECRET });
  await insertTestProvider(db, keyring, {
    providerId: "campus-saml",
    protocol: "saml",
    baseURL: BASE_URL,
  });
  const sealed = await db
    .selectFrom("ssoProvider")
    .select(["oidcConfig", "samlConfig"])
    .where("providerId", "in", ["campus", "campus-saml"])
    .execute();
  const config = await readSystemConfiguration({
    db,
    actor: { roles: ["admin"] },
    baseURL: BASE_URL,
    locale: "en",
    buildEnv: { ...SECRET_ENV, ...RELEASE_ENV },
  });
  const html = renderToStaticMarkup(
    <>
      <SystemProviders providers={config.providers} />
      <SystemBuild build={config.build} />
    </>,
  );
  const stored = sealed.flatMap((row) => [row.oidcConfig, row.samlConfig]);
  return { html, stored: stored.filter((value): value is string => value !== null) };
}

describe("the system page shows no secret (#36)", () => {
  it("renders the providers and the build it is about", async () => {
    const { html } = await renderedPage();
    expect(html).toContain(`${BASE_URL}/api/auth/sso/callback/campus`);
    expect(html).toContain(`${BASE_URL}/api/auth/sso/saml2/sp/acs/campus-saml`);
    expect(html).toContain(RELEASE_ENV.EDULIMS_BUILD_REVISION);
    expect(html).toContain(RELEASE_ENV.EDULIMS_BUILD_PROVENANCE);
  });

  it.each(Object.entries(SECRET_ENV))("does not contain the value of %s", async (_name, value) => {
    const { html } = await renderedPage();
    expect(html).not.toContain(value);
  });

  it("does not contain the database password", async () => {
    const { html } = await renderedPage();
    expect(html).not.toContain(new URL(SECRET_ENV.DATABASE_URL).password);
  });

  it("does not contain a stored client secret or a sealed provider configuration", async () => {
    const { html, stored } = await renderedPage();
    expect(stored.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain(CLIENT_SECRET);
    expect(html).not.toContain("test-client-secret");
    for (const value of stored) expect(html).not.toContain(value);
  });
});
