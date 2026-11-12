// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The administrator's reads of classes (#37): one page of every class with search and facets,
// the class detail and the teachers who can own a class. Not through membership, and with no
// grades, results or submissions (R-01). Lists have a stable order.
import "@tanstack/react-start/server-only";
import { type Expression, type ExpressionBuilder, type Kysely, type SqlBool, sql } from "kysely";
import { type ClassRole, isClassRole } from "../../lib/classes.ts";
import { UUID_PATTERN } from "../db/ids.ts";
import type { DB } from "../db/schema.gen.ts";
import { containsPattern, roleValuesWith } from "../users/queries.ts";
import {
  ADMIN_CLASS_STATUSES,
  type AdminClassStatus,
  DEFAULT_ADMIN_CLASS_PAGE_SIZE,
  type ListAdminClassesInput,
} from "./admin-schemas.ts";
import type { AdminClassRow } from "./queries.ts";

type ClassExpressions = ExpressionBuilder<DB, "organization">;

/** The facets of the class list: the filters that offer values with counts. */
export type AdminClassFacet = "status" | "year" | "owner";

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** The condition that the class name, or the name of one of its teachers, contains `search`. */
function searchCondition(eb: ClassExpressions, search: string): Expression<SqlBool> {
  const pattern = containsPattern(search);
  return eb.or([
    eb("organization.name", "ilike", pattern),
    eb.exists(
      eb
        .selectFrom("member as sm")
        .innerJoin("user as su", "su.id", "sm.userId")
        .select("sm.id")
        .whereRef("sm.organizationId", "=", "organization.id")
        .where("sm.role", "in", ["owner", "teacher"])
        .where("su.name", "ilike", pattern),
    ),
  ]);
}

function statusCondition(
  eb: ClassExpressions,
  statuses: readonly AdminClassStatus[],
): Expression<SqlBool> {
  return eb.or(
    statuses.map((status) =>
      eb("organization.archived_at", status === "archived" ? "is not" : "is", null),
    ),
  );
}

function ownerCondition(eb: ClassExpressions, owners: readonly string[]): Expression<SqlBool> {
  return eb.exists(
    eb
      .selectFrom("member as om")
      .select("om.id")
      .whereRef("om.organizationId", "=", "organization.id")
      .where("om.role", "=", "owner")
      .where("om.userId", "in", [...owners]),
  );
}

/** The conditions of the search and every facet, all but the facet `except`. */
function filterConditions(
  eb: ClassExpressions,
  input: ListAdminClassesInput,
  except?: AdminClassFacet,
): Expression<SqlBool>[] {
  const conditions: Expression<SqlBool>[] = [];
  const search = input.q?.trim();
  if (search) conditions.push(searchCondition(eb, search));
  if (input.status && except !== "status") conditions.push(statusCondition(eb, input.status));
  if (input.year && except !== "year") {
    conditions.push(eb("organization.academic_year", "in", input.year));
  }
  if (input.owner && except !== "owner") conditions.push(ownerCondition(eb, input.owner));
  return conditions;
}

/** A value of the academic-year or owner facet with the number of classes it would show. */
export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

/** The facet counts of the class list, each under the search and the other facets. */
export interface AdminClassFacets {
  status: Record<AdminClassStatus, number>;
  year: FacetValue[];
  owner: FacetValue[];
}

/** One page of the administrator's class list. */
export interface AdminClassPage {
  rows: AdminClassRow[];
  total: number;
  page: number;
  size: number;
  facets: AdminClassFacets;
}

async function classRows(
  db: Kysely<DB>,
  input: ListAdminClassesInput,
  now: Date,
  page: number,
  size: number,
) {
  return db
    .selectFrom("organization")
    .where((eb) => eb.and(filterConditions(eb, input)))
    .select((eb) => [
      "organization.id",
      "organization.name",
      "organization.academic_year",
      "organization.archived_at",
      eb
        .selectFrom("member as m")
        .select((s) => s.fn.countAll<string>().as("n"))
        .whereRef("m.organizationId", "=", "organization.id")
        .where("m.role", "=", "student")
        .as("students"),
      eb
        .selectFrom("invitation as i")
        .select((s) => s.fn.countAll<string>().as("n"))
        .whereRef("i.organizationId", "=", "organization.id")
        .where("i.status", "=", "pending")
        .where("i.expiresAt", ">", now)
        .as("pending"),
      sql<string>`count(*) over ()`.as("total"),
    ])
    .orderBy("organization.academic_year", "desc")
    .orderBy("organization.name")
    .orderBy("organization.id")
    .limit(size)
    .offset((page - 1) * size)
    .execute();
}

