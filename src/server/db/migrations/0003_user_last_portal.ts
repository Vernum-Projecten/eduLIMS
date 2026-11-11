// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The portal a user last switched to in the portal switcher (ADR 0012), where `/` and the
// post-login redirect send them. NULL means the user never switched, so the fallback order
// decides. Declared to better-auth as `user.additionalFields.lastPortal` (src/server/auth.ts).
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("user")
    // The portal names, which are the role names; a new portal needs a new migration.
    .addColumn("last_portal", "text", (col) =>
      col.check(sql`"last_portal" in ('student', 'teacher', 'admin')`),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // NOTE: drops every saved landing portal; users land by the fallback order again.
  await db.schema.alterTable("user").dropColumn("last_portal").execute();
}
