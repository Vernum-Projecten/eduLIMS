// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The translated words of the simulation and lab screens (D10, S10): the refusals of the server,
// the outcome of each pasted line, and how a student came into a lab.
import { m } from "@/i18n/messages";
import type { LimitKind } from "@/lib/correct-values";
import { formatList, formatNumber } from "@/lib/i18n/format";
import { LOGO_MAX_BYTES, LOGO_MAX_SIDE, LOGO_REFUSALS, type LogoRefusal } from "@/lib/lab-logo";
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
    case "has_records":
      return m.labs_error_has_records();
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
    case "in_other_simulation":
      return m.labs_error_in_other_simulation();
    case "simulation_finished":
      return m.labs_error_simulation_finished();
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
    case "missing_limits":
      return m.simulations_error_missing_limits();
    case "no_students":
      return m.simulations_error_no_students();
    case "no_correct_values":
      return m.simulations_error_no_correct_values();
    case "running":
      return m.simulations_error_running();
    case "lab_has_students":
      return m.labs_error_has_students();
    case null:
      return m.simulations_error_failed();
    default: {
      const unknown: never = code;
      return unknown;
    }
  }
}

/**
 * Returns the message of a refused join for the student who typed the code: their own words for
 * `in_other_simulation` (#379), the shared message for every other code.
 */
export function joinErrorMessage(code: SimulationActionError): string {
  return code === "in_other_simulation"
    ? m.labs_join_error_in_other_simulation()
    : simulationErrorMessage(code);
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
    case "in_other_simulation":
      return m.labs_line_in_other_simulation();
    default: {
      const unknown: never = line.status;
      return unknown;
    }
  }
}

/**
 * Returns the refusal of a start that names the tests without limits by name (maintainer,
 * 2026-11-20 on #267); an id the screen cannot name falls back to the general message.
 */
export function missingLimitsMessage(
  testIds: readonly string[],
  names: ReadonlyMap<string, string>,
): string {
  const named = testIds.flatMap((id) => {
    const name = names.get(id);
    return name === undefined ? [] : [name];
  });
  if (named.length === 0 || named.length !== testIds.length) {
    return m.simulations_error_missing_limits();
  }
  return m.simulations_error_missing_limits_named({ tests: formatList(named) });
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
 * when one place was made and the student's current lab, read again, is a new one; the count
 * otherwise; and `null` when nothing was linked.
 */
export function linkedMessage(
  linked: number,
  before: StudentLabRow | null,
  after: StudentLabRow | null,
): string | null {
  if (linked <= 0) return null;
  if (linked === 1 && after !== null && after.labId !== before?.labId) {
    return m.student_labs_linked_one({ lab: after.labName, simulation: after.simulationName });
  }
  return m.student_labs_linked({ count: formatNumber(linked) });
}

/** Returns why a logo was refused, with the limit it broke (D10, #293). */
export function logoRefusalMessage(code: LogoRefusal): string {
  switch (code) {
    case "logo_unsupported_type":
      return m.labs_logo_error_unsupported_type();
    case "logo_too_large":
      return m.labs_logo_error_too_large({ size: formatNumber(LOGO_MAX_BYTES / 1024) });
    case "logo_too_many_pixels":
      return m.labs_logo_error_too_many_pixels({ side: formatNumber(LOGO_MAX_SIDE) });
    case "logo_malformed":
      return m.labs_logo_error_malformed();
    default: {
      const unknown: never = code;
      return unknown;
    }
  }
}

/** Returns whether a refusal code is a {@link LogoRefusal}, about the file and not the access. */
export function isLogoRefusal(code: string): code is LogoRefusal {
  return (LOGO_REFUSALS as readonly string[]).includes(code);
}

/** Returns the help text of the logo field: the accepted types and the limits (D10, #293). */
export function logoFieldHelp(): string {
  return m.labs_logo_field_help({
    size: formatNumber(LOGO_MAX_BYTES / 1024),
    side: formatNumber(LOGO_MAX_SIDE),
  });
}

/** Returns whether `value` is a {@link JoinVia}; the page gets it from the database as text. */
export function isJoinVia(value: string): value is JoinVia {
  return value === "email" || value === "code";
}
