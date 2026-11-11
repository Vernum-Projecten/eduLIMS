// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The last sign-in of a user for the Users screen (#34): its method, through better-auth's
// last-login-method plugin, and its time, through a session hook of eduLIMS's own.
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthPlugin } from "better-auth";
import { lastLoginMethod } from "better-auth/plugins";
import type { Kysely } from "kysely";
import { hostCookieName } from "../../lib/cookies.ts";
import { LAST_SIGN_IN_METHOD_COOKIE, parseSignInMethod } from "../../lib/sign-in-method.ts";
import { isSecureOrigin } from "../cookie-security.ts";
import type { DB } from "../db/schema.gen.ts";

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/**
 * Returns the sign-in method of a better-auth endpoint context: the provider of an OAuth
 * callback (Entra ID's `/callback/:id`, Keycloak's `/oauth2/callback/:providerId`), `credential`
 * for the development login, else `null`.
 */
export function signInMethodOf(ctx: unknown): string | null {
  const path = field(ctx, "path");
  const params = field(ctx, "params");
  if (path === "/sign-in/email") return "credential";
  if (path === "/callback/:id") return parseSignInMethod(field(params, "id"));
  if (path === "/oauth2/callback/:providerId")
    return parseSignInMethod(field(params, "providerId"));
  return null;
}

/** 400 days, the longest cookie lifetime browsers keep (RFC 6265bis §5.5). */
const HINT_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/**
 * Returns better-auth's last-login-method plugin, set up for eduLIMS: the method is stored in
 * `user.last_login_method` and in the {@link LAST_SIGN_IN_METHOD_COOKIE} hint cookie.
 */
export function lastSignInMethod(baseURL: string) {
  return lastLoginMethod({
    storeInDatabase: true,
    // NOTE: #43 (ASVS V3.3.3); `__Host-` over https, with the session cookie's attributes.
    cookieName: hostCookieName(LAST_SIGN_IN_METHOD_COOKIE, isSecureOrigin(baseURL)),
    maxAge: HINT_MAX_AGE_SECONDS,
    customResolveMethod: signInMethodOf,
    schema: { user: { lastLoginMethod: "last_login_method" } },
  });
}

/**
 * Returns the plugin that writes `user.last_sign_in_at` whenever better-auth creates a session,
 * which happens only on a sign-in (impersonation is off, R-01).
 */
export function lastSignInTime(db: Kysely<DB>) {
  return {
    id: "edulims-last-sign-in",
    init: () => ({
      options: {
        databaseHooks: {
          session: {
            create: {
              after: async (session) => {
                await db
                  .updateTable("user")
                  .set({ last_sign_in_at: session.createdAt })
                  .where("id", "=", session.userId)
                  .execute();
              },
            },
          },
        },
      },
    }),
  } satisfies BetterAuthPlugin;
}
