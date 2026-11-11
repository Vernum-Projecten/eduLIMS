// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Hybrid role ownership (owner decision on #32, B1, ADR 0010): which role set an OIDC sign-in
// gets. Pure: no I/O. Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import { NO_ROLE_ERROR, ROLE_CONFLICT_ERROR } from "../lib/identity-providers.ts";
import { isLocallyEditable, type RoleSource } from "../lib/role-source.ts";
import { type Role, validateRoleValue } from "../lib/roles.ts";
import type { IdpRoles } from "./idp-roles.ts";

/** The stored role set of an existing user, as the IdP sync reads it. */
export interface StoredRoles {
  role: unknown;
  roleSource: RoleSource | null;
}

/** The outcome of {@link decideSignInRoles}. */
export type SignInRoles =
  /** The identity provider sent a mapped role: it is authoritative and replaces the set. */
  | { kind: "idp"; roles: Role[] }
  /** The identity provider sent none: the roles an administrator assigned apply. */
  | { kind: "local"; roles: Role[] }
  /** Neither: the operator's `OIDC_DEFAULT_ROLE`, stored as a local set. */
  | { kind: "default"; roles: Role[] }
  | { kind: "refused"; reason: typeof NO_ROLE_ERROR | typeof ROLE_CONFLICT_ERROR };

/**
 * Decides the role set of an OIDC sign-in.
 *
 * `idp` is the IdP claims resolved without the default role. A mapped role wins and replaces
 * the stored set; a conflicting set is refused. Without a mapped role, an allowed stored set
 * whose source is `local` applies; a set the IdP once sent does not survive the IdP taking it
 * away (A07). Then `defaultRole`, else `no_edulims_role`.
 */
export function decideSignInRoles(
  idp: IdpRoles,
  stored: StoredRoles | null,
  defaultRole: Role | undefined,
): SignInRoles {
  if (idp.kind === "conflict") return { kind: "refused", reason: ROLE_CONFLICT_ERROR };
  if (idp.kind === "roles") return { kind: "idp", roles: idp.roles };
  if (stored && isLocallyEditable(stored.roleSource)) {
    const local = validateRoleValue(stored.role);
    if (local.ok) return { kind: "local", roles: local.roles };
  }
  if (defaultRole) return { kind: "default", roles: [defaultRole] };
  return { kind: "refused", reason: NO_ROLE_ERROR };
}
