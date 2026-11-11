// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { Auth } from "../auth.ts";
import { UUID_PATTERN } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { authOnTestDb, createUser, signIn } from "../users/test-helpers.ts";
import { createClass } from "./classes.ts";
import { createInvitations } from "./invitations.ts";
import { CLASS_ORGANIZATION_PATHS, INVITATION_LIFETIME_SECONDS } from "./plugin.ts";
import { NOW } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function setup(): Promise<{ auth: Auth; db: Kysely<DB> }> {
  const opened = await authOnTestDb();
  db = opened.db;
  return opened;
}

describe("the organization plugin set-up (#28, ADR 0017)", () => {
  it("keeps invitations valid for 30 days (#28 (4))", () => {
    expect(INVITATION_LIFETIME_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("knows the plugin's create, invite and accept paths", () => {
    expect(CLASS_ORGANIZATION_PATHS).toEqual(
      expect.arrayContaining([
        "/organization/create",
        "/organization/invite-member",
        "/organization/accept-invitation",
        "/organization/create-team",
        "/organization/list",
      ]),
    );
  });

  it("answers 404 on every organization path, even to a signed-in teacher", async () => {
    const { auth } = await setup();
    await createUser(auth, "teacher@example.test", ["teacher"]);
    const headers = await signIn(auth, "teacher@example.test");
    for (const path of CLASS_ORGANIZATION_PATHS) {
      const url = `http://localhost:3000/api/auth${path.replace(/:[a-zA-Z]+/g, "x")}`;
      const response = await auth.handler(
        new Request(url, {
          method: "POST",
          headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
          body: JSON.stringify({ name: "LS-2A", slug: "ls-2a" }),
        }),
      );
      expect([path, response.status]).toEqual([path, 404]);
    }
    const organizations = await db?.selectFrom("organization").select("id").execute();
    expect(organizations).toEqual([]);
  });

  it("refuses the plugin's server-side writes too: only the class service writes", async () => {
    const { auth, db: database } = await setup();
    const teacherId = await createUser(auth, "teacher@example.test", ["teacher"]);
    const teacher = { id: teacherId, roles: ["teacher"] as const };
    const created = await createClass(
      database,
      teacher,
      { name: "LS-2A", academicYear: "2026-2027" },
      NOW,
    );
    if (!created.ok) throw new Error(created.error);
    const studentId = await createUser(auth, "student@example.test", ["student"]);
    await expect(
      auth.api.addMember({
        body: { userId: studentId, organizationId: created.value.classId, role: "student" },
      }),
    ).rejects.toThrow();
    await expect(
      auth.api.createOrganization({
        body: {
          name: "Side door",
          slug: "side-door",
          academicYear: "2026-2027",
          userId: teacherId,
        },
      }),
    ).rejects.toThrow();
    const members = await database.selectFrom("member").select("userId").execute();
    expect(members).toEqual([{ userId: teacherId }]);
  });

  it("gives every better-auth row a UUIDv7 id", async () => {
    const { auth } = await setup();
    const id = await createUser(auth, "teacher@example.test", ["teacher"]);
    expect(id).toMatch(UUID_PATTERN);
    expect(id.charAt(14)).toBe("7");
  });

  it("adds a person to the inviting class when they sign in (#28: no accept step)", async () => {
    const { auth, db: database } = await setup();
    const teacherId = await createUser(auth, "teacher@example.test", ["teacher"]);
    const studentId = await createUser(auth, "student@example.test", ["student"]);
    await database
      .updateTable("user")
      .set({ emailVerified: true })
      .where("id", "=", studentId)
      .execute();
    const teacher = { id: teacherId, roles: ["teacher"] as const };
    const created = await createClass(
      database,
      teacher,
      { name: "LS-2A", academicYear: "2026-2027" },
      NOW,
    );
    if (!created.ok) throw new Error(created.error);
    const { classId } = created.value;
    await createInvitations(
      database,
      teacher,
      { classId, role: "student", emails: ["student@example.test"] },
      new Date(),
    );
    await signIn(auth, "student@example.test");
    const member = await database
      .selectFrom("member")
      .select("role")
      .where("organizationId", "=", classId)
      .where("userId", "=", studentId)
      .executeTakeFirst();
    expect(member).toEqual({ role: "student" });
  });
});
