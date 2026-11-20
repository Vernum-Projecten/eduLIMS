// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The readiness read and the simulation page through their real server functions (security
// reviews of #394 and #403, D11, ASVS V8.2.2, V16.3.2): the chains of functions.ts with their
// role middleware and validators in place, a session from a mocked better-auth, and the security
// log captured. An administrator or a student without the teacher role gets a 403 and one
// `authz_fail` line before the service reads anything; a teacher reaches the service as the
// session user, and a join code made under a rotated key reads `ended` on the page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const readiness = vi.fn();
const page = vi.fn();
vi.mock("@tanstack/react-start", async (original) =>
  (await import("../test-server-fn.ts")).withCompiledHandlers(
    await original<typeof import("@tanstack/react-start")>(),
  ),
);
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
vi.mock("./queries.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./queries.ts")>()),
  getTeacherSimulation: page,
}));
vi.mock("../db/index.ts", () => ({ getDb: () => ({ kind: "test-db" }) }));
vi.mock("./join-context.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./join-context.ts")>()),
  serverJoinCodeKey: () => ({ fingerprint: "fingerprint-of-the-current-key" }),
}));

const { getSimulationPage, getSimulationReadinessFn } = await import("./functions.ts");
const { setSecurityLogWriter } = await import("../security-log.ts");
const { callOnServer } = await import("../test-server-fn.ts");

const SIMULATION = "01960000-0000-7000-8000-000000000001";

let lines: string[] = [];
let restore: (() => void) | undefined;

beforeEach(() => {
  getSession.mockReset();
  readiness.mockReset();
  page.mockReset();
  lines = [];
  restore = setSecurityLogWriter((line) => lines.push(line));
});

afterEach(() => restore?.());

function sessionWith(id: string, role: string) {
  getSession.mockResolvedValue({
    session: { token: "test-token", createdAt: new Date() },
    user: { id, name: "Test Person", email: `${id}@example.test`, role },
  });
}

function logged(): unknown[] {
  return lines.map((line): unknown => JSON.parse(line));
}

const refusal = (actor: string) =>
  expect.objectContaining({
    event: "authz_fail",
    actor_id: actor,
    reason: "missing_role",
    status: 403,
    required_roles: "teacher",
  });

describe("getSimulationReadinessFn (D11, V16.3.2)", () => {
  it("refuses an administrator without the teacher role with 403 and logs authz_fail", async () => {
    sessionWith("u-admin", "admin");
    const answer = await callOnServer(
      getSimulationReadinessFn,
      { simulationId: SIMULATION },
      "GET",
    );
    expect(answer).toEqual({ error: expect.objectContaining({ status: 403 }) });
    expect(readiness).not.toHaveBeenCalled();
    expect(logged()).toEqual([refusal("u-admin")]);
  });

  it("refuses a student with 403 and logs authz_fail", async () => {
    sessionWith("u-student", "student");
    const answer = await callOnServer(
      getSimulationReadinessFn,
      { simulationId: SIMULATION },
      "GET",
    );
    expect(answer).toEqual({ error: expect.objectContaining({ status: 403 }) });
    expect(readiness).not.toHaveBeenCalled();
    expect(logged()).toEqual([refusal("u-student")]);
  });

  it("brings a teacher to the service as the session user, with the parsed input", async () => {
    sessionWith("u-teacher", "teacher");
    readiness.mockResolvedValue({ simulationId: SIMULATION });
    const answer = await callOnServer(
      getSimulationReadinessFn,
      { simulationId: SIMULATION },
      "GET",
    );
    expect(answer).toEqual({ result: { simulationId: SIMULATION } });
    expect(readiness).toHaveBeenCalledWith(
      { kind: "test-db" },
      expect.objectContaining({ id: "u-teacher", roles: ["teacher"] }),
      SIMULATION,
    );
    expect(logged()).toEqual([]);
  });
});

describe("getSimulationPage (D11, V16.3.2, N1)", () => {
  it("refuses an administrator without the teacher role with 403 and logs authz_fail", async () => {
    sessionWith("u-admin", "admin");
    const answer = await callOnServer(getSimulationPage, { simulationId: SIMULATION }, "GET");
    expect(answer).toEqual({ error: expect.objectContaining({ status: 403 }) });
    expect(page).not.toHaveBeenCalled();
    expect(logged()).toEqual([refusal("u-admin")]);
  });

  it("reads the page with the server's current join-code key, so a rotated code reads ended", async () => {
    sessionWith("u-teacher", "teacher");
    page.mockResolvedValue({ id: SIMULATION });
    await callOnServer(getSimulationPage, { simulationId: SIMULATION }, "GET");
    expect(page).toHaveBeenCalledWith(
      { kind: "test-db" },
      "u-teacher",
      SIMULATION,
      expect.any(Date),
      "fingerprint-of-the-current-key",
    );
  });
});
