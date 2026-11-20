// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The translated words of the simulation and lab screens (D10, S10): the refusals of the server,
// the outcome of each pasted line, and how a student came into a lab.
import { m } from "@/i18n/messages";
import type { LimitKind } from "@/lib/correct-values";
import { formatNumber } from "@/lib/i18n/format";
import type { JoinVia, SimulationState } from "@/lib/simulations";
import type { SimulationActionError } from "@/server/simulations/access";
import type { EmailLine } from "@/server/simulations/emails";
import type { StudentLabRow } from "@/server/simulations/queries";

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
    case "join_code_exists":
      return m.labs_error_join_code_exists();
    case "join_code_off":
      return m.labs_error_join_code_off();
    case "not_a_student":
      return m.labs_error_not_a_student();
    case "invalid_code":
      return m.labs_error_invalid_code();
    case "rate_limited":
      return m.labs_error_rate_limited();
    case "in_other_lab":
      return m.labs_error_in_other_lab();
    case "not_prepared":
      return m.simulations_error_not_prepared();
    case "not_running":
      return m.simulations_error_not_running();
    case "test_not_found":
      return m.correct_values_error_test_not_found();
    case "test_retired":
      return m.correct_values_error_test_retired();
    case "value_not_found":
      return m.correct_values_error_value_not_found();
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

/** Returns the name of a simulation's state (D10, #267). */
export function simulationStateLabel(state: SimulationState): string {
  switch (state) {
    case "prepared":
      return m.simulations_state_prepared();
    case "running":
      return m.simulations_state_running();
    case "finished":
      return m.simulations_state_finished();
    default: {
      const unknown: never = state;
      return unknown;
    }
  }
}

/** Returns how a test's accuracy limits are expressed, in words (D13). */
export function limitKindLabel(kind: LimitKind): string {
  switch (kind) {
    case "percent":
      return m.correct_values_kind_percent();
    case "absolute":
      return m.correct_values_kind_absolute();
    default: {
      const unknown: never = kind;
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

/**
 * Returns the announcement of the link the Student portal overview runs (S10): the lab by name
 * when one place was made and the labs read again show exactly one new lab, the count otherwise,
 * and `null` when nothing was linked.
 */
export function linkedMessage(
  linked: number,
  before: readonly StudentLabRow[],
  after: readonly StudentLabRow[],
): string | null {
  if (linked <= 0) return null;
  const known = new Set(before.map((lab) => lab.labId));
  const added = after.filter((lab) => !known.has(lab.labId));
  const [only] = added;
  if (linked === 1 && added.length === 1 && only) {
    return m.student_labs_linked_one({ lab: only.labName, simulation: only.simulationName });
  }
  return m.student_labs_linked({ count: formatNumber(linked) });
}

/** Returns whether `value` is a {@link JoinVia}; the page gets it from the database as text. */
export function isJoinVia(value: string): value is JoinVia {
  return value === "email" || value === "code";
}
