// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The inputs of classes, invitations and lab groups (#28). Shared by the forms and the server
// functions, so both sides refuse the same input.
import { z } from "zod";
import { m } from "@/i18n/messages";
import { CLASS_NAME_MAX, GROUP_NAME_MAX, INVITATION_ROLES, isAcademicYear } from "@/lib/classes";

// NOTE: no requirement governs these bounds: our own design, flagged on #28 for the owner.
/** The most addresses one invitation list takes. */
export const INVITE_LIST_MAX = 500;
/** The most groups one action creates, and the largest group auto-split makes. */
export const GROUPS_MAX = 50;
export const GROUP_SIZE_MAX = 50;

const tooLong = (max: number) => () => m.form_too_long({ max: String(max) });

const id = z.uuid();

const className = z
  .string()
  .trim()
  .min(1, { error: () => m.classes_name_required() })
  .max(CLASS_NAME_MAX, { error: tooLong(CLASS_NAME_MAX) });

const academicYear = z
  .string()
  .trim()
  .refine(isAcademicYear, { error: () => m.classes_year_invalid() });

const groupName = z
  .string()
  .trim()
  .min(1, { error: () => m.classes_group_name_required() })
  .max(GROUP_NAME_MAX, { error: tooLong(GROUP_NAME_MAX) });

/** The class form: a name and an academic year ("2026-2027"). */
export const classFormSchema = z.object({ name: className, academicYear });
export type ClassForm = z.input<typeof classFormSchema>;

/** One class, named by its id. */
export const classIdInput = z.object({ classId: id });

/** Editing a class. */
export const updateClassInput = classFormSchema.extend({ classId: id });

/** The copy form: the academic year of the copy. */
export const copyClassFormSchema = z.object({ academicYear });
export type CopyClassForm = z.input<typeof copyClassFormSchema>;
export const copyClassInput = copyClassFormSchema.extend({ classId: id });

/** A member of a class, named by their user id. */
export const memberInput = z.object({ classId: id, userId: z.string().min(1).max(128) });

/** The class roles an invitation can carry. */
const invitationRole = z.enum(INVITATION_ROLES);

/** The invitation form: a class role and a list of addresses (typed, pasted or from a CSV). */
// NOTE: #28; a malformed address is not refused at the field but listed in the server's preview
// as "not a valid email address", with the duplicates and members, before anything is created.
export const inviteFormSchema = z.object({
  role: invitationRole,
  emails: z
    .array(z.string())
    .min(1, { error: () => m.classes_invite_emails_required() })
    .max(INVITE_LIST_MAX, {
      error: () => m.form_email_list_too_many({ max: String(INVITE_LIST_MAX) }),
    }),
});
export type InviteForm = z.input<typeof inviteFormSchema>;

/**
 * The input of the preview and of creating invitations. The server classifies every address
 * itself, so a malformed one is reported in the preview, never refused as a whole.
 */
export const inviteInput = z.object({
  classId: id,
  role: invitationRole,
  emails: z.array(z.string().max(320)).min(1).max(INVITE_LIST_MAX),
});

/** One invitation of a class. */
export const invitationInput = z.object({ classId: id, invitationId: id });

const groupSet = z
  .string()
  .trim()
  .min(1, { error: () => m.classes_group_set_required() })
  .max(GROUP_NAME_MAX, { error: tooLong(GROUP_NAME_MAX) });

/** The "create groups" form: a group set, how many groups and their name prefix. */
export const createGroupsFormSchema = z.object({
  groupSet,
  count: z
    .number({ error: () => m.classes_group_count_invalid({ max: String(GROUPS_MAX) }) })
    .int({ error: () => m.classes_group_count_invalid({ max: String(GROUPS_MAX) }) })
    .min(1, { error: () => m.classes_group_count_invalid({ max: String(GROUPS_MAX) }) })
    .max(GROUPS_MAX, { error: () => m.classes_group_count_invalid({ max: String(GROUPS_MAX) }) }),
  prefix: groupName,
});
export type CreateGroupsForm = z.input<typeof createGroupsFormSchema>;

/** Creating groups with given names in a group set. */
export const createGroupsInput = z.object({
  classId: id,
  groupSet,
  names: z.array(groupName).min(1).max(GROUPS_MAX),
});

/** The auto-split form: a new group set, the group size and the order. */
export const autoSplitFormSchema = z.object({
  groupSet,
  size: z
    .number({ error: () => m.classes_group_size_invalid({ max: String(GROUP_SIZE_MAX) }) })
    .int({ error: () => m.classes_group_size_invalid({ max: String(GROUP_SIZE_MAX) }) })
    .min(1, { error: () => m.classes_group_size_invalid({ max: String(GROUP_SIZE_MAX) }) })
    .max(GROUP_SIZE_MAX, {
      error: () => m.classes_group_size_invalid({ max: String(GROUP_SIZE_MAX) }),
    }),
  order: z.enum(["random", "alphabetical"]),
  prefix: groupName,
});
export type AutoSplitForm = z.input<typeof autoSplitFormSchema>;
export const autoSplitInput = autoSplitFormSchema.extend({ classId: id });

/** Renaming a group. */
export const renameGroupFormSchema = z.object({ name: groupName });
export type RenameGroupForm = z.input<typeof renameGroupFormSchema>;
export const renameGroupInput = renameGroupFormSchema.extend({ classId: id, groupId: id });

/** One group of a class. */
export const groupInput = z.object({ classId: id, groupId: id });

/** Moving a student into a group of a set, or out of every group of it (`groupId` null). */
export const moveStudentInput = z.object({
  classId: id,
  userId: z.string().min(1).max(128),
  groupSet,
  groupId: id.nullable(),
});

/** The "copy a group set" form: the source class and its group set. */
export const copyGroupSetFormSchema = z.object({
  source: z.string().min(1, { error: () => m.classes_copy_set_source_required() }),
});
export type CopyGroupSetForm = z.input<typeof copyGroupSetFormSchema>;
export const copyGroupSetInput = z.object({ classId: id, sourceClassId: id, groupSet });

/** The class list's search params: the Archived filter. */
export const classListSearchSchema = z.object({
  archived: z.boolean().optional().catch(undefined),
});
export type ClassListSearch = z.infer<typeof classListSearchSchema>;

/** The class page's search params: the open tab. */
export const CLASS_TABS = ["members", "invitations", "groups"] as const;
export const classPageSearchSchema = z.object({
  tab: z.enum(CLASS_TABS).optional().catch(undefined),
});
export type ClassPageSearch = z.infer<typeof classPageSearchSchema>;
