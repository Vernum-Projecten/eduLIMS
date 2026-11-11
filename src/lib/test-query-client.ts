// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Test helpers for the TanStack Query layer: a client seeded with one entry per area, a way to
// run mutation options outside React, and the list of keys a mutation invalidated.
import {
  MutationObserver,
  type MutationObserverOptions,
  QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

/** Returns a QueryClient without retries or garbage collection, so a test sees every entry. */
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
}

/** Writes `entries` into the cache as fresh data. */
export function seedCache(
  queryClient: QueryClient,
  entries: readonly (readonly [QueryKey, unknown])[],
): void {
  for (const [key, data] of entries) queryClient.setQueryData(key, data);
}

/** Returns the keys of every cached query marked invalidated, as JSON for easy comparison. */
export function invalidatedKeys(queryClient: QueryClient): string[] {
  return queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.isInvalidated)
    .map((query) => JSON.stringify(query.queryKey))
    .sort();
}

/**
 * Runs mutation options as `useMutation` would, outside React. Resolves with the result, or
 * with the error the mutation failed with, once every callback (`onSettled` included) ran.
 */
export async function runMutation<TData, TVariables, TContext>(
  queryClient: QueryClient,
  options: MutationObserverOptions<TData, Error, TVariables, TContext>,
  variables: TVariables,
): Promise<{ data?: TData; error?: Error }> {
  const observer = new MutationObserver(queryClient, options);
  try {
    return { data: await observer.mutate(variables) };
  } catch (error) {
    if (error instanceof Error) return { error };
    throw error;
  }
}
