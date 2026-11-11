// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// RP-initiated logout for OIDC providers (#46, ADR 0015; OpenID Connect RP-Initiated Logout 1.0
// §2-3). better-auth builds an end-session URL only for its social providers, so this plugin
// does it for SSO: before `/sign-out` deletes the session it reads the provider that session was
// signed in with (`session.sign_in_method`) and, when that provider advertised
// `end_session_endpoint`, the response carries that URL with `id_token_hint`, `client_id` and
// `post_logout_redirect_uri` = `<BETTER_AUTH_URL>/login`.
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import { openIdToken } from "./account-tokens.ts";
import type { Keyring } from "./crypto.ts";
import { providerUrls } from "./provider-config.ts";

/** Returns the end-session URL of OpenID Connect RP-Initiated Logout 1.0 §2. */
export function endSessionUrl(input: {
  endSessionEndpoint: string;
  idToken: string | null;
  clientId: string;
  postLogoutRedirectUri: string;
}): string {
  const url = new URL(input.endSessionEndpoint);
  if (input.idToken) url.searchParams.set("id_token_hint", input.idToken);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("post_logout_redirect_uri", input.postLogoutRedirectUri);
  return url.toString();
}

function clientIdOf(oidcConfig: string | null): string | null {
  if (!oidcConfig) return null;
  try {
    const value: unknown = JSON.parse(oidcConfig);
    const clientId: unknown =
      typeof value === "object" && value !== null ? Reflect.get(value, "clientId") : undefined;
    return typeof clientId === "string" ? clientId : null;
  } catch {
    return null;
  }
}

/**
 * Returns the end-session URL of the provider a session was signed in with (`signInMethod`), or
 * `null` for the development login, a SAML provider, or a provider without end-session endpoint.
 */
export async function logoutUrlFor(
  db: Kysely<DB>,
  input: { userId: string; signInMethod: unknown; baseURL: string; keyring: Keyring },
): Promise<string | null> {
  if (typeof input.signInMethod !== "string") return null;
  const row = await db
    .selectFrom("account as a")
    .innerJoin("identity_provider as p", "p.provider_id", "a.providerId")
    .innerJoin("ssoProvider as s", "s.providerId", "p.provider_id")
    .select(["a.id", "a.idToken", "a.providerId", "p.end_session_endpoint", "s.oidcConfig"])
    .where("a.userId", "=", input.userId)
    .where("a.providerId", "=", input.signInMethod)
    .where("p.protocol", "=", "oidc")
    .executeTakeFirst();
  if (!row?.end_session_endpoint) return null;
  const clientId = clientIdOf(row.oidcConfig);
  if (!clientId) return null;
  return endSessionUrl({
    endSessionEndpoint: row.end_session_endpoint,
    idToken: openIdToken(input.keyring, row.id, row.idToken),
    clientId,
    postLogoutRedirectUri: providerUrls(input.baseURL, row.providerId).postLogoutRedirectUri,
  });
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/** Returns the better-auth plugin that adds the IdP end-session URL to `/sign-out`. */
export function ssoLogout(db: Kysely<DB>, baseURL: string, keyring: Keyring) {
  const pending = new WeakMap<object, string>();
  return {
    id: "edulims-sso-logout",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/sign-out",
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (!session) return;
            const url = await logoutUrlFor(db, {
              userId: session.user.id,
              signInMethod: field(session.session, "signInMethod"),
              baseURL,
              keyring,
            });
            if (url) pending.set(ctx.context, url);
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/sign-out",
          handler: createAuthMiddleware(async (ctx) => {
            const url = pending.get(ctx.context);
            const returned = ctx.context.returned;
            if (!url || field(returned, "success") !== true || field(returned, "url")) return;
            const redirect = field(ctx.body, "disableRedirect") !== true;
            if (redirect) ctx.setHeader("Location", url);
            return ctx.json({ success: true, url, redirect });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
