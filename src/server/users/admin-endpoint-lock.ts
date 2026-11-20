// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The better-auth endpoints that delete a user or write a user's roles, all closed: eduLIMS does
// both itself (src/server/users/delete-user.ts, setLocalRoles in src/server/users/actions.ts).
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

/**
 * The better-auth paths eduLIMS closes, which answer 404. The admin plugin's `remove-user`
 * deleted in separate statements before it checked the last-teacher rule, and the core
 * `delete-user` and its callback would let a user delete their own account (#318). `set-role` and
 * `update-user` wrote roles without the administrator locks and the last-administrator rule, and
 * no eduLIMS screen renames a user: names come from the identity provider (#345).
 */
export const CLOSED_AUTH_PATHS = [
  "/admin/remove-user",
  "/admin/set-role",
  "/admin/update-user",
  "/delete-user",
  "/delete-user/callback",
] as const;

/**
 * Returns the plugin that refuses {@link CLOSED_AUTH_PATHS} with 404 on `auth.api` calls too,
 * which `disabledPaths` leaves open (it covers the HTTP router only).
 */
export function adminEndpointLock() {
  return {
    id: "edulims-admin-endpoint-lock",
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            ctx.path !== undefined && (CLOSED_AUTH_PATHS as readonly string[]).includes(ctx.path),
          handler: createAuthMiddleware(async () => {
            throw new APIError("NOT_FOUND", { code: "not_found", message: "Not Found" });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
