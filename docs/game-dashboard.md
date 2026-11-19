<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Game dashboard

This document describes the design of the teacher dashboard of a game
(requirements D11 to D14). During a game a teacher follows every team on it:
how long each request takes and how accurate each released result is. The
dashboard shows the progress and the process of a game. It holds no grade and
no norm for a grade (W6).

Requirement and measure IDs refer to [requirements.md](requirements.md), which
is a working draft. Points marked **Open** name a question in its
[open questions](requirements.md#open-questions); nothing is built on an open
point. This page states no layout beyond what the requirements state.

## What the dashboard shows

The measures are G-01 to G-04 in
[Dashboard measures](requirements.md#dashboard-measures).

| What | Level | Measure | Requirement |
|---|---|---|---|
| The time of entry of a request, the time of release of its result, and the time between them (the turnaround time) | per request and per team | G-01 | D11 |
| Whether an urgent request was released within the time target the teacher set | per urgent request and per team | G-02 | D12 |
| The accuracy status of a released result: green, yellow or red, by the limits the teacher set for the test | per released result and per team | G-03 | D11, D13 |
| The ranking of the teams on time and accuracy | per game | G-04 | D14 |

A released result shows on the dashboard without a manual reload (D11).

Before a game the teacher enters the correct value per test and sample (D10),
sets the time target for urgent requests (D12) and sets, per test, how far a
result may be from the correct value for green, yellow and red (D13).

## Statuses

Every status on the dashboard is a colour with an icon and text (Q-ACC-2,
R-09). That holds for the accuracy status (green, yellow, red) and for an
urgent request within or past its target. A user who cannot tell the colours
apart reads the same status from the icon and the text.

## Who sees it

- Only the teacher role opens the dashboard, and a teacher sees only their
  own games (D11, Q-SEC-2). The server checks the role and the ownership of
  the game in the database query.
- A student never sees a correct value, an accuracy status or the work of
  another team: no screen and no server response for a student account holds
  one (Q-SIM-1, W7). Every server function behind the dashboard has negative
  tests with a student account.
- Open: whether teams see the ranking during a game (O3).

## Times

Every time the dashboard uses is taken on the server: the entry of a request
and the release of a result (Q-SIM-2, R-12). A client clock that is wrong
changes nothing, and a team cannot change a time.

## Data sources

| Source | What it provides | For |
|---|---|---|
| eduLIMS database (SQL) | games and teams, requests with their time of entry and their urgency, the time of release, the urgent target, the correct values and the accuracy limits | G-01, G-02, G-03, G-04 |
| FerroEHR (AQL) | the released results in the patients' records | G-03 |

G-01, G-02 and G-04 are calculated with SQL on the eduLIMS database. G-03
compares a released result with the correct value, which only eduLIMS holds:
a correct value, a limit and an accuracy status never reach FerroEHR.

## Charts

Every chart on the dashboard goes through the `EduChart` component
([ADR 0016](adr/0016-charts-tanstack-charts.md)), which gives a chart its
name, its description, a table view of the same data, and a shape next to
each colour. Which charts the dashboard has is not decided.

## Open questions

| ID | Open | Touches |
|---|---|---|
| O1 | The time target for an urgent and for a routine request, and when the clock starts and stops. | G-01, G-02, D12 |
| O2 | Answered in part: the teacher sets the limits per test (D13). Still open: whether a limit is a percentage, an absolute distance or either. | G-03, D13 |
| O3 | How time and accuracy combine into a ranking, and whether teams see it during a game. No criterion is proposed for D14 until the owner answers. | G-04, D14 |
| O7 | Whether the teacher sees every measurement or only the released result, and whether a team can correct a released result. | D11, G-03 |

The owner answers these on #264. An answer there is newer than this document.

## Related

- [Requirements](requirements.md): D9 to D14, G-01 to G-04, Q-SIM-1, Q-SIM-2
  and Q-ACC-2.
- [The LIMS workflow](lims-workflow.md): how a request reaches the dashboard.
- [ADR 0020](adr/0020-workplace-simulation.md): the decision for the
  simulation.
