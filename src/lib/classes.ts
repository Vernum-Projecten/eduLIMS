// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Classes and lab groups (#28, B2, D2): a class is a better-auth organization, a lab group a
// team (ADR 0017). The class roles and what each may do are the one rule the server checks and
// the screens read. Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import { createAccessControl } from "better-auth/plugins/access";

/** The roles a person holds inside one class; separate from the app role (ADR 0012). */
export const CLASS_ROLES = ["owner", "teacher", "student"] as const;
export type ClassRole = (typeof CLASS_ROLES)[number];

/** The class roles a teacher of the class holds. */
export const TEACHING_ROLES = ["owner", "teacher"] as const satisfies readonly ClassRole[];

/** The class roles an invitation can carry: the owner is never invited. */
export const INVITATION_ROLES = ["teacher", "student"] as const satisfies readonly ClassRole[];
export type InvitationRole = (typeof INVITATION_ROLES)[number];

/** Returns `value` when it names a class role. */
export function isClassRole(value: unknown): value is ClassRole {
  return typeof value === "string" && (CLASS_ROLES as readonly string[]).includes(value);
}

/** Returns whether a class role teaches the class (owner or co-teacher). */
export function isTeachingRole(role: ClassRole): boolean {
  return role === "owner" || role === "teacher";
}

/** What can be done to a class, by resource; the class roles below grant subsets. */
export const CLASS_STATEMENTS = {
  class: ["update", "archive", "unarchive", "delete", "copy", "transfer"],
  student: ["invite", "remove"],
  coTeacher: ["invite", "remove"],
  group: ["manage"],
} as const;

/** The access control of the class roles (better-auth `createAccessControl`). */
export const classAccessControl = createAccessControl(CLASS_STATEMENTS);

/**
 * The class roles of the issue's table (#28). The owner does everything; a co-teacher invites
 * and removes students and manages lab groups; a student manages nothing.
 *
 * NOTE: owner decision on #28 (3); only the owner invites co-teachers.
 */
export const classRoles = {
  owner: classAccessControl.newRole({
    class: ["update", "archive", "unarchive", "delete", "copy", "transfer"],
    student: ["invite", "remove"],
    coTeacher: ["invite", "remove"],
    group: ["manage"],
  }),
  teacher: classAccessControl.newRole({
    student: ["invite", "remove"],
    group: ["manage"],
  }),
  student: classAccessControl.newRole({}),
} satisfies Record<ClassRole, unknown>;

/** One permission of a class role: a resource and one of its actions. */
export type ClassPermission = {
  [R in keyof typeof CLASS_STATEMENTS]: {
    readonly [K in R]: readonly [(typeof CLASS_STATEMENTS)[R][number]];
  };
}[keyof typeof CLASS_STATEMENTS];

/** Returns whether `role` may do `permission` in a class. */
export function classCan(role: ClassRole, permission: ClassPermission): boolean {
  return classRoles[role].authorize(permission).success;
}

/** The permission to invite or remove someone with a class role. */
export function memberPermission(
  role: InvitationRole,
  action: "invite" | "remove",
): ClassPermission {
  return role === "teacher" ? { coTeacher: [action] } : { student: [action] };
}

/** The longest class name and group name eduLIMS stores. */
export const CLASS_NAME_MAX = 100;
export const GROUP_NAME_MAX = 60;

/** Returns whether `value` is an academic year `YYYY-YYYY` whose second year follows the first. */
export function isAcademicYear(value: string): boolean {
  if (!/^\d{4}-\d{4}$/.test(value)) return false;
  return Number(value.slice(5)) === Number(value.slice(0, 4)) + 1;
}

/** Returns the academic year after `year` ("2026-2027" gives "2027-2028"). */
export function nextAcademicYear(year: string): string {
  const start = Number(year.slice(0, 4)) + 1;
  return `${start}-${start + 1}`;
}
