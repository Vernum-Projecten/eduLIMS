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

/**
 * The language menu in the header: a button with the current language that opens a menu with
 * one radio item per locale. Each item names its language in that language and carries its own
 * `lang` (WCAG 3.1.2). A signed-in user's choice is saved to their account before the cookie
 * is set and the page reloads (ADR 0011).
 */
export function LanguageMenu({ signedIn }: Readonly<{ signedIn: boolean }>) {
  const active = getLocale();
  const save = useServerFn(savePreferredLocale);
  const mutation = useMutation({
    mutationFn: async (locale: Locale) => {
      if (signedIn) await save({ data: { locale } });
      return locale;
    },
    onSuccess: switchLocale,
    onError: () => {
      toast.error(m.language_save_failed());
    },
  });

  function choose(value: string) {
    const locale = locales.find((candidate) => candidate === value);
    if (locale && locale !== active) mutation.mutate(locale);
  }

  return (
    // Non-modal: a modal menu hides the page with aria-hidden while its links stay focusable
    // (axe `aria-hidden-focus`). Escape, Tab and a click outside still close it.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={m.language_menu_trigger({ language: localeName(active) })}
          disabled={mutation.isPending}
        >
          <LanguagesIcon aria-hidden="true" data-icon="inline-start" />
          <span lang={active}>{localeName(active)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{m.language_switcher_label()}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={active} onValueChange={choose}>
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
