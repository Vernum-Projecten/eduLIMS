// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Writes the demo set of `pnpm db:seed` in one transaction, once: when its first person exists,
// the database already holds it. Relative imports: the seed loads this in plain Node.
import { randomBytes } from "node:crypto";
import { type Kysely, sql } from "kysely";
import { recordAudit } from "../../audit/record.ts";
import type { DB } from "../schema.gen.ts";
import { planDemoActivity } from "./activity.ts";
import { type DemoClasses, planDemoClasses } from "./classes.ts";
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
  classes: number;
  archivedClasses: number;
  classMembers: number;
  pendingInvitations: number;
  labGroups: number;
}

/** Returns the demo people and their activity for the reference time `now`. */
export function planDemoData(now: Date) {
  const random = demoRandom(DEMO_SEED);
  const people = planDemoPeople(random, now);
  const activity = planDemoActivity(random, now, people);
  // A source of its own, so the classes never shift the ids of the people.
  return { people, activity, classes: planDemoClasses(demoRandom(DEMO_SEED + 1), now, people) };
}

/** Writes planned classes with their members, invitations, lab groups and activity-log events. */
export async function insertClasses(trx: Kysely<DB>, classes: DemoClasses): Promise<void> {
  for (const item of classes.classes) {
    await trx
      .insertInto("organization")
      .values({
        id: item.id,
        slug: item.id,
        name: item.name,
        academic_year: item.academicYear,
        createdAt: item.createdAt,
        archived_at: item.archivedAt,
      })
      .execute();
    await trx
      .insertInto("member")
      .values(
        item.members.map((member) => ({
          ...member,
          organizationId: item.id,
          createdAt: item.createdAt,
        })),
      )
      .execute();
    for (const invitation of item.invitations) {
      await trx
        .insertInto("invitation")
        .values({ ...invitation, organizationId: item.id, role: "student", status: "pending" })
        .execute();
    }
    for (const group of item.groups) {
      await trx
        .insertInto("team")
        .values({
          id: group.id,
          name: group.name,
          group_set: group.groupSet,
          organizationId: item.id,
          createdAt: item.createdAt,
          updatedAt: item.createdAt,
          memberCount: group.places.length,
        })
        .execute();
      if (group.places.length === 0) continue;
      await trx
        .insertInto("teamMember")
        .values(
          group.places.map((place) => ({ ...place, teamId: group.id, createdAt: item.createdAt })),
        )
        .execute();
    }
  }
  for (const event of classes.activity) await recordAudit(trx, event, { stdout: false });
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
  const { people, activity, classes } = planDemoData(now);
  const first = people.users[0];
  if (!first) return false;
  return db.transaction().execute(async (trx) => {
    let wrote = false;
    const existing = await trx
      .selectFrom("user")
      .select("id")
      .where("email", "=", first.email)
      .executeTakeFirst();
    if (!existing) {
      await insertPeople(trx, people);
      for (const event of activity) await recordAudit(trx, event, { stdout: false });
      wrote = true;
    }
    // A database seeded before the classes existed (#28) gets them on its next seed.
    const firstClass = classes.classes[0];
    const hasClasses =
      firstClass === undefined ||
      (await trx
        .selectFrom("organization")
        .select("id")
        .where("id", "=", firstClass.id)
        .executeTakeFirst()) !== undefined;
    if (!hasClasses) {
      await insertClasses(trx, classes);
      wrote = true;
    }
    return wrote;
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
  const classes = await db
    .selectFrom("organization")
    .select([
      db.fn.countAll<string>().as("all"),
      db.fn.countAll<string>().filterWhere("archived_at", "is not", null).as("archived"),
    ])
    .executeTakeFirstOrThrow();
  const [classMembers, pending, labGroups] = await Promise.all([
    db.selectFrom("member").select(db.fn.countAll<string>().as("n")).executeTakeFirstOrThrow(),
    db
      .selectFrom("invitation")
      .select(db.fn.countAll<string>().as("n"))
      .where("status", "=", "pending")
      .where("expiresAt", ">", now)
      .executeTakeFirstOrThrow(),
    db.selectFrom("team").select(db.fn.countAll<string>().as("n")).executeTakeFirstOrThrow(),
  ]);
  return {
    classes: Number(classes.all),
    archivedClasses: Number(classes.archived),
    classMembers: Number(classMembers.n),
    pendingInvitations: Number(pending.n),
    labGroups: Number(labGroups.n),
    usersByRole: await countBy(db, "user", "role"),
    accountsByProvider: await countBy(db, "account", "providerId"),
    activeSessions: Number(sessions.active),
    expiredSessions: Number(sessions.expired),
    blockedUsers: Number(blocked.n),
    auditEvents: Number(events.n),
  };
}
