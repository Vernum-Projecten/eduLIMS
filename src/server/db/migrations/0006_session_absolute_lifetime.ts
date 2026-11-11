// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Caps every session at 24 hours after sign-in (#42, ASVS V7.3.2): a trigger keeps
// better-auth's sliding refresh from moving `expiresAt` past `createdAt` + 24 hours, so
// better-auth's own expiry check ends the session on every path that reads it. The limit
// matches SESSION_ABSOLUTE_MAX_SECONDS in src/server/session-policy.ts, whose read check in
// src/server/session.ts also ends sessions that predate this trigger.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create function session_cap_absolute_lifetime() returns trigger
    language plpgsql as $$
    begin
      new."expiresAt" := least(new."expiresAt", new."createdAt" + interval '24 hours');
      return new;
    end;
    $$
  `.execute(db);
  await sql`
    create trigger session_absolute_lifetime
    before insert or update on "session"
    for each row execute function session_cap_absolute_lifetime()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger session_absolute_lifetime on "session"`.execute(db);
  await sql`drop function session_cap_absolute_lifetime()`.execute(db);
}
