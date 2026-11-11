// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditEvent } from "./audit/events.ts";
import {
  auditLogLevel,
  formatSecurityLine,
  logAuditEvent,
  logAuthzFailure,
  logSecurityEvent,
  REDACTED,
  SECURITY_LOG_FIELDS,
  setSecurityLogWriter,
} from "./security-log.ts";

let restore: (() => void) | undefined;

afterEach(() => {
  vi.useRealTimers();
  restore?.();
  restore = undefined;
  vi.restoreAllMocks();
});

/** Captures every line the security log writes during a test. */
function capture(): string[] {
  const lines: string[] = [];
  restore = setSecurityLogWriter((line) => lines.push(line));
  return lines;
}

function parse(line: string | undefined): Record<string, unknown> {
  const parsed: unknown = JSON.parse(line ?? "null");
  if (typeof parsed !== "object" || parsed === null) throw new Error("not a JSON object");
  return Object.fromEntries(Object.entries(parsed));
}

const ENVELOPE = ["time", "level", "app", "log", "event"];
const NOW = new Date("2026-11-11T09:30:00.000Z");

describe("formatSecurityLine (ASVS V16.2.4, V16.4.1)", () => {
  it("writes one JSON object on one line, with a UTC timestamp", () => {
    const line = formatSecurityLine("info", "authn_logout", { actor_id: "u1" }, NOW);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(parse(line)).toEqual({
      time: "2026-11-11T09:30:00.000Z",
      level: "info",
      app: "edulims",
      log: "security",
      event: "authn_logout",
      actor_id: "u1",
    });
  });

  it("keeps a forged line break inside its value (log injection)", () => {
    const line = formatSecurityLine("warn", 'authz_fail\n{"event":"forged"}', {}, NOW);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(parse(line)["event"]).toBe(REDACTED);
  });

  it("redacts a value shaped like an e-mail address or a name (V16.2.5)", () => {
    const line = formatSecurityLine(
      "warn",
      "authz_fail",
      { actor_id: "student@example.test", reason: "Test Student", target_id: "u2" },
      NOW,
    );
    expect(parse(line)).toMatchObject({ actor_id: REDACTED, reason: REDACTED, target_id: "u2" });
    expect(line).not.toMatch(/example\.test|Test Student/);
  });

  it("drops a key outside the allowlist", () => {
    const fields: Record<string, string> = { email: "student@example.test", actor_id: "u1" };
    const line = formatSecurityLine("info", "authn_logout", fields, NOW);
    expect(Object.keys(parse(line))).toEqual([...ENVELOPE, "actor_id"]);
  });

  it("redacts a number that is not finite", () => {
    expect(parse(formatSecurityLine("info", "x", { status: Number.NaN }, NOW))["status"]).toBe(
      REDACTED,
    );
  });
});

