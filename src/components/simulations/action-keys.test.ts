// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { QueryKey } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { simulationsKeys } from "@/server/simulations/query-options";
import { simulationActionKeys } from "./action-keys";

vi.mock("@/server/simulations/functions", () => ({
  getAdminSimulationFn: vi.fn(),
  getLabPage: vi.fn(),
  getMyLabs: vi.fn(),
  getSimulationPage: vi.fn(),
  listAdminSimulationsFn: vi.fn(),
  listMySimulations: vi.fn(),
}));

const SIM = "01960000-0000-7000-8000-000000000001";
const LAB = "01960000-0000-7000-8000-000000000002";

const simulationWide: QueryKey[] = [
  simulationsKeys.detail(SIM),
  simulationsKeys.lists(),
  simulationsKeys.admin(),
];

/** Whether `key` starts with `prefix`, which is how a query key invalidates its children. */
function nestsUnder(key: QueryKey, prefix: QueryKey): boolean {
  return prefix.every((part, index) => key[index] === part);
}

describe("simulationActionKeys (every action names its invalidation keys)", () => {
  it("creating a simulation invalidates the teacher's list and the admin view only", () => {
    expect(simulationActionKeys.createSimulation()).toEqual([
      simulationsKeys.lists(),
      simulationsKeys.admin(),
    ]);
  });

  it.each([
    "renameSimulation",
    "addTeacher",
    "removeTeacher",
    "createLab",
    "renameLab",
    "moveMember",
    "removeMember",
  ] as const)(
    "%s invalidates the simulation with its labs, the list and the admin view",
    (action) => {
      expect(simulationActionKeys[action](SIM)).toEqual(simulationWide);
    },
  );

  it.each(["addEmails", "removeEmail"] as const)(
    "%s invalidates only the simulation's page and its labs: no count on a list changes",
    (action) => {
      expect(simulationActionKeys[action](SIM)).toEqual([simulationsKeys.detail(SIM)]);
    },
  );

  it("the preview of a pasted list invalidates nothing: it stores nothing", () => {
    expect(simulationActionKeys.previewEmails()).toEqual([]);
  });

  it("deleting a lab drops the lab's entry and invalidates its simulation", () => {
    expect(simulationActionKeys.deleteLab(SIM, LAB)).toEqual({
      removed: simulationsKeys.lab(SIM, LAB),
      invalidates: simulationWide,
    });
  });

  it.each(["deleteSimulation", "leaveSimulation"] as const)(
    "%s drops the simulation's entry with its labs and invalidates the lists",
    (action) => {
      expect(simulationActionKeys[action](SIM)).toEqual({
        removed: simulationsKeys.detail(SIM),
        invalidates: [simulationsKeys.lists(), simulationsKeys.admin()],
      });
    },
  );

  it.each(["enableJoinCode", "regenerateJoinCode", "disableJoinCode"] as const)(
    "%s invalidates only the lab's code state: no page or list shows the code (#288)",
    (action) => {
      expect(simulationActionKeys[action](SIM, LAB)).toEqual([simulationsKeys.joinCode(SIM, LAB)]);
    },
  );

  it("a student's join invalidates only the student's own labs (S10)", () => {
    expect(simulationActionKeys.joinLab()).toEqual([simulationsKeys.student()]);
  });

  it("a lab's page nests under its simulation, so a simulation-wide write reaches it", () => {
    const [detail] = simulationActionKeys.moveMember(SIM);
    expect(detail).toBeDefined();
    expect(nestsUnder(simulationsKeys.lab(SIM, LAB), detail ?? [])).toBe(true);
    expect(nestsUnder(simulationsKeys.lab(SIM, LAB), simulationsKeys.detail("other"))).toBe(false);
  });
});
