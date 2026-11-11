// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@tanstack/react-query";
import type { ProviderLabels } from "@/lib/i18n/user-labels";
import { providerLabelsQueryOptions } from "@/server/idp/query-options";

const NONE: ProviderLabels = {};

/**
 * Returns the names of the identity providers (ADR 0015), which the Users screen's role sources
 * and sign-in methods name by provider id. The route loader warms the query; until it answers,
 * a provider shows by its id.
 */
export function useProviderLabels(): ProviderLabels {
  return useQuery(providerLabelsQueryOptions()).data ?? NONE;
}
