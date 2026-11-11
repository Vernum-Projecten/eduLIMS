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
 * Returns the eduLIMS roles the role map gives each fact: a group by its `externalId` first (the
 * object id Entra ID puts in the `groups` claim too), then its display name.
 */
export function mapScimFacts(facts: readonly ScimRoleFact[], roleMap: RoleMap): Role[] {
  return facts.flatMap((fact) => {
    for (const key of fact.keys) {
      const role = roleMap.get(key);
      if (role) return [role];
    }
    return [];
  });
}

/** The role set a SCIM change writes, or `unchanged` when the local set stays. */
export type ScimRoleDecision =
  | { kind: "unchanged" }
  | { kind: "set"; role: string | null; roleSource: RoleSource; reason?: "role_conflict" };

/**
 * Decides a provisioned user's roles from what the provider's role map gives their SCIM groups
 * and `roles` values (owner decision on #32).
 *
 * A mapped set is authoritative and stored with the provider as its source. A conflicting set
 * (student with another role, ADR 0012) leaves the user without roles. Without a mapped role, a
 * set this provider once sent is taken away (A07) and the user has no roles until an
 * administrator assigns local ones; a local set stays. SCIM never grants a role the map does
 * not name, so it never grants admin unless the map maps a group or value to it.
 */
export function decideScimRoles(
  mapped: readonly Role[],
  stored: { roleSource: RoleSource | null },
  providerId: ProviderId,
): ScimRoleDecision {
  if (mapped.length > 0) {
    const result = validateRoleSet(mapped);
    if (result.ok) return { kind: "set", role: formatRoles(result.roles), roleSource: providerId };
    return { kind: "set", role: null, roleSource: providerId, reason: "role_conflict" };
  }
  if (stored.roleSource === providerId) {
    return { kind: "set", role: null, roleSource: LOCAL_ROLE_SOURCE };
  }
  return { kind: "unchanged" };
}
