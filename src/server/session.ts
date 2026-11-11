// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import { CREDENTIAL_SIGN_IN } from "../lib/sign-in-method.ts";
import { type Auth, getAuth } from "./auth.ts";
import { parseLastPortal, type SessionUser, sessionRoles } from "./authz.ts";
import { getDb } from "./db/index.ts";
import { providerEnabled } from "./idp/registry.ts";
import { isPastAbsoluteLifetime } from "./session-policy.ts";

/** Whether the provider a session signed in with is still enabled; the database decides. */
export type ProviderEnabled = (providerId: string) => Promise<boolean>;

/**
 * Resolves the signed-in user from the request cookies with `auth`. Returns a minimal
 * projection so session tokens and other internals are never serialised to the client. A
 * stored role set that is not allowed (ADR 0012) yields no roles. A session past its absolute
 * lifetime (24 hours after sign-in, #42), or signed in through a provider that is disabled or
 * gone (ASVS V7.4.2, #92), is revoked and yields no user.
 */
export async function resolveSessionUser(
  auth: Auth,
  headers: Headers,
  now: Date = new Date(),
  isProviderEnabled: ProviderEnabled = (providerId) => providerEnabled(getDb(), providerId),
): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const method: unknown = session.session["signInMethod"];
  const viaDisabledProvider =
    typeof method === "string" &&
    method !== CREDENTIAL_SIGN_IN &&
    !(await isProviderEnabled(method));
  if (viaDisabledProvider || isPastAbsoluteLifetime(new Date(session.session.createdAt), now)) {
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
