<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Requirements

> **Status: working draft.** These requirements are not final. Priorities,
> acceptance criteria, the dashboard measures and even the requirements
> themselves are still under discussion with the product owner, teachers and
> students, and will change. Treat every row as the current proposal, not a
> commitment: when a requirement is unclear, missing, or conflicts with what
> is being built, raise it with the owner instead of implementing it as
> settled.

eduLIMS is the LIMS of a workplace simulation. Each team of students runs a
simulated clinical laboratory, its lab: requests arrive on paper, the team
registers the patients and their samples, measures, and releases each result
to the patient's record. The labs compete on turnaround time and on accuracy,
and teachers follow every lab live. The owner set this direction on 2026-11-19
([ADR 0020](adr/0020-workplace-simulation.md)); it replaces the earlier model
of practicals with a lab report, a rubric and a grade.

This document lists the current draft requirements, each with a stable ID.
Code, tests, issues and pull requests cite these IDs (for example `S15`,
`Q-SEC-1`, `R-11`, `G-02`). An ID is never reused: a dropped requirement
keeps its row with the status "Dropped".

## How to read this

- **Priority** uses MoSCoW: Must, Should, Could, Won't.
- **Acceptance criterion** is the test that shows the requirement is met, in
  a demo or an automated test. A requirement is done when its criterion is
  demonstrably met and the [Definition of Done](test-strategy.md#definition-of-done)
  holds.
- Criteria marked *(proposed)* have not yet been reviewed with the product
  owner; the product owner confirms them in a milestone review.
- **Open** in a row names a question in [Open questions](#open-questions).
  The row states what the owner said; the open part is never filled in with
  a guess, and nothing is built on it until the owner answers.
- **Risk** refers to the risk table below.

## Terms

| Term | Meaning |
|---|---|
| Simulation | One edition of the workplace simulation, with a name of its own (for example "Simulation 2026"): its correct values and its labs. It belongs to no class. Earlier drafts called it a game. |
| Lab | A team of students that runs one laboratory in a simulation, under the lab name and the logo the team made up. A teacher creates the labs. A lab normally has six students; eduLIMS sets no limit. Students always work in a lab, and the labs compete with each other. "Team" in this document means the students of one lab. |
| Patient | A fictional person a request is for. The team registers the patient from the paper form. |
| Request | The tests a requester asks for, on a paper request form: for one patient, or for a control sample that has no patient. |
| Sample | The material of a request (blood, urine), identified by the sample number printed on the form. |
| Lab number | The number eduLIMS gives a team's sample when the team records it. It is unique across the teams of every simulation, so it names one team's sample where the sample number on the form cannot. |
| Test | One determination from the test catalogue (for example glucose), with its unit and material. |
| Measurement | One measured value for a test on a sample, from an analyser or an upload. A team can measure several times. |
| Result | The measurement the team releases to the patient's record. Releasing is final for the clock. |
| Tolerance | The limits a team sets for a test before measuring: its measurements must fall between them. |
| Correct value | The value a teacher enters beforehand for a test on a sample. Students never see it. |

## Roles

| Role | May | Sees |
|---|---|---|
| Student | with the team: register patients, record requests and samples, set tolerances, upload the Epoch export, measure again, release results | the work of their own team only; never a correct value or another team's work |
| Teacher | manage the test catalogue, prepare a simulation with its labs and its correct values, follow the teams | every team of their own simulations: times, measurements, released results and accuracy |
| Administrator | manage users and roles; manage analysers and integrations | logs, integration status, analyser usage |

## Functional requirements

### Student portal

| ID | Requirement | Priority | Acceptance criterion | Risk |
|---|---|---|---|---|
| S1 | Sign in with the institution account through OIDC (Microsoft Entra ID or Keycloak). | Must | A student signs in through the institution's identity provider and lands in the student portal; without a valid account there is no access. | R-01 |
| S4 | Upload the Gen5 export of the Epoch 2 (Excel) by drag and drop; eduLIMS loads the plate and shows its values, as a real LIMS does. The team links wells to samples. The concentration is calculated by the team or by eduLIMS, as the teacher chose for the test (D9). Revised 2026-11-19. | Must | *(proposed)* A file in the supplied export layout (a header block and a 96-well grid of absorbance values at one wavelength) is read and its 96 values are shown to the team as a plate within 10 seconds; a file in another layout is rejected with a clear error message. For a test the team calculates, the team enters the result and eduLIMS keeps the wells it came from. For a test eduLIMS calculates, the team marks the standards and blanks and eduLIMS shows the calibration line and the concentration per sample. When eduLIMS calculates, it subtracts the blank and fits a straight line through the standards; a sample outside the range of the standards gets no number but the message that it is outside the range. | R-06 |
| S5 | See the measurements per sample (Afinion 2 and Epoch 2). Revised 2026-11-19. | Must | An Afinion measurement appears with the right sample in the team's work within 1 minute of measuring. The measurement finds its team through the patient ID the team enters on the Afinion 2 (owner, 2026-11-19): that value is the lab number of S12. | R-11 |
| S10 | Work in a lab: every member works in the shared patients, requests, samples and results of their lab. A student is linked to their lab at sign-in. | Must | *(proposed)* A student who signs in with an email address a teacher added to a lab lands in that lab without doing anything; a student whose address is unknown joins with the lab's code. Two members of one lab see the same work under its name and logo; a student of another lab sees none of it. Open: team roles (O10). | R-01 |
| S11 | Register a patient from the paper request form. | Must | *(proposed)* The team registers a patient with the details on the form (name, date of birth, sex, patient ID); eduLIMS fills in or corrects nothing for them. The patient's record in FerroEHR carries those fictional details (owner, 2026-11-19). | |
| S12 | Record a request for a patient as it stands on the form: the requester, the requested tests, whether the result must be phoned through, the remarks, and the samples with the sample number and material. eduLIMS gives each sample a lab number that is unique across the teams. | Must | *(proposed)* The team records a request with its tests and links each sample by its sample number; eduLIMS logs the time of entry on the server and shows the sample's lab number. Two teams that record the same sample number get different lab numbers. An urgent request is not built in this iteration (D12). | R-12 |
| S13 | Set the team's own tolerances per test before measuring. | Must | *(proposed)* The team enters a lower and an upper limit per test; the limits are the team's own and no other team sees them. Open: O6. | |
| S14 | Measure a sample again: a requested test can have several measurements before a result is released. | Must | *(proposed)* A second measurement for the same test and sample is kept beside the first, and the team sees both. |  |
| S15 | Release a result to the patient's record. Before the release, eduLIMS warns when the value is outside the team's own tolerance. A released result is final. | Must | *(proposed)* The team picks one measurement and releases it; eduLIMS logs the time of release on the server, and the result is in the patient's record in FerroEHR. A value outside the team's tolerance shows a warning with an icon and text before the release is confirmed. After the release nobody can change the result or release another measurement for that requested test (owner, 2026-11-19). | R-12 |
| S16 | Record a request for a control sample: a quality-control sample with no patient. Its sample gets a lab number like any other; the team measures and releases it like any other, and the result goes to the control log of the team, never to a patient's record. | Must | *(proposed)* The team records a control request without a patient, measures and releases it; the released result is in no patient's record, and the teacher sees it on the dashboard with its times and its accuracy like any other result. | |
| S2 | View the practical assignment and measurement protocol. | Dropped | Dropped 2026-11-19 with the practical model. | |
| S3 | Register samples; eduLIMS creates a unique sample ID for each sample. | Dropped | Dropped 2026-11-19: the sample number comes from the request form (S12). | |
| S6 | Submit the lab report before a deadline. | Dropped | Dropped 2026-11-19: no lab report. | |
| S7 | View feedback and grade, with the own grade next to the practical average. | Dropped | Dropped 2026-11-19: no grading (W6). | |
| S8 | See the status of a submission (draft, submitted, graded). | Dropped | Dropped 2026-11-19: no lab report. | |
| S9 | Submit a resit or a new version. | Dropped | Dropped 2026-11-19: no lab report. | |

### Teacher portal

| ID | Requirement | Priority | Acceptance criterion | Risk |
|---|---|---|---|---|
| D9 | Manage the test catalogue, so a test can be added without a change to the code. Per test the teacher sets who calculates the concentration from an Epoch 2 plate: the team or eduLIMS. | Must | *(proposed)* A teacher adds a test with its name, unit and material, and teams can request it in the next simulation. A teacher switches a test between "the team calculates" and "eduLIMS calculates", and the upload follows that choice (S4). Open: which test runs on which analyser (O4). | |
| D10 | Prepare a simulation: its name, its labs (each with the name and logo the team made up, and the email addresses of its members) and, beforehand, the correct value per test and sample. The correct values are entered once per simulation and hold for every lab, so adding or removing a lab is no extra work. | Must | *(proposed)* A teacher creates a simulation with its labs and adds the members of a lab by pasting their email addresses. A teacher enters the correct value for each test of each sample number once; a lab added afterwards is judged against the same values without any new entry. No student account can read a correct value. | R-01 |
| D11 | Follow every team live on a dashboard: per request the time of entry, the time of release and the time between them; every measurement of a requested test, with the released one marked as the one that counts; and per released result the accuracy as green, yellow or red. | Must | *(proposed)* A released result shows on the dashboard without a manual reload, with its times and its accuracy status as a colour with an icon and text. The teacher sees the earlier measurements beside the released one. A teacher sees only their own simulations. | R-01, R-09 |
| D12 | Mark a request as urgent and set a time target for it; the dashboard shows whether a team met it. | Won't in this iteration | Owner, 2026-11-19: not built yet, and what counts as urgent is not defined yet. eduLIMS only logs the time of entry and the time of release (G-01). Open: O1. | |
| D13 | Set, per test, how far a result may be from the correct value for green, yellow and red. | Must | *(proposed)* A teacher sets the limits; the dashboard colours a result by them. Open: whether a limit is a percentage, an absolute distance or either (O2). | |
| D14 | See the ranking of the teams on time and accuracy. | Won't in this iteration | Owner, 2026-11-19: the ranking rule is not decided and comes in the next iteration. Open: O3. | |
| D1 | Create a practical with assignment, protocol, deadline and rubric. | Dropped | Dropped 2026-11-19 with the practical model; a simulation is prepared with D10. | |
| D2 | Link classes or individual students to a practical. | Dropped | Dropped 2026-11-19 with the practical model. | |
| D3 | View the measurement results of all students of a practical. | Dropped | Dropped 2026-11-19; replaced by D11. | |
| D4 | Grade a submission per rubric criterion, with feedback and final grade. | Dropped | Dropped 2026-11-19: no grading (W6). | |
| D5 | KPI dashboard per class and per practical. | Dropped | Dropped 2026-11-19; replaced by D11. | |
| D6 | Export grades (CSV) for use in an external grade-book system. | Dropped | Dropped 2026-11-19: no grading (W6). | |
| D7 | See deviating measured values flagged (plausibility check). | Dropped | Dropped 2026-11-19; the accuracy status of D11 and D13 replaces it. | |
| D8 | Reuse a rubric between practicals. | Dropped | Dropped 2026-11-19: no rubric. | |

### Admin portal

| ID | Requirement | Priority | Acceptance criterion | Risk |
|---|---|---|---|---|
| B1 | Create users and assign a role (student, teacher, administrator). | Must | An administrator assigns a role; the user immediately sees only the screens of that role. | R-01 |
| B2 | Create classes and link students to a class (by hand or by CSV import). | Dropped | Dropped 2026-11-19: there are no classes. A teacher creates a simulation with its labs and adds the students to a lab (D10). | |
| B3 | Register analysers and see the status of the integrations (FerroBRIDGE, FerroEHR). | Must | When FerroBRIDGE or FerroEHR is unreachable, the administrator sees that in the admin portal within 5 minutes. | |
| B4 | View the log of uploads, HL7 messages and errors. | Should | *(proposed)* Every upload, received HL7 message and integration error appears in the log with time, source and outcome, filterable by type. | |

*Note on B1 (draft, owner decision 2026-11-11):* a user may hold teacher and
administrator together and switches between the two portals; student is
never combined with another role. Each role keeps only its own access
([ADR 0012](adr/0012-multiple-roles-and-portal-switcher.md)).

### Won't

| ID | Requirement | Priority | Reason |
|---|---|---|---|
| W1 | Integration with a learning management system. | Won't | Out of scope. |
| W2 | Integration with an external grade-book system. | Won't | eduLIMS holds no grades (W6). |
| W3 | Direct device link with the Epoch 2. | Won't | Gen5 does not speak HL7; the Excel upload (S4) is the route. |
| W4 | New, custom openEHR archetypes. | Won't | Only existing CKM archetypes are used. |
| W5 | Real patient data. | Won't | The patients of a simulation are fictional. |
| W6 | Grading: a rubric, a grade, feedback on a submission, a lab report, a grade export. | Won't | Owner decision 2026-11-19: there is no grading of any kind. The teacher side is a dashboard of the progress and the process of the simulations. |
| W7 | Hints for students: a flag against the correct value, a suggested limit, an interpretation of a result. | Won't | Owner decision 2026-11-19: the students are the analysts. The one check they get is the warning against their own tolerance (S15). |

## Quality requirements

Classified by the ISO/IEC 25010 quality characteristics.

| ID | Characteristic | Requirement | Acceptance criterion |
|---|---|---|---|
| Q-SEC-1 | Security | Sign-in only through SSO; access per role. | A penetration test with the OWASP Top 10 checklist finds no endpoint that is open without sign-in. |
| Q-SEC-2 | Security | Every user sees only the data their role allows; the API filters on own data. | Tests with one account per role show no access outside the role: a student sees no data of another team and no correct value, a teacher only their own simulations. |
| Q-SEC-3 | Security | HTTPS for all traffic; no measurement data outside the institution's network. | All traffic is served over HTTPS; measurement data is stored only inside the institution's network, or, if hosting moves to Azure, only in an EU region with GDPR agreements. |
| Q-SEC-4 | Security | No known critical vulnerabilities in dependencies or images. | The dependency and image scan in CI reports no known critical vulnerability; images are rebuilt at least monthly. |
| Q-SEC-5 | Security | No merge without green tests; every change is reviewed by a person. | Branch rules require green CI and the merge queue. Review by a person is a convention, not a branch rule: the rules require no approval, so a pull request can auto-merge on green CI (see GOVERNANCE.md). |
| Q-PRIV-1 | Privacy | No personal data of a real person in FerroEHR. | The CDR holds the fictional patients of a simulation and no name, student number or email address of a student or a teacher; the GDPR check with the institution's privacy officer is approved. |
| Q-PRIV-2 | Privacy | An average never reveals an individual grade. | Dropped 2026-11-19: no grading (W6). |
| Q-PRIV-3 | Privacy | AI tools and test environments never see real personal data. | The repository and the development and test databases hold only the pseudonymised test set. |
| Q-PRIV-4 | Privacy | The teachers' simulation material stays out of everything public. | The repository, the tracker and the documentation hold no scenario, patient list, request form or correct value of a real simulation; fixtures and demo data are invented for the purpose. |
| Q-TRACE-1 | Traceability | Every measurement links through its lab number to device, sample, team and, for a patient request, the patient. | For any measurement in FerroEHR, eduLIMS shows the device, the sample, the team and the patient or the control request. |
| Q-REL-1 | Reliability | Available during a simulation. | On a simulation day eduLIMS is reachable 99% of the simulation hours; recovery within one working day. |
| Q-PERF-1 | Performance | Fast pages. | Pages load within 2 seconds. |
| Q-PERF-2 | Performance | Fast upload. | An Excel upload is processed within 10 seconds. |
| Q-SIM-1 | Simulation | Students get no hint from eduLIMS (W7). | With a student account, no screen and no server response holds a correct value, an accuracy status or another team's work. |
| Q-SIM-2 | Simulation | The server keeps the time. | Every time the dashboard uses (entry of a request, release of a result) is taken on the server; a client clock that is wrong changes nothing. |
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
| R-01 | A student sees the work of another team or a correct value. | Security | 2 | 3 | 6 | Access per role and a filter on the own team in the API (S10, D10, Q-SEC-2, Q-SIM-1). |
| R-02 | Real personal data ends up in FerroEHR. | Privacy | 1 | 3 | 3 | Fictional patients only; GDPR check before use (Q-PRIV-1). |
| R-03 | Dropped 2026-11-19 (an average reveals an individual grade): no grading. | | | | | |
| R-04 | Measurement data ends up somewhere without proper agreements (for example a cloud region outside the EU). | Security | 1 | 3 | 3 | Local inside the institution's network, or in Azure only in an EU region with GDPR agreements (Q-SEC-3). |
| R-05 | A vulnerable library in a container. | Security | 2 | 2 | 4 | Scan dependencies in the pipeline; update images monthly (Q-SEC-4). |
| R-06 | A value from an Excel upload is attached to the wrong sample. | Data quality | 3 | 2 | 6 | The upload validates the file layout, and a well can be linked only to a sample of the uploader's own team (S4). |
| R-07 | The AI coding assistant writes insecure code. | Security | 2 | 2 | 4 | No merge without green tests; review by a person by convention (Q-SEC-5). |
| R-08 | Unnecessary energy use from separate services. | Sustainability | 2 | 1 | 2 | One environment; unused containers off (Q-SUST-1). |
| R-09 | A colour-blind or visually impaired user cannot read the dashboard. | Accessibility | 2 | 2 | 4 | Signals with icon and text, not colour alone; WCAG 2.1 AA (Q-ACC-2). |
| R-10 | A screen reader cannot use the forms. | Accessibility | 2 | 2 | 4 | Labels on all fields; test with axe and keyboard (Q-ACC-3). |
| R-11 | An analyser result reaches the wrong team, because every team works the same sample numbers. | Data quality | 3 | 3 | 9 | *(proposed score)* The team enters the sample's lab number, unique across the teams, as the patient ID on the analyser (S5, S12); a result eduLIMS cannot link is shown to administrators only (#163). |
| R-12 | A time on the dashboard is wrong or can be changed by a team. | Fairness | 2 | 3 | 6 | *(proposed score)* Times are taken on the server (Q-SIM-2). |
| R-13 | Students find the scenario or the correct values of a simulation. | Fairness | 2 | 3 | 6 | *(proposed score)* The teachers' material stays out of the repository and the tracker (Q-PRIV-4); correct values are readable by teachers only (D10). |

The highest risks are R-11, R-01, R-06, R-12 and R-13. Access per role and
per team, upload validation and the server clock are therefore Must
requirements.

### Project risks

| ID | Risk | Likelihood | Impact | Measure |
|---|---|---|---|---|
| P-01 | The VM, network or identity provider registration is delayed. | High | High | Request immediately; develop locally with Docker Compose; temporary local sign-in. |
| P-02 | The lab network does not route to the server network (the Afinion cannot reach FerroBRIDGE). | Medium | High | Test early with the institution's IT department; simulate HL7 messages. |
| P-03 | The Gen5 export template cannot be pinned down unambiguously. | Medium | Medium | Fix the template together with a teacher; the parser validates strictly. |
| P-04 | Limited availability of teachers and students for interviews and tests. | Medium | Medium | Plan interviews and tests early; arrange through the product owner. |
| P-05 | Real personal data enters the system after all. | Low | High | Fictional patients only; no student or teacher data in FerroEHR; GDPR check with the institution's privacy officer. |
| P-06 | Single maintainer: no replacement in case of absence. | Medium | Medium | Guard the scope with MoSCoW; drop Could items when time runs short. |
| P-07 | Dropped. | | | No longer applies. |

## Dashboard measures

The teacher dashboard (D11) shows the progress and the process of a simulation.
It holds no grade and no norm for a grade. The measures below come from the
owner's input of 2026-11-19; their limits are open questions. The design is
in [teacher-dashboard.md](teacher-dashboard.md).

| ID | Measure | Calculation | Level | Seen by | Status |
|---|---|---|---|---|---|
| G-01 | Turnaround time | Time between the entry of a request and the release of its result, both logged on the server clock | per request and per team | Teacher | Decided |
| G-02 | Urgent within target | Whether an urgent request was released within its time target | per urgent request and per team | Teacher | Not in this iteration (D12, O1) |
| G-03 | Accuracy | Distance between a released result and the correct value, shown as green, yellow or red by the limits the teacher set (D13) | per released result and per team | Teacher | Decided |
| G-04 | Ranking | The teams ordered on time and accuracy | per simulation | Teacher; teams open | Not in this iteration (D14, O3) |
| K-09 | Analyser usage | Measurements per device per week | per device | Administrator | Proposal |

K-01 to K-08, the KPIs of the grading model, are dropped (2026-11-19). G-01
is calculated with SQL on the eduLIMS database; G-03 compares
a released result with the correct value, which only eduLIMS holds.

## Open questions

The owner answers these on #264. An answer there is newer than this
document.

| ID | Question | Status |
|---|---|---|
| O1 | What is the time target for an urgent and for a routine request, what counts as urgent, and when does the clock start? | Answered in part, 2026-11-19: the clock starts when the team enters the request and stops at the release (G-01). Held open by the owner: targets and urgent requests; nothing is built for them in this iteration. |
| O2 | How far from the correct value is yellow, and how far is red? | Answered 2026-11-19: the teacher sets it (D13). Still open: whether a limit is a percentage, an absolute distance or either. |
| O3 | How do time and accuracy combine into a ranking, and do teams see it during a simulation? | Held open by the owner, 2026-11-19: decided in the next iteration; nothing is built for it now. |
| O4 | Which test runs on which analyser, and which results are entered by hand? | Open in part: the Afinion 2 is used (owner, 2026-11-19). |
| O5 | How is a well of the Epoch export linked to a sample, and who calculates the concentration? | Answered 2026-11-19: eduLIMS loads the values and shows the plate; the team links wells to samples; per test the teacher chooses whether the team calculates the concentration or eduLIMS does (D9, S4). When eduLIMS calculates, it subtracts the blank and fits a straight line through the standards; a sample outside the range of the standards gets no number but the message that it is outside the range. |
| O6 | Is a team's tolerance a reference range, a quality-control limit or both; can it change during a simulation; does the teacher see it? | Open |
| O7 | Does the teacher see every measurement or only the released result, and can a team correct a released result? | Answered 2026-11-19: a result in the patient's record is final and cannot be changed. The teacher sees every measurement; the one the team released is the one that counts. |
| O8 | Is a result that is calculated from other results entered by the team, with a correct value like any other test? | Open |
| O9 | May the fictional patient details go into FerroEHR, or does a pseudonym go there? | Answered 2026-11-19: the fictional name and date of birth go into FerroEHR. |
| O10 | Does every student sign in with their own account, and are there team roles with different rights? | Answered in part, 2026-11-19: every student signs in with their own account and is linked to their lab by email address (S10). Still open: team roles with different rights. |
| O11 | How much of a simulation does a teacher prepare in eduLIMS, and can it be reused? | Answered 2026-11-19: the teacher prepares the simulation with its labs, their members and the correct values (D10); patients, requests and samples come from the teams. There are no classes. Still open: copying a simulation to a next year. |
| O12 | Is grading in scope? | Answered 2026-11-19: no (W6). Still open: whether eduLIMS records anything else a teacher does during a simulation. |
| O13 | How does an analyser result find the right team, when every team works the same sample numbers? | Answered 2026-11-19: through the patient ID the team enters on the Afinion 2. The maintainer's design for it: the team enters the lab number eduLIMS gave the sample (S12), which is unique across the teams. |
| O14 | Can a request be for a quality-control sample with no patient, and where does its result go when no patient record exists? | Answered 2026-11-19: a control sample is its own kind of request (S16). |

## Traceability

| Requirement | Architecture | Test level ([test-strategy.md](test-strategy.md)) |
|---|---|---|
| S1, B1, Q-SEC-1, Q-SEC-2 | [Portals and roles](architecture.md#portals-and-roles), [ADR 0005](adr/0005-better-auth-entra-id.md), [ADR 0010](adr/0010-vendor-neutral-oidc-entra-and-keycloak.md) | security, integration |
| S4, S5, S14, S15, Q-TRACE-1 | [Integrations](architecture.md#context-and-integrations), [Data](architecture.md#data), [The LIMS workflow](lims-workflow.md) | data, integration |
| S10 to S13, S16, D9, D10, Q-SIM-1 | [Data](architecture.md#data), [ADR 0020](adr/0020-workplace-simulation.md) | unit, security, acceptance |
| D11 to D14, G-01 to G-04, Q-SIM-2 | [teacher-dashboard.md](teacher-dashboard.md) | unit, performance, user test |
| Q-ACC-* | [Quality](architecture.md#quality-requirements) | accessibility |
