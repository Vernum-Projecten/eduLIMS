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

The highest-scored risk in the requirements analysis is "een student ziet
cijfers of resultaten van anderen" (score 6), answered by "toegang per rol en
filter op eigen gegevens in de API (S7, D3)". The quality requirement is
"inloggen alleen via SSO, toegang per rol", accepted when an OWASP Top 10
check finds no open endpoint without login. This file is how the code meets
both.

## Sign-in: Microsoft Entra ID through better-auth (S1)

- **better-auth** is the auth library (<https://better-auth.com/docs>), with
  Microsoft Entra ID as the OpenID Connect provider: authorization code flow
  with PKCE, the Hanze tenant only. Answer better-auth questions from its docs
  (the `better-auth` MCP server) at the installed version, never from memory.
- The better-auth handler is mounted as a server route under `/api/auth/*`;
  the session lives in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. No
  token is ever stored in `localStorage` or exposed to client code.
- **There is no local password login** in production. The plan of approach
  allows a temporary local login while the Entra app registration is pending;
  if one exists, it is enabled only when `NODE_ENV !== "production"` and an
  explicit flag is set, and a test proves it is off in a production build.
- The client id, client secret, tenant id and the better-auth secret come from
  the environment (`.env`, never committed; `.env.example` lists the names
  with empty values).

## Roles: student, docent, beheerder (B1)

- A user has exactly the roles the database says (B1: "een beheerder kent een
  rol toe; de gebruiker ziet direct alleen de schermen van die rol"). Roles may
  be seeded from Entra app roles or groups, but the eduLIMS database is the
  source the checks read, so a role change applies on the next request.
- **Authorisation is enforced on the server, in every server function and
  server route, before any data is read.** Use the shared middleware
  (`requireSession`, `requireRole("docent")`) from `src/server/auth/`. A
  route `beforeLoad` guard is navigation UX and never the security boundary.
- **Ownership is checked, not just role.** A docent reads only the practica
  they own or are linked to (D3: "niet die van practica van andere
  docenten"). A student reads only their own samples, submissions and grades
  (S7: "ziet alleen zijn eigen cijfer"). An id from the client (a practicum
  id, a sample id) is checked against the session user in the same query
  (`where practicum.owner_id = :userId`), never fetched first and filtered
  after.
- **Aggregates leak too.** An average is shown only from 5 assessments up
  (risk analysis), and the KPI queries apply the same ownership filter as the
  detail queries.
- Every role-scoped server function has a **negative test** per role that
  proves the refusal (a student calling a docent function gets 403, a docent
  reading another docent's practicum gets 404 or 403), using the fixed
  pseudonymised test accounts (`testing.md`).

## Privacy (AVG)

- **Never real personal data** in code, fixtures, seeds, logs, screenshots,
  issues or PRs. The test set uses invented students with pseudonyms.
- **Only pseudonyms in FerroEHR.** The EHR subject is a pseudonym per test
  subject; no name, student number or e-mail address is ever written into a
  composition or an AQL query (requirements, "Privacy": "In de CDR staat geen
  naam of studentnummer"). The mapping from student to pseudonym lives only
  in the eduLIMS database.
- **Logs carry ids, not people:** a user id, a sample id, a request id. Never
  a name, an e-mail, a grade, a token or a request body.
- The audit log (B4, and the KPI dashboard's "openen en exporteren komt in
  het logboek") records who did what, with the user id.

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
- Reject the whole file with Dutch, row-level messages when any sample ID is
  unknown or any well position is invalid (S4 acceptance criterion); write
  nothing to FerroEHR from a rejected file.
