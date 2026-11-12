// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// What every change of the identity-provider admin service shares (#46, ADR 0015): the context,
// the typed refusals and the activity-log row. Relative imports: the host CLI loads this.
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import type { ProviderProtocol } from "../../lib/identity-providers.ts";
import type { AuditActor, AuditEvent, AuditMetadata } from "../audit/events.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { DataKeyError, type DataKeyProblem, type Keyring } from "./crypto.ts";
import { IdpValidationError, type IdpValidationProblem, type OriginPolicy } from "./validate.ts";

/** Why a provider change was refused; the screen and the CLI map each code to a message. */
export type IdpServiceError =
  | "not_found"
  | "exists"
  | "has_accounts"
  | "has_provisioned_users"
  | "last_enabled"
  | "domain_taken"
  | "client_secret_required"
  | IdpValidationProblem
  | DataKeyProblem;

/** The outcome of a provider change: done, or refused with a code (never a thrown string). */
export type IdpResult = { ok: true; providerId: string } | { ok: false; error: IdpServiceError };

/** What every change runs with. */
export interface IdpServiceContext {
  db: Kysely<DB>;
  keyring: Keyring;
  policy: OriginPolicy;
  /** `BETTER_AUTH_URL`, for the SP entity ID of a SAML provider. */
  baseURL: string;
  /** A user from the Admin screen, `system` from the host CLI. */
  actor: Extract<AuditActor, { type: "user" } | { type: "system" }>;
}

/** Returns a refusal. */
export function refused(error: IdpServiceError): IdpResult {
  return { ok: false, error };
}

/** Runs a change and maps the typed validation and key errors to refusals. */
export async function guarded(run: () => Promise<IdpResult>): Promise<IdpResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof IdpValidationError || error instanceof DataKeyError) {
      return refused(error.kind);
    }
    throw error;
  }
}

/** Returns the acting user's id, or `null` for the host CLI. */
export function actorId(ctx: IdpServiceContext): string | null {
  return ctx.actor.type === "user" ? ctx.actor.id : null;
}

/** Writes one `idp_*` activity-log row inside the change's transaction. */
export async function audit(
  trx: Transaction<DB>,
  ctx: IdpServiceContext,
  action: Extract<AuditEvent["action"], `idp_${string}`>,
  providerId: string,
  protocol: ProviderProtocol,
  extra: Omit<AuditMetadata, "provider_id" | "protocol"> = {},
): Promise<void> {
  const { fields, ...rest } = extra;
  await recordAudit(trx, {
    action,
    actor: ctx.actor,
    outcome: "success",
    target: { type: "identity_provider", id: providerId },
    metadata: {
      provider_id: providerId,
      protocol,
      ...rest,
      ...(fields && fields.length > 0 ? { fields: [...fields] } : {}),
    },
  });
}

/** Returns whether `providerId` is the only enabled provider. */
export async function isLastEnabled(db: Kysely<DB>, providerId: string): Promise<boolean> {
  const enabled = await db
    .selectFrom("identity_provider")
    .select("provider_id")
    .where("enabled", "=", true)
    .execute();
  return enabled.length === 1 && enabled[0]?.provider_id === providerId;
}
