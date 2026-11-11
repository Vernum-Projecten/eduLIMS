// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./authz.ts";

const getSession = vi.fn();
const deleteSession = vi.fn();
vi.mock("./auth.ts", () => ({
  getAuth: () => ({
    api: { getSession },
    $context: Promise.resolve({ internalAdapter: { deleteSession } }),
  }),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders: () => new Headers() }));

const { getSessionUser } = await import("./session.ts");
const { AuthError, authMiddleware, requireRole } = await import("./middleware.ts");

const betterAuthSession = {
  session: { token: "secret-token", createdAt: new Date() },
  user: { id: "u1", name: "Test Student", email: "student@example.test", role: "student,unknown" },
};

beforeEach(() => {
  getSession.mockReset();
  deleteSession.mockReset();
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
      name: "Test Student",
      email: "student@example.test",
      roles: ["student"],
      lastPortal: null,
    } satisfies SessionUser);
  });

  it("carries the saved portal and the teacher-admin role set (ADR 0012)", async () => {
    getSession.mockResolvedValue({
      ...betterAuthSession,
      user: { ...betterAuthSession.user, role: "admin,teacher", lastPortal: "admin" },
    });
    expect(await getSessionUser(new Headers())).toMatchObject({
      roles: ["teacher", "admin"],
      lastPortal: "admin",
    });
  });

  it.each(["student,teacher", "student,admin", "student,teacher,admin"])(
    "gives a stored conflicting role set %j no roles at all (fail closed)",
    async (role) => {
      getSession.mockResolvedValue({
        ...betterAuthSession,
        user: { ...betterAuthSession.user, role, lastPortal: "student" },
      });
      expect(await getSessionUser(new Headers())).toMatchObject({ roles: [] });
    },
  );

  it("ignores a saved portal value that names no role", async () => {
    getSession.mockResolvedValue({
      ...betterAuthSession,
      user: { ...betterAuthSession.user, lastPortal: "superuser" },
    });
    expect(await getSessionUser(new Headers())).toMatchObject({ lastPortal: null });
  });

  it("revokes and refuses a session signed in more than 24 hours ago (#42, ASVS V7.3.2)", async () => {
    const signedIn = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000);
    getSession.mockResolvedValue({
      ...betterAuthSession,
      session: { ...betterAuthSession.session, createdAt: signedIn },
    });
    expect(await getSessionUser(new Headers())).toBeNull();
    expect(deleteSession).toHaveBeenCalledWith("secret-token");
  });

  it("refuses a session whose sign-in time cannot be read (fail closed)", async () => {
    getSession.mockResolvedValue({
      ...betterAuthSession,
      session: { ...betterAuthSession.session, createdAt: "not a date" },
    });
    expect(await getSessionUser(new Headers())).toBeNull();
    expect(deleteSession).toHaveBeenCalledWith("secret-token");
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
  const student = {
    id: "u1",
    name: "Test Student",
    email: "student@example.test",
    roles: ["student"],
    lastPortal: null,
  };

  it("rejects users without the role with 403", async () => {
    const error = await run(requireRole("teacher", "admin"), { user: student }).catch((e) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status: 403, message: "Forbidden" });
  });

  it("allows users with one of the roles", async () => {
    await expect(run(requireRole("teacher", "student"), { user: student })).resolves.toBeDefined();
  });
});

describe("role sets on the server (ADR 0012, R-01)", () => {
  /** Resolves the session user for a stored `role` column, as authMiddleware does. */
  async function userWith(role: string): Promise<unknown> {
    getSession.mockResolvedValue({
      ...betterAuthSession,
      user: { ...betterAuthSession.user, role },
    });
    const result = (await run(authMiddleware)) as { context: { user: unknown } };
    return result.context.user;
  }

  async function status(role: string, required: "student" | "teacher" | "admin") {
    const user = await userWith(role);
    return run(requireRole(required), { user }).then(
      () => 200,
      (error: unknown) => (error instanceof AuthError ? error.status : 500),
    );
  }

  it("lets a teacher-admin call teacher and admin functions, and no student function", async () => {
    expect(await status("teacher,admin", "teacher")).toBe(200);
    expect(await status("teacher,admin", "admin")).toBe(200);
    expect(await status("teacher,admin", "student")).toBe(403);
  });

  it("gives a pure admin no teacher function, and a pure teacher no admin function", async () => {
    expect(await status("admin", "teacher")).toBe(403);
    expect(await status("teacher", "admin")).toBe(403);
    expect(await status("admin", "student")).toBe(403);
    expect(await status("teacher", "student")).toBe(403);
  });

  it.each(["student,teacher", "student,admin", "student,teacher,admin"])(
    "refuses every function to a stored conflicting set %j",
    async (role) => {
      for (const required of ["student", "teacher", "admin"] as const) {
        expect(await status(role, required)).toBe(403);
      }
    },
  );
});
