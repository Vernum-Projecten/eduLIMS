// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The admin plugin endpoints eduLIMS does itself. Relative imports: `pnpm db:seed` loads auth.ts
// in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

/**
 * The admin plugin paths that answer 404: `remove-user` deletes the sessions, the accounts and
 * the user in separate statements, so eduLIMS deletes a user in one transaction instead (#318).
 */
export const ADMIN_DISABLED_PATHS = ["/admin/remove-user"] as const;

/**
 * Returns the plugin that refuses {@link ADMIN_DISABLED_PATHS} with 404 on `auth.api` calls too,
 * which `disabledPaths` leaves open (it covers the HTTP router only).
 */
export function adminPathLock() {
  return {
    id: "edulims-admin-path-lock",
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            ctx.path !== undefined &&
            (ADMIN_DISABLED_PATHS as readonly string[]).includes(ctx.path),
          handler: createAuthMiddleware(async () => {
            throw new APIError("NOT_FOUND", { code: "not_found", message: "Not Found" });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
