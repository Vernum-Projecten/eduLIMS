// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import type { BetterAuthOptions } from "better-auth";
import { NO_ROLE_ERROR, ROLE_CONFLICT_ERROR } from "../lib/identity-providers.ts";
import { formatRoles, type Role, validateRoleValue } from "../lib/roles.ts";
import { auditRecorderOf, requestIdOf } from "./audit/better-auth-hooks.ts";
import { auditProvider } from "./audit/events.ts";
import { type RoleMap, resolveIdpRoles } from "./idp-roles.ts";

type ValidateUserInfo = NonNullable<NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]>;

export interface IdpRoleSyncOptions {
  /** Claim path per OIDC provider id (`microsoft`, `keycloak`). */
  claimPaths: Readonly<Record<string, string>>;
  roleMap: RoleMap;
  defaultRole?: Role | undefined;
}

/**
 * Builds better-auth's `user.validateUserInfo` gate that makes the IdP the source of roles.
 *
 * On every OAuth sign-in it resolves the role set from the fresh (verified) ID-token claims:
 * without a mapped role, or with a set eduLIMS does not allow (ADR 0012), the sign-in is
 * rejected; otherwise the sorted set (`teacher,admin`) is written to the new user
 * (`create-user`) or synced onto the existing one (`sign-in`, `link-account`).
 * Other methods (dev login, admin-created users) keep the role stored in the database.
 */
export function createIdpRoleSync(options: IdpRoleSyncOptions): ValidateUserInfo {
  return async ({ user, source }, ctx) => {
    if (source.method !== "oauth" || !source.oauth) return;
    const { providerId } = source.oauth;
    const claimPath = options.claimPaths[providerId];
    const resolved = claimPath
      ? resolveIdpRoles({
          claims: source.oauth.profile ?? {},
          claimPath,
          roleMap: options.roleMap,
          defaultRole: options.defaultRole,
        })
      : { kind: "none" as const };
    const recorder = auditRecorderOf(ctx.context);
    const provider = auditProvider(providerId);
    const requestId = requestIdOf(ctx);
    const known = {
      ...(typeof user.id === "string" ? { target: { type: "user" as const, id: user.id } } : {}),
      ...(provider ? { provider } : {}),
      ...(requestId ? { requestId } : {}),
    };
    if (resolved.kind !== "roles") {
      await recorder?.record({
        action: "authn_login_fail",
        actor: { type: "anonymous" },
        outcome: "refused",
        reason: resolved.kind === "conflict" ? ROLE_CONFLICT_ERROR : NO_ROLE_ERROR,
        ...known,
      });
      // NOTE: A07; a role the IdP took away ends the live access too, not only the next sign-in.
      if (typeof user.id === "string")
        await ctx.context.internalAdapter.deleteUserSessions(user.id);
      if (resolved.kind === "conflict") {
        // Logs the provider only: never the user, the e-mail or the claims (A09, privacy).
        console.warn(`sign-in refused: ${ROLE_CONFLICT_ERROR} (provider ${providerId})`);
        return { error: ROLE_CONFLICT_ERROR, errorDescription: "Conflicting eduLIMS roles" };
      }
      return { error: NO_ROLE_ERROR, errorDescription: "No eduLIMS role assigned" };
    }
    const role = formatRoles(resolved.roles);
    if (source.action === "create-user") {
      // NOTE: better-auth 1.7.18 validates the exact record it then inserts; should that change,
      // the user falls back to the lower admin-plugin default and is synced on the next sign-in.
      user["role"] = role;
      return;
    }
    if (typeof user.id === "string" && user["role"] !== role) {
      await ctx.context.internalAdapter.updateUser(user.id, { role });
      const previous = validateRoleValue(user["role"]);
      await recorder?.record({
        action: "authz_role_change",
        actor: { type: "system" },
        outcome: "success",
        metadata: {
          roles: role,
          ...(previous.ok ? { previous_roles: formatRoles(previous.roles) } : {}),
        },
        ...known,
      });
    }
  };
}
