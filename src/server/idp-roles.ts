// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Pure mapping from identity-provider claims to eduLIMS roles, shared by every OIDC provider.
import { ROLES, type Role } from "../lib/roles.ts";

/** Maps IdP role names (case-sensitive, as the IdP emits them) to app roles. */
export type RoleMap = ReadonlyMap<string, Role>;

/** Precedence when a user holds several roles: the highest one wins. */
const ROLE_RANK: Record<Role, number> = { student: 1, docent: 2, beheerder: 3 };

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * Parses `OIDC_ROLE_MAP` (`idp-name:app-role,…`) into a {@link RoleMap}.
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

/** Returns the highest of the given roles, or `null` for none. */
export function highestRole(roles: Iterable<Role>): Role | null {
  let best: Role | null = null;
  for (const role of roles) {
    if (!best || ROLE_RANK[role] > ROLE_RANK[best]) best = role;
  }
  return best;
}

export interface RoleResolution {
  claims: Readonly<Record<string, unknown>>;
  claimPath: string;
  roleMap: RoleMap;
  /** Opt-in fallback for users without a mapped role; without it they are denied. */
  defaultRole?: Role | undefined;
}

/**
 * Resolves the single app role for a sign-in from the IdP claims: the highest mapped role,
 * else `defaultRole`, else `null` (deny).
 */
export function resolveIdpRole({
  claims,
  claimPath,
  roleMap,
  defaultRole,
}: RoleResolution): Role | null {
  const mapped = claimValues(readClaim(claims, claimPath)).flatMap((name) => {
    const role = roleMap.get(name);
    return role ? [role] : [];
  });
  return highestRole(mapped) ?? defaultRole ?? null;
}
