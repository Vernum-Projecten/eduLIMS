// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The SCIM bearer tokens (#45, ADR 0017): one current token per identity provider, generated
// here, shown once, stored as a SHA-256 digest, valid for 180 days. A rotation keeps the
// previous token working for one hour, so the identity provider can switch without a gap; a
// revocation ends every token of the provider at once. The Admin screen and the host CLI
// (`scim token …`) both call this service, so every change writes its activity-log row in the
// same transaction. Relative imports: the host CLI loads this in plain Node.
import "@tanstack/react-start/server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import { type AuditActor, auditProvider } from "../audit/events.ts";
import { recordAudit, recordCommittedAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";

/** The prefix every eduLIMS SCIM token starts with, so a leaked one is recognisable in a scan. */
export const SCIM_TOKEN_PREFIX = "edulims_scim_";

const TOKEN_PATTERN = /^edulims_scim_[A-Za-z0-9_-]{43}$/;
const DAY_MS = 86_400_000;

// NOTE: owner decision on #45; a token lives 180 days, the screen warns 14 days before, and a
// rotation keeps the previous token for 1 hour.
/** How long a token works after it is created. */
export const SCIM_TOKEN_LIFETIME_MS = 180 * DAY_MS;
/** From how long before its expiry the provider's page warns. */
export const SCIM_TOKEN_WARNING_MS = 14 * DAY_MS;
/** How long the previous token keeps working after a rotation. */
export const SCIM_ROTATION_OVERLAP_MS = 60 * 60_000;

/** How often `last_used_at` is written at most, so every SCIM request is not a write. */
const LAST_USED_INTERVAL_MS = 5 * 60_000;

/** Returns a new token: the prefix and 256 random bits, base64url. */
export function generateScimToken(): string {
  return `${SCIM_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Returns the stored form of a token: its SHA-256 digest in hex. */
export function hashScimToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Who changes a token: an administrator from the screen, or `system` from the host CLI. */
export interface ScimTokenContext {
  db: Kysely<DB>;
  actor: Extract<AuditActor, { type: "user" } | { type: "system" }>;
}

/** Why a token change was refused; the screen and the CLI map each code to a message. */
export type ScimTokenError = "not_found" | "exists" | "no_token";

/** The outcome of a create or rotate: the plaintext token, which nobody can read again. */
export type ScimTokenIssued =
  | {
      ok: true;
      providerId: string;
      token: string;
      /** ISO instant the new token stops working. */
      expiresAt: string;
      /** ISO instant the previous token stops working, after a rotation. */
      previousValidUntil: string | null;
    }
  | { ok: false; error: ScimTokenError };

/** The outcome of a revoke. */
export type ScimTokenRevoked =
  | { ok: true; providerId: string }
  | { ok: false; error: ScimTokenError };

/** The state of a provider's token for its detail page: never the token or its digest. */
export interface ScimTokenStatus {
  /** Whether the provider has a current token that has not expired. */
  active: boolean;
  createdAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  /** The current token expires within {@link SCIM_TOKEN_WARNING_MS}. */
  expiresSoon: boolean;
  /** The current token has expired: provisioning stops until it is rotated. */
  expired: boolean;
  /** Until when the token a rotation replaced still works, while it does. */
  previousValidUntil: string | null;
}

function actorId(ctx: ScimTokenContext): string | null {
  return ctx.actor.type === "user" ? ctx.actor.id : null;
}

async function providerExists(db: Kysely<DB>, providerId: string): Promise<boolean> {
  const row = await db
    .selectFrom("identity_provider")
    .select("provider_id")
    .where("provider_id", "=", providerId)
    .executeTakeFirst();
  return row !== undefined;
}

class TokenRefusal extends Error {
  override readonly name = "TokenRefusal";
  readonly kind: ScimTokenError;

  constructor(kind: ScimTokenError) {
    super(kind);
    this.kind = kind;
  }
}

async function refusable<T>(
  run: () => Promise<T>,
): Promise<T | { ok: false; error: ScimTokenError }> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof TokenRefusal) return { ok: false, error: error.kind };
    throw error;
  }
}

/** Returns the current (not superseded, not revoked) token row of a provider, locked. */
function currentToken(trx: Transaction<DB>, providerId: string) {
  return trx
    .selectFrom("scim_token")
    .select(["id", "expires_at"])
    .where("provider_id", "=", providerId)
    .where("revoked_at", "is", null)
    .where("superseded_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
}

type Change = "scim_token_created" | "scim_token_rotated";

async function issue(
  ctx: ScimTokenContext,
  providerId: string,
  action: Change,
  now: Date,
): Promise<ScimTokenIssued> {
  if (!(await providerExists(ctx.db, providerId))) return { ok: false, error: "not_found" };
  const token = generateScimToken();
  const expiresAt = new Date(now.getTime() + SCIM_TOKEN_LIFETIME_MS);
  return ctx.db.transaction().execute(async (trx) => {
    const current = await currentToken(trx, providerId);
    const live = current !== undefined && current.expires_at > now;
    if (action === "scim_token_created" && live) throw new TokenRefusal("exists");
    if (action === "scim_token_rotated" && !current) throw new TokenRefusal("no_token");
    let previousValidUntil: Date | null = null;
    if (current) {
      // A rotation keeps a live token for the overlap; an expired one stays expired.
      const overlap = new Date(now.getTime() + SCIM_ROTATION_OVERLAP_MS);
      const until = action === "scim_token_rotated" && live ? overlap : now;
      const ends = new Date(Math.min(current.expires_at.getTime(), until.getTime()));
      await trx
        .updateTable("scim_token")
        .set({ superseded_at: now, expires_at: ends })
        .where("id", "=", current.id)
        .execute();
      previousValidUntil = live && ends > now ? ends : null;
    }
    await trx
      .insertInto("scim_token")
      .values({
        provider_id: providerId,
        token_hash: hashScimToken(token),
        created_by: actorId(ctx),
        created_at: now,
        expires_at: expiresAt,
      })
      .execute();
    await recordAudit(trx, {
      action,
      actor: ctx.actor,
      outcome: "success",
      target: { type: "identity_provider", id: providerId },
      metadata: {
        provider_id: providerId,
        token_expires_at: expiresAt.toISOString(),
        ...(previousValidUntil
          ? { previous_token_valid_until: previousValidUntil.toISOString() }
          : {}),
      },
    });
    return {
      ok: true as const,
      providerId,
      token,
      expiresAt: expiresAt.toISOString(),
      previousValidUntil: previousValidUntil?.toISOString() ?? null,
    };
  });
}

/**
 * Creates a provider's token (`scim_token_created`) and returns it in plaintext, once; refused
 * with `exists` while the provider has a current token that has not expired.
 */
export function createScimToken(
  ctx: ScimTokenContext,
  providerId: string,
  now: Date = new Date(),
): Promise<ScimTokenIssued> {
  return refusable(() => issue(ctx, providerId, "scim_token_created", now));
}

/**
 * Replaces a provider's token with a new one (`scim_token_rotated`). The previous token keeps
 * working for {@link SCIM_ROTATION_OVERLAP_MS} (never past its own expiry), so the identity
 * provider can be updated without a gap. Refused with `no_token` when there is none to replace.
 */
export function rotateScimToken(
  ctx: ScimTokenContext,
  providerId: string,
  now: Date = new Date(),
): Promise<ScimTokenIssued> {
  return refusable(() => issue(ctx, providerId, "scim_token_rotated", now));
}

/**
 * Revokes every token of a provider at once, the one a rotation replaced included
 * (`scim_token_revoked`); provisioning stops until a new token.
 */
export async function revokeScimToken(
  ctx: ScimTokenContext,
  providerId: string,
  now: Date = new Date(),
): Promise<ScimTokenRevoked> {
  if (!(await providerExists(ctx.db, providerId))) return { ok: false, error: "not_found" };
  return ctx.db.transaction().execute(async (trx) => {
    const revoked = await trx
      .updateTable("scim_token")
      .set({ revoked_at: now, revoked_by: actorId(ctx) })
      .where("provider_id", "=", providerId)
      .where("revoked_at", "is", null)
      .where((eb) => eb.or([eb("superseded_at", "is", null), eb("expires_at", ">", now)]))
      .returning("id")
      .execute();
    if (revoked.length === 0) return { ok: false as const, error: "no_token" as const };
    await recordAudit(trx, {
      action: "scim_token_revoked",
      actor: ctx.actor,
      outcome: "success",
      target: { type: "identity_provider", id: providerId },
      metadata: { provider_id: providerId },
    });
    return { ok: true as const, providerId };
  });
}

/** Returns the state of a provider's tokens at `now`, for its detail page. */
export async function scimTokenStatus(
  db: Kysely<DB>,
  providerId: string,
  now: Date = new Date(),
): Promise<ScimTokenStatus> {
  const rows = await db
    .selectFrom("scim_token")
    .select(["created_at", "expires_at", "last_used_at", "superseded_at"])
    .where("provider_id", "=", providerId)
    .where("revoked_at", "is", null)
    .where((eb) => eb.or([eb("superseded_at", "is", null), eb("expires_at", ">", now)]))
    .orderBy("created_at", "desc")
    .execute();
  const current = rows.find((row) => row.superseded_at === null);
  const previous = rows.find((row) => row.superseded_at !== null);
  const previousValidUntil = previous ? previous.expires_at.toISOString() : null;
  if (!current) {
    return {
      active: false,
      createdAt: null,
      expiresAt: null,
      lastUsedAt: null,
      expiresSoon: false,
      expired: false,
      previousValidUntil,
    };
  }
  const left = current.expires_at.getTime() - now.getTime();
  return {
    active: left > 0,
    createdAt: current.created_at.toISOString(),
    expiresAt: current.expires_at.toISOString(),
    lastUsedAt: current.last_used_at ? current.last_used_at.toISOString() : null,
    expiresSoon: left > 0 && left <= SCIM_TOKEN_WARNING_MS,
    expired: left <= 0,
    previousValidUntil,
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
 * or expired token and for a token of a disabled provider. Looks the token up by its digest
 * only. An expired token is logged as `scim_token_refused` with reason `token_expired`.
 */
export async function verifyScimToken(
  db: Kysely<DB>,
  token: string,
  now: Date = new Date(),
): Promise<VerifiedScimToken | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const row = await db
    .selectFrom("scim_token")
    .innerJoin("identity_provider", "identity_provider.provider_id", "scim_token.provider_id")
    .select([
      "scim_token.id",
      "scim_token.provider_id",
      "scim_token.expires_at",
      "scim_token.last_used_at",
    ])
    .where("scim_token.token_hash", "=", hashScimToken(token))
    .where("scim_token.revoked_at", "is", null)
    .where("identity_provider.enabled", "=", true)
    .executeTakeFirst();
  if (!row) return null;
  if (row.expires_at <= now) {
    const provider = auditProvider(row.provider_id);
    await recordCommittedAudit(db, {
      action: "scim_token_refused",
      actor: { type: "anonymous" },
      outcome: "refused",
      reason: "token_expired",
      target: { type: "identity_provider", id: row.provider_id },
      ...(provider ? { provider } : {}),
      metadata: { provider_id: row.provider_id },
    });
    return null;
  }
  if (!row.last_used_at || now.getTime() - row.last_used_at.getTime() > LAST_USED_INTERVAL_MS) {
    await db
      .updateTable("scim_token")
      .set({ last_used_at: now })
      .where("id", "=", row.id)
      .execute();
  }
  return { tokenId: row.id, providerId: row.provider_id, expiresAt: row.expires_at };
}

/** Returns the provider of a token without the enabled check or a write; for the activity log. */
export async function providerOfScimToken(db: Kysely<DB>, token: string): Promise<string | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const row = await db
    .selectFrom("scim_token")
    .select("provider_id")
    .where("token_hash", "=", hashScimToken(token))
    .executeTakeFirst();
  return row?.provider_id ?? null;
}
