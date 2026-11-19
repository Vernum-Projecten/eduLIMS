// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The demo simulations of `pnpm db:seed` (D10, S10), planned from the demo people without I/O:
// invented simulations, each with its teachers and labs of six students, and a few addresses that
// wait for a student to sign in. Ids are fixed per seed, so a second seed finds what the first
// wrote. Nothing here comes from a real simulation (Q-PRIV-4). Relative imports: plain Node.
import type { Kysely } from "kysely";
import type { AuditEvent } from "../../audit/events.ts";
import { recordAudit } from "../../audit/record.ts";
import type { DB } from "../schema.gen.ts";
import type { DemoPeople } from "./people.ts";
import type { DemoRandom } from "./random.ts";

const DAY = 86_400_000;

/** The usual size of a lab (owner, #280): six students. */
export const DEMO_LAB_SIZE = 6;

/** One demo lab: its students by user id and the addresses that wait for a sign-in. */
export interface DemoLab {
  id: string;
  name: string;
  members: string[];
  waiting: string[];
}

/** One demo simulation: its creator first among its teachers, then its labs. */
export interface DemoSimulation {
  id: string;
  name: string;
  createdAt: Date;
  teachers: string[];
  labs: DemoLab[];
}

/** The demo simulations and their activity-log events. */
export interface DemoSimulations {
  simulations: DemoSimulation[];
  activity: AuditEvent[];
}

/** Returns a UUIDv7-shaped id from the seeded source, the same on every run. */
export function demoUuid(random: DemoRandom): string {
  const hex = random.hex(32);
  const variant = "89ab".charAt(random.int(0, 3));
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The plan of one lab before it gets its id. */
export interface LabPlan {
  name: string;
  members: readonly string[];
  waiting?: readonly string[];
}

/** Returns a simulation with fresh ids for itself and its labs. */
export function demoSimulation(
  random: DemoRandom,
  plan: { name: string; createdAt: Date; teachers: readonly string[]; labs: readonly LabPlan[] },
): DemoSimulation {
  return {
    id: demoUuid(random),
    name: plan.name,
    createdAt: plan.createdAt,
    teachers: [...plan.teachers],
    labs: plan.labs.map((lab) => ({
      id: demoUuid(random),
      name: lab.name,
      members: [...lab.members],
      waiting: [...(lab.waiting ?? [])],
    })),
  };
}

/** Returns `list` cut into groups of {@link DEMO_LAB_SIZE}. */
export function inLabs<T>(list: readonly T[]): T[][] {
  const labs: T[][] = [];
  for (let start = 0; start < list.length; start += DEMO_LAB_SIZE) {
    labs.push(list.slice(start, start + DEMO_LAB_SIZE));
  }
  return labs;
}

/** How many unblocked demo students the demo simulations take; the dev accounts use the rest. */
export const DEMO_SIMULATION_STUDENTS = 35;

/** Plans the demo simulations for the demo people and the reference time `now`. */
export function planDemoSimulations(
  random: DemoRandom,
  now: Date,
  people: DemoPeople,
): DemoSimulations {
  const teachers = people.users.filter((user) => user.kind === "teacher").map((user) => user.id);
  const students = people.users
    .filter((user) => user.kind === "student" && !user.ban)
    .map((user) => user.id);
  const [first, second, shared] = teachers;
  if (!first || !second || !shared || students.length < DEMO_SIMULATION_STUDENTS) {
    return { simulations: [], activity: [] };
  }
  const created = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
  const spring = inLabs(students.slice(0, 23));
  const autumn = inLabs(students.slice(23, DEMO_SIMULATION_STUDENTS));
  const springNames = ["Pipette Pilots", "The Centrifugals", "Blue Cuvettes", "Night Shift Lab"];
  const autumnNames = ["Lab Kestrel", "Lab Osprey"];
  const simulations = [
    demoSimulation(random, {
      name: "Spring simulation",
      createdAt: created(30),
      teachers: [first, shared],
      labs: springNames.map((name, index) => ({
        name,
        members: spring[index] ?? [],
        // The last lab has five students in, and one address that waits for a sign-in.
        waiting: index === 3 ? ["new.student.one@example.test"] : [],
      })),
    }),
    demoSimulation(random, {
      name: "Autumn simulation",
      createdAt: created(12),
      teachers: [second],
      labs: autumnNames.map((name, index) => ({
        name,
        members: autumn[index] ?? [],
      })),
    }),
  ];
  return { simulations, activity: planSimulationActivity(simulations) };
}

/** The activity-log events of planned simulations: ids, codes and counts only. */
export function planSimulationActivity(simulations: readonly DemoSimulation[]): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (const simulation of simulations) {
    const [creator, ...others] = simulation.teachers;
    if (!creator) continue;
    const actor = { type: "user", id: creator } as const;
    const at = simulation.createdAt;
    const target = { type: "simulation", id: simulation.id } as const;
    events.push({
      action: "simulation_created",
      actor,
      outcome: "success",
      target,
      occurredAt: at,
    });
    for (const userId of others) {
      events.push({
        action: "simulation_teacher_added",
        actor,
        outcome: "success",
        target,
        occurredAt: at,
        metadata: { user_id: userId },
      });
    }
    for (const lab of simulation.labs) {
      const labTarget = { type: "lab", id: lab.id } as const;
      const metadata = { simulation_id: simulation.id };
      events.push(
        {
          action: "lab_created",
          actor,
          outcome: "success",
          target: labTarget,
          occurredAt: at,
          metadata,
        },
        {
          action: "lab_emails_added",
          actor,
          outcome: "success",
          target: labTarget,
          occurredAt: at,
          metadata: { ...metadata, count: lab.members.length + lab.waiting.length },
        },
      );
      for (const userId of lab.members) {
        events.push({
          action: "lab_member_joined",
          actor: { type: "user", id: userId },
          outcome: "success",
          target: labTarget,
          occurredAt: new Date(at.getTime() + DAY),
          metadata: { ...metadata, user_id: userId, join_via: "email" },
        });
      }
    }
  }
  return events;
}

