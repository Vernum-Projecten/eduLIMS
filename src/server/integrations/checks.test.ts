// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDULIMS_TEMPLATE_ID } from "../../lib/integrations.ts";
import type { Role } from "../../lib/roles.ts";
import { readActivityLog } from "../activity/queries.ts";
import { INTEGRATION_CHECK_LOCK_KEY } from "../db/advisory-locks.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb, testDatabaseUrl } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { TEST_OPENEHR_CONFIG, testOpenEhrClient } from "../openehr/test-client.ts";
import {
  CHECK_INTERVAL_MS,
  checkAndStore,
  checkNow,
  readStatus,
  runScheduledCheck,
  startCheckSchedule,
} from "./checks.ts";
import type { ProbeDeps, ProbeFetch } from "./probe.ts";
import { integrationStatusInput } from "./schemas.ts";
import { readIntegrationStatus } from "./store.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
const ENV = {
  FERROEHR_BASE_URL: "http://ferroehr.test/ferroehr/rest/openehr/v1",
  FERROBRIDGE_BASE_URL: "http://ferrobridge.test:8080",
};

let db: Kysely<DB> | undefined;
let lockHolder: Client | undefined;

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await lockHolder?.end();
  lockHolder = undefined;
  await db?.destroy();
  db = undefined;
});

const TEMPLATES_URL = `${ENV.FERROEHR_BASE_URL}/definition/template/adl1.4`;

/**
 * A fetch where FerroEHR answers every call with `ehr` (a 200 holds the eduLIMS template), the
 * token endpoint grants a token, and FerroBRIDGE answers `bridge`.
 */
function services(ehr: number | "down", bridge: number | "down") {
  return vi.fn<ProbeFetch>((url) => {
    if (url.href === TEST_OPENEHR_CONFIG.tokenUrl.href) {
      return Promise.resolve(Response.json({ access_token: "t", token_type: "Bearer" }));
    }
    const status = url.hostname === "ferroehr.test" ? ehr : bridge;
    if (status === "down") return Promise.reject(new TypeError("fetch failed"));
    if (url.href === TEMPLATES_URL && status === 200) {
      return Promise.resolve(
        Response.json([
          {
            template_id: EDULIMS_TEMPLATE_ID,
            concept: "c",
            archetype_id: "a",
            created_timestamp: "2026-11-01T00:00:00Z",
          },
        ]),
      );
    }
    return Promise.resolve(new Response("{}", { status }));
  });
}

function deps(fetch: ProbeFetch, now = NOW): ProbeDeps {
  const openEhr = testOpenEhrClient(fetch, { baseUrl: ENV.FERROEHR_BASE_URL });
  return { openEhr, fetch, now: () => now, elapsed: () => 0 };
}

async function context(fetch: ProbeFetch, now = NOW) {
  db ??= await createTestDb();
  return { db, env: ENV, deps: deps(fetch, now) };
}

const ADMIN: { id: string; roles: Role[] } = { id: "u-check-admin", roles: ["admin"] };
const SYSTEM = { type: "system" } as const;

/** Adds the administrator of {@link ADMIN} as a user, with an invented name. */
async function addAdmin(database: Kysely<DB>): Promise<void> {
  await database
    .insertInto("user")
    .values({
      id: ADMIN.id,
      name: "Ada Admin",
      email: "check-admin@example.test",
      emailVerified: true,
      role: "admin",
    })
    .execute();
}

