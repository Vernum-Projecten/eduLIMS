<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Requirements

This document lists every requirement of eduLIMS with a stable ID. Code,
tests, issues and pull requests cite these IDs (for example `S4`, `Q-SEC-1`,
`R-06`, `K-03`). An ID is never reused: a dropped requirement keeps its row
with the status "Dropped".

The source is the owner's coursework, written in Dutch: the *Plan van Aanpak*
(PvA, sections 3.2, 3.3, 3.5 and 7.1) and the *Requirementsanalyse*. This
document translates them faithfully. A Dutch term is kept in parentheses where
it is the word users and the documents use.

## How to read this

- **Priority** uses MoSCoW: Must, Should, Could, Won't.
- **Acceptance criterion** is the test that shows the requirement is met, in
  a demo or an automated test. A requirement is done when its criterion is
  demonstrably met and the [Definition of Done](test-strategy.md#definition-of-done)
  holds.
- Criteria marked *(proposed)* are not in the Requirementsanalyse. The
  Requirementsanalyse wrote criteria for twelve Must requirements; the others
  are proposals that the product owner confirms in a sprint review.
- **Risk** refers to the risk table below.

The acceptance criteria and risk scores were proposed by the developer and are
validated with the product owner (Sophie de Klerk) in the sprint reviews and
with teachers and students in the interviews of the problem analysis.

## Roles

| Role | May | Sees |
|---|---|---|
| Student | register samples, upload Excel, submit the lab report | own practicals, own measurements, own grade next to the class and practical average |
| Teacher (docent) | set up a practical, protocol and rubric, link classes, check results, grade, record feedback and grade | all students, submissions and measurements of their own practicals; KPI dashboard per class |
| Administrator (beheerder) | manage users, classes and roles; manage analysers and integrations | logs, integration status, analyser usage |

## Functional requirements

### Student portal (Studentportaal)

| ID | Requirement | Priority | Acceptance criterion | Risk |
|---|---|---|---|---|
| S1 | Sign in with the Hanze account through OIDC (Microsoft Entra ID). | Must | A student signs in through Entra ID and lands in the student portal; without a valid account there is no access. | R-01 |
| S2 | View the practical assignment (practicumopdracht) and measurement protocol (meetprotocol). | Must | *(proposed)* A student linked to a practical sees its assignment, protocol and deadline; a student not linked to it gets no access. | R-01 |
| S3 | Register samples; eduLIMS creates a unique sample ID (monster-ID) for each sample. | Must | With 50 registered samples, all 50 sample IDs are unique. | |
| S4 | Upload a Gen5 export (Excel); the system validates sample IDs and well positions. | Must | An Excel file with an unknown sample ID or an invalid well position is rejected with a clear error message; a correct Excel file reaches FerroEHR within 10 seconds. | R-06 |
| S5 | Check the measurement results per sample (Afinion and Epoch). | Must | An Afinion measurement appears with the right sample in the student portal within 1 minute of measuring. | |
| S6 | Submit the lab report (labverslag) before a deadline. | Must | After sending, the submission is locked and the student can no longer change it (wish from the teacher interview). After the deadline the student can no longer submit; a submission gets a timestamp. | |
| S7 | View feedback and grade, with the own grade next to the practical average. | Must | The student sees their grade and feedback as soon as the teacher records the assessment, and sees only their own grade. | R-01, R-03 |
| S8 | See the status of a submission (draft, submitted, graded; concept, ingediend, beoordeeld). | Should | *(proposed)* Every submission shows one of the three statuses; the status changes to submitted when the student sends it and to graded when the teacher records the assessment. | |
| S9 | Submit a resit or a new version (herkansing). | Could | *(proposed)* When the teacher opens a resit, the student submits a new version; the earlier version stays readable and locked. | |

### Teacher portal (Docentportaal)

| ID | Requirement | Priority | Acceptance criterion | Risk |
|---|---|---|---|---|
| D1 | Create a practical with assignment, protocol, deadline and rubric. | Must | A teacher creates a practical with assignment, protocol, deadline and rubric in less than 10 minutes. | |
| D2 | Link classes or individual students to a practical. | Must | *(proposed)* A teacher links a class and one individual student to a practical; exactly those students see it in the student portal. | R-01 |
| D3 | View the measurement results of all students of a practical. | Must | A teacher sees the results of all their students, and not those of practicals of other teachers. | R-01 |
| D4 | Grade a submission per rubric criterion, with feedback and final grade. | Must | A score is recorded per rubric criterion; the final grade is calculated from the scores and cannot stay empty. | |
| D5 | KPI dashboard per class and per practical (see [KPIs](#kpis)). | Must | The dashboard shows the five KPIs with their norm on one page and loads within 2 seconds. | R-03, R-09 |
| D6 | Export grades (CSV) to copy into Portflow by hand. | Should | *(proposed)* The export holds one row per student with student number, name, practical and final grade, opens correctly in Excel, and covers only the teacher's own practicals. The export is logged. | |
| D7 | See deviating measured values flagged (plausibility check). | Could | *(proposed)* A value outside the expected range for its analyte is flagged with an icon and text, not colour alone. | R-09 |
| D8 | Reuse a rubric between practicals. | Could | *(proposed)* A teacher copies a rubric from an earlier practical; changing the copy does not change the original. | |

### Administration (Beheerportaal)

| ID | Requirement | Priority | Acceptance criterion | Risk |
|---|---|---|---|---|
| B1 | Create users and assign a role (student, teacher, administrator). | Must | An administrator assigns a role; the user immediately sees only the screens of that role. | R-01 |
| B2 | Create classes and link students to a class (by hand or by CSV import). | Must | *(proposed)* An administrator creates a class and links students by hand and through a CSV import; a CSV row with an unknown or duplicate student is reported and not imported. | |
| B3 | Register analysers and see the status of the integrations (FerroBRIDGE, FerroEHR). | Must | When FerroBRIDGE or FerroEHR is unreachable, the administrator sees that in the administration portal within 5 minutes. | |
| B4 | View the log of uploads, HL7 messages and errors. | Should | *(proposed)* Every upload, received HL7 message and integration error appears in the log with time, source and outcome, filterable by type. | |

### Won't

| ID | Requirement | Priority | Reason |
|---|---|---|---|
| W1 | Integration with Brightspace. | Won't | Decided 2026-09-29: grading stays in eduLIMS. |
| W2 | Integration with Portflow. | Won't | Teachers copy grades by hand; the CSV export (D6) helps. |
| W3 | Direct device link with the Epoch 2. | Won't | Gen5 does not speak HL7; the Excel upload (S4) is the route. |
| W4 | New, custom openEHR archetypes. | Won't | Only existing CKM archetypes are used. |
| W5 | Real patient data. | Won't | Only test data of volunteer subjects under a pseudonym. |

## Quality requirements

Classified by the ISO/IEC 25010 quality characteristics.

| ID | Characteristic | Requirement | Acceptance criterion |
|---|---|---|---|
| Q-SEC-1 | Security | Sign-in only through SSO; access per role. | A penetration test with the OWASP Top 10 checklist finds no endpoint that is open without sign-in. |
| Q-SEC-2 | Security | Every user sees only the data their role allows; the API filters on own data. | Tests with one account per role show no access outside the role: a student sees no data of others, a teacher only their own classes and practicals. |
| Q-SEC-3 | Security | HTTPS for all traffic; no measurement data outside the Hanze VNET. | All traffic is served over HTTPS; measurement data is stored only inside the Hanze network, or, if hosting moves to Azure, only in an EU region with GDPR agreements. |
| Q-SEC-4 | Security | No known critical vulnerabilities in dependencies or images. | The dependency and image scan in CI reports no known critical vulnerability; images are rebuilt at least monthly. |
| Q-SEC-5 | Security | No merge without review and green tests. | Branch rules require green CI and the merge queue; every merged pull request has a review by the supervising teacher (convention, see GOVERNANCE.md). |
| Q-PRIV-1 | Privacy | Only pseudonyms in FerroEHR. | The CDR holds no name or student number; the GDPR (AVG) check with the privacy officer is approved. |
| Q-PRIV-2 | Privacy | An average never reveals an individual grade. | An average is shown only from 5 assessments on. |
| Q-PRIV-3 | Privacy | AI tools and test environments never see real personal data. | The repository and the development and test databases hold only the pseudonymised test set. |
| Q-TRACE-1 | Traceability (herleidbaarheid) | Every measurement links through its sample ID to device, sample and student. | For any measurement in FerroEHR, eduLIMS shows the device, the sample and the student. |
| Q-REL-1 | Reliability | Available during practical hours. | During a practical week eduLIMS is reachable 99% of the practical hours; recovery within one working day. |
| Q-PERF-1 | Performance | Fast pages. | Pages load within 2 seconds. |
| Q-PERF-2 | Performance | Fast upload. | An Excel upload is processed within 10 seconds. |
| Q-ACC-1 | Accessibility | WCAG 2.1 level AA. | An axe check and a keyboard-only walkthrough find no errors at level A and AA. |
| Q-ACC-2 | Accessibility | Signals do not rely on colour alone. | Every status and deviation has an icon and text next to its colour. |
| Q-ACC-3 | Accessibility | Forms work with a screen reader. | Every form field has a label; axe and a keyboard test pass. |
| Q-MAINT-1 | Maintainability | Transferable to new developers. | Test coverage of the core is at least 70%; `CLAUDE.md` and the ArchiMate model are up to date. |
| Q-MAINT-2 | Maintainability | Runs as containers through Docker Compose. | The whole stack starts from the Compose file on a clean machine. |
| Q-SUST-1 | Sustainability (duurzaamheid) | Economical with compute. | Everything runs in one environment (one VM or one Azure environment); no unused service runs. |
| Q-COMP-1 | Compatibility | Open standards. | Afinion messages are HL7 v2; measurement data passes openEHR validation against the template `eduLIMS-lab`; reads use AQL. |

## Risks

### Product risks (Requirementsanalyse)

Scored on likelihood (L) and impact (I), from 1 (low) to 3 (high). The score
is L × I. A score of 4 or more gives a measure, and the measure is a
requirement.

| ID | Risk | Aspect | L | I | Score | Measure (requirement) |
|---|---|---|---|---|---|---|
| R-01 | A student sees grades or results of others. | Security | 2 | 3 | 6 | Access per role and a filter on own data in the API (S7, D3, Q-SEC-2). |
| R-02 | Real personal data ends up in FerroEHR. | Privacy | 1 | 3 | 3 | Pseudonyms only; GDPR check before use (Q-PRIV-1). |
| R-03 | An average reveals an individual grade. | Privacy | 2 | 2 | 4 | Show averages only from 5 assessments on (Q-PRIV-2). |
| R-04 | Measurement data ends up somewhere without proper agreements (for example a cloud region outside the EU). | Security | 1 | 3 | 3 | Local inside the Hanze network, or in Azure only in an EU region with GDPR agreements (Q-SEC-3). |
| R-05 | A vulnerable library in a container. | Security | 2 | 2 | 4 | Scan dependencies in the pipeline; update images monthly (Q-SEC-4). |
| R-06 | Unknown sample ID in an Excel upload. | Data quality | 3 | 2 | 6 | The upload validates sample ID and well position (S4). |
| R-07 | The AI coding assistant writes insecure code. | Security | 2 | 2 | 4 | No merge without review and green tests (Q-SEC-5). |
| R-08 | Unnecessary energy use from separate services. | Sustainability | 2 | 1 | 2 | One environment; unused containers off (Q-SUST-1). |
| R-09 | A colour-blind or visually impaired user cannot read the dashboard. | Accessibility | 2 | 2 | 4 | Signals with icon and text, not colour alone; WCAG 2.1 AA (Q-ACC-2). |
| R-10 | A screen reader cannot use the forms. | Accessibility | 2 | 2 | 4 | Labels on all fields; test with axe and keyboard (Q-ACC-3). |

The highest risks are R-01 and R-06. Access per role and upload validation are
therefore Must items in the backlog.

### Project risks (PvA 7.1)

| ID | Risk | Likelihood | Impact | Measure |
|---|---|---|---|---|
| P-01 | The VM, VNET or Entra app registration is delayed. | High | High | Request immediately; develop locally with Docker Compose; temporary local sign-in. |
| P-02 | The lab network does not route to the VNET (the Afinion cannot reach FerroBRIDGE). | Medium | High | Test early with Hanze ICT; simulate HL7 messages. |
| P-03 | The Gen5 export template cannot be pinned down unambiguously. | Medium | Medium | Fix the template together with a teacher; the parser validates strictly. |
| P-04 | Limited availability of LifeScience teachers and students. | Medium | Medium | Plan interviews and tests early; arrange through the client. |
| P-05 | Real personal data enters the system after all. | Low | High | Pseudonyms only; GDPR check with the privacy officer. |
| P-06 | Individual project: no replacement in case of illness. | Medium | Medium | Guard the scope with MoSCoW; drop Could items when time runs short. |
| P-07 | Criteria for the learning outcomes Realiseren and Manage & Control are still unknown. | Medium | Medium | Adjust the deliverables once the criteria are known. |

## KPIs

The PvA (3.5) lists nine KPIs: three decided in the architecture model, six
proposed. The KPI dashboard design ([kpi-dashboard.md](kpi-dashboard.md),
iteration 2) then narrowed the teacher dashboard to five KPIs, each with a
norm, using the Balanced Scorecard. The norms are proposals to be set with the
teachers.

| ID | KPI | Calculation | Level | Seen by | Status (PvA) | On the dashboard (iteration 2) |
|---|---|---|---|---|---|---|
| K-01 | Average grade (gemiddeld cijfer) | Mean of the final grades | per class and per practical | Teacher | Decided | Yes, norm ≥ 6.0 |
| K-02 | Progress (voortgang) | Number submitted, graded and not yet submitted | per class and per practical | Teacher | Decided | Chart "Progress per class" |
| K-03 | Own grade against average | Student's grade next to the class and practical average | per student | Student | Decided | Student portal only |
| K-04 | Grade distribution and pass rate (cijferverdeling, voldoendes) | Spread and percentage of passing grades | per class and per practical | Teacher | Proposal | Yes, pass rate norm ≥ 70% |
| K-05 | Late submissions (te laat ingeleverd) | Submissions after the deadline | per class | Teacher | Proposal | Yes, as "Submitted before deadline", norm 100% at the deadline |
| K-06 | Open grading work and grading time (nakijktijd) | Submissions waiting for grading, and working days between submitting and grading | per teacher | Teacher | Proposal | Yes, grading time norm ≤ 5 working days |
| K-07 | Score per rubric criterion | Mean score per criterion, so weak parts stand out | per class and per practical | Teacher | Proposal | Chart "Score per rubric criterion" |
| K-08 | Measurement quality (meetkwaliteit) | Share of measurements outside the expected range or remeasured | per class and per practical | Teacher | Proposal | Yes, norm ≤ 15% |
| K-09 | Analyser usage | Measurements per device per week | per device | Administrator | Proposal | No; administration portal |

K-01 to K-07 are calculated with SQL on the assessment records in the eduLIMS
database. K-08 and K-09 read measurement data from FerroEHR with AQL. No other
data source is needed.

## Traceability

| Requirement | Architecture | Test level ([test-strategy.md](test-strategy.md)) |
|---|---|---|
| S1, B1, Q-SEC-1, Q-SEC-2 | [Portals and roles](architecture.md#portals-and-roles), [ADR 0005](adr/0005-better-auth-entra-id.md) | security, integration |
| S3, S4, S5, Q-TRACE-1 | [Integrations](architecture.md#context-and-integrations), [Data](architecture.md#data) | data, integration |
| S6, S7, D1 to D4 | [Data](architecture.md#data) | unit, acceptance |
| D5, K-01 to K-09 | [kpi-dashboard.md](kpi-dashboard.md) | unit, performance, user test |
| Q-ACC-* | [Quality](architecture.md#quality-requirements) | accessibility |
