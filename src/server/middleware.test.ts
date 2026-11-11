// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./authz.ts";

const getSession = vi.fn();
vi.mock("./auth.ts", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders: () => new Headers() }));

const { getSessionUser } = await import("./session.ts");
const { AuthError, authMiddleware, requireRole } = await import("./middleware.ts");

const betterAuthSession = {
  session: { token: "secret-token" },
  user: { id: "u1", name: "Sam", email: "sam@example.test", role: "student,unknown" },
};

beforeEach(() => {
  getSession.mockReset();
});

describe("getSessionUser", () => {
  it("returns null without a session", async () => {
    getSession.mockResolvedValue(null);
    expect(await getSessionUser(new Headers())).toBeNull();
  });

  it("projects the session to id, name, email and known roles (no token)", async () => {
    getSession.mockResolvedValue(betterAuthSession);
    expect(await getSessionUser(new Headers())).toEqual({
      id: "u1",
      name: "Sam",
      email: "sam@example.test",
      roles: ["student"],
    } satisfies SessionUser);
  });
});

/** Runs the `.server()` callback of a function middleware with a capturing `next`. */
async function run(
  middleware: { options: { server?: unknown } },
  context: Record<string, unknown> = {},
): Promise<unknown> {
  const server = middleware.options.server as (opts: unknown) => Promise<unknown>;
  const next = vi.fn(async (opts?: { context?: object }) => ({ context: opts?.context }));
  return server({ next, context, data: undefined, method: "GET" });
}

describe("authMiddleware", () => {
  it("rejects anonymous calls with 401", async () => {
    getSession.mockResolvedValue(null);
    await expect(run(authMiddleware)).rejects.toMatchObject({ status: 401 });
  });

  it("passes the session user on as context", async () => {
    getSession.mockResolvedValue(betterAuthSession);
    await expect(run(authMiddleware)).resolves.toMatchObject({ context: { user: { id: "u1" } } });
  });
});

describe("requireRole", () => {
  const student = { id: "u1", name: "Sam", email: "sam@example.test", roles: ["student"] };

  it("rejects users without the role with 403", async () => {
    const error = await run(requireRole("docent", "beheerder"), { user: student }).catch((e) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status: 403, message: "Geen toegang" });
  });

  it("allows users with one of the roles", async () => {
    await expect(run(requireRole("docent", "student"), { user: student })).resolves.toBeDefined();
  });
});
