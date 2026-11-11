// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import { getAuth } from "./auth.ts";
import { parseRoles, type SessionUser } from "./authz.ts";

/**
 * Resolves the signed-in user from the request cookies. Returns a minimal projection so
 * session tokens and other internals are never serialised to the client.
 */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  const { id, name, email, role } = session.user;
  return { id, name, email, roles: parseRoles(role) };
}
