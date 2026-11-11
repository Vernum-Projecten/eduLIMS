// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The demo classes of `pnpm db:seed` (#28), planned from the demo people without I/O: two
// teachers' classes this year, the same class name archived from last year, a class a demo
// co-teacher shares, students as members, two pending invitations and one group set of three lab
// groups. Ids are fixed per seed, so a second seed finds what the first wrote.
import type { AuditEvent } from "../../audit/events.ts";
import type { DemoPeople, DemoUser } from "./people.ts";
import type { DemoRandom } from "./random.ts";

const DAY = 86_400_000;

/** A demo class, its members and what hangs off it. */
export interface DemoClass {
  id: string;
  name: string;
  academicYear: string;
  createdAt: Date;
  archivedAt: Date | null;
  members: { id: string; userId: string; role: "owner" | "teacher" | "student" }[];
  invitations: { id: string; email: string; inviterId: string; createdAt: Date; expiresAt: Date }[];
  groups: {
    id: string;
    name: string;
    groupSet: string;
    places: { id: string; userId: string }[];
  }[];
}

/** The demo classes and their activity-log events. */
export interface DemoClasses {
  classes: DemoClass[];
  activity: AuditEvent[];
}

/** Returns a UUIDv7-shaped id from the seeded source, the same on every run. */
export function demoUuid(random: DemoRandom): string {
  const hex = random.hex(32);
  const variant = "89ab".charAt(random.int(0, 3));
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Returns the academic year `now` falls in, for the demo only.
 *
 * NOTE: no requirement governs this: demo data only; a demo year starts on 1 August.
 */
export function demoAcademicYear(now: Date, yearsBack = 0): string {
  const start = now.getUTCFullYear() - (now.getUTCMonth() < 7 ? 1 : 0) - yearsBack;
  return `${start}-${start + 1}`;
}

function members(
  random: DemoRandom,
  owner: DemoUser,
  coTeachers: readonly DemoUser[],
  students: readonly DemoUser[],
): DemoClass["members"] {
  return [
    { id: demoUuid(random), userId: owner.id, role: "owner" },
    ...coTeachers.map((user) => ({
      id: demoUuid(random),
      userId: user.id,
      role: "teacher" as const,
    })),
    ...students.map((user) => ({
      id: demoUuid(random),
      userId: user.id,
      role: "student" as const,
    })),
  ];
}

/** Plans the demo classes for the demo people and the reference time `now`. */
export function planDemoClasses(random: DemoRandom, now: Date, people: DemoPeople): DemoClasses {
  const teachers = people.users.filter((user) => user.kind === "teacher");
  const students = people.users.filter((user) => user.kind === "student" && !user.ban);
  const [first, second, shared] = teachers;
  if (!first || !second || !shared || students.length < 30) return { classes: [], activity: [] };
  const thisYear = demoAcademicYear(now);
  const created = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);

  const current = students.slice(0, 12);
  const groupSizes = [4, 4, 4];
  let offset = 0;
  const groups = groupSizes.map((size, index) => {
    const places = current
      .slice(offset, offset + size)
      .map((user) => ({ id: demoUuid(random), userId: user.id }));
    offset += size;
    return { id: demoUuid(random), name: `Group ${index + 1}`, groupSet: "Practical 1", places };
  });
  const classes: DemoClass[] = [
    {
      id: demoUuid(random),
      name: "LS-2A",
      academicYear: thisYear,
      createdAt: created(45),
      archivedAt: null,
      members: members(random, first, [shared], current),
      invitations: ["new.student.one", "new.student.two"].map((local, index) => ({
        id: demoUuid(random),
        email: `${local}@example.test`,
        inviterId: first.id,
        createdAt: created(5 + index),
        expiresAt: new Date(created(5 + index).getTime() + 30 * DAY),
      })),
      groups,
    },
    {
      id: demoUuid(random),
      name: "LS-2A",
      academicYear: demoAcademicYear(now, 1),
      createdAt: created(300),
      archivedAt: created(110),
      members: members(random, first, [], students.slice(12, 20)),
      invitations: [],
      groups: [],
    },
    {
      id: demoUuid(random),
      name: "LS-2B",
      academicYear: thisYear,
      createdAt: created(40),
      archivedAt: null,
      members: members(random, second, [], students.slice(20, 30)),
      invitations: [],
      groups: [],
    },
  ];
  return { classes, activity: planClassActivity(classes) };
}

/** The activity-log events of the demo classes: ids and codes only. */
function planClassActivity(classes: readonly DemoClass[]): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (const item of classes) {
    const owner = item.members.find((member) => member.role === "owner");
    if (!owner) continue;
    const actor = { type: "user", id: owner.userId } as const;
    const target = { type: "class", id: item.id } as const;
    events.push({
      action: "class_created",
      actor,
      outcome: "success",
      target,
      occurredAt: item.createdAt,
    });
    for (const invitation of item.invitations) {
      events.push({
        action: "invitation_created",
        actor,
        outcome: "success",
        target: { type: "invitation", id: invitation.id },
        occurredAt: invitation.createdAt,
        metadata: { class_id: item.id, class_role: "student" },
      });
    }
    if (item.archivedAt) {
      events.push({
        action: "class_archived",
        actor,
        outcome: "success",
        target,
        occurredAt: item.archivedAt,
      });
    }
  }
  return events;
}
