// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { providerIdOf } from "../../lib/identity-providers.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { type AuditEvent, toReasonCode, toRequestId } from "./events.ts";
import {
  AuditEventInvalidError,
  AuditWriteError,
  recordAudit,
  recordCommittedAudit,
} from "./record.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await db?.destroy();
  db = undefined;
});

async function testDb() {
  db = await createTestDb();
  return db;
}

/** A database nobody listens on: every write fails, and a refused event never connects. */
function unreachableDb() {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: "postgres://nobody:none@127.0.0.1:9/none", max: 1 }),
    }),
  });
}

const LOGIN: AuditEvent = {
  action: "authn_login_success",
  actor: { type: "user", id: "u1" },
  outcome: "success",
  target: { type: "user", id: "u1" },
  provider: providerIdOf("keycloak"),
};

describe("recordAudit (B4)", () => {
  it("writes exactly one row with every field", async () => {
    const database = await testDb();
    const occurredAt = new Date("2026-10-01T08:00:00Z");
    await recordAudit(database, {
      ...LOGIN,
      requestId: "req-9",
      occurredAt,
      metadata: { roles: "student" },
    });
    const rows = await database.selectFrom("audit_event").selectAll().execute();
    expect(rows).toEqual([
      expect.objectContaining({
        action: "authn_login_success",
        actor_type: "user",
        actor_id: "u1",
        target_type: "user",
        target_id: "u1",
        outcome: "success",
        reason_code: null,
        provider: providerIdOf("keycloak"),
        request_id: "req-9",
        metadata: { roles: "student" },
        occurred_at: occurredAt,
      }),
    ]);
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it("stores no actor id for the system or an anonymous caller", async () => {
    const database = await testDb();
    await recordAudit(database, {
      action: "authn_login_fail",
      actor: { type: "anonymous" },
      outcome: "refused",
      reason: "no_edulims_role",
    });
    const row = await database
      .selectFrom("audit_event")
      .select(["actor_type", "actor_id", "reason_code"])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      actor_type: "anonymous",
      actor_id: null,
      reason_code: "no_edulims_role",
    });
  });

  it("rolls back with the transaction of the action it describes", async () => {
    const database = await testDb();
    await expect(
      database.transaction().execute(async (trx) => {
        await recordAudit(trx, LOGIN);
        throw new Error("the action failed");
      }),
    ).rejects.toThrow("the action failed");
    const rows = await database.selectFrom("audit_event").select("id").execute();
    expect(rows).toEqual([]);
  });

  it("refuses a metadata key outside the schema, such as an e-mail address", async () => {
    const database = unreachableDb();
    const event = { ...LOGIN, metadata: { email: "x@example.test" } } as unknown as AuditEvent;
    await expect(recordAudit(database, event)).rejects.toThrow(AuditEventInvalidError);
  });

  it("refuses a target type that does not fit the action", async () => {
    const database = unreachableDb();
    const event = { ...LOGIN, target: { type: "session", id: "s1" } } as unknown as AuditEvent;
    await expect(recordAudit(database, event)).rejects.toThrow(AuditEventInvalidError);
  });

  it("refuses a reason that is not a code", async () => {
    const database = unreachableDb();
    await expect(recordAudit(database, { ...LOGIN, reason: "Jan de Vries" })).rejects.toThrow(
      AuditEventInvalidError,
    );
  });

  it("throws AuditWriteError when the database cannot take the row", async () => {
    const database = unreachableDb();
    try {
      await expect(recordAudit(database, LOGIN)).rejects.toThrow(AuditWriteError);
    } finally {
      await database.destroy();
    }
  });

  it("holds the rules in the database too: a user actor needs an id", async () => {
    const database = await testDb();
    await expect(
      database
        .insertInto("audit_event")
        .values({ action: "authn_logout", actor_type: "user", outcome: "success" })
        .execute(),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("recordCommittedAudit", () => {
  it("logs a failed write with ids only and does not throw", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const database = unreachableDb();
    try {
      await expect(recordCommittedAudit(database, LOGIN)).resolves.toBeUndefined();
    } finally {
      await database.destroy();
    }
    expect(error).toHaveBeenCalledWith(
      "audit_write_failed kind=write action=authn_login_success outcome=success actor=u1 target=user:u1",
    );
  });

  it("logs an invalid event as invalid", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const database = unreachableDb();
    await recordCommittedAudit(database, { ...LOGIN, actor: { type: "system" }, reason: "No!" });
    await database.destroy();
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^audit_write_failed kind=invalid .* actor=system /),
    );
  });
});

describe("codes", () => {
  it("turns a better-auth error code into a reason code", () => {
    expect(toReasonCode("INVALID_EMAIL_OR_PASSWORD")).toBe("invalid_email_or_password");
    expect(toReasonCode("state not found")).toBe("state_not_found");
    expect(toReasonCode("!!!")).toBeUndefined();
    expect(toReasonCode(42)).toBeUndefined();
  });

  it("keeps a request id only in its expected shape", () => {
    expect(toRequestId("0193-abc.def:1")).toBe("0193-abc.def:1");
    expect(toRequestId("x".repeat(129))).toBeUndefined();
    expect(toRequestId(null)).toBeUndefined();
  });
});
