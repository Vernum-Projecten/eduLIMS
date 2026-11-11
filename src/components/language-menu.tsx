// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { LanguagesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { getLocale, localeName, locales, switchLocale } from "@/lib/i18n/locale";

/**
 * Lets the user pick the interface language. Each option names its language in that language
 * and carries its own `lang` (WCAG 3.1.2); the active one is marked with `aria-pressed`.
 */
export function LocaleSwitcher() {
  const active = getLocale();
  return (
    <fieldset className="flex items-center gap-1">
      <legend className="sr-only">{m.language_switcher_label()}</legend>
      <LanguagesIcon aria-hidden="true" className="size-4 text-muted-foreground" />
      {locales.map((locale) => (
        <Button
          key={locale}
          type="button"
          size="sm"
          variant={locale === active ? "secondary" : "ghost"}
          lang={locale}
          aria-pressed={locale === active}
          onClick={() => {
            if (locale !== active) switchLocale(locale);
          }}
        >
          {localeName(locale)}
        </Button>
      ))}
    </fieldset>
  );
}
