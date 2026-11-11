<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Requirements

> **Status: working draft.** These requirements are not final. Priorities,
> acceptance criteria, KPIs and even the requirements themselves are still
> under discussion with the product owner, teachers and students, and will
> change. Treat every row as the current proposal, not a commitment: when a
> requirement is unclear, missing, or conflicts with what is being built,
> raise it with the owner instead of implementing it as settled.

This document lists the current draft requirements of eduLIMS, each with a stable ID. Code,
tests, issues and pull requests cite these IDs (for example `S4`, `Q-SEC-1`,
`R-06`, `K-03`). An ID is never reused: a dropped requirement keeps its row
with the status "Dropped".

The requirements are being re-evaluated with the product owner. Until that is
done, the rows below are the starting point, not the outcome.

## How to read this

- **Priority** uses MoSCoW: Must, Should, Could, Won't.
- **Acceptance criterion** is the test that shows the requirement is met, in
  a demo or an automated test. A requirement is done when its criterion is
  demonstrably met and the [Definition of Done](test-strategy.md#definition-of-done)
  holds.
- Criteria marked *(proposed)* have not yet been reviewed with the product
  owner; the product owner confirms them in a milestone review.
- **Risk** refers to the risk table below.

The acceptance criteria and risk scores were proposed by the maintainer and are
validated with the product owner in the milestone reviews and with teachers
and students in interviews and user tests.

## Roles

| Role | May | Sees |
|---|---|---|
| Student | register samples, upload Excel, submit the lab report | own practicals, own measurements, own grade next to the class and practical average |
| Teacher | set up a practical, protocol and rubric, link classes, check results, grade, record feedback and grade | all students, submissions and measurements of their own practicals; KPI dashboard per class |
| Administrator | manage users, classes and roles; manage analysers and integrations | logs, integration status, analyser usage |

## Functional requirements

### Student portal

| ID | Requirement | Priority | Acceptance criterion | Risk |
|---|---|---|---|---|
| S1 | Sign in with the institution account through OIDC (Microsoft Entra ID or Keycloak). | Must | A student signs in through the institution's identity provider and lands in the student portal; without a valid account there is no access. | R-01 |
| S2 | View the practical assignment and measurement protocol. | Must | *(proposed)* A student linked to a practical sees its assignment, protocol and deadline; a student not linked to it gets no access. | R-01 |
| S3 | Register samples; eduLIMS creates a unique sample ID for each sample. | Must | With 50 registered samples, all 50 sample IDs are unique. | |
| S4 | Upload a Gen5 export (Excel); the system validates sample IDs and well positions. | Must | An Excel file with an unknown sample ID or an invalid well position is rejected with a clear error message; a correct Excel file reaches FerroEHR within 10 seconds. | R-06 |
| S5 | Check the measurement results per sample (Afinion and Epoch). | Must | An Afinion measurement appears with the right sample in the student portal within 1 minute of measuring. | |
| S6 | Submit the lab report before a deadline. | Must | After sending, the submission is locked and the student can no longer change it. After the deadline the student can no longer submit; a submission gets a timestamp. | |
| S7 | View feedback and grade, with the own grade next to the practical average. | Must | The student sees their grade and feedback as soon as the teacher records the assessment, and sees only their own grade. | R-01, R-03 |
| S8 | See the status of a submission (draft, submitted, graded). | Should | *(proposed)* Every submission shows one of the three statuses; the status changes to submitted when the student sends it and to graded when the teacher records the assessment. | |
| S9 | Submit a resit or a new version. | Could | *(proposed)* When the teacher opens a resit, the student submits a new version; the earlier version stays readable and locked. | |

### Teacher portal

| ID | Requirement | Priority | Acceptance criterion | Risk |
|---|---|---|---|---|
| D1 | Create a practical with assignment, protocol, deadline and rubric. | Must | A teacher creates a practical with assignment, protocol, deadline and rubric in less than 10 minutes. | |
| D2 | Link classes or individual students to a practical. | Must | *(proposed)* A teacher links a class and one individual student to a practical; exactly those students see it in the student portal. | R-01 |
| D3 | View the measurement results of all students of a practical. | Must | A teacher sees the results of all their students, and not those of practicals of other teachers. | R-01 |
| D4 | Grade a submission per rubric criterion, with feedback and final grade. | Must | A score is recorded per rubric criterion; the final grade is calculated from the scores and cannot stay empty. | |
| D5 | KPI dashboard per class and per practical (see [KPIs](#kpis)). | Must | The dashboard shows the five KPIs with their norm on one page and loads within 2 seconds. | R-03, R-09 |
| D6 | Export grades (CSV) for use in an external grade-book system. | Should | *(proposed)* The export holds one row per student per practical with the final grade, opens correctly in Excel, and covers only the teacher's own practicals. The export is logged. | |
| D7 | See deviating measured values flagged (plausibility check). | Could | *(proposed)* A value outside the expected range for its analyte is flagged with an icon and text, not colour alone. | R-09 |
| D8 | Reuse a rubric between practicals. | Could | *(proposed)* A teacher copies a rubric from an earlier practical; changing the copy does not change the original. | |

### Admin portal

| ID | Requirement | Priority | Acceptance criterion | Risk |
|---|---|---|---|---|
| B1 | Create users and assign a role (student, teacher, administrator). | Must | An administrator assigns a role; the user immediately sees only the screens of that role. | R-01 |
| B2 | Create classes and link students to a class (by hand or by CSV import). | Must | *(proposed)* An administrator creates a class and links students by hand and through a CSV import; a CSV row with an unknown or duplicate student is reported and not imported. | |
| B3 | Register analysers and see the status of the integrations (FerroBRIDGE, FerroEHR). | Must | When FerroBRIDGE or FerroEHR is unreachable, the administrator sees that in the admin portal within 5 minutes. | |
| B4 | View the log of uploads, HL7 messages and errors. | Should | *(proposed)* Every upload, received HL7 message and integration error appears in the log with time, source and outcome, filterable by type. | |

### Won't

| ID | Requirement | Priority | Reason |
|---|---|---|---|
| W1 | Integration with a learning management system. | Won't | Out of scope: grading stays in eduLIMS. |
| W2 | Integration with an external grade-book system. | Won't | Out of scope; the CSV export (D6) covers the need. |
| W3 | Direct device link with the Epoch 2. | Won't | Gen5 does not speak HL7; the Excel upload (S4) is the route. |
| W4 | New, custom openEHR archetypes. | Won't | Only existing CKM archetypes are used. |
| W5 | Real patient data. | Won't | Only test data of volunteer subjects under a pseudonym. |

## Quality requirements

Classified by the ISO/IEC 25010 quality characteristics.

| ID | Characteristic | Requirement | Acceptance criterion |
|---|---|---|---|
| Q-SEC-1 | Security | Sign-in only through SSO; access per role. | A penetration test with the OWASP Top 10 checklist finds no endpoint that is open without sign-in. |
| Q-SEC-2 | Security | Every user sees only the data their role allows; the API filters on own data. | Tests with one account per role show no access outside the role: a student sees no data of others, a teacher only their own classes and practicals. |
| Q-SEC-3 | Security | HTTPS for all traffic; no measurement data outside the institution's network. | All traffic is served over HTTPS; measurement data is stored only inside the institution's network, or, if hosting moves to Azure, only in an EU region with GDPR agreements. |
| Q-SEC-4 | Security | No known critical vulnerabilities in dependencies or images. | The dependency and image scan in CI reports no known critical vulnerability; images are rebuilt at least monthly. |
| Q-SEC-5 | Security | No merge without green tests; every change is reviewed by a person. | Branch rules require green CI and the merge queue. Review by a person is a convention, not a branch rule: the rules require no approval, so a pull request can auto-merge on green CI (see GOVERNANCE.md). |
| Q-PRIV-1 | Privacy | Only pseudonyms in FerroEHR. | The CDR holds no name or student number; the GDPR check with the institution's privacy officer is approved. |
| Q-PRIV-2 | Privacy | An average never reveals an individual grade. | An average is shown only from 5 assessments on. |
| Q-PRIV-3 | Privacy | AI tools and test environments never see real personal data. | The repository and the development and test databases hold only the pseudonymised test set. |
| Q-TRACE-1 | Traceability | Every measurement links through its sample ID to device, sample and student. | For any measurement in FerroEHR, eduLIMS shows the device, the sample and the student. |
| Q-REL-1 | Reliability | Available during practical hours. | During a practical week eduLIMS is reachable 99% of the practical hours; recovery within one working day. |
| Q-PERF-1 | Performance | Fast pages. | Pages load within 2 seconds. |
| Q-PERF-2 | Performance | Fast upload. | An Excel upload is processed within 10 seconds. |
| Q-ACC-1 | Accessibility | WCAG 2.1 level AA. | An axe check and a keyboard-only walkthrough find no errors at level A and AA. |
| Q-ACC-2 | Accessibility | Signals do not rely on colour alone. | Every status and deviation has an icon and text next to its colour. |
| Q-ACC-3 | Accessibility | Forms work with a screen reader. | Every form field has a label; axe and a keyboard test pass. |
| Q-MAINT-1 | Maintainability | Transferable to new developers. | Test coverage of the core is at least 70%; `CLAUDE.md` and the architecture documentation are up to date. |
| Q-MAINT-2 | Maintainability | Runs as containers through Docker Compose. | The whole stack starts from the Compose file on a clean machine. |
| Q-SUST-1 | Sustainability | Economical with compute. | Everything runs in one environment (one VM or one Azure environment); no unused service runs. |
| Q-COMP-1 | Compatibility | Open standards. | Afinion messages are HL7 v2; measurement data passes openEHR validation against the template `eduLIMS-lab`; reads use AQL. |

## Risks

### Product risks

Scored on likelihood (L) and impact (I), from 1 (low) to 3 (high). The score
is L × I. A score of 4 or more gives a measure, and the measure is a
requirement.

| ID | Risk | Aspect | L | I | Score | Measure (requirement) |
|---|---|---|---|---|---|---|
| R-01 | A student sees grades or results of others. | Security | 2 | 3 | 6 | Access per role and a filter on own data in the API (S7, D3, Q-SEC-2). |
| R-02 | Real personal data ends up in FerroEHR. | Privacy | 1 | 3 | 3 | Pseudonyms only; GDPR check before use (Q-PRIV-1). |
| R-03 | An average reveals an individual grade. | Privacy | 2 | 2 | 4 | Show averages only from 5 assessments on (Q-PRIV-2). |
| R-04 | Measurement data ends up somewhere without proper agreements (for example a cloud region outside the EU). | Security | 1 | 3 | 3 | Local inside the institution's network, or in Azure only in an EU region with GDPR agreements (Q-SEC-3). |
| R-05 | A vulnerable library in a container. | Security | 2 | 2 | 4 | Scan dependencies in the pipeline; update images monthly (Q-SEC-4). |
| R-06 | Unknown sample ID in an Excel upload. | Data quality | 3 | 2 | 6 | The upload validates sample ID and well position (S4). |
| R-07 | The AI coding assistant writes insecure code. | Security | 2 | 2 | 4 | No merge without green tests; review by a person by convention (Q-SEC-5). |
| R-08 | Unnecessary energy use from separate services. | Sustainability | 2 | 1 | 2 | One environment; unused containers off (Q-SUST-1). |
| R-09 | A colour-blind or visually impaired user cannot read the dashboard. | Accessibility | 2 | 2 | 4 | Signals with icon and text, not colour alone; WCAG 2.1 AA (Q-ACC-2). |
| R-10 | A screen reader cannot use the forms. | Accessibility | 2 | 2 | 4 | Labels on all fields; test with axe and keyboard (Q-ACC-3). |

The highest risks are R-01 and R-06. Access per role and upload validation are
therefore Must requirements.

### Project risks

| ID | Risk | Likelihood | Impact | Measure |
|---|---|---|---|---|
| P-01 | The VM, network or identity provider registration is delayed. | High | High | Request immediately; develop locally with Docker Compose; temporary local sign-in. |
| P-02 | The lab network does not route to the server network (the Afinion cannot reach FerroBRIDGE). | Medium | High | Test early with the institution's IT department; simulate HL7 messages. |
| P-03 | The Gen5 export template cannot be pinned down unambiguously. | Medium | Medium | Fix the template together with a teacher; the parser validates strictly. |
| P-04 | Limited availability of teachers and students for interviews and tests. | Medium | Medium | Plan interviews and tests early; arrange through the product owner. |
| P-05 | Real personal data enters the system after all. | Low | High | Pseudonyms only; GDPR check with the institution's privacy officer. |
| P-06 | Single maintainer: no replacement in case of absence. | Medium | Medium | Guard the scope with MoSCoW; drop Could items when time runs short. |
| P-07 | Dropped. | | | No longer applies. |

## KPIs

There are nine KPIs: three decided, six proposed. The KPI dashboard design ([kpi-dashboard.md](kpi-dashboard.md),
iteration 2) then narrowed the teacher dashboard to five KPIs, each with a
norm, using the Balanced Scorecard. The norms are proposals to be set with the
teachers.

| ID | KPI | Calculation | Level | Seen by | Status | On the dashboard (iteration 2) |
|---|---|---|---|---|---|---|
| K-01 | Average grade | Mean of the final grades | per class and per practical | Teacher | Decided | Yes, norm ≥ 6.0 |
| K-02 | Progress | Number submitted, graded and not yet submitted | per class and per practical | Teacher | Decided | Chart "Progress per class" |
| K-03 | Own grade against average | Student's grade next to the class and practical average | per student | Student | Decided | Student portal only |
| K-04 | Grade distribution and pass rate | Spread and percentage of passing grades | per class and per practical | Teacher | Proposal | Yes, pass rate norm ≥ 70% |
| K-05 | Late submissions | Submissions after the deadline | per class | Teacher | Proposal | Yes, as "Submitted before deadline", norm 100% at the deadline |
| K-06 | Open grading work and grading time | Submissions waiting for grading, and working days between submitting and grading | per teacher | Teacher | Proposal | Yes, grading time norm ≤ 5 working days |
| K-07 | Score per rubric criterion | Mean score per criterion, so weak parts stand out | per class and per practical | Teacher | Proposal | Chart "Score per rubric criterion" |
| K-08 | Measurement quality | Share of measurements outside the expected range or remeasured | per class and per practical | Teacher | Proposal | Yes, norm ≤ 15% |
| K-09 | Analyser usage | Measurements per device per week | per device | Administrator | Proposal | No; admin portal |

K-01 to K-07 are calculated with SQL on the assessment records in the eduLIMS
database. K-08 and K-09 read measurement data from FerroEHR with AQL. No other
data source is needed.

## Traceability

| Requirement | Architecture | Test level ([test-strategy.md](test-strategy.md)) |
|---|---|---|
| S1, B1, Q-SEC-1, Q-SEC-2 | [Portals and roles](architecture.md#portals-and-roles), [ADR 0005](adr/0005-better-auth-entra-id.md), [ADR 0010](adr/0010-vendor-neutral-oidc-entra-and-keycloak.md) | security, integration |
| S3, S4, S5, Q-TRACE-1 | [Integrations](architecture.md#context-and-integrations), [Data](architecture.md#data) | data, integration |
| S6, S7, D1 to D4 | [Data](architecture.md#data) | unit, acceptance |
| D5, K-01 to K-09 | [kpi-dashboard.md](kpi-dashboard.md) | unit, performance, user test |
| Q-ACC-* | [Quality](architecture.md#quality-requirements) | accessibility |
