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
