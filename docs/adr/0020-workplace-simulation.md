<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0020. A workplace simulation replaces the practical model

- Status: Proposed
- Date: 2026-11-19
- Deciders: product owner, maintainer

## Context and problem statement

eduLIMS was designed around a practical: a teacher sets an assignment, a
protocol, a deadline and a rubric; a student registers samples, measures,
hands in a lab report and gets a grade; a KPI dashboard reports on the
grades. The teachers use eduLIMS for something else. Their course runs a
workplace simulation: teams of students run a clinical laboratory for a day
or two, requests arrive on paper, and the teams compete on how fast and how
accurately they deliver results. The practical model does not describe that
work.

## Decision drivers

- Students experience a LIMS as they will in a real laboratory: patient,
  request, sample, measurement, release.
- The students are the analysts. The system does not do their analysis and
  gives no hint.
- Teachers follow the simulation while it runs, on time and on accuracy.
- Teachers can change the tests themselves.

## Considered options

- Keep the practical model and add the simulation beside it.
- Replace the practical model with the simulation.

## Decision outcome

Chosen option: **replace the practical model with the simulation** (owner,
2026-11-19). eduLIMS has no production data before 1.0, so nothing is
migrated, and a second model beside the first would double the screens, the
access rules and the tests for a use nobody has.

- The unit of work is a **simulation** with **labs**: a lab is a team of
  students that runs one laboratory. A team registers patients, records
  requests and samples from the paper forms, measures (several times
  when it wants), and releases a result to the patient's record in FerroEHR.
- A team sets its own tolerances per test beforehand, and eduLIMS warns
  before a value outside them is released. eduLIMS gives no other hint.
- A teacher manages the test catalogue, enters the correct values of a
  simulation beforehand, and follows every team on a live dashboard: the time per
  request, every measurement of a requested test, and the accuracy of each
  released result as green, yellow or red. A target for urgent requests and
  a ranking of the teams are not built in this iteration (D12, D14).
- A teacher creates each lab with the name and the logo its team made up,
  and the labs compete with each other (D10, S10;
  [ADR 0021](0021-simulations-and-labs.md)).
- A released result is final (S15).
- eduLIMS holds results that are a number with a unit; a result that is not
  a number stays outside it (W8).
- A control sample, which has no patient, is its own kind of request. Its
  result goes to the control log of the team, never to a patient's record
  (S16).
- The correct values are entered once per simulation and hold for every team
  (D10).
- There is no grading: no lab report, no rubric, no grade, no grade export,
  no KPI dashboard on grades.
- The times a dashboard uses are taken on the server.
- The teachers' simulation material (the scenario and the correct values)
  never enters the repository or the tracker, which are public.

The requirements are in [requirements.md](../requirements.md); the questions
and their answers are listed there as O1 to O14. O1 (time targets and urgent
requests) and O3 (the ranking) are held by the owner for the next iteration.

### Consequences

- Good: the chain patient, request, sample, measurement, release that
  [The LIMS workflow](../lims-workflow.md) already drew stays, and so do
  FerroEHR, FerroBRIDGE, the Afinion 2 route, the Gen5 upload and the roles.
  The membership model of ADR 0018 stays as the base of simulations and
  labs ([ADR 0021](0021-simulations-and-labs.md)).
- Good: the grading model, the hardest part to keep private (R-01, R-03 of
  the earlier draft), is gone.
- Bad: the issues, the placeholders and the documents of the practical model
  are closed or rewritten, and the earlier records that name practicals,
  rubrics and KPIs (0006, 0016, 0018) read as history where they do.
- Bad: correct values are a new secret inside the application. A student
  account must never read one, and that needs negative tests on every
  function that touches them.
- Bad: every team works the same sample numbers, so a sample number alone no
  longer identifies whose result an analyser sends (R-11). eduLIMS gives
  each team's sample a lab number that is unique across the teams, and the
  team enters it as the patient ID on the Afinion 2 (S5, S12).
