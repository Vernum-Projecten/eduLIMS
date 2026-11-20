// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Returns every message key of a catalogue, without the inlang schema entry. */
function catalogueKeys(path: string): string[] {
  const catalogue: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (catalogue === null || typeof catalogue !== "object") throw new Error(`${path} is no object`);
  return Object.keys(catalogue).filter((key) => !key.startsWith("$"));
}

/** Returns every `m.<key>` reference and every snake_case string literal in the application code. */
function referencedNames(): Set<string> {
  const out = execFileSync(
    "git",
    ["grep", "-h", "-o", "-E", String.raw`m\.[a-zA-Z0-9_]+|"[a-z0-9_]+"`, "--", "src"],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const names = new Set<string>();
  for (const match of out.split("\n")) {
    if (match.startsWith("m.")) names.add(match.slice(2));
    else if (match.length > 2) names.add(match.slice(1, -1));
  }
  return names;
}

describe("the message catalogues", () => {
  // NOTE: #301; a key is used when the code names it as `m.<key>` or as a literal it looks up.
  it("hold no key that the application code never uses", () => {
    const used = referencedNames();
    expect(catalogueKeys("messages/en.json").filter((key) => !used.has(key))).toEqual([]);
  });

  it("hold the same keys in en and nl (ADR 0011)", () => {
    expect(catalogueKeys("messages/nl.json").sort()).toEqual(
      catalogueKeys("messages/en.json").sort(),
    );
  });
});
