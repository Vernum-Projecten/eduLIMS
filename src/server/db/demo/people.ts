// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The fictional demo people of `pnpm db:seed`: users, their SSO accounts and their sessions,
// planned from a fixed seed and a reference time, without I/O. Every address is @example.test.
import { formatRoles, type Role } from "../../../lib/roles.ts";
import { FAMILY_NAMES, GIVEN_NAMES } from "./names.ts";
import type { DemoRandom } from "./random.ts";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** The SSO providers a demo account comes from; demo people never get a password. */
export type DemoProvider = "microsoft" | "keycloak";

/** How many demo people of each role set the plan creates. */
export const DEMO_GROUPS = [
  { kind: "student", roles: ["student"], count: 60 },
  { kind: "teacher", roles: ["teacher"], count: 6 },
  { kind: "admin", roles: ["admin"], count: 2 },
  { kind: "coordinator", roles: ["teacher", "admin"], count: 2 },
] as const satisfies readonly { kind: string; roles: readonly Role[]; count: number }[];

export type DemoKind = (typeof DEMO_GROUPS)[number]["kind"];

/** One planned demo user. */
export interface DemoUser {
  id: string;
  kind: DemoKind;
  name: string;
  email: string;
  /** The stored role set (`teacher,admin`). */
  role: string;
  locale: "en" | "nl" | null;
  lastPortal: "teacher" | "admin" | null;
  createdAt: Date;
  /** The provider of the first account, which created the user. */
  provider: DemoProvider;
  ban: { reason: string; expires: Date | null; at: Date } | null;
}

/** One planned SSO account link. */
export interface DemoAccount {
  id: string;
  userId: string;
  providerId: DemoProvider;
  /** The provider's opaque subject. */
  accountId: string;
  createdAt: Date;
}

/** One planned session; the writer adds a fresh token. */
export interface DemoSession {
  id: string;
  userId: string;
  provider: DemoProvider;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string;
  userAgent: string;
}

/** The users, accounts and sessions of the demo set. */
export interface DemoPeople {
  users: DemoUser[];
  accounts: DemoAccount[];
  sessions: DemoSession[];
}

const BAN_REASONS = [
  "Repeated misuse of the analyser booking",
  "Account shared with another person",
  "Left the programme; pending removal",
] as const;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/139.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) Chrome/138.0",
] as const;

/** An address in TEST-NET-1 (RFC 5737), which no real host uses. */
function documentationAddress(random: DemoRandom): string {
  return `192.0.2.${random.int(1, 254)}`;
}

function planUsers(random: DemoRandom, now: Date): DemoUser[] {
  const users: DemoUser[] = [];
  const names = new Set<string>();
  for (const group of DEMO_GROUPS) {
    for (let index = 0; index < group.count; index += 1) {
      let name: string;
      let given: string;
      let family: string;
      do {
        given = random.pick(GIVEN_NAMES);
        family = random.pick(FAMILY_NAMES);
        name = `${given} ${family}`;
      } while (names.has(name));
      names.add(name);
      const multiRole = group.kind === "coordinator";
      users.push({
        id: random.id(),
        kind: group.kind,
        name,
        email: `${given}.${family}`.toLowerCase().concat("@example.test"),
        role: formatRoles(group.roles),
        locale: random.pick(["en", "nl", "nl", null] as const),
        lastPortal: multiRole ? random.pick(["teacher", "admin"] as const) : null,
        createdAt: new Date(now.getTime() - random.int(50, 56) * DAY - random.int(0, 8) * HOUR),
        provider: random.chance(0.65) ? "microsoft" : "keycloak",
        ban: null,
      });
    }
  }
  // Three blocked students (owner decision on #32: a reason, and an optional end date).
  const students = users.filter((user) => user.kind === "student");
  BAN_REASONS.forEach((reason, index) => {
    const user = students[index * 7 + 3];
    if (!user) return;
    const at = new Date(now.getTime() - (20 - index * 6) * DAY - 3 * HOUR);
    user.ban = { reason, expires: index === 0 ? new Date(now.getTime() + 14 * DAY) : null, at };
  });
  return users;
}

function planAccounts(random: DemoRandom, users: readonly DemoUser[]): DemoAccount[] {
  const accounts: DemoAccount[] = [];
  users.forEach((user, index) => {
    accounts.push({
      id: random.id(),
      userId: user.id,
      providerId: user.provider,
      accountId: random.hex(32),
      createdAt: user.createdAt,
    });
    // A few people linked both identity providers.
    if (index % 17 === 5) {
      accounts.push({
        id: random.id(),
        userId: user.id,
        providerId: user.provider === "microsoft" ? "keycloak" : "microsoft",
        accountId: random.hex(32),
        createdAt: new Date(user.createdAt.getTime() + 2 * DAY),
      });
    }
  });
  return accounts;
}

function planSessions(random: DemoRandom, users: readonly DemoUser[], now: Date): DemoSession[] {
  const sessions: DemoSession[] = [];
  // NOTE: ADR 0014; a session lives 8 hours after its last use and at most 24 hours after sign-in.
  const session = (user: DemoUser, createdAt: number, expiresAt: number): DemoSession => ({
    id: random.id(),
    userId: user.id,
    provider: user.provider,
    createdAt: new Date(createdAt),
    expiresAt: new Date(expiresAt),
    ipAddress: documentationAddress(random),
    userAgent: random.pick(USER_AGENTS),
  });
  users.forEach((user, index) => {
    // Live sessions for about a third, none for a blocked user (a block ends them).
    if (!user.ban && index % 3 === 0) {
      const signedIn = now.getTime() - random.int(1, 15) * HOUR;
      sessions.push(session(user, signedIn, now.getTime() + random.int(1, 7) * HOUR));
    }
    // Expired within the last 30 days, kept by the prune.
    if (index % 4 === 1) {
      const signedIn = now.getTime() - random.int(9, 30) * DAY;
      sessions.push(session(user, signedIn, signedIn + 8 * HOUR));
    }
    // Expired more than 30 days ago, removed by the next `pnpm db:prune`.
    if (index % 9 === 2) {
      const signedIn = now.getTime() - random.int(40, 46) * DAY;
      sessions.push(session(user, signedIn, signedIn + 8 * HOUR));
    }
  });
  return sessions;
}

/** Plans the demo people for the reference time `now`. */
export function planDemoPeople(random: DemoRandom, now: Date): DemoPeople {
  const users = planUsers(random, now);
  return {
    users,
    accounts: planAccounts(random, users),
    sessions: planSessions(random, users, now),
  };
}
