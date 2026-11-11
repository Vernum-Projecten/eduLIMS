// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// CLI: `pnpm db:seed`. Creates the dev-login users (idempotent). Refuses to run unless
// EDULIMS_DEV_LOGIN=true, which env validation in turn refuses in production.
import type { Role } from "../../lib/roles.ts";
import { getAuth } from "../auth.ts";
import { getEnv } from "../env.ts";
import { getDb } from "./index.ts";

/** Shared password for all dev users; never valid outside a dev/test database. */
export const DEV_PASSWORD = "eduLIMS-dev-only";

export const DEV_USERS = [
  { email: "student@example.test", name: "Sam Student", role: "student" },
  { email: "docent@example.test", name: "Dana Docent", role: "docent" },
  { email: "beheerder@example.test", name: "Bo Beheerder", role: "beheerder" },
] as const satisfies readonly { email: string; name: string; role: Role }[];

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
    await getAuth().api.createUser({ body: { ...user, password: DEV_PASSWORD } });
    process.stdout.write(`created ${user.email} (${user.role})\n`);
  }
} finally {
  await db.destroy();
}
