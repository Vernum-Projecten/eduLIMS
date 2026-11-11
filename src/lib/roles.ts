// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Role definitions shared by the better-auth server config and the auth client.
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

export const ROLES = ["student", "docent", "beheerder"] as const;
export type Role = (typeof ROLES)[number];

export const DEFAULT_ROLE = "student" satisfies Role;
export const ADMIN_ROLE = "beheerder" satisfies Role;

/** Dutch labels for display. */
export const ROLE_LABELS: Record<Role, string> = {
  student: "Student",
  docent: "Docent",
  beheerder: "Beheerder",
};

export const accessControl = createAccessControl({ ...defaultStatements });

/**
 * The user-management actions of the beheerder (B1): the better-auth admin
 * statements minus impersonation and credential changes.
 *
 * NOTE: R-01 and Q-SEC-2; impersonation would bypass the ownership checks,
 * and sign-in is SSO, so eduLIMS sets no password, e-mail or phone.
 */
export const BEHEERDER_STATEMENTS = {
  user: ["create", "list", "get", "update", "set-role", "ban", "delete"],
  session: ["list", "revoke"],
} as const;

/** better-auth admin plugin roles: only the beheerder manages users and sessions. */
export const roles = {
  student: accessControl.newRole({ user: [], session: [] }),
  docent: accessControl.newRole({ user: [], session: [] }),
  beheerder: accessControl.newRole({
    user: [...BEHEERDER_STATEMENTS.user],
    session: [...BEHEERDER_STATEMENTS.session],
  }),
} satisfies Record<Role, unknown>;
