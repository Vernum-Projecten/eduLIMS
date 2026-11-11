// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { genericOAuth, keycloak } from "better-auth/plugins/generic-oauth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import type { IdentityProviderId, IdentityProviderOption } from "../lib/identity-providers.ts";
import { ADMIN_ROLE, accessControl, DEFAULT_ROLE, roles } from "../lib/roles.ts";
import { getPool } from "./db/index.ts";
import { type Env, getEnv, isKeycloakConfigured, isMicrosoftConfigured } from "./env.ts";
import { createIdpRoleSync } from "./idp-sync.ts";

const DEFAULT_ROLE_CLAIMS: Record<IdentityProviderId, string> = {
  microsoft: "roles",
  keycloak: "realm_access.roles",
};

/** Returns the configured identity providers with their Dutch login button labels. */
export function identityProviders(env: Env): IdentityProviderOption[] {
  return [
    ...(isMicrosoftConfigured(env)
      ? [{ id: "microsoft" as const, label: "Inloggen met Hanze-account (Microsoft)" }]
      : []),
    ...(isKeycloakConfigured(env) ? [{ id: "keycloak" as const, label: env.KEYCLOAK_LABEL }] : []),
  ];
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

function keycloakProviders(env: Env) {
  const { KEYCLOAK_ISSUER, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET } = env;
  if (!KEYCLOAK_ISSUER || !KEYCLOAK_CLIENT_ID || !KEYCLOAK_CLIENT_SECRET) return [];
  return [
    keycloak({
      issuer: KEYCLOAK_ISSUER,
      clientId: KEYCLOAK_CLIENT_ID,
      clientSecret: KEYCLOAK_CLIENT_SECRET,
      pkce: true,
    }),
  ];
}

/**
 * Creates the better-auth instance. Sign-in goes through the configured OIDC providers
 * (Microsoft Entra ID single tenant, Keycloak via discovery; authorization code + PKCE),
 * which also supply the role on every sign-in. Email/password exists solely for local
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
    user: {
      validateUserInfo: createIdpRoleSync({
        claimPaths: {
          microsoft: env.OIDC_ROLE_CLAIM ?? DEFAULT_ROLE_CLAIMS.microsoft,
          keycloak: env.OIDC_ROLE_CLAIM ?? DEFAULT_ROLE_CLAIMS.keycloak,
        },
        roleMap: env.OIDC_ROLE_MAP,
        defaultRole: env.OIDC_DEFAULT_ROLE,
      }),
    },
    plugins: [
      admin({ ac: accessControl, roles, defaultRole: DEFAULT_ROLE, adminRoles: [ADMIN_ROLE] }),
      genericOAuth({ config: keycloakProviders(env) }),
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
