---
name: supply-chain-release-age
description: "pnpm minimumReleaseAge is 1440 minutes (24 h), set explicitly so it is strict; Dependabot keeps its 7-day cooldown; owner 2026-11-11"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`. Set explicitly, the
policy is strict: resolution fails instead of falling back, and pnpm 12 also
verifies every lockfile entry against it. Dependabot's cooldown stays 7 days
(the floor zizmor's audit enforces), so its updates always meet the policy.

**Why:** the owner weighed 7 and 4 days and chose 24 hours (2026-11-11).

**How to apply:** pin a new dependency to a version published at least 24
hours ago; never add a blanket exclusion. An advisory-driven fix that cannot
wait is exempted per exact version in `minimumReleaseAgeExclude`, with the
advisory named in the PR.
