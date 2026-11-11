// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { providerIdOf } from "../../lib/identity-providers.ts";
import { CREDENTIAL_SIGN_IN, type SignInMethod } from "../../lib/sign-in-method.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import {
  containsPattern,
  listUsers,
  roleValuesWith,
  roleValuesWithAny,
  userFacets,
  userStatus,
} from "./queries.ts";
import type { ListUsersInput } from "./schemas.ts";

const MICROSOFT = providerIdOf("microsoft");
const KEYCLOAK = providerIdOf("keycloak");
const CREDENTIAL = CREDENTIAL_SIGN_IN;

const NOW = new Date("2026-11-11T12:00:00Z");
const DAY = 86_400_000;

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

interface Person {
  id: string;
  name: string;
  role: string;
  source?: string;
  banned?: boolean;
  banExpires?: Date | null;
  lastSignInAt?: Date | null;
  providers?: string[];
  liveSessions?: number;
}

async function seed(people: readonly Person[]): Promise<Kysely<DB>> {
  const database = await createTestDb();
  db = database;
  await database
    .insertInto("user")
    .values(
      people.map((p) => ({
        id: p.id,
        name: p.name,
        email: `${p.id}@example.test`,
        emailVerified: true,
        role: p.role,
        role_source: p.source ?? "local",
        banned: p.banned ?? false,
        banExpires: p.banExpires ?? null,
        last_sign_in_at: p.lastSignInAt ?? null,
        createdAt: NOW,
      })),
    )
    .execute();
  const accounts = people.flatMap((p) =>
    (p.providers ?? []).map((providerId) => ({
      id: `${p.id}-${providerId}`,
      userId: p.id,
      providerId,
      accountId: `${p.id}-subject`,
      updatedAt: NOW,
    })),
  );
  if (accounts.length > 0) await database.insertInto("account").values(accounts).execute();
  const sessions = people.flatMap((p) =>
    Array.from({ length: p.liveSessions ?? 0 }, (_, i) => ({
      id: `${p.id}-s${i}`,
      userId: p.id,
      token: `${p.id}-t${i}`,
      expiresAt: new Date(NOW.getTime() + DAY),
      updatedAt: NOW,
    })),
  );
  if (sessions.length > 0) {
    // One expired session per seeded user with live ones: never counted.
    await database
      .insertInto("session")
      .values([
        ...sessions,
        ...people
          .filter((p) => (p.liveSessions ?? 0) > 0)
          .map((p) => ({
            id: `${p.id}-old`,
            userId: p.id,
            token: `${p.id}-old`,
            expiresAt: new Date(NOW.getTime() - DAY),
            updatedAt: NOW,
          })),
      ])
      .execute();
  }
  return database;
}

const PEOPLE: Person[] = [
  {
    id: "u1",
    name: "Anna Bakker",
    role: "student",
    source: MICROSOFT,
    lastSignInAt: new Date(NOW.getTime() - DAY),
    providers: [MICROSOFT],
    liveSessions: 2,
  },
  {
    id: "u2",
    name: "Bram de Vries",
    role: "teacher",
    lastSignInAt: new Date(NOW.getTime() - 2 * DAY),
    providers: [KEYCLOAK, MICROSOFT],
  },
  { id: "u3", name: "Cor 100%_Test", role: "teacher,admin", providers: [KEYCLOAK] },
  {
    id: "u4",
    name: "Daan Smit",
    role: "student",
    banned: true,
    banExpires: new Date(NOW.getTime() + 3 * DAY),
    lastSignInAt: new Date(NOW.getTime() - 9 * DAY),
    providers: [MICROSOFT],
  },
  {
    id: "u5",
    name: "Eva Visser",
    role: "admin",
    banned: true,
    banExpires: new Date(NOW.getTime() - DAY),
    lastSignInAt: new Date(NOW.getTime() - 20 * DAY),
    providers: ["credential"],
  },
  { id: "u6", name: "Fenna Mulder", role: "student", banned: true, banExpires: null },
];

const ids = (page: { rows: { id: string }[] }) => page.rows.map((row) => row.id);

