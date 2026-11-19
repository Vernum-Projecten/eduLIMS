// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DEV_USERS } from "../../demo-accounts.ts";
import {
  DEV_SIMULATION_ACCOUNTS,
  DEV_WAITING_ADDRESSES,
  type DevSimulationUsers,
  devRoster,
  planDevAccountSimulations,
} from "./dev-simulations.ts";
import { demoRandom } from "./random.ts";
import { planDemoData } from "./seed-demo.ts";
import { DEMO_LAB_SIZE, DEMO_SIMULATION_STUDENTS } from "./simulations.ts";

const NOW = new Date("2026-11-11T12:00:00Z");

const users: DevSimulationUsers = {
  accounts: { student: "u-student", teacher: "u-teacher", coordinator: "u-coordinator" },
  roster: {
    aurora: ["a1", "a2", "a3", "a4", "a5"],
    borealis: ["b1", "b2", "b3", "b4", "b5", "b6"],
    zenith: ["z1", "z2", "z3", "z4", "z5", "z6"],
  },
};

const plan = () => planDevAccountSimulations(demoRandom(1), NOW, users);

describe("planDevAccountSimulations", () => {
  it("goes to dev accounts that DEV_USERS creates", () => {
    const emails = DEV_USERS.map((user) => user.email);
    for (const email of Object.values(DEV_SIMULATION_ACCOUNTS)) expect(emails).toContain(email);
  });

  it("gives every lab six students, Test Student in Lab Aurora (S10)", () => {
    const labs = plan().simulations.flatMap((simulation) => simulation.labs);
    expect(labs.map((lab) => [lab.name, lab.members.length])).toEqual([
      ["Lab Aurora", DEMO_LAB_SIZE],
      ["Lab Borealis", DEMO_LAB_SIZE],
      ["Lab Zenith", DEMO_LAB_SIZE],
    ]);
    expect(labs[0]?.members[0]).toBe("u-student");
  });

  it("lets the teacher create the demo simulation and the coordinator teach it too (D10)", () => {
    const [demo, coordinator] = plan().simulations;
    expect(demo?.teachers).toEqual(["u-teacher", "u-coordinator"]);
    expect(coordinator?.teachers).toEqual(["u-coordinator", "u-teacher"]);
  });

  it("lets two addresses no other seed uses wait in Lab Borealis", () => {
    const borealis = plan().simulations[0]?.labs[1];
    expect(borealis?.waiting).toEqual([...DEV_WAITING_ADDRESSES]);
    const demo = planDemoData(NOW);
    const known = new Set(demo.people.users.map((user) => user.email));
    for (const email of DEV_WAITING_ADDRESSES) {
      expect(email).toMatch(/@example\.test$/);
      expect(known.has(email)).toBe(false);
    }
  });

  it("keeps every id the same whatever the user ids are, so a second seed finds the first", () => {
    const other = planDevAccountSimulations(demoRandom(1), NOW, {
      ...users,
      accounts: { student: "x", teacher: "y", coordinator: "z" },
    });
    const ids = (p: ReturnType<typeof plan>) =>
      p.simulations.flatMap((s) => [s.id, ...s.labs.map((lab) => lab.id)]);
    expect(ids(other)).toEqual(ids(plan()));
  });

  it("logs ids, codes and counts only, never an address (B4)", () => {
    const text = JSON.stringify(plan().activity);
    expect(text).not.toContain("@");
    expect(plan().activity.filter((event) => event.action === "lab_member_joined")).toHaveLength(
      18,
    );
  });
});

describe("devRoster", () => {
  it("takes unblocked demo students the demo simulations do not use", () => {
    const people = planDemoData(NOW).people;
    const roster = devRoster(people);
    const free = people.users
      .filter((user) => user.kind === "student" && !user.ban)
      .slice(DEMO_SIMULATION_STUDENTS)
      .map((user) => user.email);
    const all = [...roster.aurora, ...roster.borealis, ...roster.zenith];
    expect(all).toHaveLength(17);
    expect(new Set(all).size).toBe(17);
    for (const email of all) expect(free).toContain(email);
  });

  it("refuses a demo plan with too few students", () => {
    const people = planDemoData(NOW).people;
    const few = { ...people, users: people.users.filter((user) => user.kind !== "student") };
    expect(() => devRoster(few)).toThrow(/too few students/);
  });
});
