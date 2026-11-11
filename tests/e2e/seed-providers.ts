// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The e2e stack's identity providers, after `pnpm db:reset`: `pnpm db:seed` registers the dev
// Keycloak through discovery when it runs; without it (CI) this stores the same two providers
// without network, so the login page, the demo accounts and the Users screen look the same.
// Runs on plain Node (type stripping) from the Playwright web server command.
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { devKeycloakRealm } from "../../src/server/db/seed-providers.ts";
import { keyringOf } from "../../src/server/idp/crypto.ts";
import { insertTestProvider } from "../../src/server/idp/test-providers.ts";

const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env["DATABASE_URL"], max: 1 }),
  }),
});
const keyring = keyringOf({ EDULIMS_DATA_KEY: process.env["EDULIMS_DATA_KEY"] });
const roleMap = {
  "edulims-student": "student",
  "edulims-teacher": "teacher",
  "edulims-admin": "admin",
};
try {
  const existing = await db.selectFrom("identity_provider").select("provider_id").execute();
  const have = new Set(existing.map((row) => row.provider_id));
  if (!have.has("keycloak")) {
    await insertTestProvider(db, keyring, {
      providerId: "keycloak",
      issuer: devKeycloakRealm(),
      labelEn: "Keycloak",
      labelNl: "Keycloak",
      roleClaim: "realm_access.roles",
      roleMap,
      emailAuthoritative: true,
    });
    process.stdout.write("stored provider keycloak (no Keycloak running)\n");
  }
  if (!have.has("keycloak-saml")) {
    await insertTestProvider(db, keyring, {
      providerId: "keycloak-saml",
      protocol: "saml",
      labelEn: "Keycloak (SAML)",
      labelNl: "Keycloak (SAML)",
      roleClaim: "Role",
      roleMap,
      emailAuthoritative: true,
      ...(process.env["BETTER_AUTH_URL"] ? { baseURL: process.env["BETTER_AUTH_URL"] } : {}),
    });
    process.stdout.write("stored provider keycloak-saml (no Keycloak running)\n");
  }
} finally {
  await db.destroy();
}
