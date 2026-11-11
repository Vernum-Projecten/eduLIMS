// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The guards around the sso plugin's open endpoints (#46, ADR 0015). `/sign-in/sso` takes a
// provider id only (no email or domain lookup by the plugin, no caller scopes or extra
// authorization parameters), and a disabled provider is refused there and at its callback and
// ACS, except for an administrator's test sign-in. The sign-in gate checks again
// (src/server/idp-sync.ts). Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { Kysely } from "kysely";
import { PROVIDER_DISABLED_ERROR } from "../../lib/identity-providers.ts";
import type { DB } from "../db/schema.gen.ts";
import { providerSettings } from "./registry.ts";
import { bindTestState, stateOfRedirect, testIdOfCallback, testOfState } from "./test-flow.ts";

/** The sso plugin's sign-in start, OIDC callback and SAML ACS paths (better-auth 1.7.20). */
export const SSO_SIGN_IN_PATH = "/sign-in/sso";
export const SSO_CALLBACK_PATHS: ReadonlySet<string> = new Set([
  "/sso/callback/:providerId",
  "/sso/saml2/sp/acs/:providerId",
]);

/**
 * The sso plugin's management endpoints, unreachable over HTTP (better-auth `disabledPaths`):
 * eduLIMS manages providers through its own admin service only.
 */
export const SSO_DISABLED_PATHS = [
  "/sso/register",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/providers",
  "/sso/get-provider",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
  "/sso/callback",
] as const;

/** Body keys of `/sign-in/sso` eduLIMS refuses: routing and scopes stay server-side. */
const REFUSED_SIGN_IN_KEYS = ["email", "domain", "organizationSlug", "scopes", "additionalParams"];

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function stateOfCallback(ctx: unknown): string | null {
  const state = field(field(ctx, "query"), "state") ?? field(field(ctx, "body"), "RelayState");
  return typeof state === "string" && state !== "" ? state : null;
}

/** Returns whether a sign-in start may proceed for a disabled provider: an admin's own test. */
async function isOwnTest(db: Kysely<DB>, ctx: unknown, providerId: string): Promise<boolean> {
  const test = testIdOfCallback(field(field(ctx, "body"), "callbackURL"));
  if (!test || test.providerId !== providerId) return false;
  const row = await db
    .selectFrom("verification")
    .select("value")
    .where("identifier", "=", `edulims-idp-test:${test.test}`)
    .where("expiresAt", ">", new Date())
    .executeTakeFirst();
  return row !== undefined;
}

/** Returns the better-auth plugin with the sso guards on `db`. */
export function ssoGuards(db: Kysely<DB>) {
  return {
    id: "edulims-sso-guards",
    hooks: {
      before: [
        {
          // A second lock behind `disabledPaths`, which matches the request path exactly.
          matcher: (ctx) =>
            typeof ctx.path === "string" &&
            (SSO_DISABLED_PATHS as readonly string[]).includes(ctx.path),
          handler: createAuthMiddleware(async () => {
            throw new APIError("NOT_FOUND", { code: "not_found", message: "Not Found" });
          }),
        },
        {
          matcher: (ctx) => ctx.path === SSO_SIGN_IN_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const body: unknown = ctx.body;
            if (REFUSED_SIGN_IN_KEYS.some((key) => field(body, key) !== undefined)) {
              throw new APIError("BAD_REQUEST", {
                code: "invalid_request",
                message: "providerId only",
              });
            }
            const providerId = field(body, "providerId");
            if (typeof providerId !== "string") {
              throw new APIError("BAD_REQUEST", {
                code: "invalid_request",
                message: "providerId only",
              });
            }
            const settings = await providerSettings(db, providerId);
            if (settings?.enabled) return;
            if (settings && (await isOwnTest(db, ctx, providerId))) return;
            throw new APIError("FORBIDDEN", {
              code: PROVIDER_DISABLED_ERROR,
              message: "Identity provider disabled",
            });
          }),
        },
        {
          matcher: (ctx) => typeof ctx.path === "string" && SSO_CALLBACK_PATHS.has(ctx.path),
          handler: createAuthMiddleware(async (ctx) => {
            const providerId = field(ctx.params, "providerId");
            const settings =
              typeof providerId === "string" ? await providerSettings(db, providerId) : null;
            if (settings?.enabled) return;
            const state = stateOfCallback(ctx);
            if (
              settings &&
              state &&
              (await testOfState(db, { state, providerId: settings.providerId, now: new Date() }))
            ) {
              return;
            }
            throw ctx.redirect(
              `${ctx.context.baseURL.replace(/\/api\/auth$/, "")}/login?error=${PROVIDER_DISABLED_ERROR}`,
            );
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === SSO_SIGN_IN_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const test = testIdOfCallback(field(ctx.body, "callbackURL"));
            if (!test) return;
            const state = stateOfRedirect(field(ctx.context.returned, "url"));
            const session = await getSessionFromCtx(ctx);
            if (!state || !session) return;
            await bindTestState(db, {
              adminId: session.user.id,
              providerId: test.providerId,
              test: test.test,
              state,
              now: new Date(),
            });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
