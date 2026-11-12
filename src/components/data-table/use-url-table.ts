// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useRouter } from "@tanstack/react-router";
import {
  type UrlTableHandlers,
  type UrlTableMapping,
  urlTableHandlers,
} from "@/lib/data-table-state";

/** The route's search schema: what its `validateSearch` runs on the URL. */
interface SearchSchema<TSearch> {
  parse: (input: unknown) => TSearch;
}

/**
 * Returns the sorting, filter and pagination handlers of a table whose state the URL holds
 * (#58). Each change starts from the router's current search, parsed with the route's own
 * schema, so a pick made before the page re-renders keeps the one before it (#194).
 */
export function useUrlTable<TSearch>(
  mapping: UrlTableMapping<TSearch>,
  schema: SearchSchema<TSearch>,
  write: (next: TSearch, prev: TSearch) => void,
): UrlTableHandlers {
  const router = useRouter();
  return urlTableHandlers(mapping, () => schema.parse(router.latestLocation.search), write);
}
