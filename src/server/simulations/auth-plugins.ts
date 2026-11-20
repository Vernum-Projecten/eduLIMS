// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The better-auth plugin of simulations and labs: the link of waiting addresses at sign-in (S10).
// The last teacher of a simulation is kept on deletion by src/server/users/delete-user.ts (D10).
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthPlugin } from "better-auth";
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import { linkWaitingAddresses } from "./linking.ts";

/**
 * Returns the plugin that links a student's waiting addresses to their labs whenever better-auth
 * creates a session, which happens only on a sign-in (S10).
 */
export function labSignInLink(db: Kysely<DB>) {
  return {
    id: "edulims-lab-sign-in-link",
    init: () => ({
      options: {
        databaseHooks: {
          session: {
            create: {
              after: async (session) => {
                try {
                  await linkWaitingAddresses(db, session.userId, new Date());
                } catch (error) {
                  // NOTE: S10 (#280); a failed link never refuses the sign-in. The addresses
                  // keep waiting, and the next sign-in or overview read tries again.
                  const kind = error instanceof Error ? error.name : "unknown";
                  console.error(`lab_link_failed user=${session.userId} ${kind}`);
                }
              },
            },
          },
        },
      },
    }),
  } satisfies BetterAuthPlugin;
}