/** Writes planned simulations with their teachers, labs, members, waiting addresses and events. */
export async function insertSimulations(trx: Kysely<DB>, plan: DemoSimulations): Promise<void> {
  for (const simulation of plan.simulations) {
    const at = simulation.createdAt;
    await trx
      .insertInto("simulations")
      .values({
        id: simulation.id,
        name: simulation.name,
        created_by: simulation.teachers[0] ?? null,
        created_at: at,
      })
      .execute();
    await trx
      .insertInto("simulation_teachers")
      .values(
        simulation.teachers.map((userId) => ({
          simulation_id: simulation.id,
          user_id: userId,
          added_by: simulation.teachers[0] ?? null,
          added_at: at,
        })),
      )
      .execute();
    for (const lab of simulation.labs) {
      await trx
        .insertInto("labs")
        .values({
          id: lab.id,
          simulation_id: simulation.id,
          name: lab.name,
          created_at: at,
          updated_at: at,
        })
        .execute();
      const keys = { simulation_id: simulation.id, lab_id: lab.id };
      if (lab.members.length > 0) {
        await trx
          .insertInto("lab_members")
          .values(
            lab.members.map((userId) => ({
              ...keys,
              user_id: userId,
              joined_at: new Date(at.getTime() + DAY),
              joined_via: "email",
            })),
          )
          .execute();
      }
      if (lab.waiting.length > 0) {
        await trx
          .insertInto("lab_member_emails")
          .values(
            lab.waiting.map((email) => ({
              ...keys,
              email,
              added_by: simulation.teachers[0] ?? null,
              added_at: at,
            })),
          )
          .execute();
      }
    }
  }
  for (const event of plan.activity) await recordAudit(trx, event, { stdout: false });
}
