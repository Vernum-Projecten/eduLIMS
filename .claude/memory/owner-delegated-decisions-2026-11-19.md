---
name: owner-delegated-decisions-2026-11-19
description: "What the maintainer decided on the owner's delegation for the simulation: tolerances, accuracy limits, test sources, corrections, no roles in a lab, co-teachers, the admin's read-only view, and what is a Won't; 2026-11-19"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

On 2026-11-19 the owner asked the maintainer to judge the questions that were
still open on #264. The decisions, each in `docs/requirements.md`:

- **Tolerances (S13, S15):** one lower and one upper limit per test. A team
  can change one during the simulation; every change is logged and the
  teacher sees it. A release needs a tolerance, and eduLIMS keeps the
  tolerance in force at the release.
- **Accuracy limits (D13):** per test the teacher sets the limit for yellow
  and for red, each as a percentage of the correct value or as an absolute
  distance. A value exactly on a limit gets the better colour.
- **Where a measurement comes from (D9):** per test the teacher sets the
  source: the Afinion 2, the Epoch 2 upload, or entry by hand. A result
  calculated from other results is a test with entry by hand.
- **Corrections (S11, S12):** a team can correct a patient or a request until
  the first result under it is released. Every correction is logged for the
  teacher, and the time of entry never changes.
- **The same sample number twice in a lab** is allowed; the lab numbers tell
  the tubes apart.
- **No roles inside a lab (S10):** every member may do everything, and
  eduLIMS records who did what. A student can be in several simulations, in
  one lab of each.
- **Teachers (D10):** a teacher can add other teachers to a simulation, with
  the same rights. A correct value can change before, during and after the
  simulation; the change is logged and the dashboard follows it.
- **Administrators (B5, a Should):** a read-only list of simulations and
  labs, nothing of a lab's work and no correct value.
- **Copying a simulation (D15):** a Could.
- **Won't:** results that are not a number (W8), and recording other things
  a teacher does during a simulation (W9, not in this iteration).

Held by the owner for the next iteration, and not for the maintainer to
decide: targets and urgent requests (O1) and the ranking (O3).

**Why:** the owner, 2026-11-19: "judge the open questions yourself".

**How to apply:** treat these as decided, cite the requirement row, and
change one only on a newer owner decision. They are the simplest reading that
keeps the students the analysts ([[workplace-simulation-direction]]).
