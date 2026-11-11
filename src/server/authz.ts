// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Pure authorization rules. No I/O: every server function and server route that touches
// user data must call these with the session user loaded on the server, never with
// identifiers or roles sent by the client.
import { isRole, type Role, validateRoleSet } from "../lib/roles.ts";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  roles: readonly Role[];
  /** The portal the user last switched to (ADR 0012), or `null` before the first switch. */
  lastPortal: Role | null;
}

/**
 * Portal path per role, in the order a first sign-in falls back through (ADR 0012): teacher,
 * then admin, then student. The order picks a landing page only; it grants nothing.
 */
const PORTALS = [
  { role: "teacher", path: "/teacher" },
  { role: "admin", path: "/admin" },
  { role: "student", path: "/student" },
] as const satisfies readonly { role: Role; path: string }[];

export type PortalPath = (typeof PORTALS)[number]["path"];

/**
 * Parses the better-auth admin plugin `role` column (comma-separated) into known roles.
 * Unknown values are dropped, so a typo never grants access.
 */
export function parseRoles(role: string | null | undefined): Role[] {
  if (!role) return [];
  const parsed = role
    .split(",")
    .map((r) => r.trim())
    .filter(isRole);
  return [...new Set(parsed)];
}

/**
 * Returns the roles a session may use: the parsed `role` column when it is an allowed role
 * set, else none. A stored conflict (student with teacher or admin) fails closed.
 */
export function sessionRoles(role: string | null | undefined): Role[] {
  const result = validateRoleSet(parseRoles(role));
  return result.ok ? result.roles : [];
}

/** Returns the saved portal when it names a role, else `null`. */
export function parseLastPortal(value: unknown): Role | null {
  return isRole(value) ? value : null;
}

export function hasRole(user: Pick<SessionUser, "roles"> | null | undefined, role: Role): boolean {
  return user?.roles.includes(role) ?? false;
}

export function hasAnyRole(
  user: Pick<SessionUser, "roles"> | null | undefined,
  roles: readonly Role[],
): boolean {
  return roles.some((role) => hasRole(user, role));
}

/**
 * Returns the portal a user lands on (ADR 0012): the saved `lastPortal` while the user still
 * holds that role, else the first of teacher, admin, student they hold, else `null`.
 */
export function landingPortal(
  user: Pick<SessionUser, "roles"> & { lastPortal?: Role | null | undefined },
): Role | null {
  if (user.lastPortal && hasRole(user, user.lastPortal)) return user.lastPortal;
  return PORTALS.find((portal) => hasRole(user, portal.role))?.role ?? null;
}

/** Returns the path of the portal for `role`. */
export function portalPath(role: Role): PortalPath {
  return `/${role}`;
}

/** The landing portal's path for a user, or `null` when the user has no recognised role. */
export function portalPathFor(
  user: Pick<SessionUser, "roles"> & { lastPortal?: Role | null | undefined },
): PortalPath | null {
  const portal = landingPortal(user);
  return portal ? portalPath(portal) : null;
}

/** Who owns a set of measurement results and which teacher supervises the practical. */
export interface ResultScope {
  ownerId: string;
  teacherId: string;
}

/**
 * Students only see their own results; teachers only see results from their own practicals.
 * Admins manage users, not grades, so they get no access to results.
 */
export function canViewResultsOf(
  viewer: SessionUser | null | undefined,
  scope: ResultScope,
): boolean {
  if (!viewer) return false;
  if (hasRole(viewer, "student") && scope.ownerId === viewer.id) return true;
  if (hasRole(viewer, "teacher") && scope.teacherId === viewer.id) return true;
  return false;
}
