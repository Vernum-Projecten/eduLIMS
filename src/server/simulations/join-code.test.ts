// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The teacher's side of a lab's join code (S10, #288): the key, turning the code on, replacing
// it, turning it off and reading its state, each with its audit row and its refusals per role.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeJoinCode } from "../../lib/join-code.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import {
  disableJoinCode,
  enableJoinCode,
  getJoinCode,
  JOIN_CODE_KEY_INFO,
  joinCodeKey,
  regenerateJoinCode,
} from "./join-code.ts";
import { deleteLab } from "./labs.ts";
import { teacherWriteRefusals } from "./test-access.ts";
import { auditRows, NOW, notFoundLine, securityLines, type World, world } from "./test-helpers.ts";
import { codeOf, DAY, key } from "./test-join.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<{ database: Kysely<DB>; w: World }> {
  db = await createTestDb();
  return { database: db, w: await world(db) };
}

const SETTINGS = { validDays: 7, maxUses: 30 };
const ROTATED = "a-rotated-better-auth-secret-of-enough-length";

async function storedCode(database: Kysely<DB>, labId: string) {
  return database
    .selectFrom("lab_join_codes")
    .select(["code_hash", "key_fingerprint", "created_by", "expires_at", "max_uses", "uses"])
    .where("lab_id", "=", labId)
    .executeTakeFirst();
}

describe("joinCodeKey (#288)", () => {
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
    expect(joinCodeKey("join-test-secret-that-is-long-enough-to-use").fingerprint).toBe(
      key.fingerprint,
    );
    expect(other.fingerprint).not.toBe(key.fingerprint);
  });

  it("derives each key under its own HKDF info string, and both name the lab", () => {
    expect(JOIN_CODE_KEY_INFO.code).not.toBe(JOIN_CODE_KEY_INFO.attempts);
    expect(JOIN_CODE_KEY_INFO.code).toContain("lab");
    expect(JOIN_CODE_KEY_INFO.attempts).toContain("lab");
    expect(JSON.stringify(JOIN_CODE_KEY_INFO)).not.toContain("class");
    expect(key.attemptHash("user:u-1")).not.toBe(key.hash("user:u-1"));
  });
});

