---
paths:
  - "src/server/openehr/**"
  - "src/server/ehr/**"
  - "src/server/upload/**"
  - "src/server/integrations/**"
  - "src/server/hl7/**"
  - "tests/fixtures/**"
  - "tests/integration/**"
  - "docker/**"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Integrations: FerroEHR (openEHR), FerroBRIDGE (HL7 v2), Gen5 Excel

Measurements reach FerroEHR by two routes and are read back by one
([architecture.md](../../docs/architecture.md#context-and-integrations)):

| Route | From, to | Standard | What eduLIMS builds |
|---|---|---|---|
| Afinion 2 | analyser to FerroBRIDGE to FerroEHR | HL7 v2 over MLLP, then openEHR REST | nothing in code: FerroBRIDGE configuration and its mapping to the `eduLIMS-lab` template |
| Epoch 2 | Gen5 Excel export, uploaded in the Student portal | the fixed Gen5 export template | the upload, the parser, the validation, and the composition write |
| Read | eduLIMS from FerroEHR | AQL through the openEHR REST Query API | the queries per sample, student and practical |

FerroEHR and FerroBRIDGE are configured, never developed here (scope, plan of
approach §1.5). A defect in either is reported to its own repository.

## The specifications are authoritative

Implement and review every integration behaviour against the published
specification, never from memory or from what one server happens to accept:

1. **openEHR REST API, ITS-REST Release 1.1.0**
   (<https://specifications.openehr.org/releases/ITS-REST/Release-1.1.0>):
   the EHR API (`ehr.html`: EHR by `subject_id` and `subject_namespace`,
   `POST /ehr/{ehr_id}/composition`), the Query API (`query.html`:
   `POST /query/aql` with `query_parameters`), the Definition API
   (`definition.html`: the ADL 1.4 operational template).
2. **AQL, QUERY Release 1.1.0**
   (<https://specifications.openehr.org/releases/QUERY/Release-1.1.0/AQL.html>).
3. **The archetypes in the openEHR CKM** (<https://ckm.openehr.org/ckm/>),
   at the revision the `eduLIMS-lab` template pins:
   `openEHR-EHR-COMPOSITION.report-result.v1`,
   `openEHR-EHR-OBSERVATION.laboratory_test_result.v1`,
   `openEHR-EHR-CLUSTER.laboratory_test_analyte.v1`,
   `openEHR-EHR-CLUSTER.specimen.v1`, `openEHR-EHR-CLUSTER.device.v1`. No
   custom archetype is made (scope).
4. **HL7 Version 2** for the Afinion message
   (<https://www.hl7.org/implement/standards/product_brief.cfm?product_id=185>),
   at the version and message profile the Afinion 2 connectivity manual
   specifies. The Afinion 2 User Manual (1117346 Rev. A, 2023/02) is vendored
   in `docs/vendor/afinion/` (HL7 "based on HL7 version 2.4", no TLS); the HL7
   protocol data sheet is not yet (#209). Cite the vendored copy, never memory.

Cite the section in the PR for every conformance decision. Where no
specification governs a choice (retry timing, the client's caching), flag it:
"no openEHR spec governs this: our own design".

## FerroEHR client rules

- **One typed client** in `src/server/openehr/`, created once from
  configuration (`FERROEHR_BASE_URL` and its credentials, from the
  environment). Nothing else calls FerroEHR.
- **Only pseudonyms cross the boundary.** The EHR `subject_id` is the
  pseudonym of the test subject, with a fixed `subject_namespace`. No name,
  student number or e-mail address ever appears in a composition, an AQL
  query, a log line, or an error message (requirements, "Privacy"; risk
  analysis).
- **Compositions conform to the `eduLIMS-lab` operational template.** Every
  composition eduLIMS writes passes FerroEHR's template validation; a
  validation failure is a defect to fix in the mapping, never a field to drop
  (Q-COMP-1: "measurement data passes openEHR validation against the
  template `eduLIMS-lab`").
- **The sample ID is the key** that ties everything together. It
  goes in the specimen cluster's identifier, and the device cluster carries
  the analyser and its serial number, so every measurement traces to device,
  sample and student (principle "traceability", Q-TRACE-1).
- **AQL uses parameters.** Pass values through `query_parameters`
  (`WHERE … = $sample_id`); never interpolate a value into the AQL string
  (OWASP A05). Queries are named constants with a test against the template's
  paths.
- **Read your write:** after a composition write, the student sees the result
  through the AQL read path, so a test asserts the round trip (S4: "a
  correct Excel file reaches FerroEHR within 10 seconds"; S5: an Afinion
  measurement appears with the right sample within 1 minute).
- **Failure is loud and safe.** Map an unreachable FerroEHR or a 4xx/5xx
  answer to a typed error; show the user a translated message, never a stale or
  partial result as if it were complete. Timeouts are explicit.

## Health of the integrations (B3)

A periodic check reads FerroEHR and FerroBRIDGE health and records the
result, so the Admin portal shows an unreachable integration within 5 minutes
(B3 acceptance criterion). The check reads configuration, never a URL from a
request.

## Gen5 / Epoch 2 Excel upload (S4)

- The export template is fixed and agreed with the teachers: one row per well,
  with the sample ID per well. The parser accepts exactly that template and
  nothing looser (risk P-03: "the Gen5 export template cannot be pinned down unambiguously";
  measure: "the parser validates strictly").
- **Validation before any write:** every sample ID must exist in the
  practical and belong to the uploading student; every well position must be
  a real position on the plate (rows A to H, columns 1 to 12 on a 96-well
  plate); no empty or duplicate value where the template requires one. One
  failure rejects the whole file with a translated message per row; nothing reaches
  FerroEHR from a rejected file.
- A valid file is processed within 10 seconds (S4, "Performance"), and the
  upload is logged (B4) with the user id and the verdict.

## HL7 v2 from the Afinion 2

eduLIMS does not parse HL7 in the request path; FerroBRIDGE receives it over
MLLP and writes the composition. eduLIMS owns two things: the simulated HL7
messages in `tests/fixtures/` that the integration tests send to FerroBRIDGE
(the lab network may not route to the server network early, risk P-02), and the log view of HL7 messages and errors (B4), read from
FerroBRIDGE.
