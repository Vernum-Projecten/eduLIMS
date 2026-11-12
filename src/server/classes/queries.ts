// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of classes (#28, D3, R-01). Every teacher and student read filters by the session
// user's membership in SQL; the administrator's list does not go through membership and returns
// no grades or results. Lists have a stable order (academic year, name, id).
import "@tanstack/react-start/server-only";
import { type ExpressionBuilder, type Kysely, sql } from "kysely";
import { type ClassRole, isClassRole } from "../../lib/classes.ts";
import { UUID_PATTERN } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { logClassNotFound } from "./access.ts";

/** A class as every list shows it: the name with its academic year, and the archive state. */
export interface ClassSummary {
  id: string;
  name: string;
  academicYear: string;
  archivedAt: string | null;
}

/** A row of the Teacher portal's class list. */
export interface TeacherClassRow extends ClassSummary {
  myRole: ClassRole;
  students: number;
  teachers: number;
  pendingInvitations: number;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function count(value: string | number | bigint | null): number {
  return Number(value ?? 0);
}

function memberCount(eb: ExpressionBuilder<DB, "organization">, roles: readonly string[]) {
  return eb
    .selectFrom("member as m")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .whereRef("m.organizationId", "=", "organization.id")
    .where("m.role", "in", roles);
}

function pendingCount(eb: ExpressionBuilder<DB, "organization">, now: Date) {
  return eb
    .selectFrom("invitation as i")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .whereRef("i.organizationId", "=", "organization.id")
    .where("i.status", "=", "pending")
    .where("i.expiresAt", ">", now);
}

/**
 * Returns the classes the user owns or co-teaches (D3), active or archived. The membership is
 * the filter: another teacher's class never appears.
 */
export async function listTeacherClasses(
  db: Kysely<DB>,
  userId: string,
  filter: { archived: boolean },
  now: Date,
): Promise<TeacherClassRow[]> {
  const rows = await db
    .selectFrom("organization")
    .innerJoin("member", "member.organizationId", "organization.id")
    .select((eb) => [
      "organization.id",
      "organization.name",
      "organization.academic_year",
      "organization.archived_at",
      "member.role",
      memberCount(eb, ["student"]).as("students"),
      memberCount(eb, ["owner", "teacher"]).as("teachers"),
      pendingCount(eb, now).as("pending"),
    ])
    .where("member.userId", "=", userId)
    .where("member.role", "in", ["owner", "teacher"])
    .where("organization.archived_at", filter.archived ? "is not" : "is", null)
    .orderBy("organization.academic_year", "desc")
    .orderBy("organization.name")
    .orderBy("organization.id")
    .execute();
  return rows.flatMap((row) =>
    isClassRole(row.role)
      ? [
          {
            id: row.id,
            name: row.name,
            academicYear: row.academic_year,
            archivedAt: iso(row.archived_at),
            myRole: row.role,
            students: count(row.students),
            teachers: count(row.teachers),
            pendingInvitations: count(row.pending),
          },
        ]
      : [],
  );
}

/** A member on the class page. */
export interface ClassMemberView {
  userId: string;
  name: string;
  email: string;
  role: ClassRole;
}

/** A pending invitation on the class page; `expired` once its term has passed. */
export interface InvitationView {
  id: string;
  email: string;
  role: "teacher" | "student";
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

/** A lab group on the class page, with the user ids of its students. */
export interface GroupView {
  id: string;
  name: string;
  groupSet: string;
  memberIds: string[];
}

/** The class page of the Teacher portal (members, invitations, lab groups). */
export interface TeacherClassDetail extends ClassSummary {
  myRole: ClassRole;
  members: ClassMemberView[];
  invitations: InvitationView[];
  groups: GroupView[];
  groupSets: string[];
}

/**
 * Returns the class page for a teacher of the class, or `null` when the id is no class or the
 * user does not teach it (D3). Pending invitations include expired ones, which can be resent.
 */
export async function getTeacherClass(
  db: Kysely<DB>,
  userId: string,
  classId: string,
  now: Date,
): Promise<TeacherClassDetail | null> {
  if (!UUID_PATTERN.test(classId)) {
    logClassNotFound(userId, classId);
    return null;
  }
  const head = await db
    .selectFrom("organization")
    .innerJoin("member", "member.organizationId", "organization.id")
    .select([
      "organization.id",
      "organization.name",
      "organization.academic_year",
      "organization.archived_at",
      "member.role",
    ])
    .where("organization.id", "=", classId)
    .where("member.userId", "=", userId)
    .where("member.role", "in", ["owner", "teacher"])
    .executeTakeFirst();
  if (!head || !isClassRole(head.role)) {
    logClassNotFound(userId, classId);
    return null;
  }
  const [members, invitations, groups] = await Promise.all([
    db
      .selectFrom("member")
      .innerJoin("user", "user.id", "member.userId")
      .select(["member.userId", "user.name", "user.email", "member.role"])
      .where("member.organizationId", "=", head.id)
      .orderBy(sql`case member.role when 'owner' then 0 when 'teacher' then 1 else 2 end`)
      .orderBy("user.name")
      .orderBy("member.userId")
      .execute(),
    db
      .selectFrom("invitation")
      .select(["id", "email", "role", "createdAt", "expiresAt"])
      .where("organizationId", "=", head.id)
      .where("status", "=", "pending")
      .orderBy("email")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("team")
      .leftJoin("teamMember", "teamMember.teamId", "team.id")
      .select(["team.id", "team.name", "team.group_set", "teamMember.userId"])
      .where("team.organizationId", "=", head.id)
      .orderBy("team.group_set")
      .orderBy("team.name")
      .orderBy("team.id")
      .execute(),
  ]);
  const byGroup = new Map<string, GroupView>();
  for (const row of groups) {
    const group = byGroup.get(row.id) ?? {
      id: row.id,
      name: row.name,
      groupSet: row.group_set,
      memberIds: [],
    };
    if (row.userId) group.memberIds.push(row.userId);
    byGroup.set(row.id, group);
  }
  const groupList = [...byGroup.values()];
  return {
    id: head.id,
    name: head.name,
    academicYear: head.academic_year,
    archivedAt: iso(head.archived_at),
    myRole: head.role,
    members: members.flatMap((member) =>
      isClassRole(member.role) ? [{ ...member, role: member.role }] : [],
    ),
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role === "teacher" ? "teacher" : "student",
      createdAt: iso(invitation.createdAt) ?? "",
      expiresAt: iso(invitation.expiresAt) ?? "",
      expired: invitation.expiresAt <= now,
    })),
    groups: groupList,
    groupSets: [...new Set(groupList.map((group) => group.groupSet))],
  };
}

