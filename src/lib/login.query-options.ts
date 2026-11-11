// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of the login page: which sign-in methods it offers live in the
// Query cache under one key, warmed by the route loader and read with `useSuspenseQuery`.
import { queryOptions } from "@tanstack/react-query";
import { STALE_TIME } from "./query-config.ts";
import { getLoginOptions } from "./session.functions.ts";

/** The query keys of the login page, from the widest to the narrowest. */
export const loginKeys = {
  all: ["login"] as const,
  options: () => [...loginKeys.all, "options"] as const,
};

/**
 * The sign-in methods the login page offers: the enabled providers, the institution-email
 * field, the development login with its demo accounts, and the method this browser used last.
 */
export function loginOptionsQueryOptions() {
  return queryOptions({
    queryKey: loginKeys.options(),
    queryFn: () => getLoginOptions(),
    staleTime: STALE_TIME.loginOptions,
  });
}

/** The sign-in methods {@link loginOptionsQueryOptions} returns. */
export type LoginOptions = Awaited<ReturnType<typeof getLoginOptions>>;
