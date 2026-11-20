// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The last-administrator rule (maintainer, 2026-11-20, #318, #345): every path that takes the
// admin role away or blocks an administrator (a deletion, `pnpm admin:revoke`, the Users screen's
// role edit and block) locks the administrators first, the same way and in the same order, so
// two of them queue instead of each counting the other as the one left. Relative imports: the
// host CLI loads this in plain Node.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { storedRoleSetsWith } from "../../lib/roles.ts";
import type { DB } from "../db/schema.gen.ts";

/** The refusal code of taking the admin role from the last administrator. */
export const LAST_ADMIN = "last_admin" as const;

/** The refusal code of an actor who lost the admin role while their request ran. */
export const NOT_AN_ADMIN = "not_an_admin" as const;

/** The stored role sets that hold the admin role (`admin`, `teacher,admin`). */
export const ADMIN_ROLE_VALUES: readonly string[] = storedRoleSetsWith("admin");

/** Returns whether the stored role value `role` holds the admin role. */
export function holdsAdmin(role: string | null): boolean {
  return role !== null && ADMIN_ROLE_VALUES.includes(role);
}

/** An administrator row as {@link lockAdministrators} reads it. */
export interface AdministratorRow {
  id: string;
  banned: boolean | null;
  banExpires: Date | null;
  deprovisioned_at: Date | null;
}

/**
 * Returns whether `row` is blocked at `now`: banned, with no end or an end at or after `now`, as
 * the admin plugin judges a sign-in (`banExpires` not yet passed).
 */
export function isBlocked(row: { banned?: unknown; banExpires?: unknown }, now: Date): boolean {
  if (row.banned !== true) return false;
  if (row.banExpires === null || row.banExpires === undefined) return true;
  const end = row.banExpires instanceof Date ? row.banExpires : new Date(String(row.banExpires));
  return Number.isNaN(end.getTime()) || end.getTime() >= now.getTime();
}

/**
 * Returns whether the administrator `row` can act at `now`: not blocked, and not deprovisioned by
 * the directory (maintainer decision on the second review of #356, N3).
 */
export function isAvailable(row: AdministratorRow, now: Date): boolean {
  return !isBlocked(row, now) && row.deprovisioned_at === null;
}

/**
 * Locks every user who holds the admin role (`FOR NO KEY UPDATE`, in id order) and returns them.
 * Two transactions that each take the role from an administrator queue on the first of these
 * rows instead of each holding its own target and waiting for the other's; a session insert (a
 * key-share lock) still passes.
 */
export async function lockAdministrators(trx: Kysely<DB>): Promise<AdministratorRow[]> {
  return trx
    .selectFrom("user")
    .select(["id", "banned", "banExpires", "deprovisioned_at"])
    .where("role", "in", ADMIN_ROLE_VALUES)
    .orderBy("id")
    .forNoKeyUpdate()
    .execute();
}

/** What a role change holds once {@link lockForRoleChange} returns. */
export interface RoleChangeLocks {
  /** The administrators, locked, in id order. */
  administrators: readonly AdministratorRow[];
  /** The target, locked, or `undefined` when it does not exist. */
  user: { role: string | null; role_source: string } | undefined;
}

/**
 * Locks the administrators, then the user `userId` (`FOR UPDATE`). The administrator locks come
 * first whatever the target holds, so a target that gains the admin role meanwhile cannot make
 * two transactions wait on each other.
 */
export async function lockForRoleChange(trx: Kysely<DB>, userId: string): Promise<RoleChangeLocks> {
  const administrators = await lockAdministrators(trx);
  const user = await trx
    .selectFrom("user")
    .select(["role", "role_source"])
    .where("id", "=", userId)
    .forUpdate()
    .executeTakeFirst();
  return { administrators, user };
}

/**
 * Returns whether `actorId` holds the admin role under the locks of {@link lockForRoleChange} and
 * is available at `now` ({@link isAvailable}): a blocked or deprovisioned actor acts no more.
 */
export function actorIsAdministrator(locks: RoleChangeLocks, actorId: string, now: Date): boolean {
  return locks.administrators.some((row) => row.id === actorId && isAvailable(row, now));
}

/**
 * Returns whether no administrator but `userId` is left who is available at `now`
 * ({@link isAvailable}), read again under the locks, so an administrator who joined while the
 * target row was awaited counts too.
 */
export async function isLastAdministrator(
  trx: Kysely<DB>,
  userId: string,
  now: Date,
): Promise<boolean> {
  const rows = await lockAdministrators(trx);
  return !rows.some((row) => row.id !== userId && isAvailable(row, now));
}
