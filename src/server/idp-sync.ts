// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import type { BetterAuthOptions } from "better-auth";
import { NO_ROLE_ERROR, ROLE_CONFLICT_ERROR } from "../lib/identity-providers.ts";
import { idpRoleSource, LOCAL_ROLE_SOURCE, parseRoleSource } from "../lib/role-source.ts";
import { formatRoles, type Role, validateRoleValue } from "../lib/roles.ts";
import { auditRecorderOf, requestIdOf } from "./audit/better-auth-hooks.ts";
import { auditProvider } from "./audit/events.ts";
import { type RoleMap, resolveIdpRoles } from "./idp-roles.ts";
import { decideSignInRoles, type StoredRoles } from "./role-ownership.ts";

type ValidateUserInfo = NonNullable<NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]>;

export interface IdpRoleSyncOptions {
  /** Claim path per OIDC provider id (`microsoft`, `keycloak`). */
  claimPaths: Readonly<Record<string, string>>;
  roleMap: RoleMap;
  defaultRole?: Role | undefined;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/**
 * Reads the stored role set of an existing user through better-auth's internal adapter: the
 * `user` better-auth hands the gate carries the IdP profile, not the stored row.
 */
async function storedRolesOf(ctx: unknown, userId: string): Promise<StoredRoles | null> {
  const adapter = field(field(ctx, "context"), "internalAdapter");
  const find = field(adapter, "findUserById");
  if (typeof find !== "function") return null;
  const found: unknown = await Reflect.apply(find, adapter, [userId]);
  if (typeof found !== "object" || found === null) return null;
  return { role: field(found, "role"), roleSource: parseRoleSource(field(found, "roleSource")) };
}

/**
 * Builds better-auth's `user.validateUserInfo` gate for hybrid role ownership (owner decision
 * on #32, ADR 0010, ADR 0012).
 *
 * On every OAuth sign-in it resolves the role set from the fresh (verified) ID-token claims.
 * A mapped role is authoritative: the sorted set and the provider as `roleSource` are written
 * to the new user (`create-user`) or synced onto the existing one (`sign-in`, `link-account`).
 * Without one, the user's local roles apply ({@link decideSignInRoles}); a set eduLIMS does not
 * allow, or no role at all, rejects the sign-in. Other methods keep the stored roles.
 */
export function createIdpRoleSync(options: IdpRoleSyncOptions): ValidateUserInfo {
  return async ({ user, source }, ctx) => {
    if (source.method !== "oauth" || !source.oauth) return;
    const { providerId } = source.oauth;
    const claimPath = options.claimPaths[providerId];
    const roleSource = idpRoleSource(providerId);
    const fromIdp =
      claimPath && roleSource
        ? resolveIdpRoles({
            claims: source.oauth.profile ?? {},
            claimPath,
            roleMap: options.roleMap,
          })
        : { kind: "none" as const };
    const existingId =
      source.action !== "create-user" && typeof user.id === "string" ? user.id : null;
    const stored = existingId ? await storedRolesOf(ctx, existingId) : null;
    // A provider without a claim path is unknown: no default role, no local roles for it.
    const decision =
      claimPath && roleSource
        ? decideSignInRoles(fromIdp, stored, options.defaultRole)
        : ({ kind: "refused", reason: NO_ROLE_ERROR } as const);
    const recorder = auditRecorderOf(ctx.context);
    const provider = auditProvider(providerId);
    const requestId = requestIdOf(ctx);
    const known = {
      ...(typeof user.id === "string" ? { target: { type: "user" as const, id: user.id } } : {}),
      ...(provider ? { provider } : {}),
      ...(requestId ? { requestId } : {}),
    };
    if (decision.kind === "refused") {
      await recorder?.record({
        action: "authn_login_fail",
        actor: { type: "anonymous" },
        outcome: "refused",
        reason: decision.reason,
        ...known,
      });
      // NOTE: A07; a role the IdP took away ends the live access too, not only the next sign-in.
      if (typeof user.id === "string")
        await ctx.context.internalAdapter.deleteUserSessions(user.id);
      if (decision.reason === ROLE_CONFLICT_ERROR) {
        // Logs the provider only: never the user, the e-mail or the claims (A09, privacy).
        console.warn(`sign-in refused: ${ROLE_CONFLICT_ERROR} (provider ${providerId})`);
        return { error: ROLE_CONFLICT_ERROR, errorDescription: "Conflicting eduLIMS roles" };
      }
      return { error: NO_ROLE_ERROR, errorDescription: "No eduLIMS role assigned" };
    }
    if (decision.kind === "local") return;
    const role = formatRoles(decision.roles);
    const nextSource = decision.kind === "idp" && roleSource ? roleSource : LOCAL_ROLE_SOURCE;
    if (source.action === "create-user") {
      // NOTE: better-auth 1.7.18 validates the exact record it then inserts; should that change,
      // the user falls back to the lower admin-plugin default and is synced on the next sign-in.
      user["role"] = role;
      user["roleSource"] = nextSource;
      return;
    }
    if (!existingId) return;
    const previous = validateRoleValue(stored?.role);
    const previousRole = previous.ok ? formatRoles(previous.roles) : undefined;
    if (previousRole === role && stored?.roleSource === nextSource) return;
    await ctx.context.internalAdapter.updateUser(existingId, { role, roleSource: nextSource });
    if (previousRole === role) return;
    await recorder?.record({
      action: "authz_role_change",
      actor: { type: "system" },
      outcome: "success",
      metadata: { roles: role, ...(previousRole ? { previous_roles: previousRole } : {}) },
      ...known,
    });
  };
}
