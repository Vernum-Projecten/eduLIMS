// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The student's side of the class join code (#49): the fallback for a student who signs in with
// another address than the invited one (owner decision on #28). The code is the proof, so no
// verified email is needed. A wrong, expired, used-up or archived code, and a student the teacher
// removed, read the same to the student, so an answer never tells whether a class exists; wrong
// codes are rate-limited (ASVS V2.4.1, V6.3.1, join-limits.ts) and logged (V16.3.1).
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { normalizeJoinCode } from "../../lib/join-code.ts";
import type { AuditEvent } from "../audit/events.ts";
import { recordAudit } from "../audit/record.ts";
import { hasRole } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { type ClassActor, type ClassResult, done, refused } from "./access.ts";
import { addMember } from "./classes.ts";
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

/** What a join did: the class joined, or the student was in it already. */
export interface JoinOutcome {
  status: "joined" | "already_member";
  className: string;
  academicYear: string;
}

/** Why a code did not work, for the activity log only; the student sees one message. */
export type JoinFailure =
  | "malformed_code"
  | "unknown_code"
  | "code_expired"
  | "code_used_up"
  | "class_archived"
  | "removed";

/** What a join needs besides the code: the clock, the client IP, the key and the limits. */
export interface JoinContext {
  now: Date;
  /** The client IP through the trusted proxies (`clientIpOf`), or `null` when none is trusted. */
  clientIp: string | null;
  key: JoinCodeKey;
  limits: JoinLimits;
}

type Attempt =
  | { ok: true; value: JoinOutcome }
  | { ok: false; reason: JoinFailure; classId: string | null };

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
 * Looks the code up and joins. The first read takes no lock; the transaction then locks the class
 * (`FOR SHARE`) before the code row (`FOR UPDATE NOWAIT`), the order every class write uses, and
 * checks the hash, the archive state and the uses again, so a parallel archive, new code or join
 * is seen. A locked code row ends the transaction, which lets the class go, and the join tries
 * again: a join never waits on the code row while it holds the class, so it cannot deadlock with
 * a writer that takes the two the other way round (review of #119, F3).
 */
async function attempt(
  db: Kysely<DB>,
  actor: ClassActor,
  code: string,
  ctx: JoinContext,
): Promise<Attempt> {
  const codeHash = ctx.key.hash(code);
  const found = await db
    .selectFrom("class_join_codes")
    .select("organization_id")
    .where("code_hash", "=", codeHash)
    .executeTakeFirst();
  if (!found) return { ok: false, reason: "unknown_code", classId: null };
  for (let tries = 1; ; tries += 1) {
    try {
      return await lockedAttempt(db, actor, found.organization_id, codeHash, ctx, tries);
    } catch (error) {
      if (!(error instanceof CodeRowBusy)) throw error;
      await new Promise((resolve) => setTimeout(resolve, LOCK_PAUSE_MS * (1 + Math.random())));
    }
  }
}

async function lockedAttempt(
  db: Kysely<DB>,
  actor: ClassActor,
  classId: string,
  codeHash: string,
  ctx: JoinContext,
  tries: number,
): Promise<Attempt> {
  return db.transaction().execute(async (trx): Promise<Attempt> => {
    const fail = (reason: JoinFailure): Attempt => ({ ok: false, reason, classId });
    const klass = await trx
      .selectFrom("organization")
      .select(["id", "name", "academic_year", "archived_at"])
      .where("id", "=", classId)
      .forShare()
      .executeTakeFirst();
    const query = trx
      .selectFrom("class_join_codes")
      .select(["code_hash", "expires_at", "uses", "max_uses"])
      .where("organization_id", "=", classId)
      .forUpdate();
    // The last try waits its turn, so a long but live queue still ends in an answer.
    const row = await (tries < LOCK_TRIES ? query.noWait() : query)
      .executeTakeFirst()
      .catch((error: unknown) => {
        if (isLockNotAvailable(error))
          throw new CodeRowBusy("join code row locked", { cause: error });
        throw error;
      });
    if (!klass || !row || row.code_hash !== codeHash) return fail("unknown_code");
    if (klass.archived_at !== null) return fail("class_archived");
    if (row.expires_at <= ctx.now) return fail("code_expired");
    if (await wasRemoved(trx, classId, actor.id)) return fail("removed");
    const outcome = { className: klass.name, academicYear: klass.academic_year };
    const member = await trx
      .selectFrom("member")
      .select("role")
      .where("organizationId", "=", classId)
      .where("userId", "=", actor.id)
      .executeTakeFirst();
    // NOTE: #49; an existing member costs no use and is told so, even after the uses ran out.
    if (member) return { ok: true, value: { status: "already_member", ...outcome } };
    if (row.uses >= row.max_uses) return fail("code_used_up");
    await addMember(trx, classId, actor.id, "student", ctx.now);
    await trx
      .updateTable("class_join_codes")
      .set((eb) => ({ uses: eb("uses", "+", 1) }))
      .where("organization_id", "=", classId)
      .execute();
    await recordAudit(trx, {
      action: "class_joined",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "class", id: classId },
      metadata: { class_role: "student" },
    });
    return { ok: true, value: { status: "joined", ...outcome } };
  });
}

function failedJoin(
  actor: ClassActor,
  outcome: "failure" | "refused",
  reason: string,
  classId: string | null,
): AuditEvent {
  return {
    action: "class_join_failed",
    actor: { type: "user", id: actor.id },
    outcome,
    reason,
    ...(classId ? { target: { type: "class", id: classId } } : {}),
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

/**
 * Logs the moment a key goes over its limit, once per key and window: later attempts in the same
 * window are refused without a line, so a guesser cannot flood the log (#49, review L3). Called
 * for a refused attempt only: a join refunds its charge, so logging it would repeat (F1).
 */
async function logLimitReached(
  db: Kysely<DB>,
  actor: ClassActor,
  charges: readonly Charge[],
  limits: JoinLimits,
): Promise<void> {
  for (const reached of charges.filter((each) => justOverLimit(each, limits))) {
    await recordAudit(db, failedJoin(actor, "refused", `rate_limited_${reached.key.kind}`, null));
  }
}

/**
 * Joins the student to the class whose code they typed, as a `student` member. A teacher or an
 * administrator is `not_a_student`. Every attempt is charged first: a student over their limit is
 * `rate_limited` without a lookup; an address over its limit still joins with a valid code (owner
 * decision on the review of #119) and is `rate_limited` otherwise. Every other code that does not
 * work is `invalid_code`, logged with its real reason. A join refunds its charge.
 */
export async function joinClassWithCode(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { code: string },
  ctx: JoinContext,
): Promise<ClassResult<JoinOutcome>> {
  if (!hasRole(actor, "student")) {
    await recordAudit(db, failedJoin(actor, "refused", "not_a_student", null));
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
    : { ok: false, reason: "malformed_code", classId: null };
  if (result.ok) {
    for (const each of charges) await refundAttempt(db, each.keyHash, ctx.now, ctx.limits.windowMs);
    return done(result.value);
  }
  await recordAudit(db, failedJoin(actor, "failure", result.reason, result.classId));
  await logLimitReached(db, actor, charges, ctx.limits);
  const ipOver = charges.some((each) => overLimit(each, ctx.limits));
  return refused(ipOver ? "rate_limited" : "invalid_code");
}