describe("enableJoinCode (#288)", () => {
  it("turns the code on, returns it once, stores only its hash and logs ids and numbers", async () => {
    const { database, w } = await open();
    const result = await enableJoinCode(
      database,
      w.teacher,
      { labId: w.labId, ...SETTINGS },
      NOW,
      key,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.value.code).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
    expect(result.value.maxUses).toBe(30);
    expect(result.value.expiresAt).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
    const code = normalizeJoinCode(result.value.code);
    if (!code) throw new Error("not a join code");
    const row = await storedCode(database, w.labId);
    expect(row).toEqual({
      code_hash: key.hash(code),
      key_fingerprint: key.fingerprint,
      created_by: w.teacher.id,
      expires_at: new Date(NOW.getTime() + 7 * DAY),
      max_uses: 30,
      uses: 0,
    });
    expect(JSON.stringify(row)).not.toContain(code);
    const rows = await auditRows(database, "lab_join_code_enabled");
    expect(rows).toEqual([
      {
        actor_id: w.teacher.id,
        outcome: "success",
        target_type: "lab",
        target_id: w.labId,
        reason_code: null,
        metadata: { simulation_id: w.simulationId, valid_days: 7, max_uses: 30 },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it("lets a co-teacher turn it on (D10)", async () => {
    const { database, w } = await open();
    const result = await enableJoinCode(
      database,
      w.coTeacher,
      { labId: w.labId, ...SETTINGS },
      NOW,
      key,
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a second code while one is on, and changes nothing", async () => {
    const { database, w } = await open();
    await codeOf(database, w.teacher, w.labId);
    const before = await storedCode(database, w.labId);
    const again = await enableJoinCode(
      database,
      w.teacher,
      { labId: w.labId, ...SETTINGS },
      NOW,
      key,
    );
    expect(again).toEqual({ ok: false, error: "join_code_exists" });
    expect(await storedCode(database, w.labId)).toEqual(before);
  });

  it("gives every lab its own code", async () => {
    const { database, w } = await open();
    const first = await codeOf(database, w.teacher, w.labId);
    const second = await codeOf(database, w.teacher, w.otherLabId);
    expect(second).not.toBe(first);
  });

  describe("refusals per role (E1)", () => {
    teacherWriteRefusals({
      call: (database, _w, actor, target) =>
        enableJoinCode(database, actor, { labId: target, ...SETTINGS }, NOW, key),
      target: (w) => ({ type: "lab", id: w.labId }),
    });
  });
});

describe("regenerateJoinCode (#288)", () => {
  it("replaces the hash, takes the new settings, starts the uses at zero and logs it", async () => {
    const { database, w } = await open();
    const first = await codeOf(database, w.teacher, w.labId);
    await database.updateTable("lab_join_codes").set({ uses: 5 }).execute();
    const later = new Date(NOW.getTime() + DAY);
    const second = await regenerateJoinCode(
      database,
      w.coTeacher,
      { labId: w.labId, validDays: 30, maxUses: 500 },
      later,
      key,
    );
    if (!second.ok) throw new Error(second.error);
    expect(second.value.code).not.toBe(first);
    expect(await storedCode(database, w.labId)).toEqual({
      code_hash: key.hash(normalizeJoinCode(second.value.code) ?? ""),
      key_fingerprint: key.fingerprint,
      created_by: w.coTeacher.id,
      expires_at: new Date(later.getTime() + 30 * DAY),
      max_uses: 500,
      uses: 0,
    });
    expect(await auditRows(database, "lab_join_code_regenerated")).toEqual([
      {
        actor_id: w.coTeacher.id,
        outcome: "success",
        target_type: "lab",
        target_id: w.labId,
        reason_code: null,
        metadata: { simulation_id: w.simulationId, valid_days: 30, max_uses: 500 },
      },
    ]);
  });

  it("refuses a lab whose code is off", async () => {
    const { database, w } = await open();
    const result = await regenerateJoinCode(
      database,
      w.teacher,
      { labId: w.labId, ...SETTINGS },
      NOW,
      key,
    );
    expect(result).toEqual({ ok: false, error: "join_code_off" });
    expect(await storedCode(database, w.labId)).toBeUndefined();
    expect(await auditRows(database, "lab_join_code_regenerated")).toEqual([]);
  });

  describe("refusals per role (E1)", () => {
    teacherWriteRefusals({
      call: (database, _w, actor, target) =>
        regenerateJoinCode(database, actor, { labId: target, ...SETTINGS }, NOW, key),
      target: (w) => ({ type: "lab", id: w.labId }),
      prepare: async (database, w) => {
        await codeOf(database, w.teacher, w.labId);
      },
    });
  });
});

describe("disableJoinCode (#288)", () => {
  it("deletes the code and logs it", async () => {
    const { database, w } = await open();
    await codeOf(database, w.teacher, w.labId);
    expect(await disableJoinCode(database, w.coTeacher, { labId: w.labId })).toEqual({
      ok: true,
      value: null,
    });
    expect(await storedCode(database, w.labId)).toBeUndefined();
    expect(await auditRows(database, "lab_join_code_disabled")).toEqual([
      {
        actor_id: w.coTeacher.id,
        outcome: "success",
        target_type: "lab",
        target_id: w.labId,
        reason_code: null,
        metadata: { simulation_id: w.simulationId },
      },
    ]);
  });

  it("refuses a lab whose code is already off", async () => {
    const { database, w } = await open();
    expect(await disableJoinCode(database, w.teacher, { labId: w.labId })).toEqual({
      ok: false,
      error: "join_code_off",
    });
    expect(await auditRows(database, "lab_join_code_disabled")).toEqual([]);
  });

  it("leaves the code of another lab of the simulation alone", async () => {
    const { database, w } = await open();
    await codeOf(database, w.teacher, w.labId);
    await codeOf(database, w.teacher, w.otherLabId);
    await disableJoinCode(database, w.teacher, { labId: w.labId });
    expect(await storedCode(database, w.otherLabId)).toBeDefined();
  });

  describe("refusals per role (E1)", () => {
    teacherWriteRefusals({
      call: (database, _w, actor, target) => disableJoinCode(database, actor, { labId: target }),
      target: (w) => ({ type: "lab", id: w.labId }),
      prepare: async (database, w) => {
        await codeOf(database, w.teacher, w.labId);
      },
    });
  });
});

describe("deleting a lab (#280)", () => {
  it("deletes its code with it", async () => {
    const { database, w } = await open();
    const created = await database
      .insertInto("labs")
      .values({ simulation_id: w.simulationId, name: "Empty Lab" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await codeOf(database, w.teacher, created.id);
    expect(await deleteLab(database, w.teacher, { labId: created.id })).toEqual({
      ok: true,
      value: null,
    });
    expect(await storedCode(database, created.id)).toBeUndefined();
  });
});

describe("getJoinCode (#288, D11)", () => {
  it("is off by default", async () => {
    const { database, w } = await open();
    expect(await getJoinCode(database, w.teacher, w.labId, NOW, key.fingerprint)).toEqual({
      enabled: false,
    });
  });

  it("shows the state without the code, and when it has expired", async () => {
    const { database, w } = await open();
    const code = await codeOf(database, w.teacher, w.labId);
    const view = await getJoinCode(database, w.coTeacher, w.labId, NOW, key.fingerprint);
    expect(view).toEqual({
      enabled: true,
      createdAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 7 * DAY).toISOString(),
      expired: false,
      stale: false,
      uses: 0,
      maxUses: 30,
    });
    expect(JSON.stringify(view)).not.toContain(code);
    const later = new Date(NOW.getTime() + 7 * DAY);
    expect(await getJoinCode(database, w.teacher, w.labId, later, key.fingerprint)).toEqual(
      expect.objectContaining({ expired: true }),
    );
  });

  it("shows a code made under another secret as stale (review L2)", async () => {
    const { database, w } = await open();
    await codeOf(database, w.teacher, w.labId);
    const rotated = joinCodeKey(ROTATED);
    expect(await getJoinCode(database, w.teacher, w.labId, NOW, rotated.fingerprint)).toEqual(
      expect.objectContaining({ enabled: true, stale: true }),
    );
  });

  it("is null for a teacher of another simulation, and logs it (D11)", async () => {
    const { database, w } = await open();
    await codeOf(database, w.teacher, w.labId);
    let view: unknown;
    const lines = await securityLines(async () => {
      view = await getJoinCode(database, w.outsiderTeacher, w.labId, NOW, key.fingerprint);
    });
    expect(view).toBeNull();
    expect(lines).toEqual([notFoundLine(w.outsiderTeacher.id, "lab", w.labId)]);
  });

  it("is null for a malformed id and an unknown lab, each logged", async () => {
    const { database, w } = await open();
    const unknown = "01960000-0000-7000-8000-00000000dead";
    let views: unknown[] = [];
    const lines = await securityLines(async () => {
      views = [
        await getJoinCode(database, w.teacher, "not-a-uuid", NOW, key.fingerprint),
        await getJoinCode(database, w.teacher, unknown, NOW, key.fingerprint),
      ];
    });
    expect(views).toEqual([null, null]);
    expect(lines).toEqual([
      notFoundLine(w.teacher.id, "lab", "not-a-uuid"),
      notFoundLine(w.teacher.id, "lab", unknown),
    ]);
  });

  it.each([
    ["a student of the lab", (w: World) => w.student],
    ["a student of another lab", (w: World) => w.otherLabStudent],
    ["a student outside the simulation", (w: World) => w.outsideStudent],
    ["an administrator", (w: World) => w.admin],
  ])("refuses %s with 403 (R-01)", async (_who, actorOf) => {
    const { database, w } = await open();
    await codeOf(database, w.teacher, w.labId);
    await expect(
      getJoinCode(database, actorOf(w), w.labId, NOW, key.fingerprint),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
