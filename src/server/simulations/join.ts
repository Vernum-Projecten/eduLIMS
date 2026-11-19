// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The student's side of a lab's join code (S10: "a student whose address is unknown joins with
// the lab's code", #288). The code is the proof, so no verified email is needed. A wrong, expired,
// used-up or deleted lab's code, and a student a teacher removed, read the same to the student, so
// an answer never tells whether a lab exists; wrong codes are rate-limited (ASVS V2.4.1, V6.3.1,
// join-limits.ts) and logged (V16.3.1).
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { normalizeJoinCode } from "../../lib/join-code.ts";
import type { AuditEvent } from "../audit/events.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { done, refused, type SimulationActor, type SimulationResult } from "./access.ts";
import type { JoinCodeKey } from "./join-code.ts";
import {
  type Charge,
  chargeAttempt,
  type JoinLimits,
  justOverLimit,
  type LimitKey,
  limitKeyText,
  overLimit,
  refundAttempt,
} from "./join-limits.ts";
import { wasRemoved } from "./removals.ts";
import { dropWaitingAddressesOf } from "./waiting.ts";

/** What a join did: the lab joined, or the student was in it already. */
export interface JoinOutcome {
  status: "joined" | "already_member";
  labId: string;
  labName: string;
  simulationId: string;
  simulationName: string;
}

/**
 * Why a code did not work, for the activity log only: the student sees `invalid_code` for every
 * one but `in_other_lab`, which only a working code reaches.
 */
export type JoinFailure =
  | "malformed_code"
  | "unknown_code"
  | "code_expired"
  | "code_used_up"
  | "lab_deleted"
  | "removed"
  | "in_other_lab";

/** What a join needs besides the code: the clock, the client IP, the key and the limits. */
export interface JoinContext {
  now: Date;
  /** The client IP through the trusted proxies (`clientIpOf`), or `null` when none is trusted. */
  clientIp: string | null;
  key: JoinCodeKey;
  limits: JoinLimits;
}

interface FailedAttempt {
  ok: false;
  reason: JoinFailure;
  labId: string | null;
  simulationId: string | null;
}

type Attempt = { ok: true; value: JoinOutcome } | FailedAttempt;

/** Thrown inside the join transaction when the code row is locked, so it rolls back and retries. */
class CodeRowBusy extends Error {
  override readonly name = "CodeRowBusy";
}

/** PostgreSQL's `lock_not_available` (55P03), the answer of `FOR UPDATE NOWAIT` on a locked row. */
function isLockNotAvailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "55P03";
}

// NOTE: no requirement governs these numbers: our own design. A join holds its locks for a few
// milliseconds, so 40 tries spread over about half a second outlast any normal queue.
const LOCK_TRIES = 40;
const LOCK_PAUSE_MS = 12;

/**
 * Looks the code up and joins. The first read takes no lock; the transaction then locks the
 * simulation (`FOR SHARE`) before the code row (`FOR UPDATE NOWAIT`), the order every lab write
 * uses, and checks the hash, the term and the uses again, so a parallel delete, new code or join
 * is seen. A locked code row ends the transaction, which lets the simulation go, and the join
 * tries again: it never waits on the code row while it holds the simulation, so it cannot
 * deadlock with a writer that takes the two the other way round.
 */
async function attempt(
  db: Kysely<DB>,
  actor: SimulationActor,
  code: string,
  ctx: JoinContext,
): Promise<Attempt> {
  const codeHash = ctx.key.hash(code);
  const found = await db
    .selectFrom("lab_join_codes")
    .select("lab_id")
    .where("code_hash", "=", codeHash)
    .executeTakeFirst();
  if (!found) return { ok: false, reason: "unknown_code", labId: null, simulationId: null };
  for (let tries = 1; ; tries += 1) {
    try {
      return await lockedAttempt(db, actor, found.lab_id, codeHash, ctx, tries);
    } catch (error) {
      if (!(error instanceof CodeRowBusy)) throw error;
      await new Promise((resolve) => setTimeout(resolve, LOCK_PAUSE_MS * (1 + Math.random())));
    }
  }
}

