// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The demo classes of the public dev accounts, planned without I/O: Test Teacher and Test
// Coordinator teach them and Test Student is in one, so a sign-in shows filled Teacher and
// Student portals. The seed looks the users up by e-mail address and passes their ids in; the
// class, member, invitation and group ids are fixed per seed, so a second seed finds what the
// first wrote. Relative imports: the seed loads this in plain Node.
import {
  type DemoClass,
  type DemoClasses,
  demoAcademicYear,
  demoUuid,
  planClassActivity,
} from "./classes.ts";
import type { DemoPeople } from "./people.ts";
import type { DemoRandom } from "./random.ts";

const DAY = 86_400_000;

/** The dev accounts the classes go to, by their address in `DEV_USERS`. */
export const DEV_CLASS_ACCOUNTS = {
  student: "student@example.test",
  teacher: "teacher@example.test",
  coordinator: "teacher-admin@example.test",
} as const;

/** The pending invitations of LS-3A: addresses no other seed uses. */
export const DEV_CLASS_INVITATIONS = [
  "invited.student.one@example.test",
  "invited.student.two@example.test",
] as const;

/** The demo students of each class, in class order. */
export interface DevClassRoster<T> {
  /** LS-3A this year, beside Test Student. */
  current: readonly T[];
  /** LS-3B this year. */
  shared: readonly T[];
  /** LS-3A last year, archived. */
  archived: readonly T[];
}

/** The ids the seed looked up: the dev accounts and the demo students per class. */
export interface DevClassUsers {
  accounts: Record<keyof typeof DEV_CLASS_ACCOUNTS, string>;
  roster: DevClassRoster<string>;
}

/** The group sizes of the one group set of LS-3A; Test Student opens the first group. */
const GROUP_SIZES = [4, 4, 4] as const;
const ROSTER_SIZES = { current: 11, shared: 8, archived: 6 } as const;
/** The demo classes of `planDemoClasses` take the unblocked students 0 to 29. */
const FIRST_FREE_STUDENT = 30;

/**
 * Returns the addresses of the demo students the dev-account classes take: unblocked students
 * after the ones the demo classes use.
 *
 * @throws Error when the demo plan holds too few students.
 */
export function devClassRoster(people: DemoPeople): DevClassRoster<string> {
  const free = people.users
    .filter((user) => user.kind === "student" && !user.ban)
    .slice(FIRST_FREE_STUDENT)
    .map((user) => user.email);
  const current = free.slice(0, ROSTER_SIZES.current);
  const shared = free.slice(current.length, current.length + ROSTER_SIZES.shared);
  const archived = free.slice(
    current.length + shared.length,
    current.length + shared.length + ROSTER_SIZES.archived,
  );
  if (archived.length < ROSTER_SIZES.archived) {
    throw new Error("The demo plan holds too few students for the dev-account classes.");
  }
  return { current, shared, archived };
}

function members(
  random: DemoRandom,
  owner: string,
  coTeachers: readonly string[],
  students: readonly string[],
): DemoClass["members"] {
  return [
    { id: demoUuid(random), userId: owner, role: "owner" },
    ...coTeachers.map((userId) => ({ id: demoUuid(random), userId, role: "teacher" as const })),
    ...students.map((userId) => ({ id: demoUuid(random), userId, role: "student" as const })),
  ];
}

function groups(random: DemoRandom, students: readonly string[]): DemoClass["groups"] {
  let offset = 0;
  return GROUP_SIZES.map((size, index) => {
    const places = students
      .slice(offset, offset + size)
      .map((userId) => ({ id: demoUuid(random), userId }));
    offset += size;
    return { id: demoUuid(random), name: `Group ${index + 1}`, groupSet: "Practical 1", places };
  });
}

/**
 * Plans the dev-account classes for the reference time `now`: LS-3A and LS-3B this year, and
 * LS-3A of last year, archived. No join code: it is stored hashed and shown once.
 */
export function planDevAccountClasses(
  random: DemoRandom,
  now: Date,
  users: DevClassUsers,
): DemoClasses {
  const { student, teacher, coordinator } = users.accounts;
  const created = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
  const thisYear = demoAcademicYear(now);
  const current = [student, ...users.roster.current];
  const classes: DemoClass[] = [
    {
      id: demoUuid(random),
      name: "LS-3A",
      academicYear: thisYear,
      createdAt: created(42),
      archivedAt: null,
      members: members(random, teacher, [coordinator], current),
      invitations: DEV_CLASS_INVITATIONS.map((email, index) => ({
        id: demoUuid(random),
        email,
        inviterId: teacher,
        createdAt: created(3 + index),
        expiresAt: new Date(created(3 + index).getTime() + 30 * DAY),
      })),
      groups: groups(random, current),
    },
    {
      id: demoUuid(random),
      name: "LS-3B",
      academicYear: thisYear,
      createdAt: created(38),
      archivedAt: null,
      members: members(random, coordinator, [teacher], users.roster.shared),
      invitations: [],
      groups: [],
    },
    {
      id: demoUuid(random),
      name: "LS-3A",
      academicYear: demoAcademicYear(now, 1),
      createdAt: created(310),
      archivedAt: created(105),
      members: members(random, teacher, [], users.roster.archived),
      invitations: [],
      groups: [],
    },
  ];
  return { classes, activity: planClassActivity(classes) };
}
