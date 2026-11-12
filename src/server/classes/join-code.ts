// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The teacher's side of the class join code (#49): turn it on, make a new one, turn it off, and
// read its state. The code itself leaves the server once, in the answer that made it; the
// database keeps only its keyed hash, and the code ends by date and by uses (ASVS V6.4.1).
import "@tanstack/react-start/server-only";
import { createHash, createHmac, hkdfSync, randomInt } from "node:crypto";
import type { Kysely } from "kysely";
import { formatJoinCode, generateJoinCode } from "../../lib/join-code.ts";
import { recordAudit } from "../audit/record.ts";
import { UUID_PATTERN } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  type ClassActor,
  type ClassResult,
  done,
  logClassNotFound,
  refused,
  withClass,
} from "./access.ts";
import { userActor } from "./classes.ts";

/**
 * The keys of join codes: `hash` turns a normalised code into its stored HMAC (hex);
 * `attemptHash` does the same for a rate-limit key, under a key of its own; `fingerprint` names
 * the code key, so a code made under another key shows as stale.
 */
export interface JoinCodeKey {
  hash: (value: string) => string;
  attemptHash: (value: string) => string;
  fingerprint: string;
}

function derive(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", info, 32));
}

/**
 * Returns the keys of join codes: HMAC-SHA-256 under keys derived from `secret` (the better-auth
 * secret) with HKDF, one per use, so the stored hashes alone cannot be guessed offline.
 */
export function joinCodeKey(secret: string): JoinCodeKey {
  // NOTE: #49; a rotated BETTER_AUTH_SECRET makes every join code stop working, as it should.
  const codeKey = derive(secret, "edulims class join code");
  // NOTE: #49 (verification review of #119, F2); the counters' key is separate from the codes'.
  const attemptKey = derive(secret, "edulims class join attempts");
  return {
    hash: (value) => createHmac("sha256", codeKey).update(value, "utf8").digest("hex"),
    attemptHash: (value) => createHmac("sha256", attemptKey).update(value, "utf8").digest("hex"),
    fingerprint: createHash("sha256").update(codeKey).digest("hex").slice(0, 16),
  };
}

/** The settings a teacher chooses for a code: how many days it works and how many joins. */
export interface JoinCodeSettings {
  validDays: number;
  maxUses: number;
}

/** A new code, shown once: grouped for reading aloud, with its end and its most joins. */
export interface NewJoinCode {
  code: string;
  expiresAt: string;
  maxUses: number;
}

/** The state of a class's join code on the class page; the code itself is never in it. */
export type JoinCodeView =
  | { enabled: false }
  | {
      enabled: true;
      createdAt: string;
      expiresAt: string;
      expired: boolean;
      /** Made under another `BETTER_AUTH_SECRET`: it no longer works, and a new code is due. */
      stale: boolean;
      uses: number;
      maxUses: number;
    };

const DAY_MS = 86_400_000;

/** The check of every join-code action: inviting students is what a code does. */
function codeCheck(classId: string, action: "enabled" | "regenerated" | "disabled") {
  return {
    classId,
    permission: { student: ["invite"] },
    action: `class_join_code_${action}`,
  } as const;
}

async function writeCode(
  db: Kysely<DB>,
  actor: ClassActor,
  input: JoinCodeSettings & { classId: string },
  now: Date,
  key: JoinCodeKey,
  mode: "enabled" | "regenerated",
): Promise<ClassResult<NewJoinCode>> {
  return withClass(db, actor, codeCheck(input.classId, mode), async (trx, locked) => {
    const existing = await trx
      .selectFrom("class_join_codes")
      .select("organization_id")
      .where("organization_id", "=", locked.id)
      .forUpdate()
      .executeTakeFirst();
    if (mode === "enabled" && existing) return refused("join_code_exists");
    if (mode === "regenerated" && !existing) return refused("join_code_off");
    const code = generateJoinCode(randomInt);
    const expiresAt = new Date(now.getTime() + input.validDays * DAY_MS);
    const row = {
      code_hash: key.hash(code),
      key_fingerprint: key.fingerprint,
      created_by: actor.id,
      created_at: now,
      expires_at: expiresAt,
      max_uses: input.maxUses,
      uses: 0,
    };
    await trx
      .insertInto("class_join_codes")
      .values({ organization_id: locked.id, ...row })
      .onConflict((conflict) => conflict.column("organization_id").doUpdateSet(row))
      .execute();
    await recordAudit(trx, {
      action: `class_join_code_${mode}`,
      actor: userActor(actor),
      outcome: "success",
      target: { type: "class", id: locked.id },
      metadata: { valid_days: input.validDays, max_uses: input.maxUses },
    });
    return done({
      code: formatJoinCode(code),
      expiresAt: expiresAt.toISOString(),
      maxUses: input.maxUses,
    });
  });
}

