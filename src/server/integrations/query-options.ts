// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of the integration status (B3, #35): one key, the status read that
// refetches on an interval while the screen is open, and "Check now", which writes its answer
// into that entry.
import { mutationOptions, type QueryClient, queryOptions } from "@tanstack/react-query";
import { INTEGRATION_REFETCH_MS, STALE_TIME } from "../../lib/query-config.ts";
import { getIntegrationStatus } from "./functions.ts";
import type { IntegrationStatusPage } from "./store.ts";

/** The query keys of the integration status. */
export const integrationsKeys = {
  all: ["admin-integrations"] as const,
  status: () => [...integrationsKeys.all, "status"] as const,
};

/**
 * The latest check of every integration, refetched every {@link INTEGRATION_REFETCH_MS} while
 * the screen is open, so a failure the schedule finds shows without a reload (B3).
 */
export function integrationStatusQueryOptions() {
  return queryOptions({
    queryKey: integrationsKeys.status(),
    queryFn: () => getIntegrationStatus({ data: {} }),
    staleTime: STALE_TIME.integrationStatus,
    refetchInterval: INTEGRATION_REFETCH_MS,
    throwOnError: (_error, query) => query.state.data === undefined,
  });
}

/** The server function of "Check now", as `useServerFn` returns it. */
export type CheckNowCall = (options: {
  data: Record<string, never>;
}) => Promise<IntegrationStatusPage>;

/** "Check now": the answer is the new status, written into the cache, then the key refetches. */
export function checkNowMutationOptions(queryClient: QueryClient, call: CheckNowCall) {
  return mutationOptions({
    mutationFn: () => call({ data: {} }),
    onSuccess: (page) => queryClient.setQueryData(integrationsKeys.status(), page),
    onSettled: () => queryClient.invalidateQueries({ queryKey: integrationsKeys.status() }),
  });
}
