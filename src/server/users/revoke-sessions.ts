// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Ending a user's sessions when they lose a role (maintainer decision on #345): the local role
// edit and `admin revoke` both do it, in the transaction of the change, with a log row each.
// Relative imports: the host CLI loads this in plain Node.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { AuditActor } from "../audit/events.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";

/** The reason code of a session ended because its user lost a role. */
export const ROLES_CHANGED = "roles_changed" as const;

/**
 * Deletes every session of `userId` and records a `session_revoked` row for each, in id order,
 * with `actor` and the reason `roles_changed` (B4).
 */
export async function revokeSessionsForRoleChange(
  trx: Kysely<DB>,
  userId: string,
  actor: AuditActor,
): Promise<void> {
  const sessions = await trx
    .deleteFrom("session")
    .where("userId", "=", userId)
    .returning("id")
    .execute();
  for (const session of sessions.toSorted((a, b) => a.id.localeCompare(b.id))) {
    await recordAudit(trx, {
      action: "session_revoked",
      actor,
      outcome: "success",
      target: { type: "session", id: session.id },
      reason: ROLES_CHANGED,
    });
  }
}
