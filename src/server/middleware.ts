// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server function middleware: the data boundary. Route `beforeLoad` guards are UX only;
// attach these to every createServerFn that reads or writes user data. No server-only marker:
// a server function module the client imports references them, and the Start compiler strips
// every `.server()` body (and with it the session lookup) from the client bundle.
import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { Role } from "../lib/roles.ts";
import { hasAnyRole } from "./authz.ts";
import { logAuthzFailure } from "./security-log.ts";
import { getSessionUser } from "./session.ts";

export class AuthError extends Error {
  readonly status: 401 | 403;
  constructor(status: 401 | 403) {
    super(status === 401 ? "Not signed in" : "Forbidden");
    this.status = status;
  }
}

export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const headers = getRequestHeaders();
  const user = await getSessionUser(headers);
  if (!user) {
    logAuthzFailure(headers, 401);
    throw new AuthError(401);
  }
  return next({ context: { user } });
});

/** Requires a signed-in user holding at least one of the given roles. */
export function requireRole(...roles: Role[]) {
  return createMiddleware({ type: "function" })
    .middleware([authMiddleware])
    .server(async ({ next, context }) => {
      if (!hasAnyRole(context.user, roles)) {
        logAuthzFailure(getRequestHeaders(), 403, context.user.id, roles);
        throw new AuthError(403);
      }
      return next();
    });
}
