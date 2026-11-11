// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Role definitions shared by the better-auth server config and the auth client.
// Display names live in the message catalogue (`src/lib/i18n/labels.ts`).
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

export const ROLES = ["student", "teacher", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const DEFAULT_ROLE = "student" satisfies Role;
export const ADMIN_ROLE = "admin" satisfies Role;

/** Returns `value` when it names a role, so a typo or an unknown value never grants access. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * The role sets a person may hold (owner decision 2026-11-11, ADR 0012): one role, or teacher
 * and admin together. Student is exclusive. No role implies another.
 */
export const ALLOWED_ROLE_SETS = [
  ["student"],
  ["teacher"],
  ["admin"],
  ["teacher", "admin"],
] as const satisfies readonly (readonly Role[])[];

/** The outcome of {@link validateRoleSet}. */
export type RoleSetValidation =
  | { ok: true; roles: Role[] }
  | { ok: false; reason: "empty" | "conflict" };

/** Returns `roles` without duplicates, in the order of {@link ROLES}. */
export function sortRoles(roles: Iterable<Role>): Role[] {
  const held = new Set(roles);
  return ROLES.filter((role) => held.has(role));
}

/**
 * Checks a role set against {@link ALLOWED_ROLE_SETS}, ignoring duplicates. On success it
 * returns the roles sorted; a set with student and any other role is a `conflict`.
 */
export function validateRoleSet(roles: Iterable<Role>): RoleSetValidation {
  const sorted = sortRoles(roles);
  if (sorted.length === 0) return { ok: false, reason: "empty" };
  const allowed = ALLOWED_ROLE_SETS.some(
    (set) => set.length === sorted.length && set.every((role, index) => sorted[index] === role),
  );
  return allowed ? { ok: true, roles: sorted } : { ok: false, reason: "conflict" };
}

/** Returns the stored form of a role set: sorted and comma-separated (`teacher,admin`). */
export function formatRoles(roles: Iterable<Role>): string {
  return sortRoles(roles).join(",");
}

/**
 * Validates a value about to be written to better-auth's `role` column: a comma-separated
 * string or a string array, as the admin plugin accepts. Every entry must name a role
 * (`unknown` otherwise), and the set must be allowed.
 */
export function validateRoleValue(
  value: unknown,
): RoleSetValidation | { ok: false; reason: "unknown" } {
  const entries = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [value];
  const trimmed = entries.map((entry) => (typeof entry === "string" ? entry.trim() : entry));
  const roles = trimmed.filter(isRole);
  if (roles.length !== trimmed.length) return { ok: false, reason: "unknown" };
  return validateRoleSet(roles);
}

export const accessControl = createAccessControl({ ...defaultStatements });

/**
 * The user-management actions of the administrator (B1): the better-auth admin
 * statements minus impersonation and credential changes.
 *
 * NOTE: R-01 and Q-SEC-2; impersonation would bypass the ownership checks,
 * and sign-in is SSO, so eduLIMS sets no password, e-mail or phone.
 */
export const ADMIN_STATEMENTS = {
  user: ["create", "list", "get", "update", "set-role", "ban", "delete"],
  session: ["list", "revoke"],
} as const;

/** better-auth admin plugin roles: only the administrator manages users and sessions. */
export const roles = {
  student: accessControl.newRole({ user: [], session: [] }),
  teacher: accessControl.newRole({ user: [], session: [] }),
  admin: accessControl.newRole({
    user: [...ADMIN_STATEMENTS.user],
    session: [...ADMIN_STATEMENTS.session],
  }),
} satisfies Record<Role, unknown>;
