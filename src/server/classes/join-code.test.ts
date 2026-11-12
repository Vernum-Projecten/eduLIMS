// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeJoinCode } from "../../lib/join-code.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { archiveClass } from "./classes.ts";
import {
  disableJoinCode,
  enableJoinCode,
  getJoinCode,
  joinCodeKey,
  regenerateJoinCode,
} from "./join-code.ts";
import {
  auditRows,
  classNotFoundLine,
  classWithPeople,
  NOW,
  person,
  securityLines,
} from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<Kysely<DB>> {
  db = await createTestDb();
  return db;
}

const key = joinCodeKey("join-code-test-secret-that-is-long-enough");
const SETTINGS = { validDays: 7, maxUses: 30 };
const DAY = 86_400_000;

async function storedCode(database: Kysely<DB>, classId: string) {
  return database
    .selectFrom("class_join_codes")
    .select(["code_hash", "key_fingerprint", "created_by", "expires_at", "max_uses", "uses"])
    .where("organization_id", "=", classId)
    .executeTakeFirst();
}

describe("joinCodeKey (#49)", () => {
  it("is deterministic per secret and differs between secrets", () => {
    const other = joinCodeKey("another-secret-that-is-long-enough-too");
    expect(key.hash("ABCDEFGH23")).toBe(key.hash("ABCDEFGH23"));
    expect(key.hash("ABCDEFGH23")).toMatch(/^[0-9a-f]{64}$/);
    expect(other.hash("ABCDEFGH23")).not.toBe(key.hash("ABCDEFGH23"));
    expect(key.hash("ABCDEFGH24")).not.toBe(key.hash("ABCDEFGH23"));
  });

  it("names the key with a fingerprint that changes with the secret", () => {
    const other = joinCodeKey("another-secret-that-is-long-enough-too");
    expect(key.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(joinCodeKey("join-code-test-secret-that-is-long-enough").fingerprint).toBe(
      key.fingerprint,
    );
    expect(other.fingerprint).not.toBe(key.fingerprint);
  });
});

describe("enableJoinCode (#49)", () => {
  it("turns the code on, returns it once and stores only its hash", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const result = await enableJoinCode(database, owner, { classId, ...SETTINGS }, NOW, key);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.code).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
    expect(result.value.maxUses).toBe(30);
    expect(result.value.expiresAt).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
    const code = normalizeJoinCode(result.value.code);
    if (!code) throw new Error("not a join code");
    const row = await storedCode(database, classId);
    expect(row).toEqual({
      code_hash: key.hash(code),
      key_fingerprint: key.fingerprint,
      created_by: owner.id,
      expires_at: new Date(NOW.getTime() + 7 * DAY),
      max_uses: 30,
      uses: 0,
    });
    expect(JSON.stringify(row)).not.toContain(code);
    expect(await auditRows(database, "class_join_code_enabled")).toEqual([
      expect.objectContaining({
        actor_id: owner.id,
        outcome: "success",
        target_type: "class",
        target_id: classId,
        metadata: { valid_days: 7, max_uses: 30 },
      }),
    ]);
  });

  it("lets a co-teacher turn it on", async () => {
    const database = await open();
    const { classId, coTeacher } = await classWithPeople(database);
    const result = await enableJoinCode(database, coTeacher, { classId, ...SETTINGS }, NOW, key);
    expect(result.ok).toBe(true);
  });

  it("refuses a second code while one is on", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    await enableJoinCode(database, owner, { classId, ...SETTINGS }, NOW, key);
    const again = await enableJoinCode(database, owner, { classId, ...SETTINGS }, NOW, key);
    expect(again).toEqual({ ok: false, error: "join_code_exists" });
  });

  it("is not_found for a teacher of another class, and logs it (D3)", async () => {
    const database = await open();
    const { classId, outsider } = await classWithPeople(database);
    let result: Awaited<ReturnType<typeof enableJoinCode>> | undefined;
    const lines = await securityLines(async () => {
      result = await enableJoinCode(database, outsider, { classId, ...SETTINGS }, NOW, key);
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(lines).toContainEqual(classNotFoundLine(outsider.id, classId));
    expect(await storedCode(database, classId)).toBeUndefined();
  });

  it("refuses a student of the class with 403", async () => {
    const database = await open();
    const { classId, studentA } = await classWithPeople(database);
    await expect(
      enableJoinCode(database, studentA, { classId, ...SETTINGS }, NOW, key),
    ).rejects.toThrow(AuthError);
  });

  it("refuses an administrator who teaches nothing with 403", async () => {
    const database = await open();
    const { classId } = await classWithPeople(database);
    const admin = await person(database, "admin", ["admin"]);
    await expect(
      enableJoinCode(database, admin, { classId, ...SETTINGS }, NOW, key),
    ).rejects.toThrow(AuthError);
  });

  it("refuses an archived class and records the refusal", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    await archiveClass(database, owner, { classId }, NOW);
    const result = await enableJoinCode(database, owner, { classId, ...SETTINGS }, NOW, key);
    expect(result).toEqual({ ok: false, error: "archived" });
    expect(await auditRows(database, "class_join_code_enabled")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "archived" }),
    ]);
  });
});

