<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0019. eduLIMS calls FerroEHR as a SMART on openEHR backend service

- Status: Proposed
- Date: 2026-11-12
- Deciders: maintainer, on the owner's delegation (#228)

## Context and problem statement

eduLIMS writes the Epoch 2 results to FerroEHR and reads every measurement
back with AQL (S4, S5, S7). FerroEHR 5.7.0 is the resource server of a SMART
on openEHR platform. With authentication on, "every route carries a SMART on
openEHR requirement", and FerroEHR "never issues tokens, registers clients,
or serves the OAuth 2.0 endpoints itself" (FerroEHR book v5.7.0,
`smart-app-launch.md`, introduction and "Scopes are enforced on every
route"). eduLIMS therefore needs an OAuth 2.0 identity at the institution's
identity provider and a set of SMART on openEHR scopes. Which kind of SMART
client is eduLIMS?

Two constraints apply. Q-PRIV-1: "The CDR holds no name or student number."
And the openEHR SMART App Launch specification is in the DEVELOPMENT state
(ITS-REST Release 1.1.0, `smart_app_launch.html`, §1.3 Status).

## Considered options

1. **EHR launch (embedded iFrame launch).** A launcher opens eduLIMS with a
   `launch` parameter that carries the EHR context, and the token carries
   `ehrId` (ITS-REST 1.1.0, `smart_app_launch.html`, §7.2 Context Selection
   and §7.3 Embedded iFrame Launch). FerroEHR binds a `patient/` grant to
   that EHR for an issuer in `[auth.smart] patient_issuers`
   (`smart-app-launch.md`, "Launch context: binding to one EHR").
2. **Standalone launch with `user/` scopes.** Each student and teacher
   signs in at the identity provider, and eduLIMS calls FerroEHR with that
   person's token: "access is granted based on the authenticated user's
   permissions" (§8.1 Resource Scopes). FerroEHR binds every person at a
   `persons` issuer to a demographic `PERSON` and commits under it
   (`installation/config-auth.md`, `[auth]` and `[authz.party_binding]`;
   `security/committer.md`, "The committer for each kind of caller").
3. **Backend service with `system/` scopes.** eduLIMS is one confidential
   client that takes a token with the client credentials grant: "Used when
   no end-user is involved" and "Backend services must use a confidential
   client" (§6.4 Flow Recommendations); `system` means "access is granted to
   backend applications acting without a user context" (§8.1). FerroEHR
   admits such a caller under its `system/` scopes and lets it commit only
   as a declared `[[authz.system_client]]`, for the templates its `writes`
   lists and the facilities its `facilities` lists
   (`identity-providers.md`, "Who the caller is";
   `installation/config-auth.md`, `[[authz.system_client]]`).

## Decision

Option 3. eduLIMS is a SMART on openEHR backend service.

- Option 1 has no launcher: nothing in this stack opens eduLIMS in an EHR
  context, and a student's work spans the samples of a practical, not one
  EHR.
- Option 2 binds every student and teacher to a demographic `PERSON` in
  FerroEHR, which carries their name (`security/committer.md`, the
  committer of a person "with the `PERSON`'s name"). That puts names in the
  CDR, against Q-PRIV-1.
- With option 3, eduLIMS checks the session, the role and the ownership on
  its own server before any FerroEHR call (S7, D3), and FerroEHR records
  the system client as the committer, "with no `external_ref`"
  (`security/committer.md`).

**The identity.** The OAuth 2.0 client `edulims-ferroehr` at the
institution's identity provider (Entra ID, Keycloak or any OIDC issuer),
which FerroEHR trusts as an issuer of kind `machines`. It is declared as the
system client that writes `eduLIMS-lab.v1` only, for the operator's lab
(`config/ferroehr.toml.example`, #226). The client secret lives in eduLIMS's
environment, never in FerroEHR's configuration.

**The scopes**, the narrowest that work, in the grammar
`<compartment>/<resource>.<permissions>` (§8.1; `smart-app-launch.md`, "The
scope grammar"):

| Scope | For |
|---|---|
| `system/composition-eduLIMS-lab.v1.cr` | write a measurement and read it back (S4, S5) |
| `system/aql-<stored query name>.s`, one per named stored query | the reads per sample, student and practical (S7) |

- **No `system/aql-*`.** That grant "would grant access to all registered
  and ad-hoc AQL queries system-wide" (§8.1), and FerroEHR counts it only
  for a client in `[auth.smart] backend_clients`, which stays empty. An
  ad-hoc query names no query, so only a bare wildcard covers it
  (`smart-app-launch.md`, "What each route requires"). eduLIMS therefore
  runs named stored queries, never ad-hoc AQL.
- **No `user/` or `patient/` scope.** FerroEHR refuses a token its profile
  marks app-only that carries one (`smart-app-launch.md`, "Launch context").
- **Not settled here.** FerroEHR requires `composition-` "over every
  template" on the EHR routes (`EHR`, `EHR_STATUS`), and a scope on every
  template for a template upload, which names no template in its path
  (`smart-app-launch.md`, "What each route requires"). Whether eduLIMS
  creates or looks up EHRs at all depends on who the EHR subject is (#131,
  X1). The template reaches the store through `ferroehr definitions load`
  before FerroEHR serves (#146), never through a REST upload, so it needs
  no scope. An EHR route needs the bare wildcard only if eduLIMS calls it
  over REST, and that widening needs its own decision.
- The stored-query names and their registration come with the AQL read
  path (#144).

## Consequences

- Good: no student or teacher identity reaches FerroEHR; the CDR sees one
  client and pseudonyms (Q-PRIV-1).
- Good: FerroEHR enforces the template and the facility on every write, so
  a defect in eduLIMS cannot commit another template.
- Good: no launcher, no `launch` parameter and no per-user token handling in
  eduLIMS.
- Bad: FerroEHR cannot tell which student or teacher caused a call. eduLIMS
  is the only place that checks ownership, so its role-isolation tests and
  its activity log (B4) carry that weight.
- Bad: the client secret in eduLIMS's environment reaches every composition
  of the template. Rotation follows the identity provider's procedure.
- Neutral: the scopes and their grammar follow a DEVELOPMENT-state
  specification and may change in a later ITS-REST release.

## When to revisit

- A launcher appears that opens eduLIMS in an EHR or episode context.
- SMART on openEHR leaves the DEVELOPMENT state, or a FerroEHR release
  changes the scope grammar, the route requirements or the system client
  rules.
- The answer to #131 X1 needs eduLIMS to create or look up EHRs over REST,
  which needs a wider scope than the table above.

## References

- openEHR ITS-REST Release 1.1.0, SMART App Launch:
  <https://specifications.openehr.org/releases/ITS-REST/Release-1.1.0/smart_app_launch.html>
  (§1.3, §6.4, §7.2, §7.3, §8.1).
- FerroEHR book v5.7.0: `smart-app-launch.md`, `identity-providers.md`,
  `security/committer.md`, `installation/config-auth.md`.
- Issues #228, #226, #225, #146, #144, #131; ADR 0013.
