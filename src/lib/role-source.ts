// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Where a user's role set comes from (owner decision on #32, hybrid role ownership, B1): the
// identity provider that sent a mapped role (its provider id, ADR 0015), or `local` when an
// administrator assigned it in eduLIMS. Shared by the server and the Users screen.
// Relative imports: the seed loads this.
import { type ProviderId, parseProviderId } from "./identity-providers.ts";

/** The source of a role set eduLIMS assigned itself. */
export const LOCAL_ROLE_SOURCE = "local";

/** A role source as `user.role_source` stores it: `local` or the id of an identity provider. */
export type RoleSource = typeof LOCAL_ROLE_SOURCE | ProviderId;

/** Returns `value` when it names a {@link RoleSource}, else `null`. */
export function parseRoleSource(value: unknown): RoleSource | null {
  if (value === LOCAL_ROLE_SOURCE) return LOCAL_ROLE_SOURCE;
  return parseProviderId(value);
}

/**
 * Returns whether an administrator may edit a role set from `source` in eduLIMS: only a local
 * set, because the identity provider overwrites its own at the next sign-in.
 */
export function isLocallyEditable(source: RoleSource | null): boolean {
  return source === LOCAL_ROLE_SOURCE;
}
