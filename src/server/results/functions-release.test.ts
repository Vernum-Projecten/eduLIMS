// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The release through its server function (#382, S10, S15, R-01): the real chain of
// `releaseResultFn` runs against the test database with FerroEHR stubbed, the role middleware and
// the Zod validator in their place. `createServerFn` is replaced by a builder that applies the
// role the chain names to the session user and parses the input with the chain's own validator.
// Values are invented (Q-PRIV-4).
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { Role } from "../../lib/roles.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { finishSimulation } from "../simulations/state.ts";
import { auditRows, NOW } from "../simulations/test-helpers.ts";
import type { ResultsActor } from "./access.ts";
import { ferroEhr, input, SETTINGS } from "./test-ehr-write.ts";
import { measure, type ResultsWorld, resultsWorld } from "./test-helpers.ts";

const session = vi.hoisted(() => {
  const state: {
    user: { id: string; roles: readonly Role[] } | null;
    db: unknown;
    client: unknown;
  } = { user: null, db: null, client: null };
  return state;
});

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  /** The refusal the role middleware throws, with the same `status` as its `AuthError`. */
  class AuthError extends Error {
    readonly status: 401 | 403;
    constructor(status: 401 | 403) {
      super(String(status));
      this.status = status;
    }
  }
  return {
    ...actual,
    createServerFn: () => {
      let roles: readonly Role[] = [];
      let schema: z.ZodType | undefined;
      const builder = {
        middleware: (list: { roles: readonly Role[] }[]) => {
          roles = list.flatMap((each) => each.roles);
          return builder;
        },
        validator: (input: z.ZodType) => {
          schema = input;
          return builder;
        },
        handler:
          (fn: (args: { data: unknown; context: { user: ResultsActor } }) => unknown) =>
          async (options: { data?: unknown } = {}) => {
            const user = session.user;
            if (!user) throw new AuthError(401);
            if (!roles.some((role) => user.roles.includes(role))) throw new AuthError(403);
            const data = schema ? schema.parse(options.data) : undefined;
            return fn({ data, context: { user } });
          },
      };
      return builder;
    },
  };
});
vi.mock("../middleware.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware.ts")>();
  return { ...actual, requireRole: (...roles: Role[]) => ({ roles }) };
});
vi.mock("../db/index.ts", () => ({ getDb: () => session.db }));
vi.mock("../env.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../env.ts")>();
  return { ...actual, getEnv: () => ({}) };
});
vi.mock("../openehr/index.ts", () => ({
  getOpenEhrClient: () => session.client,
  labResultWriteSettings: () => SETTINGS,
}));

const { releaseResultFn } = await import("./functions.ts");

let db: Kysely<DB> | undefined;

beforeEach(async () => {
  db = await createTestDb();
  session.db = db;
});

afterEach(async () => {
  await db?.destroy();
  db = undefined;
  session.user = null;
  session.db = null;
  session.client = null;
});

async function world() {
  if (!db) throw new Error("no database");
  const w = await resultsWorld(db);
  // The patient's EHR is still pending (#364).
  await db.updateTable("patients").set({ ehr_id: null }).execute();
  const { client } = ferroEhr();
  session.client = client;
  return { database: db, w, client };
}

function as(person: ResultsWorld["student"]) {
  session.user = { id: person.id, roles: person.roles };
}

describe("releaseResultFn (#382, S10)", () => {
  it("refuses another lab's request with a pending EHR as request_not_found, asking FerroEHR nothing", async () => {
    const { database, w, client } = await world();
    const id = await measure(database, w, "5.3");
    as(w.otherLabStudent);
    const data = { ...input(w, id), labId: w.otherLabId };
    expect(await releaseResultFn({ data })).toEqual({ ok: false, error: "request_not_found" });
    const reasons = (await auditRows(database, "lab_result_released")).map((r) => r.reason_code);
    expect(reasons).not.toContain("ehr_pending");
    expect(client.getEhrBySubject).not.toHaveBeenCalled();
    expect(client.createEhr).not.toHaveBeenCalled();
    expect(client.createContribution).not.toHaveBeenCalled();
  });

  it("refuses a member of a finished simulation not_running, asking FerroEHR nothing", async () => {
    const { database, w, client } = await world();
    const id = await measure(database, w, "5.3");
    expect(
      (await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW)).ok,
    ).toBe(true);
    as(w.student);
    expect(await releaseResultFn({ data: input(w, id) })).toEqual({
      ok: false,
      error: "not_running",
    });
    expect(client.getEhrBySubject).not.toHaveBeenCalled();
    expect(client.createEhr).not.toHaveBeenCalled();
  });

  it("refuses a teacher with 403 before any input is read", async () => {
    const { database, w, client } = await world();
    const id = await measure(database, w, "5.3");
    as(w.teacher);
    await expect(releaseResultFn({ data: input(w, id) })).rejects.toMatchObject({ status: 403 });
    expect(client.getEhrBySubject).not.toHaveBeenCalled();
  });
});
