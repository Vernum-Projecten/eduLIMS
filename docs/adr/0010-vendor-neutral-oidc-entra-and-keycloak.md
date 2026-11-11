<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0010. Vendor-neutral sign-in: Microsoft Entra ID and Keycloak

- Status: Superseded by [0015](0015-runtime-identity-providers.md)
- Date: 2026-11-11
- Deciders: maintainer
- Amends: [0005](0005-better-auth-entra-id.md)

## Context and problem statement

ADR 0005 chose better-auth with Microsoft Entra ID, the identity provider of
the first target institution. Tying eduLIMS to one vendor makes it harder to run the system
elsewhere (another institution, a lab without Entra, a local test setup) and
puts the role model in one vendor's terms. FerroEHR already uses Keycloak as
its development identity provider. Which identity providers does eduLIMS
support, and where does a user's role come from?

## Decision

eduLIMS signs in through OpenID Connect only (authorization code flow with
PKCE) and supports two providers, each switched on by its own environment
variables. Either one or both can be active, and a production start refuses
to run with none.

| Provider | better-auth mechanism | Variables | Redirect URI |
|---|---|---|---|
| Microsoft Entra ID | `socialProviders.microsoft`, single tenant | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` | `<BETTER_AUTH_URL>/api/auth/callback/microsoft` |
| Keycloak (26.x) | `genericOAuth` plugin, `keycloak()` helper, discovery from the issuer | `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_LABEL` | `<BETTER_AUTH_URL>/api/auth/callback/keycloak` |

The role comes from the identity provider. On every OIDC sign-in eduLIMS reads
a claim from the verified ID token (`OIDC_ROLE_CLAIM`, a dot path; the default
is `roles` for Entra app roles and `realm_access.roles` for Keycloak realm
roles), translates the provider's role names through `OIDC_ROLE_MAP` (default
`edulims-student:student,edulims-teacher:teacher,edulims-admin:admin`),
and stores the mapped role set on the user. (Amended 2026-11-11 by
[ADR 0012](0012-multiple-roles-and-portal-switcher.md): every mapped value
counts, the allowed sets are student, teacher, admin, and teacher with admin,
and a conflicting set refuses the sign-in with `role_conflict`. The highest-role
rule is gone.) A sign-in with no
mapped role is refused unless `OIDC_DEFAULT_ROLE` names a fallback. No
standard governs the claim layout; this mapping is our own design.

The development login (email and password, `EDULIMS_DEV_LOGIN`) is unchanged
and is refused in production.

## Consequences

- Good: no vendor lock-in; any OIDC provider with a role claim can be added
  the same way, and the role names live in configuration, not code.
- Good: the role is decided by the institution's identity management, so a
  student cannot obtain a teacher role inside eduLIMS.
- Bad: two providers to test. The role mapping is unit-tested; a real sign-in
  with each provider is tested once the app registration and realm exist.
- Open: requirement B1 says an administrator assigns roles in the Admin portal.
  With roles synchronised from the provider on every sign-in, a role set in
  eduLIMS is overwritten at the next sign-in. Whether roles are owned by the
  provider, by eduLIMS, or by the provider with an eduLIMS override is a
  question for the product owner (see `docs/requirements.md`, a working draft).
