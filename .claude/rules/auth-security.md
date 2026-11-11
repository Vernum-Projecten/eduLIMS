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

## Sign-in: runtime identity providers through better-auth (S1, ADR 0015)

- **better-auth** is the auth library (<https://better-auth.com/docs>), with
  the **SSO plugin** (`@better-auth/sso`, the same exact version as
  better-auth) for every identity provider: OIDC (Entra ID, Keycloak, any
  OpenID provider) and SAML 2.0. Providers live in the database
  (`ssoProvider` plus eduLIMS's `identity_provider`), managed in Admin →
  System → Identity providers and by the host CLI (`idp add`), both through
  the one service `src/server/idp/service.ts`. Nothing about a provider is in
  the environment. Answer better-auth questions from its docs (the
  `better-auth` MCP server) and the installed package source, never from
  memory.
- **The plugin's management endpoints stay unreachable** (`/sso/register`,
  `/sso/update-provider`, `/sso/delete-provider`, `/sso/providers`,
  `/sso/get-provider`, domain verification): `disabledPaths`, a before-hook
  lock (`src/server/idp/sso-guards.ts`) and `providersLimit: 0`. Never
  enable `defaultSSO`, `domainVerification`, `trustEmailVerified`,
  `trustedProviders`, a shared `redirectURI` or organisation provisioning.
  `/sign-in/sso` takes a provider id only.
- **Fixed security settings, never options:** PKCE S256 and the scopes
  `openid email profile`; no UserInfo endpoint, so role claims come from the
  verified ID token; signed SAML assertions, timestamps, InResponseTo, no
  IdP-initiated sign-in, a persistent NameID. A disabled provider is refused
  at the start, the callback and the ACS, and again in the sign-in gate.
- **Secrets at rest:** client secrets and SAML keys are sealed with
  AES-256-GCM under `EDULIMS_DATA_KEY` (`src/server/idp/crypto.ts`) by the
  wrapped adapter (`src/server/idp/encrypted-adapter.ts`); they are
  write-only in the UI and never leave the server. A decrypt failure fails
  closed and logs `crypt_decrypt_fail`. No IdP token is kept in the clear:
  the account hooks (`src/server/idp/account-tokens.ts`) drop the access and
  refresh tokens and seal the ID token for `id_token_hint`.
- **SSRF:** an issuer or metadata URL is fetched only after
  `checkFetchOrigin` (https in production, no private address unless the
  operator lists the origin in `EDULIMS_IDP_PRIVATE_ORIGINS`).
  `trustedOrigins` is the app origin, the stored https issuers and that list.
- The better-auth handler is mounted as a server route under `/api/auth/*`;
  the session lives in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. No
  token is ever stored in `localStorage` or exposed to client code.
- **There is no local password login** in production. A temporary local login
  may exist while the identity provider registration is pending (risk P-01);
  if one exists, it is enabled only when `NODE_ENV !== "production"` and an
  explicit flag is set, and a test proves it is off in a production build.
- The better-auth secret and the data key come from the environment (`.env`,
  never committed; `.env.example` lists the names with empty values). The
  first provider and the first administrator come from the host CLI
  (`idp add`, `admin grant`, docs/deployment.md "First start"), never from a
  setup page.

## Roles: student, teacher, admin (B1)

- A user has exactly the roles the database says (B1: "an administrator
  assigns a role; the user immediately sees only the screens of that role").
  The role names are `student`, `teacher` and `admin`. Roles may
  be seeded from the provider's role claim on every SSO sign-in (each
  provider's role claim, role map and default role; no mapped role means no
  access unless the provider has a default role or a pending admin grant
  waits), and the eduLIMS database is the source the checks read. Role ownership is **hybrid** (owner decision on #32): a
  mapped role the IdP sends is authoritative and replaces the set, with the
  provider id stored in `user.role_source`; without one, a set an administrator
  assigned in eduLIMS (`role_source = 'local'`) applies
  (`src/server/role-ownership.ts`). Only a local set is editable in the
  Admin portal (`setLocalRoles`, which writes its `authz_role_change` row in
  the same transaction).
- **A user holds a role set, not a ranking** (ADR 0012). The allowed sets
  are {student}, {teacher}, {admin} and {teacher, admin}; student is never
  combined with another role. `validateRoleSet` (`src/lib/roles.ts`) is the
  one rule: the IdP sync refuses a conflicting set with `role_conflict`,
  every role write passes the better-auth `databaseHooks.user` guard
  (`src/server/role-guard.ts`), and a stored conflicting set gives the
  session no roles. A `CHECK` on `user.role` (migration
  `0004_user_role_check`) holds the same sets in their stored form, because
  better-auth's admin permission check splits the raw string. Nobody changes
  their own roles: the `hooks.before` guard `refuseOwnRoleWrites` answers a
  `set-role` or `update-user` `data.role` on the session user's own id with
  403 `cannot_change_own_roles` (owner decision on #32), and `setLocalRoles`
  refuses the same. A sign-in refused for no role or a role conflict also revokes
  that user's live sessions (A07). No role implies another: check the specific role a
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

## The OWASP baseline for every change

The baseline is **OWASP ASVS 5.0 Level 2**, read from the copies in
`docs/security/vendor/` (never the web; `docs/security/README.md`). The
status of every requirement is in `docs/security/asvs-5.0-applicability.md`:
a change that meets a row moves it to `met` and cites its test. Look a
requirement or a cheat sheet up with `/owasp-lookup`; the `security-reviewer`
agent checks a diff against the same copies. Cheat sheets below are files in
`docs/security/vendor/cheatsheets/` without `_Cheat_Sheet.md`.

The Top 10:2025 (`docs/security/vendor/top10/`, mapped in
`docs/security/top-10-2025-mapping.md`) as the checklist, with the ASVS ids
each point answers:

- **A01 Broken Access Control (V8.2, V8.3.1, V8.4.1):** session, role and
  ownership checked in the handler; no IDOR through a guessable id; deny by
  default. The FerroEHR and FerroBRIDGE base URLs come from configuration,
  never from a request (SSRF, V1.3.6). Sheets: Authorization,
  Insecure_Direct_Object_Reference_Prevention, Multi_Tenant_Security.
- **A02 Security Misconfiguration (V3.4, V13.4, V14.3.2):** security headers
  (CSP, HSTS, `X-Content-Type-Options`, `frame-ancestors`), no default
  credentials in Compose, no debug endpoints in a production build. Sheets:
  HTTP_Headers, Content_Security_Policy, Docker_Security.
- **A03 Software Supply Chain Failures (V15.1, V15.2):** exact versions, the
  frozen lockfile, Dependabot, pinned action SHAs and image digests, the image
  scan in CI (`ci-cd.md`). Sheet: Software_Supply_Chain_Security.
- **A04 Cryptographic Failures (V11, V12.2):** HTTPS only (the reverse proxy
  terminates TLS); secrets only in the environment; cookies `Secure`. Sheets:
  Secrets_Management, Transport_Layer_Security.
- **A05 Injection (V1.2, V1.3, V1.5.1):** SQL only through Kysely's query
  builder or `sql` template tags with bound parameters, never string
  concatenation; AQL parameters through the `query_parameters` of the openEHR
  REST API, never interpolated (`integration.md`); React escapes output, and
  `dangerouslySetInnerHTML` is banned. Sheets: Query_Parameterization,
  Cross_Site_Scripting_Prevention, XML_External_Entity_Prevention.
- **A06 Insecure Design (V2.3):** irreversible actions (submitting a lab
  report, S6; finalising a grade, D4) are explicit, confirmed, and enforced on
  the server (a submitted report rejects edits even from a crafted request).
  Sheets: Threat_Modeling, Abuse_Case.
- **A07 Authentication Failures (V6.3, V6.8, V7.2, V7.4, V10.5):** SSO only,
  a new session on sign-in, sign-out invalidates the server session. Two IdPs
  must not take over each other's accounts (V6.8.1). Sheets: Authentication,
  Session_Management, OAuth2.
- **A08 Software or Data Integrity Failures (V3.5.1, V5.2):** CSRF protection
  on every non-GET server function (TanStack Start's `createCsrfMiddleware` or
  better-auth's origin check); uploads are parsed, never executed. Sheets:
  Cross-Site_Request_Forgery_Prevention, File_Upload.
- **A09 Security Logging and Alerting Failures (V16.2.5, V16.3):** failed
  sign-ins, refused authorisation and rejected uploads are logged (without
  personal data); B3 shows an unreachable FerroEHR or FerroBRIDGE within 5
  minutes. Sheets: Logging, Logging_Vocabulary.
- **A10 Mishandling of Exceptional Conditions (V16.5):** a failure fails
  closed (an unreachable FerroEHR never shows another student's cached data,
  a failed role lookup denies); no stack trace or SQL text reaches the client.
  Sheet: Error_Handling.

Server functions are an API: hold them to the API Security Top 10 2023 too
(`docs/security/api-top-10-2023-mapping.md`).

## Uploads (S4; ASVS V5, sheet File_Upload)

- Accept only `.xlsx` up to a configured size limit, check the content (a
  zip with the expected workbook parts), and parse with a maintained library
  in a server function. Never trust the file name or the MIME type alone.
  Check the unpacked size and the entry count before unzipping (V5.2.3), and
  parse the workbook XML with external entities off (V1.5.1).
- Reject the whole file with translated, row-level messages when any sample ID is
  unknown or any well position is invalid (S4 acceptance criterion); write
  nothing to FerroEHR from a rejected file.
