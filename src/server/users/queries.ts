// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of the Users screen (#34, B1). A direct Kysely query instead of better-auth's
// `admin/list-users`: that endpoint filters on one column of `user` only, and the table filters
// on the provider (`account`), on the status (ban and last sign-in together) and on a role in a
// role set, and counts live sessions. No column with grades, results or submissions (R-01).
import "@tanstack/react-start/server-only";
import {
  type Expression,
  type ExpressionBuilder,
  type Kysely,
  type SelectQueryBuilder,
  type SqlBool,
  sql,
} from "kysely";
import { type ProviderId, parseProviderId } from "../../lib/identity-providers.ts";
import { parseRoleSource, type RoleSource } from "../../lib/role-source.ts";
import { ALLOWED_ROLE_SETS, formatRoles, ROLES, type Role } from "../../lib/roles.ts";
import { parseSignInMethod, type SignInMethod } from "../../lib/sign-in-method.ts";
import { sessionRoles } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  DEFAULT_USER_PAGE_SIZE,
  type ListUsersInput,
  USER_STATUSES,
  type UserSortField,
  type UserStatus,
} from "./schemas.ts";

/** Returns the stored role values (`teacher`, `teacher,admin`) of every allowed set with `role`. */
export function roleValuesWith(role: Role): string[] {
  return ALLOWED_ROLE_SETS.filter((set) => (set as readonly Role[]).includes(role)).map((set) =>
    formatRoles(set),
  );
}

/** Returns the stored role values of every allowed set with any of `roles`. */
export function roleValuesWithAny(roles: readonly Role[]): string[] {
  return [...new Set(roles.flatMap(roleValuesWith))];
}

/** Returns `text` as a `LIKE` pattern that matches it anywhere, with `%`, `_` and `\` escaped. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** The status of a user at `now`: blocked (a ban without an end or ending later), else by sign-in. */
export function userStatus(
  user: { banned: boolean | null; banExpires: Date | null; lastSignInAt: Date | null },
  now: Date,
): UserStatus {
  if (user.banned && (user.banExpires === null || user.banExpires > now)) return "blocked";
  return user.lastSignInAt === null ? "never" : "active";
}

/** One row of the users table. */
export interface UserRow {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  roleSource: RoleSource | null;
  providers: SignInMethod[];
  status: UserStatus;
  /** ISO instant; set while the status is `blocked` with an end date. */
  blockedUntil: string | null;
  lastSignInAt: string | null;
  activeSessions: number;
  /** The provisioning by an identity provider over SCIM (#45), or `null` for none. */
  provisioning: Provisioning | null;
}

/** Who provisioned a user over SCIM (#45), and whether the directory has deactivated them. */
export interface Provisioning {
  providerId: ProviderId;
  /** ISO instant the directory deactivated or deleted the user, else `null`. */
  deprovisionedAt: string | null;
}

/** Returns the provisioning of a user row, or `null` when no identity provider provisioned it. */
export function provisioningOf(row: {
  provisioned_by: string | null;
  deprovisioned_at: Date | null;
}): Provisioning | null {
  const providerId = parseProviderId(row.provisioned_by);
  if (!providerId) return null;
  return { providerId, deprovisionedAt: row.deprovisioned_at?.toISOString() ?? null };
}

/** One page of the users table. */
export interface UserPage {
  rows: UserRow[];
  total: number;
  page: number;
  size: number;
  /** The instant the page was read; relative times count from it, so SSR and the client agree. */
  readAt: string;
}

const SORT_COLUMNS = {
  name: "user.name",
  lastSignIn: "user.last_sign_in_at",
} as const satisfies Record<UserSortField, string>;

type UserExpressions = ExpressionBuilder<DB, "user">;

/** The facets of the users table: the filters that offer a list of values with counts. */
export type UserFacet = "role" | "provider" | "status";

/** The condition that a user's name or e-mail address contains `search`. */
function searchCondition(eb: UserExpressions, search: string): Expression<SqlBool> {
  const pattern = containsPattern(search);
  return eb.or([eb("user.name", "ilike", pattern), eb("user.email", "ilike", pattern)]);
}

/** The condition that a user holds any of `roles`, alone or in a role set. */
function roleCondition(eb: UserExpressions, roles: readonly Role[]): Expression<SqlBool> {
  return eb("user.role", "in", roleValuesWithAny(roles));
}

/** The condition that a user has an account with any of `providers`. */
function providerCondition(
  eb: UserExpressions,
  providers: readonly SignInMethod[],
): Expression<SqlBool> {
  return eb.exists(
    eb
      .selectFrom("account")
      .select("account.id")
      .whereRef("account.userId", "=", "user.id")
      .where("account.providerId", "in", [...providers]),
  );
}

/** The condition that a user has any of `statuses` at `now` (the SQL form of {@link userStatus}). */
function statusCondition(
  eb: UserExpressions,
  statuses: readonly UserStatus[],
  now: Date,
): Expression<SqlBool> {
  const blocked: Expression<SqlBool> = eb.and([
    eb("user.banned", "=", true),
    eb.or([eb("user.banExpires", "is", null), eb("user.banExpires", ">", now)]),
  ]);
  return eb.or(
    statuses.map((status) => {
      if (status === "blocked") return blocked;
      const signedIn =
        status === "never"
          ? eb("user.last_sign_in_at", "is", null)
          : eb("user.last_sign_in_at", "is not", null);
      return eb.and([eb.not(blocked), signedIn]);
    }),
  );
}