describe("regenerateJoinCode (#49)", () => {
  it("replaces the hash, takes the new settings and starts the uses at zero", async () => {
    const database = await open();
    const { classId, owner, coTeacher } = await classWithPeople(database);
    const first = await enableJoinCode(database, owner, { classId, ...SETTINGS }, NOW, key);
    if (!first.ok) throw new Error(first.error);
    await database.updateTable("class_join_codes").set({ uses: 5 }).execute();
    const later = new Date(NOW.getTime() + DAY);
    const second = await regenerateJoinCode(
      database,
      coTeacher,
      { classId, validDays: 30, maxUses: 500 },
      later,
      key,
    );
    if (!second.ok) throw new Error(second.error);
    expect(second.value.code).not.toBe(first.value.code);
    const row = await storedCode(database, classId);
    expect(row).toEqual({
      code_hash: key.hash(normalizeJoinCode(second.value.code) ?? ""),
      key_fingerprint: key.fingerprint,
      created_by: coTeacher.id,
      expires_at: new Date(later.getTime() + 30 * DAY),
      max_uses: 500,
      uses: 0,
    });
    expect(await auditRows(database, "class_join_code_regenerated")).toEqual([
      expect.objectContaining({ actor_id: coTeacher.id, outcome: "success" }),
    ]);
  });

  it("refuses a class whose code is off", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    const result = await regenerateJoinCode(database, owner, { classId, ...SETTINGS }, NOW, key);
    expect(result).toEqual({ ok: false, error: "join_code_off" });
  });
});

describe("disableJoinCode (#49)", () => {
  it("deletes the code and records it", async () => {
    const database = await open();
    const { classId, owner, coTeacher } = await classWithPeople(database);
    await enableJoinCode(database, owner, { classId, ...SETTINGS }, NOW, key);
    expect(await disableJoinCode(database, coTeacher, { classId })).toEqual({
      ok: true,
      value: null,
    });
    expect(await storedCode(database, classId)).toBeUndefined();
    expect(await auditRows(database, "class_join_code_disabled")).toEqual([
      expect.objectContaining({ actor_id: coTeacher.id, outcome: "success", target_id: classId }),
    ]);
  });

  it("refuses a class whose code is already off", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    expect(await disableJoinCode(database, owner, { classId })).toEqual({
      ok: false,
      error: "join_code_off",
    });
  });

  it("is not_found for a teacher of another class", async () => {
    const database = await open();
    const { classId, owner, outsider } = await classWithPeople(database);
    await enableJoinCode(database, owner, { classId, ...SETTINGS }, NOW, key);
    expect(await disableJoinCode(database, outsider, { classId })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await storedCode(database, classId)).toBeDefined();
  });
});

describe("getJoinCode (#49, D3)", () => {
  it("is off by default", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    expect(await getJoinCode(database, owner.id, classId, NOW, key.fingerprint)).toEqual({
      enabled: false,
    });
  });

  it("shows the state without the code, and when it has expired", async () => {
    const database = await open();
    const { classId, owner, coTeacher } = await classWithPeople(database);
    await enableJoinCode(database, owner, { classId, ...SETTINGS }, NOW, key);
    const view = await getJoinCode(database, coTeacher.id, classId, NOW, key.fingerprint);
    expect(view).toEqual({
      enabled: true,
      createdAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 7 * DAY).toISOString(),
      expired: false,
      stale: false,
      uses: 0,
      maxUses: 30,
    });
    const later = new Date(NOW.getTime() + 7 * DAY);
    expect(await getJoinCode(database, owner.id, classId, later, key.fingerprint)).toEqual(
      expect.objectContaining({ expired: true }),
    );
  });

  it("shows a code made under another secret as stale (review L2)", async () => {
    const database = await open();
    const { classId, owner } = await classWithPeople(database);
    await enableJoinCode(database, owner, { classId, ...SETTINGS }, NOW, key);
    const rotated = joinCodeKey("a-rotated-better-auth-secret-of-enough-length");
    expect(await getJoinCode(database, owner.id, classId, NOW, rotated.fingerprint)).toEqual(
      expect.objectContaining({ enabled: true, stale: true }),
    );
  });

  it("is null for a teacher of another class, a student of the class and a malformed id", async () => {
    const database = await open();
    const { classId, outsider, studentA } = await classWithPeople(database);
    expect(await getJoinCode(database, outsider.id, classId, NOW, key.fingerprint)).toBeNull();
    expect(await getJoinCode(database, studentA.id, classId, NOW, key.fingerprint)).toBeNull();
    expect(await getJoinCode(database, outsider.id, "not-a-uuid", NOW, key.fingerprint)).toBeNull();
  });
});
