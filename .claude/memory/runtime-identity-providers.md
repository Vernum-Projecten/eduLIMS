---
name: runtime-identity-providers
description: "Identity providers (OIDC and SAML) live in the database and are managed in Admin → System with the better-auth SSO plugin; the plugin's management endpoints stay off; secrets sealed under EDULIMS_DATA_KEY; first start through the host CLI; #46, ADR 0015, 2026-11-11"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

The design on #46 (made on the owner's delegation) is ADR 0015; it replaced
the env-configured Entra ID and Keycloak of ADR 0010 outright (greenfield):

- Providers are database rows (`ssoProvider` + `identity_provider` +
  `identity_provider_domain`), managed only through
  `src/server/idp/service.ts`, from the Admin screen or the host CLI. The
  sso plugin's register/update/delete/get endpoints stay unreachable; never
  turn on `defaultSSO`, `domainVerification`, `trustEmailVerified`,
  `trustedProviders`, a shared `redirectURI` or organisation provisioning.
- The provider id is an immutable slug; it is also the role source, the
  sign-in method, the audit `provider` and, for #45, the SCIM connection id.
- PKCE, the scopes and the ID token as claim source are fixed; SAML needs
  signed assertions, a persistent NameID and signed single logout.
- PKCE must be advertised in discovery or attested per provider
  (`attest_pkce`, off by default, logged): security review of #46 (H1).
- `trustedOrigins` = app origin + `EDULIMS_IDP_PRIVATE_ORIGINS` only (https in
  production); disabling a provider ends its users' sessions.
- Secrets: AES-256-GCM per field under `EDULIMS_DATA_KEY` (not
  `BETTER_AUTH_SECRET`), through the wrapped Kysely adapter.
- First start: `idp add` and `admin grant` (pending grant for 24 hours, bound
  to an email-authoritative provider, #48) from the tools image, never a
  setup page. Operators run every command as `docker compose run` against the
  tools image (published as `edulims-migrate`); pnpm is the developer form.
- No plaintext IdP token at rest: an account before-hook drops the access and
  refresh tokens; the adapter seals the ID token bound to its account row
  (kept only for `id_token_hint` of the session's own provider).
- Known gap: no OIDC nonce in the plugin (V10.5.1 partial, #74).

**Why:** administrators must switch a provider off without a redeploy, SAML
federations must work, and a student must never be able to register an IdP.

**How to apply:** a change to sign-in goes through the service and the sign-in
gate (`src/server/idp-sync.ts`); read the installed `@better-auth/sso` source
before relying on plugin behaviour, and re-check the plugin options on every
better-auth bump. See [[greenfield-until-1-0]], [[owner-delegated-decisions-2026-11-11]].
