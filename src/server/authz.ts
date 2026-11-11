// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Pure authorization rules. No I/O: every server function and server route that touches
// user data must call these with the session user loaded on the server, never with
// identifiers or roles sent by the client.
import { ROLES, type Role } from "../lib/roles.ts";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  roles: readonly Role[];
}

/** Portal path per role, in order of precedence when a user has several roles. */
const PORTALS = [
  { role: "admin", path: "/admin" },
  { role: "teacher", path: "/teacher" },
  { role: "student", path: "/student" },
] as const satisfies readonly { role: Role; path: string }[];

export type PortalPath = (typeof PORTALS)[number]["path"];

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

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

export function hasRole(user: Pick<SessionUser, "roles"> | null | undefined, role: Role): boolean {
  return user?.roles.includes(role) ?? false;
}

export function hasAnyRole(
  user: Pick<SessionUser, "roles"> | null | undefined,
  roles: readonly Role[],
): boolean {
  return roles.some((role) => hasRole(user, role));
}

/** The landing portal for a user, or `null` when the user has no recognised role. */
export function portalPathFor(user: Pick<SessionUser, "roles">): PortalPath | null {
  return PORTALS.find((portal) => hasRole(user, portal.role))?.path ?? null;
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
