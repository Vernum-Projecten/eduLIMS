// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The acceptance criterion of #45 (from the SSO design, #46): eduLIMS's Kysely and PostgreSQL
// setup passes the checks the scim plugin and the sso plugin's `resolveUser` make (native
// interactive transactions, database sessions, the async context), and when a setup fails
// them, `/api/auth/scim/v2` answers 501.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { parseEnv } from "../env.ts";
import { createTestAuth } from "../test-auth.ts";
import { VALID_ENV } from "../test-env.ts";
import {
  hasAsyncContext,
  hasDatabaseSessions,
  hasNativeTransactions,
  scimSupport,
  staticScimSupport,
} from "./support.ts";

const BASE = "http://localhost:3000";
let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

function scimRequest(path: string): Request {
  return new Request(`${BASE}/api/auth/scim/v2${path}`, {
    headers: { authorization: "Bearer edulims_scim_x" },
  });
}

describe("SCIM support on eduLIMS's database setup (#45)", () => {
  it("passes the plugins' checks: native transactions, database sessions, async context", async () => {
    db = await createTestDb();
    const auth = await createTestAuth(parseEnv(VALID_ENV), { db, type: "postgres" });
    const context = await auth.$context;
    expect(hasNativeTransactions(context.adapter)).toBe(true);
    expect(hasDatabaseSessions(auth.options)).toBe(true);
    expect(await hasAsyncContext()).toBe(true);
    expect(await scimSupport(context.adapter, auth.options)).toEqual({ ok: true });
    // The scim plugin's own init check (`assertNativeSCIMTransactions`) ran and let it in.
    expect(auth.options.plugins.map((plugin) => plugin.id)).toContain("scim");
  });

  it("serves SCIM discovery, not 501, on that setup", async () => {
    db = await createTestDb();
    const auth = await createTestAuth(parseEnv(VALID_ENV), { db, type: "postgres" });
    const response = await auth.handler(scimRequest("/ServiceProviderConfig"));
    expect(response.status).not.toBe(501);
  });

  it("answers 501 on a database setup without native transactions", async () => {
    db = await createTestDb();
    const auth = await createTestAuth(parseEnv(VALID_ENV), {
      db,
      type: "postgres",
      transaction: false,
    });
    expect(auth.options.plugins.map((plugin) => plugin.id)).not.toContain("scim");
    const response = await auth.handler(scimRequest("/Users"));
    expect(response.status).toBe(501);
    expect(response.headers.get("content-type")).toBe("application/scim+json");
    expect(await response.json()).toMatchObject({ status: "501" });
  });
});

describe("the support checks", () => {
  const native = { options: { adapterConfig: { transaction: async () => undefined } } };

  it("refuses an adapter whose transaction is the sequential fallback", () => {
    expect(hasNativeTransactions({ options: { adapterConfig: { transaction: false } } })).toBe(
      false,
    );
    expect(hasNativeTransactions({})).toBe(false);
    expect(staticScimSupport({ options: { adapterConfig: { transaction: false } } }, {})).toEqual({
      ok: false,
      reason: "no_native_transactions",
    });
  });

  it("refuses sessions kept only in secondary storage", () => {
    const secondaryStorage = {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
      getAndDelete: async () => null,
      increment: async () => 1,
    };
    expect(hasDatabaseSessions({ secondaryStorage })).toBe(false);
    expect(
      hasDatabaseSessions({ secondaryStorage, session: { storeSessionInDatabase: true } }),
    ).toBe(true);
    expect(
      hasDatabaseSessions({
        secondaryStorage,
        session: { storeSessionInDatabase: true, preserveSessionInDatabase: true },
      }),
    ).toBe(false);
    expect(staticScimSupport(native, { secondaryStorage })).toEqual({
      ok: false,
      reason: "no_database_sessions",
    });
  });

  it("refuses a runtime without the async context", async () => {
    const missing = async () => {
      throw new Error("no AsyncLocalStorage");
    };
    expect(await hasAsyncContext(missing)).toBe(false);
    expect(await scimSupport(native, {}, missing)).toEqual({
      ok: false,
      reason: "no_async_context",
    });
  });
});
