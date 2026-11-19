// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The translated words of the simulation and lab screens (D10, S10): the refusals of the server,
// the outcome of each pasted line, and how a student came into a lab.
import { m } from "@/i18n/messages";
import type { JoinVia } from "@/lib/simulations";
import type { SimulationActionError } from "@/server/simulations/access";
import type { EmailLine } from "@/server/simulations/emails";

/** Returns the message of a refused action; `null` (a failure, not a refusal) is the generic one. */
export function simulationErrorMessage(code: SimulationActionError | null): string {
  switch (code) {
    case "not_found":
      return m.simulations_error_not_found();
    case "lab_name_taken":
      return m.labs_error_name_taken();
    case "not_a_teacher":
      return m.simulations_error_not_a_teacher();
    case "already_teacher":
      return m.simulations_error_already_teacher();
    case "last_teacher":
      return m.simulations_error_last_teacher();
    case "teacher_not_found":
      return m.simulations_error_teacher_not_found();
    case "has_students":
      return m.simulations_error_has_students();
    case "member_not_found":
      return m.labs_error_member_not_found();
    case "same_lab":
      return m.labs_error_same_lab();
    case "email_not_found":
      return m.labs_error_email_not_found();
    case null:
      return m.simulations_error_failed();
    default: {
      const unknown: never = code;
      return unknown;
    }
  }
}

/** Returns the outcome of one pasted line in words; an address in another lab names that lab. */
export function emailLineLabel(line: EmailLine): string {
  switch (line.status) {
    case "new":
      return m.labs_line_new();
    case "invalid":
      return m.labs_line_invalid();
    case "repeated":
      return m.labs_line_repeated();
    case "in_this_lab":
      return m.labs_line_in_this_lab();
    case "in_other_lab":
      return line.otherLab
        ? m.labs_line_in_other_lab({ lab: line.otherLab.name })
        : m.labs_line_in_other_lab_unnamed();
    default: {
      const unknown: never = line.status;
      return unknown;
    }
  }
}

/** Returns how a student came into a lab, in words. */
export function joinViaLabel(via: JoinVia): string {
  switch (via) {
    case "email":
      return m.labs_joined_via_email();
    case "code":
      return m.labs_joined_via_code();
    default: {
      const unknown: never = via;
      return unknown;
    }
  }
}

/** Returns whether `value` is a {@link JoinVia}; the page gets it from the database as text. */
export function isJoinVia(value: string): value is JoinVia {
  return value === "email" || value === "code";
}
