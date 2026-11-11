// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import { getAuth } from "./auth.ts";
import { parseLastPortal, type SessionUser, sessionRoles } from "./authz.ts";

/**
 * Resolves the signed-in user from the request cookies. Returns a minimal projection so
 * session tokens and other internals are never serialised to the client. A stored role set
 * that is not allowed (ADR 0012) yields no roles.
 */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  const { id, name, email, role } = session.user;
  return {
    id,
    name,
    email,
    roles: sessionRoles(role),
    lastPortal: parseLastPortal(session.user["lastPortal"]),
  };
}
