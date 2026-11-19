// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { biomeExcludes, isExcluded } from "./test-source-files.ts";

describe("the generated files the boundary tests skip (#320)", () => {
  const biome = JSON.stringify({
    files: { includes: ["**", "!src/routeTree.gen.ts", "!src/i18n", "!!dist", "!**/*.md"] },
  });

  it("reads the excluded patterns from biome.json's files.includes", () => {
    expect(biomeExcludes(biome)).toEqual(["src/routeTree.gen.ts", "src/i18n", "dist", "**/*.md"]);
  });

  it("refuses a biome.json without a files.includes list", () => {
    expect(() => biomeExcludes("{}")).toThrow("biome.json has no files.includes list.");
  });

  it("skips a named file, everything in a named folder and a glob match", () => {
    const excludes = biomeExcludes(biome);
    expect(isExcluded("src/routeTree.gen.ts", excludes)).toBe(true);
    expect(isExcluded("src/i18n/messages/_index.js", excludes)).toBe(true);
    expect(isExcluded("docs/readme.md", excludes)).toBe(true);
  });

  it("keeps a hand-written file next to a generated one", () => {
    const excludes = biomeExcludes(biome);
    expect(isExcluded("src/router.tsx", excludes)).toBe(false);
    expect(isExcluded("src/lib/i18n/format.ts", excludes)).toBe(false);
    expect(isExcluded("src/i18n-helpers.ts", excludes)).toBe(false);
  });
});
