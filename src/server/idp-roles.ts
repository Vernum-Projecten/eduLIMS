// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Pure mapping from identity-provider claims to eduLIMS roles, shared by every provider.
import { isRole, ROLES, type Role, validateRoleSet } from "../lib/roles.ts";

/** Maps IdP role names (case-sensitive, as the IdP emits them) to app roles. */
export type RoleMap = ReadonlyMap<string, Role>;

/**
 * Parses a role map in its text form (`idp-name:app-role,…`, `pnpm idp:add --role-map`).
 *
 * @throws Error when an entry is malformed, names an unknown app role or repeats an IdP name.
 */
export function parseRoleMap(text: string): RoleMap {
  const map = new Map<string, Role>();
  for (const entry of text.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.lastIndexOf(":");
    const idpRole = trimmed.slice(0, separator).trim();
    const appRole = trimmed.slice(separator + 1).trim();
    if (separator <= 0 || !idpRole || !isRole(appRole)) {
      throw new Error(`invalid entry "${trimmed}": expected <idp-role>:<${ROLES.join("|")}>`);
    }
    if (map.has(idpRole)) throw new Error(`duplicate IdP role "${idpRole}"`);
    map.set(idpRole, appRole);
  }
  if (map.size === 0) throw new Error("must map at least one IdP role");
  return map;
}

/** Reads a claim by dot path (`realm_access.roles`), or `undefined` when any step is missing. */
export function readClaim(claims: Readonly<Record<string, unknown>>, path: string): unknown {
  let current: unknown = claims;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Normalises a claim value to role names: a string array, or a single string. */
function claimValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

export interface RoleResolution {
  claims: Readonly<Record<string, unknown>>;
  claimPath: string;
  roleMap: RoleMap;
  /** Opt-in fallback for users without a mapped role; without it they are denied. */
  defaultRole?: Role | undefined;
}

/** The outcome of {@link resolveIdpRoles}. */
export type IdpRoles = { kind: "roles"; roles: Role[] } | { kind: "none" } | { kind: "conflict" };

/**
 * Resolves the role set for a sign-in from the IdP claims (ADR 0012): every claim value is
 * mapped through the role map, and the set must be allowed. Without a mapped role it falls
 * back to `defaultRole`, else `none` (deny); a set with student and another role is a
 * `conflict` (deny), never trimmed to one of its roles.
 */
export function resolveIdpRoles({
  claims,
  claimPath,
  roleMap,
  defaultRole,
}: RoleResolution): IdpRoles {
  const mapped = claimValues(readClaim(claims, claimPath)).flatMap((name) => {
    const role = roleMap.get(name);
    return role ? [role] : [];
  });
  const result = validateRoleSet(mapped.length > 0 ? mapped : defaultRole ? [defaultRole] : []);
  if (result.ok) return { kind: "roles", roles: result.roles };
  return result.reason === "conflict" ? { kind: "conflict" } : { kind: "none" };
}
