// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Query layer of the analyser register and the integration status (B3): every change
// invalidates only its own keys.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionKeys } from "../../lib/session.query-options.ts";
import {
  invalidatedKeys,
  runMutation,
  seedCache,
  testQueryClient,
} from "../../lib/test-query-client.ts";
import { integrationsKeys } from "../integrations/query-options.ts";
import type { AnalyserActionResult } from "./actions.ts";
import {
  AnalyserActionRefused,
  analyserErrorCode,
  analysersKeys,
  createAnalyserMutationOptions,
  retireAnalyserMutationOptions,
  updateAnalyserMutationOptions,
} from "./query-options.ts";
import type { CreateAnalyserInput } from "./schemas.ts";

vi.mock("./functions.ts", () => ({ listAdminAnalysers: vi.fn() }));
vi.mock("../integrations/functions.ts", () => ({ getIntegrationStatus: vi.fn() }));
vi.mock("../../lib/session.functions.ts", () => ({ getSession: vi.fn() }));

const ID = "01900000-0000-7000-8000-000000000001";
const FORM: CreateAnalyserInput = {
  model: "BioTek Epoch 2",
  serialNumber: "EP2-TEST-0001",
  location: "Lab A",
  route: "excel_upload",
  status: "in_use",
  notes: "",
};

const LISTS = [analysersKeys.list({}), analysersKeys.list({ status: ["retired"] })]
  .map((key) => JSON.stringify(key))
  .sort();

function seeded() {
  const queryClient = testQueryClient();
  seedCache(queryClient, [
    [analysersKeys.list({}), { rows: [] }],
    [analysersKeys.list({ status: ["retired"] }), { rows: [] }],
    [integrationsKeys.status(), { integrations: [] }],
    [sessionKeys.current(), { id: "admin" }],
  ]);
  return queryClient;
}

const ok = (): Promise<AnalyserActionResult> => Promise.resolve({ ok: true, analyserId: ID });
const taken = (): Promise<AnalyserActionResult> =>
  Promise.resolve({ ok: false, error: "serial_taken" });

let queryClient = seeded();
beforeEach(() => {
  queryClient = seeded();
});

describe("analysersKeys", () => {
  it("nests every list under the area root", () => {
    expect(analysersKeys.lists()).toEqual(["admin-analysers", "list"]);
    expect(analysersKeys.list({ q: "x" })).toEqual(["admin-analysers", "list", { q: "x" }]);
  });
});

describe("the register's mutations invalidate only the list pages", () => {
  it("create", async () => {
    const result = await runMutation(
      queryClient,
      createAnalyserMutationOptions(queryClient, ok),
      FORM,
    );
    expect(result.data).toBe(ID);
    expect(invalidatedKeys(queryClient)).toEqual(LISTS);
  });

  it("update", async () => {
    await runMutation(queryClient, updateAnalyserMutationOptions(queryClient, ok), {
      ...FORM,
      analyserId: ID,
    });
    expect(invalidatedKeys(queryClient)).toEqual(LISTS);
  });

  it("retire", async () => {
    await runMutation(queryClient, retireAnalyserMutationOptions(queryClient, ok), {
      analyserId: ID,
    });
    expect(invalidatedKeys(queryClient)).toEqual(LISTS);
  });

  it("turns a refusal into an error with its code, and still invalidates", async () => {
    const result = await runMutation(
      queryClient,
      createAnalyserMutationOptions(queryClient, taken),
      FORM,
    );
    expect(result.error).toBeInstanceOf(AnalyserActionRefused);
    expect(analyserErrorCode(result.error)).toBe("serial_taken");
    expect(analyserErrorCode(new Error("500"))).toBe("failed");
    expect(invalidatedKeys(queryClient)).toEqual(LISTS);
  });
});
