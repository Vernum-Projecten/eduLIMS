---
name: multiple-roles
description: "A user holds a role set: {student}, {teacher}, {admin} or {teacher, admin}; student is exclusive; roles are a set, not a ranking; portal switcher with the portal in the URL and the last-used portal saved on the account; owner 2026-11-11"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Owner decisions of 2026-11-11, recorded in ADR 0012:

- **Allowed role sets:** {student}, {teacher}, {admin}, {teacher, admin}.
  Student is never combined with teacher or admin. A conflicting IdP claim
  refuses the sign-in with `role_conflict`; every role write passes
  `validateRoleSet` (`src/lib/roles.ts`) through the better-auth database
  hook in `src/server/role-guard.ts`.
- **Roles are a set, not a ranking.** Admin does not include teacher or the
  other way round. Every server function checks the one role it needs; an
  administrator still has no access to grades or results (R-01).
- **Display:** the portal switcher at the top of the sidebar, from the
  shadcn sidebar-07 `TeamSwitcher`, kept close to the original
  (`src/components/shell/portal-switcher.tsx`). One portal: a plain heading,
  no menu. Shortcuts must really work on every platform: Alt+digit (⌥ on
  macOS), because browsers keep Ctrl/⌘+digit for tabs.
- **The portal is the URL** (`/teacher/…`), never a hidden active role. The
  breadcrumb starts with it.
- **Landing portal:** the one last picked in the switcher, saved in
  `user.last_portal`; fallback teacher, then admin, then student; a saved
  portal the user no longer holds is ignored.
- **Dev data:** `teacher-admin@example.test` (dev login) and the Keycloak
  realm users with roles from groups, direct roles, both, a conflict and no
  role. The realm is imported only when the Keycloak container is created.
