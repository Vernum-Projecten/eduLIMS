<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0015. Identity providers at runtime with the better-auth SSO plugin

- Status: Proposed
- Date: 2026-11-11
- Deciders: maintainer (design on #46, made on the owner's delegation)
- Supersedes: [0010](0010-vendor-neutral-oidc-entra-and-keycloak.md)

## Context and problem statement

ADR 0010 configured Microsoft Entra ID and Keycloak in the environment: one
fixed set of variables per vendor, one role claim and role map for all of
them, and a redeploy for every change. An institution may only offer SAML
through its federation, a second institution needs a second provider, and a
compromised identity provider must be switched off by an administrator, not
by an operator editing `.env`. How does eduLIMS manage identity providers, and
how does it keep their secrets and the role model safe while doing so?

## Considered options

1. **Keep the environment configuration** and add SAML variables.
2. **The better-auth SSO plugin with its own management endpoints**, as the
   plugin documents it.
3. **The SSO plugin for the sign-in flows, with the providers managed by
   eduLIMS's own admin service** and the plugin's management endpoints off.
4. **The plugin's `defaultSSO`** (providers defined in code from the
   environment) for the first provider, and the database for the rest.

## Decision

Option 3, with `@better-auth/sso` and `better-auth` both at exactly 1.7.20.

- **Providers live in the database**, managed in Admin → System → Identity
  providers and by the host CLI (`idp add`, `idp list`, `idp enable`,
  `idp disable`, `idp rekey`), both through one service
  (`src/server/idp/service.ts`) that validates, discovers, encrypts and writes
  the activity log in one transaction. `ssoProvider` holds the plugin's
  configuration; `identity_provider` holds eduLIMS's settings (enabled, name
  per locale, icon, order, role claim, role map, default role, "email is
  authoritative", the discovered end-session endpoint); and
  `identity_provider_domain` the email domains. The provider id is a slug and
  never changes: it is in the callback and ACS URLs and in every account.
- **The plugin's management endpoints are unreachable.** `/sso/register` is
  open to any signed-in user, and update, delete and get allow only a row's
  creator. They are in better-auth's `disabledPaths`, refused again by a
  before hook, and `providersLimit` is 0. Only `/sign-in/sso`, the OIDC
  callback, the SAML ACS, the SP metadata and single logout stay open.
  `/sign-in/sso` takes a provider id only: no routing by email or domain, no
  caller scopes, no extra authorization parameters.
- **No `defaultSSO`.** It takes precedence over the database and cannot be
  disabled, tested or edited from the screen, and it keeps secrets in `.env`.
  The first provider and the first administrator come from the host CLI
  (`idp add`, `admin grant`, #48), which needs host access; a first-run page
  would be a race to claim a freshly exposed instance.
- **Fixed security settings.** OIDC always uses PKCE S256 and the scopes
  `openid email profile`, and the provider is stored without a UserInfo
  endpoint, so the role claims are the verified ID token's (Entra ID's
  UserInfo has no `roles`). SAML requires signed assertions, timestamps,
  InResponseTo, no IdP-initiated sign-in, no deprecated algorithms and a
  persistent NameID: the metadata must list it, and a response with another
  NameID format is refused at the sign-in gate. Single-logout requests and
  responses must be signed (`wantLogoutRequestSigned`,
  `wantLogoutResponseSigned`). The issuer must match the discovery document
  exactly (mix-up defence), and the endpoints must share its origin.
- **PKCE must be enforced, not only sent.** The plugin sends no `nonce` (#74),
  so PKCE is the one binding between the browser that started a sign-in and
  the code that finishes it; it stops an injected code only when the IdP
  refuses a code exchange without the matching verifier. A provider is
  saved only when its discovery document lists `S256` in
  `code_challenge_methods_supported`, or when an administrator attests per
  provider that the IdP enforces S256 (`identity_provider.attest_pkce`, off
  by default, a warning in the form, `attest_pkce` in the activity log).
  eduLIMS cannot verify an attestation: a wrong one leaves OIDC code
  injection open for that provider until #74 brings the nonce.
- **A changed issuer needs a new secret.** An edit that changes the issuer
  at all, a path within the same origin included (Entra ID tenants and
  Keycloak realms share an origin), is refused (`client_secret_required`)
  unless it brings a new
  client secret, so a stored secret is never sent to another IdP.
- **Secrets at rest:** the OIDC client secret and every SAML private key and
  passphrase are sealed field by field with AES-256-GCM (`node:crypto`), a
  96-bit random IV, and the provider id and JSON path as additional
  authenticated data. The key is `EDULIMS_DATA_KEY`, separate from
  `BETTER_AUTH_SECRET`; `EDULIMS_DATA_KEY_PREVIOUS` and `idp rekey` rotate it,
  together with the accounts' sealed ID tokens.
  better-auth has no read hook, so `createAuth` passes a wrapped Kysely
  adapter that seals `ssoProvider` configs on write and opens them on read,
  inside transactions too. A secret that does not open fails closed with
  `crypt_decrypt_fail`. better-auth's `symmetricEncrypt` was not used: it
  derives its key from `BETTER_AUTH_SECRET`.
- **Trusted origins and SSRF.** better-auth's `trustedOrigins` is the app
  origin and the operator's `EDULIMS_IDP_PRIVATE_ORIGINS` only (https only in
  production), never the stored issuers: a trusted origin skips the plugin's
  public-address check at fetch time, so an issuer whose DNS later points at
  the internal network is caught then too. The service also checks every
  issuer and metadata URL when it is saved: https only in production, and no
  private, loopback, link-local or special-purpose address (IPv4-mapped,
  NAT64 and 6to4 forms judged by the IPv4 address they carry, `net.BlockList`)
  unless the operator listed the origin. The metadata fetch resolves the host
  once, checks the answer at connect time, follows no redirect, and stops
  reading at 100 KB.
