// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Enabling, disabling and deleting an identity provider (#46, ADR 0015), each in one
// transaction with its activity-log row. Relative imports: the host CLI loads this.
import "@tanstack/react-start/server-only";
import { invalidateProviderCache } from "./registry.ts";
import {
  actorId,
  audit,
  type IdpResult,
  type IdpServiceContext,
  isLastEnabled,
  refused,
} from "./service-core.ts";

/**
 * Enables or disables a provider (`idp_enabled`, `idp_disabled`). Disabling ends, in the same
 * transaction, every session of every user who has an account at that provider, and the log row
 * carries how many. In production the last enabled provider cannot be disabled from here; the
 * way out is the host CLI.
 */
export async function setProviderEnabled(
  ctx: IdpServiceContext,
  input: { providerId: string; enabled: boolean; allowLast?: boolean },
): Promise<IdpResult> {
  const row = await ctx.db
    .selectFrom("identity_provider")
    .select(["protocol", "enabled"])
    .where("provider_id", "=", input.providerId)
    .executeTakeFirst();
  if (!row) return refused("not_found");
  if (row.enabled === input.enabled) return { ok: true, providerId: input.providerId };
  if (
    !input.enabled &&
    ctx.policy.production &&
    !input.allowLast &&
    (await isLastEnabled(ctx.db, input.providerId))
  ) {
    return refused("last_enabled");
  }
  const protocol = row.protocol === "saml" ? "saml" : "oidc";
  await ctx.db.transaction().execute(async (trx) => {
    await trx
      .updateTable("identity_provider")
      .set({ enabled: input.enabled, updated_by: actorId(ctx), updated_at: new Date() })
      .where("provider_id", "=", input.providerId)
      .execute();
    if (input.enabled) {
      await audit(trx, ctx, "idp_enabled", input.providerId, protocol);
      return;
    }
    // NOTE: ASVS V7.4.2; a switched-off provider must not leave sessions it vouched for alive.
    const ended = await trx
      .deleteFrom("session")
      .where("userId", "in", (eb) =>
        eb
          .selectFrom("account")
          .select("account.userId")
          .where("account.providerId", "=", input.providerId),
      )
      .executeTakeFirst();
    await audit(trx, ctx, "idp_disabled", input.providerId, protocol, {
      sessions_ended: Number(ended.numDeletedRows),
    });
  });
  invalidateProviderCache();
  return { ok: true, providerId: input.providerId };
}

/**
 * Deletes a provider that nobody ever signed in with (`idp_deleted`). With accounts it is
 * refused: disable it instead, so their sign-in history and role source keep their meaning.
 */
export async function deleteProvider(
  ctx: IdpServiceContext,
  input: { providerId: string },
): Promise<IdpResult> {
  const row = await ctx.db
    .selectFrom("identity_provider")
    .select(["protocol", "enabled"])
    .where("provider_id", "=", input.providerId)
    .executeTakeFirst();
  if (!row) return refused("not_found");
  const account = await ctx.db
    .selectFrom("account")
    .select("id")
    .where("providerId", "=", input.providerId)
    .executeTakeFirst();
  if (account) return refused("has_accounts");
  if (row.enabled && ctx.policy.production && (await isLastEnabled(ctx.db, input.providerId))) {
    return refused("last_enabled");
  }
  const protocol = row.protocol === "saml" ? "saml" : "oidc";
  await ctx.db.transaction().execute(async (trx) => {
    await audit(trx, ctx, "idp_deleted", input.providerId, protocol);
    await trx.deleteFrom("ssoProvider").where("providerId", "=", input.providerId).execute();
  });
  invalidateProviderCache();
  return { ok: true, providerId: input.providerId };
}
