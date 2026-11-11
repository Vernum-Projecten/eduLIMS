// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type LucideIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { m } from "@/i18n/messages";
import { themeLabel } from "@/lib/i18n/labels";
import { parseTheme, THEMES, type Theme } from "@/lib/theme";

const THEME_ICONS = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
} as const satisfies Record<Theme, LucideIcon>;

/** The three theme choices as radio items, for a menu or a submenu. */
function ThemeRadioItems() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(parseTheme(value))}>
      {THEMES.map((option) => {
        const Icon = THEME_ICONS[option];
        return (
          <DropdownMenuRadioItem key={option} value={option}>
            <Icon aria-hidden="true" />
            {themeLabel(option)}
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}

/** A compact theme button with a menu, for the pages without the user menu. */
export function ThemeMenu() {
  const { theme } = useTheme();
  const Icon = THEME_ICONS[theme];
  return (
    // Non-modal for the same reason as the language menu (axe `aria-hidden-focus`).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={m.theme_menu_trigger({ theme: themeLabel(theme) })}
        >
          <Icon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{m.theme_label()}</DropdownMenuLabel>
        <ThemeRadioItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The theme submenu inside the user menu. */
export function ThemeSubmenu() {
  const { theme } = useTheme();
  const Icon = THEME_ICONS[theme];
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon aria-hidden="true" />
        {m.theme_label()}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <ThemeRadioItems />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
