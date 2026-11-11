// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The interface language a user picked in the language menu (ADR 0011). NULL means the user
// never picked one, so the cookie, Accept-Language and English decide. Declared to better-auth
// as `user.additionalFields.locale` in src/server/auth.ts, which the drift test checks.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("user")
    // The Paraglide locales when this was written; a new locale needs a new migration, which
    // src/server/preferences/queries.test.ts enforces.
    .addColumn("locale", "text", (col) => col.check(sql`"locale" in ('en', 'nl')`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // NOTE: drops every saved language preference.
  await db.schema.alterTable("user").dropColumn("locale").execute();
}
