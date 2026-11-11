// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { m } from "@/i18n/messages";
// Display names for domain values that the code stores in English.
import { type IdentityProviderOption, ROLE_CONFLICT_ERROR } from "@/lib/identity-providers";
import { OWN_ROLES_ERROR, type Role } from "@/lib/roles";
import type { Theme } from "@/lib/theme";

/** Returns the display name of `role` in the active locale. */
export function roleLabel(role: Role): string {
  switch (role) {
    case "student":
      return m.role_student();
    case "teacher":
      return m.role_teacher();
    case "admin":
      return m.role_admin();
    default: {
      const unknown: never = role;
      return unknown;
    }
  }
}

/** Returns the display names of a role set in the active locale ("Teacher · Administrator"). */
export function rolesLabel(roles: readonly Role[]): string {
  return roles.map(roleLabel).join(" · ");
}

/**
 * Returns the translated message for a refused role write, from the better-auth error message
 * (`cannot_change_own_roles`, `role_conflict`), or `null` for any other error.
 */
export function roleWriteErrorMessage(message: string | undefined): string | null {
  if (message === OWN_ROLES_ERROR) return m.role_error_own_roles();
  if (message === ROLE_CONFLICT_ERROR) return m.role_error_not_allowed();
  return null;
}

/** Returns the login button text: the operator's configured label, else the localized default. */
export function providerLabel(provider: IdentityProviderOption): string {
  if (provider.label) return provider.label;
  return provider.id === "microsoft" ? m.login_microsoft() : m.login_keycloak();
}

/** Returns the display name of the colour theme `theme` in the active locale. */
export function themeLabel(theme: Theme): string {
  switch (theme) {
    case "light":
      return m.theme_light();
    case "dark":
      return m.theme_dark();
    case "system":
      return m.theme_system();
    default: {
      const unknown: never = theme;
      return unknown;
    }
  }
}
