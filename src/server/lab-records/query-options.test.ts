// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Query layer of a team's records (#268): a write of a lab invalidates that lab's records
// and nothing else, and a refusal reaches the caller as a typed error.
import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidatedKeys,
  runMutation,
  seedCache,
  testQueryClient,
} from "../../lib/test-query-client.ts";
import type { RecordsResult } from "./access.ts";
import {
  correctionLogQueryOptions,
  labRecordsInvalidation,
  labRecordsKeys,
  labRecordsQueryOptions,
  RecordsActionRefused,
  recordsErrorCode,
  recordsMutationOptions,
  requestableTestsQueryOptions,
} from "./query-options.ts";

vi.mock("./functions.ts", () => ({
  getLabRecordsFn: vi.fn(),
  getRequestableTestsFn: vi.fn(),
  getCorrectionLogFn: vi.fn(),
}));

const LAB = "01960000-0000-7000-8000-0000000000a1";
const OTHER_LAB = "01960000-0000-7000-8000-0000000000a2";
const SIMULATION = "01960000-0000-7000-8000-000000000001";

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = testQueryClient();
  seedCache(queryClient, [
    [labRecordsKeys.lab(LAB), { patients: [] }],
    [labRecordsKeys.lab(OTHER_LAB), { patients: [] }],
    [labRecordsKeys.tests(), []],
    [labRecordsKeys.corrections(SIMULATION), { entries: [] }],
  ]);
});

const keys = (...list: readonly (readonly unknown[])[]) =>
  list.map((key) => JSON.stringify(key)).sort();

describe("the records keys", () => {
  it("key each read by its lab or simulation", () => {
    expect(labRecordsQueryOptions(LAB).queryKey).toEqual(labRecordsKeys.lab(LAB));
    expect(requestableTestsQueryOptions().queryKey).toEqual(labRecordsKeys.tests());
    expect(correctionLogQueryOptions(SIMULATION).queryKey).toEqual(
      labRecordsKeys.corrections(SIMULATION),
    );
  });
});

describe("recordsMutationOptions (explicit keys)", () => {
  it("invalidates only the lab's records after a write", async () => {
    const call = vi.fn(async (): Promise<RecordsResult<null>> => ({ ok: true, value: null }));
    await runMutation(
      queryClient,
      recordsMutationOptions(queryClient, call, labRecordsInvalidation.lab(LAB)),
      { labId: LAB },
    );
    expect(invalidatedKeys(queryClient)).toEqual(keys(labRecordsKeys.lab(LAB)));
  });

  it("throws a refusal as a typed error, and still invalidates", async () => {
    const call = vi.fn(
      async (): Promise<RecordsResult<null>> => ({ ok: false, error: "released" }),
    );
    const { error } = await runMutation(
      queryClient,
      recordsMutationOptions(queryClient, call, labRecordsInvalidation.lab(LAB)),
      { labId: LAB },
    );
    expect(error).toBeInstanceOf(RecordsActionRefused);
    expect(recordsErrorCode(error)).toBe("released");
    expect(recordsErrorCode(new Error("boom"))).toBeNull();
    expect(invalidatedKeys(queryClient)).toEqual(keys(labRecordsKeys.lab(LAB)));
  });
});
