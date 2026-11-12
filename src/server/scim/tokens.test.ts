// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The SCIM token service (#45, ADR 0017; ASVS V11.4.1, V13.3): generated once, stored only as a
// digest, rotated and revoked with an activity-log row, and verified for enabled providers only.
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { parseEnv } from "../env.ts";
import { keyringOf } from "../idp/crypto.ts";
import { invalidateProviderCache } from "../idp/registry.ts";
import { insertTestProvider } from "../idp/test-providers.ts";
import { VALID_ENV } from "../test-env.ts";
import {
  createScimToken,
  generateScimToken,
  hashScimToken,
  isUniqueViolation,
  revokeScimToken,
  rotateScimToken,
  SCIM_ROTATION_OVERLAP_MS,
  SCIM_TOKEN_LIFETIME_MS,
  SCIM_TOKEN_PREFIX,
  SCIM_TOKEN_WARNING_MS,
  scimTokenStatus,
} from "./tokens.ts";
import { inspectScimToken, verifyScimToken } from "./verify.ts";

let db: Kysely<DB>;
const admin = () => ({ db, actor: { type: "user" as const, id: "admin-1" } });

beforeEach(async () => {
  db = await createTestDb();
  await db
    .insertInto("user")
    .values({ id: "admin-1", name: "A", email: "admin@example.test", emailVerified: true })
    .execute();
  await insertTestProvider(db, keyringOf(parseEnv(VALID_ENV)), { providerId: "campus" });
});

afterEach(async () => {
  invalidateProviderCache();
  await db.destroy();
});

async function issuedAt(now: Date): Promise<string> {
  const result = await createScimToken(admin(), "campus", now);
  if (!result.ok) throw new Error(result.error);
  return result.token;
}

async function issued(): Promise<string> {
  const result = await createScimToken(admin(), "campus");
  if (!result.ok) throw new Error(result.error);
  return result.token;
}

async function auditActions(): Promise<string[]> {
  const rows = await db
    .selectFrom("audit_event")
    .select(["action", "actor_id", "target_id"])
    .orderBy("id")
    .execute();
  return rows.map((row) => `${row.action}:${row.actor_id}:${row.target_id}`);
}

