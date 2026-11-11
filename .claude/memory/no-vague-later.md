---
name: no-vague-later
description: "Never file or describe needed work as 'later': plan it into the current milestone and order it by real dependencies; owner 2026-11-11"
metadata:
  type: feedback
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Work that eduLIMS needs is planned, not deferred. An issue never opens with
"Later." and a design never parks a capability as "for later" (SCIM, the SSO
plugin and the join code were wrongly filed that way and moved into
milestone v0.1.0).

**Why:** the owner, 2026-11-11: "why do I see so much later later things?".
The project is greenfield until 1.0 ([[greenfield-until-1-0]]), so there is
no reason to postpone a sound feature.

**How to apply:** put every issue in the current milestone (planning lives in
GitHub milestones and issues, [[requirements-are-draft]]). Order work by its
real dependencies (two branches that rewire the same sign-in code go one
after the other) and say that order plainly. Only something the owner or the
product owner explicitly rules out is left out, and then it is closed with
the reason, not kept as "later".
