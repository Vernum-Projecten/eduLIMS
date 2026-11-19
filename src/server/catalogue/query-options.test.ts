// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Query layer of the test catalogue (D9, #266): every change invalidates only the list pages.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CatalogueTestId, parseCatalogueTestId } from "../../lib/catalogue.ts";
import { sessionKeys } from "../../lib/session.query-options.ts";
import {
  invalidatedKeys,
  runMutation,
  seedCache,
  testQueryClient,
} from "../../lib/test-query-client.ts";
import type { TestActionResult } from "./actions.ts";
import {
  catalogueErrorCode,
  catalogueKeys,
  createTestMutationOptions,
  restoreTestMutationOptions,
  retireTestMutationOptions,
  TestActionRefused,
  updateTestMutationOptions,
} from "./query-options.ts";
import type { CreateTestInput } from "./schemas.ts";

vi.mock("./functions.ts", () => ({ listCatalogueTests: vi.fn() }));
vi.mock("../../lib/session.functions.ts", () => ({ getSession: vi.fn() }));

function testId(): CatalogueTestId {
  const id = parseCatalogueTestId("01960000-0000-7000-8000-000000000001");
  if (id === null) throw new Error("not a UUID");
  return id;
}

const ID = testId();
const FORM: CreateTestInput = {
  name: "Glucose",
  unit: "mmol/L",
  material: "plasma",
  source: "epoch_upload",
  analyte: "",
  calculatedBy: "team",
};

const LISTS = [catalogueKeys.list({}), catalogueKeys.list({ status: ["retired"] })]
  .map((key) => JSON.stringify(key))
  .sort();

function seeded() {
  const queryClient = testQueryClient();
  seedCache(queryClient, [
    [catalogueKeys.list({}), { rows: [] }],
    [catalogueKeys.list({ status: ["retired"] }), { rows: [] }],
    [sessionKeys.current(), { id: "teacher" }],
  ]);
  return queryClient;
}

const ok = (): Promise<TestActionResult> => Promise.resolve({ ok: true, testId: ID });
const taken = (): Promise<TestActionResult> => Promise.resolve({ ok: false, error: "name_taken" });

let queryClient = seeded();
beforeEach(() => {
  queryClient = seeded();
});

describe("catalogueKeys", () => {
  it("nests every list under the area root", () => {
    expect(catalogueKeys.lists()).toEqual(["catalogue", "list"]);
    expect(catalogueKeys.list({ q: "x" })).toEqual(["catalogue", "list", { q: "x" }]);
  });
});

describe("the catalogue's mutations invalidate only the list pages", () => {
  it("create", async () => {
    const result = await runMutation(queryClient, createTestMutationOptions(queryClient, ok), FORM);
    expect(result.data).toBe(ID);
    expect(invalidatedKeys(queryClient)).toEqual(LISTS);
  });

  it("update", async () => {
    await runMutation(queryClient, updateTestMutationOptions(queryClient, ok), {
      testId: ID,
      test: FORM,
    });
    expect(invalidatedKeys(queryClient)).toEqual(LISTS);
  });

  it("retire and restore", async () => {
    await runMutation(queryClient, retireTestMutationOptions(queryClient, ok), { testId: ID });
    expect(invalidatedKeys(queryClient)).toEqual(LISTS);
    queryClient = seeded();
    await runMutation(queryClient, restoreTestMutationOptions(queryClient, ok), { testId: ID });
    expect(invalidatedKeys(queryClient)).toEqual(LISTS);
  });

  it("turns a refusal into an error with its code, and still invalidates", async () => {
    const result = await runMutation(
      queryClient,
      createTestMutationOptions(queryClient, taken),
      FORM,
    );
    expect(result.error).toBeInstanceOf(TestActionRefused);
    expect(catalogueErrorCode(result.error)).toBe("name_taken");
    expect(catalogueErrorCode(new Error("500"))).toBe("failed");
    expect(invalidatedKeys(queryClient)).toEqual(LISTS);
  });
});
