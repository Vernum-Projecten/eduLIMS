// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The bodies of the SCIM server functions on a provider's detail page (#45, ADR 0017). Each one
// checks the admin role itself before it reads anything, behind the `requireRole("admin")`
// middleware of its server function (functions.ts), so the check holds even without it.
import "@tanstack/react-start/server-only";
import { notFound } from "@tanstack/react-router";
import type { Kysely } from "kysely";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertAdmin } from "../users/actions.ts";
import { type ScimSettingResult, setScimExternalIdClaim } from "./settings.ts";
import type { ScimSupport } from "./support.ts";
import {
  createScimToken,
  revokeScimToken,
  rotateScimToken,
  type ScimTokenContext,
  type ScimTokenIssued,
  type ScimTokenRevoked,
  type ScimTokenStatus,
  scimTokenStatus,
} from "./tokens.ts";

/** What a handler runs with besides the caller and the input. */
export interface ScimHandlerDeps {
  db: Kysely<DB>;
  /** `BETTER_AUTH_URL`, for the endpoint the identity provider is given. */
  baseURL: string;
  /** Whether this deployment can run SCIM (support.ts). */
  support: () => Promise<ScimSupport>;
}

/** The SCIM section of a provider's detail page: never a token or its digest. */
export interface ScimDetail extends ScimTokenStatus {
  available: boolean;
  endpoint: string;
  externalIdClaim: string | null;
  /** Whether the provider has e-mail domains; without them SCIM may set any address. */
  domainsConfigured: boolean;
}

type Actor = Pick<SessionUser, "id" | "roles">;

function context(user: Actor, deps: ScimHandlerDeps): ScimTokenContext {
  assertAdmin(user);
  return { db: deps.db, actor: { type: "user", id: user.id } };
}

/** Returns the SCIM endpoint of a deployment: `BETTER_AUTH_URL` plus `/api/auth/scim/v2`. */
export function scimEndpoint(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, "")}/api/auth/scim/v2`;
}

/**
 * The handlers, one per server function, each refusing a caller without the admin role with
 * `AuthError` 403 before it reads anything (B1, R-01).
 */
export const scimHandlers = {
  async detail(
    user: Actor,
    data: { providerId: string },
    deps: ScimHandlerDeps,
  ): Promise<ScimDetail> {
    assertAdmin(user);
    const row = await deps.db
      .selectFrom("identity_provider")
      .select("scim_external_id_claim")
      .where("provider_id", "=", data.providerId)
      .executeTakeFirst();
    if (!row) throw notFound();
    const [status, support, domain] = await Promise.all([
      scimTokenStatus(deps.db, data.providerId),
      deps.support(),
      deps.db
        .selectFrom("identity_provider_domain")
        .select("domain")
        .where("provider_id", "=", data.providerId)
        .executeTakeFirst(),
    ]);
    return {
      ...status,
      available: support.ok,
      endpoint: scimEndpoint(deps.baseURL),
      externalIdClaim: row.scim_external_id_claim,
      domainsConfigured: domain !== undefined,
    };
  },

  async create(
    user: Actor,
    data: { providerId: string },
    deps: ScimHandlerDeps,
  ): Promise<ScimTokenIssued> {
    return createScimToken(context(user, deps), data.providerId);
  },

  async rotate(
    user: Actor,
    data: { providerId: string },
    deps: ScimHandlerDeps,
  ): Promise<ScimTokenIssued> {
    return rotateScimToken(context(user, deps), data.providerId);
  },

  async revoke(
    user: Actor,
    data: { providerId: string },
    deps: ScimHandlerDeps,
  ): Promise<ScimTokenRevoked> {
    return revokeScimToken(context(user, deps), data.providerId);
  },

  async setExternalIdClaim(
    user: Actor,
    data: { providerId: string; claim: string | null },
    deps: ScimHandlerDeps,
  ): Promise<ScimSettingResult> {
    return setScimExternalIdClaim(context(user, deps), data);
  },
};
