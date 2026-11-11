// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of the SCIM section of Admin → System → Identity providers → a provider
// (#45, ADR 0017); bodies run on the server. Every one requires the admin role first, then parses
// its input with Zod; its handler (handlers.ts) checks the role again.
import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "../auth.ts";
import { getDb } from "../db/index.ts";
import { getEnv } from "../env.ts";
import { requireRole } from "../middleware.ts";
import { type ScimHandlerDeps, scimHandlers } from "./handlers.ts";
import { scimExternalIdInput, scimProviderInput } from "./schemas.ts";
import { scimSupport } from "./support.ts";

function deps(): ScimHandlerDeps {
  return {
    db: getDb(),
    baseURL: getEnv().BETTER_AUTH_URL,
    support: async () => {
      const auth = getAuth();
      const context = await auth.$context;
      return scimSupport(context.adapter, auth.options);
    },
  };
}

/** Returns the SCIM state of a provider: the endpoint, its token's dates, the external-id claim. */
export const getScimDetail = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .validator(scimProviderInput)
  .handler(({ data, context }) => scimHandlers.detail(context.user, data, deps()));

/** Creates a provider's first SCIM token and returns it once (`scim_token_created`). */
export const createScimTokenFn = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(scimProviderInput)
  .handler(({ data, context }) => scimHandlers.create(context.user, data, deps()));

/** Replaces a provider's SCIM token and returns the new one once (`scim_token_rotated`). */
export const rotateScimTokenFn = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(scimProviderInput)
  .handler(({ data, context }) => scimHandlers.rotate(context.user, data, deps()));

/** Revokes a provider's SCIM token (`scim_token_revoked`). */
export const revokeScimTokenFn = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(scimProviderInput)
  .handler(({ data, context }) => scimHandlers.revoke(context.user, data, deps()));

/** Sets the claim that carries a provider's SCIM `externalId` at sign-in (`idp_updated`). */
export const setScimExternalIdClaimFn = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(scimExternalIdInput)
  .handler(({ data, context }) => scimHandlers.setExternalIdClaim(context.user, data, deps()));
