// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The teacher's side of a lab's join code (S10, #288): turn it on, make a new one, turn it off,
// and read its state. The code leaves the server once, in the answer that made it; the database
// keeps only its keyed hash, and the code ends by date and by uses (ASVS V6.4.1).
import "@tanstack/react-start/server-only";
import { createHash, createHmac, hkdfSync, randomInt } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import { formatJoinCode, generateJoinCode } from "../../lib/join-code.ts";
import { parseLabId } from "../../lib/simulations.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  assertTeacher,
  done,
  type LockedLab,
  logNotFound,
  refused,
  type SimulationActor,
  type SimulationResult,
  withLab,
} from "./access.ts";

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

/** The HKDF info strings, one per key, both naming the lab (#288); never one string for both. */
export const JOIN_CODE_KEY_INFO = {
  code: "edulims lab join code",
  attempts: "edulims lab join attempts",
} as const;

function derive(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", info, 32));
}

/**
 * Returns the keys of join codes: HMAC-SHA-256 under keys derived from `secret` (the better-auth
 * secret) with HKDF, one per use, so the stored hashes alone cannot be guessed offline.
 */
export function joinCodeKey(secret: string): JoinCodeKey {
  // NOTE: #49; a rotated BETTER_AUTH_SECRET makes every join code stop working, as it should.
  const codeKey = derive(secret, JOIN_CODE_KEY_INFO.code);
  // NOTE: #49 (verification review of #119, F2); the counters' key is separate from the codes'.
  const attemptKey = derive(secret, JOIN_CODE_KEY_INFO.attempts);
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

/** The state of a lab's join code on the lab page; the code itself is never in it. */
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

/** Locks the code row of a locked lab, after its simulation row: the order of every lab write. */
function lockCodeRow(trx: Transaction<DB>, lab: LockedLab) {
  return trx
    .selectFrom("lab_join_codes")
    .select("lab_id")
    .where("lab_id", "=", lab.labId)
    .forUpdate()
    .executeTakeFirst();
}

async function writeCode(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: JoinCodeSettings & { labId: string },
  now: Date,
  key: JoinCodeKey,
  mode: "enabled" | "regenerated",
): Promise<SimulationResult<NewJoinCode>> {
  return withLab(db, actor, input.labId, async (trx, lab) => {
    const existing = await lockCodeRow(trx, lab);
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
      .insertInto("lab_join_codes")
      .values({ lab_id: lab.labId, ...row })
      .onConflict((conflict) => conflict.column("lab_id").doUpdateSet(row))
      .execute();
    await recordAudit(trx, {
      action: `lab_join_code_${mode}`,
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "lab", id: lab.labId },
      metadata: {
        simulation_id: lab.simulationId,
        valid_days: input.validDays,
        max_uses: input.maxUses,
      },
    });
    return done({
      code: formatJoinCode(code),
      expiresAt: expiresAt.toISOString(),
      maxUses: input.maxUses,
    });
  });
}

/**
 * Turns on the join code of a lab whose simulation the actor teaches and returns the new code,
 * once; a lab whose code is already on is `join_code_exists`.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export function enableJoinCode(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: JoinCodeSettings & { labId: string },
  now: Date,
  key: JoinCodeKey,
): Promise<SimulationResult<NewJoinCode>> {
  return writeCode(db, actor, input, now, key, "enabled");
}

/**
 * Replaces the join code of a lab with a new one, with new settings and no uses; the old code
 * stops working at once. A lab whose code is off is `join_code_off`.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export function regenerateJoinCode(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: JoinCodeSettings & { labId: string },
  now: Date,
  key: JoinCodeKey,
): Promise<SimulationResult<NewJoinCode>> {
  return writeCode(db, actor, input, now, key, "regenerated");
}

/**
 * Turns the join code of a lab off; a lab whose code is off is `join_code_off`.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export function disableJoinCode(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { labId: string },
): Promise<SimulationResult> {
  return withLab(db, actor, input.labId, async (trx, lab) => {
    if (!(await lockCodeRow(trx, lab))) return refused("join_code_off");
    await trx.deleteFrom("lab_join_codes").where("lab_id", "=", lab.labId).execute();
    await recordAudit(trx, {
      action: "lab_join_code_disabled",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "lab", id: lab.labId },
      metadata: { simulation_id: lab.simulationId },
    });
    return done(null);
  });
}

/**
 * Returns the join-code state of a lab for a teacher of its simulation, or `null` for a malformed
 * id, an unknown lab and a lab of another teacher's simulation alike (D11, R-01); every `null` is
 * logged as an `authz_fail` probe (ASVS V16.3.2). `fingerprint` is the current key's, so a code
 * made under a rotated secret shows as stale.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function getJoinCode(
  db: Kysely<DB>,
  actor: SimulationActor,
  labId: string,
  now: Date,
  fingerprint: string,
): Promise<JoinCodeView | null> {
  assertTeacher(actor);
  const id = parseLabId(labId);
  if (id === null) {
    logNotFound(actor.id, "lab", labId);
    return null;
  }
  const row = await db
    .selectFrom("labs")
    .innerJoin("simulation_teachers as mine", "mine.simulation_id", "labs.simulation_id")
    .leftJoin("lab_join_codes", "lab_join_codes.lab_id", "labs.id")
    .select([
      "labs.id",
      "lab_join_codes.created_at",
      "lab_join_codes.expires_at",
      "lab_join_codes.uses",
      "lab_join_codes.max_uses",
      "lab_join_codes.key_fingerprint",
    ])
    .where("labs.id", "=", id)
    .where("mine.user_id", "=", actor.id)
    .executeTakeFirst();
  if (!row) {
    logNotFound(actor.id, "lab", labId);
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
