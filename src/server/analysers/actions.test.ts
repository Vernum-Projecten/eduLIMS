// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { Role } from "../../lib/roles.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import {
  type AnalyserActionContext,
  createAnalyser,
  isSerialTaken,
  retireAnalyser,
  updateAnalyser,
} from "./actions.ts";
import { readAnalyserPage } from "./reads.ts";
import type { CreateAnalyserInput } from "./schemas.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
const LATER = new Date("2026-11-11T13:00:00Z");
const ADMIN_ID = "admin-1";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function context(roles: readonly Role[] = ["admin"], now = NOW) {
  db ??= await createTestDb();
  return { db, actor: { id: ADMIN_ID, roles: [...roles] }, now } satisfies AnalyserActionContext;
}

const AFINION: CreateAnalyserInput = {
  model: "Abbott Afinion 2",
  serialNumber: "AF2-TEST-0001",
  location: "Lab A, bench 1",
  route: "hl7_ferrobridge",
  status: "in_use",
  notes: "",
};

function events(database: Kysely<DB>) {
  return database
    .selectFrom("audit_event")
    .select(["action", "actor_id", "target_type", "target_id", "outcome", "metadata"])
    .where("action", "like", "analyser_%")
    .orderBy("occurred_at")
    .orderBy("id")
    .execute();
}

