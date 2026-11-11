// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { m } from "@/i18n/messages";
// Display names for domain values that the code stores in English.
import type { IdentityProviderOption } from "@/lib/identity-providers";
import type { Role } from "@/lib/roles";
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
