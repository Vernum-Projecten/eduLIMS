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
import {
  CLASS_ORGANIZATION_PATHS,
  INVITATION_LIFETIME_SECONDS,
  OWNS_CLASS_ERROR,
} from "./plugin.ts";
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

describe("the organization plugin set-up (#28, ADR 0018)", () => {
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

  it("answers 404 on every organization path, GET and POST, even to a signed-in teacher", async () => {
    const { auth } = await setup();
    await createUser(auth, "teacher@example.test", ["teacher"]);
    const headers = await signIn(auth, "teacher@example.test");
    for (const path of CLASS_ORGANIZATION_PATHS) {
      const url = `http://localhost:3000/api/auth${path.replace(/:[a-zA-Z]+/g, "x")}`;
      for (const method of ["GET", "POST"] as const) {
        const response = await auth.handler(
          new Request(method === "GET" ? `${url}?organizationId=x` : url, {
            method,
            headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
            ...(method === "POST"
              ? { body: JSON.stringify({ name: "LS-2A", slug: "ls-2a" }) }
              : {}),
          }),
        );
        expect([method, path, response.status]).toEqual([method, path, 404]);
      }
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

  it("refuses to delete a user who owns a class, and logs it (security review of #28)", async () => {
    const { auth, db: database } = await setup();
    await createUser(auth, "admin@example.test", ["admin"]);
    const ownerId = await createUser(auth, "owner@example.test", ["teacher"]);
    const otherId = await createUser(auth, "other@example.test", ["teacher"]);
    const created = await createClass(
      database,
      { id: ownerId, roles: ["teacher"] },
      { name: "LS-2A", academicYear: "2026-2027" },
      NOW,
    );
    if (!created.ok) throw new Error(created.error);
    const headers = await signIn(auth, "admin@example.test");
    await expect(auth.api.removeUser({ body: { userId: ownerId }, headers })).rejects.toThrow(
      OWNS_CLASS_ERROR,
    );
    const still = await database
      .selectFrom("user")
      .select("id")
      .where("id", "=", ownerId)
      .execute();
    expect(still).toHaveLength(1);
    const refused = await database
      .selectFrom("audit_event")
      .select(["outcome", "reason_code", "target_id"])
      .where("action", "=", "user_deleted")
      .execute();
    expect(refused).toEqual([
      { outcome: "refused", reason_code: "owns_class", target_id: ownerId },
    ]);
    await auth.api.removeUser({ body: { userId: otherId }, headers });
    const gone = await database.selectFrom("user").select("id").where("id", "=", otherId).execute();
    expect(gone).toEqual([]);
  });
});
