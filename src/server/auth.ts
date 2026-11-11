// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { genericOAuth, keycloak } from "better-auth/plugins/generic-oauth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { HOST_COOKIE_PREFIX } from "../lib/cookies.ts";
import type { IdentityProviderId, IdentityProviderOption } from "../lib/identity-providers.ts";
import { ADMIN_ROLE, accessControl, DEFAULT_ROLE, roles } from "../lib/roles.ts";
import { auditDatabase, auditLog } from "./audit/better-auth-hooks.ts";
import { isSecureOrigin } from "./cookie-security.ts";
import { getPool } from "./db/index.ts";
import { type Env, getEnv, isKeycloakConfigured, isMicrosoftConfigured } from "./env.ts";
import { createIdpRoleSync } from "./idp-sync.ts";
import { applySavedLocaleOnSignIn } from "./preferences/locale-cookie.ts";
import { refuseOwnRoleWrites, roleWriteHooks } from "./role-guard.ts";
import { SESSION_EXPIRES_IN_SECONDS, SESSION_UPDATE_AGE_SECONDS } from "./session-policy.ts";
import { lastSignInMethod, lastSignInTime } from "./users/sign-in-tracking.ts";

/** Where an identity provider returns the user after signing out of it: the eduLIMS sign-in page. */
export const POST_LOGOUT_PATH = "/login";

const DEFAULT_ROLE_CLAIMS: Record<IdentityProviderId, string> = {
  microsoft: "roles",
  keycloak: "realm_access.roles",
};

/**
 * Returns the configured identity providers. Only Keycloak carries a label, and only when the
 * operator set `KEYCLOAK_LABEL`; the login page localizes every other button text.
 */
export function identityProviders(env: Env): IdentityProviderOption[] {
  const providers: IdentityProviderOption[] = [];
  if (isMicrosoftConfigured(env)) providers.push({ id: "microsoft" });
  if (isKeycloakConfigured(env)) {
    providers.push(
      env.KEYCLOAK_LABEL ? { id: "keycloak", label: env.KEYCLOAK_LABEL } : { id: "keycloak" },
    );
  }
  return providers;
}

function microsoftProvider(env: Env) {
  const { MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID } = env;
  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_TENANT_ID) return {};
  return {
    microsoft: {
      clientId: MICROSOFT_CLIENT_ID,
      clientSecret: MICROSOFT_CLIENT_SECRET,
      tenantId: MICROSOFT_TENANT_ID,
      prompt: "select_account" as const,
    },
  };
}

/** The Keycloak provider for the generic OAuth plugin, or none when Keycloak is not configured. */
export function keycloakProviders(env: Env) {
  const { KEYCLOAK_ISSUER, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET } = env;
  if (!KEYCLOAK_ISSUER || !KEYCLOAK_CLIENT_ID || !KEYCLOAK_CLIENT_SECRET) return [];
  return [
    keycloak({
      issuer: KEYCLOAK_ISSUER,
      clientId: KEYCLOAK_CLIENT_ID,
      clientSecret: KEYCLOAK_CLIENT_SECRET,
      pkce: true,
      // NOTE: OpenID Connect RP-Initiated Logout 1.0 §2-3; Keycloak returns the user to this
      // registered URI (resolved against BETTER_AUTH_URL) instead of its "You are logged out" page.
      postLogoutRedirectURI: POST_LOGOUT_PATH,
    }),
  ];
}

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

/**
 * Creates the better-auth instance. Sign-in goes through the configured OIDC providers
 * (Microsoft Entra ID single tenant, Keycloak via discovery; authorization code + PKCE),
 * which also supply the role on every sign-in. A saved language preference sets the locale
 * cookie on sign-in (ADR 0011). Email/password exists solely for local
 * development and e2e tests and is refused by env validation when NODE_ENV=production.
 */
export function createAuth(env: Env, database: BetterAuthOptions["database"] = getPool()) {
  return betterAuth({
    advanced: authCookieOptions(env.BETTER_AUTH_URL),
    appName: "eduLIMS",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database,
    emailAndPassword: { enabled: env.EDULIMS_DEV_LOGIN, disableSignUp: true },
    socialProviders: microsoftProvider(env),
    // NOTE: owner decision on #42 (ASVS V7.3.1, V7.3.2): 8 hours sliding, refreshed at most hourly;
    // the 24-hour absolute cap is the session.ts read check and migration 0005.
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
        // Where the role set comes from (hybrid ownership, #32); only the IdP sync and the
        // Users screen's local role edit write it.
        roleSource: { type: "string", required: false, input: false, fieldName: "role_source" },
      },
      validateUserInfo: createIdpRoleSync({
        claimPaths: {
          microsoft: env.OIDC_ROLE_CLAIM ?? DEFAULT_ROLE_CLAIMS.microsoft,
          keycloak: env.OIDC_ROLE_CLAIM ?? DEFAULT_ROLE_CLAIMS.keycloak,
        },
        roleMap: env.OIDC_ROLE_MAP,
        defaultRole: env.OIDC_DEFAULT_ROLE,
      }),
    },
    // Every role write (IdP sync, seed, admin create-user, set-role, update-user) is validated.
    databaseHooks: { user: roleWriteHooks },
    // Nobody changes their own roles through the admin endpoints (ADR 0012).
    hooks: { before: refuseOwnRoleWrites, after: applySavedLocaleOnSignIn(env.BETTER_AUTH_URL) },
    plugins: [
      admin({ ac: accessControl, roles, defaultRole: DEFAULT_ROLE, adminRoles: [ADMIN_ROLE] }),
      genericOAuth({ config: keycloakProviders(env) }),
      // The activity log (B4): sign-ins, sign-outs, sessions, users and the admin endpoints.
      auditLog(auditDatabase(database)),
      // The last sign-in method and time for the Users screen and the login hint (#34).
      lastSignInMethod(),
      lastSignInTime(auditDatabase(database)),
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
