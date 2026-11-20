// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The Query layer of simulations and labs: every write invalidates the keys its caller names,
// and nothing else; a lab's keys nest under its simulation; a refusal reaches the caller as a
// SimulationActionRefused with its code.
import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionKeys } from "../../lib/session.query-options.ts";
import {
  invalidatedKeys,
  runMutation,
  seedCache,
  testQueryClient,
} from "../../lib/test-query-client.ts";
import type { SimulationResult } from "./access.ts";
import {
  deleteMutationOptions,
  labLogoUploadMutationOptions,
  linkMyLabsMutationOptions,
  refusedTestIds,
  SimulationActionRefused,
  simulationErrorCode,
  simulationInvalidation,
  simulationMutationOptions,
  simulationsKeys,
} from "./query-options.ts";

vi.mock("./functions.ts", () => ({
  getAdminSimulationFn: vi.fn(),
  getJoinCodeFn: vi.fn(),
  getLabPage: vi.fn(),
  getMyLab: vi.fn(),
  getSimulationPage: vi.fn(),
  listAdminSimulationsFn: vi.fn(),
  listMySimulations: vi.fn(),
}));
vi.mock("../../lib/session.functions.ts", () => ({ getSession: vi.fn() }));

const ONE = "01960000-0000-7000-8000-000000000001";
const TWO = "01960000-0000-7000-8000-000000000002";
const LAB = "01960000-0000-7000-8000-0000000000a1";
const LAB_TWO = "01960000-0000-7000-8000-0000000000b1";

function seeded(): QueryClient {
  const queryClient = testQueryClient();
  seedCache(queryClient, [
    [simulationsKeys.lists(), []],
    [simulationsKeys.detail(ONE), { id: ONE }],
    [simulationsKeys.detail(TWO), { id: TWO }],
    [simulationsKeys.lab(ONE, LAB), { id: LAB }],
    [simulationsKeys.lab(TWO, LAB_TWO), { id: LAB_TWO }],
    [simulationsKeys.student(), []],
    [simulationsKeys.adminList(), []],
    [simulationsKeys.adminDetail(ONE), { id: ONE }],
    [sessionKeys.current(), { id: "teacher" }],
  ]);
  return queryClient;
}

const keys = (...list: readonly (readonly unknown[])[]) =>
  list.map((key) => JSON.stringify(key)).sort();

const ok = <T>(value: T) => vi.fn(async (): Promise<SimulationResult<T>> => ({ ok: true, value }));

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = seeded();
});

describe("simulationsKeys", () => {
  it("nests a lab under its simulation, narrowest last", () => {
    expect(simulationsKeys.detail(ONE)).toEqual(["simulations", "detail", ONE]);
    expect(simulationsKeys.lab(ONE, LAB)).toEqual(["simulations", "detail", ONE, "lab", LAB]);
    expect(simulationsKeys.adminDetail(ONE)).toEqual(["simulations", "admin", "detail", ONE]);
    expect(simulationsKeys.student()).toEqual(["simulations", "student"]);
    expect(simulationsKeys.joinCode(ONE, LAB)).toEqual([
      ...simulationsKeys.lab(ONE, LAB),
      "join-code",
    ]);
  });
});

describe("labLogoUploadMutationOptions (#293)", () => {
  it("invalidates the simulation with its labs once a logo is stored, and nothing else", async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      value: { mediaType: "image/png" as const, width: 4, height: 4, byteSize: 70 },
    }));
    const { data } = await runMutation(
      queryClient,
      labLogoUploadMutationOptions(queryClient, call, simulationInvalidation.logo(ONE)),
      new FormData(),
    );
    expect(data?.ok).toBe(true);
    expect(invalidatedKeys(queryClient)).toEqual(
      keys(simulationsKeys.detail(ONE), simulationsKeys.lab(ONE, LAB)),
    );
  });

  it("returns a refused file to the form and invalidates nothing", async () => {
    const call = vi.fn(async () => ({ ok: false as const, error: "logo_too_large" as const }));
    const { data } = await runMutation(
      queryClient,
      labLogoUploadMutationOptions(queryClient, call, simulationInvalidation.logo(ONE)),
      new FormData(),
    );
    expect(data).toEqual({ ok: false, error: "logo_too_large" });
    expect(invalidatedKeys(queryClient)).toEqual([]);
  });
});

