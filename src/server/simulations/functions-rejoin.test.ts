// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The sequence of #323 through the server functions themselves (S10, R-01): the real chains of
// functions.ts run against the test database, with the role middleware and the Zod validator in
// their place. `createServerFn` is replaced by a builder that applies the role the chain names to
// the session user and parses the input with the chain's own validator.
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { Role } from "../../lib/roles.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import type { SimulationActor } from "./access.ts";
import type { World } from "./test-helpers.ts";
import { context, key, labOf, worldWithCode } from "./test-join.ts";

const session = vi.hoisted(() => {
  const state: { user: { id: string; roles: readonly Role[] } | null; db: unknown } = {
    user: null,
    db: null,
  };
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
          (fn: (args: { data: unknown; context: { user: SimulationActor } }) => unknown) =>
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
vi.mock("./join-context.ts", () => ({
  requestJoinContext: () => context(),
  serverJoinCodeKey: () => key,
}));

const { addEmailsFn, joinLabFn, linkMyLabsFn, removeMemberFn } = await import("./functions.ts");

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
});

function as(person: World["teacher"]) {
  session.user = { id: person.id, roles: person.roles };
}

async function sequence(database: Kysely<DB>, waitingIn: (w: World) => string) {
  const w = await worldWithCode(database);
  as(w.teacher);
  expect(await addEmailsFn({ data: { labId: waitingIn(w), emails: [w.stranger.email] } })).toEqual({
    ok: true,
    value: expect.objectContaining({ added: 1 }),
  });
  as(w.stranger);
  expect(await joinLabFn({ data: { code: w.code } })).toEqual({
    ok: true,
    value: expect.objectContaining({ status: "joined", labId: w.labId }),
  });
  as(w.teacher);
  expect(
    await removeMemberFn({ data: { simulationId: w.simulationId, userId: w.stranger.id } }),
  ).toEqual({ ok: true, value: null });
  as(w.stranger);
  expect(await linkMyLabsFn()).toEqual({ linked: 0, refused: 0, failed: 0 });
  expect(await labOf(database, w.simulationId, w.stranger.id)).toBeNull();
  const removal = await database
    .selectFrom("simulation_removals")
    .select("user_id")
    .where("simulation_id", "=", w.simulationId)
    .execute();
  expect(removal).toEqual([{ user_id: w.stranger.id }]);
  expect(await joinLabFn({ data: { code: w.code } })).toEqual({
    ok: false,
    error: "invalid_code",
  });
}

describe("a removed student through the server functions (#323, R-01)", () => {
  it("stays out when the address waited in the lab the code joined", async () => {
    if (!db) throw new Error("no database");
    await sequence(db, (w) => w.labId);
  });

  it("stays out when the address waited in another lab of the simulation", async () => {
    if (!db) throw new Error("no database");
    await sequence(db, (w) => w.otherLabId);
  });

  it("refuses a teacher calling the student's join with 403, before any input is read", async () => {
    if (!db) throw new Error("no database");
    const w = await worldWithCode(db);
    as(w.teacher);
    await expect(joinLabFn({ data: { code: w.code } })).rejects.toMatchObject({ status: 403 });
  });
});
