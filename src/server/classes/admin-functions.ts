// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of the administrator's class screens (#37); bodies run on the server. Every
// one requires the app role admin first, then parses its input with Zod; the class service
// checks the role again and never makes the administrator a member (R-01).
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
import {
  adminArchiveClass,
  adminCreateClass,
  adminImportStudents,
  adminPreviewImport,
  adminTransferOwnership,
  adminUnarchiveClass,
} from "./admin.ts";
import { getAdminClass, listAdminClassPage, searchTeacherCandidates } from "./admin-queries.ts";
import {
  adminClassFormSchema,
  adminImportInput,
  adminTransferInput,
  listAdminClassesInput,
  teacherSearchInput,
} from "./admin-schemas.ts";
import { classIdInput } from "./schemas.ts";

const admin = requireRole("admin");

/** Returns one page of every class with the facet counts (#37): no grades or results (R-01). */
export const listAdminClassesFn = createServerFn({ method: "GET" })
  .middleware([admin])
  .validator(listAdminClassesInput)
  .handler(({ data }) => listAdminClassPage(getDb(), data, new Date()));

/** Returns the administrator's page of any class; throws `notFound` for no class. */
export const getAdminClassFn = createServerFn({ method: "GET" })
  .middleware([admin])
  .validator(classIdInput)
  .handler(async ({ data }) => {
    const page = await getAdminClass(getDb(), data.classId, new Date());
    if (!page) throw notFound();
    return page;
  });

/** Returns the users who can own a class: the app role teacher, not blocked, by a search. */
export const searchTeacherCandidatesFn = createServerFn({ method: "GET" })
  .middleware([admin])
  .validator(teacherSearchInput)
  .handler(({ data }) => searchTeacherCandidates(getDb(), data, new Date()));

/** Creates a class on a teacher's behalf. */
export const adminCreateClassFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(adminClassFormSchema)
  .handler(({ data, context }) => adminCreateClass(getDb(), context.user, data, new Date()));

/** Transfers the ownership of any class to a teacher. */
export const adminTransferOwnershipFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(adminTransferInput)
  .handler(({ data, context }) => adminTransferOwnership(getDb(), context.user, data, new Date()));

/** Archives any class. */
export const adminArchiveClassFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(classIdInput)
  .handler(({ data, context }) => adminArchiveClass(getDb(), context.user, data, new Date()));

/** Reopens any archived class. */
export const adminUnarchiveClassFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(classIdInput)
  .handler(({ data, context }) => adminUnarchiveClass(getDb(), context.user, data));

/** Classifies a student list for any class without creating anything. */
export const adminPreviewImportFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(adminImportInput)
  .handler(({ data, context }) => adminPreviewImport(getDb(), context.user, data, new Date()));

/** Creates the student invitations of a list's new rows. */
export const adminImportStudentsFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(adminImportInput)
  .handler(({ data, context }) => adminImportStudents(getDb(), context.user, data, new Date()));