/**
 * Turns on the join code of a class (an owner or co-teacher, not archived) and returns the new
 * code; a class whose code is already on is `join_code_exists`.
 */
export function enableJoinCode(
  db: Kysely<DB>,
  actor: ClassActor,
  input: JoinCodeSettings & { classId: string },
  now: Date,
  key: JoinCodeKey,
): Promise<ClassResult<NewJoinCode>> {
  return writeCode(db, actor, input, now, key, "enabled");
}

/**
 * Replaces the join code of a class with a new one, with new settings and no uses; the old code
 * stops working at once. A class whose code is off is `join_code_off`.
 */
export function regenerateJoinCode(
  db: Kysely<DB>,
  actor: ClassActor,
  input: JoinCodeSettings & { classId: string },
  now: Date,
  key: JoinCodeKey,
): Promise<ClassResult<NewJoinCode>> {
  return writeCode(db, actor, input, now, key, "regenerated");
}

/** Turns the join code of a class off; a class whose code is off is `join_code_off`. */
export function disableJoinCode(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string },
): Promise<ClassResult> {
  return withClass(db, actor, codeCheck(input.classId, "disabled"), async (trx, locked) => {
    const deleted = await trx
      .deleteFrom("class_join_codes")
      .where("organization_id", "=", locked.id)
      .executeTakeFirst();
    if (deleted.numDeletedRows === 0n) return refused("join_code_off");
    await recordAudit(trx, {
      action: "class_join_code_disabled",
      actor: userActor(actor),
      outcome: "success",
      target: { type: "class", id: locked.id },
    });
    return done(null);
  });
}

/**
 * Returns the join-code state of a class for a teacher of it, or `null` when the user does not
 * teach the class (D3): the membership is the filter of the one query. `fingerprint` is the
 * current key's, so a code made under a rotated secret shows as stale.
 */
export async function getJoinCode(
  db: Kysely<DB>,
  userId: string,
  classId: string,
  now: Date,
  fingerprint: string,
): Promise<JoinCodeView | null> {
  if (!UUID_PATTERN.test(classId)) {
    logClassNotFound(userId, classId);
    return null;
  }
  const row = await db
    .selectFrom("organization")
    .innerJoin("member", "member.organizationId", "organization.id")
    .leftJoin("class_join_codes", "class_join_codes.organization_id", "organization.id")
    .select([
      "organization.id",
      "class_join_codes.created_at",
      "class_join_codes.expires_at",
      "class_join_codes.uses",
      "class_join_codes.max_uses",
      "class_join_codes.key_fingerprint",
    ])
    .where("organization.id", "=", classId)
    .where("member.userId", "=", userId)
    .where("member.role", "in", ["owner", "teacher"])
    .executeTakeFirst();
  if (!row) {
    logClassNotFound(userId, classId);
    return null;
  }
  const { created_at: createdAt, expires_at: expiresAt, uses, max_uses: maxUses } = row;
  if (createdAt === null || expiresAt === null || uses === null || maxUses === null) {
    return { enabled: false };
  }
  return {
    enabled: true,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    expired: expiresAt <= now,
    stale: row.key_fingerprint !== fingerprint,
    uses,
    maxUses,
  };
}
