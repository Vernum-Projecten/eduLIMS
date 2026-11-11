// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The TanStack Query layer of the signed-in user's own preferences: the mutation options of
// saving the language and the landing portal. The saved portal is part of the session user,
// so its optimistic write goes to the session entry of the cache and nowhere else.
import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import type { Locale } from "../../i18n/runtime.js";
import type { Role } from "../../lib/roles.ts";
import { type SessionQueryData, sessionKeys } from "../../lib/session.query-options.ts";
import type { SaveLastPortalInput, SavePreferredLocaleInput } from "./schemas.ts";

/**
 * The mutation keys of the preferences. Preferences have no read query of their own: the
 * language is the locale cookie and the landing portal is part of the session user.
 */
export const preferencesKeys = {
  all: ["preferences"] as const,
  locale: () => [...preferencesKeys.all, "locale"] as const,
  lastPortal: () => [...preferencesKeys.all, "last-portal"] as const,
};

/** `savePreferredLocale` as `useServerFn` returns it. */
export type SaveLocaleCall = (options: {
  data: SavePreferredLocaleInput;
}) => Promise<{ locale: Locale }>;

/** `saveLastPortal` as `useServerFn` returns it. */
export type SaveLastPortalCall = (options: {
  data: SaveLastPortalInput;
}) => Promise<{ portal: Role }>;

/** The session entry an optimistic portal write replaced, to put back on failure. */
export interface SessionSnapshot {
  previous: SessionQueryData | undefined;
}

/**
 * Saves the language a user picked (ADR 0011). The menu shows the pick at once from the
 * mutation's `variables` while it is pending and falls back to the active language when it
 * fails, so the rollback needs no cache write. A visitor without a session saves nothing. The
 * page reloads in the new language on success, so the mutation invalidates no key.
 */
export function saveLocaleMutationOptions(call: SaveLocaleCall, signedIn: boolean) {
  return mutationOptions({
    mutationKey: preferencesKeys.locale(),
    mutationFn: async (locale: Locale): Promise<Locale> => {
      if (signedIn) await call({ data: { locale } });
      return locale;
    },
  });
}

/**
 * Saves the portal a user switched to as their landing portal (ADR 0012), optimistically: the
 * cached session user carries the new portal at once and gets the old one back if the save
 * fails. Only the session entry is invalidated.
 */
export function saveLastPortalMutationOptions(queryClient: QueryClient, call: SaveLastPortalCall) {
  return mutationOptions({
    mutationKey: preferencesKeys.lastPortal(),
    mutationFn: async (portal: Role): Promise<Role> => (await call({ data: { portal } })).portal,
    onMutate: async (portal): Promise<SessionSnapshot> => {
      await queryClient.cancelQueries({ queryKey: sessionKeys.current() });
      const previous = queryClient.getQueryData<SessionQueryData>(sessionKeys.current());
      queryClient.setQueryData<SessionQueryData>(sessionKeys.current(), (user) =>
        user ? { ...user, lastPortal: portal } : user,
      );
      return { previous };
    },
    onError: (_error, _portal, snapshot) => {
      if (snapshot) queryClient.setQueryData(sessionKeys.current(), snapshot.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: sessionKeys.current() }),
  });
}
