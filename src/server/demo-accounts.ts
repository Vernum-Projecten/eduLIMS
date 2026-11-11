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

export const DEV_USERS = [
  { email: "student@example.test", name: "Test Student", role: "student" },
  { email: "teacher@example.test", name: "Test Teacher", role: "teacher" },
  { email: "admin@example.test", name: "Test Administrator", role: "admin" },
  // Changes its saved language in the e2e suite, so the other accounts keep the default.
  { email: "language@example.test", name: "Language Test Student", role: "student" },
] as const satisfies readonly { email: string; name: string; role: Role }[];

/** The realm of the development Keycloak (compose.dev.yaml). */
export const KEYCLOAK_DEMO_REALM = "edulims";

const KEYCLOAK_DEMO_USERS = [
  { role: "student", username: "student", password: "student" },
  { role: "teacher", username: "teacher", password: "teacher" },
  { role: "admin", username: "admin", password: "admin" },
] as const satisfies readonly DemoAccount[];

/** One demo account row on the login page. */
export interface DemoAccount {
  role: Role;
  /** The Keycloak username or the dev-login e-mail address. */
  username: string;
  password: string;
}

/** The demo accounts the login page may show, per sign-in method. */
export interface DemoAccounts {
  /** The dev-login users, one per role. */
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
    devLogin: DEV_USERS.filter((user) => user.email !== "language@example.test").map((user) => ({
      role: user.role,
      username: user.email,
      password: DEV_PASSWORD,
    })),
    keycloak: keycloak
      ? { realm: KEYCLOAK_DEMO_REALM, accounts: KEYCLOAK_DEMO_USERS.map((user) => ({ ...user })) }
      : null,
  };
}
