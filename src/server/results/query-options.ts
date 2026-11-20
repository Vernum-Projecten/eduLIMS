// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of a lab's measurements and results (S14, S15, #270). The student's
// page of a lab has its own key; the teacher's view nests under the lab's key of the simulations
// area. Each write names the keys it invalidates.
import {
  mutationOptions,
  type QueryClient,
  type QueryKey,
  queryOptions,
} from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import { labRecordsKeys } from "../lab-records/query-options.ts";
import { simulationsKeys } from "../simulations/query-options.ts";
import type { ResultsActionError, ResultsResult } from "./access.ts";
import { getLabResultsFn, getMyResultsFn } from "./functions.ts";

/** The query keys of results, from the widest to the narrowest. */
export const resultsKeys = {
  all: ["results"] as const,
  /** The results page of one of the student's own labs. */
  mine: (labId: string) => [...resultsKeys.all, "lab", labId] as const,
  /** A lab's measurements and results, for the simulation's teachers. */
  teacher: (simulationId: string, labId: string) =>
    [...simulationsKeys.lab(simulationId, labId), "results"] as const,
};

/** What each write of this area invalidates. */
export const resultsInvalidation = {
  /** A measurement: the student's results page of that lab. */
  measure: (labId: string): QueryKey[] => [resultsKeys.mine(labId)],
  /** A release: the results page, and the records page, whose request is now locked (S11, S12). */
  release: (labId: string): QueryKey[] => [resultsKeys.mine(labId), labRecordsKeys.lab(labId)],
};

/** The measurements and results of one of the student's own labs. */
export function myResultsQueryOptions(labId: string) {
  return queryOptions({
    queryKey: resultsKeys.mine(labId),
    queryFn: () => getMyResultsFn({ data: { labId } }),
    staleTime: STALE_TIME.results,
  });
}

/** A lab's measurements and results, for the teachers of its simulation. */
export function labResultsQueryOptions(simulationId: string, labId: string) {
  return queryOptions({
    queryKey: resultsKeys.teacher(simulationId, labId),
    queryFn: () => getLabResultsFn({ data: { labId } }),
    staleTime: STALE_TIME.results,
  });
}

/** An action the server refused: the code maps to a translated message at the edge. */
export class ResultsActionRefused extends Error {
  readonly code: ResultsActionError;

  constructor(code: ResultsActionError) {
    super(code);
    this.name = "ResultsActionRefused";
    this.code = code;
  }
}

/** Returns the refusal code of a failed action; anything but a refusal is `null`. */
export function resultsErrorCode(error: unknown): ResultsActionError | null {
  return error instanceof ResultsActionRefused ? error.code : null;
}

/** A server function of one action, as `useServerFn` returns it. */
export type ResultsCall<TInput, TValue> = (options: {
  data: TInput;
}) => Promise<ResultsResult<TValue>>;

/**
 * The mutation options of one action: the call throws its refusal, so the caller's `onError`
 * shows it, and the keys `invalidates` names are invalidated once it settles, refused or not.
 */
export function resultsMutationOptions<TInput, TValue>(
  queryClient: QueryClient,
  call: ResultsCall<TInput, TValue>,
  invalidates: readonly QueryKey[],
) {
  return mutationOptions({
    mutationFn: async (data: TInput): Promise<TValue> => {
      const result = await call({ data });
      if (!result.ok) throw new ResultsActionRefused(result.error);
      return result.value;
    },
    onSettled: () =>
      Promise.all(invalidates.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
}