/** Another class of the teacher with its group sets, for "copy a group set". */
export interface GroupSetSource extends ClassSummary {
  groupSets: string[];
}

/** Returns the teacher's other classes that have group sets (D3: a membership query). */
export async function listGroupSetSources(
  db: Kysely<DB>,
  userId: string,
  exceptClassId: string,
): Promise<GroupSetSource[]> {
  const rows = await db
    .selectFrom("organization")
    .innerJoin("member", "member.organizationId", "organization.id")
    .innerJoin("team", "team.organizationId", "organization.id")
    .select([
      "organization.id",
      "organization.name",
      "organization.academic_year",
      "organization.archived_at",
      "team.group_set",
    ])
    .distinct()
    .where("member.userId", "=", userId)
    .where("member.role", "in", ["owner", "teacher"])
    .where("organization.id", "<>", exceptClassId)
    .orderBy("organization.academic_year", "desc")
    .orderBy("organization.name")
    .orderBy("organization.id")
    .orderBy("team.group_set")
    .execute();
  const byClass = new Map<string, GroupSetSource>();
  for (const row of rows) {
    const source = byClass.get(row.id) ?? {
      id: row.id,
      name: row.name,
      academicYear: row.academic_year,
      archivedAt: iso(row.archived_at),
      groupSets: [],
    };
    source.groupSets.push(row.group_set);
    byClass.set(row.id, source);
  }
  return [...byClass.values()];
}

/** A row of the Admin portal's class list: no grades, no results (R-01). */
export interface AdminClassRow extends ClassSummary {
  owner: { id: string; name: string } | null;
  coTeachers: { id: string; name: string }[];
  students: number;
  pendingInvitations: number;
}

/** Returns the classes a student belongs to (S2: a membership query on the session user). */
export async function listStudentClasses(db: Kysely<DB>, userId: string): Promise<ClassSummary[]> {
  const rows = await db
    .selectFrom("organization")
    .innerJoin("member", "member.organizationId", "organization.id")
    .select([
      "organization.id",
      "organization.name",
      "organization.academic_year",
      "organization.archived_at",
    ])
    .where("member.userId", "=", userId)
    .where("member.role", "=", "student")
    .orderBy("organization.academic_year", "desc")
    .orderBy("organization.name")
    .orderBy("organization.id")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    academicYear: row.academic_year,
    archivedAt: iso(row.archived_at),
  }));
}

/** A pending invitation on the student's overview. */
export interface StudentInvitation {
  id: string;
  className: string;
  academicYear: string;
  expiresAt: string;
}

/**
 * Returns the pending, unexpired invitations for the student's own verified address in classes
 * that are not archived; they are accepted at the next sign-in.
 */
export async function listStudentInvitations(
  db: Kysely<DB>,
  userId: string,
  now: Date,
): Promise<StudentInvitation[]> {
  const rows = await db
    .selectFrom("invitation")
    .innerJoin("organization", "organization.id", "invitation.organizationId")
    // The address must be the user's own and verified, as acceptance requires (#28).
    .innerJoin("user", (join) =>
      join.on((eb) => eb(eb.fn("lower", ["user.email"]), "=", eb.ref("invitation.email"))),
    )
    .where("user.id", "=", userId)
    .where("user.emailVerified", "=", true)
    .select([
      "invitation.id",
      "organization.name",
      "organization.academic_year",
      "invitation.expiresAt",
    ])
    .where("invitation.status", "=", "pending")
    .where("invitation.role", "=", "student")
    .where("invitation.expiresAt", ">", now)
    .where("organization.archived_at", "is", null)
    .orderBy("organization.academic_year", "desc")
    .orderBy("organization.name")
    .orderBy("invitation.id")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    className: row.name,
    academicYear: row.academic_year,
    expiresAt: iso(row.expiresAt) ?? "",
  }));
}
