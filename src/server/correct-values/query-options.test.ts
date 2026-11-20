// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Query layer of correct values and a simulation's state (#267): each write invalidates its
// keys and nothing else; the correct values nest under their simulation; a change of how
// simulations use a test reaches the catalogue's list.
import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidatedKeys,
  runMutation,
  seedCache,
  testQueryClient,
} from "../../lib/test-query-client.ts";
import { catalogueKeys } from "../catalogue/query-options.ts";
import type { SimulationResult } from "../simulations/access.ts";
import { simulationMutationOptions, simulationsKeys } from "../simulations/query-options.ts";
import { correctValuesInvalidation, correctValuesQueryOptions } from "./query-options.ts";

vi.mock("./functions.ts", () => ({ getCorrectValuesFn: vi.fn() }));
vi.mock("../simulations/functions.ts", () => ({}));
vi.mock("../catalogue/functions.ts", () => ({}));

const ONE = "01960000-0000-7000-8000-000000000001";
const TWO = "01960000-0000-7000-8000-000000000002";
const LAB = "01960000-0000-7000-8000-0000000000a1";

function seeded(): QueryClient {
  const queryClient = testQueryClient();
  seedCache(queryClient, [
    [simulationsKeys.lists(), []],
    [simulationsKeys.detail(ONE), { id: ONE }],
    [simulationsKeys.correctValues(ONE), { values: [] }],
    [simulationsKeys.readiness(ONE), { labs: {} }],
    [simulationsKeys.lab(ONE, LAB), { id: LAB }],
    [simulationsKeys.detail(TWO), { id: TWO }],
    [simulationsKeys.correctValues(TWO), { values: [] }],
    [simulationsKeys.readiness(TWO), { labs: {} }],
    [simulationsKeys.student(), []],
    [catalogueKeys.list({}), { rows: [] }],
  ]);
  return queryClient;
}

const keys = (...list: readonly (readonly unknown[])[]) =>
  list.map((key) => JSON.stringify(key)).sort();

const ok = <T>(value: T) => vi.fn(async (): Promise<SimulationResult<T>> => ({ ok: true, value }));

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = seeded();
});

describe("the correct-value keys (D10)", () => {
  it("nest under their simulation, so a write to it reaches them", () => {
    expect(simulationsKeys.correctValues(ONE)).toEqual([
      ...simulationsKeys.detail(ONE),
      "correct-values",
    ]);
    expect(correctValuesQueryOptions(ONE).queryKey).toEqual(simulationsKeys.correctValues(ONE));
  });
});

describe("correctValuesInvalidation (explicit keys)", () => {
  it("invalidates the section, the overview and the catalogue's usage after a change of values", async () => {
    await runMutation(
      queryClient,
      simulationMutationOptions(
        queryClient,
        ok({ added: 1, changed: 0, unchanged: 0 }),
        correctValuesInvalidation.values(ONE),
      ),
      { simulationId: ONE, rows: [] },
    );
    expect(invalidatedKeys(queryClient)).toEqual(
      keys(
        simulationsKeys.correctValues(ONE),
        simulationsKeys.readiness(ONE),
        catalogueKeys.list({}),
      ),
    );
  });

  it("invalidates only the section and the overview after a change of limits", async () => {
    await runMutation(
      queryClient,
      simulationMutationOptions(queryClient, ok(null), correctValuesInvalidation.limits(ONE)),
      { simulationId: ONE },
    );
    expect(invalidatedKeys(queryClient)).toEqual(
      keys(simulationsKeys.correctValues(ONE), simulationsKeys.readiness(ONE)),
    );
  });

  it("invalidates the page with its labs and values, the lists and the usage after a start", async () => {
    await runMutation(
      queryClient,
      simulationMutationOptions(queryClient, ok(null), correctValuesInvalidation.state(ONE)),
      { simulationId: ONE },
    );
    expect(invalidatedKeys(queryClient)).toEqual(
      keys(
        simulationsKeys.detail(ONE),
        simulationsKeys.correctValues(ONE),
        simulationsKeys.readiness(ONE),
        simulationsKeys.lab(ONE, LAB),
        simulationsKeys.lists(),
        catalogueKeys.list({}),
      ),
    );
  });
});
