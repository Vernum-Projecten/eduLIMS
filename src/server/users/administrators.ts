// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The last-administrator rule (maintainer, 2026-11-20, #318, #345): every path that takes the
// admin role away (a deletion, `pnpm admin:revoke`, the Users screen's role edit) locks the
// administrators the same way and in the same order, so two of them queue instead of each
// counting the other as the one left. Relative imports: the host CLI loads this in plain Node.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { storedRoleSetsWith } from "../../lib/roles.ts";
import type { DB } from "../db/schema.gen.ts";

/** The refusal code of taking the admin role from the last administrator. */
export const LAST_ADMIN = "last_admin" as const;

/** The stored role sets that hold the admin role (`admin`, `teacher,admin`). */
export const ADMIN_ROLE_VALUES: readonly string[] = storedRoleSetsWith("admin");

/** Returns whether the stored role value `role` holds the admin role. */
export function holdsAdmin(role: string | null): boolean {
  return role !== null && ADMIN_ROLE_VALUES.includes(role);
}

/**
 * Locks every user who holds the admin role (`FOR NO KEY UPDATE`, in id order) and returns their
 * ids. Two transactions that each take the role from an administrator queue on the first of
 * these rows instead of each holding its own target and waiting for the other's; a session
 * insert (a key-share lock) still passes.
 */
export async function lockAdministrators(trx: Kysely<DB>): Promise<string[]> {
  const rows = await trx
    .selectFrom("user")
    .select("id")
    .where("role", "in", ADMIN_ROLE_VALUES)
    .orderBy("id")
    .forNoKeyUpdate()
    .execute();
  return rows.map((row) => row.id);
}

/**
 * Locks the user `userId` (`FOR UPDATE`) and returns its stored role and role source, or
 * `undefined` when it does not exist. A user who holds the admin role gets the administrator
 * locks first, in the order of {@link lockAdministrators}, so the target row is never held while
 * waiting on them.
 */
export async function lockUserForRoleChange(
  trx: Kysely<DB>,
  userId: string,
): Promise<{ role: string | null; role_source: string | null } | undefined> {
  const seen = await trx
    .selectFrom("user")
    .select("role")
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!seen) return undefined;
  if (holdsAdmin(seen.role)) await lockAdministrators(trx);
  return trx
    .selectFrom("user")
    .select(["role", "role_source"])
    .where("id", "=", userId)
    .forUpdate()
    .executeTakeFirst();
}

/**
 * Returns whether `userId` is the only administrator left, read under the administrator locks.
 * Call it after {@link lockUserForRoleChange}, which took them when the user held the role.
 */
export async function isLastAdministrator(trx: Kysely<DB>, userId: string): Promise<boolean> {
  const others = (await lockAdministrators(trx)).filter((id) => id !== userId);
  return others.length === 0;
}
