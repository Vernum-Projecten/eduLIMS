// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Hybrid role ownership (owner decision on #32, B1) for users the identity provider provisions
// over SCIM (#45, ADR 0017). Pure: no I/O. Relative imports: `pnpm db:seed` loads auth.ts.
import type { ProviderId } from "../../lib/identity-providers.ts";
import { LOCAL_ROLE_SOURCE, type RoleSource } from "../../lib/role-source.ts";
import { formatRoles, type Role, validateRoleSet } from "../../lib/roles.ts";
import type { RoleMap } from "../idp-roles.ts";

/** One SCIM fact the role map may name: a group's `externalId` and name, or a `roles` value. */
export interface ScimRoleFact {
  /** The values the role map is tried with, in order; the first that maps wins. */
  keys: readonly string[];
}

/**
 * Returns the eduLIMS roles the role map gives each fact, by the first of its keys only. A group
 * maps on its `externalId` alone (the object id Entra ID puts in the `groups` claim too), never
 * on its display name, which a directory administrator can rename; one without maps nothing.
 */
export function mapScimFacts(facts: readonly ScimRoleFact[], roleMap: RoleMap): Role[] {
  return facts.flatMap((fact) => {
    const key = fact.keys[0];
    const role = key === undefined ? undefined : roleMap.get(key);
    return role ? [role] : [];
  });
}

/** The role set a SCIM change writes, or `unchanged` when the stored set stays. */
export type ScimRoleDecision =
  | { kind: "unchanged" }
  | {
      kind: "set";
      role: string | null;
      roleSource: RoleSource;
      roleChannel: "scim" | "local";
      reason?: "role_conflict";
    };

/**
 * Decides a provisioned user's roles from what the provider's role map gives their SCIM groups
 * and `roles` values (owner decision on #32).
 *
 * SCIM is authoritative for the roles of a user it provisioned (owner decision on the second
 * review of #108): a mapped set is stored with the provider as its source and `scim` as its
 * channel; a conflicting set (student with another role, ADR 0012) leaves no roles; without a
 * mapped role, any set the provider gave is taken away (A07), a claim's from before the user
 * was linked included (B1), and only a local set an administrator gave stays. SCIM never grants
 * a role the map does not name, so it never grants admin unless the map maps a group or value.
 */
export function decideScimRoles(
  mapped: readonly Role[],
  stored: { roleSource: RoleSource | null; roleChannel: string | null },
  providerId: ProviderId,
): ScimRoleDecision {
  if (mapped.length > 0) {
    const result = validateRoleSet(mapped);
    if (result.ok) {
      const role = formatRoles(result.roles);
      return { kind: "set", role, roleSource: providerId, roleChannel: "scim" };
    }
    return {
      kind: "set",
      role: null,
      roleSource: providerId,
      roleChannel: "scim",
      reason: "role_conflict",
    };
  }
  if (stored.roleSource === providerId) {
    return { kind: "set", role: null, roleSource: LOCAL_ROLE_SOURCE, roleChannel: "local" };
  }
  return { kind: "unchanged" };
}
