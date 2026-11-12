// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of the activity log screen (#36): one key factory and the query
// options of the list and the user search. The log is read-only, so there is no mutation.
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import { listAdminActivity, searchAdminActivityUsers } from "./functions.ts";
import type { ListActivityInput } from "./schemas.ts";

/** The query keys of the activity log screen, from the widest to the narrowest. */
export const activityKeys = {
  all: ["admin-activity"] as const,
  lists: () => [...activityKeys.all, "list"] as const,
  list: (filters: ListActivityInput) => [...activityKeys.lists(), filters] as const,
  userSearches: () => [...activityKeys.all, "user-search"] as const,
  userSearch: (q: string) => [...activityKeys.userSearches(), q] as const,
};

/**
 * One page of the activity log, keyed by the whole table state. The previous page stays on
 * screen while the next loads; a failure with no page to show throws to the route's error state.
 */
export function adminActivityQueryOptions(input: ListActivityInput) {
  return queryOptions({
    queryKey: activityKeys.list(input),
    queryFn: () => listAdminActivity({ data: input }),
    staleTime: STALE_TIME.adminActivityList,
    placeholderData: keepPreviousData,
    throwOnError: (_error, query) => query.state.data === undefined,
  });
}

/** The page of the activity log {@link adminActivityQueryOptions} returns. */
export type AdminActivityPage = Awaited<ReturnType<typeof listAdminActivity>>;

/** The users matching `q`, for the actor and target filters; off while `q` is empty. */
export function activityUserSearchQueryOptions(q: string) {
  const text = q.trim();
  return queryOptions({
    queryKey: activityKeys.userSearch(text),
    queryFn: () => searchAdminActivityUsers({ data: { q: text } }),
    staleTime: STALE_TIME.adminActivityUserSearch,
    enabled: text !== "",
  });
}