- **Roles per provider, hybrid ownership (#32).** The sign-in gate
  (`validateUserInfo`, methods `sso-oidc` and `sso-saml`) reads the provider's
  role claim (an ID-token dot path, or a SAML attribute by its exact name) and
  role map; a mapped role is authoritative with the provider id as
  `user.role_source`. Without one, local roles apply, then the default role,
  then a pending administrator grant for a new user; else `no_edulims_role`.
  The role sets of ADR 0012 hold unchanged. The gate also sets
  `emailVerified` from "email is authoritative", because the plugin's
  `trustEmailVerified` is deprecated and Entra ID sends no `email_verified`.
- **Account linking stays off** (#39): no `trustedProviders`, no domain
  verification, no `resolveUser` link. The same email from two providers is
  two accounts, and the second is refused with `account_not_linked`.
  [ADR 0017](0017-scim-provisioning.md) adds a `resolveUser` link on the
  SCIM directory id of the same provider only, never on email.
- **Disabled means disabled:** refused at `/sign-in/sso`, at the callback, at
  the ACS and at single logout, and again in the gate. Disabling a provider
  ends, in the same transaction, every session of every user with an account
  there, and the activity-log row carries the count. Each process caches
  provider settings for up to 30 seconds, which only delays the buttons on
  the sign-in page: the sign-in gate reads `enabled` from the database, and
  the session read refuses and ends a session whose `sign_in_method` names a
  disabled or deleted provider (#92). SP-initiated SAML logout
  (`/sso/saml2/logout/:providerId`) is unreachable; eduLIMS signs out through
  `/sign-out`. An administrator's test sign-in is the
  one exception; it records claim names and the role outcome, then refuses
  the sign-in, so it creates no user and no session.
- **Logout:** the plugin has no RP-initiated logout for OIDC, so an eduLIMS
  plugin adds the end-session URL (`id_token_hint`, `client_id`,
  `post_logout_redirect_uri` = `/login`) to `/sign-out` for the provider the
  current session signed in with (`session.sign_in_method`), never another
  provider the user also has an account at. SAML single logout is on where
  the IdP offers it.
- **Tokens at rest:** eduLIMS never calls an identity provider after sign-in,
  so a `databaseHooks.account` before-hook drops the access and refresh tokens
  before any account is written. The ID token is kept only as the
  `id_token_hint` of RP-initiated logout: the wrapped adapter seals it with
  AES-256-GCM under `EDULIMS_DATA_KEY`, with the account row's id in the
  additional authenticated data, so a token copied to another row does not
  open. better-auth's `encryptOAuthTokens` was not enough: it does not reach
  the sso plugin's account creation.
- **Organisations:** `organizationProvisioning` is off; SSO never adds anyone
  to a class.

## Consequences

- No provider is configured in `.env` any more; the `MICROSOFT_*`,
  `KEYCLOAK_*` (application), `OIDC_ROLE_*` and `OIDC_DEFAULT_ROLE`
  variables are gone. eduLIMS is greenfield, so nothing migrates.
- eduLIMS re-implements the provider validation the plugin does not export
  (SAML certificate, NameID and SSO-service checks).
- **Known gaps:**
  - The plugin sends and checks no OIDC `nonce` (ASVS V10.5.1 is partial).
    The state and the back-channel code exchange bind the response to the
    sign-in, and PKCE stops an injected code only at an IdP that enforces it:
    eduLIMS requires that it is advertised or attested (above), and cannot
    check an attestation. #74 tracks the gap and the upstream report.
  - A federation that issues only transient NameIDs cannot be used: the
    account key is the NameID.
  - Stored OIDC endpoints go stale when an IdP moves them; saving the
    provider again re-discovers them.
- SCIM (#45) builds on the same model: one SCIM connection per provider, keyed
  by the provider id, and `resolveUser` linking by the directory `externalId`
  only.
