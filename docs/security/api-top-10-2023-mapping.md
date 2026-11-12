<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# OWASP API Security Top 10 2023 mapping

eduLIMS has an API even without a public REST interface: every
`createServerFn` is an HTTP endpoint the browser calls with JSON, the
better-auth routes live under `/api/auth/*`, `/api/health` and `/api/ready`
are public, and eduLIMS is itself an API client of FerroEHR (openEHR REST and
AQL) and FerroBRIDGE. A crafted request reaches a server function as
directly as the UI does, so each risk below applies to it. The risk text is
vendored in [vendor/api-security/](vendor/api-security/); the ASVS ids point
into the [applicability table](asvs-5.0-applicability.md).

| Risk | eduLIMS today | Still to do | ASVS | Cheat sheets |
|---|---|---|---|---|
| [API1 Broken Object Level Authorization](vendor/api-security/0xa1-broken-object-level-authorization.md) | ids from the client are never trusted alone; `canViewResultsOf` is the rule (`src/server/authz.ts`); every SCIM resource is scoped to the provider of its token (ADR 0017) | every id checked against the session user in the same SQL query (S7, D3, #28); a negative test per role | V8.2.2, V8.4.1 | Insecure_Direct_Object_Reference_Prevention, Authorization, Multi_Tenant_Security |
| [API2 Broken Authentication](vendor/api-security/0xa2-broken-authentication.md) | every server function behind `authMiddleware` (401 without a session); SSO only; better-auth rate limits `/api/auth/*`; the SCIM endpoint takes a hashed, revocable bearer token per identity provider and refuses a disabled provider's (ADR 0017) | an account linking policy between the IdPs (V6.8.1); session lifetime decisions (V7.3) | V6.3, V6.8, V7.2 | Authentication, Session_Management, OAuth2 |
| [API3 Broken Object Property Level Authorization](vendor/api-security/0xa3-broken-object-property-level-authorization.md) | `getSessionUser` returns a minimal projection (`src/server/session.ts`); Zod strips unknown keys; `input: false` on server-written user fields (`src/server/auth.ts`) | field-level rules for grades, feedback and results (S7, D3, D4) | V8.2.3, V15.3.1, V15.3.3 | Mass_Assignment, Input_Validation |
| [API4 Unrestricted Resource Consumption](vendor/api-security/0xa4-unrestricted-resource-consumption.md) | better-auth's rate limit on `/api/auth/*` in production; a rate limit per token and a 1 MiB body cap on the SCIM endpoint (`src/server/scim/gate.ts`) | upload size and unpacked-size limits (S4); limits on KPI queries (D5); rate limits on server functions (V2.4.1) | V2.4.1, V5.2.1, V5.2.3, V15.2.2 | Denial_of_Service, File_Upload |
| [API5 Broken Function Level Authorization](vendor/api-security/0xa5-broken-function-level-authorization.md) | `requireRole` per function, never "admin or higher" (ADR 0012); nobody writes their own roles (`refuseOwnRoleWrites`) | the same check on every new Teacher and Admin portal function, with its negative test | V8.2.1, V8.3.1 | Authorization, Authorization_Testing_Automation |
| [API6 Unrestricted Access to Sensitive Business Flows](vendor/api-security/0xa6-unrestricted-access-to-sensitive-business-flows.md) | sign-up off; invitations do not exist yet | invitation sending limits and bulk invite checks (#28); the S6 hand-in lock | V2.3, V2.4.1 | Abuse_Case, Email_Validation_and_Verification |
| [API7 Server Side Request Forgery](vendor/api-security/0xa7-server-side-request-forgery.md) | FerroEHR and FerroBRIDGE base URLs from the environment only (`src/server/env.ts`); the Keycloak issuer must be `https` in production | the integration client refuses redirects and builds paths from validated ids only (V15.3.2) | V1.3.6, V13.2.4, V15.3.2 | Server_Side_Request_Forgery_Prevention |
| [API8 Security Misconfiguration](vendor/api-security/0xa8-security-misconfiguration.md) | security headers on every response; no CORS headers; `GET` only for reads, `POST` for writes; health endpoints return no internals | `Cache-Control: no-store` on server function responses (V14.3.2); TLS inside Compose (V12.3) | V3.4, V3.5.3, V13.4.5, V14.3.2 | HTTP_Headers, REST_Security |
| [API9 Improper Inventory Management](vendor/api-security/0xa9-improper-inventory-management.md) | server functions per area under `src/server/<area>/functions.ts`; public routes under `src/routes/api/` | a written inventory of endpoints and integrations (V13.1.1) | V13.1.1, V15.2.3 | REST_Security |
| [API10 Unsafe Consumption of APIs](vendor/api-security/0xaa-unsafe-consumption-of-apis.md) | nothing consumed yet besides the IdPs through better-auth | validate every FerroEHR and FerroBRIDGE response with Zod; time-outs; no redirects; pseudonyms only (Q-PRIV-1) | V12.3.2, V15.3.2, V16.5.2 | Input_Validation, REST_Security, Error_Handling |

The cheat sheet names are the file names in
[vendor/cheatsheets/](vendor/cheatsheets/) without `_Cheat_Sheet.md`.
