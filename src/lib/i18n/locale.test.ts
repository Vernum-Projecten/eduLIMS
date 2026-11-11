// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { documentLocale, getLocale, localeName } from "./locale";

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
