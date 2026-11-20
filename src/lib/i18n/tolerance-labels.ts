// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The translated refusals of a team's tolerance (S13): the student's own wording, never a
// teacher's message about correct values.
import { m } from "@/i18n/messages";
import type { SimulationActionError } from "@/server/simulations/access";

/** Returns the message of a refused tolerance; any other code or none is the general failure. */
export function toleranceErrorMessage(code: SimulationActionError | null): string {
  switch (code) {
    case "not_found":
      return m.tolerances_error_not_found();
    case "not_running":
      return m.tolerances_error_not_running();
    case "test_not_found":
      return m.tolerances_error_test_not_found();
    case "test_retired":
      return m.tolerances_error_test_retired();
    default:
      return m.tolerances_error_failed();
  }
}
