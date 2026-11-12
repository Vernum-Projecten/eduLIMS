// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of the Admin portal's overview (#36): one key and its read.
import { queryOptions } from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import { getAdminOverview } from "./functions.ts";

/** The query keys of the overview. */
export const adminOverviewKeys = {
  all: ["admin-overview"] as const,
  summary: () => [...adminOverviewKeys.all, "summary"] as const,
};

/** The overview's account counts and latest events. */
export function adminOverviewQueryOptions() {
  return queryOptions({
    queryKey: adminOverviewKeys.summary(),
    queryFn: () => getAdminOverview({ data: {} }),
    staleTime: STALE_TIME.adminOverview,
  });
}
