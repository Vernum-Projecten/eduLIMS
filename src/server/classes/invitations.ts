// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Invitations without email (#28): a class owner or co-teacher invites addresses as students,
// the owner as co-teachers too. Nothing is sent; the person joins on sign-in (acceptance.ts).
// A list is previewed first: invalid, duplicate, already-member, already-invited and
// wrong-role rows are reported and never created.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { z } from "zod";
import { type InvitationRole, memberPermission } from "../../lib/classes.ts";
import { validateRoleValue } from "../../lib/roles.ts";
import { recordAudit } from "../audit/record.ts";
import { newId, UUID_PATTERN } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { appRoleFits } from "./acceptance.ts";
import { type ClassActor, type ClassResult, done, refused, withClass } from "./access.ts";
import { INVITATION_LIFETIME_SECONDS } from "./plugin.ts";
import { clearRemovalsOfAddresses } from "./removals.ts";

/** How one address of a list fares; only `new` rows become invitations. */
export const INVITE_ROW_STATUSES = [
  "new",
  "invalid",
  "duplicate",
  "member",
  "invited",
  "not_a_teacher",
] as const;
export type InviteRowStatus = (typeof INVITE_ROW_STATUSES)[number];

/** One row of the preview, in the order of the list. */
export interface InviteRow {
  email: string;
  status: InviteRowStatus;
}

/** The result of creating a list of invitations. */
export interface InviteOutcome {
  created: number;
  rows: InviteRow[];
}

const address = z.email();

/** Returns the expiry of an invitation created or resent at `now` (30 days, #28 (4)). */
export function invitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_LIFETIME_SECONDS * 1000);
}

/** Classifies the addresses of a list against the class, read inside the caller's transaction. */
export async function classifyInvitees(
  trx: Kysely<DB>,
  classId: string,
  role: InvitationRole,
  emails: readonly string[],
  now: Date,
): Promise<InviteRow[]> {
  const normalized = emails.map((email) => email.trim().toLowerCase());
  const valid = [...new Set(normalized.filter((email) => address.safeParse(email).success))];
  const [users, members, pending] = valid.length
    ? await Promise.all([
        trx.selectFrom("user").select(["email", "role"]).where("email", "in", valid).execute(),
        trx
          .selectFrom("member")
          .innerJoin("user", "user.id", "member.userId")
          .select("user.email")
          .where("member.organizationId", "=", classId)
          .where("user.email", "in", valid)
          .execute(),
        trx
          .selectFrom("invitation")
          .select("email")
          .where("organizationId", "=", classId)
          .where("status", "=", "pending")
          .where("expiresAt", ">", now)
          .where("email", "in", valid)
          .execute(),
      ])
    : [[], [], []];
  const roleOf = new Map(users.map((user) => [user.email.toLowerCase(), user.role]));
  const memberSet = new Set(members.map((member) => member.email.toLowerCase()));
  const invitedSet = new Set(pending.map((invitation) => invitation.email));
  const seen = new Set<string>();
  return normalized.map((email): InviteRow => {
    if (!address.safeParse(email).success) return { email, status: "invalid" };
    if (seen.has(email)) return { email, status: "duplicate" };
    seen.add(email);
    if (memberSet.has(email)) return { email, status: "member" };
    if (invitedSet.has(email)) return { email, status: "invited" };
    // NOTE: owner decision on #28 (security review); a student row never says whether an
    // account exists or what it holds: acceptance skips an account that does not fit.
    if (role === "student") return { email, status: "new" };
    const stored = roleOf.has(email) ? roleOf.get(email) : undefined;
    // An invitation never grants teacher; a missing and a non-teacher account read the same.
    return { email, status: inviteeFits(role, stored) ? "new" : "not_a_teacher" };
  });
}

/**
 * Returns whether an address may be invited with `role`, from the stored app role of its
 * account (`undefined` when no account exists). A student needs the app role student or no
 * account yet, since the invitation grants `student` at the first sign-in (#28 (2)). A
 * co-teacher needs an account whose app roles include teacher: an invitation never grants it.
 */
export function inviteeFits(role: InvitationRole, storedRole: string | null | undefined): boolean {
  if (storedRole === undefined) return role === "student";
  const parsed = validateRoleValue(storedRole);
  return appRoleFits(role, parsed.ok ? parsed.roles : []);
}

/** The class check of inviting with `role`. */
function inviteCheck(classId: string, role: InvitationRole) {
  return {
    classId,
    permission: memberPermission(role, "invite"),
    action: "invitation_created",
  } as const;
}

