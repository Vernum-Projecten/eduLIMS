---
name: workplace-simulation-direction
description: "eduLIMS is the LIMS of a workplace simulation: teams compete on turnaround time and accuracy; no grading, a teacher dashboard of the games; the practical, lab report, rubric, grade and KPI model is dropped; #264 rewrites the requirements; owner 2026-11-19"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

eduLIMS is the LIMS of a workplace simulation. Teams of students run a
simulated clinical laboratory and compete with the other teams on turnaround
time and on accuracy. The owner's input, 2026-11-19:

- The work is always done in teams.
- Requests arrive on paper. The team creates the patient, links the samples
  and records the requested tests; a request can be urgent.
- A team can measure several times before it attaches a result to the
  patient's record. eduLIMS records when the request was entered and when the
  result was attached.
- A team enters its own tolerances beforehand, and eduLIMS warns before a
  value outside them is attached.
- eduLIMS gives students no other suggestion: they are the analysts.
- A teacher enters the correct values beforehand and follows every team
  live, on time and on accuracy (green, yellow, red).
- There is no grading of any kind. The teacher side is a dashboard that
  shows the progress and the process of the games.
- Teachers can add other tests later, so the test set is data, never code.
- The Epoch 2 export is uploaded by drag and drop.

**Why:** the owner, 2026-11-19 (translated from Dutch): "it is no longer a practicals tool for
teachers but a real-life simulation with a competition between the teams, on
time and on accuracy at once".

**How to apply:**

- Build nothing on the practical model (assignment, protocol, deadline, lab
  report, rubric, grade, grade export, KPI dashboard, sample IDs generated
  per practical). Its issues are closed as not planned.
- `docs/requirements.md` and the other design documents still describe the
  old model until #264 lands; the owner's input above and the answers on #264
  are newer. The targets, the colour thresholds and the ranking rule are
  open questions there: never pick a number ([[requirements-are-draft]]).
- Never add a feature that hints at the answer to a student (a flag against
  the correct value, a suggested range, an automatic calculation the team is
  meant to do), unless the owner asks for it.
- **The teachers' material never becomes public** (owner, 2026-11-19: "the
  teachers' data must not land in the repo; we may use it locally, but not
  publicly, because then the students can find the right answers"). The
  repository and the tracker are public. Use the request forms, the game
  script, the kick-off deck and the Epoch export locally only: no scenario,
  patient, sample number, requested test per patient, trap, intervention or
  correct value in a file, a fixture, a seed, an issue, a comment, a PR or a
  commit message. Describe a format (the form's fields, the export's
  layout) without its content, and invent fixtures and demo data from
  scratch ([[neutral-project-context]]). One of the files also holds real
  student names.
