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

Measurements arrive by two analyser routes, a team releases a result to the
patient's record in FerroEHR, and eduLIMS reads back by one route
([lims-workflow.md](../../docs/lims-workflow.md),
[architecture.md](../../docs/architecture.md#context-and-integrations)):

| Route | From, to | Standard | What eduLIMS builds |
|---|---|---|---|
| Afinion 2 | analyser to FerroBRIDGE to FerroEHR | HL7 v2 over MLLP, then openEHR REST | nothing in code: FerroBRIDGE configuration and its mapping to the `eduLIMS-lab` template |
| Epoch 2 | Gen5 Excel export, uploaded in the Student portal | the fixed Gen5 export layout | the upload, the parser and the layout validation, the plate view of the 96 values, and the team's link from a well to a sample (S4); the concentration, entered by the team or calculated by eduLIMS from the standards and blanks, as the teacher chose for the test (D9, S4) |
| Release | eduLIMS to FerroEHR | openEHR REST | the result in the patient's record when the team releases it (S15); the result of a control request, which has no patient, goes to the control log of the team and never to a patient's record (S16) |
| Read | eduLIMS from FerroEHR | AQL through the openEHR REST Query API | the queries for the samples of a team |

Per test the teacher sets where a measurement comes from: the Afinion 2, the
Epoch 2 upload or entry by hand (D9). A result calculated from other results
is a test with entry by hand. Every result is a number with a unit; a result
that is not a number stays outside eduLIMS (W8). Every measurement is a row
in the eduLIMS database and the release names one of them
(`src/server/results/`, #270); in FerroEHR a measurement is Preliminary and
the released one Final (#148). A released result is final (S15). A released
control result is stored in the eduLIMS database only and never reaches
FerroEHR (#270).

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
   specifies. Two Abbott documents are vendored in `docs/vendor/afinion/`:
   the Afinion 2 User Manual (1117346 Rev. A, 2023/02) and the Afinion 2 HL7
   Connectivity Protocol v4.0 (25.01.2021), which defines the ORU^R01, its
   segments and fields and the ACK. `PROVENANCE.md` there lists what each
   settles, by section. Cite the vendored copy by section, never memory.

Cite the section in the PR for every conformance decision. Where no
specification governs a choice (retry timing, the client's caching), flag it:
"no openEHR spec governs this: our own design".

## FerroEHR client rules

- **One typed client** in `src/server/openehr/`, created once from
  configuration (`FERROEHR_BASE_URL` and its credentials, from the
  environment). Nothing else calls FerroEHR.
- **One identity: a SMART on openEHR backend service**
  ([ADR 0019](../../docs/adr/0019-smart-backend-service.md)). eduLIMS is the
  OAuth 2.0 client `edulims-ferroehr`, takes its token with the client
  credentials grant, and holds `system/` scopes only: no user token and no
  `user/` or `patient/` scope ever reaches FerroEHR. It asks for the narrowest
  scopes that work: `system/template-*.r` for the templates,
  `system/composition-*.cr` for the EHR of a patient and its compositions,
  and one `system/aql-<name>.s` per named stored query, never
  `system/aql-*`, so it runs named stored queries, never ad-hoc AQL. The
  composition scope is the bare wildcard because an EHR operation names no
  template, and FerroEHR covers it only with `*` (FerroEHR book v5.7.0,
  `smart-app-launch.md`, "What each route requires"); the system client's
  `writes` still limits its compositions to `eduLIMS-lab.v1`. eduLIMS checks session, role
  and ownership before every call, because FerroEHR sees only the client.
- **No real person crosses the boundary (Q-PRIV-1).** FerroEHR holds the
  fictional patients of a simulation: the EHR is the patient's, with the fictional
  details the team registered from the form (S11; O9, answered 2026-11-19).
  No student's or teacher's name, student number or e-mail address ever
  appears in a composition, an EHR subject, an AQL query, a log line, or an
  error message.
- **Nothing a student may not see crosses either.** A composition holds no
  correct value, no tolerance and no accuracy status
  (`docs/lims-workflow.md`); those stay in the eduLIMS database.
- **Compositions conform to the `eduLIMS-lab` operational template.** Every
  composition eduLIMS writes passes FerroEHR's template validation; a
  validation failure is a defect to fix in the mapping, never a field to drop
  (Q-COMP-1: "measurement data passes openEHR validation against the
  template `eduLIMS-lab`").
- **The sample number from the request form ties the chain together.** It
  goes in the specimen cluster's identifier, and the device cluster carries
  the analyser and its serial number, so every measurement traces to device,
  sample, patient and team (Q-TRACE-1). The sample number alone does not
  name the team, because every team works the same numbers (R-11). The lab
  number eduLIMS gives the sample (S12) does: it is unique across the teams
  of every simulation.
- **AQL uses parameters.** Pass values through `query_parameters`
  (`WHERE … = $sample_number`); never interpolate a value into the AQL string
  (OWASP A05). Queries are named constants with a test against the template's
  paths.
- **Read your write:** after a release, the team sees the result through the
  AQL read path, so a test asserts the round trip (S15: "the result is in the
  patient's record in FerroEHR"; S5: an Afinion measurement appears with the
  right sample in the team's work within 1 minute).
- **Failure is loud and safe.** Map an unreachable FerroEHR or a 4xx/5xx
  answer to a typed error; show the user a translated message, never a stale or
  partial result as if it were complete. Timeouts are explicit.

## Health of the integrations (B3)

A periodic check reads FerroEHR and FerroBRIDGE health and records the
result, so the Admin portal shows an unreachable integration within 5 minutes
(B3 acceptance criterion). The check reads configuration, never a URL from a
request.

## Gen5 / Epoch 2 Excel upload (S4)

- The export is one sheet (`docs/lims-workflow.md`): a header block (software
  version, date, time, reader type and serial number, plate type, read type,
  wavelength, temperature) and a 96-well grid, rows A to H and columns 1 to
  12, of absorbance values at one wavelength. The parser accepts exactly that
  layout and nothing looser (risk P-03: "the Gen5 export template cannot be
  pinned down unambiguously"; measure: "the parser validates strictly").
- **The export holds no sample number, no plate layout and no
  concentration.** The upload therefore checks the file type, the size and
  the layout, loads the 96 values and shows the team the plate, as a real
  LIMS does (S4). It cannot check a sample against the file.
- **The team links wells to samples** (S4; owner, 2026-11-19, O5): the team
  says which well holds which sample, and the server checks that each sample
  belongs to that team. A link names the sample by its lab number, never by
  the sample number from the form, and one well holds one sample.
  `checkPlateLinks` (`src/server/upload/plate-links.ts`) is the one check:
  wells A1 to H12 only, one value per well, values as exact decimals within
  9 digits before the point and 6 after, and every refusal a typed code with
  its well (`docs/gen5-export.md`, "The check of the plate and the links").
- **Who calculates the concentration is the teacher's choice per test** (D9,
  S4; owner, 2026-11-19, O5): the team calculates by its own procedure and
  enters the result, or eduLIMS calculates it from the standards and blanks
  the team marked on the plate and shows the calibration line it used. The
  calculation is one tested function in `src/lib/`, it uses only what the
  team entered, and never a correct value. The calibration model is not
  decided: ask before picking one.
- **Validation before anything is kept:** a file in another layout is
  rejected whole with a translated message that names the reason (S4);
  nothing reaches FerroEHR from a rejected file.
- A valid file is read and its values are shown to the team within 10
  seconds (S4, Q-PERF-2), and the upload is logged (B4) with the user id and
  the verdict.

## HL7 v2 from the Afinion 2

eduLIMS does not parse HL7 in the request path; FerroBRIDGE receives it over
MLLP and writes the composition. eduLIMS owns two things: the simulated HL7
messages in `tests/fixtures/` that the integration tests send to FerroBRIDGE
(the lab network may not route to the server network early, risk P-02), and the log view of HL7 messages and errors (B4), read from
FerroBRIDGE.

- **An Afinion result finds its team through the patient ID** (S5; owner,
  2026-11-19, O13). The team enters the sample's lab number (S12) as the
  patient ID on the analyser. Every team works the same sample numbers, so
  the sample number never links a result on its own (R-11). The lab
  number is ten decimal digits, the last a check digit by the Damm algorithm,
  which catches a wrong digit and a swap of two neighbours (#268); the patient ID field takes up to 16 characters
  (`docs/lims-workflow.md`).
- **The entered patient ID goes out in PID-3 or in PV1-19**, as set on the
  analyser (protocol §3.5, §3.6: "configurable, to use PID or
  visitnumber"), and a message carries one patient ID. OBX-16 carries the
  operator ID, OBX-18 the analyser's serial number and MSH-11 `P` or `Q` for
  a patient or a quality control result (§3.2, §3.8). The deployment
  documents which of PID-3 and PV1-19 the analysers are set to, and the
  matching rule reads that one field.
- A result that eduLIMS cannot link to a team's sample is never attached to
  one: it is logged and shown to administrators (#163).
