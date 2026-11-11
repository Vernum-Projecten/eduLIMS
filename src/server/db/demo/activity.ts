// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// About four weeks of activity-log events (B4) that agree with the demo people: their creation,
// sign-ins and sign-outs, failed and refused sign-ins, role changes, blocks and ended sessions.
// Ids and codes only, as recordAudit accepts them.
import type { AuditEvent } from "../../audit/events.ts";
import {
  DEMO_OIDC_PROVIDER,
  DEMO_SAML_PROVIDER,
  type DemoPeople,
  type DemoUser,
} from "./people.ts";
import type { DemoRandom } from "./random.ts";

const DAY = 86_400_000;
const MINUTE = 60_000;

/** The number of days of sign-in activity the plan covers. */
export const DEMO_ACTIVITY_DAYS = 28;

/** Sign-ins per week by kind of person. */
const SIGN_INS_PER_WEEK = { student: 3, teacher: 5, admin: 6, coordinator: 6 } as const;

function at(now: Date, daysAgo: number, random: DemoRandom): Date {
  const start = new Date(now.getTime() - daysAgo * DAY);
  start.setUTCHours(7, 0, 0, 0);
  return new Date(start.getTime() + random.int(0, 10 * 60) * MINUTE);
}

function requestId(random: DemoRandom): string {
  return `req-${random.hex(16)}`;
}

function userTarget(user: DemoUser) {
  return { type: "user" as const, id: user.id };
}

function signIns(random: DemoRandom, now: Date, users: readonly DemoUser[]): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (const user of users) {
    const perWeek = SIGN_INS_PER_WEEK[user.kind];
    for (let daysAgo = DEMO_ACTIVITY_DAYS; daysAgo >= 1; daysAgo -= 1) {
      if (user.ban && now.getTime() - daysAgo * DAY > user.ban.at.getTime()) break;
      if (!random.chance(perWeek / 7)) continue;
      const time = at(now, daysAgo, random);
      const common = { provider: user.provider, target: userTarget(user) };
      events.push({
        action: "authn_login_success",
        actor: { type: "user", id: user.id },
        outcome: "success",
        occurredAt: time,
        requestId: requestId(random),
        ...common,
      });
      if (random.chance(0.4)) {
        events.push({
          action: "authn_logout",
          actor: { type: "user", id: user.id },
          outcome: "success",
          occurredAt: new Date(time.getTime() + random.int(20, 180) * MINUTE),
          requestId: requestId(random),
          ...common,
        });
      }
    }
  }
  return events;
}

function failures(random: DemoRandom, now: Date, users: readonly DemoUser[]): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (let index = 0; index < 8; index += 1) {
    events.push({
      action: "authn_login_fail",
      actor: { type: "anonymous" },
      outcome: "failure",
      reason: random.pick(["access_denied", "state_not_found", "invalid_code"] as const),
      provider: random.pick([DEMO_OIDC_PROVIDER, DEMO_SAML_PROVIDER] as const),
      occurredAt: at(now, random.int(1, DEMO_ACTIVITY_DAYS), random),
      requestId: requestId(random),
    });
  }
  for (let index = 0; index < 3; index += 1) {
    events.push({
      action: "authn_login_fail",
      actor: { type: "anonymous" },
      outcome: "refused",
      reason: "no_edulims_role",
      provider: DEMO_OIDC_PROVIDER,
      occurredAt: at(now, random.int(1, DEMO_ACTIVITY_DAYS), random),
      requestId: requestId(random),
    });
  }
  const conflicted = users.find((user) => user.kind === "student" && !user.ban);
  if (conflicted) {
    events.push({
      action: "authn_login_fail",
      actor: { type: "anonymous" },
      outcome: "refused",
      reason: "role_conflict",
      provider: conflicted.provider,
      target: userTarget(conflicted),
      occurredAt: at(now, 12, random),
      requestId: requestId(random),
    });
  }
  for (const user of users) {
    if (!user.ban) continue;
    events.push({
      action: "authn_login_fail",
      actor: { type: "anonymous" },
      outcome: "failure",
      reason: "banned_user",
      provider: user.provider,
      occurredAt: new Date(user.ban.at.getTime() + 2 * DAY),
      requestId: requestId(random),
    });
  }
  return events;
}

function administration(random: DemoRandom, now: Date, people: DemoPeople): AuditEvent[] {
  const { users } = people;
  const admin = users.find((user) => user.kind === "admin");
  if (!admin) return [];
  const actor = { type: "user" as const, id: admin.id };
  const events: AuditEvent[] = users.map((user) => ({
    action: "user_created" as const,
    actor: { type: "system" as const },
    outcome: "success" as const,
    target: userTarget(user),
    provider: user.provider,
    occurredAt: user.createdAt,
    metadata: { roles: user.role },
  }));
  for (const coordinator of users.filter((user) => user.kind === "coordinator")) {
    events.push({
      action: "authz_role_change",
      actor,
      outcome: "success",
      target: userTarget(coordinator),
      occurredAt: at(now, 25, random),
      metadata: { roles: coordinator.role },
    });
  }
  const teacher = users.find((user) => user.kind === "teacher");
  if (teacher) {
    events.push({
      action: "authz_role_change",
      actor: { type: "system" },
      outcome: "success",
      target: userTarget(teacher),
      provider: teacher.provider,
      occurredAt: at(now, 18, random),
      metadata: { roles: teacher.role, previous_roles: "student" },
    });
  }
  events.push({
    action: "authz_role_change",
    actor,
    outcome: "refused",
    reason: "cannot_change_own_roles",
    target: userTarget(admin),
    occurredAt: at(now, 9, random),
  });
  for (const user of users) {
    if (!user.ban) continue;
    const { at: bannedAt, expires } = user.ban;
    events.push({
      action: "user_banned",
      actor,
      outcome: "success",
      target: userTarget(user),
      occurredAt: bannedAt,
      ...(expires ? { metadata: { ban_expires_at: expires.toISOString() } } : {}),
    });
    events.push({
      action: "session_revoked",
      actor,
      outcome: "success",
      reason: "user_banned",
      target: { type: "session", id: random.id() },
      occurredAt: new Date(bannedAt.getTime() + 1000),
    });
  }
  // A block that was lifted again.
  const lifted = users.filter((user) => user.kind === "student" && !user.ban).at(-1);
  if (lifted) {
    events.push(
      {
        action: "user_banned",
        actor,
        outcome: "success",
        target: userTarget(lifted),
        occurredAt: at(now, 16, random),
      },
      {
        action: "user_unbanned",
        actor,
        outcome: "success",
        target: userTarget(lifted),
        occurredAt: at(now, 14, random),
      },
    );
  }
  // Ended sessions are deleted, so their ids are not in the session table any more.
  for (let index = 0; index < 2; index += 1) {
    events.push({
      action: "session_revoked",
      actor,
      outcome: "success",
      target: { type: "session", id: random.id() },
      occurredAt: at(now, random.int(2, 6), random),
    });
  }
  return events;
}

/** Plans the demo activity log for the people of the demo set, oldest event first. */
export function planDemoActivity(random: DemoRandom, now: Date, people: DemoPeople): AuditEvent[] {
  const events = [
    ...administration(random, now, people),
    ...signIns(random, now, people.users),
    ...failures(random, now, people.users),
  ];
  const time = (event: AuditEvent) => event.occurredAt?.getTime() ?? now.getTime();
  return events.sort((a, b) => time(a) - time(b));
}
