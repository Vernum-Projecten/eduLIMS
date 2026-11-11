// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The per-provider SCIM setting (#45, ADR 0017): which sign-in claim carries the directory's
// `externalId`. Written from the provider's detail page and the host CLI, with its
// activity-log row (`idp_updated`) in the same transaction. Relative imports: the CLI loads it.
import "@tanstack/react-start/server-only";
import { recordAudit } from "../audit/record.ts";
import { invalidateProviderCache } from "../idp/registry.ts";
import { externalIdClaimSchema } from "./schemas.ts";
import type { ScimTokenContext } from "./tokens.ts";

/** The outcome of {@link setScimExternalIdClaim}. */
export type ScimSettingResult =
  | { ok: true; providerId: string }
  | { ok: false; error: "not_found" | "invalid" };

/**
 * Sets the claim (OIDC) or attribute (SAML) that carries a provider's SCIM `externalId`; `null`
 * means the account key (`sub`, the NameID).
 */
export async function setScimExternalIdClaim(
  ctx: ScimTokenContext,
  input: { providerId: string; claim: string | null },
): Promise<ScimSettingResult> {
  const claim = externalIdClaimSchema.safeParse(input.claim);
  if (!claim.success) return { ok: false, error: "invalid" };
  const result = await ctx.db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable("identity_provider")
      .set({
        scim_external_id_claim: claim.data,
        updated_at: new Date(),
        updated_by: ctx.actor.type === "user" ? ctx.actor.id : null,
      })
      .where("provider_id", "=", input.providerId)
      .returning("protocol")
      .executeTakeFirst();
    if (!row) return { ok: false as const, error: "not_found" as const };
    await recordAudit(trx, {
      action: "idp_updated",
      actor: ctx.actor,
      outcome: "success",
      target: { type: "identity_provider", id: input.providerId },
      metadata: {
        provider_id: input.providerId,
        protocol: row.protocol === "saml" ? "saml" : "oidc",
        fields: ["scim_external_id_claim"],
      },
    });
    return { ok: true as const, providerId: input.providerId };
  });
  invalidateProviderCache();
  return result;
}
