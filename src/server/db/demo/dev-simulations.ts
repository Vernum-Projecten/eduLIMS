// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The demo simulations of the public dev accounts, planned without I/O: Test Teacher and Test
// Coordinator teach them, and Test Student is in a lab of six, so a sign-in shows filled Teacher
// and Student portals once their screens exist (#289, #290). The seed looks the users up by
// e-mail address and passes their ids in. Relative imports: the seed loads this in plain Node.
import type { DemoPeople } from "./people.ts";
import type { DemoRandom } from "./random.ts";
import {
  DEMO_LAB_SIZE,
  DEMO_SIMULATION_STUDENTS,
  type DemoSimulations,
  demoSimulation,
  planSimulationActivity,
} from "./simulations.ts";

const DAY = 86_400_000;

/** The dev accounts the simulations go to, by their address in `DEV_USERS`. */
export const DEV_SIMULATION_ACCOUNTS = {
  student: "student@example.test",
  teacher: "teacher@example.test",
  coordinator: "teacher-admin@example.test",
} as const;

/** The addresses that wait in a dev-account lab: addresses no other seed uses. */
export const DEV_WAITING_ADDRESSES = [
  "waiting.student.one@example.test",
  "waiting.student.two@example.test",
] as const;

/** The demo students of each dev-account lab, by address. */
export interface DevRoster<T> {
  /** Lab Aurora, beside Test Student. */
  aurora: readonly T[];
  /** Lab Borealis. */
  borealis: readonly T[];
  /** The coordinator's lab. */
  zenith: readonly T[];
}

/** The ids the seed looked up: the dev accounts and the demo students per lab. */
export interface DevSimulationUsers {
  accounts: Record<keyof typeof DEV_SIMULATION_ACCOUNTS, string>;
  roster: DevRoster<string>;
}

/**
 * Returns the addresses of the demo students the dev-account labs take: unblocked students after
 * the ones the demo simulations use.
 *
 * @throws Error when the demo plan holds too few students.
 */
export function devRoster(people: DemoPeople): DevRoster<string> {
  const free = people.users
    .filter((user) => user.kind === "student" && !user.ban)
    .slice(DEMO_SIMULATION_STUDENTS)
    .map((user) => user.email);
  const aurora = free.slice(0, DEMO_LAB_SIZE - 1);
  const borealis = free.slice(aurora.length, aurora.length + DEMO_LAB_SIZE);
  const zenith = free.slice(
    aurora.length + borealis.length,
    aurora.length + borealis.length + DEMO_LAB_SIZE,
  );
  if (zenith.length < DEMO_LAB_SIZE) {
    throw new Error("The demo plan holds too few students for the dev-account labs.");
  }
  return { aurora, borealis, zenith };
}

/**
 * Plans the dev-account simulations for the reference time `now`: Test Teacher's simulation with
 * Test Coordinator as a second teacher, Lab Aurora (Test Student and five others) and Lab Borealis
 * (six students and two waiting addresses), and the coordinator's simulation with one lab.
 */
export function planDevAccountSimulations(
  random: DemoRandom,
  now: Date,
  users: DevSimulationUsers,
): DemoSimulations {
  const { student, teacher, coordinator } = users.accounts;
  const created = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
  const simulations = [
    demoSimulation(random, {
      name: "Demo simulation",
      createdAt: created(21),
      teachers: [teacher, coordinator],
      labs: [
        { name: "Lab Aurora", members: [student, ...users.roster.aurora] },
        { name: "Lab Borealis", members: users.roster.borealis, waiting: DEV_WAITING_ADDRESSES },
      ],
    }),
    demoSimulation(random, {
      name: "Coordinator's simulation",
      createdAt: created(9),
      teachers: [coordinator, teacher],
      labs: [{ name: "Lab Zenith", members: users.roster.zenith }],
    }),
  ];
  return { simulations, activity: planSimulationActivity(simulations) };
}
