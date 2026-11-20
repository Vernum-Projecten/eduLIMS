// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// `migrate` of the host CLI adds the catalogue's starter set after a successful `up`, the tools
// image's first-start command, and never after a `down` (#393; #404 review, F3).
import { afterEach, describe, expect, it, vi } from "vitest";
import { STARTER_TESTS } from "../catalogue/starter-set.ts";
import { migrateCommand } from "./migrate.ts";
import { type CommittedTestDb, createCommittedTestDb } from "./test-committed-db.ts";

let committed: CommittedTestDb | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  await committed?.destroy();
  committed = undefined;
});

async function tests(database: CommittedTestDb): Promise<number> {
  return (await database.db.selectFrom("catalogue_tests").select("id").execute()).length;
}

describe("migrateCommand and the starter set (#393)", () => {
  it("adds the starter set after `up` on an empty catalogue, once", async () => {
    committed = await createCommittedTestDb(2);
    vi.stubEnv("DATABASE_URL", committed.url);
    const lines: string[] = [];
    expect(await migrateCommand(["up"], (line) => lines.push(line))).toBe(0);
    expect(lines).toContain(`catalogue: ${STARTER_TESTS.length} starter tests added`);
    expect(await tests(committed)).toBe(STARTER_TESTS.length);
    lines.length = 0;
    expect(await migrateCommand([], (line) => lines.push(line))).toBe(0);
    expect(lines).toContain("catalogue: not empty, kept");
    expect(await tests(committed)).toBe(STARTER_TESTS.length);
  });

  it("adds nothing after `down`", async () => {
    committed = await createCommittedTestDb(2);
    vi.stubEnv("DATABASE_URL", committed.url);
    const lines: string[] = [];
    expect(await migrateCommand(["down"], (line) => lines.push(line))).toBe(0);
    expect(lines.some((line) => line.startsWith("catalogue:"))).toBe(false);
    expect(await tests(committed)).toBe(0);
  });
});
