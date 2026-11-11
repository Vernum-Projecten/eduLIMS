// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { afterAll, describe, expect, it, vi } from "vitest";
import { VALID_ENV } from "../test-env.ts";

// Port 9 (discard) is never a Postgres server, so connecting fails fast.
for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
vi.stubEnv("DATABASE_URL", "postgres://nobody:nothing@127.0.0.1:9/none");

const { getDb, getPool, pingDatabase } = await import("./index.ts");

afterAll(async () => {
  await getDb().destroy();
  vi.unstubAllEnvs();
});

describe("database connection", () => {
  it("shares one pool between the query builder and better-auth", () => {
    expect(getPool()).toBe(getPool());
    expect(getDb()).toBe(getDb());
  });

  it("survives an idle connection the server drops, instead of crashing the process", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(getPool().listenerCount("error")).toBe(1);
    getPool().emit("error", new Error("terminating connection due to administrator command"));
    expect(logged).toHaveBeenCalledWith(
      "Idle database connection lost:",
      "terminating connection due to administrator command",
    );
    logged.mockRestore();
  });

  it("reports an unreachable database as not ready", async () => {
    expect(await pingDatabase()).toBe(false);
  });
});
