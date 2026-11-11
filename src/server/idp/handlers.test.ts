// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Negative role tests for every identity-provider server function (#46; security review M6;
// B1, R-01): a student and a teacher get 403 from each handler, before anything is read or
// written, and an administrator does not.
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { parseEnv } from "../env.ts";
import { AuthError } from "../middleware.ts";
import { VALID_ENV } from "../test-env.ts";
import { keyringOf } from "./crypto.ts";
import { type IdpHandlerDeps, idpHandlers } from "./handlers.ts";
import { invalidateProviderCache } from "./registry.ts";
import { insertTestProvider } from "./test-providers.ts";

const ENV = parseEnv(VALID_ENV);
let db: Kysely<DB> | undefined;
let deps: IdpHandlerDeps;

beforeEach(async () => {
  db = await createTestDb();
  await insertTestProvider(db, keyringOf(ENV), { providerId: "entra" });
  deps = { db, env: ENV, locale: "en" };
});

afterEach(async () => {
  invalidateProviderCache();
  await db?.destroy();
  db = undefined;
});

function user(roles: SessionUser["roles"]): Pick<SessionUser, "id" | "roles"> {
  return { id: `user-${roles.join("-")}`, roles };
}

const SETTINGS = {
  labelEn: "X",
  labelNl: "X",
  icon: "key-round",
  sortOrder: 0,
  roleClaim: "roles",
  roleMap: [],
  defaultRole: null,
  emailAuthoritative: false,
  domains: [],
} as const;

const OIDC = {
  issuer: "https://idp.example.test",
  clientId: "c",
  clientSecret: "s",
  attestPkce: false,
};

/** Every handler, called the way its server function calls it. */
const CALLS: readonly [string, (actor: Pick<SessionUser, "id" | "roles">) => Promise<unknown>][] = [
  ["listIdentityProviders", async (actor) => idpHandlers.list(actor, deps)],
  ["listIdentityProviderLabels", async (actor) => idpHandlers.labels(actor, deps)],
  ["getIdentityProvider", (actor) => idpHandlers.get(actor, { providerId: "entra" }, deps)],
  [
    "createIdentityProvider",
    (actor) =>
      idpHandlers.create(
        actor,
        {
          providerId: "other",
          protocol: "oidc",
          settings: { ...SETTINGS, roleMap: [], domains: [] },
          oidc: OIDC,
        },
        deps,
      ),
  ],
  [
    "updateIdentityProvider",
    (actor) =>
      idpHandlers.update(
        actor,
        {
          providerId: "entra",
          protocol: "oidc",
          settings: { ...SETTINGS, roleMap: [], domains: [] },
          oidc: OIDC,
        },
        deps,
      ),
  ],
  [
    "setIdentityProviderEnabled",
    (actor) => idpHandlers.setEnabled(actor, { providerId: "entra", enabled: false }, deps),
  ],
  ["deleteIdentityProvider", (actor) => idpHandlers.delete(actor, { providerId: "entra" }, deps)],
  [
    "startIdentityProviderTest",
    (actor) => idpHandlers.startTest(actor, { providerId: "entra" }, deps),
  ],
  [
    "getIdentityProviderTestResult",
    (actor) => idpHandlers.testResult(actor, { providerId: "entra", test: "a".repeat(32) }, deps),
  ],
];

async function status(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
    return 200;
  } catch (error) {
    return error instanceof AuthError ? error.status : 500;
  }
}

async function unchanged(database: Kysely<DB>) {
  const provider = await database
    .selectFrom("identity_provider")
    .select(["enabled", "label_en"])
    .executeTakeFirst();
  const events = await database.selectFrom("audit_event").select("id").execute();
  const tests = await database.selectFrom("verification").select("id").execute();
  return { provider, events: events.length, tests: tests.length };
}

describe("identity-provider server functions refuse every role but admin (M6)", () => {
  it.each(CALLS)("%s refuses a student with 403 and changes nothing", async (_name, call) => {
    const database = db;
    if (!database) throw new Error("no database");
    const before = await unchanged(database);
    expect(await status(() => call(user(["student"])))).toBe(403);
    expect(await unchanged(database)).toEqual(before);
  });

  it.each(CALLS)("%s refuses a teacher with 403 and changes nothing", async (_name, call) => {
    const database = db;
    if (!database) throw new Error("no database");
    const before = await unchanged(database);
    expect(await status(() => call(user(["teacher"])))).toBe(403);
    expect(await unchanged(database)).toEqual(before);
  });

  it("lets an administrator read the list (the positive control)", async () => {
    expect(await status(() => idpHandlers.list(user(["admin"]), deps))).toBe(200);
    expect(await status(() => idpHandlers.labels(user(["teacher", "admin"]), deps))).toBe(200);
  });
});
