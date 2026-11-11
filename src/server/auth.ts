// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import { sso } from "@better-auth/sso";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { HOST_COOKIE_PREFIX } from "../lib/cookies.ts";
import { ADMIN_ROLE, accessControl, DEFAULT_ROLE, roles } from "../lib/roles.ts";
import { consumePendingAdminGrant } from "./admin-grant/grants.ts";
import { auditDatabase, auditLog } from "./audit/better-auth-hooks.ts";
import { isSecureOrigin } from "./cookie-security.ts";
import { getPool } from "./db/index.ts";
import type { DB } from "./db/schema.gen.ts";
import { type Env, getEnv } from "./env.ts";
import { accountTokenHooks } from "./idp/account-tokens.ts";
import { keyringOf } from "./idp/crypto.ts";
import { encryptedKyselyAdapter, type KyselyDatabase } from "./idp/encrypted-adapter.ts";
import { ssoLogout } from "./idp/logout.ts";
import { providerSettings } from "./idp/registry.ts";
import { SSO_DISABLED_PATHS, ssoGuards } from "./idp/sso-guards.ts";
import { recordTestOutcome, testOfState } from "./idp/test-flow.ts";
import { createIdpRoleSync } from "./idp-sync.ts";
import { applySavedLocaleOnSignIn } from "./preferences/locale-cookie.ts";
import { refuseOwnRoleWrites, roleWriteHooks } from "./role-guard.ts";
import { SESSION_EXPIRES_IN_SECONDS, SESSION_UPDATE_AGE_SECONDS } from "./session-policy.ts";
import { lastSignInMethod, lastSignInTime } from "./users/sign-in-tracking.ts";

/** Where an identity provider returns the user after signing out of it: the eduLIMS sign-in page. */
export const POST_LOGOUT_PATH = "/login";

/**
 * Returns better-auth's cookie options for `baseURL`. Over https every better-auth cookie is
 * `__Host-better-auth.*` with `Secure`, `Path=/` and no `Domain`; over plain http (development)
 * the names stay unprefixed, since a browser refuses `Secure` cookies there.
 */
export function authCookieOptions(baseURL: string): BetterAuthOptions["advanced"] {
  if (!isSecureOrigin(baseURL)) return {};
  // NOTE: owner decision on #43 (ASVS V3.3.3). better-auth only prepends `__Secure-`, so that
  // is off and the `__Host-` prefix is part of the cookie name.
  return {
    useSecureCookies: false,
    cookiePrefix: `${HOST_COOKIE_PREFIX}better-auth`,
    defaultCookieAttributes: { secure: true, path: "/" },
  };
}

/** The database createAuth accepts: the shared pool, or a Kysely instance (the tests). */
export type AuthDatabase = Pool | KyselyDatabase;

const kyselies = new WeakMap<Pool, Kysely<DB>>();

