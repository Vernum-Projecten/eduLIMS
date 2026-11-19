// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of simulations, labs, teachers, members and the email lists (D10, S10). Shared by the
// forms and the server functions, so both sides refuse the same input. A malformed id fails here,
// before any query runs.
import { z } from "zod";
import { m } from "@/i18n/messages";
import {
  JOIN_CODE_DAYS_MAX,
  JOIN_CODE_INPUT_MAX,
  JOIN_CODE_USES_MAX,
  normalizeJoinCode,
} from "@/lib/join-code";
import {
  EMAIL_LINE_MAX,
  EMAIL_LIST_MAX,
  LAB_NAME_MAX,
  SIMULATION_NAME_MAX,
} from "@/lib/simulations";

const tooLong = (max: number) => () => m.form_too_long({ max: String(max) });

const id = z.uuid();
/** A user id from a teacher's screen: better-auth ids are text, checked against the simulation. */
const userId = z.string().min(1).max(128);

const simulationName = z
  .string()
  .trim()
  .min(1, { error: () => m.simulations_name_required() })
  .max(SIMULATION_NAME_MAX, { error: tooLong(SIMULATION_NAME_MAX) });

const labName = z
  .string()
  .trim()
  .min(1, { error: () => m.simulations_lab_name_required() })
  .max(LAB_NAME_MAX, { error: tooLong(LAB_NAME_MAX) });

/** The simulation form: its name. */
export const simulationFormSchema = z.object({ name: simulationName });
export type SimulationForm = z.input<typeof simulationFormSchema>;

/** One simulation, named by its id. */
export const simulationIdInput = z.object({ simulationId: id });

/** Renaming a simulation. */
export const renameSimulationInput = simulationFormSchema.extend({ simulationId: id });

/** The lab form: its name. */
export const labFormSchema = z.object({ name: labName });
export type LabForm = z.input<typeof labFormSchema>;

/** Creating a lab in a simulation. */
export const createLabInput = labFormSchema.extend({ simulationId: id });

/** One lab, named by its id. */
export const labIdInput = z.object({ labId: id });

/** Renaming a lab. */
export const renameLabInput = labFormSchema.extend({ labId: id });

/** Adding a teacher to a simulation by the address of their account. */
export const addTeacherInput = z.object({
  simulationId: id,
  email: z
    .string()
    .trim()
    .max(EMAIL_LINE_MAX, { error: tooLong(EMAIL_LINE_MAX) })
    .pipe(z.email({ error: () => m.simulations_teacher_email_invalid() })),
});

/** The add-teacher form: the address alone; the simulation comes from the page. */
export const addTeacherFormSchema = addTeacherInput.pick({ email: true });
export type AddTeacherForm = z.input<typeof addTeacherFormSchema>;

/** A teacher of a simulation, named by their user id. */
export const teacherInput = z.object({ simulationId: id, userId });

/** A student of a simulation, named by their user id. */
export const memberInput = z.object({ simulationId: id, userId });

/** Moving a student to another lab of the same simulation. */
export const moveMemberInput = memberInput.extend({
  labId: z.uuid({ error: () => m.labs_move_target_required() }),
});

/** The move form: the lab the student goes to. */
export const moveMemberFormSchema = moveMemberInput.pick({ labId: true });
export type MoveMemberForm = z.input<typeof moveMemberFormSchema>;

/** How many characters of an overlong line a refusal quotes, so the teacher finds the line. */
const LINE_START = 24;

/** Returns the first characters of `line`, with an ellipsis when it goes on. */
function lineStart(line: string): string {
  return line.length > LINE_START ? `${line.slice(0, LINE_START)}…` : line;
}

/**
 * The pasted list of a lab (D10): any lines up to the limit. The server classifies each line, so
 * a malformed address is reported in the preview, never refused as a whole.
 */
export const emailListInput = z.object({
  labId: id,
  emails: z
    .array(z.string())
    .min(1, { error: () => m.labs_paste_required() })
    .max(EMAIL_LIST_MAX, {
      error: () => m.form_email_list_too_many({ max: String(EMAIL_LIST_MAX) }),
    })
    .superRefine((lines, ctx) => {
      // NOTE: WCAG 3.3.1; an issue on an item path has no field to show it, so each one belongs
      // to the list and names its line, as `emailListSchema` does.
      for (const line of lines) {
        if (line.length > EMAIL_LINE_MAX) {
          ctx.addIssue({
            code: "custom",
            message: m.labs_paste_line_too_long({
              line: lineStart(line),
              max: String(EMAIL_LINE_MAX),
            }),
          });
        }
      }
    }),
});

/** The paste form: the list alone; the lab comes from the page. */
export const emailListFormSchema = emailListInput.pick({ emails: true });
export type EmailListForm = z.input<typeof emailListFormSchema>;

/** One waiting address of a lab. */
export const waitingEmailInput = z.object({
  labId: id,
  email: z.string().trim().min(1).max(EMAIL_LINE_MAX),
});

const validDaysError = () => m.labs_code_days_invalid({ max: String(JOIN_CODE_DAYS_MAX) });
const maxUsesError = () => m.labs_code_uses_invalid({ max: String(JOIN_CODE_USES_MAX) });

/**
 * The lab-code form (#288, #290): how many days the code works and how many students may join,
 * within the bounds the database CHECKs hold too.
 */
export const joinCodeFormSchema = z.object({
  validDays: z
    .number({ error: validDaysError })
    .int({ error: validDaysError })
    .min(1, { error: validDaysError })
    .max(JOIN_CODE_DAYS_MAX, { error: validDaysError }),
  maxUses: z
    .number({ error: maxUsesError })
    .int({ error: maxUsesError })
    .min(1, { error: maxUsesError })
    .max(JOIN_CODE_USES_MAX, { error: maxUsesError }),
});
export type JoinCodeForm = z.input<typeof joinCodeFormSchema>;

/** Turning on or replacing a lab's join code: the form's settings for the page's lab. */
export const joinCodeInput = joinCodeFormSchema.extend({ labId: id });

/**
 * Joining a lab with its code (S10): any string up to the form's maximum. The server normalises
 * it and counts a malformed code as a wrong one, so a crafted request skips no limit.
 */
export const joinInput = z.object({ code: z.string().max(JOIN_CODE_INPUT_MAX) });

/**
 * The student's join form (S10, #290): {@link joinInput} plus the checks that need no server. An
 * empty code or one of the wrong shape is refused at the field and costs no attempt; a code of
 * the right shape that does not work is the server's `invalid_code`, at the field too.
 */
export const joinFormSchema = z.object({
  code: z
    .string()
    .max(JOIN_CODE_INPUT_MAX, { error: () => m.labs_join_code_shape() })
    .refine((value) => value.trim() !== "", { error: () => m.labs_join_code_required() })
    .refine((value) => value.trim() === "" || normalizeJoinCode(value) !== null, {
      error: () => m.labs_join_code_shape(),
    }),
});
export type JoinForm = z.input<typeof joinFormSchema>;