describe("checkAndStore (B3)", () => {
  it("stores the state of each integration", async () => {
    const ctx = await context(services(200, "down"));
    await checkAndStore(ctx, SYSTEM);
    const page = await readIntegrationStatus(ctx.db, NOW);
    expect(page.integrations.map((i) => [i.integration, i.state, i.errorClass])).toEqual([
      ["ferroehr", "available", null],
      ["ferrobridge", "unavailable", "unreachable"],
    ]);
  });

  it("a stopped service shows Unavailable on the next check, and Available after a restart (B3)", async () => {
    const ctx = await context(services(200, 200));
    await checkAndStore(ctx, SYSTEM);
    const stopped = await context(services("down", 200), new Date(NOW.getTime() + 60_000));
    await checkAndStore(stopped, SYSTEM);
    let ferroehr = (await readIntegrationStatus(ctx.db, NOW)).integrations[0];
    expect(ferroehr).toMatchObject({
      state: "unavailable",
      lastSuccessAt: NOW.toISOString(),
      errorClass: "unreachable",
    });
    const restarted = new Date(NOW.getTime() + 120_000);
    await checkAndStore(await context(services(200, 200), restarted), SYSTEM);
    ferroehr = (await readIntegrationStatus(ctx.db, restarted)).integrations[0];
    expect(ferroehr).toMatchObject({ state: "available", lastSuccessAt: restarted.toISOString() });
  });

  it("stores and shows a refused FerroEHR as refused, keeping its last success (#35)", async () => {
    const ctx = await context(services(200, 200));
    await checkAndStore(ctx, SYSTEM);
    const later = new Date(NOW.getTime() + 60_000);
    await checkAndStore(await context(services(401, 200), later), SYSTEM);
    const ferroehr = (await readIntegrationStatus(ctx.db, later)).integrations[0];
    expect(ferroehr).toMatchObject({
      state: "refused",
      errorClass: "auth_refused",
      lastSuccessAt: NOW.toISOString(),
    });
  });

  it("the database refuses a refused state without its error class", async () => {
    const ctx = await context(services(200, 200));
    await expect(
      ctx.db
        .insertInto("integration_checks")
        .values({
          integration: "ferroehr",
          state: "refused",
          checked_at: NOW,
          error_class: "http_client_error",
        })
        .execute(),
    ).rejects.toThrow(/integration_checks_refused/);
  });

  it("keeps a newer result when an older one finishes last", async () => {
    const later = new Date(NOW.getTime() + 60_000);
    const ctx = await context(services(500, 500), later);
    await checkAndStore(ctx, SYSTEM);
    await checkAndStore(await context(services(200, 200), NOW), SYSTEM);
    const page = await readIntegrationStatus(ctx.db, later);
    expect(page.integrations.map((i) => i.state)).toEqual(["unavailable", "unavailable"]);
  });
});

describe("readIntegrationStatus (B3)", () => {
  it("shows an integration that was never checked as not checked", async () => {
    db = await createTestDb();
    const page = await readIntegrationStatus(db, NOW);
    expect(page.integrations.map((i) => [i.integration, i.state])).toEqual([
      ["ferroehr", "not_checked"],
      ["ferrobridge", "not_checked"],
    ]);
    expect(page.readAt).toBe(NOW.toISOString());
  });

  it("shows a check older than five minutes as unknown, never as available", async () => {
    const ctx = await context(services(200, 200));
    await checkAndStore(ctx, SYSTEM);
    const page = await readIntegrationStatus(ctx.db, new Date(NOW.getTime() + 5 * 60_000 + 1));
    expect(page.integrations.map((i) => i.state)).toEqual(["unknown", "unknown"]);
  });
});

