// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Keycloak stores these realm fields in `VARCHAR(255)` columns, so a longer value fails the import. */
const KEYCLOAK_VARCHAR_LIMIT = 255;
const LIMITED_KEYS = new Set(["description", "name", "displayName"]);

function overLimit(node: unknown, path: string, found: string[]): string[] {
  if (Array.isArray(node)) {
    node.forEach((child, index) => {
      overLimit(child, `${path}[${index}]`, found);
    });
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      const at = `${path}.${key}`;
      if (
        LIMITED_KEYS.has(key) &&
        typeof value === "string" &&
        value.length > KEYCLOAK_VARCHAR_LIMIT
      ) {
        found.push(`${at} (${value.length})`);
      }
      overLimit(value, at, found);
    }
  }
  return found;
}

describe("the dev Keycloak realm", () => {
  it("keeps every description and name within Keycloak's 255-character columns (#364)", () => {
    const realm: unknown = JSON.parse(readFileSync("docker/keycloak/edulims-realm.json", "utf8"));
    expect(overLimit(realm, "realm", [])).toEqual([]);
  });
});
