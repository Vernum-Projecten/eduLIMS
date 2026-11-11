// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import { type Auth, getAuth } from "./auth.ts";
import { parseLastPortal, type SessionUser, sessionRoles } from "./authz.ts";
import { isPastAbsoluteLifetime } from "./session-policy.ts";

/**
 * Resolves the signed-in user from the request cookies with `auth`. Returns a minimal
 * projection so session tokens and other internals are never serialised to the client. A
 * stored role set that is not allowed (ADR 0012) yields no roles. A session past its absolute
 * lifetime (24 hours after sign-in, #42) is revoked and yields no user.
 */
export async function resolveSessionUser(
  auth: Auth,
  headers: Headers,
  now: Date = new Date(),
): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  if (isPastAbsoluteLifetime(new Date(session.session.createdAt), now)) {
    const context = await auth.$context;
    await context.internalAdapter.deleteSession(session.session.token);
    return null;
  }
  const { id, name, email, role } = session.user;
  return {
    id,
    name,
    email,
    roles: sessionRoles(role),
    lastPortal: parseLastPortal(session.user["lastPortal"]),
  };
}

/** Resolves the signed-in user of a request with the app's better-auth instance. */
export function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  return resolveSessionUser(getAuth(), headers);
}
