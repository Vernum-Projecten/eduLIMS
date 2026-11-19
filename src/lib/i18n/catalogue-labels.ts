// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The translated names of the test catalogue (D9, #266).
import { m } from "@/i18n/messages";
import type { EpochCalculator, TestSource, TestSourceKind, TestStatus } from "@/lib/catalogue";

/** Returns the name of where a test's measurements come from. */
export function testSourceLabel(source: TestSourceKind): string {
  switch (source) {
    case "afinion":
      return m.catalogue_source_afinion();
    case "epoch_upload":
      return m.catalogue_source_epoch_upload();
    case "manual":
      return m.catalogue_source_manual();
    default: {
      const unknown: never = source;
      return unknown;
    }
  }
}

/** Returns who calculates an Epoch 2 concentration, in words. */
export function epochCalculatorLabel(calculator: EpochCalculator): string {
  switch (calculator) {
    case "team":
      return m.catalogue_calculated_by_team();
    case "edulims":
      return m.catalogue_calculated_by_edulims();
    default: {
      const unknown: never = calculator;
      return unknown;
    }
  }
}

/** Returns the setting of a test's source in one line, or `null` for entry by hand. */
export function testSourceDetail(source: TestSource): string | null {
  switch (source.kind) {
    case "afinion":
      return m.catalogue_source_detail_analyte({ analyte: source.analyte });
    case "epoch_upload":
      return epochCalculatorLabel(source.calculatedBy);
    case "manual":
      return null;
    default: {
      const unknown: never = source;
      return unknown;
    }
  }
}

/** Returns the name of a test's status in the catalogue. */
export function testStatusLabel(status: TestStatus): string {
  switch (status) {
    case "active":
      return m.catalogue_status_active();
    case "retired":
      return m.catalogue_status_retired();
    default: {
      const unknown: never = status;
      return unknown;
    }
  }
}

/** Returns the message of a refused or failed change to the catalogue. */
export function catalogueErrorMessage(code: string): string {
  switch (code) {
    case "not_found":
      return m.catalogue_error_not_found();
    case "name_taken":
      return m.catalogue_error_name_taken();
    case "retired":
      return m.catalogue_error_retired();
    case "not_retired":
      return m.catalogue_error_not_retired();
    case "in_use":
      return m.catalogue_error_in_use();
    case "in_running_simulation":
      return m.catalogue_error_in_running_simulation();
    case "analyte_taken":
      return m.catalogue_error_analyte_taken();
    default:
      return m.catalogue_error_failed();
  }
}
