// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Invitations without email (#28, owner decisions 2 and "no email"): a person joins every class
// that invited their verified email when they sign in, without an accept step. better-auth's own
// accept endpoint is unreachable (plugin.ts). Relative imports: auth.ts loads this in plain Node.
import type { Kysely } from "kysely";
import type { InvitationRole } from "../../lib/classes.ts";
import { type Role, validateRoleValue } from "../../lib/roles.ts";
import { recordAudit } from "../audit/record.ts";
import { newId } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { clearRemoval } from "./removals.ts";

/** Returns whether a person with app roles `roles` may hold the class role `role` (#28). */
export function appRoleFits(role: InvitationRole, roles: readonly Role[]): boolean {
  if (role === "teacher") return roles.includes("teacher");
  return roles.length === 1 && roles[0] === "student";
}

/**
 * Returns whether a pending, unexpired invitation as a student waits for `email` in a class that
 * is not archived: the one case in which an invitation grants the app role `student` (#28 (2)).
 */
export async function hasPendingStudentInvitation(
  db: Kysely<DB>,
  email: string,
  now: Date,
): Promise<boolean> {
  const row = await db
    .selectFrom("invitation")
    .innerJoin("organization", "organization.id", "invitation.organizationId")
    .select("invitation.id")
    .where("invitation.email", "=", email.trim().toLowerCase())
    .where("invitation.status", "=", "pending")
    .where("invitation.role", "=", "student")
    .where("invitation.expiresAt", ">", now)
    .where("organization.archived_at", "is", null)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/** What one sign-in's acceptance did. */
export interface AcceptanceResult {
  accepted: number;
  /** Invitations left pending because the app role does not fit the class role. */
  skipped: number;
}

/**
 * Accepts every pending, unexpired invitation for the verified email of `userId` in a class that
 * is not archived, in one transaction with an `invitation_accepted` row each. An unverified
 * email accepts nothing; an invitation whose class role the app role does not allow stays
 * pending, and an existing membership keeps its role.
 */
export async function acceptInvitationsOnSignIn(
  db: Kysely<DB>,
  userId: string,
  now: Date,
): Promise<AcceptanceResult> {
  return db.transaction().execute(async (trx) => {
    const user = await trx
      .selectFrom("user")
      .select(["email", "emailVerified", "role"])
      .where("id", "=", userId)
      .executeTakeFirst();
    if (!user?.emailVerified) return { accepted: 0, skipped: 0 };
    const parsed = validateRoleValue(user.role);
    const roles = parsed.ok ? parsed.roles : [];
    const email = user.email.trim().toLowerCase();
    // NOTE: no requirement governs this: our own design. Class rows first, in id order, as
    // withClass locks them, then the invitations, so the two never wait on each other in a cycle.
    await trx
      .selectFrom("organization")
      .innerJoin("invitation", "invitation.organizationId", "organization.id")
      .select("organization.id")
      .where("invitation.email", "=", email)
      .where("invitation.status", "=", "pending")
      .orderBy("organization.id")
      .forUpdate("organization")
      .execute();
    const pending = await trx
      .selectFrom("invitation")
      .innerJoin("organization", "organization.id", "invitation.organizationId")
      .select(["invitation.id", "invitation.organizationId", "invitation.role"])
      .where("invitation.email", "=", email)
      .where("invitation.status", "=", "pending")
      .where("invitation.expiresAt", ">", now)
      .where("organization.archived_at", "is", null)
      .orderBy("invitation.createdAt")
      .orderBy("invitation.id")
      .forUpdate("invitation")
      .execute();
    let accepted = 0;
    let skipped = 0;
    for (const invitation of pending) {
      const role = invitation.role === "teacher" ? "teacher" : "student";
      if (!appRoleFits(role, roles)) {
        skipped += 1;
        continue;
      }
      await trx
        .insertInto("member")
        .values({
          id: newId(),
          organizationId: invitation.organizationId,
          userId,
          role,
          createdAt: now,
        })
        .onConflict((oc) => oc.columns(["organizationId", "userId"]).doNothing())
        .execute();
      await clearRemoval(trx, invitation.organizationId, userId);
      await trx
        .updateTable("invitation")
        .set({ status: "accepted", ended_at: now })
        .where("id", "=", invitation.id)
        .execute();
      await recordAudit(trx, {
        action: "invitation_accepted",
        actor: { type: "user", id: userId },
        outcome: "success",
        target: { type: "invitation", id: invitation.id },
        metadata: { class_id: invitation.organizationId, class_role: role },
      });
      accepted += 1;
    }
    return { accepted, skipped };
  });
}
