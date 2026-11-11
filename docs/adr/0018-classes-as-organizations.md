<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0018. A class is a better-auth organization, a lab group a team

- Status: Proposed
- Date: 2026-11-12
- Deciders: maintainer (design on #28, owner decisions on the issue)

## Context and problem statement

Teachers group students in classes (B2) and link classes to practicals (D2);
access to a practical follows class membership (S2, D3), and nobody may see
data outside their classes (R-01). A class needs roles per person (an owner,
co-teachers, students), invitations, a yearly life cycle and lab groups
inside it. better-auth is already the auth library (ADR 0005, ADR 0015) and
ships an organization plugin with members, roles, invitations and teams. Do
we build classes on it, and how do we keep its open endpoints from becoming
a second, weaker way in?

## Considered options

1. **A hand-made membership model** in eduLIMS's own tables.
2. **The organization plugin with its own endpoints**, as the plugin
   documents them, guarded by its hooks.
3. **The organization plugin for the schema, the access control and the ids,
   with every write in eduLIMS's own class service** and the plugin's HTTP
   endpoints off, as ADR 0015 does for the SSO plugin.

## Decision

Option 3, on `better-auth` 1.7.20.

- **One class is one organization.** `organization.name` is the class name
  and is not unique; the identity is a UUIDv7 (`advanced.database.generateId`
  gives every better-auth row one) and the required unique `slug` is set to
  the same id, held by a `CHECK`. eduLIMS adds `academic_year` (required,
  `YYYY-YYYY`) and `archived_at`.
- **A lab group is a team** inside the class, with the additional field
  `group_set`, so a class can group its students more than one way. Teams
  have no roles of their own; the class role decides who manages them.
- **The class roles** `owner`, `teacher` and `student` are a custom
  `createAccessControl` (`src/lib/classes.ts`): the owner does everything; a
  co-teacher invites and removes students and manages lab groups; a student
  manages nothing. The app role (ADR 0012) is a separate check: a co-teacher
  needs the app role teacher, a student the app role student.
- **The class service** (`src/server/classes/`) does every write in one
  transaction that locks the class row, checks the class role through a
  membership query on the session user, refuses an archived class, and
  writes its activity-log row (B4). A teacher of another class gets
  `not_found`, never a hint that the class exists.
- **The plugin's endpoints are unreachable:** all of them are in
  `disabledPaths`, a before-hook answers any `/organization` path with 404,
  `allowUserToCreateOrganization` is off, and the plugin's own `before*`
  hooks refuse, so a server-side `auth.api` call cannot write either.
- **Lifecycle (owner decisions on #28):** the owner archives a class, which
  makes it read-only, and can reopen it. Deleting a class removes its
  memberships, invitations and lab groups in one transaction; only
  practicals, submissions and grades block it (#98).
- **Invitations without email:** `invitationExpiresIn` is 30 days and no
  `sendInvitationEmail` is set. A session-create hook accepts every pending,
  unexpired invitation for the user's verified email on each sign-in. When
  the identity provider sends no eduLIMS role at a person's first sign-in, a
  pending student invitation grants the app role student, and only that; it
  never restores a role the identity provider took away (owner decisions on
  #28). The invitation preview never tells which accounts exist. Ended
  invitations are pruned after 90 days. Deleting a user who owns a class is
  refused (`owns_class`) until the ownership moves.

## Consequences

- Good: the schema, the ids and the role vocabulary are better-auth's, so a
  later better-auth feature (dynamic roles, teams in sessions) fits without
  a data migration.
- Good: the access rule, the archive rule and the activity log live in one
  place and are tested against a real database, with negative tests per
  role.
- Bad: the plugin's endpoints and client are unused, so eduLIMS maintains
  its own invitation, member and team writes. A better-auth upgrade can add
  an endpoint; the `/organization` guard and the path test catch it.
- Bad: `session.activeOrganizationId` and `activeTeamId` exist but are never
  read; the class id is in the URL.

## References

- better-auth organization plugin: <https://better-auth.com/docs/plugins/organization>
- Issue #28 and its owner decisions; ADR 0005, ADR 0012, ADR 0015.
