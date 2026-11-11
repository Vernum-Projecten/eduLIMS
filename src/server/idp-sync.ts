// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import type { BetterAuthOptions } from "better-auth";
import { NO_ROLE_ERROR } from "../lib/identity-providers.ts";
import type { Role } from "../lib/roles.ts";
import { type RoleMap, resolveIdpRole } from "./idp-roles.ts";

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
 * On every OAuth sign-in it resolves the role from the fresh (verified) ID-token claims:
 * without a mapped role the sign-in is rejected; otherwise the role is written to the new
 * user (`create-user`) or synced onto the existing one (`sign-in`, `link-account`).
 * Other methods (dev login, admin-created users) keep the role stored in the database.
 */
export function createIdpRoleSync(options: IdpRoleSyncOptions): ValidateUserInfo {
  return async ({ user, source }, ctx) => {
    if (source.method !== "oauth" || !source.oauth) return;
    const claimPath = options.claimPaths[source.oauth.providerId];
    const role = claimPath
      ? resolveIdpRole({
          claims: source.oauth.profile ?? {},
          claimPath,
          roleMap: options.roleMap,
          defaultRole: options.defaultRole,
        })
      : null;
    if (!role) {
      return { error: NO_ROLE_ERROR, errorDescription: "No eduLIMS role assigned" };
    }
    if (source.action === "create-user") {
      // NOTE: better-auth 1.7.18 validates the exact record it then inserts; should that change,
      // the user falls back to the lower admin-plugin default and is synced on the next sign-in.
      user["role"] = role;
      return;
    }
    if (typeof user.id === "string" && user["role"] !== role) {
      await ctx.context.internalAdapter.updateUser(user.id, { role });
    }
  };
}
