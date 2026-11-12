// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The student's side of the class join code (#49): the fallback for a student who signs in with
// another address than the invited one (owner decision on #28). The code is the proof, so no
// verified email is needed. A wrong, expired, used-up or archived code reads the same to the
// student, so an answer never tells whether a class exists; wrong codes are rate-limited
// (ASVS V2.4.1, V6.3.1) and logged (V16.3.1).
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { normalizeJoinCode } from "../../lib/join-code.ts";
import type { AuditEvent } from "../audit/events.ts";
import { recordAudit } from "../audit/record.ts";
import { hasRole } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { logSecurityEvent } from "../security-log.ts";
import { type ClassActor, type ClassResult, done, refused } from "./access.ts";
import { addMember } from "./classes.ts";
import type { JoinCodeHasher } from "./join-code.ts";
import type { JoinFailureLimiter, LimitKey } from "./join-limits.ts";

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
  | "class_archived";

/** What a join needs besides the code: the clock, the client IP and the limiter. */
export interface JoinContext {
  now: Date;
  /** The client IP as better-auth resolves it (`getIP`), or `null` when none can be trusted. */
  clientIp: string | null;
  hash: JoinCodeHasher;
  limiter: JoinFailureLimiter;
}

type Attempt =
  | { ok: true; value: JoinOutcome }
  | { ok: false; reason: JoinFailure; classId: string | null };

/** Looks the code up and joins, in one transaction that locks the code row. */
function attempt(db: Kysely<DB>, actor: ClassActor, code: string, ctx: JoinContext) {
  return db.transaction().execute(async (trx): Promise<Attempt> => {
    const row = await trx
      .selectFrom("class_join_codes")
      .innerJoin("organization", "organization.id", "class_join_codes.organization_id")
      .select([
        "organization.id",
        "organization.name",
        "organization.academic_year",
        "organization.archived_at",
        "class_join_codes.expires_at",
        "class_join_codes.uses",
        "class_join_codes.max_uses",
      ])
      .where("class_join_codes.code_hash", "=", ctx.hash(code))
      .forUpdate("class_join_codes")
      .executeTakeFirst();
    if (!row) return { ok: false, reason: "unknown_code", classId: null };
    const fail = (reason: JoinFailure): Attempt => ({ ok: false, reason, classId: row.id });
    if (row.archived_at !== null) return fail("class_archived");
    if (row.expires_at <= ctx.now) return fail("code_expired");
    const outcome = { className: row.name, academicYear: row.academic_year };
    const member = await trx
      .selectFrom("member")
      .select("role")
      .where("organizationId", "=", row.id)
      .where("userId", "=", actor.id)
      .executeTakeFirst();
    // NOTE: #49; an existing member costs no use and is told so, even after the uses ran out.
    if (member) return { ok: true, value: { status: "already_member", ...outcome } };
    if (row.uses >= row.max_uses) return fail("code_used_up");
    await addMember(trx, row.id, actor.id, "student", ctx.now);
    await trx
      .updateTable("class_join_codes")
      .set((eb) => ({ uses: eb("uses", "+", 1) }))
      .where("organization_id", "=", row.id)
      .execute();
    await recordAudit(trx, {
      action: "class_joined",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "class", id: row.id },
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

/**
 * Joins the student to the class whose code they typed, as a `student` member. A teacher or an
 * administrator is `not_a_student`; a key over its brute-force limit is `rate_limited`; every
 * code that does not work is `invalid_code`. Each failure is in the activity log with its
 * real reason, and the moment a key reaches its limit once more as `rate_limited`.
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
  // NOTE: #49; with no trustworthy client IP only the per-user limit applies, so one shared
  // "unknown" bucket cannot lock a whole school out.
  if (ctx.clientIp !== null) keys.push({ kind: "ip", address: ctx.clientIp });
  const now = ctx.now.getTime();
  if (ctx.limiter.blocked(keys, now)) {
    // The moment of blocking is in the activity log; each later attempt only on the stream.
    logSecurityEvent("warn", "class_join_failed", {
      outcome: "refused",
      actor_type: "user",
      actor_id: actor.id,
      reason: "rate_limited",
    });
    return refused("rate_limited");
  }
  const code = normalizeJoinCode(input.code);
  const result: Attempt = code
    ? await attempt(db, actor, code, ctx)
    : { ok: false, reason: "malformed_code", classId: null };
  if (result.ok) return done(result.value);
  await recordAudit(db, failedJoin(actor, "failure", result.reason, result.classId));
  if (ctx.limiter.fail(keys, now)) {
    await recordAudit(db, failedJoin(actor, "refused", "rate_limited", null));
  }
  return refused("invalid_code");
}
