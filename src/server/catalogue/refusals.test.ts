// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A refused change to the catalogue leaves one activity-log row (ASVS V16.3.3): the action, the
// actor, the test's id and the code as the reason, never a value the teacher typed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestUsage } from "../../lib/catalogue.ts";
import { restoreTest, retireTest, updateTest } from "./actions.ts";
import { CRP, catalogueTestDb, created, events, UNKNOWN } from "./test-helpers.ts";

// NOTE: #266; no table refers to a test yet, so the use of a test is mocked until #267 makes it real.
const usages = vi.hoisted(() => new Map<string, TestUsage>());
vi.mock("./in-use.ts", () => ({
  usageOf: (_db: unknown, id: string) => Promise.resolve(usages.get(id) ?? "unused"),
  testUsage: () => Promise.resolve(new Map()),
}));

const setup = catalogueTestDb();

beforeEach(() => usages.clear());

afterEach(() => setup.destroy());

describe("refused changes in the activity log (ASVS V16.3.3, B4)", () => {
  it("writes exactly one refused row for an in_use refusal, with ids and the code only", async () => {
    const ctx = await setup.admin();
    const id = await created(ctx);
    usages.set(id, "used");
    expect(await updateTest(ctx, { testId: id, test: { ...CRP, unit: "mg/dL" } })).toEqual({
      ok: false,
      error: "in_use",
    });
    const refused = (await events(ctx.db)).filter((event) => event.outcome === "refused");
    expect(refused).toEqual([
      {
        action: "test_changed",
        actor_type: "user",
        actor_id: ctx.actor.id,
        target_type: "test",
        target_id: id,
        outcome: "refused",
        reason_code: "in_use",
        metadata: null,
      },
    ]);
    expect(JSON.stringify(refused)).not.toContain("mg/dL");
  });

  it("logs a running-simulation refusal with its own code", async () => {
    const ctx = await setup.admin();
    const id = await created(ctx);
    usages.set(id, "running");
    await updateTest(ctx, { testId: id, test: { ...CRP, material: "serum" } });
    expect((await events(ctx.db)).at(-1)).toMatchObject({
      action: "test_changed",
      outcome: "refused",
      reason_code: "in_running_simulation",
    });
  });

  it("logs a refused retire and restore against their own actions", async () => {
    const ctx = await setup.admin();
    const id = await created(ctx);
    await restoreTest(ctx, { testId: id });
    await retireTest(ctx, { testId: id });
    await retireTest(ctx, { testId: id });
    const rows = (await events(ctx.db)).filter((event) => event.outcome === "refused");
    expect(rows.map((row) => [row.action, row.reason_code, row.target_id])).toEqual([
      ["test_restored", "not_retired", id],
      ["test_retired", "retired", id],
    ]);
  });

  it("logs not_found with the id asked for, and leaves out an id that is not a test id", async () => {
    const ctx = await setup.admin();
    await retireTest(ctx, { testId: UNKNOWN });
    await retireTest(ctx, { testId: "not-a-test-id" });
    const rows = (await events(ctx.db)).map((row) => [row.reason_code, row.target_id]);
    expect(rows).toEqual([
      ["not_found", UNKNOWN],
      ["not_found", null],
    ]);
  });
});
