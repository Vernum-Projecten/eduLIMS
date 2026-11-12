// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DEV_USERS } from "../../demo-accounts.ts";
import {
  DEV_CLASS_ACCOUNTS,
  DEV_CLASS_INVITATIONS,
  type DevClassUsers,
  devClassRoster,
  planDevAccountClasses,
} from "./dev-classes.ts";
import { demoRandom } from "./random.ts";
import { planDemoData } from "./seed-demo.ts";

const NOW = new Date("2026-11-11T12:00:00Z");

function usersFor(prefix: string): DevClassUsers {
  const ids = (name: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${prefix}${name}${i}`);
  return {
    accounts: {
      student: `${prefix}student`,
      teacher: `${prefix}teacher`,
      coordinator: `${prefix}coordinator`,
    },
    roster: { current: ids("c", 11), shared: ids("s", 8), archived: ids("a", 6) },
  };
}

function plan(prefix = "u-") {
  return planDevAccountClasses(demoRandom(1), NOW, usersFor(prefix));
}

function byRole(item: ReturnType<typeof plan>["classes"][number], role: string) {
  return item.members.filter((member) => member.role === role).map((member) => member.userId);
}

describe("the dev-account classes (B2, D1 demo data)", () => {
  it("goes to dev accounts that DEV_USERS creates", () => {
    const emails: readonly string[] = DEV_USERS.map((user) => user.email);
    for (const email of Object.values(DEV_CLASS_ACCOUNTS)) expect(emails).toContain(email);
  });

  it("plans LS-3A and LS-3B this year and LS-3A of last year, archived", () => {
    expect(
      plan().classes.map((item) => [item.name, item.academicYear, item.archivedAt !== null]),
    ).toEqual([
      ["LS-3A", "2026-2027", false],
      ["LS-3B", "2026-2027", false],
      ["LS-3A", "2025-2026", true],
    ]);
  });

  it("gives LS-3A the teacher as owner, the coordinator as co-teacher and 12 students", () => {
    const [current] = plan().classes;
    if (!current) throw new Error("no class");
    expect(byRole(current, "owner")).toEqual(["u-teacher"]);
    expect(byRole(current, "teacher")).toEqual(["u-coordinator"]);
    expect(byRole(current, "student")).toHaveLength(12);
    expect(byRole(current, "student")[0]).toBe("u-student");
  });

  it("splits LS-3A into three lab groups of four with Test Student in group 1", () => {
    const [current] = plan().classes;
    expect(
      current?.groups.map((group) => [group.groupSet, group.name, group.places.length]),
    ).toEqual([
      ["Practical 1", "Group 1", 4],
      ["Practical 1", "Group 2", 4],
      ["Practical 1", "Group 3", 4],
    ]);
    expect(current?.groups[0]?.places.map((place) => place.userId)).toContain("u-student");
    const placed = current?.groups.flatMap((group) => group.places.map((place) => place.userId));
    expect(new Set(placed)).toEqual(new Set(current ? byRole(current, "student") : []));
  });

  it("invites two addresses to LS-3A that no other seed uses", () => {
    const [current] = plan().classes;
    expect(current?.invitations.map((invitation) => invitation.email)).toEqual([
      ...DEV_CLASS_INVITATIONS,
    ]);
    const demo = planDemoData(NOW);
    const used = new Set([
      ...DEV_USERS.map((user) => user.email),
      ...demo.people.users.map((user) => user.email),
      ...demo.classes.classes.flatMap((item) =>
        item.invitations.map((invitation) => invitation.email),
      ),
    ]);
    for (const email of DEV_CLASS_INVITATIONS) {
      expect(email).toMatch(/@example\.test$/);
      expect(used.has(email)).toBe(false);
    }
    for (const invitation of current?.invitations ?? []) {
      expect(invitation.inviterId).toBe("u-teacher");
      expect(invitation.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it("gives LS-3B the coordinator as owner, the teacher as co-teacher and 8 students", () => {
    const shared = plan().classes[1];
    if (!shared) throw new Error("no class");
    expect(byRole(shared, "owner")).toEqual(["u-coordinator"]);
    expect(byRole(shared, "teacher")).toEqual(["u-teacher"]);
    expect(byRole(shared, "student")).toHaveLength(8);
    expect(shared.groups).toEqual([]);
    expect(shared.invitations).toEqual([]);
  });

  it("gives last year's LS-3A the teacher as owner and 6 students", () => {
    const archived = plan().classes[2];
    if (!archived) throw new Error("no class");
    expect(byRole(archived, "owner")).toEqual(["u-teacher"]);
    expect(byRole(archived, "teacher")).toEqual([]);
    expect(byRole(archived, "student")).toHaveLength(6);
  });

  it("keeps every id the same whatever the user ids are, so a second seed finds the first", () => {
    const ids = (classes: ReturnType<typeof plan>["classes"]) =>
      classes.flatMap((item) => [
        item.id,
        ...item.members.map((member) => member.id),
        ...item.invitations.map((invitation) => invitation.id),
        ...item.groups.flatMap((group) => [group.id, ...group.places.map((place) => place.id)]),
      ]);
    const first = ids(plan("a-").classes);
    expect(ids(plan("b-").classes)).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it("logs the creation, the invitations and the archive with ids only (B4)", () => {
    const { activity } = plan();
    expect(activity.map((event) => event.action)).toEqual([
      "class_created",
      "invitation_created",
      "invitation_created",
      "class_created",
      "class_created",
      "class_archived",
    ]);
    expect(JSON.stringify(activity)).not.toContain("@");
  });
});

describe("devClassRoster", () => {
  it("takes 25 unblocked demo students the demo classes do not use", () => {
    const demo = planDemoData(NOW);
    const roster = devClassRoster(demo.people);
    const all = [...roster.current, ...roster.shared, ...roster.archived];
    expect([roster.current.length, roster.shared.length, roster.archived.length]).toEqual([
      11, 8, 6,
    ]);
    expect(new Set(all).size).toBe(25);
    const emailOf = new Map(demo.people.users.map((user) => [user.id, user.email]));
    const taken = new Set(
      demo.classes.classes.flatMap((item) =>
        item.members.map((member) => emailOf.get(member.userId)),
      ),
    );
    const blocked = new Set(demo.people.users.filter((user) => user.ban).map((user) => user.email));
    for (const email of all) {
      expect(taken.has(email)).toBe(false);
      expect(blocked.has(email)).toBe(false);
    }
  });

  it("refuses a demo plan with too few students", () => {
    const { people } = planDemoData(NOW);
    expect(() => devClassRoster({ ...people, users: people.users.slice(0, 40) })).toThrow(
      "too few students",
    );
  });
});
