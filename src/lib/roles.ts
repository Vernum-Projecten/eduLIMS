// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Role definitions shared by the better-auth server config and the auth client.
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

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

/** better-auth admin plugin roles: only the beheerder manages users and sessions. */
export const roles = {
  student: accessControl.newRole({ user: [], session: [] }),
  docent: accessControl.newRole({ user: [], session: [] }),
  beheerder: accessControl.newRole(adminAc.statements),
} satisfies Record<Role, unknown>;
