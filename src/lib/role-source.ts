// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Where a user's role set comes from (owner decision on #32, hybrid role ownership, B1): the
// identity provider that sent a mapped role, or `local` when an administrator assigned it in
// eduLIMS. Shared by the server and the Users screen. Relative imports: the seed loads this.

/** The sources a role set can have, as `user.role_source` stores them. */
export const ROLE_SOURCES = ["local", "microsoft", "keycloak"] as const;
export type RoleSource = (typeof ROLE_SOURCES)[number];

/** The source of a role set eduLIMS assigned itself. */
export const LOCAL_ROLE_SOURCE = "local" satisfies RoleSource;

/** Returns `value` when it names a {@link RoleSource}, else `null`. */
export function parseRoleSource(value: unknown): RoleSource | null {
  return ROLE_SOURCES.find((source) => source === value) ?? null;
}

/** Returns the role source an identity provider writes, or `null` for one eduLIMS does not know. */
export function idpRoleSource(providerId: string): Exclude<RoleSource, "local"> | null {
  const source = parseRoleSource(providerId);
  return source === null || source === LOCAL_ROLE_SOURCE ? null : source;
}

/**
 * Returns whether an administrator may edit a role set from `source` in eduLIMS: only a local
 * set, because the identity provider overwrites its own at the next sign-in.
 */
export function isLocallyEditable(source: RoleSource | null): boolean {
  return source === LOCAL_ROLE_SOURCE;
}
