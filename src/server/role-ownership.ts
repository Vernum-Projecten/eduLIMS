// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Hybrid role ownership (owner decision on #32, B1, ADR 0015): which role set an SSO sign-in
// gets. Pure: no I/O. Relative imports: `pnpm db:seed` loads auth.ts in plain Node.
import { NO_ROLE_ERROR, ROLE_CONFLICT_ERROR } from "../lib/identity-providers.ts";
import { isLocallyEditable, type RoleSource } from "../lib/role-source.ts";
import { type Role, validateRoleValue } from "../lib/roles.ts";
import type { IdpRoles } from "./idp-roles.ts";

/** The stored role set of an existing user, as the IdP sync reads it. */
export interface StoredRoles {
  role: unknown;
  roleSource: RoleSource | null;
  /** Whether the stored email is verified; the sign-in gate keeps it in step with the provider. */
  emailVerified?: boolean;
  /** The provider that provisioned the user over SCIM (#45), if one did. */
  provisionedBy?: string | null;
}

/** The outcome of {@link decideSignInRoles}. */
export type SignInRoles =
  /** The identity provider sent a mapped role: it is authoritative and replaces the set. */
  | { kind: "idp"; roles: Role[] }
  /** The identity provider sent none: the roles an administrator assigned apply. */
  | { kind: "local"; roles: Role[] }
  /** Neither: the provider's default role (or a pending admin grant), stored as a local set. */
  | { kind: "default"; roles: Role[] }
  | { kind: "refused"; reason: typeof NO_ROLE_ERROR | typeof ROLE_CONFLICT_ERROR };

/**
 * Decides the role set of an SSO sign-in (OIDC or SAML).
 *
 * `idp` is the IdP claims resolved without the default role. A mapped role wins and replaces
 * the stored set; a conflicting set is refused. Without a mapped role, an allowed stored set
 * whose source is `local` applies; a set the IdP once sent does not survive the IdP taking it
 * away (A07). Then `defaultRole`, else `no_edulims_role`.
 *
 * For a user `providerId` provisioned over SCIM (#45), the set its SCIM groups mapped stays when
 * the sign-in carries no mapped role, and the default role never applies: such a user has no
 * roles until the directory maps one or an administrator assigns local ones.
 */
export function decideSignInRoles(
  idp: IdpRoles,
  stored: StoredRoles | null,
  defaultRole: Role | undefined,
  providerId?: string,
): SignInRoles {
  if (idp.kind === "conflict") return { kind: "refused", reason: ROLE_CONFLICT_ERROR };
  if (idp.kind === "roles") return { kind: "idp", roles: idp.roles };
  const provisioned = providerId !== undefined && stored?.provisionedBy === providerId;
  if (provisioned && stored.roleSource === providerId) {
    const fromScim = validateRoleValue(stored.role);
    if (fromScim.ok) return { kind: "idp", roles: fromScim.roles };
    return { kind: "refused", reason: NO_ROLE_ERROR };
  }
  if (stored && isLocallyEditable(stored.roleSource)) {
    const local = validateRoleValue(stored.role);
    if (local.ok) return { kind: "local", roles: local.roles };
  }
  if (defaultRole && !provisioned) return { kind: "default", roles: [defaultRole] };
  return { kind: "refused", reason: NO_ROLE_ERROR };
}
