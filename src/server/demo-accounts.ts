// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The public development accounts: the dev-login users `pnpm db:seed` creates and the users of
// the development Keycloak realm (docker/keycloak/edulims-realm.json). The login page lists them
// only while the development login is enabled, which env validation refuses in production.
// Relative imports: `pnpm db:seed` loads this module in plain Node.
import type { IdentityProviderOption } from "../lib/identity-providers.ts";
import type { Role } from "../lib/roles.ts";

/** Shared password for all dev users; never valid outside a dev/test database. */
export const DEV_PASSWORD = "eduLIMS-dev-only";

/** A dev-login user `pnpm db:seed` creates; `hidden` users serve the e2e suite only. */
interface DevUser {
  email: string;
  name: string;
  roles: readonly Role[];
  hidden?: true;
}

export const DEV_USERS = [
  { email: "student@example.test", name: "Test Student", roles: ["student"] },
  { email: "teacher@example.test", name: "Test Teacher", roles: ["teacher"] },
  { email: "admin@example.test", name: "Test Administrator", roles: ["admin"] },
  { email: "teacher-admin@example.test", name: "Test Coordinator", roles: ["teacher", "admin"] },
  // Changes its saved language in the e2e suite, so the other accounts keep the default.
  {
    email: "language@example.test",
    name: "Language Test Student",
    roles: ["student"],
    hidden: true,
  },
  // Switches portals in the e2e suite, so teacher-admin@ keeps the fallback landing portal.
  {
    email: "switcher@example.test",
    name: "Switcher Test Coordinator",
    roles: ["teacher", "admin"],
    hidden: true,
  },
  // The Users screen's e2e journeys (#34): blocked and unblocked, sessions ended, roles edited.
  { email: "blocked@example.test", name: "Blocked Test Student", roles: ["student"], hidden: true },
  {
    email: "sessions@example.test",
    name: "Sessions Test Teacher",
    roles: ["teacher"],
    hidden: true,
  },
  { email: "roles@example.test", name: "Roles Test Teacher", roles: ["teacher"], hidden: true },
] as const satisfies readonly DevUser[];

/** The realm of the development Keycloak (compose.dev.yaml). */
export const KEYCLOAK_DEMO_REALM = "edulims";

const KEYCLOAK_DEMO_USERS = [
  { roles: ["student"], username: "student", password: "student", grant: "groups" },
  { roles: ["teacher"], username: "teacher", password: "teacher", grant: "groups" },
  { roles: ["admin"], username: "admin", password: "admin", grant: "direct" },
  {
    roles: ["teacher", "admin"],
    username: "coordinator",
    password: "coordinator",
    grant: "groups",
  },
  { roles: ["teacher"], username: "teacher-direct", password: "teacher-direct", grant: "direct" },
  { roles: ["teacher", "admin"], username: "mixed", password: "mixed", grant: "groups-and-direct" },
  { roles: [], username: "conflict", password: "conflict", grant: "groups", refusal: "conflict" },
  { roles: [], username: "norole", password: "norole", refusal: "no-role" },
] as const satisfies readonly DemoAccount[];

/**
 * How an identity provider grants an account its roles: through group membership, as roles
 * assigned to the user directly, or both.
 */
export type DemoGrant = "groups" | "direct" | "groups-and-direct";

/** One demo account row on the login page. */
export interface DemoAccount {
  /** The account's role set (ADR 0012); empty for an account eduLIMS refuses. */
  roles: readonly Role[];
  /** The Keycloak username or the dev-login e-mail address. */
  username: string;
  password: string;
  /** How Keycloak grants the roles; absent for dev-login accounts. */
  grant?: DemoGrant;
  /** Why eduLIMS refuses the sign-in: conflicting roles, or no eduLIMS role. */
  refusal?: "conflict" | "no-role";
}

/** The demo accounts the login page may show, per sign-in method. */
export interface DemoAccounts {
  /** The dev-login users, one per allowed role set. */
  devLogin: DemoAccount[];
  /** The development Keycloak realm's users, or `null` when Keycloak is not configured. */
  keycloak: { realm: string; accounts: DemoAccount[] } | null;
}

/**
 * Returns the demo accounts for the login page, or `null` unless the development login is
 * enabled, so no credential ever reaches a production page.
 */
export function demoAccountsFor(
  devLogin: boolean,
  providers: readonly IdentityProviderOption[],
): DemoAccounts | null {
  if (!devLogin) return null;
  const keycloak = providers.some((provider) => provider.id === "keycloak");
  return {
    devLogin: DEV_USERS.filter((user) => !("hidden" in user)).map((user) => ({
      roles: [...user.roles],
      username: user.email,
      password: DEV_PASSWORD,
    })),
    keycloak: keycloak
      ? {
          realm: KEYCLOAK_DEMO_REALM,
          accounts: KEYCLOAK_DEMO_USERS.map((user) => ({ ...user, roles: [...user.roles] })),
        }
      : null,
  };
}