describe("isUniqueViolation (M4)", () => {
  it("recognises PostgreSQL's unique violation only", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("generateScimToken", () => {
  it("returns the prefix and 256 random bits, different every time", () => {
    const token = generateScimToken();
    expect(token).toMatch(/^edulims_scim_[A-Za-z0-9_-]{43}$/);
    expect(token.startsWith(SCIM_TOKEN_PREFIX)).toBe(true);
    expect(generateScimToken()).not.toBe(token);
  });

  it("hashes to a SHA-256 hex digest", () => {
    expect(hashScimToken("x")).toBe(
      "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
    );
  });
});

describe("the token service", () => {
  it("creates a token, stores only its digest and logs scim_token_created", async () => {
    const token = await issued();
    const rows = await db.selectFrom("scim_token").select(["token_hash", "created_by"]).execute();
    expect(rows).toEqual([{ token_hash: hashScimToken(token), created_by: "admin-1" }]);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(await auditActions()).toEqual(["scim_token_created:admin-1:campus"]);
  });

  it("refuses a second token while one is live (exists)", async () => {
    await issued();
    expect(await createScimToken(admin(), "campus")).toEqual({ ok: false, error: "exists" });
    expect(await auditActions()).toEqual(["scim_token_created:admin-1:campus"]);
  });

  it("refuses an unknown provider (not_found)", async () => {
    expect(await createScimToken(admin(), "nobody")).toEqual({ ok: false, error: "not_found" });
    expect(await rotateScimToken(admin(), "nobody")).toEqual({ ok: false, error: "not_found" });
    expect(await revokeScimToken(admin(), "nobody")).toEqual({ ok: false, error: "not_found" });
  });

  it("rotates: the new token works at once, the old one for one more hour (owner, #45)", async () => {
    const t0 = new Date("2026-11-11T10:00:00Z");
    const old = await issuedAt(t0);
    const rotatedAt = new Date("2026-11-12T10:00:00Z");
    const rotated = await rotateScimToken(admin(), "campus", rotatedAt);
    if (!rotated.ok) throw new Error(rotated.error);
    const overlapEnd = new Date(rotatedAt.getTime() + SCIM_ROTATION_OVERLAP_MS);
    expect(rotated.previousValidUntil).toBe(overlapEnd.toISOString());
    expect(rotated.expiresAt).toBe(
      new Date(rotatedAt.getTime() + SCIM_TOKEN_LIFETIME_MS).toISOString(),
    );
    const inOverlap = new Date(rotatedAt.getTime() + 30 * 60_000);
    expect(await verifyScimToken(db, old, inOverlap)).toMatchObject({ providerId: "campus" });
    expect(await verifyScimToken(db, rotated.token, inOverlap)).toMatchObject({
      providerId: "campus",
    });
    expect(await verifyScimToken(db, old, overlapEnd)).toBeNull();
    expect(await verifyScimToken(db, rotated.token, overlapEnd)).not.toBeNull();
    expect((await scimTokenStatus(db, "campus", inOverlap)).previousValidUntil).toBe(
      overlapEnd.toISOString(),
    );
    expect((await scimTokenStatus(db, "campus", overlapEnd)).previousValidUntil).toBeNull();
    const row = await db
      .selectFrom("audit_event")
      .select("metadata")
      .where("action", "=", "scim_token_rotated")
      .executeTakeFirstOrThrow();
    expect(row.metadata).toMatchObject({
      token_expires_at: rotated.expiresAt,
      previous_token_valid_until: overlapEnd.toISOString(),
    });
  });

  it("refuses to rotate or revoke when there is no token (no_token)", async () => {
    expect(await rotateScimToken(admin(), "campus")).toEqual({ ok: false, error: "no_token" });
    expect(await revokeScimToken(admin(), "campus")).toEqual({ ok: false, error: "no_token" });
  });

  it("revokes at once, the token a rotation left running included", async () => {
    const token = await issued();
    const rotated = await rotateScimToken(admin(), "campus");
    if (!rotated.ok) throw new Error(rotated.error);
    expect(await revokeScimToken(admin(), "campus")).toEqual({ ok: true, providerId: "campus" });
    expect(await verifyScimToken(db, token)).toBeNull();
    expect(await verifyScimToken(db, rotated.token)).toBeNull();
    expect(await scimTokenStatus(db, "campus")).toEqual({
      active: false,
      createdAt: null,
      expiresAt: null,
      lastUsedAt: null,
      expiresSoon: false,
      expired: false,
      previousValidUntil: null,
    });
    expect(await auditActions()).toContain("scim_token_revoked:admin-1:campus");
  });

  it("logs a CLI change with actor system", async () => {
    await createScimToken({ db, actor: { type: "system" } }, "campus");
    const row = await db
      .selectFrom("audit_event")
      .select(["actor_type", "actor_id"])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ actor_type: "system", actor_id: null });
  });
});

describe("token lifetime (owner decision on #45)", () => {
  const t0 = new Date("2026-11-11T10:00:00Z");
  const at = (ms: number) => new Date(t0.getTime() + ms);

  it("expires after 180 days", async () => {
    const token = await issuedAt(t0);
    expect((await scimTokenStatus(db, "campus", t0)).expiresAt).toBe(
      at(SCIM_TOKEN_LIFETIME_MS).toISOString(),
    );
    expect(await verifyScimToken(db, token, at(SCIM_TOKEN_LIFETIME_MS - 1))).not.toBeNull();
    expect(await verifyScimToken(db, token, at(SCIM_TOKEN_LIFETIME_MS))).toBeNull();
  });

  it("says why an expired, revoked, unknown or missing token is refused, writing nothing", async () => {
    const token = await issuedAt(t0);
    expect(await inspectScimToken(db, token, at(SCIM_TOKEN_LIFETIME_MS + 1))).toEqual({
      ok: false,
      reason: "token_expired",
      providerId: "campus",
    });
    expect(await inspectScimToken(db, generateScimToken(), t0)).toEqual({
      ok: false,
      reason: "token_unknown",
      providerId: null,
    });
    expect(await inspectScimToken(db, null, t0)).toEqual({
      ok: false,
      reason: "token_missing",
      providerId: null,
    });
    await revokeScimToken(admin(), "campus", at(1));
    expect(await inspectScimToken(db, token, at(2))).toMatchObject({ reason: "token_revoked" });
    expect(await db.selectFrom("audit_event").select("action").execute()).toEqual([
      { action: "scim_token_created" },
      { action: "scim_token_revoked" },
    ]);
  });

  it("warns from 14 days before the expiry, and says when it has expired", async () => {
    await issuedAt(t0);
    const before = at(SCIM_TOKEN_LIFETIME_MS - SCIM_TOKEN_WARNING_MS - 1);
    expect(await scimTokenStatus(db, "campus", before)).toMatchObject({
      active: true,
      expiresSoon: false,
    });
    const warned = at(SCIM_TOKEN_LIFETIME_MS - SCIM_TOKEN_WARNING_MS);
    expect(await scimTokenStatus(db, "campus", warned)).toMatchObject({
      active: true,
      expiresSoon: true,
      expired: false,
    });
    expect(await scimTokenStatus(db, "campus", at(SCIM_TOKEN_LIFETIME_MS))).toMatchObject({
      active: false,
      expiresSoon: false,
      expired: true,
    });
  });

  it("creates a new token over an expired one, and rotating an expired one leaves no overlap", async () => {
    await issuedAt(t0);
    const later = at(SCIM_TOKEN_LIFETIME_MS + 1);
    const rotated = await rotateScimToken(admin(), "campus", later);
    expect(rotated).toMatchObject({ ok: true, previousValidUntil: null });
    const revoked = await revokeScimToken(admin(), "campus", later);
    expect(revoked.ok).toBe(true);
    await issuedAt(t0);
    expect(await createScimToken(admin(), "campus", later)).toMatchObject({
      ok: true,
      previousValidUntil: null,
    });
  });
});

describe("verifyScimToken", () => {
  it("refuses a malformed or unknown token", async () => {
    await issued();
    expect(await verifyScimToken(db, "not-a-token")).toBeNull();
    expect(await verifyScimToken(db, generateScimToken())).toBeNull();
    expect(await inspectScimToken(db, "not-a-token")).toMatchObject({ reason: "token_unknown" });
  });

  it("refuses the token of a disabled provider, which still names its provider for the log", async () => {
    const token = await issued();
    await db.updateTable("identity_provider").set({ enabled: false }).execute();
    expect(await verifyScimToken(db, token)).toBeNull();
    expect(await inspectScimToken(db, token)).toEqual({
      ok: false,
      reason: "provider_disabled",
      providerId: "campus",
    });
  });

  it("records the last use at most every five minutes", async () => {
    const token = await issued();
    const first = new Date("2026-11-11T10:00:00Z");
    await verifyScimToken(db, token, first);
    await verifyScimToken(db, token, new Date("2026-11-11T10:01:00Z"));
    expect((await scimTokenStatus(db, "campus")).lastUsedAt).toBe(first.toISOString());
    const later = new Date("2026-11-11T10:06:00Z");
    await verifyScimToken(db, token, later);
    expect((await scimTokenStatus(db, "campus")).lastUsedAt).toBe(later.toISOString());
  });
});
