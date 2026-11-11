// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Paraglide types every `m.key()` call, so a key missing from the source locale fails tsc. A
// key missing from a translation would silently fall back to English; these tests catch that.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { baseLocale, locales } from "@/i18n/runtime";

type Catalogue = Record<string, string>;

function load(locale: string): Catalogue {
  const text = readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8");
  const { $schema: _, ...messages } = JSON.parse(text) as Record<string, unknown>;
  for (const [key, value] of Object.entries(messages)) {
    if (typeof value !== "string") throw new Error(`${locale}.json: ${key} is not a string`);
  }
  return messages as Catalogue;
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
}

const source = load(baseLocale);

describe("message catalogues", () => {
  it("use English as the source locale and Dutch as the second", () => {
    expect(baseLocale).toBe("en");
    expect(locales).toEqual(["en", "nl"]);
  });

  it.each(locales.filter((locale) => locale !== baseLocale))(
    "%s has exactly the keys of the source locale",
    (locale) => {
      expect(Object.keys(load(locale)).sort()).toEqual(Object.keys(source).sort());
    },
  );

  it.each(locales)("%s has no empty message", (locale) => {
    const empty = Object.entries(load(locale)).filter(([, value]) => value.trim() === "");
    expect(empty).toEqual([]);
  });

  it.each(locales.filter((locale) => locale !== baseLocale))(
    "%s uses the same placeholders as the source locale",
    (locale) => {
      const translated = load(locale);
      for (const [key, message] of Object.entries(source)) {
        expect(placeholders(translated[key] ?? ""), key).toEqual(placeholders(message));
      }
    },
  );
});
