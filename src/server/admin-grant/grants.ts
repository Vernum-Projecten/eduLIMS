// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Break-glass administrator grants from the host (#48): `pnpm admin:grant <email>` gives an
// existing user the local admin role, or records a pending grant for an email that has not
// signed in yet, bound to one provider whose email is authoritative and applied at that email's
// first sign-in through it. `pnpm admin:revoke` takes the role away, never from the last
// administrator. Every change writes the activity log with actor `system`, in its transaction.
// Relative imports: the host CLI loads this in plain Node.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { LOCAL_ROLE_SOURCE } from "../../lib/role-source.ts";
import { formatRoles, type Role, validateRoleSet, validateRoleValue } from "../../lib/roles.ts";
import { auditProvider } from "../audit/events.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";

/** How long a pending grant waits for its first sign-in (owner decision on #46/#48). */
export const PENDING_GRANT_TTL_MS = 24 * 60 * 60 * 1000;

/** The outcome of a grant or a revocation. */
export type GrantResult =
  | { ok: true; kind: "granted" | "already_admin" | "pending" | "revoked" | "not_admin" }
  | {
      ok: false;
      error:
        | "role_conflict"
        | "email_unverified"
        | "provider_required"
        | "provider_unknown"
        | "provider_not_authoritative"
        | "last_admin"
        | "not_found";
    };

function rolesOf(value: unknown): Role[] {
  const result = validateRoleValue(value);
  return result.ok ? result.roles : [];
}

/**
 * Grants the admin role to the user with `email` as a local role set, or records a pending
 * grant through `providerId` when no such user exists yet. A user whose email no provider
 * verified is refused with `email_unverified`.
 */
export async function grantAdmin(
  db: Kysely<DB>,
  input: { email: string; providerId?: string | undefined; now: Date },
): Promise<GrantResult> {
  const email = input.email.trim().toLowerCase();
  return db.transaction().execute(async (trx): Promise<GrantResult> => {
    const user = await trx
      .selectFrom("user")
      .select(["id", "role", "emailVerified"])
      .where("email", "=", email)
      .forUpdate()
      .executeTakeFirst();
    if (user) {
      // NOTE: ASVS V6.8.1; an address no provider vouched for may belong to someone else.
      if (!user.emailVerified) return { ok: false, error: "email_unverified" };
      const current = rolesOf(user.role);
      if (current.includes("admin")) return { ok: true, kind: "already_admin" };
      const next = validateRoleSet([...current, "admin"]);
      if (!next.ok) return { ok: false, error: "role_conflict" };
      const role = formatRoles(next.roles);
      await trx
        .updateTable("user")
        .set({ role, role_source: LOCAL_ROLE_SOURCE, updatedAt: input.now })
        .where("id", "=", user.id)
        .execute();
      await recordAudit(trx, {
        action: "authz_role_change",
        actor: { type: "system" },
        outcome: "success",
        target: { type: "user", id: user.id },
        reason: "admin_grant",
        metadata: {
          roles: role,
          ...(current.length > 0 ? { previous_roles: formatRoles(current) } : {}),
        },
      });
      return { ok: true, kind: "granted" };
    }
    if (!input.providerId) return { ok: false, error: "provider_required" };
    const provider = await trx
      .selectFrom("identity_provider")
      .select(["email_authoritative"])
      .where("provider_id", "=", input.providerId)
      .executeTakeFirst();
    if (!provider) return { ok: false, error: "provider_unknown" };
    if (!provider.email_authoritative) return { ok: false, error: "provider_not_authoritative" };
    await trx.deleteFrom("pending_admin_grant").where("email", "=", email).execute();
    const grant = await trx
      .insertInto("pending_admin_grant")
      .values({
        email,
        provider_id: input.providerId,
        created_at: input.now,
        expires_at: new Date(input.now.getTime() + PENDING_GRANT_TTL_MS),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      action: "admin_grant_created",
      actor: { type: "system" },
      outcome: "success",
      target: { type: "admin_grant", id: grant.id },
      metadata: { provider_id: input.providerId },
    });
    return { ok: true, kind: "pending" };
  });
}

/**
 * Takes the admin role from the user with `email` (their other roles stay, as a local set) and
 * drops a pending grant for it. The last administrator keeps the role.
 */
export async function revokeAdmin(
  db: Kysely<DB>,
  input: { email: string; now: Date },
): Promise<GrantResult> {
  const email = input.email.trim().toLowerCase();
  return db.transaction().execute(async (trx): Promise<GrantResult> => {
    const pending = await trx
      .deleteFrom("pending_admin_grant")
      .where("email", "=", email)
      .returning(["id", "provider_id"])
      .executeTakeFirst();
    if (pending) {
      await recordAudit(trx, {
        action: "admin_grant_revoked",
        actor: { type: "system" },
        outcome: "success",
        target: { type: "admin_grant", id: pending.id },
        metadata: { provider_id: pending.provider_id },
      });
    }
    const user = await trx
      .selectFrom("user")
      .select(["id", "role"])
      .where("email", "=", email)
      .forUpdate()
      .executeTakeFirst();
    if (!user) return pending ? { ok: true, kind: "revoked" } : { ok: false, error: "not_found" };
    const current = rolesOf(user.role);
    if (!current.includes("admin")) return { ok: true, kind: pending ? "revoked" : "not_admin" };
    const admins = await trx
      .selectFrom("user")
      .select("id")
      .where((eb) => eb.or([eb("role", "=", "admin"), eb("role", "=", "teacher,admin")]))
      .execute();
    if (admins.length <= 1) return { ok: false, error: "last_admin" };
    const rest = current.filter((role) => role !== "admin");
    const role = rest.length > 0 ? formatRoles(rest) : null;
    await trx
      .updateTable("user")
      .set({ role, role_source: LOCAL_ROLE_SOURCE, updatedAt: input.now })
      .where("id", "=", user.id)
      .execute();
    await trx.deleteFrom("session").where("userId", "=", user.id).execute();
    await recordAudit(trx, {
      action: "authz_role_change",
      actor: { type: "system" },
      outcome: "success",
      target: { type: "user", id: user.id },
      reason: "admin_revoke",
      metadata: { ...(role ? { roles: role } : {}), previous_roles: formatRoles(current) },
    });
    return { ok: true, kind: "revoked" };
  });
}

/**
 * Consumes the pending grant of `email` through `providerId`, when one exists and has not
 * expired, and records `admin_grant_applied`. Returns whether a grant was applied.
 */
export async function consumePendingAdminGrant(
  db: Kysely<DB>,
  input: { email: string; providerId: string; now: Date },
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const grant = await trx
      .deleteFrom("pending_admin_grant")
      .where("email", "=", input.email.trim().toLowerCase())
      .where("provider_id", "=", input.providerId)
      .where("expires_at", ">", input.now)
      .returning("id")
      .executeTakeFirst();
    if (!grant) return false;
    const provider = auditProvider(input.providerId);
    await recordAudit(trx, {
      action: "admin_grant_applied",
      actor: { type: "system" },
      outcome: "success",
      target: { type: "admin_grant", id: grant.id },
      ...(provider ? { provider } : {}),
      metadata: { provider_id: input.providerId },
    });
    return true;
  });
}

/** Deletes expired pending grants (`pnpm db:prune`); returns how many. */
export async function pruneExpiredGrants(db: Kysely<DB>, now: Date): Promise<number> {
  const result = await db
    .deleteFrom("pending_admin_grant")
    .where("expires_at", "<=", now)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
