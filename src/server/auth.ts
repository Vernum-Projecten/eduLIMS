// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { genericOAuth, keycloak } from "better-auth/plugins/generic-oauth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import type { IdentityProviderId, IdentityProviderOption } from "../lib/identity-providers.ts";
import { ADMIN_ROLE, accessControl, DEFAULT_ROLE, roles } from "../lib/roles.ts";
import { auditDatabase, auditLog } from "./audit/better-auth-hooks.ts";
import { getPool } from "./db/index.ts";
import { type Env, getEnv, isKeycloakConfigured, isMicrosoftConfigured } from "./env.ts";
import { createIdpRoleSync } from "./idp-sync.ts";
import { applySavedLocaleOnSignIn } from "./preferences/locale-cookie.ts";
import { refuseOwnRoleWrites, roleWriteHooks } from "./role-guard.ts";

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
 * Creates the better-auth instance. Sign-in goes through the configured OIDC providers
 * (Microsoft Entra ID single tenant, Keycloak via discovery; authorization code + PKCE),
 * which also supply the role on every sign-in. A saved language preference sets the locale
 * cookie on sign-in (ADR 0011). Email/password exists solely for local
 * development and e2e tests and is refused by env validation when NODE_ENV=production.
 */
export function createAuth(env: Env, database: BetterAuthOptions["database"] = getPool()) {
  return betterAuth({
    appName: "eduLIMS",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database,
    emailAndPassword: { enabled: env.EDULIMS_DEV_LOGIN, disableSignUp: true },
    socialProviders: microsoftProvider(env),
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