/**
 * The conditions of the search and every facet in `input`, all but the facet `except`. Values of
 * one facet combine with OR, the search and the facets with AND.
 */
function filterConditions(
  eb: UserExpressions,
  input: ListUsersInput,
  now: Date,
  except?: UserFacet,
): Expression<SqlBool>[] {
  const conditions: Expression<SqlBool>[] = [];
  const search = input.q?.trim();
  if (search) conditions.push(searchCondition(eb, search));
  if (input.role && except !== "role") conditions.push(roleCondition(eb, input.role));
  if (input.provider && except !== "provider") {
    conditions.push(providerCondition(eb, input.provider));
  }
  if (input.status && except !== "status") conditions.push(statusCondition(eb, input.status, now));
  return conditions;
}

/**
 * Reads one page of users for the administrator's table: search on name and e-mail (contains,
 * case-insensitive), the role, sign-in method and status facets (any of the chosen values), one
 * sort column with the id as tie-break, and `limit`/`offset` pagination with the total count.
 */
export async function listUsers(
  db: Kysely<DB>,
  input: ListUsersInput,
  now: Date,
): Promise<UserPage> {
  const size = input.size ?? DEFAULT_USER_PAGE_SIZE;
  const page = input.page ?? 1;
  const sort = input.sort ?? "name";
  const dir = input.dir ?? "asc";

  const query = db.selectFrom("user").where((eb) => eb.and(filterConditions(eb, input, now)));

  const rows = await query
    .select((eb) => [
      "user.id",
      "user.name",
      "user.email",
      "user.role",
      "user.role_source",
      "user.banned",
      "user.banExpires",
      "user.last_sign_in_at",
      "user.provisioned_by",
      "user.deprovisioned_at",
      eb
        .selectFrom("account")
        .select(sql<string[]>`coalesce(array_agg(distinct "account"."providerId"), '{}')`.as("p"))
        .whereRef("account.userId", "=", "user.id")
        .as("providers"),
      eb
        .selectFrom("session")
        .select(eb.fn.countAll<string>().as("n"))
        .whereRef("session.userId", "=", "user.id")
        .where("session.expiresAt", ">", now)
        .as("active_sessions"),
      sql<string>`count(*) over ()`.as("total"),
    ])
    .orderBy(sql.ref(SORT_COLUMNS[sort]), (ob) =>
      (dir === "asc" ? ob.asc() : ob.desc()).nullsLast(),
    )
    .orderBy("user.id")
    .limit(size)
    .offset((page - 1) * size)
    .execute();

  const total =
    rows[0] !== undefined ? Number(rows[0].total) : page > 1 ? await countUsers(query) : 0;
  return {
    rows: rows.map((row) => {
      const status = userStatus(
        { banned: row.banned, banExpires: row.banExpires, lastSignInAt: row.last_sign_in_at },
        now,
      );
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        roles: sessionRoles(row.role),
        roleSource: parseRoleSource(row.role_source),
        providers: (row.providers ?? []).flatMap((p) => parseSignInMethod(p) ?? []),
        status,
        blockedUntil: status === "blocked" && row.banExpires ? row.banExpires.toISOString() : null,
        lastSignInAt: row.last_sign_in_at?.toISOString() ?? null,
        activeSessions: Number(row.active_sessions ?? 0),
        provisioning: provisioningOf(row),
      };
    }),
    total,
    page,
    size,
    readAt: now.toISOString(),
  };
}

// biome-ignore lint/complexity/noBannedTypes: Kysely's type of a query with no selection yet.
async function countUsers(query: SelectQueryBuilder<DB, "user", {}>): Promise<number> {
  const row = await query
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** How many users each value of each facet would show. */
export interface UserFacets {
  role: Record<Role, number>;
  provider: Partial<Record<SignInMethod, number>>;
  status: Record<UserStatus, number>;
}

/**
 * Counts, for every value of every facet, the users the list would show with that value chosen:
 * the search and the other facets apply, the facet's own choice does not, so a facet keeps
 * offering its other values. One query, one `count(*) filter (…)` per value. `providers` are the
 * sign-in methods the facet offers.
 */
export async function userFacets(
  db: Kysely<DB>,
  input: ListUsersInput,
  now: Date,
  providers: readonly SignInMethod[],
): Promise<UserFacets> {
  const row = await db
    .selectFrom("user")
    .select((eb) => {
      const count = (facet: UserFacet, value: Expression<SqlBool>, alias: string) =>
        eb.fn
          .countAll<string>()
          .filterWhere(eb.and([...filterConditions(eb, input, now, facet), value]))
          .as(alias);
      return [
        ...ROLES.map((role) => count("role", roleCondition(eb, [role]), `role:${role}`)),
        ...providers.map((provider) =>
          count("provider", providerCondition(eb, [provider]), `provider:${provider}`),
        ),
        ...USER_STATUSES.map((status) =>
          count("status", statusCondition(eb, [status], now), `status:${status}`),
        ),
      ];
    })
    .where((eb) => {
      const search = input.q?.trim();
      return search ? searchCondition(eb, search) : eb.lit(true);
    })
    .executeTakeFirstOrThrow();
  const read = (alias: string) => Number(Reflect.get(row, alias) ?? 0);
  return {
    role: {
      student: read("role:student"),
      teacher: read("role:teacher"),
      admin: read("role:admin"),
    },
    provider: Object.fromEntries(
      providers.map((provider) => [provider, read(`provider:${provider}`)]),
    ),
    status: {
      active: read("status:active"),
      blocked: read("status:blocked"),
      never: read("status:never"),
    },
  };
}