function kyselyOf(database: AuthDatabase): KyselyDatabase {
  if (database instanceof Pool) {
    const existing = kyselies.get(database);
    const db = existing ?? new Kysely<DB>({ dialect: new PostgresDialect({ pool: database }) });
    kyselies.set(database, db);
    return { db, type: "postgres", transaction: true };
  }
  return { transaction: true, ...database };
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/**
 * Creates the better-auth instance. Sign-in goes through the identity providers administrators
 * manage at runtime (the sso plugin, OIDC and SAML 2.0, ADR 0015), which also supply the role
 * on every sign-in. Their secrets are sealed at rest under `EDULIMS_DATA_KEY`. A saved
 * language preference sets the locale cookie on sign-in (ADR 0011). Email/password exists
 * solely for local development and e2e tests and is refused by env validation when
 * NODE_ENV=production.
 */
export function createAuth(env: Env, database: AuthDatabase = getPool()) {
  const kysely = kyselyOf(database);
  const db = auditDatabase(kysely);
  const keyring = keyringOf(env);
  return betterAuth({
    advanced: authCookieOptions(env.BETTER_AUTH_URL),
    appName: "eduLIMS",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: encryptedKyselyAdapter(kysely, keyring),
    // NOTE: ADR 0015; the plugin's management endpoints let any signed-in user register an IdP.
    disabledPaths: [...SSO_DISABLED_PATHS],
    // NOTE: ASVS V1.3.6; the app origin is always trusted, and besides it only the operator's
    // private IdP origins: every other IdP endpoint gets the sso plugin's DNS check at fetch time.
    trustedOrigins: [...env.EDULIMS_IDP_PRIVATE_ORIGINS],
    emailAndPassword: { enabled: env.EDULIMS_DEV_LOGIN, disableSignUp: true },
    // NOTE: owner decision on #42 (ASVS V7.3.1, V7.3.2): 8 hours sliding, refreshed at most hourly;
    // the 24-hour absolute cap is the session.ts read check and migration 0006.
    session: { expiresIn: SESSION_EXPIRES_IN_SECONDS, updateAge: SESSION_UPDATE_AGE_SECONDS },
    account: {
      // NOTE: owner decision on #39 (ASVS V6.8.1): no account linking at all. A sign-in from a
      // second provider with the email of an existing user is refused with
      // ACCOUNT_NOT_LINKED_ERROR instead of signing in as that user.
      accountLinking: { enabled: false },
    },
    user: {
      additionalFields: {
        // The language picked in the language menu; only savePreferredLocale writes it.
        locale: { type: "string", required: false, input: false },
        // The portal last picked in the portal switcher (ADR 0012); only saveLastPortal writes it.
        lastPortal: { type: "string", required: false, input: false, fieldName: "last_portal" },
        // Where the role set comes from (hybrid ownership, #32): `local` or a provider id; only
        // the sign-in gate, the Users screen's local role edit and `pnpm admin:grant` write it.
        roleSource: { type: "string", required: false, input: false, fieldName: "role_source" },
      },
      validateUserInfo: createIdpRoleSync({
        settingsOf: (providerId) => providerSettings(db, providerId),
        consumeAdminGrant: (email, providerId) =>
          consumePendingAdminGrant(db, { email, providerId, now: new Date() }),
        testOf: async (ctx, providerId) => {
          const state = field(ctx.query, "state") ?? field(ctx.body, "RelayState");
          if (typeof state !== "string" || state === "") return null;
          return testOfState(db, { state, providerId, now: new Date() });
        },
        recordTest: (test, outcome) => recordTestOutcome(db, { test, outcome, now: new Date() }),
      }),
    },
    // Every role write (IdP sync, seed, admin create-user, set-role, update-user) is validated.
    // No plaintext IdP token at rest: access and refresh tokens are dropped; the adapter seals the
    // ID token, bound to its account row.
    databaseHooks: { user: roleWriteHooks, account: accountTokenHooks },
    // Nobody changes their own roles through the admin endpoints (ADR 0012).
    hooks: { before: refuseOwnRoleWrites, after: applySavedLocaleOnSignIn(env.BETTER_AUTH_URL) },
    plugins: [
      admin({ ac: accessControl, roles, defaultRole: DEFAULT_ROLE, adminRoles: [ADMIN_ROLE] }),
      sso({
        // NOTE: ADR 0015; providers come only from the admin service, never from a user.
        providersLimit: 0,
        // NOTE: #28; SSO never adds anyone to a class organisation.
        organizationProvisioning: { disabled: true },
        saml: {
          requireTimestamps: true,
          algorithms: { onDeprecated: "reject" },
          enableInResponseToValidation: true,
          allowIdpInitiated: false,
          enableSingleLogout: true,
          // NOTE: SAML 2.0 Bindings §3.4.4.1; an unsigned LogoutRequest would let anyone end a
          // user's session, and an unsigned LogoutResponse would fake a completed logout.
          wantLogoutRequestSigned: true,
          wantLogoutResponseSigned: true,
        },
      }),
      ssoGuards(db),
      ssoLogout(db, env.BETTER_AUTH_URL, keyring),
      // The activity log (B4): sign-ins, sign-outs, sessions, users and the admin endpoints.
      auditLog(db),
      // The last sign-in method and time for the Users screen and the login hint (#34).
      lastSignInMethod(env.BETTER_AUTH_URL),
      lastSignInTime(db),
      // Must stay last: forwards better-auth Set-Cookie headers through TanStack Start.
      tanstackStartCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

export function getAuth(): Auth {
  instance ??= createAuth(getEnv());
  return instance;
}