describe("simulationMutationOptions (explicit invalidation keys)", () => {
  it("invalidates the lists and the admin view after creating a simulation", async () => {
    await runMutation(
      queryClient,
      simulationMutationOptions(
        queryClient,
        ok({ simulationId: TWO }),
        simulationInvalidation.created(),
      ),
      { name: "New" },
    );
    expect(invalidatedKeys(queryClient)).toEqual(
      keys(simulationsKeys.lists(), simulationsKeys.adminList(), simulationsKeys.adminDetail(ONE)),
    );
  });

  it("invalidates one simulation with its labs, the lists and the admin view", async () => {
    await runMutation(
      queryClient,
      simulationMutationOptions(queryClient, ok(null), simulationInvalidation.simulation(ONE)),
      { simulationId: ONE, name: "Renamed" },
    );
    expect(invalidatedKeys(queryClient)).toEqual(
      keys(
        simulationsKeys.detail(ONE),
        simulationsKeys.lab(ONE, LAB),
        simulationsKeys.lists(),
        simulationsKeys.adminList(),
        simulationsKeys.adminDetail(ONE),
      ),
    );
  });

  it("invalidates only the simulation's page and its labs after a change of waiting addresses", async () => {
    await runMutation(
      queryClient,
      simulationMutationOptions(
        queryClient,
        ok({ added: 1, lines: [] }),
        simulationInvalidation.waiting(ONE),
      ),
      { labId: LAB, emails: ["a@example.test"] },
    );
    expect(invalidatedKeys(queryClient)).toEqual(
      keys(simulationsKeys.detail(ONE), simulationsKeys.lab(ONE, LAB)),
    );
  });

  it("invalidates only the lab's join-code state after a code write (#288)", async () => {
    seedCache(queryClient, [
      [simulationsKeys.joinCode(ONE, LAB), { enabled: false, finished: false }],
    ]);
    await runMutation(
      queryClient,
      simulationMutationOptions(
        queryClient,
        ok({ code: "ABCDE-FGH23", expiresAt: "2026-11-26T09:00:00.000Z", maxUses: 30 }),
        simulationInvalidation.joinCode(ONE, LAB),
      ),
      { labId: LAB, validDays: 7, maxUses: 30 },
    );
    expect(invalidatedKeys(queryClient)).toEqual(keys(simulationsKeys.joinCode(ONE, LAB)));
  });

  it("invalidates the student's labs only after a join with a code (S10)", async () => {
    await runMutation(
      queryClient,
      simulationMutationOptions(
        queryClient,
        ok({ status: "joined" }),
        simulationInvalidation.student(),
      ),
      { code: "ABCDE-FGH23" },
    );
    expect(invalidatedKeys(queryClient)).toEqual(keys(simulationsKeys.student()));
  });

  it("invalidates nothing for a read-only preview", async () => {
    await runMutation(queryClient, simulationMutationOptions(queryClient, ok([]), []), {
      labId: LAB,
      emails: [],
    });
    expect(invalidatedKeys(queryClient)).toEqual([]);
  });

  it("throws a refusal with its code, and still invalidates its keys", async () => {
    const call = vi.fn(
      async (): Promise<SimulationResult> => ({ ok: false, error: "last_teacher" }),
    );
    const { error } = await runMutation(
      queryClient,
      simulationMutationOptions(queryClient, call, simulationInvalidation.simulation(ONE)),
      { simulationId: ONE, userId: "u" },
    );
    expect(error).toBeInstanceOf(SimulationActionRefused);
    expect(simulationErrorCode(error)).toBe("last_teacher");
    expect(invalidatedKeys(queryClient)).toContain(JSON.stringify(simulationsKeys.detail(ONE)));
  });

  it("carries the tests a missing_limits refusal names to the caller (#267)", async () => {
    const call = vi.fn(
      async (): Promise<SimulationResult> => ({
        ok: false,
        error: "missing_limits",
        testIds: [ONE, TWO],
      }),
    );
    const { error } = await runMutation(
      queryClient,
      simulationMutationOptions(queryClient, call, []),
      { simulationId: ONE },
    );
    expect(simulationErrorCode(error)).toBe("missing_limits");
    expect(refusedTestIds(error)).toEqual([ONE, TWO]);
  });

  it("maps a server error to no refusal code and no tests", () => {
    expect(simulationErrorCode(new Error("500"))).toBeNull();
    expect(refusedTestIds(new Error("500"))).toEqual([]);
  });
});

describe("deleteMutationOptions", () => {
  it("leaves the page, drops its entry and invalidates the named keys", async () => {
    const leave = vi.fn(async () => undefined);
    await runMutation(
      queryClient,
      deleteMutationOptions(
        queryClient,
        ok(null),
        simulationsKeys.lab(ONE, LAB),
        simulationInvalidation.simulation(ONE),
        leave,
      ),
      { labId: LAB },
    );
    expect(leave).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(simulationsKeys.lab(ONE, LAB))).toBeUndefined();
    expect(invalidatedKeys(queryClient)).toEqual(
      keys(
        simulationsKeys.detail(ONE),
        simulationsKeys.lists(),
        simulationsKeys.adminList(),
        simulationsKeys.adminDetail(ONE),
      ),
    );
  });

  it("stays on the page when the server refuses", async () => {
    const leave = vi.fn(async () => undefined);
    const call = vi.fn(
      async (): Promise<SimulationResult> => ({ ok: false, error: "has_students" }),
    );
    const { error } = await runMutation(
      queryClient,
      deleteMutationOptions(
        queryClient,
        call,
        simulationsKeys.detail(ONE),
        simulationInvalidation.created(),
        leave,
      ),
      { simulationId: ONE },
    );
    expect(simulationErrorCode(error)).toBe("has_students");
    expect(leave).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(simulationsKeys.detail(ONE))).toEqual({ id: ONE });
  });
});

describe("linkMyLabsMutationOptions (S10)", () => {
  it("invalidates the student's labs only", async () => {
    await runMutation(
      queryClient,
      linkMyLabsMutationOptions(queryClient, async () => ({ linked: 1, refused: 0, failed: 0 })),
      undefined,
    );
    expect(invalidatedKeys(queryClient)).toEqual(keys(simulationsKeys.student()));
  });
});
