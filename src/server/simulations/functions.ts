// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of simulations and labs (D10, S10, B5); bodies run on the server. Every one
// requires its app role first, then parses its input with Zod; the service checks the teacher
// row or the student's place on the session user in SQL (D11, R-01).
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
import { readAdminSimulation, readAdminSimulations } from "./admin-queries.ts";
import { addEmails, previewEmails, removeEmail } from "./emails.ts";
import { joinLabWithCode } from "./join.ts";
import { disableJoinCode, enableJoinCode, getJoinCode, regenerateJoinCode } from "./join-code.ts";
import { requestJoinContext, serverJoinCodeKey } from "./join-context.ts";
import { createLab, deleteLab, renameLab } from "./labs.ts";
import { linkWaitingAddresses } from "./linking.ts";
import { moveMember, removeMember } from "./members.ts";
import {
  getTeacherLab,
  getTeacherSimulation,
  listStudentLabs,
  listTeacherSimulations,
} from "./queries.ts";
import {
  addTeacherInput,
  createLabInput,
  emailListInput,
  joinCodeInput,
  joinInput,
  labIdInput,
  memberInput,
  moveMemberInput,
  renameLabInput,
  renameSimulationInput,
  simulationFormSchema,
  simulationIdInput,
  teacherInput,
  waitingEmailInput,
} from "./schemas.ts";
import { createSimulation, deleteSimulation, renameSimulation } from "./simulations.ts";
import { addTeacher, removeTeacher } from "./teachers.ts";

const teacher = requireRole("teacher");
const student = requireRole("student");
const admin = requireRole("admin");

/** Returns the simulations the teacher teaches (D11). */
export const listMySimulations = createServerFn({ method: "GET" })
  .middleware([teacher])
  .handler(({ context }) => listTeacherSimulations(getDb(), context.user.id));

/** Returns a simulation's page; throws `notFound` unless the teacher teaches it (D11). */
export const getSimulationPage = createServerFn({ method: "GET" })
  .middleware([teacher])
  .validator(simulationIdInput)
  .handler(async ({ data, context }) => {
    const page = await getTeacherSimulation(getDb(), context.user.id, data.simulationId);
    if (!page) throw notFound();
    return page;
  });

/** Returns a lab's page; throws `notFound` unless the teacher teaches its simulation (D11). */
export const getLabPage = createServerFn({ method: "GET" })
  .middleware([teacher])
  .validator(labIdInput)
  .handler(async ({ data, context }) => {
    const page = await getTeacherLab(getDb(), context.user.id, data.labId);
    if (!page) throw notFound();
    return page;
  });

/** Creates a simulation with the teacher as its first teacher (D10). */
export const createSimulationFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(simulationFormSchema)
  .handler(({ data, context }) => createSimulation(getDb(), context.user, data, new Date()));

/** Renames a simulation. */
export const renameSimulationFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(renameSimulationInput)
  .handler(({ data, context }) => renameSimulation(getDb(), context.user, data));

/** Deletes a simulation that has no student. */
export const deleteSimulationFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(simulationIdInput)
  .handler(({ data, context }) => deleteSimulation(getDb(), context.user, data));

/** Adds a teacher to a simulation by the address of their account (D10). */
export const addTeacherFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(addTeacherInput)
  .handler(({ data, context }) => addTeacher(getDb(), context.user, data, new Date()));

/** Removes a teacher from a simulation, never the last one. */
export const removeTeacherFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(teacherInput)
  .handler(({ data, context }) => removeTeacher(getDb(), context.user, data));

/** Creates a lab in a simulation (D10). */
export const createLabFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(createLabInput)
  .handler(({ data, context }) => createLab(getDb(), context.user, data, new Date()));

/** Renames a lab. */
export const renameLabFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(renameLabInput)
  .handler(({ data, context }) => renameLab(getDb(), context.user, data, new Date()));

/** Deletes a lab with its places, waiting addresses and code. */
export const deleteLabFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(labIdInput)
  .handler(({ data, context }) => deleteLab(getDb(), context.user, data));

/** Moves a student to another lab of the same simulation. */
export const moveMemberFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(moveMemberInput)
  .handler(({ data, context }) => moveMember(getDb(), context.user, data));

/** Removes a student from a simulation, with a removal record. */
export const removeMemberFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(memberInput)
  .handler(({ data, context }) => removeMember(getDb(), context.user, data, new Date()));

/** Classifies a pasted list for a lab without storing anything (D10). */
export const previewEmailsFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(emailListInput)
  .handler(({ data, context }) => previewEmails(getDb(), context.user, data));

/** Stores the new lines of a pasted list as waiting addresses of a lab (D10). */
export const addEmailsFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(emailListInput)
  .handler(({ data, context }) => addEmails(getDb(), context.user, data, new Date()));

/** Removes one waiting address of a lab. */
export const removeEmailFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(waitingEmailInput)
  .handler(({ data, context }) => removeEmail(getDb(), context.user, data));

/** Returns the join-code state of a lab; throws `notFound` unless the teacher teaches it (#288). */
export const getJoinCodeFn = createServerFn({ method: "GET" })
  .middleware([teacher])
  .validator(labIdInput)
  .handler(async ({ data, context }) => {
    const { fingerprint } = serverJoinCodeKey();
    const view = await getJoinCode(getDb(), context.user, data.labId, new Date(), fingerprint);
    if (!view) throw notFound();
    return view;
  });

/** Turns on the join code of a lab and returns the new code, once (#288). */
export const enableJoinCodeFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(joinCodeInput)
  .handler(({ data, context }) =>
    enableJoinCode(getDb(), context.user, data, new Date(), serverJoinCodeKey()),
  );

/** Replaces the join code of a lab and returns the new code, once (#288). */
export const regenerateJoinCodeFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(joinCodeInput)
  .handler(({ data, context }) =>
    regenerateJoinCode(getDb(), context.user, data, new Date(), serverJoinCodeKey()),
  );

/** Turns the join code of a lab off (#288). */
export const disableJoinCodeFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(labIdInput)
  .handler(({ data, context }) => disableJoinCode(getDb(), context.user, data));

/** Joins the signed-in student to the lab of a join code (S10, #288). */
export const joinLabFn = createServerFn({ method: "POST" })
  .middleware([student])
  .validator(joinInput)
  .handler(({ data, context }) =>
    joinLabWithCode(getDb(), context.user, data, requestJoinContext(new Date())),
  );

/** Returns the labs the signed-in student is in (S10). */
export const getMyLabs = createServerFn({ method: "GET" })
  .middleware([student])
  .handler(({ context }) => listStudentLabs(getDb(), context.user.id));

/**
 * Links the signed-in student's waiting addresses to their labs (S10), so a student who was
 * signed in before a teacher added their address needs no second sign-in. A POST: it writes.
 */
export const linkMyLabsFn = createServerFn({ method: "POST" })
  .middleware([student])
  .handler(({ context }) => linkWaitingAddresses(getDb(), context.user.id, new Date()));

/** Returns every simulation with its teachers and labs, read-only (B5). */
export const listAdminSimulationsFn = createServerFn({ method: "GET" })
  .middleware([admin])
  .handler(({ context }) => readAdminSimulations(getDb(), context.user));

/** Returns one simulation, read-only; throws `notFound` for an unknown id (B5). */
export const getAdminSimulationFn = createServerFn({ method: "GET" })
  .middleware([admin])
  .validator(simulationIdInput)
  .handler(async ({ data, context }) => {
    const simulation = await readAdminSimulation(getDb(), context.user, data.simulationId);
    if (!simulation) throw notFound();
    return simulation;
  });
