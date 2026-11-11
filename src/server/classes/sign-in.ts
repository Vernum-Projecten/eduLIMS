// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The sign-in step of invitations without email (#28): when better-auth creates a session, which
// happens only on a sign-in, the person joins every class that invited their verified email.
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthPlugin } from "better-auth";
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import { acceptInvitationsOnSignIn } from "./acceptance.ts";

/** Returns the plugin that accepts a person's pending class invitations on every sign-in. */
export function classInvitationAcceptance(db: Kysely<DB>) {
  return {
    id: "edulims-class-invitations",
    init: () => ({
      options: {
        databaseHooks: {
          session: {
            create: {
              after: async (session) => {
                try {
                  await acceptInvitationsOnSignIn(db, session.userId, new Date());
                } catch (error) {
                  // NOTE: #28; a failed acceptance must not refuse the sign-in. It rolled back
                  // whole, the invitations stay pending, and the next sign-in tries again.
                  const kind = error instanceof Error ? error.name : "unknown";
                  console.error(`class_invitation_accept_failed user=${session.userId} ${kind}`);
                }
              },
            },
          },
        },
      },
    }),
  } satisfies BetterAuthPlugin;
}
