// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The EHR_STATUS eduLIMS creates an EHR with (ITS-REST 1.1.0, EHR API, "Create EHR"; RM EHR IM
// 1.1.0, EHR_STATUS). The subject is a PARTY_SELF whose external_ref names the patient by its
// eduLIMS id in eduLIMS's namespace, and nothing else: no name, no lab, no student (Q-PRIV-1).
import "@tanstack/react-start/server-only";

// NOTE: no openEHR spec governs the value: our own design (#147). It matches the OBJECT_REF
// namespace pattern of RM common 1.1.0, and FerroEHR finds a subject by namespace and id exactly.
/** The namespace of every EHR subject eduLIMS creates: the id is an eduLIMS patient id. */
export const EHR_SUBJECT_NAMESPACE = "edulims-patient";

/** A subject as the EHR API looks it up: `subject_id` and `subject_namespace`. */
export interface EhrSubjectRef {
  /** The `EHR_STATUS.subject.external_ref.id.value`. */
  id: string;
  /** The `EHR_STATUS.subject.external_ref.namespace`. */
  namespace: string;
}

/** The canonical JSON of the `EHR_STATUS` eduLIMS sends (RM EHR IM 1.1.0). */
export interface EhrStatus {
  _type: "EHR_STATUS";
  archetype_node_id: string;
  archetype_details: {
    _type: "ARCHETYPED";
    archetype_id: { _type: "ARCHETYPE_ID"; value: string };
    rm_version: string;
  };
  name: { _type: "DV_TEXT"; value: string };
  subject: {
    _type: "PARTY_SELF";
    external_ref: {
      _type: "PARTY_REF";
      namespace: string;
      type: "PERSON";
      id: { _type: "HIER_OBJECT_ID"; value: string };
    };
  };
  is_queryable: boolean;
  is_modifiable: boolean;
}

const EHR_STATUS_ARCHETYPE = "openEHR-EHR-EHR_STATUS.generic.v1";

/** Returns the subject reference of an eduLIMS patient. */
export function patientSubject(patientId: string): EhrSubjectRef {
  return { id: patientId, namespace: EHR_SUBJECT_NAMESPACE };
}

/**
 * Returns the `EHR_STATUS` of a new EHR for `subject`: queryable and modifiable, the defaults of
 * ITS-REST 1.1.0 "Create EHR".
 */
export function ehrStatusFor(subject: EhrSubjectRef): EhrStatus {
  return {
    _type: "EHR_STATUS",
    archetype_node_id: EHR_STATUS_ARCHETYPE,
    // NOTE: RM common 1.1.0, LOCATABLE invariant Archetyped_valid: an archetype root such as
    // EHR_STATUS carries archetype_details; FerroEHR refuses one without them (422).
    archetype_details: {
      _type: "ARCHETYPED",
      archetype_id: { _type: "ARCHETYPE_ID", value: EHR_STATUS_ARCHETYPE },
      rm_version: "1.1.0",
    },
    name: { _type: "DV_TEXT", value: "EHR Status" },
    // NOTE: RM common 1.1.0, "Referring to the Patient": PARTY_SELF with an external_ref; the
    // patient's details are not part of the reference.
    subject: {
      _type: "PARTY_SELF",
      external_ref: {
        _type: "PARTY_REF",
        namespace: subject.namespace,
        type: "PERSON",
        id: { _type: "HIER_OBJECT_ID", value: subject.id },
      },
    },
    is_queryable: true,
    is_modifiable: true,
  };
}
