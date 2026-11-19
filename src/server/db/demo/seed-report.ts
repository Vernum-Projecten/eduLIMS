// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The summary `pnpm db:seed` prints after the dev users and providers. Relative imports: the
// seed loads this module in plain Node.
import type { SeedSummary } from "./seed-demo.ts";

/** What one seed run did, and what the database holds after it. */
export interface SeedReport {
  /** Whether this run created the demo set; `false` when it was there already. */
  demoCreated: boolean;
  /** Whether this run created the dev accounts' simulations; `false` when they were there. */
  devSimulationsCreated: boolean;
  summary: SeedSummary;
}

function counts(record: Record<string, number>): string {
  return Object.entries(record)
    .map(([key, n]) => `${key} ${n}`)
    .join(", ");
}

/** Returns the seed's summary as the text it prints, ending in a newline. Counts only, no people. */
export function formatSeedReport({
  demoCreated,
  devSimulationsCreated,
  summary,
}: SeedReport): string {
  return (
    `${demoCreated ? "created" : "exists "} demo data\n` +
    `${devSimulationsCreated ? "created" : "exists "} dev-account simulations ` +
    "(Demo simulation, Coordinator's simulation)\n" +
    `  users by role:       ${counts(summary.usersByRole)}\n` +
    `  accounts:            ${counts(summary.accountsByProvider)}\n` +
    `  sessions:            ${summary.activeSessions} active, ${summary.expiredSessions} expired\n` +
    `  blocked users:       ${summary.blockedUsers}\n` +
    `  activity-log events: ${summary.auditEvents}\n` +
    `  simulations:         ${summary.simulations}, ${summary.labs} labs, ` +
    `${summary.labMembers} lab members, ${summary.waitingAddresses} waiting addresses\n` +
    "The demo people sign in through an identity provider only: they have no password and are " +
    "not in the development Keycloak realm, so they cannot sign in locally. Use the dev-login " +
    "and Keycloak demo accounts above.\n"
  );
}
