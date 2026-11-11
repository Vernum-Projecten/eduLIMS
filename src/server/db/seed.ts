// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// CLI: `pnpm db:seed`. Creates the dev-login users (idempotent). Refuses to run unless
// EDULIMS_DEV_LOGIN=true, which env validation in turn refuses in production.
import { getAuth } from "../auth.ts";
import { DEV_PASSWORD, DEV_USERS } from "../demo-accounts.ts";
import { getEnv } from "../env.ts";
import { getDb } from "./index.ts";

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
} finally {
  await db.destroy();
}
