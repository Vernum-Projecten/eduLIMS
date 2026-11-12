// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of Admin → System (#36): one key and its read.
import { queryOptions } from "@tanstack/react-query";
import { STALE_TIME } from "../../lib/query-config.ts";
import { getSystemConfiguration } from "./functions.ts";

/** The query keys of the system page. */
export const systemKeys = {
  all: ["admin-system"] as const,
  configuration: () => [...systemKeys.all, "configuration"] as const,
};

/** The system page's read-only configuration. */
export function systemConfigurationQueryOptions() {
  return queryOptions({
    queryKey: systemKeys.configuration(),
    queryFn: () => getSystemConfiguration({ data: {} }),
    staleTime: STALE_TIME.systemConfiguration,
  });
}
