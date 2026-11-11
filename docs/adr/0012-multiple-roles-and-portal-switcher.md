<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0012. Multiple roles per user and a portal switcher

- Status: Proposed
- Date: 2026-11-11
- Deciders: maintainer (owner decision of 2026-11-11)
- Amends: [0010](0010-vendor-neutral-oidc-entra-and-keycloak.md)

## Context and problem statement

ADR 0010 gave every user one role: the highest role the identity provider
mapped. Some staff both teach and manage the system, so a teacher who is also
an administrator lost one of the two. better-auth's admin plugin already
stores roles as a comma-separated list, and `parseRoles` already read it.

Which role combinations does eduLIMS allow, how does one user reach more than
one portal, and where does a user land after signing in?

## Decision drivers

- R-01 ("a student sees grades or results of others") stays the highest risk:
  no combination may widen what a role sees.
- Every server function keeps checking the one role it needs (S7, D3, B1).
- The current portal is visible and shareable: a URL, never hidden state.
- WCAG 2.1 AA and the shadcn/ui blocks the shell is built from.

## Considered options

For the role sets:

1. **Any combination** of student, teacher and admin.
2. **Student is exclusive:** {student}, {teacher}, {admin} or
   {teacher, admin}.
3. **One role only**, the highest (ADR 0010 as written).

For the display:

1. **One combined sidebar** with a group per portal the user holds.
2. **A portal switcher** at the top of the sidebar, from the sidebar-07
   block's team switcher, with one portal on screen at a time.

## Decision outcome

Role sets: option 2. Display: option 2, the portal switcher.

### Roles are a set, not a ranking

- The allowed sets are {student}, {teacher}, {admin} and {teacher, admin}.
  `validateRoleSet` in `src/lib/roles.ts` is the one rule; a set with student
  and another role is a `conflict`.
- No role implies another. Admin does not get teacher powers and teacher does
  not get admin powers; an administrator still has no access to grades or
  results (R-01). Ownership checks are unchanged.
- At every OIDC sign-in each claim value is mapped through `OIDC_ROLE_MAP`.
  An allowed set is stored sorted and comma-separated (`teacher,admin`) in
  better-auth's `role` column. A conflicting set refuses the sign-in with
  the error `role_conflict`, shown on the sign-in page and logged with the
  provider id only. `OIDC_DEFAULT_ROLE` stays a single-role fallback.
- Every write of a role set passes the same check in a better-auth
  `databaseHooks.user` hook (`src/server/role-guard.ts`): the IdP sync, the
  seed, and the admin plugin's create-user, set-role and update-user.
- A stored set that is not allowed (written around eduLIMS, straight into
  the database) gives the session no roles at all: fail closed.

### The portal is in the URL

- The portal is the first path segment (`/teacher/…`, `/admin/…`). The
  sidebar shows the navigation of that portal only, and the breadcrumb starts
  with it. There is no "active role" state.
- The portal switcher shows the current portal's icon and name. With two
  portals it opens a menu of them; with one it is a plain heading without a
  menu. On the collapsed rail it shows the icon, with the name as a tooltip.
- Each portal in the menu has a shortcut, Alt+1 and Alt+2 (⌥1 and ⌥2 on
  macOS), listed in the menu and announced through `aria-keyshortcuts`.
  Browsers keep Ctrl+digit and ⌘+digit for switching tabs and do not pass
  them to the page reliably, so the shortcuts use Alt. A key press in a text
  field is left alone.

### The landing portal

- A nullable `last_portal` column on better-auth's `user` table (migration
  `0003_user_last_portal`, a `CHECK` to the portal names) holds the portal
  the user last picked in the switcher. The POST server function
  `saveLastPortal` writes it after checking the session, the input (Zod) and
  that the user holds that role. Navigating by any other way does not
  change it.
- `/` and the post-login redirect use the saved portal while the user still
  holds its role; otherwise they fall back to teacher, then admin, then
  student.

## Consequences

- Good: a teacher who is also an administrator signs in once and reaches
  both portals, and every access check stays as narrow as before.
- Good: the identity provider can grant roles directly, through groups or
  both (Entra ID app roles assigned to groups, Keycloak groups and composite
  roles); eduLIMS reads the effective roles from the ID token.
- Bad: a person who is both a student and a teacher (a teaching assistant)
  needs two accounts. That is the point of the rule: student data stays
  apart from staff access.
- Bad: one more column on the user table and one more server function.
- Open: some Linux browsers also bind Alt+digit to tab switching. Whether
  the page's handler wins there is not yet tested; the menu works either way.
  Windows menu-bar access keys use Alt with a letter, not a digit.

### Options not chosen

- **Any combination** would let one session hold student and teacher access
  together, so a mistake in one ownership filter could show a student
  another student's work. The owner ruled it out.
- **One role only** drops access a person needs, and the highest-role rule
  made admin outrank teacher when they grant unrelated powers.
- **One combined sidebar** shows every portal's sections at once, which
  makes the sidebar long and hides which portal a page belongs to. The owner
  chose the switcher.
