// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The words of a team's records (S11, S12, S16): the refusals of the server, the sexes and the
// kinds of request, and the fields a correction names, each from the i18n layer (ADR 0011).
import { m } from "@/i18n/messages";
import type { PatientSex, RequestKind } from "@/lib/lab-records";
import type { RecordsActionError } from "@/server/lab-records/access";
import type { CorrectionChange } from "@/server/lab-records/corrections";

/** Returns the translated message of a refusal; `null` (no refusal code) is a failure. */
export function recordsErrorMessage(code: RecordsActionError | null): string {
  switch (code) {
    case "not_found":
      return m.records_error_not_found();
    case "not_running":
      return m.records_error_not_running();
    case "patient_not_found":
      return m.records_error_patient_not_found();
    case "request_not_found":
      return m.records_error_request_not_found();
    case "sample_not_found":
      return m.records_error_sample_not_found();
    case "test_not_found":
      return m.records_error_test_not_found();
    case "test_retired":
      return m.records_error_test_retired();
    case "released":
      return m.records_error_released();
    case "requester_required":
      return m.records_requester_required();
    case null:
      return m.records_error_failed();
    default: {
      const unknown: never = code;
      return unknown;
    }
  }
}

/** Returns the translated name of a patient's sex. */
export function sexLabel(sex: PatientSex): string {
  switch (sex) {
    case "female":
      return m.records_sex_female();
    case "male":
      return m.records_sex_male();
    case "other":
      return m.records_sex_other();
    case "unknown":
      return m.records_sex_unknown();
    default: {
      const unknown: never = sex;
      return unknown;
    }
  }
}

/** Returns the translated name of a kind of request. */
export function requestKindLabel(kind: RequestKind): string {
  switch (kind) {
    case "patient":
      return m.records_kind_patient();
    case "control":
      return m.records_kind_control();
    default: {
      const unknown: never = kind;
      return unknown;
    }
  }
}

/** Returns the translated name of the field a correction changed. */
export function correctionFieldLabel(field: CorrectionChange["field"]): string {
  switch (field) {
    case "name":
      return m.records_patient_name();
    case "date_of_birth":
      return m.records_patient_birth();
    case "sex":
      return m.records_patient_sex();
    case "identifier":
      return m.records_patient_identifier();
    case "requester":
      return m.records_requester();
    case "phone_through":
      return m.records_phone_through();
    case "remarks":
      return m.records_remarks();
    case "tests":
      return m.records_tests();
    case "sample_number":
      return m.records_sample_number();
    case "material":
      return m.records_sample_material();
    case "sample_added":
      return m.records_correction_sample_added();
    default: {
      const unknown: never = field;
      return unknown;
    }
  }
}
