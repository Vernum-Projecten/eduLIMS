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
import { logValidationRefusal, noteRequestActor } from "./input-refusal-log.ts";
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
  noteRequestActor(headers, user.id);
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

/**
 * The global function middleware (`functionMiddleware` in src/start.ts) that logs a validator
 * refusal of any server function as `input_validation_fail` and rethrows it unchanged, so the
 * caller's answer stays the same, also when the log write fails (ASVS 5.0 V16.3.3, #304). Start runs a function's validator
 * after the function's own middleware, inside this middleware's `next()`.
 */
export const inputRefusalLogMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next, serverFnMeta }) => {
    try {
      return await next();
    } catch (error) {
      try {
        logValidationRefusal(error, getRequestHeaders(), serverFnMeta.name || serverFnMeta.id);
      } catch {
        // NOTE: ASVS V16.5.1, #357; a failed log write must not turn the caller's refusal into a
        // 500, so the original error is rethrown below either way.
      }
      throw error;
    }
  },
);
