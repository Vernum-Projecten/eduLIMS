// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The readiness read through its real server function (security review of #394, D11, ASVS
// V8.2.2, V16.3.2): the chain of functions.ts with its role middleware in place, a session from
// a mocked better-auth, and the security log captured. An administrator without the teacher role
// gets a 403 and one `authz_fail` line before the service reads anything.
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const readiness = vi.fn();
vi.mock("../auth.ts", () => ({
  getAuth: () => ({
    api: { getSession },
    $context: Promise.resolve({ internalAdapter: { deleteSession: vi.fn() } }),
  }),
}));
vi.mock("@tanstack/react-start/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start/server")>()),
  getRequestHeaders: () => new Headers(),
}));
vi.mock("./readiness.ts", () => ({ getSimulationReadiness: readiness }));
vi.mock("../db/index.ts", () => ({ getDb: () => ({}) }));

const { getSimulationReadinessFn } = await import("./functions.ts");
const { setSecurityLogWriter } = await import("../security-log.ts");

const SIMULATION = "01960000-0000-7000-8000-000000000001";

let lines: string[] = [];
let restore: (() => void) | undefined;

beforeEach(() => {
  getSession.mockReset();
  readiness.mockReset();
  lines = [];
  restore = setSecurityLogWriter((line) => lines.push(line));
});

afterEach(() => restore?.());

/** The AsyncLocalStorage Start keeps its request context in (`@tanstack/start-storage-context`). */
function startStorage(): AsyncLocalStorage<object> {
  const storage: unknown = Reflect.get(
    globalThis,
    Symbol.for("tanstack-start:start-storage-context"),
  );
  if (!(storage instanceof AsyncLocalStorage)) throw new Error("no Start storage context");
  return storage;
}

/**
 * Runs the server function's own chain the way Start runs a call on the server: in its request
 * context, through the function's `__executeServer`, which applies the middleware of
 * functions.ts before the handler. Resolves with what Start sends back: `{ error }` or `{ result }`.
 */
async function call(simulationId: string): Promise<unknown> {
  const execute: unknown = Reflect.get(getSimulationReadinessFn, "__executeServer");
  if (typeof execute !== "function") throw new Error("no server side of the function");
  const context = {
    request: new Request("http://edulims.test/_serverFn/x"),
    startOptions: { functionMiddleware: [] },
    contextAfterGlobalMiddlewares: {},
    handlerType: "serverFn",
  };
  return startStorage().run(context, () => execute({ data: { simulationId }, method: "GET" }));
}

function sessionWith(role: string) {
  getSession.mockResolvedValue({
    session: { token: "test-token", createdAt: new Date() },
    user: { id: "u-admin", name: "Test Admin", email: "admin@example.test", role },
  });
}

describe("getSimulationReadinessFn (D11, V16.3.2)", () => {
  it("refuses an administrator without the teacher role with 403 and logs authz_fail", async () => {
    sessionWith("admin");
    expect(await call(SIMULATION)).toEqual({ error: expect.objectContaining({ status: 403 }) });
    expect(readiness).not.toHaveBeenCalled();
    expect(lines.map((line): unknown => JSON.parse(line))).toEqual([
      expect.objectContaining({
        event: "authz_fail",
        actor_id: "u-admin",
        reason: "missing_role",
        status: 403,
        required_roles: "teacher",
      }),
    ]);
  });

  it("refuses a student the same way", async () => {
    sessionWith("student");
    expect(await call(SIMULATION)).toEqual({ error: expect.objectContaining({ status: 403 }) });
    expect(readiness).not.toHaveBeenCalled();
  });
});