function stored(database: Kysely<DB>, id: string) {
  return database
    .selectFrom("analysers")
    .select(["model", "serial_number", "status", "notes", "updated_at", "retired_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

async function created(ctx: AnalyserActionContext, input = AFINION): Promise<string> {
  const result = await createAnalyser(ctx, input);
  if (!result.ok) throw new Error(`create refused: ${result.error}`);
  return result.analyserId;
}

describe("createAnalyser (B3)", () => {
  it("adds the analyser and logs analyser_created in the same transaction (B4)", async () => {
    const ctx = await context();
    const id = await created(ctx, { ...AFINION, notes: "  Calibrated monthly.  " });
    expect(await stored(ctx.db, id)).toMatchObject({
      model: "Abbott Afinion 2",
      serial_number: "AF2-TEST-0001",
      status: "in_use",
      notes: "Calibrated monthly.",
      retired_at: null,
    });
    expect(await events(ctx.db)).toEqual([
      {
        action: "analyser_created",
        actor_id: ADMIN_ID,
        target_type: "analyser",
        target_id: id,
        outcome: "success",
        metadata: { analyser_status: "in_use" },
      },
    ]);
  });

  it("stores empty notes as no notes", async () => {
    const ctx = await context();
    const id = await created(ctx, { ...AFINION, notes: "   " });
    expect((await stored(ctx.db, id)).notes).toBeNull();
  });

  it("refuses a second analyser of the same model with the same serial number", async () => {
    const ctx = await context();
    await created(ctx);
    expect(await createAnalyser(ctx, { ...AFINION, location: "Lab B" })).toEqual({
      ok: false,
      error: "serial_taken",
    });
    expect(await events(ctx.db)).toHaveLength(1);
  });

  it("accepts the same serial number on another model", async () => {
    const ctx = await context();
    await created(ctx);
    const result = await createAnalyser(ctx, {
      ...AFINION,
      model: "BioTek Epoch 2",
      route: "excel_upload",
    });
    expect(result.ok).toBe(true);
  });
});

describe("updateAnalyser (B3)", () => {
  it("changes the analyser and logs analyser_updated with the new status", async () => {
    const ctx = await context();
    const id = await created(ctx);
    const later = await context(["admin"], LATER);
    const result = await updateAnalyser(later, {
      ...AFINION,
      analyserId: id,
      location: "Lab C",
      status: "maintenance",
    });
    expect(result).toEqual({ ok: true, analyserId: id });
    expect(await stored(ctx.db, id)).toMatchObject({ status: "maintenance", updated_at: LATER });
    const logged = await events(ctx.db);
    expect(logged.map((event) => [event.action, event.metadata])).toEqual([
      ["analyser_created", { analyser_status: "in_use" }],
      ["analyser_updated", { analyser_status: "maintenance" }],
    ]);
  });

  it("refuses an unknown analyser with not_found and logs nothing", async () => {
    const ctx = await context();
    const result = await updateAnalyser(ctx, {
      ...AFINION,
      analyserId: "01900000-0000-7000-8000-000000000000",
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(await events(ctx.db)).toEqual([]);
  });

  it("refuses to change a retired analyser", async () => {
    const ctx = await context();
    const id = await created(ctx);
    await retireAnalyser(ctx, { analyserId: id });
    expect(await updateAnalyser(ctx, { ...AFINION, analyserId: id })).toEqual({
      ok: false,
      error: "retired",
    });
  });

  it("refuses a serial number another analyser of the model holds", async () => {
    const ctx = await context();
    await created(ctx);
    const other = await created(ctx, { ...AFINION, serialNumber: "AF2-TEST-0002" });
    expect(
      await updateAnalyser(ctx, { ...AFINION, analyserId: other, serialNumber: "AF2-TEST-0001" }),
    ).toEqual({ ok: false, error: "serial_taken" });
  });
});

describe("retireAnalyser (B3)", () => {
  it("retires the analyser, keeps the row and logs analyser_retired", async () => {
    const ctx = await context();
    const id = await created(ctx);
    expect(await retireAnalyser(ctx, { analyserId: id })).toEqual({ ok: true, analyserId: id });
    expect(await stored(ctx.db, id)).toMatchObject({ status: "retired", retired_at: NOW });
    expect((await events(ctx.db)).at(-1)).toMatchObject({
      action: "analyser_retired",
      target_id: id,
      metadata: { analyser_status: "retired" },
    });
  });

  it("refuses to retire twice", async () => {
    const ctx = await context();
    const id = await created(ctx);
    await retireAnalyser(ctx, { analyserId: id });
    expect(await retireAnalyser(ctx, { analyserId: id })).toEqual({
      ok: false,
      error: "retired",
    });
  });

  it("refuses an unknown analyser", async () => {
    const ctx = await context();
    expect(
      await retireAnalyser(ctx, { analyserId: "01900000-0000-7000-8000-000000000000" }),
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("only administrators change or read the register (B3, A01)", () => {
  it.each([
    ["a student", ["student"]],
    ["a teacher", ["teacher"]],
    ["a user without a role", []],
  ] as const)("%s is refused with 403 by every function", async (_name, roles) => {
    const admin = await context();
    const id = await created(admin);
    const ctx = await context(roles);
    const refusals = [
      () => createAnalyser(ctx, { ...AFINION, serialNumber: "AF2-TEST-0009" }),
      () => updateAnalyser(ctx, { ...AFINION, analyserId: id, location: "Elsewhere" }),
      () => retireAnalyser(ctx, { analyserId: id }),
      () => readAnalyserPage(ctx, {}),
    ];
    for (const call of refusals) {
      const error: unknown = await call().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ status: 403 });
    }
    expect(await stored(admin.db, id)).toMatchObject({ status: "in_use", retired_at: null });
    expect(await events(admin.db)).toHaveLength(1);
  });

  it("a teacher-admin may change the register", async () => {
    const ctx = await context(["teacher", "admin"]);
    expect((await createAnalyser(ctx, AFINION)).ok).toBe(true);
  });
});

describe("the database holds the register's rules (B3)", () => {
  it("refuses a retired status without a retirement time", async () => {
    const ctx = await context();
    const id = await created(ctx);
    await expect(
      ctx.db.updateTable("analysers").set({ status: "retired" }).where("id", "=", id).execute(),
    ).rejects.toThrow(/analysers_retired_at/);
  });

  it("refuses an unknown route", async () => {
    const ctx = await context();
    await expect(
      ctx.db
        .insertInto("analysers")
        .values({ model: "X", serial_number: "1", location: "L", route: "usb" })
        .execute(),
    ).rejects.toThrow(/analysers_route/);
  });
});

describe("isSerialTaken", () => {
  it("recognises only the unique violation of the model and serial number", () => {
    const violation = { code: "23505", constraint: "analysers_model_serial_number_key" };
    expect(isSerialTaken(violation)).toBe(true);
    expect(isSerialTaken({ ...violation, constraint: "other_key" })).toBe(false);
    expect(isSerialTaken(new Error("x"))).toBe(false);
    expect(isSerialTaken(null)).toBe(false);
  });
});