/** Returns the preview of a list of invitations: nothing is created. */
export function previewInvitations(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; role: InvitationRole; emails: readonly string[] },
  now: Date,
): Promise<ClassResult<InviteRow[]>> {
  return withClass(db, actor, inviteCheck(input.classId, input.role), async (trx, locked) =>
    done(await classifyInvitees(trx, locked.id, input.role, input.emails, now)),
  );
}

/**
 * Creates an invitation for every `new` row of the list, in one transaction with an
 * `invitation_created` row each, and returns every row with its status. An expired pending
 * invitation for the same address is ended first, so the address gets a fresh one.
 */
export function createInvitations(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; role: InvitationRole; emails: readonly string[] },
  now: Date,
): Promise<ClassResult<InviteOutcome>> {
  return withClass(db, actor, inviteCheck(input.classId, input.role), async (trx, locked) => {
    const rows = await classifyInvitees(trx, locked.id, input.role, input.emails, now);
    const fresh = rows.filter((row) => row.status === "new").map((row) => row.email);
    if (fresh.length > 0) {
      await trx
        .updateTable("invitation")
        .set({ status: "canceled", ended_at: now })
        .where("organizationId", "=", locked.id)
        .where("status", "=", "pending")
        .where("email", "in", fresh)
        .execute();
    }
    // NOTE: #49 (security review of #119); a new invitation lets a removed student back in.
    if (input.role === "student") await clearRemovalsOfAddresses(trx, locked.id, fresh);
    for (const email of fresh) {
      const id = newId();
      await trx
        .insertInto("invitation")
        .values({
          id,
          organizationId: locked.id,
          email,
          role: input.role,
          status: "pending",
          inviterId: actor.id,
          createdAt: now,
          expiresAt: invitationExpiry(now),
        })
        .execute();
      await recordAudit(trx, {
        action: "invitation_created",
        actor: { type: "user", id: actor.id },
        outcome: "success",
        target: { type: "invitation", id },
        metadata: { class_id: locked.id, class_role: input.role },
      });
    }
    return done({ created: fresh.length, rows });
  });
}

async function pendingInvitationRole(
  db: Kysely<DB>,
  classId: string,
  invitationId: string,
): Promise<InvitationRole | null> {
  if (!UUID_PATTERN.test(classId) || !UUID_PATTERN.test(invitationId)) return null;
  const row = await db
    .selectFrom("invitation")
    .select("role")
    .where("id", "=", invitationId)
    .where("organizationId", "=", classId)
    .where("status", "=", "pending")
    .executeTakeFirst();
  if (!row) return null;
  return row.role === "teacher" ? "teacher" : "student";
}

type InvitationChange = "resend" | "cancel";

async function changeInvitation(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; invitationId: string },
  change: InvitationChange,
  now: Date,
): Promise<ClassResult> {
  // The role decides the permission; it is read again under the class lock below.
  const role = await pendingInvitationRole(db, input.classId, input.invitationId);
  const action = change === "resend" ? "invitation_resent" : "invitation_revoked";
  const check = {
    classId: input.classId,
    permission: memberPermission(role ?? "student", "invite"),
    action,
  } as const;
  return withClass(db, actor, check, async (trx, locked) => {
    const current = await pendingInvitationRole(trx, locked.id, input.invitationId);
    if (current === null || role === null) return refused("invitation_not_found");
    if (current !== role) return refused("forbidden");
    await trx
      .updateTable("invitation")
      .set(
        change === "resend"
          ? { expiresAt: invitationExpiry(now) }
          : { status: "canceled", ended_at: now },
      )
      .where("id", "=", input.invitationId)
      .execute();
    await recordAudit(trx, {
      action,
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "invitation", id: input.invitationId },
      metadata: { class_id: locked.id, class_role: role },
    });
    return done(null);
  });
}

/** Gives a pending invitation, expired or not, a new 30-day term (#28). */
export function resendInvitation(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; invitationId: string },
  now: Date,
): Promise<ClassResult> {
  return changeInvitation(db, actor, input, "resend", now);
}

/** Cancels a pending invitation; the address can be invited again. */
export function cancelInvitation(
  db: Kysely<DB>,
  actor: ClassActor,
  input: { classId: string; invitationId: string },
  now: Date,
): Promise<ClassResult> {
  return changeInvitation(db, actor, input, "cancel", now);
}
