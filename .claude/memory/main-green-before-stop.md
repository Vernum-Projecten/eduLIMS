---
name: main-green-before-stop
description: "Work does not stop until main is green: GitHub Actions and the SonarCloud quality gate on main's head; owner 2026-11-20"
metadata:
  type: feedback
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Before a session or a batch of work ends, `main` is green: every workflow
run on main's head commit passes and the SonarCloud quality gate passes
(security, reliability and duplication on new code). A green `conclusion`
check on the PRs is not enough: SonarCloud is not a required check, so a
failing gate can reach main without anyone seeing it.

**Why:** the owner, 2026-11-20: "i want that the main is green before you
are allowed to stop working". Main's Sonar gate had been failing (security
E, reliability D) while every PR merged.

**How to apply:** after the last merge, check
`gh api repos/Vernum-Projecten/eduLIMS/commits/<main head>/check-runs` and
the Sonar issues on main
(`https://sonarcloud.io/api/issues/search?componentKeys=Vernum-Projecten_eduLIMS&branch=main&inNewCodePeriod=true&types=BUG,VULNERABILITY`);
fix what is red before reporting done. Treat a red Sonar check on a PR as a
finding to fix before arming auto-merge.