async function countClasses(db: Kysely<DB>, input: ListAdminClassesInput): Promise<number> {
  const row = await db
    .selectFrom("organization")
    .where((eb) => eb.and(filterConditions(eb, input)))
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/**
 * Returns the facet counts of the class list under `input`: every value of a facet (every
 * academic year, every owner), counted under the search and the other facets but not its own,
 * so a chosen value stays on offer even when nothing matches it.
 */
export async function adminClassFacets(
  db: Kysely<DB>,
  input: ListAdminClassesInput,
): Promise<AdminClassFacets> {
  const [statusRow, years, owners] = await Promise.all([
    db
      .selectFrom("organization")
      .select((eb) =>
        ADMIN_CLASS_STATUSES.map((status) =>
          eb.fn
            .countAll<string>()
            .filterWhere(
              eb.and([...filterConditions(eb, input, "status"), statusCondition(eb, [status])]),
            )
            .as(status),
        ),
      )
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("organization")
      .select((eb) => [
        "organization.academic_year",
        eb.fn
          .countAll<string>()
          .filterWhere(eb.and(filterConditions(eb, input, "year")))
          .as("n"),
      ])
      .groupBy("organization.academic_year")
      .orderBy("organization.academic_year", "desc")
      .execute(),
    db
      .selectFrom("organization")
      .innerJoin("member", "member.organizationId", "organization.id")
      .innerJoin("user", "user.id", "member.userId")
      .where("member.role", "=", "owner")
      .select((eb) => [
        "user.id",
        "user.name",
        eb.fn
          .countAll<string>()
          .filterWhere(eb.and(filterConditions(eb, input, "owner")))
          .as("n"),
      ])
      .groupBy(["user.id", "user.name"])
      .orderBy("user.name")
      .orderBy("user.id")
      .execute(),
  ]);
  return {
    status: {
      active: Number(Reflect.get(statusRow, "active") ?? 0),
      archived: Number(Reflect.get(statusRow, "archived") ?? 0),
    },
    year: years.map((row) => ({
      value: row.academic_year,
      label: row.academic_year,
      count: Number(row.n),
    })),
    owner: owners.map((row) => ({ value: row.id, label: row.name, count: Number(row.n) })),
  };
}

/**
 * Reads one page of every class for the administrator (#37): search on the class name and its
 * teachers' names, the archive, academic-year and owner facets (any of the chosen values), the
 * order academic year (newest first), name, id, and `limit`/`offset` pagination with the total.
 */
export async function listAdminClassPage(
  db: Kysely<DB>,
  input: ListAdminClassesInput,
  now: Date,
): Promise<AdminClassPage> {
  const size = input.size ?? DEFAULT_ADMIN_CLASS_PAGE_SIZE;
  const page = input.page ?? 1;
  const [rows, facets] = await Promise.all([
    classRows(db, input, now, page, size),
    adminClassFacets(db, input),
  ]);
  const first = rows.at(0);
  const total = first ? Number(first.total) : page > 1 ? await countClasses(db, input) : 0;
  const ids = rows.map((row) => row.id);
  const teachers = ids.length
    ? await db
        .selectFrom("member")
        .innerJoin("user", "user.id", "member.userId")
        .select(["member.organizationId", "member.role", "user.id", "user.name"])
        .where("member.organizationId", "in", ids)
        .where("member.role", "in", ["owner", "teacher"])
        .orderBy("user.name")
        .orderBy("user.id")
        .execute()
    : [];
  return {
    rows: rows.map((row) => {
      const own = teachers.filter((teacher) => teacher.organizationId === row.id);
      const owner = own.find((teacher) => teacher.role === "owner");
      return {
        id: row.id,
        name: row.name,
        academicYear: row.academic_year,
        archivedAt: iso(row.archived_at),
        owner: owner ? { id: owner.id, name: owner.name } : null,
        coTeachers: own
          .filter((teacher) => teacher.role === "teacher")
          .map((teacher) => ({ id: teacher.id, name: teacher.name })),
        students: Number(row.students ?? 0),
        pendingInvitations: Number(row.pending ?? 0),
      };
    }),
    total,
    page,
    size,
    facets,
  };
}

/** A member on the administrator's class page: a name and a class role, nothing more. */
export interface AdminClassMember {
  userId: string;
  name: string;
  role: ClassRole;
}

/** A pending invitation on the administrator's class page. */
export interface AdminClassInvitation {
  id: string;
  email: string;
  role: "teacher" | "student";
  expiresAt: string;
  expired: boolean;
}

/** The administrator's class page (#37): members and invitations, no grades or results (R-01). */
export interface AdminClassDetail {
  id: string;
  name: string;
  academicYear: string;
  archivedAt: string | null;
  owner: { id: string; name: string } | null;
  members: AdminClassMember[];
  invitations: AdminClassInvitation[];
  counts: { teachers: number; students: number; pendingInvitations: number; groups: number };
}

/** Returns any class for the administrator, or `null` when the id is no class. */
export async function getAdminClass(
  db: Kysely<DB>,
  classId: string,
  now: Date,
): Promise<AdminClassDetail | null> {
  if (!UUID_PATTERN.test(classId)) return null;
  const head = await db
    .selectFrom("organization")
    .select((eb) => [
      "id",
      "name",
      "academic_year",
      "archived_at",
      eb
        .selectFrom("team")
        .select((s) => s.fn.countAll<string>().as("n"))
        .whereRef("team.organizationId", "=", "organization.id")
        .as("groups"),
    ])
    .where("id", "=", classId)
    .executeTakeFirst();
  if (!head) return null;
  const [members, invitations] = await Promise.all([
    db
      .selectFrom("member")
      .innerJoin("user", "user.id", "member.userId")
      .select(["member.userId", "user.name", "member.role"])
      .where("member.organizationId", "=", head.id)
      .orderBy(sql`case member.role when 'owner' then 0 when 'teacher' then 1 else 2 end`)
      .orderBy("user.name")
      .orderBy("member.userId")
      .execute(),
    db
      .selectFrom("invitation")
      .select(["id", "email", "role", "expiresAt"])
      .where("organizationId", "=", head.id)
      .where("status", "=", "pending")
      .orderBy("email")
      .orderBy("id")
      .execute(),
  ]);
  const memberList = members.flatMap((member) =>
    isClassRole(member.role)
      ? [{ userId: member.userId, name: member.name, role: member.role }]
      : [],
  );
  const owner = memberList.find((member) => member.role === "owner");
  const invitationList = invitations.map(
    (invitation): AdminClassInvitation => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role === "teacher" ? "teacher" : "student",
      expiresAt: invitation.expiresAt.toISOString(),
      expired: invitation.expiresAt <= now,
    }),
  );
  return {
    id: head.id,
    name: head.name,
    academicYear: head.academic_year,
    archivedAt: iso(head.archived_at),
    owner: owner ? { id: owner.userId, name: owner.name } : null,
    members: memberList,
    invitations: invitationList,
    counts: {
      teachers: memberList.filter((member) => member.role !== "student").length,
      students: memberList.filter((member) => member.role === "student").length,
      pendingInvitations: invitationList.filter((invitation) => !invitation.expired).length,
      groups: Number(head.groups ?? 0),
    },
  };
}

/** A user who can own a class: the app role teacher (ADR 0012). */
export interface TeacherCandidate {
  id: string;
  name: string;
  email: string;
}

// NOTE: no requirement governs this: our own design. A bound on the owner list of one form.
export const TEACHER_CANDIDATES_MAX = 500;

/** Returns the users whose app role includes teacher, by name, for the owner fields (#37). */
export async function listTeacherCandidates(db: Kysely<DB>): Promise<TeacherCandidate[]> {
  return db
    .selectFrom("user")
    .select(["id", "name", "email"])
    .where("role", "in", roleValuesWith("teacher"))
    .orderBy("name")
    .orderBy("id")
    .limit(TEACHER_CANDIDATES_MAX)
    .execute();
}
