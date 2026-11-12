// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// CLI: `pnpm db:seed`. Creates the dev-login users, registers the dev Keycloak as the
// identity providers `keycloak` (OIDC) and `keycloak-saml` (SAML), the fictional demo set, and
// classes for Test Teacher, Test Coordinator and Test Student (all idempotent). Refuses to run
// unless EDULIMS_DEV_LOGIN=true, which env validation in turn refuses in production. Prints
// e-mail addresses of the public dev-login users and counts only.
import { getAuth } from "../auth.ts";
import { DEV_PASSWORD, DEV_USERS } from "../demo-accounts.ts";
import { getEnv } from "../env.ts";
import { keyringOf } from "../idp/crypto.ts";
import { seedDemoAnalysers } from "./demo/analysers.ts";
import { seedDemoData, seedSummary } from "./demo/seed-demo.ts";
import { seedDevAccountClasses } from "./demo/seed-dev-classes.ts";
import { formatSeedReport } from "./demo/seed-report.ts";
import { getDb } from "./index.ts";
import { seedDevProviders } from "./seed-providers.ts";

if (!getEnv().EDULIMS_DEV_LOGIN) {
  console.error("Refusing to seed: EDULIMS_DEV_LOGIN is not enabled.");
  process.exit(1);
}

const db = getDb();
try {
  for (const user of DEV_USERS) {
    const existing = await db
      .selectFrom("user")
      .select("id")
      .where("email", "=", user.email)
      .executeTakeFirst();
    if (existing) {
      process.stdout.write(`exists  ${user.email}\n`);
      continue;
    }
    // The role write runs through the role-set guard (src/server/role-guard.ts).
    await getAuth().api.createUser({
      body: { email: user.email, name: user.name, role: [...user.roles], password: DEV_PASSWORD },
    });
    process.stdout.write(`created ${user.email} (${user.roles.join(",")})\n`);
  }
  // NOTE: #28; a sign-in accepts invitations for a verified email only, and these public test
  // addresses stand in for an identity provider's verified ones.
  await db
    .updateTable("user")
    .set({ emailVerified: true })
    .where(
      "email",
      "in",
      DEV_USERS.map((user) => user.email),
    )
    .execute();

  const env = getEnv();
  const providerLines = await seedDevProviders(db, {
    db,
    keyring: keyringOf(env),
    policy: { production: false, privateOrigins: env.EDULIMS_IDP_PRIVATE_ORIGINS },
    baseURL: env.BETTER_AUTH_URL,
    actor: { type: "system" },
  });
  for (const line of providerLines) process.stdout.write(`${line}\n`);
  const analysers = await seedDemoAnalysers(db);
  process.stdout.write(`analysers: ${analysers} added\n`);

  const now = new Date();
  const created = await seedDemoData(db, now);
  const devClasses = await seedDevAccountClasses(db, now);
  const summary = await seedSummary(db, now);
  process.stdout.write(
    formatSeedReport({ demoCreated: created, devClassesCreated: devClasses, summary }),
  );
} finally {
  await db.destroy();
}
