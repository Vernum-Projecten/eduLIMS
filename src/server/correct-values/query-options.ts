// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of correct values and a simulation's state (D10, D13, #267). The
// correct values nest under their simulation's key, so a write to the simulation reaches them. A
// change that alters how simulations use a test reaches the catalogue's list too, whose status
// cell shows that use.
import { type QueryKey, queryOptions } from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import { catalogueKeys } from "../catalogue/query-options.ts";
import { simulationInvalidation, simulationsKeys } from "../simulations/query-options.ts";
import { getCorrectValuesFn } from "./functions.ts";

/** What each write of this area invalidates. */
export const correctValuesInvalidation = {
  /** Adding, changing or removing correct values: the section and the catalogue's usage. */
  values: (simulationId: string): QueryKey[] => [
    simulationsKeys.correctValues(simulationId),
    catalogueKeys.lists(),
  ],
  /** Setting a test's limits: the section only. */
  limits: (simulationId: string): QueryKey[] => [simulationsKeys.correctValues(simulationId)],
  /** Starting or finishing: the page (with the section under it), the lists and the usage. */
  state: (simulationId: string): QueryKey[] => [
    ...simulationInvalidation.simulation(simulationId),
    catalogueKeys.lists(),
  ],
};

/** The correct values and limits of one simulation, for its teachers. */
export function correctValuesQueryOptions(simulationId: string) {
  return queryOptions({
    queryKey: simulationsKeys.correctValues(simulationId),
    queryFn: () => getCorrectValuesFn({ data: { simulationId } }),
    staleTime: STALE_TIME.simulations,
  });
}
