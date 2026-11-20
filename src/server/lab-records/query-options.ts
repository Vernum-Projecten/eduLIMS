// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of a team's records (S11, S12, S16, #268): one key factory, the query
// options of each read, and mutation options whose invalidation keys every caller names. A lab's
// records are keyed by the lab; the teacher's correction log by the simulation.
import {
  mutationOptions,
  type QueryClient,
  type QueryKey,
  queryOptions,
} from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import type { RecordsActionError, RecordsResult } from "./access.ts";
import { getCorrectionLogFn, getLabRecordsFn, getRequestableTestsFn } from "./functions.ts";

/** The query keys of a team's records, from the widest to the narrowest. */
export const labRecordsKeys = {
  all: ["lab-records"] as const,
  labs: () => [...labRecordsKeys.all, "lab"] as const,
  lab: (labId: string) => [...labRecordsKeys.labs(), labId] as const,
  tests: () => [...labRecordsKeys.all, "tests"] as const,
  corrections: (simulationId: string) =>
    [...labRecordsKeys.all, "corrections", simulationId] as const,
};

/** What each write invalidates: a write of a lab changes that lab's records only. */
export const labRecordsInvalidation = {
  lab: (labId: string): QueryKey[] => [labRecordsKeys.lab(labId)],
};

/** The patients and requests of one lab, for its students. */
export function labRecordsQueryOptions(labId: string) {
  return queryOptions({
    queryKey: labRecordsKeys.lab(labId),
    queryFn: () => getLabRecordsFn({ data: { labId } }),
    staleTime: STALE_TIME.labRecords,
  });
}

/** The catalogue tests a team can request. */
export function requestableTestsQueryOptions() {
  return queryOptions({
    queryKey: labRecordsKeys.tests(),
    queryFn: () => getRequestableTestsFn(),
    staleTime: STALE_TIME.catalogue,
  });
}

/** The correction log of one simulation, for its teachers. */
export function correctionLogQueryOptions(simulationId: string) {
  return queryOptions({
    queryKey: labRecordsKeys.corrections(simulationId),
    queryFn: () => getCorrectionLogFn({ data: { simulationId } }),
    staleTime: STALE_TIME.labRecords,
  });
}

/** An action the server refused: the code maps to a translated message at the edge. */
export class RecordsActionRefused extends Error {
  readonly code: RecordsActionError;

  constructor(code: RecordsActionError) {
    super(code);
    this.name = "RecordsActionRefused";
    this.code = code;
  }
}

/** Returns the refusal code of a failed action; anything but a refusal is `null`. */
export function recordsErrorCode(error: unknown): RecordsActionError | null {
  return error instanceof RecordsActionRefused ? error.code : null;
}

/** A server function of one action, as `useServerFn` returns it. */
export type RecordsCall<TInput, TValue> = (options: {
  data: TInput;
}) => Promise<RecordsResult<TValue>>;

/**
 * The mutation options of one action: the call throws its refusal, so the caller's `onError`
 * shows it, and the keys `invalidates` names are invalidated once it settles, refused or not.
 */
export function recordsMutationOptions<TInput, TValue>(
  queryClient: QueryClient,
  call: RecordsCall<TInput, TValue>,
  invalidates: readonly QueryKey[],
) {
  return mutationOptions({
    mutationFn: async (data: TInput): Promise<TValue> => {
      const result = await call({ data });
      if (!result.ok) throw new RecordsActionRefused(result.error);
      return result.value;
    },
    onSettled: () =>
      Promise.all(invalidates.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
}
