// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Writes the demo set of `pnpm db:seed` in one transaction, once: when its first person exists,
// the database already holds it. Relative imports: the seed loads this in plain Node.
import { randomBytes } from "node:crypto";
import { type Kysely, sql } from "kysely";
import { recordAudit } from "../../audit/record.ts";
import type { DB } from "../schema.gen.ts";
import { planDemoActivity } from "./activity.ts";
import { type DemoPeople, planDemoPeople } from "./people.ts";
import { demoRandom } from "./random.ts";

/** The fixed seed of the demo plan: the same people on every machine. */
export const DEMO_SEED = 33;

/** Counts of what the database holds, for the seed's summary. No names, no addresses. */
export interface SeedSummary {
  usersByRole: Record<string, number>;
  accountsByProvider: Record<string, number>;
  activeSessions: number;
  expiredSessions: number;
  blockedUsers: number;
  auditEvents: number;
}

/** Returns the demo people and their activity for the reference time `now`. */
export function planDemoData(now: Date) {
  const random = demoRandom(DEMO_SEED);
  const people = planDemoPeople(random, now);
  return { people, activity: planDemoActivity(random, now, people) };
}

/** Returns each user's latest planned session: the last sign-in the Users screen shows. */
function lastSignIns(people: DemoPeople) {
  const latest = new Map<string, { at: Date; provider: string }>();
  for (const session of people.sessions) {
    const known = latest.get(session.userId);
    if (!known || known.at < session.createdAt) {
      latest.set(session.userId, { at: session.createdAt, provider: session.provider });
    }
  }
  return latest;
}

async function insertPeople(trx: Kysely<DB>, people: DemoPeople): Promise<void> {
  const signIns = lastSignIns(people);
  await trx
    .insertInto("user")
    .values(
      people.users.map((user) => ({
        // The demo people sign in through an IdP that sends their roles (hybrid ownership, #32).
        role_source: user.provider,
        last_sign_in_at: signIns.get(user.id)?.at ?? null,
        last_login_method: signIns.get(user.id)?.provider ?? null,
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: true,
        role: user.role,
        locale: user.locale,
        last_portal: user.lastPortal,
        banned: user.ban !== null,
        banReason: user.ban?.reason ?? null,
        banExpires: user.ban?.expires ?? null,
        createdAt: user.createdAt,
        updatedAt: user.ban?.at ?? user.createdAt,
      })),
    )
    .execute();
  await trx
    .insertInto("account")
    .values(
      people.accounts.map((account) => ({
        ...account,
        updatedAt: account.createdAt,
      })),
    )
    .execute();
  await trx
    .insertInto("session")
    .values(
      people.sessions.map(({ provider: _provider, ...session }) => ({
        ...session,
        token: randomBytes(24).toString("base64url"),
        updatedAt: session.createdAt,
      })),
    )
    .execute();
}

/**
 * Writes the demo set planned for `now`, unless it is already there.
 *
 * @returns whether this call wrote it.
 */
export async function seedDemoData(db: Kysely<DB>, now: Date): Promise<boolean> {
  const { people, activity } = planDemoData(now);
  const first = people.users[0];
  if (!first) return false;
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("user")
      .select("id")
      .where("email", "=", first.email)
      .executeTakeFirst();
    if (existing) return false;
    await insertPeople(trx, people);
    for (const event of activity) await recordAudit(trx, event);
    return true;
  });
}

async function countBy(db: Kysely<DB>, table: "user" | "account", column: "role" | "providerId") {
  const rows = await db
    .selectFrom(table)
    .select([
      sql<string>`coalesce(${sql.ref(column)}, 'none')`.as("key"),
      db.fn.countAll<string>().as("n"),
    ])
    .groupBy(sql.ref(column))
    .orderBy(sql.ref(column))
    .execute();
  return Object.fromEntries(rows.map((row) => [row.key, Number(row.n)]));
}

/** Counts what the database holds, as the seed prints it. */
export async function seedSummary(db: Kysely<DB>, now: Date): Promise<SeedSummary> {
  const sessions = await db
    .selectFrom("session")
    .select([
      db.fn.countAll<string>().filterWhere("expiresAt", ">", now).as("active"),
      db.fn.countAll<string>().filterWhere("expiresAt", "<=", now).as("expired"),
    ])
    .executeTakeFirstOrThrow();
  const blocked = await db
    .selectFrom("user")
    .select(db.fn.countAll<string>().as("n"))
    .where("banned", "=", true)
    .executeTakeFirstOrThrow();
  const events = await db
    .selectFrom("audit_event")
    .select(db.fn.countAll<string>().as("n"))
    .executeTakeFirstOrThrow();
  return {
    usersByRole: await countBy(db, "user", "role"),
    accountsByProvider: await countBy(db, "account", "providerId"),
    activeSessions: Number(sessions.active),
    expiredSessions: Number(sessions.expired),
    blockedUsers: Number(blocked.n),
    auditEvents: Number(events.n),
  };
}