describe("logAuditEvent (B4, ASVS V16.2.5)", () => {
  it("logs an audit event with ids and codes only, never personal data", () => {
    // A clock whose timestamp contains "7.5", the smuggled grade, as it did in a CI run.
    vi.useFakeTimers({ now: new Date("2026-11-11T22:32:37.550Z") });
    const lines = capture();
    // A crafted event that smuggles personal data beside the typed fields.
    const smuggled = {
      action: "authz_role_change",
      actor: { type: "user", id: "a1", name: "Test Admin", email: "admin@example.test" },
      outcome: "success",
      target: { type: "user", id: "u1", email: "student@example.test" },
      requestId: "req-1",
      metadata: { roles: "teacher", previous_roles: "student" },
      name: "Test Student",
      email: "student@example.test",
      token: "secret-token",
      grade: 7.5,
    };
    const event: AuditEvent = {
      action: "authz_role_change",
      actor: { type: "user", id: "a1" },
      outcome: "success",
      target: { type: "user", id: "u1" },
    };
    logAuditEvent(Object.assign(event, smuggled));
    expect(lines).toHaveLength(1);
    const line = parse(lines[0]);
    const allowed: readonly string[] = [...ENVELOPE, ...SECURITY_LOG_FIELDS];
    expect(Object.keys(line).every((key) => allowed.includes(key))).toBe(true);
    expect(line).toMatchObject({
      event: "authz_role_change",
      level: "info",
      outcome: "success",
      actor_type: "user",
      actor_id: "a1",
      target_type: "user",
      target_id: "u1",
      request_id: "req-1",
      roles: "teacher",
      previous_roles: "student",
    });
    // The timestamp is left out: a time such as 22:32:37.550Z contains "7.5" by chance.
    const { time: _time, ...withoutTime } = line;
    expect(JSON.stringify(withoutTime)).not.toMatch(
      /example\.test|Test (Admin|Student)|secret-token|7\.5|name|email/,
    );
  });

  it("leaves out the actor id of a system or anonymous actor", () => {
    const lines = capture();
    logAuditEvent({ action: "session_expired", actor: { type: "system" }, outcome: "success" });
    expect(parse(lines[0])).not.toHaveProperty("actor_id");
    expect(parse(lines[0])).toMatchObject({ actor_type: "system" });
  });

  it("logs a retention prune with its counts only (B4, #65)", () => {
    const lines = capture();
    logAuditEvent({
      action: "sys_retention_prune",
      actor: { type: "system" },
      outcome: "success",
      metadata: { removed_audit_events: 3, removed_sessions: 2, removed_admin_grants: 0 },
    });
    const line = parse(lines[0]);
    expect(Object.keys(line).sort()).toEqual(
      [
        ...ENVELOPE,
        "outcome",
        "actor_type",
        "removed_audit_events",
        "removed_sessions",
        "removed_admin_grants",
      ].sort(),
    );
    expect(line).toMatchObject({
      level: "info",
      event: "sys_retention_prune",
      actor_type: "system",
      removed_audit_events: 3,
      removed_sessions: 2,
      removed_admin_grants: 0,
    });
  });

  it("logs an analyser change with its id and new status only (B3, #35)", () => {
    const lines = capture();
    logAuditEvent({
      action: "analyser_retired",
      actor: { type: "user", id: "a1" },
      outcome: "success",
      target: { type: "analyser", id: "01900000-0000-7000-8000-000000000001" },
      metadata: { analyser_status: "retired" },
    });
    const line = parse(lines[0]);
    expect(Object.keys(line).sort()).toEqual(
      [
        ...ENVELOPE,
        "outcome",
        "actor_type",
        "actor_id",
        "target_type",
        "target_id",
        "analyser_status",
      ].sort(),
    );
    expect(line).toMatchObject({
      event: "analyser_retired",
      target_type: "analyser",
      target_id: "01900000-0000-7000-8000-000000000001",
      analyser_status: "retired",
    });
  });

  it("logs a failed retention prune as an error with its reason code (#65)", () => {
    const lines = capture();
    logAuditEvent({
      action: "sys_retention_prune",
      actor: { type: "system" },
      outcome: "failure",
      reason: "prune_failed",
    });
    expect(parse(lines[0])).toMatchObject({
      level: "error",
      event: "sys_retention_prune",
      outcome: "failure",
      reason: "prune_failed",
    });
  });

  it("chooses the level from the outcome", () => {
    const base = { actor: { type: "anonymous" } } as const;
    expect(auditLogLevel({ ...base, action: "authn_login_fail", outcome: "failure" })).toBe("warn");
    expect(auditLogLevel({ ...base, action: "user_banned", outcome: "failure" })).toBe("error");
    expect(auditLogLevel({ ...base, action: "user_banned", outcome: "refused" })).toBe("warn");
    expect(auditLogLevel({ ...base, action: "user_banned", outcome: "success" })).toBe("info");
  });
});

describe("logAuthzFailure (ASVS V16.3.2)", () => {
  it("logs a 403 with the user id, the needed roles and the request id", () => {
    const lines = capture();
    logAuthzFailure(new Headers({ "x-request-id": "req-7" }), 403, "u1", ["admin", "teacher"]);
    expect(parse(lines[0])).toMatchObject({
      event: "authz_fail",
      level: "warn",
      outcome: "refused",
      actor_type: "user",
      actor_id: "u1",
      reason: "missing_role",
      status: 403,
      required_roles: "teacher,admin",
      request_id: "req-7",
    });
  });

  it("logs a 401 as anonymous and drops a request id of the wrong shape", () => {
    const lines = capture();
    logAuthzFailure(new Headers({ "x-request-id": "bad id with spaces" }), 401);
    const line = parse(lines[0]);
    expect(line).toMatchObject({ actor_type: "anonymous", reason: "not_signed_in", status: 401 });
    expect(line).not.toHaveProperty("request_id");
    expect(line).not.toHaveProperty("required_roles");
  });
});

describe("the default writer", () => {
  it("writes to stdout", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    logSecurityEvent("info", "authn_logout", {});
    expect(write).toHaveBeenCalledWith(expect.stringMatching(/"event":"authn_logout"}\n$/));
  });
});
