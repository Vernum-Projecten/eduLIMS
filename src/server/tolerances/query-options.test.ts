// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Query layer of tolerances (S13, #269): setting one invalidates that lab's student page and
// nothing else; the teacher's view nests under the lab, so a write to the simulation reaches it.
import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidatedKeys,
  runMutation,
  seedCache,
  testQueryClient,
} from "../../lib/test-query-client.ts";
import type { SimulationResult } from "../simulations/access.ts";
import {
  simulationInvalidation,
  simulationMutationOptions,
  simulationsKeys,
} from "../simulations/query-options.ts";
import {
  labTolerancesQueryOptions,
  myTolerancesQueryOptions,
  tolerancesInvalidation,
  tolerancesKeys,
} from "./query-options.ts";

vi.mock("./functions.ts", () => ({ getMyTolerancesFn: vi.fn(), getLabTolerancesFn: vi.fn() }));
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
    [tolerancesKeys.mine(LAB), { tests: [] }],
    [tolerancesKeys.mine(OTHER_LAB), { tests: [] }],
    [simulationsKeys.student(), []],
    [tolerancesKeys.teacher(SIM, LAB), []],
  ]);
});

describe("the tolerance keys", () => {
  it("key the student's page by lab, and nest the teacher's view under the lab", () => {
    expect(myTolerancesQueryOptions(LAB).queryKey).toEqual(["tolerances", "lab", LAB]);
    expect(labTolerancesQueryOptions(SIM, LAB).queryKey).toEqual([
      ...simulationsKeys.lab(SIM, LAB),
      "tolerances",
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
    expect(invalidatedKeys(queryClient)).toContain(
      JSON.stringify(tolerancesKeys.teacher(SIM, LAB)),
    );
  });
});

describe("tolerancesInvalidation (explicit keys)", () => {
  it("invalidates only the lab's own page after a set", async () => {
    await runMutation(
      queryClient,
      simulationMutationOptions(
        queryClient,
        vi.fn(
          async (): Promise<SimulationResult<{ changed: boolean }>> => ({
            ok: true,
            value: { changed: true },
          }),
        ),
        tolerancesInvalidation.set(LAB),
      ),
      { labId: LAB },
    );
    expect(invalidatedKeys(queryClient)).toEqual(keys(tolerancesKeys.mine(LAB)));
  });

  it("invalidates it after a refusal too, so the page shows the current state", async () => {
    const outcome = await runMutation(
      queryClient,
      simulationMutationOptions(
        queryClient,
        vi.fn(
          async (): Promise<SimulationResult<{ changed: boolean }>> => ({
            ok: false,
            error: "not_running",
          }),
        ),
        tolerancesInvalidation.set(LAB),
      ),
      { labId: LAB },
    );
    expect(outcome).toEqual({ error: expect.objectContaining({ code: "not_running" }) });
    expect(invalidatedKeys(queryClient)).toEqual(keys(tolerancesKeys.mine(LAB)));
  });
});
