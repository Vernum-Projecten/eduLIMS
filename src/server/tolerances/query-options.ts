// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of a team's tolerances (S13, #269). The student's page of a lab has
// its own key; the teacher's view nests under the lab's key of the simulations area, so a write
// to the simulation or the lab reaches it too.
import { keepPreviousData, type QueryKey, queryOptions } from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import { simulationsKeys } from "../simulations/query-options.ts";
import { getLabTolerancesFn, getMyTolerancesFn } from "./functions.ts";

/** The query keys of tolerances, from the widest to the narrowest. */
export const tolerancesKeys = {
  all: ["tolerances"] as const,
  /** The tolerance page of one of the student's own labs. */
  mine: (labId: string) => [...tolerancesKeys.all, "lab", labId] as const,
  /** A lab's tolerances and their changes, for the simulation's teachers. */
  teacher: (simulationId: string, labId: string) =>
    [...simulationsKeys.lab(simulationId, labId), "tolerances"] as const,
  /** One page of a lab's changes, for the simulation's teachers. */
  teacherPage: (simulationId: string, labId: string, page: number) =>
    [...tolerancesKeys.teacher(simulationId, labId), page] as const,
};

/** What each write of this area invalidates. */
export const tolerancesInvalidation = {
  /** Setting a tolerance: the student's page of that lab. */
  set: (labId: string): QueryKey[] => [tolerancesKeys.mine(labId)],
};

/** The tolerance page of one of the student's own labs. */
export function myTolerancesQueryOptions(labId: string) {
  return queryOptions({
    queryKey: tolerancesKeys.mine(labId),
    queryFn: () => getMyTolerancesFn({ data: { labId } }),
    staleTime: STALE_TIME.tolerances,
  });
}

/**
 * A lab's tolerances in force and page `page` of their changes, for the teachers of its
 * simulation. The previous page stays on screen while the next one loads.
 */
export function labTolerancesQueryOptions(simulationId: string, labId: string, page = 1) {
  return queryOptions({
    queryKey: tolerancesKeys.teacherPage(simulationId, labId, page),
    queryFn: () => getLabTolerancesFn({ data: { labId, page } }),
    staleTime: STALE_TIME.tolerances,
    placeholderData: keepPreviousData,
  });
}
