<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Game dashboard

This document describes the design of the teacher dashboard of a game
(requirements D11 and D13; D12 and D14 are not built in this iteration).
During a game a teacher follows every team on it: how long each request
takes and how accurate each released result is. The
dashboard shows the progress and the process of a game. It holds no grade and
no norm for a grade (W6).

Requirement and measure IDs refer to [requirements.md](requirements.md), which
is a working draft. Points marked **Open** name a question in its
[open questions](requirements.md#open-questions); nothing is built on an open
point. This page states no layout beyond what the requirements state.

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

The dashboard shows a team under the lab name the team picked (S10).

A request for a control sample, which has no patient, shows on the dashboard
with its times and its accuracy like any other result (S16).

Before a game the teacher enters the correct value per test and sample
number, once per game (D10). The values hold for every team, so a team added
afterwards is judged against them without any new entry. The teacher also
sets, per test, how far a result may be from the correct value for green,
yellow and red (D13).

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
  own games (D11, Q-SEC-2). The server checks the role and the ownership of
  the game in the database query.
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
| eduLIMS database (SQL) | games and teams with their lab names, requests with their time of entry, the time of release, the correct values and the accuracy limits | G-01, G-03 |
| FerroEHR (AQL) | the released results in the patients' records | G-03 |

G-01 is calculated with SQL on the eduLIMS database. G-03
compares a released result with the correct value, which only eduLIMS holds:
a correct value, a limit and an accuracy status never reach FerroEHR.

Where a measurement lives before its release is a design matter for the
maintainer. The proposal in [The LIMS workflow](lims-workflow.md) keeps
every measurement in FerroEHR as a Preliminary composition and makes the
released one Final; with it, the measurements of a requested test also come
from FerroEHR.

The released result of a control request goes to the control log of the team
and is in no patient's record (S16). Where it is stored, in FerroEHR or in
the eduLIMS database, is a design decision that is not made yet, so its
source for G-03 is not fixed either.

## Charts

Every chart on the dashboard goes through the `EduChart` component
([ADR 0016](adr/0016-charts-tanstack-charts.md)), which gives a chart its
name, its description, a table view of the same data, and a shape next to
each colour. Which charts the dashboard has is not decided.

## Open questions

| ID | Status | Touches |
|---|---|---|
| O1 | Held open by the owner, 2026-11-19: the time target for an urgent and for a routine request, and what counts as urgent. Nothing is built for it in this iteration. | G-02, D12 |
| O2 | Answered in part: the teacher sets the limits per test (D13). Still open: whether a limit is a percentage, an absolute distance or either. | G-03, D13 |
| O3 | Held open by the owner, 2026-11-19: how time and accuracy combine into a ranking, and whether teams see it during a game. Decided in the next iteration; nothing is built for it now. | G-04, D14 |
| O7 | Answered 2026-11-19: a result in the patient's record is final and cannot be changed. The teacher sees every measurement; the one the team released is the one that counts. | D11, S15 |

The owner answers these on #264. An answer there is newer than this document.

## Related

- [Requirements](requirements.md): D9 to D14, S15, S16, G-01 to G-04, Q-SIM-1,
  Q-SIM-2 and Q-ACC-2.
- [The LIMS workflow](lims-workflow.md): how a request reaches the dashboard.
- [ADR 0020](adr/0020-workplace-simulation.md): the decision for the
  simulation.
