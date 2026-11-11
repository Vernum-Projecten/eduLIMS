// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The last gate before a role set reaches the database: every user insert and update that
// carries a role (IdP sync, the seed, the admin plugin's create-user, set-role and update-user)
// runs through better-auth's database hooks. Relative imports: `pnpm db:seed` loads this in Node.
import "@tanstack/react-start/server-only";
import { APIError, type BetterAuthOptions } from "better-auth";
import { ROLE_CONFLICT_ERROR } from "../lib/identity-providers.ts";
import { formatRoles, validateRoleValue } from "../lib/roles.ts";

type UserHooks = NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["user"]>;

/** The error better-auth returns when a write carries a role set that is not allowed. */
export const ROLE_SET_REFUSED = { code: "ROLE_SET_NOT_ALLOWED", message: ROLE_CONFLICT_ERROR };

/**
 * Returns the stored form of `value` (sorted, comma-separated) when it is an allowed role set
 * (ADR 0012).
 *
 * @throws APIError 400 `ROLE_SET_NOT_ALLOWED` for an unknown role, an empty set, or student
 * combined with teacher or admin.
 */
export function guardRoleValue(value: unknown): string {
  const result = validateRoleValue(value);
  if (!result.ok) {
    // Logs the reason only: never the user or the requested value (A09, privacy).
    console.warn(`role write refused: ${result.reason}`);
    throw APIError.from("BAD_REQUEST", ROLE_SET_REFUSED);
  }
  return formatRoles(result.roles);
}

/** better-auth `databaseHooks.user` that validate and normalise every role write. */
export const roleWriteHooks = {
  create: {
    before: async (user) => {
      if (user["role"] === undefined) return;
      return { data: { ...user, role: guardRoleValue(user["role"]) } };
    },
  },
  update: {
    before: async (user) => {
      if (!Object.hasOwn(user, "role")) return;
      return { data: { ...user, role: guardRoleValue(user["role"]) } };
    },
  },
} satisfies UserHooks;
