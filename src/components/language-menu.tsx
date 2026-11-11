// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LanguagesIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { m } from "@/i18n/messages";
import { getLocale, type Locale, localeName, locales, switchLocale } from "@/lib/i18n/locale";
import { savePreferredLocale } from "@/server/preferences/functions";
import { saveLocaleMutationOptions } from "@/server/preferences/query-options";

/**
 * The language menu in the header: a button with the current language that opens a menu with
 * one radio item per locale. Each item names its language in that language and carries its own
 * `lang` (WCAG 3.1.2). A signed-in user's choice is saved to their account before the cookie
 * is set and the page reloads (ADR 0011). The menu shows the choice at once and goes back to
 * the active language, with a toast, when the save fails.
 */
export function LanguageMenu({ signedIn }: Readonly<{ signedIn: boolean }>) {
  const active = getLocale();
  const save = useServerFn(savePreferredLocale);
  const mutation = useMutation({
    ...saveLocaleMutationOptions(save, signedIn),
    onSuccess: switchLocale,
    onError: () => {
      toast.error(m.language_save_failed());
    },
  });

  function choose(value: string) {
    const locale = locales.find((candidate) => candidate === value);
    if (locale && locale !== active) mutation.mutate(locale);
  }
  // The optimistic choice: shown while the save runs, gone again when it fails.
  const shown: Locale = mutation.isPending ? mutation.variables : active;

  return (
    // Non-modal: a modal menu hides the page with aria-hidden while its links stay focusable
    // (axe `aria-hidden-focus`). Escape, Tab and a click outside still close it.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={m.language_menu_trigger({ language: localeName(shown) })}
          disabled={mutation.isPending}
        >
          <LanguagesIcon aria-hidden="true" data-icon="inline-start" />
          <span lang={shown}>{localeName(shown)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{m.language_switcher_label()}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={shown} onValueChange={choose}>
          {locales.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale} lang={locale}>
              {localeName(locale)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
