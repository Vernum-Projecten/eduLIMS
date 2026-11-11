---
name: owner-delegated-decisions-2026-11-11
description: "Decisions the maintainer made on 2026-11-11 on the owner's delegation: classes and invitations (#28), the Admin portal (#32), and security hardening (#39 to #44); legal and product-owner decisions stay with the product owner"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

On 2026-11-11 the owner delegated a set of open decisions to the maintainer.
Each is recorded as a "Decision" comment on its issue; the issue is the
authority, this file is the index. Cite the issue number, not this file.

## Classes, lab groups and invitations (#28)

- Teachers create their own classes; administrators can also create one on a
  teacher's behalf (choosing the owner), and both can import a roster from
  CSV (B2).
- A pending, unexpired invitation grants only the app role `student`, and only
  to the verified email it names, when the identity provider sends no eduLIMS
  role. Teacher and admin always come from the identity provider or an
  administrator.
- Only the class owner invites co-teachers; co-teachers invite students.
- Invitations are valid for 30 days; accepted, expired and canceled
  invitations are deleted after 90 days.
- A join code comes in its own issue, #49, with high priority: it is the
  fallback for a student who signs in with another address.
- Group grading: one group grade from the rubric, with an optional
  per-student adjustment and comment. A class can have several group sets.
  Students never form or join groups themselves; teachers assign them.
- **No email and no SMTP.** Invitations are created and stay pending; a
  student joins every class that invited their verified email when they sign
  in. The teacher shares a translated "Copy invitation text" through their own
  channel.

## Admin portal (#32)

- **Role ownership (B1) is hybrid.** When the identity provider sends a
  mapped eduLIMS role it is authoritative and synced at every sign-in; when it
  sends none, the roles an administrator assigned in eduLIMS apply. Every role
  shows its source (Entra ID, Keycloak, Local). Changing one's own roles stays
  refused, and role editing (#34) covers local roles only.
- **Blocking:** better-auth `ban` with a reason and an optional end date; a
  block also refuses SSO sign-in.
- **Retention:** the activity log 12 months; ended sessions deleted after 30
  days.
- **Break-glass:** no permanent `adminUserIds`; a host-only
  `pnpm admin:grant <email>` (#48) grants the admin role and writes the
  activity log.
- `last-login-method`: yes, in the user detail sheet and as a login hint
  (#34). `open-api`: development only (#36).
- SCIM (#45), the better-auth SSO plugin (#46) and GDPR erasure (#47) each
  have their own issue in milestone v0.1.0; #46 is decided in ADR 0015
  ([[runtime-identity-providers]]).

## Security hardening (#39 to #44)

- **#39:** cross-provider account linking is off; the same email from Entra
  ID and Keycloak never merges into one account (`account_not_linked`).
- **#40:** verified TLS to PostgreSQL in production (`sslmode=verify-full`);
  FerroEHR and FerroBRIDGE stay plain on the single-host internal network as
  an accepted residual risk, ADR 0013, revisited on a second host.
- **#41:** `Cache-Control: no-store` on every session-dependent response in
  production.
- **#42:** sessions last 8 hours sliding (refreshed at most hourly), 24 hours
  at most after sign-in; ADR 0014.
- **#43:** the `__Host-` prefix in production for the session and the
  preference cookies.
- **#44:** shipping security logs off the host is optional and documented,
  depending on the institution's log platform.

## Still with the product owner

The maintainer did not decide, and nobody may assume: the GDPR legal basis,
the DPIA, who or what the EHR subject is, and the KPI norms. These remain
open questions for the product owner ([[requirements-are-draft]]).