describe("runScheduledCheck (B3)", () => {
  it("checks when no recent result exists", async () => {
    const fetch = services(200, 200);
    const outcome = await runScheduledCheck(await context(fetch));
    expect(outcome.checked).toBe(true);
    // FerroEHR's manifest, the token, the template list (#227), and FerroBRIDGE.
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("skips while another replica's result is younger than half the interval", async () => {
    await runScheduledCheck(await context(services(200, 200)));
    const fetch = services(200, 200);
    const soon = new Date(NOW.getTime() + CHECK_INTERVAL_MS / 2 - 1);
    expect(await runScheduledCheck(await context(fetch, soon))).toEqual({
      checked: false,
      reason: "recent",
    });
    expect(fetch).not.toHaveBeenCalled();
    const due = new Date(NOW.getTime() + CHECK_INTERVAL_MS);
    expect((await runScheduledCheck(await context(fetch, due))).checked).toBe(true);
  });

  it("skips while another replica holds the advisory lock", async () => {
    const ctx = await context(services(200, 200));
    lockHolder = new Client({ connectionString: testDatabaseUrl() });
    await lockHolder.connect();
    await lockHolder.query("select pg_advisory_lock($1)", [INTEGRATION_CHECK_LOCK_KEY]);
    expect(await runScheduledCheck(ctx)).toEqual({ checked: false, reason: "locked" });
  });
});

describe("checkNow and readStatus (B3, A01)", () => {
  it("lets an administrator check now and returns the new status", async () => {
    const ctx = await context(services(200, 503));
    const page = await checkNow({ ...ctx, actor: ADMIN });
    expect(page.integrations.map((i) => [i.state, i.errorClass])).toEqual([
      ["available", null],
      ["unavailable", "http_server_error"],
    ]);
    expect((await readStatus({ db: ctx.db, actor: ADMIN }, NOW)).integrations).toEqual(
      page.integrations,
    );
  });

  it.each([
    ["a student", ["student"]],
    ["a teacher", ["teacher"]],
  ] as const)("refuses %s with 403 for the status and for Check now", async (_name, roles) => {
    const fetch = services(200, 200);
    const ctx = await context(fetch);
    const actor = { id: "u-not-admin", roles: [...roles] };
    for (const call of [
      () => checkNow({ ...ctx, actor }),
      () => readStatus({ db: ctx.db, actor }, NOW),
    ]) {
      const error: unknown = await call().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ status: 403 });
    }
    expect(fetch).not.toHaveBeenCalled();
    const stored = await readIntegrationStatus(ctx.db, NOW);
    expect(stored.integrations.map((i) => i.state)).toEqual(["not_checked", "not_checked"]);
  });
});

describe("who the activity log names for a change of state (B4, #247)", () => {
  it("names the administrator who pressed Check now, with their name on the activity log", async () => {
    const ctx = await context(services(200, 503));
    await addAdmin(ctx.db);
    await checkNow({ ...ctx, actor: ADMIN });
    const log = await readActivityLog(ctx.db, ADMIN, { action: ["integration_state_changed"] });
    expect(log.rows.map((row) => [row.target?.id, row.actor])).toEqual(
      expect.arrayContaining([
        ["ferroehr", { type: "user", id: ADMIN.id, name: "Ada Admin" }],
        ["ferrobridge", { type: "user", id: ADMIN.id, name: "Ada Admin" }],
      ]),
    );
    expect(log.rows).toHaveLength(2);
  });

  it("names eduLIMS (the system) for a change the scheduled check found", async () => {
    const ctx = await context(services(200, 503));
    expect((await runScheduledCheck(ctx)).checked).toBe(true);
    const log = await readActivityLog(ctx.db, ADMIN, { action: ["integration_state_changed"] });
    expect(log.rows.map((row) => row.actor)).toEqual([{ type: "system" }, { type: "system" }]);
  });
});

describe("no request can change a target (SSRF, ASVS V1.3.6)", () => {
  it("Check now calls only URLs from the configuration", async () => {
    const fetch = services(200, 200);
    await checkNow({ ...(await context(fetch)), actor: ADMIN });
    expect(fetch.mock.calls.map(([url]) => url.href).sort()).toEqual(
      [
        "http://ferrobridge.test:8080/health/readiness",
        ENV.FERROEHR_BASE_URL,
        TEMPLATES_URL,
        TEST_OPENEHR_CONFIG.tokenUrl.href,
      ].sort(),
    );
  });

  it.each([
    [{ url: "http://169.254.169.254/latest/meta-data" }],
    [{ host: "internal.test" }],
    [{ integration: "ferroehr", path: "/admin" }],
  ])("the input schema refuses %j", (input) => {
    expect(integrationStatusInput.safeParse(input).success).toBe(false);
  });

  it("the input schema accepts only an empty object", () => {
    expect(integrationStatusInput.safeParse({}).success).toBe(true);
  });
});

describe("startCheckSchedule (B3)", () => {
  it("runs at once, then once per interval, and stops", async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => Promise.resolve());
    const stop = startCheckSchedule(run, 1_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(run).toHaveBeenCalledTimes(4);
    stop();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("does not start a run while the last one is busy", async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const stop = startCheckSchedule(run, 1_000);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("logs a failed run by its class only and keeps the schedule", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const run = vi.fn(() => Promise.reject(new TypeError("password=secret")));
    const stop = startCheckSchedule(run, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log).toHaveBeenCalledWith("integration_check_failed kind=TypeError");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
});
