// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The words of a lab's measurements and results (S14, S15): the refusals of the server, where a
// measurement came from, the state of a requested test and the tolerance check, each from the
// i18n layer (ADR 0011).
import { m } from "@/i18n/messages";
import type { MeasurementSource, RequestedTestState } from "@/lib/results";
import type { ToleranceCheck } from "@/lib/tolerance";
import type { ResultsActionError } from "@/server/results/access";

/** Returns the translated message of a refusal; `null` (no refusal code) is a failure. */
export function resultsErrorMessage(code: ResultsActionError | null): string {
  switch (code) {
    case "not_found":
      return m.results_error_not_found();
    case "not_running":
      return m.results_error_not_running();
    case "request_not_found":
      return m.results_error_request_not_found();
    case "test_not_found":
      return m.results_error_test_not_found();
    case "sample_not_found":
      return m.results_error_sample_not_found();
    case "measurement_not_found":
      return m.results_error_measurement_not_found();
    case "not_manual_test":
      return m.results_error_not_manual_test();
    case "value_invalid":
      return m.results_value_invalid();
    case "released":
      return m.results_error_released();
    case "no_tolerance":
      return m.results_error_no_tolerance();
    case "tolerance_changed":
      return m.results_error_tolerance_changed();
    case null:
      return m.results_error_failed();
    default: {
      const unknown: never = code;
      return unknown;
    }
  }
}

/** Returns the translated name of where a measurement came from. */
export function measurementSourceLabel(source: MeasurementSource): string {
  switch (source) {
    case "afinion":
      return m.results_source_afinion();
    case "epoch_upload":
      return m.results_source_epoch();
    case "manual":
      return m.results_source_manual();
    default: {
      const unknown: never = source;
      return unknown;
    }
  }
}

/** Returns the translated name of the state of a requested test. */
export function requestedTestStateLabel(state: RequestedTestState): string {
  switch (state) {
    case "requested":
      return m.results_state_requested();
    case "measured":
      return m.results_state_measured();
    case "released":
      return m.results_state_released();
    default: {
      const unknown: never = state;
      return unknown;
    }
  }
}

/**
 * Returns the warning of S15 for a value outside the team's own tolerance, or `null` when it is
 * inside. The text names the side, so the warning never rests on its colour (Q-ACC-2).
 */
export function toleranceWarning(
  check: ToleranceCheck,
  limits: { lower: string; upper: string; unit: string },
): string | null {
  switch (check) {
    case "inside":
      return null;
    case "below":
      return m.results_warning_below(limits);
    case "above":
      return m.results_warning_above(limits);
    default: {
      const unknown: never = check;
      return unknown;
    }
  }
}
