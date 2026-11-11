// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Every server function of the analyser register and the integration status puts the admin
// role first (B3, A01). The guard itself is tested in src/server/middleware.test.ts; the core
// functions refuse a student and a teacher with 403 in their own tests.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  invalidatedKeys,
  runMutation,
  seedCache,
  testQueryClient,
} from "../../lib/test-query-client.ts";
import { analysersKeys } from "../analysers/query-options.ts";
import { checkNowMutationOptions, integrationsKeys } from "./query-options.ts";
import type { IntegrationStatusPage } from "./store.ts";

vi.mock("./functions.ts", () => ({ getIntegrationStatus: vi.fn() }));
vi.mock("../analysers/functions.ts", () => ({ listAdminAnalysers: vi.fn() }));

const FILES = ["src/server/analysers/functions.ts", "src/server/integrations/functions.ts"];

/** Splits a module into its `createServerFn(…)` chains, up to the handler. */
function serverFunctions(source: string): string[] {
  return source
    .split("createServerFn(")
    .slice(1)
    .map((chain) => chain.slice(0, chain.indexOf(".handler(")));
}

describe("the B3 server functions require the admin role", () => {
  it.each(FILES)('%s: every function runs requireRole("admin") before its validator', (file) => {
    const chains = serverFunctions(readFileSync(file, "utf8"));
    expect(chains.length).toBeGreaterThan(0);
    for (const chain of chains) {
      const guard = chain.indexOf('.middleware([requireRole("admin")])');
      expect(guard).toBeGreaterThan(-1);
      expect(chain.indexOf(".validator(")).toBeGreaterThan(guard);
    }
  });
});

describe("checkNowMutationOptions (B3)", () => {
  it("writes the new status into the cache and invalidates only the status key", async () => {
    const queryClient = testQueryClient();
    seedCache(queryClient, [
      [integrationsKeys.status(), { integrations: [], readAt: "old" }],
      [analysersKeys.list({}), { rows: [] }],
    ]);
    const page: IntegrationStatusPage = { integrations: [], readAt: "2026-11-11T12:00:00.000Z" };
    const call = vi.fn(() => Promise.resolve(page));
    await runMutation(queryClient, checkNowMutationOptions(queryClient, call), undefined);
    expect(call).toHaveBeenCalledWith({ data: {} });
    expect(queryClient.getQueryData(integrationsKeys.status())).toEqual(page);
    expect(invalidatedKeys(queryClient)).toEqual([JSON.stringify(integrationsKeys.status())]);
  });
});