describe("pure helpers", () => {
  it("roleValuesWith lists every allowed stored set holding the role (ADR 0012)", () => {
    expect(roleValuesWith("teacher")).toEqual(["teacher", "teacher,admin"]);
    expect(roleValuesWith("admin")).toEqual(["admin", "teacher,admin"]);
    expect(roleValuesWith("student")).toEqual(["student"]);
  });

  it("roleValuesWithAny lists the stored sets holding any of the roles, once each", () => {
    expect(roleValuesWithAny(["teacher", "admin"])).toEqual(["teacher", "teacher,admin", "admin"]);
    expect(roleValuesWithAny(["student"])).toEqual(["student"]);
  });

  it("containsPattern escapes LIKE wildcards (A05)", () => {
    expect(containsPattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
  });

  it("userStatus: blocked while a ban lasts, then by the last sign-in", () => {
    const later = new Date(NOW.getTime() + DAY);
    const earlier = new Date(NOW.getTime() - DAY);
    expect(userStatus({ banned: true, banExpires: null, lastSignInAt: NOW }, NOW)).toBe("blocked");
    expect(userStatus({ banned: true, banExpires: later, lastSignInAt: null }, NOW)).toBe(
      "blocked",
    );
    expect(userStatus({ banned: true, banExpires: earlier, lastSignInAt: NOW }, NOW)).toBe(
      "active",
    );
    expect(userStatus({ banned: false, banExpires: null, lastSignInAt: null }, NOW)).toBe("never");
  });
});

describe("listUsers (#34)", () => {
  it("returns the first page sorted by name with the row shape the table shows", async () => {
    const database = await seed(PEOPLE);
    const page = await listUsers(database, {}, NOW);
    expect(page.total).toBe(6);
    expect(ids(page)).toEqual(["u1", "u2", "u3", "u4", "u5", "u6"]);
    expect(page.rows[0]).toEqual({
      id: "u1",
      name: "Anna Bakker",
      email: "u1@example.test",
      roles: ["student"],
      roleSource: MICROSOFT,
      providers: [MICROSOFT],
      status: "active",
      blockedUntil: null,
      lastSignInAt: new Date(NOW.getTime() - DAY).toISOString(),
      activeSessions: 2,
    });
    expect(page.rows[3]).toMatchObject({
      status: "blocked",
      blockedUntil: new Date(NOW.getTime() + 3 * DAY).toISOString(),
    });
    expect(page.rows[1]?.providers.sort()).toEqual([KEYCLOAK, MICROSOFT]);
  });

  it("returns no grade, result or submission field (R-01)", async () => {
    const database = await seed(PEOPLE);
    const page = await listUsers(database, {}, NOW);
    expect(Object.keys(page.rows[0] ?? {}).sort()).toEqual(
      [
        "activeSessions",
        "blockedUntil",
        "email",
        "id",
        "lastSignInAt",
        "name",
        "providers",
        "roleSource",
        "roles",
        "status",
      ].sort(),
    );
  });

  it("searches name and e-mail, case-insensitive, with wildcards taken literally", async () => {
    const database = await seed(PEOPLE);
    expect(ids(await listUsers(database, { q: "BAKKER" }, NOW))).toEqual(["u1"]);
    expect(ids(await listUsers(database, { q: "u2@example" }, NOW))).toEqual(["u2"]);
    expect(ids(await listUsers(database, { q: "100%_" }, NOW))).toEqual(["u3"]);
    expect(ids(await listUsers(database, { q: "%" }, NOW))).toEqual(["u3"]);
  });

  it("filters on a role inside a role set", async () => {
    const database = await seed(PEOPLE);
    expect(ids(await listUsers(database, { role: ["teacher"] }, NOW))).toEqual(["u2", "u3"]);
    expect(ids(await listUsers(database, { role: ["admin"] }, NOW))).toEqual(["u3", "u5"]);
  });

  it("filters on a linked sign-in provider", async () => {
    const database = await seed(PEOPLE);
    expect(ids(await listUsers(database, { provider: [KEYCLOAK] }, NOW))).toEqual(["u2", "u3"]);
    expect(ids(await listUsers(database, { provider: ["credential"] }, NOW))).toEqual(["u5"]);
  });

  it("filters on the status, an expired ban counting as not blocked", async () => {
    const database = await seed(PEOPLE);
    expect(ids(await listUsers(database, { status: ["blocked"] }, NOW))).toEqual(["u4", "u6"]);
    expect(ids(await listUsers(database, { status: ["never"] }, NOW))).toEqual(["u3"]);
    expect(ids(await listUsers(database, { status: ["active"] }, NOW))).toEqual(["u1", "u2", "u5"]);
  });

  it("combines filters", async () => {
    const database = await seed(PEOPLE);
    expect(
      ids(await listUsers(database, { role: ["student"], provider: [MICROSOFT], q: "a" }, NOW)),
    ).toEqual(["u1", "u4"]);
  });

  it("sorts by the last sign-in with never-signed-in users last in both directions", async () => {
    const database = await seed(PEOPLE);
    expect(ids(await listUsers(database, { sort: "lastSignIn", dir: "desc" }, NOW))).toEqual([
      "u1",
      "u2",
      "u4",
      "u5",
      "u3",
      "u6",
    ]);
    expect(ids(await listUsers(database, { sort: "lastSignIn", dir: "asc" }, NOW))).toEqual([
      "u5",
      "u4",
      "u2",
      "u1",
      "u3",
      "u6",
    ]);
    expect(ids(await listUsers(database, { sort: "name", dir: "desc" }, NOW))).toEqual([
      "u6",
      "u5",
      "u4",
      "u3",
      "u2",
      "u1",
    ]);
  });

  it("paginates on the server and keeps the total past the last page", async () => {
    const database = await seed(PEOPLE);
    const second = await listUsers(database, { size: 10, page: 1 }, NOW);
    expect(second.rows).toHaveLength(6);
    const beyond = await listUsers(database, { size: 10, page: 3 }, NOW);
    expect(beyond).toMatchObject({ rows: [], total: 6, page: 3, size: 10 });
    const empty = await listUsers(database, { q: "nobody-matches" }, NOW);
    expect(empty).toMatchObject({ rows: [], total: 0 });
  });

  it("reads one page of 1,200 users with accounts and sessions well within 2 s (Q-PERF-1)", async () => {
    const many: Person[] = Array.from({ length: 1200 }, (_, i) => ({
      id: `p${String(i).padStart(4, "0")}`,
      name: `Person ${i}`,
      role: i % 10 === 0 ? "teacher" : "student",
      providers: [i % 3 === 0 ? KEYCLOAK : MICROSOFT],
      liveSessions: i % 4 === 0 ? 1 : 0,
      lastSignInAt: i % 5 === 0 ? null : new Date(NOW.getTime() - i * 60_000),
    }));
    const database = await seed(many);
    const started = performance.now();
    const page = await listUsers(
      database,
      { q: "person", status: ["active"], provider: [MICROSOFT], sort: "lastSignIn", size: 100 },
      NOW,
    );
    const elapsed = performance.now() - started;
    expect(page.rows).toHaveLength(100);
    expect(page.total).toBeGreaterThan(500);
    // The query is one part of a page load; the e2e suite times the whole page.
    expect(elapsed).toBeLessThan(500);
  });
});

describe("listUsers with multi-select facets (#58)", () => {
  it("matches any of the chosen values of one facet", async () => {
    const database = await seed(PEOPLE);
    expect(ids(await listUsers(database, { role: ["student", "admin"] }, NOW))).toEqual([
      "u1",
      "u3",
      "u4",
      "u5",
      "u6",
    ]);
    expect(ids(await listUsers(database, { provider: [KEYCLOAK, "credential"] }, NOW))).toEqual([
      "u2",
      "u3",
      "u5",
    ]);
    expect(ids(await listUsers(database, { status: ["blocked", "never"] }, NOW))).toEqual([
      "u3",
      "u4",
      "u6",
    ]);
  });

  it("combines facets with AND and counts a user with two providers once", async () => {
    const database = await seed(PEOPLE);
    const page = await listUsers(
      database,
      { role: ["teacher"], provider: [KEYCLOAK, MICROSOFT], status: ["active"] },
      NOW,
    );
    expect(ids(page)).toEqual(["u2"]);
    expect(page.total).toBe(1);
  });
});

const ALL_PROVIDERS: SignInMethod[] = [MICROSOFT, KEYCLOAK, CREDENTIAL];

describe("userFacets (#58)", () => {
  it("counts every value over all users without filters", async () => {
    const database = await seed(PEOPLE);
    expect(await userFacets(database, {}, NOW, ALL_PROVIDERS)).toEqual({
      role: { student: 3, teacher: 2, admin: 2 },
      provider: { microsoft: 3, keycloak: 2, credential: 1 },
      status: { active: 3, blocked: 2, never: 1 },
    });
  });

  it("applies the search and the other facets, never the facet's own choice", async () => {
    const database = await seed(PEOPLE);
    const facets = await userFacets(
      database,
      { q: "a", role: ["student"], status: ["blocked"] },
      NOW,
      ALL_PROVIDERS,
    );
    // Search "a": every name but "Cor 100%_Test" has an "a". Role ignores its own choice.
    expect(facets.role).toEqual({ student: 2, teacher: 0, admin: 0 });
    expect(facets.status).toEqual({ active: 1, blocked: 2, never: 0 });
    expect(facets.provider).toEqual({ microsoft: 1, keycloak: 0, credential: 0 });
  });

  it("counts only the sign-in methods the facet offers", async () => {
    const database = await seed(PEOPLE);
    const facets = await userFacets(database, {}, NOW, [KEYCLOAK]);
    expect(facets.provider).toEqual({ keycloak: 2 });
  });

  it.each<[string, ListUsersInput]>([
    ["no filter", {}],
    ["a search", { q: "e" }],
    ["two facets", { role: ["teacher", "student"], provider: [MICROSOFT] }],
    ["every facet", { q: "a", role: ["student"], provider: [MICROSOFT], status: ["active"] }],
  ])("agrees with the list's total for each value, with %s", async (_, input) => {
    const database = await seed(PEOPLE);
    const facets = await userFacets(database, input, NOW, ALL_PROVIDERS);
    for (const role of ["student", "teacher", "admin"] as const) {
      const page = await listUsers(database, { ...input, role: [role] }, NOW);
      expect(facets.role[role], role).toBe(page.total);
    }
    for (const provider of ALL_PROVIDERS) {
      const page = await listUsers(database, { ...input, provider: [provider] }, NOW);
      expect(facets.provider[provider], provider).toBe(page.total);
    }
    for (const status of ["active", "blocked", "never"] as const) {
      const page = await listUsers(database, { ...input, status: [status] }, NOW);
      expect(facets.status[status], status).toBe(page.total);
    }
  });

  it("returns counts only, no field about a person (R-01)", async () => {
    const database = await seed(PEOPLE);
    const facets = await userFacets(database, {}, NOW, ALL_PROVIDERS);
    expect(Object.keys(facets).sort()).toEqual(["provider", "role", "status"]);
    for (const values of Object.values(facets)) {
      for (const count of Object.values(values)) expect(typeof count).toBe("number");
    }
  });

  it("counts the facets of 1,200 users well within 2 s (Q-PERF-1)", async () => {
    const many: Person[] = Array.from({ length: 1200 }, (_, i) => ({
      id: `p${String(i).padStart(4, "0")}`,
      name: `Person ${i}`,
      role: i % 10 === 0 ? "teacher" : "student",
      providers: [i % 3 === 0 ? KEYCLOAK : MICROSOFT],
      lastSignInAt: i % 5 === 0 ? null : new Date(NOW.getTime() - i * 60_000),
    }));
    const database = await seed(many);
    const input: ListUsersInput = { q: "person", role: ["student"], status: ["active"] };
    const started = performance.now();
    const [page, facets] = await Promise.all([
      listUsers(database, { ...input, size: 100 }, NOW),
      userFacets(database, input, NOW, ALL_PROVIDERS),
    ]);
    const elapsed = performance.now() - started;
    expect(page.rows).toHaveLength(100);
    expect(facets.role.student + facets.role.teacher).toBeGreaterThan(900);
    expect(elapsed).toBeLessThan(500);
  });
});
