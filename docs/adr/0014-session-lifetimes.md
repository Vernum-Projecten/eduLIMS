<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0014. Session lifetimes: 8 hours sliding, 24 hours at most

- Status: Proposed
- Date: 2026-11-11
- Deciders: maintainer (decision on #42, made on the owner's delegation)

## Context and problem statement

eduLIMS ran on better-auth's default session: 7 days, refreshed once a day
while in use, with no absolute limit. Students use shared lab computers, so
a session left open is the most likely way one student reaches another's
work. A practical lasts hours, so a short idle limit would sign students out
in the middle of one. ASVS 5.0 asks for a documented inactivity limit
(V7.3.1) and an absolute maximum (V7.3.2), and for the choice to be recorded
(V7.1.1).

## Considered options

1. **better-auth defaults:** 7 days, refreshed daily, no maximum.
2. **2 hours idle, 8 hours absolute** (the proposal on #42).
3. **8 hours sliding, refreshed at most hourly, 24 hours absolute.**

## Decision

Option 3.

- **Sliding:** `session.expiresIn` is 8 hours. better-auth extends a session
  to 8 hours from now when it is read and its last refresh is at least
  `session.updateAge` (1 hour) old, so the expiry moves at most once an hour
  and an unused session ends 7 to 8 hours after its last use.
- **Absolute:** no session lives past 24 hours after sign-in. A trigger on
  the `session` table (migration `0006_session_absolute_lifetime`) keeps
  `expiresAt` at or before `createdAt` + 24 hours on every insert and update,
  so better-auth's own expiry check ends the session on every endpoint. The
  session read in `src/server/session.ts` checks the same limit, revokes an
  older session and refuses it; an unreadable sign-in time counts as too
  old.
- The limits live in `src/server/session-policy.ts`.

## Consequences

- A student who leaves a lab computer signed in is signed out by the next
  morning at the latest; a full day of practicals needs no new sign-in.
- Signing in again after 24 hours goes through the identity provider, which
  usually still has its own session, so it costs a click.
- A change of either limit changes `session-policy.ts`, and for the absolute
  one also a new migration that replaces the trigger.
- Sessions that existed before the change keep their old expiry until their
  next refresh; the read check ends any of them older than 24 hours.

## Links

- ASVS 5.0 V7.1, V7.3: `docs/security/vendor/asvs/en/0x16-V7-Session-Management.md`
- better-auth session management: <https://www.better-auth.com/docs/concepts/session-management>
