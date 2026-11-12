// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of classes, invitations and lab groups (#28); bodies run on the server. Every
// one requires its app role first, then parses its input with Zod; the class service checks the
// class role on the session user in SQL (D3, R-01).
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
import {
  archiveClass,
  createClass,
  deleteClass,
  removeMember,
  transferOwnership,
  unarchiveClass,
  updateClass,
} from "./classes.ts";
import { copyClass } from "./copy.ts";
import {
  autoSplit,
  copyGroupSet,
  createGroups,
  deleteGroup,
  moveStudent,
  renameGroup,
} from "./groups.ts";
import {
  cancelInvitation,
  createInvitations,
  previewInvitations,
  resendInvitation,
} from "./invitations.ts";
import {
  getTeacherClass,
  listAdminClasses,
  listGroupSetSources,
  listStudentClasses,
  listStudentInvitations,
  listTeacherClasses,
} from "./queries.ts";
import {
  autoSplitInput,
  classFormSchema,
  classIdInput,
  copyClassInput,
  copyGroupSetInput,
  createGroupsInput,
  groupInput,
  invitationInput,
  inviteInput,
  memberInput,
  moveStudentInput,
  renameGroupInput,
  updateClassInput,
} from "./schemas.ts";

const teacher = requireRole("teacher");

/** Returns the classes the teacher owns or co-teaches, active or archived (D3). */
export const listMyClasses = createServerFn({ method: "GET" })
  .middleware([teacher])
  .validator(z.object({ archived: z.boolean() }))
  .handler(({ data, context }) => listTeacherClasses(getDb(), context.user.id, data, new Date()));

/** Returns the class page; throws `notFound` unless the teacher teaches the class (D3). */
export const getClassPage = createServerFn({ method: "GET" })
  .middleware([teacher])
  .validator(classIdInput)
  .handler(async ({ data, context }) => {
    const page = await getTeacherClass(getDb(), context.user.id, data.classId, new Date());
    if (!page) throw notFound();
    return page;
  });

/** Returns the teacher's other classes with their group sets, for "copy a group set". */
export const listGroupSetSourcesFn = createServerFn({ method: "GET" })
  .middleware([teacher])
  .validator(classIdInput)
  .handler(({ data, context }) => listGroupSetSources(getDb(), context.user.id, data.classId));

/** Creates a class owned by the teacher. */
export const createClassFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(classFormSchema)
  .handler(({ data, context }) => createClass(getDb(), context.user, data, new Date()));

/** Renames a class or changes its academic year. */
export const updateClassFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(updateClassInput)
  .handler(({ data, context }) => updateClass(getDb(), context.user, data));

/** Archives a class. */
export const archiveClassFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(classIdInput)
  .handler(({ data, context }) => archiveClass(getDb(), context.user, data, new Date()));

/** Reopens an archived class. */
export const unarchiveClassFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(classIdInput)
  .handler(({ data, context }) => unarchiveClass(getDb(), context.user, data));

/** Deletes a class that holds no work. */
export const deleteClassFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(classIdInput)
  .handler(({ data, context }) => deleteClass(getDb(), context.user, data));

/** Copies a class to a new academic year. */
export const copyClassFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(copyClassInput)
  .handler(({ data, context }) => copyClass(getDb(), context.user, data, new Date()));

/** Transfers the ownership to a co-teacher. */
export const transferOwnershipFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(memberInput)
  .handler(({ data, context }) => transferOwnership(getDb(), context.user, data));

/** Removes a member from a class. */
export const removeMemberFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(memberInput)
  .handler(({ data, context }) => removeMember(getDb(), context.user, data));

/** Classifies a list of addresses without creating anything. */
export const previewInvitationsFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(inviteInput)
  .handler(({ data, context }) => previewInvitations(getDb(), context.user, data, new Date()));

/** Creates the invitations of a list's new rows. */
export const createInvitationsFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(inviteInput)
  .handler(({ data, context }) => createInvitations(getDb(), context.user, data, new Date()));

/** Gives a pending invitation a new term. */
export const resendInvitationFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(invitationInput)
  .handler(({ data, context }) => resendInvitation(getDb(), context.user, data, new Date()));

/** Cancels a pending invitation. */
export const cancelInvitationFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(invitationInput)
  .handler(({ data, context }) => cancelInvitation(getDb(), context.user, data, new Date()));

/** Creates groups in a group set. */
export const createGroupsFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(createGroupsInput)
  .handler(({ data, context }) => createGroups(getDb(), context.user, data, new Date()));

/** Renames a group. */
export const renameGroupFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(renameGroupInput)
  .handler(({ data, context }) => renameGroup(getDb(), context.user, data, new Date()));

/** Deletes a group. */
export const deleteGroupFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(groupInput)
  .handler(({ data, context }) => deleteGroup(getDb(), context.user, data));

/** Moves a student into a group of a set, or out of it. */
export const moveStudentFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(moveStudentInput)
  .handler(({ data, context }) => moveStudent(getDb(), context.user, data, new Date()));

/** Splits the class's students into a new group set. */
export const autoSplitFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(autoSplitInput)
  .handler(({ data, context }) => autoSplit(getDb(), context.user, data, new Date()));

/** Copies a group set from another class the teacher teaches. */
export const copyGroupSetFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(copyGroupSetInput)
  .handler(({ data, context }) => copyGroupSet(getDb(), context.user, data, new Date()));

/** Returns every class for the administrator's oversight: no grades, no results (R-01). */
export const listAllClasses = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .handler(() => listAdminClasses(getDb(), new Date()));

/** Returns the student's classes and the pending invitations for their own address. */
export const getStudentClasses = createServerFn({ method: "GET" })
  .middleware([requireRole("student")])
  .handler(async ({ context }) => {
    const db = getDb();
    const [classes, invitations] = await Promise.all([
      listStudentClasses(db, context.user.id),
      listStudentInvitations(db, context.user.id, new Date()),
    ]);
    return { classes, invitations };
  });
