// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Checking a SCIM bearer token (#45, ADR 0017): by its SHA-256 digest only, never by the token.
// `inspectScimToken` says why a token does not open a connection (the activity log and the rate
// limit need that) without writing anything; `verifyScimToken` is the plugin's check.
// Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import { hashScimToken, TOKEN_PATTERN } from "./tokens.ts";

/** How often `last_used_at` is written at most, so every SCIM request is not a write. */
const LAST_USED_INTERVAL_MS = 5 * 60_000;

/** Why a token does not open a SCIM connection, as the activity log's reason code says it. */
export type ScimTokenRefusal =
  | "token_missing"
  | "token_unknown"
  | "token_revoked"
  | "token_expired"
  | "provider_disabled";

/** What a bearer token is: a working token of a provider, or the reason it is refused. */
export type InspectedScimToken =
  | { ok: true; tokenId: string; providerId: string; expiresAt: Date; lastUsedAt: Date | null }
  | { ok: false; reason: ScimTokenRefusal; providerId: string | null };

/** Returns what `token` is at `now`, without writing anything. */
export async function inspectScimToken(
  db: Kysely<DB>,
  token: string | null,
  now: Date = new Date(),
): Promise<InspectedScimToken> {
  if (token === null) return { ok: false, reason: "token_missing", providerId: null };
  if (!TOKEN_PATTERN.test(token)) return { ok: false, reason: "token_unknown", providerId: null };
  const row = await db
    .selectFrom("scim_token")
    .innerJoin("identity_provider", "identity_provider.provider_id", "scim_token.provider_id")
    .select([
      "scim_token.id",
      "scim_token.provider_id",
      "scim_token.expires_at",
      "scim_token.last_used_at",
      "scim_token.revoked_at",
      "identity_provider.enabled",
    ])
    .where("scim_token.token_hash", "=", hashScimToken(token))
    .executeTakeFirst();
  if (!row) return { ok: false, reason: "token_unknown", providerId: null };
  const providerId = row.provider_id;
  if (row.revoked_at !== null) return { ok: false, reason: "token_revoked", providerId };
  if (row.expires_at <= now) return { ok: false, reason: "token_expired", providerId };
  if (!row.enabled) return { ok: false, reason: "provider_disabled", providerId };
  return {
    ok: true,
    tokenId: row.id,
    providerId,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
  };
}

/** A token that authenticated: its row and the provider whose SCIM connection it opens. */
export interface VerifiedScimToken {
  tokenId: string;
  providerId: string;
  expiresAt: Date;
}

/**
 * Returns the provider a bearer token belongs to, or `null` for a malformed, unknown, revoked
 * or expired token and for a token of a disabled provider. The guard plugin logs each refusal
 * (gate.ts); this records the token's last use, at most every five minutes.
 */
export async function verifyScimToken(
  db: Kysely<DB>,
  token: string,
  now: Date = new Date(),
): Promise<VerifiedScimToken | null> {
  const inspected = await inspectScimToken(db, token, now);
  if (!inspected.ok) return null;
  const { tokenId, providerId, expiresAt, lastUsedAt } = inspected;
  if (!lastUsedAt || now.getTime() - lastUsedAt.getTime() > LAST_USED_INTERVAL_MS) {
    await db
      .updateTable("scim_token")
      .set({ last_used_at: now })
      .where("id", "=", tokenId)
      .execute();
  }
  return { tokenId, providerId, expiresAt };
}
