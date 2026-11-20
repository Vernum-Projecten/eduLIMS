<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Teacher dashboard

This document describes the design of the teacher dashboard of a simulation
(requirements D11 and D13; D12 and D14 are not built in this iteration).
During a simulation a teacher follows every lab on it: how long each request
takes and how accurate each released result is. The dashboard shows the
progress and the process of a simulation. It holds no grade and no norm for
a grade (W6). A lab is the team of students that runs one laboratory in a
simulation ([ADR 0021](adr/0021-simulations-and-labs.md)); "team" on this
page means the students of one lab.

Requirement and measure IDs refer to [requirements.md](requirements.md), which
is a working draft. Two of its
[open questions](requirements.md#open-questions) are held by the owner for
the next iteration (O1 and O3), and nothing is built on them. This page
states no layout beyond what the requirements state.

## Which simulation it shows

Only one simulation runs at a time (owner, 2026-11-20, #386), and the
dashboard shows that one, with no picker. With no simulation running, or with
one the teacher does not teach, it shows an empty state that says so and
links to the teacher's simulations.

## What the dashboard shows

The measures are G-01 and G-03 in
[Dashboard measures](requirements.md#dashboard-measures).

| What | Level | Measure | Requirement |
|---|---|---|---|
| The time of entry of a request, the time of release of its result, and the time between them (the turnaround time) | per request and per team | G-01 | D11 |
| Every measurement of a requested test, with the released one marked as the one that counts | per requested test and per team | | D11 |
| The accuracy status of a released result: green, yellow or red, by the limits the teacher set for the test | per released result and per team | G-03 | D11, D13 |

A released result shows on the dashboard without a manual reload (D11). The
teacher sees the earlier measurements beside the released one. A released
result is final (S15), so the one that counts does not change afterwards.

The dashboard shows a lab under its name and its logo, which the teacher
entered when creating the lab (D10, S10).

A request for a control sample, which has no patient, shows on the dashboard
with its times and its accuracy like any other result (S16).

Before a simulation the teacher enters the correct value per test and sample
number, once per simulation (D10). The values hold for every lab, so a lab
added afterwards is judged against them without any new entry. A teacher can
change a correct value before, during and after the simulation; the change is
logged and the dashboard follows the current value (D10).

The teacher also sets, per test, how far a result may be from the correct
value: the limit for yellow and the limit for red, each as a percentage of
the correct value or as an absolute distance. A value exactly on a limit gets
the better colour (D13).

## Not in this iteration

The owner held two parts back on 2026-11-19. Nothing is built for them: no
urgent flag on a request, no time target and no ranking.

| What | Measure | Requirement | Why |
|---|---|---|---|
| Whether an urgent request was released within a time target | G-02 | D12 | What counts as urgent is not defined yet (O1). eduLIMS only logs the time a request enters the system and the time its result is released (G-01). |
| The ranking of the teams on time and accuracy | G-04 | D14 | The ranking rule is decided in the next iteration (O3). |

## Statuses

Every status on the dashboard is a colour with an icon and text (Q-ACC-2,
R-09). That holds for the accuracy status (green, yellow, red) and for the
mark on the released measurement. A user who cannot tell the colours apart
reads the same status from the icon and the text.

## Who sees it

- Only the teacher role opens the dashboard, and a teacher sees only their
  own simulations (D11, Q-SEC-2): the ones they created and the ones another
  teacher added them to, with the same rights (D10). The server checks the
  role and the ownership of the simulation in the database query.
- An administrator sees the simulations and their labs read-only, and
  nothing of a lab's work and no correct value (B5, a Should).
- A student never sees a correct value, an accuracy status or the work of
  another team: no screen and no server response for a student account holds
  one (Q-SIM-1, W7). Every server function behind the dashboard has negative
  tests with a student account.

## Times

Every time the dashboard uses is taken on the server: the entry of a request
and the release of a result (Q-SIM-2, R-12). A client clock that is wrong
changes nothing, and a team cannot change a time.

## Data sources

| Source | What it provides | For |
|---|---|---|
| eduLIMS database (SQL) | simulations and labs with their names and logos, requests with their time of entry, the time of release, the correct values and the accuracy limits | G-01, G-03 |
| FerroEHR (AQL) | the released results in the patients' records | G-03 |

G-01 is calculated with SQL on the eduLIMS database. G-03
compares a released result with the correct value, which only eduLIMS holds:
a correct value, a limit and an accuracy status never reach FerroEHR.

Every measurement of a requested test and its release are rows in the
eduLIMS database (#270), so the dashboard reads the measurements, the
released one and the time of release there.

The released result of a control request goes to the control log of the team
and is in no patient's record (S16). It is stored in the eduLIMS database
like every release (#270), which is its source for G-03.

## Charts

Every chart on the dashboard goes through the `EduChart` component
([ADR 0016](adr/0016-charts-tanstack-charts.md)), which gives a chart its
name, its description, a table view of the same data, and a shape next to
each colour. Which charts the dashboard has is not decided.

## Open questions

| ID | Status | Touches |
|---|---|---|
| O1 | Held open by the owner, 2026-11-19: the time target for an urgent and for a routine request, and what counts as urgent. Nothing is built for it in this iteration. | G-02, D12 |
| O2 | Answered 2026-11-19: per test the teacher sets the limit for yellow and for red, each as a percentage of the correct value or as an absolute distance; a value exactly on a limit gets the better colour. | G-03, D13 |
| O3 | Held open by the owner, 2026-11-19: how time and accuracy combine into a ranking, and whether teams see it during a simulation. Decided in the next iteration; nothing is built for it now. | G-04, D14 |
| O7 | Answered 2026-11-19: a result in the patient's record is final and cannot be changed. The teacher sees every measurement; the one the team released is the one that counts. | D11, S15 |

O1 and O3 are held by the owner for the next iteration. A later owner
decision on #264 is newer than this document.

## Related

- [Requirements](requirements.md): D9 to D15, S15, S16, B5, G-01 to G-04,
  Q-SIM-1, Q-SIM-2 and Q-ACC-2.
- [The LIMS workflow](lims-workflow.md): how a request reaches the dashboard.
- [ADR 0020](adr/0020-workplace-simulation.md): the decision for the
  simulation.