async function lockedAttempt(
  db: Kysely<DB>,
  actor: SimulationActor,
  labId: string,
  codeHash: string,
  ctx: JoinContext,
  tries: number,
): Promise<Attempt> {
  return db.transaction().execute(async (trx): Promise<Attempt> => {
    const lab = await trx
      .selectFrom("labs")
      .innerJoin("simulations", "simulations.id", "labs.simulation_id")
      .select(["labs.name", "simulations.id as simulation_id", "simulations.name as simulation"])
      .where("labs.id", "=", labId)
      .forShare("simulations")
      .executeTakeFirst();
    const simulationId = lab?.simulation_id ?? null;
    const fail = (reason: JoinFailure): Attempt => ({ ok: false, reason, labId, simulationId });
    if (!lab) return fail("lab_deleted");
    const query = trx
      .selectFrom("lab_join_codes")
      .select(["code_hash", "expires_at", "uses", "max_uses"])
      .where("lab_id", "=", labId)
      .forUpdate();
    // The last try waits its turn, so a long but live queue still ends in an answer.
    const row = await (tries < LOCK_TRIES ? query.noWait() : query)
      .executeTakeFirst()
      .catch((error: unknown) => {
        if (isLockNotAvailable(error)) {
          throw new CodeRowBusy("join code row locked", { cause: error });
        }
        throw error;
      });
    if (!row) {
      // NOTE: no requirement governs this: our own design; a new statement under the lock tells a
      // lab deleted while this join waited from a code turned off.
      const still = await trx.selectFrom("labs").select("id").where("id", "=", labId).execute();
      return fail(still.length === 0 ? "lab_deleted" : "unknown_code");
    }
    if (row.code_hash !== codeHash) return fail("unknown_code");
    if (row.expires_at <= ctx.now) return fail("code_expired");
    if (await wasRemoved(trx, lab.simulation_id, actor.id)) return fail("removed");
    const outcome = {
      labId,
      labName: lab.name,
      simulationId: lab.simulation_id,
      simulationName: lab.simulation,
    };
    const placeOf = () =>
      trx
        .selectFrom("lab_members")
        .select("lab_id")
        .where("simulation_id", "=", lab.simulation_id)
        .where("user_id", "=", actor.id)
        .executeTakeFirst();
    const settled = (place: { lab_id: string }): Attempt =>
      place.lab_id === labId
        ? { ok: true, value: { status: "already_member", ...outcome } }
        : fail("in_other_lab");
    const place = await placeOf();
    // NOTE: #49; an existing member costs no use and is told so, even after the uses ran out.
    if (place) return settled(place);
    if (row.uses >= row.max_uses) return fail("code_used_up");
    const inserted = await trx
      .insertInto("lab_members")
      .values({
        simulation_id: lab.simulation_id,
        lab_id: labId,
        user_id: actor.id,
        joined_at: ctx.now,
        joined_via: "code",
      })
      .onConflict((conflict) => conflict.columns(["simulation_id", "user_id"]).doNothing())
      .returning("lab_id")
      .executeTakeFirst();
    if (!inserted) {
      // NOTE: S10 (#288); a parallel join or link placed the student first, and the primary key
      // kept one lab per simulation; the place it made decides the answer.
      const winner = await placeOf();
      if (!winner) throw new Error("lab_members conflict without a row");
      return settled(winner);
    }
    await trx
      .updateTable("lab_join_codes")
      .set((eb) => ({ uses: eb("uses", "+", 1) }))
      .where("lab_id", "=", labId)
      .execute();
    // NOTE: #323 (maintainer, 2026-11-19); the first lab joined wins, so no waiting address of the
    // student is left in the simulation to link them back after a removal.
    await dropWaitingAddressesOf(trx, lab.simulation_id, actor.id, { verifiedOnly: true });
    await recordAudit(trx, {
      action: "lab_member_joined",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "lab", id: labId },
      metadata: { simulation_id: lab.simulation_id, user_id: actor.id, join_via: "code" },
    });
    return { ok: true, value: { status: "joined", ...outcome } };
  });
}

function failedJoin(
  actor: SimulationActor,
  outcome: "failure" | "refused",
  reason: string,
  where: { labId: string | null; simulationId: string | null } = {
    labId: null,
    simulationId: null,
  },
): AuditEvent {
  return {
    action: "lab_join_failed",
    actor: { type: "user", id: actor.id },
    outcome,
    reason,
    ...(where.labId ? { target: { type: "lab", id: where.labId } } : {}),
    ...(where.simulationId ? { metadata: { simulation_id: where.simulationId } } : {}),
  };
}

