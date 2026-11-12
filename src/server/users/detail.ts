// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The read of the user detail sheet (#34, B1): profile, roles and their source, linked
// accounts, live sessions, the block and the user's recent activity. No grades, results or
// submissions (R-01); no session token, IP address or provider token leaves the server.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { isLocallyEditable, parseRoleSource, type RoleSource } from "../../lib/role-source.ts";
import type { Role } from "../../lib/roles.ts";
import { parseSignInMethod, type SignInMethod } from "../../lib/sign-in-method.ts";
import { type DeviceSummary, summariseUserAgent } from "../../lib/user-agent.ts";
import type { AuditAction, AuditOutcome } from "../audit/events.ts";
import { parseLastPortal, sessionRoles } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { type Provisioning, provisioningOf, userStatus } from "./queries.ts";
import type { UserStatus } from "./schemas.ts";

/** How many activity-log events the sheet shows (#34). */
export const RECENT_ACTIVITY_LIMIT = 10;

/** One linked sign-in account, with the provider's subject shortened. */
export interface LinkedAccount {
  id: string;
  provider: SignInMethod | null;
  accountIdShort: string;
  linkedAt: string;
}

/** One live session; `current` marks the administrator's own session of this request. */
export interface UserSession {
  id: string;
  device: DeviceSummary;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/** One activity-log event about or by the user. */
export interface UserActivity {
  id: string;
  action: AuditAction | string;
  outcome: AuditOutcome | string;
  occurredAt: string;
  reason: string | null;
  /** Who acted: this user, another user, eduLIMS or someone not signed in. */
  actor: "self" | "user" | "system" | "anonymous";
}

/** Everything the user detail sheet shows. */
export interface UserDetail {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  lastSignInMethod: SignInMethod | null;
  locale: string | null;
  lastPortal: Role | null;
  roles: Role[];
  roleSource: RoleSource | null;
  /** Whether the viewer may edit the roles: a local set of another user (#32). */
  rolesEditable: boolean;
  /** Whether this is the viewer's own account. */
  self: boolean;
  status: UserStatus;
  /** The provisioning by an identity provider over SCIM (#45), or `null` for none. */
  provisioning: Provisioning | null;
  block: { reason: string | null; until: string | null } | null;
  accounts: LinkedAccount[];
  sessions: UserSession[];
  activity: UserActivity[];
  readAt: string;
}

/** Returns the provider's account id cut to its first and last four characters. */
export function shortenAccountId(accountId: string): string {
  return accountId.length <= 12 ? accountId : `${accountId.slice(0, 4)}…${accountId.slice(-4)}`;
}

/** The viewer of the sheet: their user id and the id of the session of this request. */
export interface Viewer {
  userId: string;
  sessionId: string | null;
}

/** Reads the detail of one user for an administrator, or `null` when there is no such user. */
export async function getUserDetail(
  db: Kysely<DB>,
  userId: string,
  viewer: Viewer,
  now: Date,
): Promise<UserDetail | null> {
  const user = await db
    .selectFrom("user")
    .select([
      "id",
      "name",
      "email",
      "createdAt",
      "role",
      "role_source",
      "locale",
      "last_portal",
      "last_sign_in_at",
      "last_login_method",
      "banned",
      "banReason",
      "banExpires",
      "provisioned_by",
      "deprovisioned_at",
    ])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!user) return null;

  const [accounts, sessions, events] = await Promise.all([
    db
      .selectFrom("account")
      .select(["id", "providerId", "accountId", "createdAt"])
      .where("userId", "=", userId)
      .orderBy("createdAt")
      .execute(),
    db
      .selectFrom("session")
      .select(["id", "userAgent", "createdAt", "expiresAt"])
      .where("userId", "=", userId)
      .where("expiresAt", ">", now)
      .orderBy("createdAt", "desc")
      .execute(),
    db
      .selectFrom("audit_event")
      .select(["id", "action", "outcome", "occurred_at", "reason_code", "actor_type", "actor_id"])
      .where((eb) =>
        eb.or([
          eb.and([eb("target_type", "=", "user"), eb("target_id", "=", userId)]),
          eb("actor_id", "=", userId),
        ]),
      )
      .orderBy("occurred_at", "desc")
      .orderBy("id", "desc")
      .limit(RECENT_ACTIVITY_LIMIT)
      .execute(),
  ]);

  const roleSource = parseRoleSource(user.role_source);
  const self = user.id === viewer.userId;
  const status = userStatus(
    { banned: user.banned, banExpires: user.banExpires, lastSignInAt: user.last_sign_in_at },
    now,
  );
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
    lastSignInAt: user.last_sign_in_at?.toISOString() ?? null,
    lastSignInMethod: parseSignInMethod(user.last_login_method),
    locale: user.locale,
    lastPortal: parseLastPortal(user.last_portal),
    roles: sessionRoles(user.role),
    roleSource,
    rolesEditable: isLocallyEditable(roleSource) && !self,
    self,
    status,
    provisioning: provisioningOf(user),
    block:
      status === "blocked"
        ? { reason: user.banReason, until: user.banExpires?.toISOString() ?? null }
        : null,
    accounts: accounts.map((account) => ({
      id: account.id,
      provider: parseSignInMethod(account.providerId),
      accountIdShort: shortenAccountId(account.accountId),
      linkedAt: account.createdAt.toISOString(),
    })),
    sessions: sessions.map((session) => ({
      id: session.id,
      device: summariseUserAgent(session.userAgent),
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: session.id === viewer.sessionId,
    })),
    activity: events.map((event) => ({
      id: event.id,
      action: event.action,
      outcome: event.outcome,
      occurredAt: event.occurred_at.toISOString(),
      reason: event.reason_code,
      actor:
        event.actor_type === "user"
          ? event.actor_id === userId
            ? "self"
            : "user"
          : event.actor_type === "system"
            ? "system"
            : "anonymous",
    })),
    readAt: now.toISOString(),
  };
}
