// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of the activity log screen (#36, B4). The log holds ids and codes only; the names of
// the users an event names are read from `user` here, for an administrator's screen, and never
// written to a log or an export.
import "@tanstack/react-start/server-only";
import type { Expression, ExpressionBuilder, Kysely, SqlBool } from "kysely";
import { endOfDayIn, startOfDayIn } from "../../lib/app-day.ts";
import {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_TARGET_TYPES,
  type AuditAction,
  type AuditMetadata,
  type AuditOutcome,
  type AuditProvider,
  type AuditTargetType,
  auditMetadataSchema,
  auditProvider,
} from "../audit/events.ts";
import { hasRole, type SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { AuthError } from "../middleware.ts";
import { containsPattern } from "../users/queries.ts";
import {
  type ActivityUserSearchInput,
  DEFAULT_ACTIVITY_PAGE_SIZE,
  type ListActivityInput,
  USER_SEARCH_LIMIT,
} from "./schemas.ts";

/** A user an event names, with the name the user table holds now (`null` once deleted). */
export interface ActivityUser {
  id: string;
  name: string | null;
}

/** Who acted on an event. */
export type ActivityActor =
  | ({ type: "user" } & ActivityUser)
  | { type: "system" }
  | { type: "anonymous" };

/** What an event is about: a user (with a name to link), or another object by its type. */
export type ActivityTarget =
  | ({ type: "user" } & ActivityUser)
  | { type: Exclude<AuditTargetType, "user">; id: string };

/** One row of the activity table. */
export interface ActivityRow {
  id: string;
  /** ISO instant. */
  occurredAt: string;
  /** `null` for an action code this version does not know. */
  action: AuditAction | null;
  outcome: AuditOutcome;
  actor: ActivityActor;
  target: ActivityTarget | null;
  reason: string | null;
  provider: AuditProvider | null;
  /** `"unreadable"` when the stored metadata does not pass the schema. */
  metadata: AuditMetadata | "unreadable" | null;
}

/** How many events each value of each facet would show. */
export interface ActivityFacets {
  action: Partial<Record<AuditAction, number>>;
  outcome: Record<AuditOutcome, number>;
}

/** One page of the activity log, the facet counts, and the users the actor and target filters name. */
export interface ActivityPage {
  rows: ActivityRow[];
  total: number;
  page: number;
  size: number;
  facets: ActivityFacets;
  filterUsers: { actor: ActivityUser | null; target: ActivityUser | null };
}

type AuditExpressions = ExpressionBuilder<DB, "audit_event">;
type ActivityFacet = "action" | "outcome";

/**
 * The conditions of every filter in `input`, all but the facet `except`. Values of one facet
 * combine with OR, the filters with AND. The period is whole days in the app's time zone.
 */
function filterConditions(
  eb: AuditExpressions,
  input: ListActivityInput,
  except?: ActivityFacet,
): Expression<SqlBool>[] {
  const conditions: Expression<SqlBool>[] = [];
  // NOTE: the CHECK audit_event_actor_id makes a non-null actor_id a user actor.
  if (input.actor) conditions.push(eb("audit_event.actor_id", "=", input.actor));
  if (input.target) {
    conditions.push(eb("audit_event.target_type", "=", "user"));
    conditions.push(eb("audit_event.target_id", "=", input.target));
  }
  if (input.action && except !== "action") {
    conditions.push(eb("audit_event.action", "in", input.action));
  }
  if (input.outcome && except !== "outcome") {
    conditions.push(eb("audit_event.outcome", "in", input.outcome));
  }
  if (input.from) conditions.push(eb("audit_event.occurred_at", ">=", startOfDayIn(input.from)));
  if (input.to) conditions.push(eb("audit_event.occurred_at", "<", endOfDayIn(input.to)));
  return conditions;
}

function parseAction(value: string): AuditAction | null {
  return AUDIT_ACTIONS.find((action) => action === value) ?? null;
}

/** @throws Error for an outcome the CHECK audit_event_outcome does not allow. */
function parseOutcome(value: string): AuditOutcome {
  const outcome = AUDIT_OUTCOMES.find((known) => known === value);
  if (!outcome) throw new Error(`audit_event holds an unknown outcome: ${value}`);
  return outcome;
}

function parseMetadata(value: unknown): ActivityRow["metadata"] {
  if (value === null || value === undefined) return null;
  const parsed = auditMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : "unreadable";
}

/** Returns the current names of the users with `ids`, as a map from id to name. */
async function userNames(db: Kysely<DB>, ids: ReadonlySet<string>): Promise<Map<string, string>> {
  if (ids.size === 0) return new Map();
  const users = await db
    .selectFrom("user")
    .select(["user.id", "user.name"])
    .where("user.id", "in", [...ids])
    .execute();
  return new Map(users.map((user) => [user.id, user.name]));
}

/**
 * Counts the events per action and per outcome under the other filters, so a facet keeps
 * offering its other values. The total of the list is the sum of the chosen outcomes.
 */
async function activityFacets(
  db: Kysely<DB>,
  input: ListActivityInput,
): Promise<{ facets: ActivityFacets; total: number }> {
  const byAction = await db
    .selectFrom("audit_event")
    .select((eb) => ["audit_event.action", eb.fn.countAll<string>().as("n")])
    .where((eb) => eb.and(filterConditions(eb, input, "action")))
    .groupBy("audit_event.action")
    .execute();
  const byOutcome = await db
    .selectFrom("audit_event")
    .select((eb) => ["audit_event.outcome", eb.fn.countAll<string>().as("n")])
    .where((eb) => eb.and(filterConditions(eb, input, "outcome")))
    .groupBy("audit_event.outcome")
    .execute();

  const action: Partial<Record<AuditAction, number>> = {};
  for (const row of byAction) {
    const known = parseAction(row.action);
    if (known) action[known] = Number(row.n);
  }
  const outcome: Record<AuditOutcome, number> = { success: 0, failure: 0, refused: 0 };
  for (const row of byOutcome) outcome[parseOutcome(row.outcome)] = Number(row.n);
  const chosen: readonly AuditOutcome[] = input.outcome ?? AUDIT_OUTCOMES;
  const total = chosen.reduce<number>((sum, value) => sum + outcome[value], 0);
  return { facets: { action, outcome }, total };
}

/**
 * Reads one page of the activity log for an administrator: the actor, target, action, outcome
 * and period filters, sorted by time (newest first by default) with the id as tie-break in the
 * same direction, `limit`/`offset` pagination, the facet counts, and the names of the users the
 * page and the filters name.
 *
 * @throws AuthError (403) when `viewer` does not hold the admin role (A01; the server function's
 * middleware refuses first).
 */
export async function readActivityLog(
  db: Kysely<DB>,
  viewer: Pick<SessionUser, "roles">,
  input: ListActivityInput,
): Promise<ActivityPage> {
  if (!hasRole(viewer, "admin")) throw new AuthError(403);
  const size = input.size ?? DEFAULT_ACTIVITY_PAGE_SIZE;
  const page = input.page ?? 1;
  const dir = input.dir ?? "desc";

  const rows = await db
    .selectFrom("audit_event")
    .select([
      "audit_event.id",
      "audit_event.occurred_at",
      "audit_event.action",
      "audit_event.outcome",
      "audit_event.actor_type",
      "audit_event.actor_id",
      "audit_event.target_type",
      "audit_event.target_id",
      "audit_event.reason_code",
      "audit_event.provider",
      "audit_event.metadata",
    ])
    .where((eb) => eb.and(filterConditions(eb, input)))
    .orderBy("audit_event.occurred_at", dir)
    .orderBy("audit_event.id", dir)
    .limit(size)
    .offset((page - 1) * size)
    .execute();
  // Sequential on purpose: a test runs on one pinned connection (src/server/db/test-db.ts).
  const { facets, total } = await activityFacets(db, input);

  const ids = new Set<string>();
  for (const row of rows) {
    if (row.actor_id) ids.add(row.actor_id);
    if (row.target_type === "user" && row.target_id) ids.add(row.target_id);
  }
  if (input.actor) ids.add(input.actor);
  if (input.target) ids.add(input.target);
  const names = await userNames(db, ids);
  const user = (id: string): ActivityUser => ({ id, name: names.get(id) ?? null });

  return {
    rows: rows.map((row) => {
      const actor: ActivityActor =
        row.actor_type === "user" && row.actor_id
          ? { type: "user", ...user(row.actor_id) }
          : { type: row.actor_type === "system" ? "system" : "anonymous" };
      const targetType = AUDIT_TARGET_TYPES.find((type) => type === row.target_type);
      let target: ActivityTarget | null = null;
      if (targetType && row.target_id) {
        target =
          targetType === "user"
            ? { type: "user", ...user(row.target_id) }
            : { type: targetType, id: row.target_id };
      }
      return {
        id: row.id,
        occurredAt: row.occurred_at.toISOString(),
        action: parseAction(row.action),
        outcome: parseOutcome(row.outcome),
        actor,
        target,
        reason: row.reason_code,
        provider: auditProvider(row.provider) ?? null,
        metadata: parseMetadata(row.metadata),
      };
    }),
    total,
    page,
    size,
    facets,
    filterUsers: {
      actor: input.actor ? user(input.actor) : null,
      target: input.target ? user(input.target) : null,
    },
  };
}

/** One user a search for the actor or target filter found. */
export interface ActivityUserMatch {
  id: string;
  name: string;
  email: string;
}

/**
 * Finds the users whose name or e-mail address contains `q` (case-insensitive), by name, at most
 * {@link USER_SEARCH_LIMIT}. The administrator picks one; the log is then filtered on its id.
 *
 * @throws AuthError (403) when `viewer` does not hold the admin role.
 */
export async function searchActivityUsers(
  db: Kysely<DB>,
  viewer: Pick<SessionUser, "roles">,
  input: ActivityUserSearchInput,
): Promise<ActivityUserMatch[]> {
  if (!hasRole(viewer, "admin")) throw new AuthError(403);
  const pattern = containsPattern(input.q.trim());
  return db
    .selectFrom("user")
    .select(["user.id", "user.name", "user.email"])
    .where((eb) => eb.or([eb("user.name", "ilike", pattern), eb("user.email", "ilike", pattern)]))
    .orderBy("user.name")
    .orderBy("user.id")
    .limit(USER_SEARCH_LIMIT)
    .execute();
}
