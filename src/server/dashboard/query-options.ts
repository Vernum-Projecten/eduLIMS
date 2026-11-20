// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of the teacher dashboard (D11, #386). It has no writes; a start or a
// finish on another page changes it, so it is read anew on every visit.
import { queryOptions } from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import { getRunningSimulationFn } from "./functions.ts";

/** The query keys of the dashboard. */
export const dashboardKeys = {
  all: ["dashboard"] as const,
  /** The running simulation, as the session's teacher sees it. */
  running: () => [...dashboardKeys.all, "running"] as const,
};

/** The running simulation as the dashboard shows it. */
export function runningSimulationQueryOptions() {
  return queryOptions({
    queryKey: dashboardKeys.running(),
    queryFn: () => getRunningSimulationFn(),
    staleTime: STALE_TIME.dashboard,
  });
}
