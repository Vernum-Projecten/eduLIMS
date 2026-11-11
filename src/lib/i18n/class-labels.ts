// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Display names for classes (#28): class roles, the preview statuses of an invitation list and
// the refusals of the class service.
import { m } from "@/i18n/messages";
import type { ClassRole } from "@/lib/classes";

/** Returns the name of a class role. */
export function classRoleLabel(role: ClassRole): string {
  switch (role) {
    case "owner":
      return m.classes_role_owner();
    case "teacher":
      return m.classes_role_teacher();
    case "student":
      return m.classes_role_student();
    default: {
      const unknown: never = role;
      return unknown;
    }
  }
}

/** The preview statuses of an invitation list (src/server/classes/invitations.ts). */
export type InviteRowStatusValue =
  | "new"
  | "invalid"
  | "duplicate"
  | "member"
  | "invited"
  | "not_a_teacher";

/** Returns what happens to one address of an invitation list. */
export function inviteRowStatusLabel(status: InviteRowStatusValue): string {
  switch (status) {
    case "new":
      return m.classes_invite_row_new();
    case "invalid":
      return m.classes_invite_row_invalid();
    case "duplicate":
      return m.classes_invite_row_duplicate();
    case "member":
      return m.classes_invite_row_member();
    case "invited":
      return m.classes_invite_row_invited();
    case "not_a_teacher":
      return m.classes_invite_row_not_a_teacher();
    default: {
      const unknown: never = status;
      return unknown;
    }
  }
}

/** Returns the message of a refused class action from its code; anything else is "failed". */
export function classErrorMessage(code: string | null): string {
  switch (code) {
    case "not_found":
      return m.classes_error_not_found();
    case "forbidden":
      return m.classes_error_forbidden();
    case "archived":
      return m.classes_error_archived();
    case "not_archived":
      return m.classes_error_not_archived();
    case "owner_not_removable":
      return m.classes_error_owner_not_removable();
    case "not_class_teacher":
      return m.classes_error_not_class_teacher();
    case "not_class_student":
      return m.classes_error_not_class_student();
    case "has_work":
      return m.classes_error_has_work();
    case "group_not_found":
      return m.classes_error_group_not_found();
    case "group_name_taken":
      return m.classes_error_group_name_taken();
    case "group_set_exists":
      return m.classes_error_group_set_exists();
    case "group_set_empty":
      return m.classes_error_group_set_empty();
    case "invitation_not_found":
      return m.classes_error_invitation_not_found();
    default:
      return m.classes_error_failed();
  }
}
