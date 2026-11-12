// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { readActivityLog, searchActivityUsers } from "./queries.ts";
import type { ListActivityInput } from "./schemas.ts";

const ADMIN = { roles: ["admin"] } as const;

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

interface Row {
  id: string;
  at: string;
  action?: string;
  actor?: string | "system" | "anonymous";
  target?: { type: string; id: string };
  outcome?: string;
  reason?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}

const PEOPLE = [
  { id: "u-anna", name: "Anna Bakker" },
  { id: "u-bram", name: "Bram de Vries" },
  { id: "u-cor", name: "Cor 100%_Admin" },
];

/** A uuid whose order follows `n`, so the tie-break on the id is predictable. */
function uuid(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

async function seed(rows: readonly Row[]): Promise<Kysely<DB>> {
  const database = await createTestDb();
  db = database;
  await database
    .insertInto("user")
    .values(
      PEOPLE.map((p) => ({
        id: p.id,
        name: p.name,
        email: `${p.id.slice(2)}@example.test`,
        emailVerified: true,
        role: "student",
      })),
    )
    .execute();
  if (rows.length > 0) {
    await database
      .insertInto("audit_event")
      .values(
        rows.map((row) => {
          const actor = row.actor ?? "u-anna";
          const anonymous = actor === "anonymous" || actor === "system";
          return {
            id: row.id,
            occurred_at: new Date(row.at),
            action: row.action ?? "authn_login_success",
            actor_type: anonymous ? actor : "user",
            actor_id: anonymous ? null : actor,
            target_type: row.target?.type ?? null,
            target_id: row.target?.id ?? null,
            outcome: row.outcome ?? "success",
            reason_code: row.reason ?? null,
            provider: row.provider ?? null,
            metadata: row.metadata ? JSON.stringify(row.metadata) : null,
          };
        }),
      )
      .execute();
  }
  return database;
}

const user = (id: string) => ({ type: "user", id });

/** The events of the filter tests, in Europe/Amsterdam winter time (UTC+1). */
const EVENTS: Row[] = [
  { id: uuid(1), at: "2026-11-01T09:00:00Z", actor: "u-anna", target: user("u-anna") },
  {
    id: uuid(2),
    at: "2026-11-05T09:00:00Z",
    actor: "u-cor",
    action: "user_banned",
    target: user("u-bram"),
  },
  {
    id: uuid(3),
    at: "2026-11-05T09:00:00Z",
    actor: "u-cor",
    action: "authz_role_change",
    outcome: "refused",
    target: user("u-cor"),
  },
  {
    id: uuid(4),
    at: "2026-11-10T22:59:59Z",
    actor: "anonymous",
    action: "authn_login_fail",
    outcome: "failure",
  },
  { id: uuid(5), at: "2026-11-10T23:00:00Z", actor: "u-bram", target: user("u-bram") },
  {
    id: uuid(6),
    at: "2026-11-11T08:00:00Z",
    actor: "system",
    action: "session_expired",
    target: { type: "session", id: "s-1" },
  },
];

async function ids(input: ListActivityInput): Promise<string[]> {
  const database = db ?? (await seed(EVENTS));
  const page = await readActivityLog(database, ADMIN, input);
  return page.rows.map((row) => row.id);
}

describe("readActivityLog: order and pages (#36)", () => {
  it("shows the newest event first, with the id as tie-break in the same direction", async () => {
    expect(await ids({})).toEqual([uuid(6), uuid(5), uuid(4), uuid(3), uuid(2), uuid(1)]);
  });

  it("shows the oldest first when asked, the tie-break following", async () => {
    expect(await ids({ dir: "asc" })).toEqual([
      uuid(1),
      uuid(2),
      uuid(3),
      uuid(4),
      uuid(5),
      uuid(6),
    ]);
  });

  it("pages with limit and offset and counts the whole filtered list", async () => {
    const database = await seed(EVENTS);
    const page = await readActivityLog(database, ADMIN, { size: 25, page: 1 });
    expect(page).toMatchObject({ total: 6, page: 1, size: 25 });
    const second = await readActivityLog(database, ADMIN, { size: 25, page: 2 });
    expect(second.rows).toEqual([]);
    expect(second.total).toBe(6);
  });

  it("returns an empty page and zero counts for an empty log", async () => {
    const database = await seed([]);
    const page = await readActivityLog(database, ADMIN, {});
    expect(page).toMatchObject({ rows: [], total: 0, facets: { action: {} } });
    expect(page.facets.outcome).toEqual({ success: 0, failure: 0, refused: 0 });
  });
});

describe("readActivityLog: filters (#36)", () => {
  it("filters on the actor's id", async () => {
    expect(await ids({ actor: "u-cor" })).toEqual([uuid(3), uuid(2)]);
  });

  it("filters on a target user's id, never on another kind of target with that id", async () => {
    const database = await seed([
      ...EVENTS,
      {
        id: uuid(7),
        at: "2026-11-11T09:00:00Z",
        action: "session_revoked",
        target: { type: "session", id: "u-bram" },
      },
    ]);
    const page = await readActivityLog(database, ADMIN, { target: "u-bram" });
    expect(page.rows.map((row) => row.id)).toEqual([uuid(5), uuid(2)]);
  });

  it("filters on any of the chosen actions", async () => {
    expect(await ids({ action: ["user_banned", "session_expired"] })).toEqual([uuid(6), uuid(2)]);
  });

  it("filters on any of the chosen outcomes", async () => {
    expect(await ids({ outcome: ["failure", "refused"] })).toEqual([uuid(4), uuid(3)]);
  });

  it("reads the period as whole days in Europe/Amsterdam", async () => {
    // 2026-11-10T23:00Z is midnight at the start of 11 November in Amsterdam.
    expect(await ids({ from: "2026-11-11" })).toEqual([uuid(6), uuid(5)]);
    expect(await ids({ to: "2026-11-10" })).toEqual([uuid(4), uuid(3), uuid(2), uuid(1)]);
    expect(await ids({ from: "2026-11-05", to: "2026-11-05" })).toEqual([uuid(3), uuid(2)]);
  });

  it("combines every filter with AND", async () => {
    expect(
      await ids({
        actor: "u-cor",
        target: "u-bram",
        action: ["user_banned", "authz_role_change"],
        outcome: ["success"],
        from: "2026-11-05",
        to: "2026-11-05",
      }),
    ).toEqual([uuid(2)]);
    expect(await ids({ actor: "u-cor", outcome: ["failure"] })).toEqual([]);
  });

  it("counts each facet under the other filters but not its own choice", async () => {
    const database = await seed(EVENTS);
    const page = await readActivityLog(database, ADMIN, {
      actor: "u-cor",
      action: ["user_banned"],
      outcome: ["success"],
    });
    expect(page.rows.map((row) => row.id)).toEqual([uuid(2)]);
    expect(page.total).toBe(1);
    // The action facet ignores the chosen action but keeps the outcome: one success per action.
    expect(page.facets.action).toEqual({ user_banned: 1 });
    // The outcome facet ignores the chosen outcome but keeps the action.
    expect(page.facets.outcome).toEqual({ success: 1, failure: 0, refused: 0 });
    const wide = await readActivityLog(database, ADMIN, { actor: "u-cor" });
    expect(wide.facets.action).toEqual({ user_banned: 1, authz_role_change: 1 });
    expect(wide.facets.outcome).toEqual({ success: 1, failure: 0, refused: 1 });
  });
});

describe("readActivityLog: what a row shows (#36)", () => {
  it("names the user actor and target, and keeps system, anonymous and other targets apart", async () => {
    const database = await seed(EVENTS);
    const page = await readActivityLog(database, ADMIN, {});
    const byId = new Map(page.rows.map((row) => [row.id, row]));
    expect(byId.get(uuid(2))).toMatchObject({
      action: "user_banned",
      outcome: "success",
      actor: { type: "user", id: "u-cor", name: "Cor 100%_Admin" },
      target: { type: "user", id: "u-bram", name: "Bram de Vries" },
    });
    expect(byId.get(uuid(4))).toMatchObject({ actor: { type: "anonymous" }, target: null });
    expect(byId.get(uuid(6))).toMatchObject({
      actor: { type: "system" },
      target: { type: "session", id: "s-1" },
    });
  });

  it("shows no name for a user who no longer exists, and the names of the filters", async () => {
    const database = await seed([
      { id: uuid(1), at: "2026-11-01T09:00:00Z", actor: "u-gone", target: user("u-gone") },
    ]);
    const page = await readActivityLog(database, ADMIN, { actor: "u-gone", target: "u-anna" });
    expect(page.filterUsers).toEqual({
      actor: { id: "u-gone", name: null },
      target: { id: "u-anna", name: "Anna Bakker" },
    });
    const all = await readActivityLog(database, ADMIN, {});
    expect(all.rows[0]?.actor).toEqual({ type: "user", id: "u-gone", name: null });
  });

  it("returns the reason, provider and metadata, and marks metadata it cannot read", async () => {
    const database = await seed([
      {
        id: uuid(1),
        at: "2026-11-01T09:00:00Z",
        action: "authz_role_change",
        target: user("u-bram"),
        reason: "role_conflict",
        provider: "keycloak",
        metadata: { roles: "teacher,admin", previous_roles: "student" },
      },
      { id: uuid(2), at: "2026-11-02T09:00:00Z", metadata: { name: "not allowed here" } },
      { id: uuid(3), at: "2026-11-03T09:00:00Z", action: "sample_registered" },
    ]);
    const page = await readActivityLog(database, ADMIN, { dir: "asc" });
    expect(page.rows.map((row) => [row.reason, row.provider, row.metadata, row.action])).toEqual([
      [
        "role_conflict",
        "keycloak",
        { roles: "teacher,admin", previous_roles: "student" },
        "authz_role_change",
      ],
      [null, null, "unreadable", "authn_login_success"],
      [null, null, null, null],
    ]);
  });

  it("returns ISO instants and no column the screen does not show", async () => {
    const database = await seed(EVENTS.slice(0, 1));
    const page = await readActivityLog(database, ADMIN, {});
    expect(Object.keys(page.rows[0] ?? {}).sort()).toEqual([
      "action",
      "actor",
      "id",
      "metadata",
      "occurredAt",
      "outcome",
      "provider",
      "reason",
      "target",
    ]);
    expect(page.rows[0]?.occurredAt).toBe("2026-11-01T09:00:00.000Z");
  });
});

describe("the activity log refuses callers without the admin role (A01)", () => {
  it.each([
    ["student", ["student"]],
    ["teacher", ["teacher"]],
  ] as const)("a %s gets 403 from the list and the user search", async (_name, roles) => {
    const database = await seed(EVENTS);
    const list = readActivityLog(database, { roles }, {});
    await expect(list).rejects.toThrow(AuthError);
    await expect(list).rejects.toMatchObject({ status: 403 });
    const users = searchActivityUsers(database, { roles }, { q: "Anna" });
    await expect(users).rejects.toMatchObject({ status: 403 });
  });

  it("lets a teacher-admin read it (ADR 0012)", async () => {
    const database = await seed(EVENTS);
    const page = await readActivityLog(database, { roles: ["teacher", "admin"] }, {});
    expect(page.total).toBe(6);
  });
});

describe("searchActivityUsers (#36)", () => {
  it("finds users by part of the name or e-mail address, by name", async () => {
    const database = await seed([]);
    expect(await searchActivityUsers(database, ADMIN, { q: "br" })).toEqual([
      { id: "u-bram", name: "Bram de Vries", email: "bram@example.test" },
    ]);
    const all = await searchActivityUsers(database, ADMIN, { q: "example.test" });
    expect(all.map((match) => match.id)).toEqual(["u-anna", "u-bram", "u-cor"]);
  });

  it("matches % and _ literally", async () => {
    const database = await seed([]);
    expect((await searchActivityUsers(database, ADMIN, { q: "100%_" })).map((u) => u.id)).toEqual([
      "u-cor",
    ]);
    expect(await searchActivityUsers(database, ADMIN, { q: "%" })).toEqual([
      expect.objectContaining({ id: "u-cor" }),
    ]);
  });

  it("returns at most eight users", async () => {
    const database = await seed([]);
    await database
      .insertInto("user")
      .values(
        Array.from({ length: 12 }, (_, i) => ({
          id: `u-many-${i}`,
          name: `Many ${String(i).padStart(2, "0")}`,
          email: `many${i}@example.test`,
          emailVerified: true,
          role: "student",
        })),
      )
      .execute();
    expect(await searchActivityUsers(database, ADMIN, { q: "Many" })).toHaveLength(8);
  });
});

describe("Q-PERF-1: the list and its facets over about 10,000 events", () => {
  it("reads in under 500 ms, filtered and unfiltered", async () => {
    const database = await seed([]);
    await sql`
      insert into audit_event (occurred_at, actor_type, actor_id, action, target_type, target_id, outcome)
      select timestamptz '2026-11-11T12:00:00Z' - g * interval '52 minutes',
             case when g % 10 = 0 then 'anonymous' else 'user' end,
             case when g % 10 = 0 then null else (array['u-anna','u-bram','u-cor'])[g % 3 + 1] end,
             (array['authn_login_success','authn_logout','authn_login_fail','user_banned'])[g % 4 + 1],
             case when g % 10 = 0 then null else 'user' end,
             case when g % 10 = 0 then null else (array['u-anna','u-bram','u-cor'])[g % 3 + 1] end,
             (array['success','success','failure','refused'])[g % 4 + 1]
      from generate_series(1, 10000) g`.execute(database);
    await sql`analyze audit_event`.execute(database);

    const inputs: ListActivityInput[] = [
      {},
      { page: 200, size: 25 },
      { actor: "u-bram", outcome: ["success"] },
      { target: "u-cor", dir: "asc" },
      { action: ["authn_login_fail", "user_banned"], from: "2026-06-01", to: "2026-09-30" },
    ];
    for (const input of inputs) {
      const started = performance.now();
      const page = await readActivityLog(database, ADMIN, input);
      const elapsed = performance.now() - started;
      expect(page.total).toBeGreaterThan(0);
      expect(elapsed, JSON.stringify(input)).toBeLessThan(500);
    }
  });
});
