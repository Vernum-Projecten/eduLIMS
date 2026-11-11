// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The context of the identity-provider screens' server functions (#46): the admin role checked
// again here, behind the `requireRole("admin")` middleware, so the service is never reached
// without it (B1, ADR 0012, R-01).
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import type { Env } from "../env.ts";
import { assertAdmin } from "../users/actions.ts";
import { keyringOf } from "./crypto.ts";
import type { IdpServiceContext } from "./service.ts";

/**
 * Returns the service context of an administrator's request.
 *
 * @throws AuthError 403 when `actor` does not hold the admin role.
 */
export function adminServiceContext(
  actor: Pick<SessionUser, "id" | "roles">,
  env: Pick<
    Env,
    | "NODE_ENV"
    | "BETTER_AUTH_URL"
    | "EDULIMS_DATA_KEY"
    | "EDULIMS_DATA_KEY_PREVIOUS"
    | "EDULIMS_IDP_PRIVATE_ORIGINS"
  >,
  db: Kysely<DB>,
): IdpServiceContext {
  assertAdmin(actor);
  return {
    db,
    keyring: keyringOf(env),
    policy: {
      production: env.NODE_ENV === "production",
      privateOrigins: env.EDULIMS_IDP_PRIVATE_ORIGINS,
    },
    baseURL: env.BETTER_AUTH_URL,
    actor: { type: "user", id: actor.id },
  };
}
