// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of the Users screen (#34, B1). A direct Kysely query instead of better-auth's
// `admin/list-users`: that endpoint filters on one column of `user` only, and the table filters
// on the provider (`account`), on the status (ban and last sign-in together) and on a role in a
// role set, and counts live sessions. No column with grades, results or submissions (R-01).
import "@tanstack/react-start/server-only";
import { type Expression, type Kysely, type SelectQueryBuilder, type SqlBool, sql } from "kysely";
import { parseRoleSource, type RoleSource } from "../../lib/role-source.ts";
import { ALLOWED_ROLE_SETS, formatRoles, type Role } from "../../lib/roles.ts";
import { parseSignInMethod, type SignInMethod } from "../../lib/sign-in-method.ts";
import { sessionRoles } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  DEFAULT_USER_PAGE_SIZE,
  type ListUsersInput,
  type UserSortField,
  type UserStatus,
} from "./schemas.ts";

/** Returns the stored role values (`teacher`, `teacher,admin`) of every allowed set with `role`. */
export function roleValuesWith(role: Role): string[] {
  return ALLOWED_ROLE_SETS.filter((set) => (set as readonly Role[]).includes(role)).map((set) =>
    formatRoles(set),
  );
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

/**
 * Reads one page of users for the administrator's table: search on name and e-mail (contains,
 * case-insensitive), filters on role, sign-in provider and status, one sort column with the id
 * as tie-break, and `limit`/`offset` pagination with the total count.
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
  const search = input.q?.trim();

  let query = db.selectFrom("user");
  if (search) {
    const pattern = containsPattern(search);
    query = query.where((eb) =>
      eb.or([eb("user.name", "ilike", pattern), eb("user.email", "ilike", pattern)]),
    );
  }
  if (input.role) query = query.where("user.role", "in", roleValuesWith(input.role));
  if (input.provider) {
    const provider = input.provider;
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom("account")
          .select("account.id")
          .whereRef("account.userId", "=", "user.id")
          .where("account.providerId", "=", provider),
      ),
    );
  }
  if (input.status) {
    query = query.where((eb) => {
      const blocked: Expression<SqlBool> = eb.and([
        eb("user.banned", "=", true),
        eb.or([eb("user.banExpires", "is", null), eb("user.banExpires", ">", now)]),
      ]);
      if (input.status === "blocked") return blocked;
      const signedIn =
        input.status === "never"
          ? eb("user.last_sign_in_at", "is", null)
          : eb("user.last_sign_in_at", "is not", null);
      return eb.and([eb.not(blocked), signedIn]);
    });
  }

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
