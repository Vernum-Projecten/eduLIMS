// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The better-auth endpoints that delete a user, all closed: eduLIMS deletes a user itself
// (src/server/users/delete-user.ts). Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

/**
 * The better-auth paths that delete a user, which answer 404 (#318): the admin plugin's
 * `remove-user` deletes the sessions, the accounts and the user in separate statements, and the
 * core `delete-user` and its callback would let a user delete their own account if someone
 * turned on `user.deleteUser`. eduLIMS deletes a user in one transaction instead.
 */
export const USER_DELETION_DISABLED_PATHS = [
  "/admin/remove-user",
  "/delete-user",
  "/delete-user/callback",
] as const;

/**
 * Returns the plugin that refuses {@link USER_DELETION_DISABLED_PATHS} with 404 on `auth.api`
 * calls too, which `disabledPaths` leaves open (it covers the HTTP router only).
 */
export function userDeletionLock() {
  return {
    id: "edulims-user-deletion-lock",
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            ctx.path !== undefined &&
            (USER_DELETION_DISABLED_PATHS as readonly string[]).includes(ctx.path),
          handler: createAuthMiddleware(async () => {
            throw new APIError("NOT_FOUND", { code: "not_found", message: "Not Found" });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
