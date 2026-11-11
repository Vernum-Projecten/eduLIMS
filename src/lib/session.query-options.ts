// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of the session: the signed-in user lives in the Query cache under
// one key, and the root `beforeLoad` reads it from there on every navigation.
import { queryOptions } from "@tanstack/react-query";
import { STALE_TIME } from "./query-config.ts";
import { getSession } from "./session.functions.ts";

/** The query keys of the session, from the widest to the narrowest. */
export const sessionKeys = {
  all: ["session"] as const,
  current: () => [...sessionKeys.all, "current"] as const,
};

/**
 * The signed-in user, or `null`. Always stale, so `fetchQuery` in the root `beforeLoad` asks
 * the server on every navigation and a role change or a revoked session applies at once.
 */
export function sessionQueryOptions() {
  return queryOptions({
    queryKey: sessionKeys.current(),
    queryFn: () => getSession(),
    staleTime: STALE_TIME.session,
    // NOTE: no requirement governs this: our own design. The guards decide on this answer, so
    // a failure shows the error state at once instead of holding the navigation for a retry.
    retry: false,
  });
}

/** The signed-in user {@link sessionQueryOptions} returns, or `null`. */
export type SessionQueryData = Awaited<ReturnType<typeof getSession>>;
