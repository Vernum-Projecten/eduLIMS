// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The `/api/auth/$` server route serves every HTTP method a better-auth endpoint registers (#365,
// B4, Q-SEC-2). Start's server routes pick `handlers[method] ?? handlers.ANY` and hand any other
// method to the page renderer, so a method missing here never reaches better-auth: SCIM PATCH,
// PUT and DELETE did not, and a deactivated user kept their sessions. The list comes from the
// configured instance, every plugin included, so a new method fails this test first.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { Route } from "../routes/api/auth/$.ts";
import type { DB } from "./db/schema.gen.ts";
import { createTestDb } from "./db/test-db.ts";
import { parseEnv } from "./env.ts";
import { createTestAuth } from "./test-auth.ts";
import { VALID_ENV } from "./test-env.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

interface Registered {
  path: string;
  methods: string[];
}

/** Returns the path and methods of every endpoint the instance's API holds. */
function registeredEndpoints(api: object): Registered[] {
  return Object.values(api).flatMap((endpoint: unknown): Registered[] => {
    if (typeof endpoint !== "function") return [];
    const path: unknown = Reflect.get(endpoint, "path");
    const options: unknown = Reflect.get(endpoint, "options");
    const method: unknown =
      typeof options === "object" && options !== null ? Reflect.get(options, "method") : undefined;
    if (typeof path !== "string") return [];
    const methods = (Array.isArray(method) ? method : [method]).filter(
      (m): m is string => typeof m === "string",
    );
    return [{ path, methods }];
  });
}

/** Returns the method keys of the route's server handlers. */
function routedMethods(): string[] {
  const server: unknown = Reflect.get(Route.options, "server");
  const handlers: unknown =
    typeof server === "object" && server !== null ? Reflect.get(server, "handlers") : undefined;
  if (typeof handlers !== "object" || handlers === null) return [];
  return Object.keys(handlers);
}

async function endpoints(): Promise<Registered[]> {
  db = await createTestDb();
  const auth = await createTestAuth(parseEnv({ ...VALID_ENV, EDULIMS_DEV_LOGIN: "true" }), {
    db,
    type: "postgres",
  });
  return registeredEndpoints(auth.api);
}

describe("the better-auth server route (#365)", () => {
  it("serves every method a better-auth endpoint or plugin registers", async () => {
    const registered = await endpoints();
    const methods = new Set(registered.flatMap((endpoint) => endpoint.methods));
    // A wildcard would need `ANY`; better-auth 1.7.20 registers none, and this says so if one comes.
    expect(methods).not.toContain("*");
    const routed = new Set(routedMethods());
    const missing = [...methods].filter((method) => !routed.has(method));
    expect(missing).toEqual([]);
  });

  it("finds the SCIM write endpoints, so the check above is not vacuous", async () => {
    const registered = await endpoints();
    const methodsOf = (path: string) =>
      registered
        .filter((endpoint) => endpoint.path === path)
        .flatMap((endpoint) => endpoint.methods)
        .sort();
    expect(methodsOf("/scim/v2/Users/:userId")).toEqual(["DELETE", "GET", "PATCH", "PUT"]);
    expect(methodsOf("/scim/v2/Groups/:groupId")).toEqual(["DELETE", "GET", "PATCH", "PUT"]);
  });

  it("routes no method that no endpoint registers, and no `ANY` (ASVS V4.1.4)", async () => {
    const registered = new Set((await endpoints()).flatMap((endpoint) => endpoint.methods));
    expect(routedMethods().filter((method) => !registered.has(method))).toEqual([]);
    expect(routedMethods()).not.toContain("ANY");
  });
});
