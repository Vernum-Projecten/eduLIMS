// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of the Admin portal's overview (#36, B1, B4): the account counts, counted in SQL,
// and the latest activity-log events. No grades, results or submissions (R-01).
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { AuditAction, AuditOutcome } from "../audit/events.ts";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertAdmin } from "../users/actions.ts";
import { roleValuesWith } from "../users/queries.ts";

/** How many activity-log events the overview shows (#36). */
export const RECENT_EVENTS_LIMIT = 10;

/** The account counts of the overview's tiles. */
export interface AccountCounts {
  /** Every account, with or without a role. */
  users: number;
  students: number;
  /** Accounts with the teacher role; a teacher-administrator counts here and below. */
  teachers: number;
  admins: number;
  /** Unexpired sessions. */
  activeSessions: number;
  /** Accounts blocked now: a block without an end, or one that ends later. */
  blockedUsers: number;
  /** Classes that are not archived (#28). */
  classes: number;
  /** Class invitations still pending and unexpired (#28). */
  pendingInvitations: number;
}

/** Who acted on an event: a user (their name, `null` once the account is gone) or eduLIMS. */
export type OverviewActor =
  | { kind: "user"; name: string | null }
  | { kind: "system" }
  | { kind: "anonymous" };

/** One event of the overview's activity list. */
export interface OverviewEvent {
  id: string;
  action: AuditAction | string;
  outcome: AuditOutcome | string;
  occurredAt: string;
  actor: OverviewActor;
}

/** Everything the overview shows except the integration status, which has its own read. */
export interface AdminOverview {
  counts: AccountCounts;
  activity: OverviewEvent[];
  /** The instant of the read; relative times count from it, so SSR and the client agree. */
  readAt: string;
}

/**
 * Counts the accounts per role, the live sessions, the blocked accounts, the active classes and
 * the pending class invitations in one query.
 */
export async function accountCounts(db: Kysely<DB>, now: Date): Promise<AccountCounts> {
  const row = await db
    .selectFrom("user")
    .select((eb) => [
      eb.fn.countAll<string>().as("users"),
      eb.fn.countAll<string>().filterWhere("role", "in", roleValuesWith("student")).as("students"),
      eb.fn.countAll<string>().filterWhere("role", "in", roleValuesWith("teacher")).as("teachers"),
      eb.fn.countAll<string>().filterWhere("role", "in", roleValuesWith("admin")).as("admins"),
      eb.fn
        .countAll<string>()
        .filterWhere((fb) =>
          fb.and([
            fb("banned", "=", true),
            fb.or([fb("banExpires", "is", null), fb("banExpires", ">", now)]),
          ]),
        )
        .as("blocked"),
      eb
        .selectFrom("session")
        .select((sb) => sb.fn.countAll<string>().as("n"))
        .where("expiresAt", ">", now)
        .as("sessions"),
      eb
        .selectFrom("organization")
        .select((ob) => ob.fn.countAll<string>().as("n"))
        .where("archived_at", "is", null)
        .as("classes"),
      eb
        .selectFrom("invitation")
        .select((ib) => ib.fn.countAll<string>().as("n"))
        .where("status", "=", "pending")
        .where("expiresAt", ">", now)
        .as("invitations"),
    ])
    .executeTakeFirstOrThrow();
  return {
    users: Number(row.users),
    students: Number(row.students),
    teachers: Number(row.teachers),
    admins: Number(row.admins),
    activeSessions: Number(row.sessions ?? 0),
    blockedUsers: Number(row.blocked),
    classes: Number(row.classes ?? 0),
    pendingInvitations: Number(row.invitations ?? 0),
  };
}

/** Returns the latest {@link RECENT_EVENTS_LIMIT} activity-log events, newest first. */
export async function recentActivity(db: Kysely<DB>): Promise<OverviewEvent[]> {
  const rows = await db
    .selectFrom("audit_event as e")
    .leftJoin("user as u", "u.id", "e.actor_id")
    .select(["e.id", "e.action", "e.outcome", "e.occurred_at", "e.actor_type", "u.name"])
    .orderBy("e.occurred_at", "desc")
    .orderBy("e.id", "desc")
    .limit(RECENT_EVENTS_LIMIT)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    outcome: row.outcome,
    occurredAt: row.occurred_at.toISOString(),
    actor:
      row.actor_type === "user"
        ? { kind: "user", name: row.name }
        : row.actor_type === "system"
          ? { kind: "system" }
          : { kind: "anonymous" },
  }));
}

/**
 * Returns the overview's counts and latest events.
 *
 * @throws AuthError 403 without the admin role.
 */
export async function readAdminOverview(
  ctx: { db: Kysely<DB>; actor: Pick<SessionUser, "roles"> },
  now: Date,
): Promise<AdminOverview> {
  assertAdmin(ctx.actor);
  const [counts, activity] = await Promise.all([
    accountCounts(ctx.db, now),
    recentActivity(ctx.db),
  ]);
  return { counts, activity, readAt: now.toISOString() };
}
