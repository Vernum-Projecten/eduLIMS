// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { cookieLocaleDiffersFromDocument, documentLocale, getLocale, localeName } from "./locale";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("documentLocale", () => {
  it("is undefined outside a browser", () => {
    expect(documentLocale()).toBeUndefined();
  });

  it.each([
    ["nl", "nl"],
    ["en", "en"],
    ["NL", "nl"],
    ["de", undefined],
    ["", undefined],
  ])("reads <html lang=%j> as %j", (lang, expected) => {
    vi.stubGlobal("document", { documentElement: { lang } });
    expect(documentLocale()).toBe(expected);
  });
});

describe("cookieLocaleDiffersFromDocument", () => {
  it("is false outside a browser", () => {
    expect(cookieLocaleDiffersFromDocument()).toBe(false);
  });

  it.each([
    ["EDULIMS_LOCALE=nl", "en", true],
    ["other=1; EDULIMS_LOCALE=en", "nl", true],
    ["EDULIMS_LOCALE=nl", "nl", false],
    ["", "en", false],
    ["EDULIMS_LOCALE=de", "en", false],
  ])("cookie %j with <html lang=%j> gives %j", async (cookie, lang, expected) => {
    // The runtime caches the cookie read until the next microtask.
    await Promise.resolve();
    vi.stubGlobal("document", { cookie, documentElement: { lang } });
    expect(cookieLocaleDiffersFromDocument()).toBe(expected);
  });
});

describe("localeName", () => {
  it("names each language in that language", () => {
    expect(localeName("en")).toBe("English");
    expect(localeName("nl")).toBe("Nederlands");
  });
});

describe("getLocale", () => {
  it("falls back to English without a request or a document", () => {
    expect(getLocale()).toBe("en");
  });
});
