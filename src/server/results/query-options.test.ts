// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Query layer of results (S14, S15, #270): a measurement invalidates that lab's results page
// only; a release also invalidates the lab's records page, whose request is now locked; the
// teacher's view nests under the lab, so a write to the simulation reaches it.
import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidatedKeys,
  runMutation,
  seedCache,
  testQueryClient,
} from "../../lib/test-query-client.ts";
import { labRecordsKeys } from "../lab-records/query-options.ts";
import type { SimulationResult } from "../simulations/access.ts";
import {
  simulationInvalidation,
  simulationMutationOptions,
  simulationsKeys,
} from "../simulations/query-options.ts";
import type { ResultsResult } from "./access.ts";
import {
  labResultsQueryOptions,
  myResultsQueryOptions,
  ResultsActionRefused,
  resultsErrorCode,
  resultsInvalidation,
  resultsKeys,
  resultsMutationOptions,
} from "./query-options.ts";

vi.mock("./functions.ts", () => ({ getMyResultsFn: vi.fn(), getLabResultsFn: vi.fn() }));
vi.mock("../lab-records/functions.ts", () => ({}));
vi.mock("../simulations/functions.ts", () => ({}));

const SIM = "01960000-0000-7000-8000-000000000001";
const LAB = "01960000-0000-7000-8000-0000000000a1";
const OTHER_LAB = "01960000-0000-7000-8000-0000000000a2";

const keys = (...list: readonly (readonly unknown[])[]) =>
  list.map((key) => JSON.stringify(key)).sort();

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = testQueryClient();
  seedCache(queryClient, [
    [resultsKeys.mine(LAB), { requests: [] }],
    [resultsKeys.mine(OTHER_LAB), { requests: [] }],
    [labRecordsKeys.lab(LAB), { requests: [] }],
    [labRecordsKeys.lab(OTHER_LAB), { requests: [] }],
    [resultsKeys.teacher(SIM, LAB), { requests: [] }],
  ]);
});

describe("the results keys", () => {
  it("key the student's page by lab, and nest the teacher's view under the lab", () => {
    expect(myResultsQueryOptions(LAB).queryKey).toEqual(["results", "lab", LAB]);
    expect(labResultsQueryOptions(SIM, LAB).queryKey).toEqual([
      ...simulationsKeys.lab(SIM, LAB),
      "results",
    ]);
  });

  it("let a write to the simulation reach the teacher's view", async () => {
    await runMutation(
      queryClient,
      simulationMutationOptions(
        queryClient,
        vi.fn(async (): Promise<SimulationResult<null>> => ({ ok: true, value: null })),
        simulationInvalidation.simulation(SIM),
      ),
      {},
    );
    expect(invalidatedKeys(queryClient)).toContain(JSON.stringify(resultsKeys.teacher(SIM, LAB)));
  });
});

describe("the results mutations", () => {
  it("a measurement invalidates that lab's results page and nothing else", async () => {
    await runMutation(
      queryClient,
      resultsMutationOptions(
        queryClient,
        vi.fn(async (): Promise<ResultsResult<null>> => ({ ok: true, value: null })),
        resultsInvalidation.measure(LAB),
      ),
      {},
    );
    expect(invalidatedKeys(queryClient)).toEqual(keys(resultsKeys.mine(LAB)));
  });

  it("a release invalidates the lab's results and records pages and nothing else", async () => {
    await runMutation(
      queryClient,
      resultsMutationOptions(
        queryClient,
        vi.fn(async (): Promise<ResultsResult<null>> => ({ ok: true, value: null })),
        resultsInvalidation.release(LAB),
      ),
      {},
    );
    expect(invalidatedKeys(queryClient)).toEqual(
      keys(resultsKeys.mine(LAB), labRecordsKeys.lab(LAB)),
    );
  });

  it("throws a refusal as a typed error and still invalidates", async () => {
    const outcome = await runMutation(
      queryClient,
      resultsMutationOptions(
        queryClient,
        vi.fn(async (): Promise<ResultsResult<null>> => ({ ok: false, error: "released" })),
        resultsInvalidation.release(LAB),
      ),
      {},
    );
    expect(outcome).toEqual({ error: expect.objectContaining({ code: "released" }) });
    expect(invalidatedKeys(queryClient)).toEqual(
      keys(resultsKeys.mine(LAB), labRecordsKeys.lab(LAB)),
    );
  });

  it("reads the refusal code of a refusal and nothing else", () => {
    expect(resultsErrorCode(new ResultsActionRefused("no_tolerance"))).toBe("no_tolerance");
    expect(resultsErrorCode(new Error("network"))).toBeNull();
  });
});
