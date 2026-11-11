---
paths:
  - "src/server/**"
  - "src/routes/**"
  - "src/start.ts"
  - "src/lib/**"
  - "docker/**"
  - ".env.example"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Authentication, authorisation and security

The highest-scored risk in the requirements is R-01, "a student sees grades
or results of others" (score 6), answered by "access per role and a filter on
own data in the API (S7, D3)". The quality requirement Q-SEC-1 is "sign-in
only through SSO; access per role", accepted when an OWASP Top 10
check finds no open endpoint without login. This file is how the code meets
both.

## Sign-in: Entra ID or Keycloak through better-auth (S1, ADR 0010)

- **better-auth** is the auth library (<https://better-auth.com/docs>), with
  OpenID Connect providers only: Microsoft Entra ID (the institution's tenant only,
  `socialProviders.microsoft`) and Keycloak (`genericOAuth` with the
  `keycloak()` helper), each on when its variables are set, at least one in
  production. Authorization code flow with PKCE. Never add provider-specific
  logic outside `src/server/auth.ts` and the role-mapping module. Answer better-auth questions from its docs
  (the `better-auth` MCP server) at the installed version, never from memory.
- The better-auth handler is mounted as a server route under `/api/auth/*`;
  the session lives in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. No
  token is ever stored in `localStorage` or exposed to client code.
- **There is no local password login** in production. A temporary local login
  may exist while the identity provider registration is pending (risk P-01);
  if one exists, it is enabled only when `NODE_ENV !== "production"` and an
  explicit flag is set, and a test proves it is off in a production build.
- The client id, client secret, tenant id and the better-auth secret come from
  the environment (`.env`, never committed; `.env.example` lists the names
  with empty values).

## Roles: student, teacher, admin (B1)

- A user has exactly the roles the database says (B1: "an administrator
  assigns a role; the user immediately sees only the screens of that role").
  The role names are `student`, `teacher` and `admin`. Roles may
  be seeded from the provider's role claim on every OIDC sign-in
  (`OIDC_ROLE_CLAIM`, `OIDC_ROLE_MAP`; no mapped role means no access unless
  `OIDC_DEFAULT_ROLE` is set), and the eduLIMS database is the source the
  checks read. Who owns role assignment (provider vs Admin portal, B1) is an
  open owner question in ADR 0010; do not build role editing before it is
  answered.
- **A user holds a role set, not a ranking** (ADR 0012). The allowed sets
  are {student}, {teacher}, {admin} and {teacher, admin}; student is never
  combined with another role. `validateRoleSet` (`src/lib/roles.ts`) is the
  one rule: the IdP sync refuses a conflicting set with `role_conflict`,
  every role write passes the better-auth `databaseHooks.user` guard
  (`src/server/role-guard.ts`), and a stored conflicting set gives the
  session no roles. No role implies another: check the specific role a
  function needs (`requireRole("teacher")`), never "admin or higher". An
  administrator who is also a teacher reaches results only as a teacher, of
  their own practicals.
- **The portal is in the URL** (`/teacher/…`); there is no active-role
  state. The saved `last_portal` picks only the landing page and grants
  nothing.
- **Authorisation is enforced on the server, in every server function and
  server route, before any data is read.** Use the shared middleware
  (`requireSession`, `requireRole("teacher")`) from `src/server/auth/`. A
  route `beforeLoad` guard is navigation UX and never the security boundary.
- **Ownership is checked, not just role.** A teacher reads only the
  practicals they own or are linked to (D3: "not those of practicals of other
  teachers"). A student reads only their own samples, submissions and grades
  (S7: "sees only their own grade"). An id from the client (a practical id,
  a sample id) is checked against the session user in the same query
  (`where practical.owner_id = :userId`), never fetched first and filtered
  after.
- **Aggregates leak too.** An average is shown only from 5 assessments up
  (R-03), and the KPI queries apply the same ownership filter as the
  detail queries.
- Every role-scoped server function has a **negative test** per role that
  proves the refusal (a student calling a teacher function gets 403, a teacher
  reading another teacher's practical gets 404 or 403), using the fixed
  pseudonymised test accounts (`testing.md`).

## Privacy (GDPR)

- **Never real personal data** in code, fixtures, seeds, logs, screenshots,
  issues or PRs. The test set uses invented students with pseudonyms.
- **Only pseudonyms in FerroEHR.** The EHR subject is a pseudonym per test
  subject; no name, student number or e-mail address is ever written into a
  composition or an AQL query (requirements, "Privacy": "In de CDR staat geen
  naam of studentnummer"). The mapping from student to pseudonym lives only
  in the eduLIMS database.
- **Logs carry ids, not people:** a user id, a sample id, a request id. Never
  a name, an e-mail, a grade, a token or a request body.
- The audit log (B4, and the KPI dashboard's "opening the dashboard and
  every export are logged") records who did what, with the user id.

## OWASP Top 10 checklist for every change

Hold each server-side change to the OWASP Top 10:2025
(<https://owasp.org/Top10/2025/>); the `security-reviewer` agent checks a
diff against it.

- **A01 Broken Access Control:** session, role and ownership checked in the
  handler; no IDOR through a guessable id; deny by default. The FerroEHR and
  FerroBRIDGE base URLs come from configuration, never from a request (SSRF
  is part of A01 in this edition).
- **A02 Security Misconfiguration:** security headers (CSP, HSTS,
  `X-Content-Type-Options`, `frame-ancestors`), no default credentials in
  Compose, no debug endpoints in a production build.
- **A03 Software Supply Chain Failures:** exact versions, the frozen
  lockfile, Dependabot, pinned action SHAs and image digests, the image scan
  in CI (`ci-cd.md`).
- **A04 Cryptographic Failures:** HTTPS only (the reverse proxy terminates
  TLS); secrets only in the environment; cookies `Secure`.
- **A05 Injection:** SQL only through Kysely's query builder or `sql`
  template tags with bound parameters, never string concatenation; AQL
  parameters through the `query_parameters` of the openEHR REST API, never
  interpolated (`integration.md`); React escapes output, and
  `dangerouslySetInnerHTML` is banned.
- **A06 Insecure Design:** irreversible actions (submitting a lab report, S6;
  finalising a grade, D4) are explicit, confirmed, and enforced on the server
  (a submitted report rejects edits even from a crafted request).
- **A07 Authentication Failures:** SSO only, session rotation on sign-in,
  sign-out invalidates the server session.
- **A08 Software or Data Integrity Failures:** CSRF protection on every
  non-GET server function (TanStack Start's `createCsrfMiddleware` or
  better-auth's origin check); uploads are parsed, never executed.
- **A09 Security Logging and Alerting Failures:** failed sign-ins, refused
  authorisation and rejected uploads are logged (without personal data); B3
  shows an unreachable FerroEHR or FerroBRIDGE within 5 minutes.
- **A10 Mishandling of Exceptional Conditions:** a failure fails closed (an
  unreachable FerroEHR never shows another student's cached data, a failed
  role lookup denies); no stack trace or SQL text reaches the client.

## Uploads (S4)

- Accept only `.xlsx` up to a configured size limit, check the content (a
  zip with the expected workbook parts), and parse with a maintained library
  in a server function. Never trust the file name or the MIME type alone.
- Reject the whole file with translated, row-level messages when any sample ID is
  unknown or any well position is invalid (S4 acceptance criterion); write
  nothing to FerroEHR from a rejected file.