/** Charges one attempt to every key, each in its own statement outside any transaction. */
async function charge(db: Kysely<DB>, keys: readonly LimitKey[], ctx: JoinContext) {
  const charges: Charge[] = [];
  for (const key of keys) {
    const keyHash = ctx.key.attemptHash(limitKeyText(key));
    const attempts = await chargeAttempt(db, keyHash, ctx.now, ctx.limits.windowMs);
    charges.push({ key, keyHash, attempts });
  }
  return charges;
}

async function refund(db: Kysely<DB>, charges: readonly Charge[], ctx: JoinContext) {
  for (const each of charges) await refundAttempt(db, each.keyHash, ctx.now, ctx.limits.windowMs);
}

/**
 * Logs the moment a key goes over its limit, once per key and window: later attempts in the same
 * window are refused without a line, so a guesser cannot flood the log (#49, review L3). Called
 * for a charged attempt only: a join refunds its charge, so logging it would repeat (F1).
 */
async function logLimitReached(
  db: Kysely<DB>,
  actor: SimulationActor,
  charges: readonly Charge[],
  limits: JoinLimits,
): Promise<void> {
  for (const reached of charges.filter((each) => justOverLimit(each, limits))) {
    await recordAudit(db, failedJoin(actor, "refused", `rate_limited_${reached.key.kind}`));
  }
}

/**
 * Returns whether this is the first time `text` is seen in the current window, counted under its
 * keyed hash in `lab_join_attempts` in one atomic statement. A refunded `in_other_lab` attempt is
 * never limited, so its activity-log row is written once per student, lab and window (#323; ASVS
 * V2.4.1, the Logging cheat sheet: logging must not be a way to use up storage).
 */
async function firstInWindow(db: Kysely<DB>, text: string, ctx: JoinContext): Promise<boolean> {
  const keyHash = ctx.key.attemptHash(text);
  return (await chargeAttempt(db, keyHash, ctx.now, ctx.limits.windowMs)) === 1;
}

/** Returns whether the role set is exactly {student}: only such an account joins a lab (S10). */
function onlyStudent(actor: SimulationActor): boolean {
  return actor.roles.length === 1 && actor.roles[0] === "student";
}

/**
 * Joins the student to the lab whose code they typed (S10). An account whose role set is not
 * exactly {student} is `not_a_student`. Every attempt is charged first: a student over their
 * limit is `rate_limited` without a lookup; an address over its limit still joins with a valid
 * code (owner decision on the review of #119) and is `rate_limited` otherwise. A student in
 * another lab of the simulation is `in_other_lab`. Every other code that does not work is
 * `invalid_code`, logged with its real reason. A join and `in_other_lab` refund the charge.
 */
export async function joinLabWithCode(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { code: string },
  ctx: JoinContext,
): Promise<SimulationResult<JoinOutcome>> {
  if (!onlyStudent(actor)) {
    await recordAudit(db, failedJoin(actor, "refused", "not_a_student"));
    return refused("not_a_student");
  }
  const keys: LimitKey[] = [{ kind: "user", id: actor.id }];
  // NOTE: #49; with no trusted proxy there is no client IP, and only the per-student limit
  // applies, so one shared bucket cannot lock a whole school out.
  if (ctx.clientIp !== null) keys.push({ kind: "ip", address: ctx.clientIp });
  const charges = await charge(db, keys, ctx);
  const userOver = charges.some((each) => each.key.kind === "user" && overLimit(each, ctx.limits));
  if (userOver) {
    await logLimitReached(db, actor, charges, ctx.limits);
    return refused("rate_limited");
  }
  const code = normalizeJoinCode(input.code);
  const result: Attempt = code
    ? await attempt(db, actor, code, ctx)
    : { ok: false, reason: "malformed_code", labId: null, simulationId: null };
  if (result.ok) {
    await refund(db, charges, ctx);
    return done(result.value);
  }
  if (result.reason === "in_other_lab") {
    // NOTE: S10 (#288); the code worked, so the attempt is no guess and costs nothing.
    await refund(db, charges, ctx);
    if (await firstInWindow(db, `in_other_lab:${actor.id}:${result.labId ?? ""}`, ctx)) {
      await recordAudit(db, failedJoin(actor, "refused", result.reason, result));
    }
    return refused("in_other_lab");
  }
  await recordAudit(db, failedJoin(actor, "failure", result.reason, result));
  await logLimitReached(db, actor, charges, ctx.limits);
  const ipOver = charges.some((each) => overLimit(each, ctx.limits));
  return refused(ipOver ? "rate_limited" : "invalid_code");
}
