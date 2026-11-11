// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of the analyser register (B3, #35): one key factory, the list's query
// options and the mutation options of create, edit and retire. Every change invalidates the
// list pages only; the register has no detail entry.
import {
  keepPreviousData,
  mutationOptions,
  type QueryClient,
  queryOptions,
} from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import type { AnalyserActionError, AnalyserActionResult } from "./actions.ts";
import { listAdminAnalysers } from "./functions.ts";
import type { CreateAnalyserInput, ListAnalysersInput, UpdateAnalyserInput } from "./schemas.ts";

/** The query keys of the register, from the widest to the narrowest. */
export const analysersKeys = {
  all: ["admin-analysers"] as const,
  lists: () => [...analysersKeys.all, "list"] as const,
  list: (filters: ListAnalysersInput) => [...analysersKeys.lists(), filters] as const,
};

/**
 * One page of the register, keyed by the whole table state. While the next page or filter
 * loads, the previous page stays on screen (`keepPreviousData`). A failure with no page to show
 * throws to the route's error state; a failed background refetch keeps the page.
 */
export function adminAnalysersQueryOptions(input: ListAnalysersInput) {
  return queryOptions({
    queryKey: analysersKeys.list(input),
    queryFn: () => listAdminAnalysers({ data: input }),
    staleTime: STALE_TIME.adminAnalysersList,
    placeholderData: keepPreviousData,
    throwOnError: (_error, query) => query.state.data === undefined,
  });
}

/** The page of analysers {@link adminAnalysersQueryOptions} returns. */
export type AdminAnalysersPage = Awaited<ReturnType<typeof listAdminAnalysers>>;

/** A change the server refused: the code maps to a translated message at the edge. */
export class AnalyserActionRefused extends Error {
  readonly code: AnalyserActionError;

  constructor(code: AnalyserActionError) {
    super(code);
    this.name = "AnalyserActionRefused";
    this.code = code;
  }
}

/** Returns the refusal code of a failed change; anything but a refusal is `failed`. */
export function analyserErrorCode(error: unknown): AnalyserActionError {
  return error instanceof AnalyserActionRefused ? error.code : "failed";
}

/** A server function of one change, as `useServerFn` returns it. */
export type AnalyserCall<TInput> = (options: { data: TInput }) => Promise<AnalyserActionResult>;

/** Calls a change and throws its refusal, so a refused change fails like a failed one. */
async function settled<TInput>(call: AnalyserCall<TInput>, data: TInput): Promise<string> {
  const result = await call({ data });
  if (!result.ok) throw new AnalyserActionRefused(result.error);
  return result.analyserId;
}

/** Invalidates every cached page of the register, the only entries a change touches. */
export function invalidateAnalysers(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: analysersKeys.lists() });
}

/** Adds an analyser; no optimistic row, since the server assigns its id and its place. */
export function createAnalyserMutationOptions(
  queryClient: QueryClient,
  call: AnalyserCall<CreateAnalyserInput>,
) {
  return mutationOptions({
    mutationFn: (data: CreateAnalyserInput) => settled(call, data),
    onSettled: () => invalidateAnalysers(queryClient),
  });
}

/** Changes an analyser. */
export function updateAnalyserMutationOptions(
  queryClient: QueryClient,
  call: AnalyserCall<UpdateAnalyserInput>,
) {
  return mutationOptions({
    mutationFn: (data: UpdateAnalyserInput) => settled(call, data),
    onSettled: () => invalidateAnalysers(queryClient),
  });
}

/** Retires an analyser after its confirmation. */
export function retireAnalyserMutationOptions(
  queryClient: QueryClient,
  call: AnalyserCall<{ analyserId: string }>,
) {
  return mutationOptions({
    mutationFn: (data: { analyserId: string }) => settled(call, data),
    onSettled: () => invalidateAnalysers(queryClient),
  });
}
