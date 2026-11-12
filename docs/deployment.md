<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Deploying eduLIMS

eduLIMS runs with Compose on one Linux host (Docker Engine, or Podman with
`podman compose`; the commands below use `docker compose`, and `podman
compose` takes the same arguments), beside FerroEHR (the
openEHR CDR) and FerroBRIDGE (the HL7 v2 MLLP face), on one PostgreSQL 18
server that holds a separate database and role for each. The host is a VM at
the institution or one Azure VM; the choice is open, and the procedure is the
same.

## The stack

| Service | Image | Published on | Role |
|---|---|---|---|
| `postgres` | `ghcr.io/ferrohealth/ferroehr-postgres:5.7.0` | nothing | PostgreSQL 18.6 with the `edulims` and `ferroehr` databases |
| `ferroehr` | `ghcr.io/ferrohealth/ferroehr:5.7.0` | nothing | the CDR, reached at `http://ferroehr:8080` |
| `ferrobridge` | `ghcr.io/ferrohealth/ferrobridge:0.0.24` | MLLP, port 2575 | receives the Afinion 2 results |
| `edulims-migrate` | `ghcr.io/vernum-projecten/edulims-migrate` | nothing | the tools image with `migrate`: applies the migrations, then exits |
| `edulims-tools` (profile) | `ghcr.io/vernum-projecten/edulims-migrate` | nothing | the tools image for the operator commands (`admin`, `idp`), run by hand |
| `edulims` | `ghcr.io/vernum-projecten/edulims` | `127.0.0.1:3000` | the application |
| `keycloak` (profile) | `quay.io/keycloak/keycloak:26.8.2` | `127.0.0.1:8180` | the optional identity provider |
| `logship` (`compose.logship.yaml`) | `docker.io/fluent/fluent-bit:5.2.0` | `127.0.0.1:24224` | the optional log forwarder ("Shipping logs off the host") |
| `logship` (`compose.logship.yaml`) | `docker.io/fluent/fluent-bit:5.2.0` | `127.0.0.1:24224` | the optional log forwarder (below, "Shipping logs off the host") |

Every third-party image is pinned by digest in `compose.yaml`; the eduLIMS
images are named by the release in `EDULIMS_VERSION`. Nothing else runs: no
mail server, no cache, no monitoring stack, because no requirement needs one.
Keycloak starts only when you ask for it.

Two networks keep the parts apart. `backend` is internal, so PostgreSQL and
FerroEHR have no route to the internet and no published port. eduLIMS,
FerroBRIDGE and Keycloak also join `egress`, for sign-in and their published
ports. Every container drops all Linux capabilities (PostgreSQL adds back the
five its entrypoint needs), refuses privilege escalation, and runs with a
read-only root filesystem, except Keycloak, which rebuilds itself on its
first start.

### Why the eduLIMS images use distroless Node.js

The server and the tools image share one base,
`gcr.io/distroless/nodejs26-debian13:nonroot`, pinned by digest. It was
chosen against the two other Node.js 26 bases on 2026-11-11:

| Base | Node.js 26 | Pinnable | Surface |
|---|---|---|---|
| `gcr.io/distroless/nodejs26-debian13:nonroot` | 26.13.0, the version in `.node-version` | by digest, tag tracks Node.js 26 | node, glibc, CA certificates, tzdata; no shell, no package manager, no npm |
| `cgr.dev/chainguard/node` | yes | by digest, but the free tier publishes `latest` only, which moves to Node.js 27 when that ships | minimal, few CVEs |
| `node:26.13.0-trixie-slim` | 26.13.0 | by digest and exact tag | a shell, apt, npm and corepack-free Debian userland: the most packages to scan |

Distroless has the fewest packages that stay on Node.js 26, with a stable
tag to follow. Chainguard's free image cannot be held on Node.js 26 without a
subscription, and the slim image carries a shell and npm the server never
uses. The build stage uses the full `node:26.13.0-trixie` image and never
ships.

Both images run as uid 65532, own none of their files, and write nothing, so
they run with `read_only: true`. The server needs no `node_modules`: the
build bundles every dependency into `.output/`. The tools image (published as
`edulims-migrate`) holds the production `node_modules` and the sources from
`pnpm deploy`, and runs the host CLI `src/server/cli.ts` with Node.js 26's
type stripping: `migrate` by default, and `prune`, `admin grant|revoke` and
`idp add|list|enable|disable|rekey` when the operator names them. It has no
shell and no package manager, so every operator command is a
`docker compose run` against it.

## Prepare the host

1. A Linux host with Docker Engine and the Compose plugin, at least 2 vCPU
   and 4 GB of memory. On Azure, the VM, its disks and its backups live in an
   EU region (West Europe or North Europe) and nowhere else: the database
   holds student data under the GDPR, and keeping it in the EU keeps the
   transfer question closed.
2. A reverse proxy on the host that terminates TLS for the eduLIMS hostname
   (and the Keycloak hostname, with the `keycloak` profile) and forwards to
   `127.0.0.1:3000` (and `127.0.0.1:8180`) with `X-Forwarded-For`,
   `X-Forwarded-Proto` and `X-Forwarded-Host`. The institution's proxy or
   Caddy on the host both work.
3. A firewall that admits 443 from the users' networks, and the MLLP port
   only from the lab network the Afinion 2 sends from.

## First deployment

Download the deploy bundle of the release and verify it
(`docs/release.md`, "Verifying a release"):

```sh
gh release download vX.Y.Z --repo Vernum-Projecten/eduLIMS --pattern 'edulims-deploy-*'
sha256sum -c edulims-deploy-vX.Y.Z.tar.gz.sha256sum
tar -xzf edulims-deploy-vX.Y.Z.tar.gz
cd edulims-deploy-vX.Y.Z
```

1. Copy `.env.example` to `.env`, fill in every required value, and make it
   readable by root alone (`chmod 600 .env`). Generate each secret and
   database password with `openssl rand -hex 32`; hex keeps the database URLs
   valid without escaping.
2. Write `config/ferroehr.toml` (FerroEHR's configuration, from FerroEHR's
   operator documentation) and `config/ferrobridge/ferrobridge.toml` with its
   `[hl7v2]` section and the TLS files it names (FerroBRIDGE's
   documentation, "HL7 v2 face"). `compose.yaml` sets the database URL, the
   CDR URL and the listen address; the files hold the rest.
3. Create the PostgreSQL certificates in `config/postgres-tls/` (below,
   "Database TLS").
4. Pull, verify and start:

   ```sh
   docker compose pull
   gh attestation verify oci://ghcr.io/vernum-projecten/edulims:X.Y.Z \
     --repo Vernum-Projecten/eduLIMS \
     --signer-workflow Vernum-Projecten/eduLIMS/.github/workflows/release-image.yml
   docker compose up -d --wait
   ```

On the first start, PostgreSQL runs FerroEHR's init script and then
`docker/postgres/init/20-edulims.sh`, which creates the `edulims` role and
database (and `keycloak`, when `KEYCLOAK_DB_PASSWORD` is set). The init
scripts run only on an empty data directory. On a server that already holds
data, run the eduLIMS script by hand:

```sh
docker compose exec -T postgres bash < docker/postgres/init/20-edulims.sh
```

## Database TLS

eduLIMS talks to PostgreSQL over TLS and verifies the server certificate and
its host name (`sslmode=verify-full`); a production server refuses to start
with any other `DATABASE_URL` (ADR 0013). `compose.yaml` turns TLS on in
PostgreSQL and hands eduLIMS the CA, so you provide three files in
`config/postgres-tls/`:

| File | Who reads it | Mode |
|---|---|---|
| `ca.crt` | eduLIMS and the migrate job, to verify the server | `0644` |
| `server.crt` | PostgreSQL; its subject alternative name is `DNS:postgres`, the service name | `0644` |
| `server.key` | PostgreSQL only; owned by uid 999 (`postgres` in the image) | `0600` |

A private CA for this one host is enough:

```sh
mkdir -p config/postgres-tls && cd config/postgres-tls
openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -subj "/CN=eduLIMS database CA" \
  -keyout ca.key -out ca.crt
openssl req -newkey rsa:3072 -nodes -subj "/CN=postgres" -keyout server.key -out server.csr
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 825 \
  -extfile <(printf 'subjectAltName=DNS:postgres\nextendedKeyUsage=serverAuth') -out server.crt
chown 999:999 server.key && chmod 600 server.key && chmod 644 ca.crt server.crt
mv ca.key /root/edulims-db-ca.key   # keep the CA key off the stack, for renewals only
```

Renew `server.crt` before it expires (825 days above) with the same CA and
restart PostgreSQL (`docker compose restart postgres`); eduLIMS keeps
trusting it. When you run eduLIMS against another PostgreSQL server, set
`DATABASE_URL` yourself with `?sslmode=verify-full`, plus
`&sslrootcert=<path to its CA>` unless a public CA signs its certificate.

FerroEHR and FerroBRIDGE stay on plain `http` inside the internal `backend`
network; ADR 0013 records that residual risk and when to revisit it.

## Migrations

`edulims-migrate` runs before the server on every `docker compose up`: the
server waits for it to exit 0, and an applied migration is not applied again.
To run the migrations alone:

```sh
docker compose run --rm edulims-migrate
```

A failed migration stops the server from starting, which keeps a server from
running against a schema it does not expect. Read its log with
`docker compose logs edulims-migrate`.

## Health

`GET /api/health` answers while the process is up, and the image's
`HEALTHCHECK` probes it. `GET /api/ready` answers once the database and the
integrations answer; point the reverse proxy's or the institution's
monitoring at it. `docker compose ps` shows each service's health.

## Identity providers

eduLIMS signs users in through identity providers that administrators manage
at runtime in **Admin → System → Identity providers**: OpenID Connect (OIDC)
providers such as Microsoft Entra ID or Keycloak, and SAML 2.0 providers such
as an institution's federation. Nothing about a provider lives in `.env`;
each one is a database row with its own sign-in button, role mapping and email
domains ([ADR 0015](adr/0015-runtime-identity-providers.md)). A new provider
starts switched off: add it, register the URLs the screen shows at the
identity provider, test it, then enable it. The first provider of a fresh
install comes from the host (below, "First start").

eduLIMS fixes the security settings of every provider; the screen offers no
switch for them:

- **OIDC:** the authorization code flow with PKCE (S256) and the scopes
  `openid email profile` (no refresh token). The issuer is discovered once,
  when the provider is saved: the discovery document must name exactly that
  issuer, its authorization, token and key endpoints must be on the issuer's
  own origin, and it must list `S256` in `code_challenge_methods_supported`.
  Claims come from the verified ID token only, never from the UserInfo
  endpoint. eduLIMS keeps no access or refresh token; the ID token is stored
  encrypted for the sign-out hint only. The sso plugin sends no `nonce` yet
  (#74), so PKCE is the protection against an injected authorization code:
  that is why eduLIMS insists the IdP enforces it.
- **PKCE attestation:** some IdPs enforce PKCE but leave
  `code_challenge_methods_supported` out of their discovery document. Saving
  such a provider is refused with "does not offer PKCE with S256" until an
  administrator switches on "This provider enforces PKCE with S256", which
  the activity log records. Switch it on only when the IdP's own
  documentation says it refuses a sign-in without PKCE for this client;
  otherwise an authorization code stolen from a redirect can sign someone in,
  and eduLIMS has no second check to stop it.
- **SAML:** signed assertions, timestamps (`NotBefore`, `NotOnOrAfter`),
  InResponseTo checks, no IdP-initiated sign-in, no deprecated algorithms
  (SHA-1, RSA 1.5, 3DES) and a **persistent NameID**: the account is keyed on
  the NameID, so a transient one would make a new account at every sign-in.
  The IdP's metadata must list the persistent `NameIDFormat`, and a response
  whose NameID has another format is refused. Single-logout requests and
  responses must be signed by the IdP. Ask the federation which NameID
  formats and attributes it releases.
- **Secrets:** the OIDC client secret and a SAML signing key are write-only:
  stored encrypted (below, "Data key") and never shown again.

### The URLs to register

The edit page of each provider shows them with a copy button.

| Protocol | Register at the IdP | Value |
|---|---|---|
| OIDC | redirect URI | `<BETTER_AUTH_URL>/api/auth/sso/callback/<provider id>` |
| OIDC | post-logout redirect URI | `<BETTER_AUTH_URL>/login` |
| SAML | SP entity ID and metadata | `<BETTER_AUTH_URL>/api/auth/sso/saml2/sp/metadata?providerId=<provider id>` |
| SAML | assertion consumer service | `<BETTER_AUTH_URL>/api/auth/sso/saml2/sp/acs/<provider id>` |

The provider id is part of these URLs and of every account, so it cannot
change once the provider exists. Signing out of eduLIMS also ends the session
at an OIDC provider that advertises an end-session endpoint, which returns
the user to the sign-in page (RP-initiated logout). SAML single logout runs
where the IdP's metadata offers it; otherwise only the eduLIMS session ends.

### Microsoft Entra ID

Register an app in the institution's tenant (single tenant), add the redirect
URI and the post-logout redirect URI above, create a client secret, define the
app roles `edulims-student`, `edulims-teacher` and `edulims-admin`, and assign
them to users or groups. Add the optional claim `email` to the ID token: Entra
ID does not send it by default, and eduLIMS refuses a sign-in without an
email. In eduLIMS add an OIDC provider with the issuer
`https://login.microsoftonline.com/<tenant id>/v2.0`; the exact issuer check
keeps the sign-in to that one tenant. Leave "This provider's email addresses
are verified" off: Microsoft documents the `email` claim as mutable and not
verified ("Email addresses", below). When the tenant's discovery document
does not list `code_challenge_methods_supported`, saving the provider is
refused until an administrator gives the PKCE attestation above, after
checking that the app registration enforces PKCE.

### Keycloak

Start it with the profile, create the realm and a confidential client with
the standard flow, PKCE S256, and the redirect and post-logout URIs above;
add a "User Realm Role" protocol mapper with claim name `realm_access.roles`
and "Add to ID token" on. The issuer is
`https://<keycloak host>/realms/<realm>`.

```sh
COMPOSE_PROFILES=keycloak docker compose up -d --wait
```

Keycloak stores its state in its own database on the shared PostgreSQL
server, so the backups below cover it. `docker/keycloak/edulims-realm.json`
is the development realm, with an OIDC and a SAML client; use it as a
template only, because its client secret and users are public.

### A SAML federation

Add a SAML provider with the IdP's metadata (paste the XML, or give its URL:
eduLIMS fetches it once, and "refresh" means saving the provider with the
URL again after a certificate rotation). Give the federation the SP metadata
URL above. If the IdP's metadata says `WantAuthnRequestsSigned="true"`, add a
signing key (a PEM private key) and register its certificate at the IdP.

### Issuers on a private network

Every issuer and metadata URL is fetched from the server, so eduLIMS refuses
one that resolves to a private, loopback or link-local address: an
administrator cannot point the server at the internal network (SSRF). An
identity provider that really runs on-premises is allowed by listing its
origin in `EDULIMS_IDP_PRIVATE_ORIGINS` (comma-separated). In production
eduLIMS refuses to start with an `http` origin there. Only the host operator
can set it. These origins, and the app's own, are the only ones better-auth
trusts; every other IdP endpoint is resolved and checked again each time
eduLIMS fetches it.

### One account per provider

eduLIMS never links accounts across identity providers. A user who first
signs in through one provider cannot later sign in through another under the
same email address: the sign-in page answers "This email address already
signs in through another sign-in method" (error code `account_not_linked`) and
no session starts. A provider with self-registration, or a federation that
lets users set their own address, therefore cannot take over another
provider's user. To move a user from one provider to another, an
administrator removes the old eduLIMS account first.

### Role mapping

eduLIMS knows three roles: `student`, `teacher` and `admin`. Each provider
has a role claim and a role map. At every sign-in eduLIMS reads the claim (for
OIDC a dot path into the verified ID token, such as `roles` or
`realm_access.roles`; for SAML the exact name of an attribute, such as
`Role`) and maps every value it lists through the role map.

The allowed role sets are student, teacher, admin, and teacher with admin
together ([ADR 0012](adr/0012-multiple-roles-and-portal-switcher.md)).
Student is exclusive: a sign-in that maps to student and teacher, or student
and admin, is refused with `role_conflict`. A mapped role is authoritative:
it replaces the user's role set at every sign-in, and the Users screen names
the provider as its source. Without a mapped role, the roles an
administrator gave the user in eduLIMS apply; a new user gets the provider's
default role, then a waiting administrator grant (below), and is otherwise
refused with `no_edulims_role` (deny by default). Roles are a set, not a
ranking: admin does not include teacher.

For Entra ID, use app roles (claim `roles`), not the `groups` claim: it
carries group object IDs, and a user in more than 200 groups gets an overage
claim eduLIMS cannot read. For Keycloak, prefer realm roles
(`realm_access.roles`) over group paths (`groups`), which change when a group
is renamed or moved.

"Test sign-in" on a provider's page signs in through it in a new tab, shows
the names of the claims it received (never their values) and the role set
they would give, and signs nobody in.

### Email addresses

"This provider's email addresses are verified" marks the email a provider
sends as verified. Turn it on only for a single-tenant provider whose policy
verifies every address before it sends it, such as a Keycloak realm that
requires email verification and does not let users edit their address. Leave
it off for Microsoft Entra ID and for any provider where users or tenant
administrators set the address without a check: pending administrator grants
and class invitations match a verified address only, so an unverified address
there would let its owner claim someone else's grant. `admin grant` also
refuses an existing user whose address no provider verified.

## Provisioning with SCIM

An identity provider can push users and groups to eduLIMS over SCIM 2.0
(RFC 7643, RFC 7644) before anyone signs in, and deactivate leavers. eduLIMS
is the SCIM service provider; each identity provider is one SCIM connection
with its own bearer token
([ADR 0017](adr/0017-scim-provisioning.md)). SCIM is optional: sign-in works
the same without it.

| What the identity provider asks for | Value |
|---|---|
| Tenant URL (SCIM endpoint) | `<BETTER_AUTH_URL>/api/auth/scim/v2` |
| Secret token | the token from the provider's page (below) |

What a SCIM request does in eduLIMS:

- **Create** makes an eduLIMS user with no roles, shown on the Users screen
  as "Provisioned by <provider>" and "Never signed in". eduLIMS never
  matches an existing user on email; it links a new SCIM user to an existing
  one only when that user already signed in through the same provider with
  an account key equal to the SCIM `externalId`.
- **Roles** come from the provider's role map. A SCIM group whose
  `externalId` or display name is a key in the role map, or a value in the
  user's `roles` attribute, gives that role and makes the provider the
  source of the role set. A group is matched on its `externalId` alone; a
  group without one gives no role, whatever its name. For a user the
  directory provisioned, SCIM owns the roles: the sign-in's role claim
  neither adds nor removes one. Without a mapped group the user keeps the roles an
  administrator gave them in eduLIMS, and has none until then. A group the
  role map does not name gives nothing, so SCIM never makes anyone an
  administrator unless the role map maps a group to `admin`.
- **`active: false`** or **delete** ends every session of that user at once
  and refuses every new sign-in with "Your institution's directory has
  deactivated your account". eduLIMS keeps the user and their records;
  erasing a person is a separate step. `active: true`, or a new
  create with the same `externalId`, lets the user sign in again.
- **Sign-in** finds the provisioned user through the directory id: by
  default the account key (the OIDC `sub`, the SAML persistent NameID). When
  the directory sends another value as `externalId`, set "Claim with the
  directory ID" on the provider's page to the claim that carries the same
  value. Only a claim that never changes for a person is accepted: `oid`
  (Entra ID's object id), `sub` or `objectGUID`. A changeable claim such as
  `email`, `preferred_username` or `upn` is refused, because whoever can
  change it could take over another person's account. Each sign-in stores
  the directory id on the account, so a user who signed in before the
  directory provisioned them is linked, not duplicated.
- **E-mail domains:** when the provider has e-mail domains (its settings),
  the directory may provision only addresses in them; anything else is
  refused with a 400 that does not say why. A provider without domains can
  provision any address, and its page warns about that.
- **E-mail addresses** have one owner. A create or change whose address
  belongs to a user who signs in through another provider, or whom another
  provider provisioned, is refused with a 409 that does not say which user;
  the directory therefore learns that the address is taken.

Every SCIM write and every refused token is in the activity log with ids and
codes only. The endpoint takes at most 600 requests per minute per identity
provider, and 600 per minute per client IP for requests without a working
token; request bodies are capped at 1 MiB; more gets `429` or `413`. Requests
without a working token are counted per client IP only when
`EDULIMS_TRUSTED_PROXIES` lists the reverse proxies in front of eduLIMS
(comma-separated IP addresses or CIDR ranges); the proxy must then overwrite
`X-Forwarded-For` with the address it received the request from (or append
to it), and eduLIMS must be reachable through those proxies only. Left
empty (the default), eduLIMS trusts no forwarded header and all such
requests share one budget. It answers `501` when
the installation cannot run SCIM (the provider's page says so).

### The token

On the provider's page in **Admin → System → Identity providers**, the
section "Provisioning (SCIM)" shows the tenant URL and creates, replaces and
revokes the provider's token. A token is shown once: eduLIMS stores only its
SHA-256 digest, so a lost token is replaced, never recovered.

- A token works for **180 days**. The page shows its expiry date and warns
  from 14 days before; an expired token is refused (and the refusal is in the
  activity log), so replace it in time.
- **Replacing** a token keeps the previous one working for one more hour, so
  the identity provider can be switched to the new token without a gap.
- **Revoking** ends every token of the provider at once, the one a
  replacement left running included.
- A disabled provider's token is refused until the provider is enabled again.

From the host:

```sh
docker compose run --rm edulims-tools scim token create <provider id>
docker compose run --rm edulims-tools scim token rotate <provider id>
docker compose run --rm edulims-tools scim token revoke <provider id>
docker compose run --rm edulims-tools scim external-id <provider id> oid
docker compose run --rm edulims-tools scim external-id <provider id> --account-key
```

`scim token create` and `rotate` print the token once on standard output,
with its expiry date (and, after a rotation, until when the previous token
works); nothing else stores it in the clear. Every change is in the activity
log. A provider that provisioned users cannot be deleted; disable it
instead.

### Microsoft Entra ID provisioning

In the Entra admin center open the enterprise application of the eduLIMS
app registration, choose **Provisioning**, set the mode to **Automatic**,
and enter the tenant URL and the secret token above; **Test connection**
must succeed. Under **Mappings**:

- map the user's `objectId` to `externalId`, and set "Claim with the
  directory ID" on the eduLIMS provider to `oid`: the OIDC `sub` Entra ID
  sends eduLIMS is pairwise per application, so it never equals the object
  ID;
- keep `userPrincipalName` to `userName` and `mail` to the work email;
- map `Switch([IsSoftDeleted], , "False", "True", "True", "False")` to
  `active`, as the default mapping does;
- provision groups if roles come from groups: their `objectId` goes to the
  group's `externalId`, which is the key the role map uses, the same object
  ID the `groups` claim would carry.

Assign the users and groups to provision to the enterprise application, then
start provisioning. Entra ID runs a cycle about every 40 minutes; "Provision
on demand" sends one user at once to check the setup. Automatic provisioning
to a non-gallery application may need a licence the institution has; ask its
identity team.

### Keycloak provisioning

Keycloak has no SCIM client of its own. A Keycloak extension (an SPI) that
pushes users and groups to a SCIM 2.0 service provider does it: install the
extension's JAR in Keycloak's `providers` directory, rebuild Keycloak, and
configure the extension in the realm with the tenant URL and the token as a
bearer token. Choose an extension that sends the Keycloak user id as
`externalId`; it is the OIDC `sub`, so the provider keeps the account key
(no claim to set). Restart the service after installing it:

```sh
COMPOSE_PROFILES=keycloak docker compose up -d --wait --force-recreate keycloak
```

The extension, its version and its supply-chain review are the operator's
choice; eduLIMS does not ship one.

## Data key

`EDULIMS_DATA_KEY` encrypts the identity-provider secrets in the database
with AES-256-GCM, each bound to its provider and field, and the ID token each
account keeps for the sign-out hint, bound to its account row. It is 32 random
bytes, base64:

```sh
openssl rand -base64 32
```

Production refuses to start without it. Only the `edulims` and
`edulims-tools` services receive it, and it is not `BETTER_AUTH_SECRET`:
changing the cookie secret signs everyone out but leaves the providers
readable. Keep a copy beside the backups but not inside them: a backup
without the key cannot reveal a client secret, and without the key the
providers cannot be read. A secret that does not decrypt fails closed and logs
`crypt_decrypt_fail`.

To rotate the key: move the current value to `EDULIMS_DATA_KEY_PREVIOUS`, set
a new `EDULIMS_DATA_KEY`, restart, re-encrypt every provider secret and ID
token, then remove the previous key and restart again.

```sh
docker compose up -d --wait
docker compose run --rm edulims-tools idp rekey
```

## First start

A fresh install has no identity provider and no administrator. There is no
setup page: a first-run page on a freshly exposed host would be a race to
claim the instance. The host operator, who already has host access, adds
the first provider and the first administrator with the tools image:

1. Write the provider as JSON (the fields of the Admin screen). The client
   secret comes from `EDULIMS_IDP_CLIENT_SECRET`, never from a flag, which the
   shell history and `ps` would keep; the command does not prompt for it, so
   it never shows on the terminal:

   ```json
   {
     "providerId": "entra",
     "protocol": "oidc",
     "settings": {
       "labelEn": "Microsoft",
       "labelNl": "Microsoft",
       "icon": "building",
       "sortOrder": 0,
       "roleClaim": "roles",
       "roleMap": [
         { "value": "edulims-student", "role": "student" },
         { "value": "edulims-teacher", "role": "teacher" },
         { "value": "edulims-admin", "role": "admin" }
       ],
       "defaultRole": null,
       "emailAuthoritative": false,
       "domains": ["example.edu"]
     },
     "oidc": {
       "issuer": "https://login.microsoftonline.com/<tenant id>/v2.0",
       "clientId": "<application id>",
       "clientSecret": "",
       "attestPkce": false
     }
   }
   ```

   `emailAuthoritative` is off because Entra ID does not verify the `email`
   claim. `attestPkce` stays off unless the provider is refused with
   `no_pkce` and you have checked that it enforces PKCE (both under "Identity
   providers" above). `idp add` with flags takes `--attest-pkce` and
   `--email-authoritative`.

   A SAML provider has `"protocol": "saml"` and
   `"saml": { "metadataXml": "", "metadataUrl": "<metadata URL>", "spPrivateKey": "" }`
   instead.

2. Add and enable it, reading the JSON from standard input:

   ```sh
   EDULIMS_IDP_CLIENT_SECRET='<client secret>' \
     docker compose run --rm -T -e EDULIMS_IDP_CLIENT_SECRET edulims-tools \
     idp add - --enable < entra.json
   docker compose run --rm edulims-tools idp list
   ```

   The same validation, discovery, encryption and activity-log row as the
   screen apply (actor `system`). `idp enable <id>` and `idp disable <id>`
   switch a provider; on the host the last enabled provider can be switched
   off, which the screen refuses. Disabling a provider also ends every
   session of the users who have an account there. A running eduLIMS caches
   provider settings for up to 30 seconds per process, so the sign-in page
   shows a change made with the tools image within 30 seconds. A disabled
   provider stops working at once all the same: the sign-in check and every
   session read ask the database, not the cache, and refuse a sign-in or a
   session through a provider that is off.

3. Make the first administrator. Either the provider's role map maps an IdP
   role or group to `admin`, or grant the role from the host:

   ```sh
   docker compose run --rm edulims-tools admin grant <email> --provider entra
   ```

   An existing user whose address a provider verified gets the admin role at
   once (as a local role set). For an email that has not signed in yet, the
   grant waits for 24 hours and is applied at that email's first sign-in
   through the named provider, which must be marked "email addresses are
   verified". `admin revoke <email>` takes the role away again and ends that
   user's sessions; it never removes the last administrator. Both write the
   activity log with actor `system`. The same command is the break-glass path
   when the identity provider is down or no administrator is left.

   With the Entra ID example above, whose addresses are not verified,
   `admin grant <email>` refuses with `email_unverified`, because an address
   nobody verified may belong to someone else. Make the first administrator
   through the `edulims-admin` app role, or, for a user who has already
   signed in once (with a mapped role, so eduLIMS has their account), look
   the account up and grant by its id:

   ```sh
   docker compose run --rm edulims-tools admin lookup <email>
   # user <id> (email not verified)
   docker compose run --rm edulims-tools admin grant --user-id <id>
   ```

   Check in Entra ID that the account behind that address is the person you
   mean before you grant. The activity log records the grant with reason
   `admin_grant_override`. A user who never signed in has no account yet, so
   the override cannot reach them; that case needs the app role.

After that, administrators manage the providers in the Admin screen.
Developers run the same commands with `pnpm idp:add`, `pnpm idp:list`,
`pnpm admin:grant <email>` (with `--user-id <id>` for the override) and so on
(below, "Local development").

## Updating

Risk R-05 names vulnerable libraries in the containers as a risk and
asks for monthly image updates. The cadence is:

- **Monthly**, in the first week: deploy the latest eduLIMS release, which
  is rebuilt on the current distroless base. When no feature release is due,
  the maintainers cut a patch release for the base image bump alone.
- **Within a week of a scan issue**: the weekly published-image scan
  (`.github/workflows/image-scan.yml`) opens an issue for a fixable HIGH or
  CRITICAL finding; the fix ships as a patch release.
- **FerroEHR, FerroBRIDGE, PostgreSQL and Keycloak** move when this
  repository bumps their digests in `compose.yaml` (Dependabot proposes the
  bumps), and the host takes them with the next eduLIMS release's bundle.

An update is:

```sh
# Back up first (below).
sed -i 's/^EDULIMS_VERSION=.*/EDULIMS_VERSION=X.Y.Z/' .env
docker compose pull
docker compose up -d --wait
docker image prune -f
```

`docker image prune` removes the replaced images, so the host keeps one copy
of each.

To roll back, set the previous `EDULIMS_VERSION` and run `docker compose up
-d --wait` again. A release whose migrations changed the schema cannot be
rolled back that way: restore the backup taken before the update.

## Backups

The PostgreSQL data is the only state: the eduLIMS database, FerroEHR's
database (every measurement), Keycloak's database when it runs, and the roles.
Back up every database every night, plus the roles:

```sh
# /etc/cron.d/edulims-backup, as root, 02:15 every night
15 2 * * * root cd /srv/edulims && \
  for db in edulims ferroehr; do \
    docker compose exec -T postgres pg_dump -U postgres -Fc -f "/backup/${db}-$(date +\%F).dump" "$db"; \
  done && \
  docker compose exec -T postgres pg_dumpall -U postgres --roles-only -f "/backup/roles-$(date +\%F).sql" && \
  find ./backups -name '*.dump' -mtime +30 -delete && find ./backups -name 'roles-*.sql' -mtime +30 -delete
```

Add `keycloak` to the list with the profile. The dumps land in
`EDULIMS_BACKUP_DIR` on the host (`./backups` by default), which is mounted
into the PostgreSQL container at `/backup`. Copy that directory off the host
every night (the institution's backup service, or an Azure Recovery Services
vault in the same EU region), and keep 30 days. The dumps hold personal data,
so the copy is encrypted at rest and readable only by the administrators.

Test a restore every quarter on a scratch host:

```sh
docker compose up -d --wait postgres
docker compose exec -T postgres psql -U postgres -f /backup/roles-YYYY-MM-DD.sql
docker compose exec -T postgres pg_restore -U postgres --clean --if-exists -d edulims /backup/edulims-YYYY-MM-DD.dump
docker compose exec -T postgres pg_restore -U postgres --clean --if-exists -d ferroehr /backup/ferroehr-YYYY-MM-DD.dump
docker compose up -d --wait
```

## Retention of the activity log and of sessions

eduLIMS keeps the activity log (who signed in, who changed a role, who
blocked whom; ids only, no names or addresses) for 12 months, and deletes a
session 30 days after it expired. It also drops administrator grants that
expired before anyone used them.

Pruning is automatic. The app container prunes once, a minute after it
starts, and then every 24 hours, so you need no cron job, no systemd timer
and no command. With more than one replica of the app container, a
PostgreSQL advisory lock lets one of them prune at a time; the others skip
that run. Each run writes a `sys_retention_prune` event to the activity log
with the number of events, sessions and grants it removed (counts only), and
the same line to the security log stream ("Shipping logs off the host"). A
run that fails, for example while the database restarts, logs
`retention_prune_failed` to the security log stream with the error classes
and codes (`"cause":["error:57P01"]`), writes a failure
event when the database takes it, and tries again 24 hours later; the server
keeps running.

To prune at once, for example after a restore, run the same code by hand
from the tools image:

```sh
docker compose run --rm edulims-migrate prune
```

It prints the number of events, sessions and expired administrator grants it
removed, and is safe to run more than once: a second run removes nothing new.
While the app container is pruning, it prints that another prune is running
and removes nothing. The backups above keep deleted rows for another 30 days,
until the oldest dump is removed.

## Shipping logs off the host

eduLIMS writes every security event to its stdout as one JSON line, and Docker
keeps those lines on the host. Someone who takes over the host can erase
them there. OWASP ASVS 5.0 V16.4.3 asks for logs to be "securely transmitted
to a logically separate system". Shipping is optional (the decision on #44),
because it needs a log platform at the institution to send to: a syslog
server or SIEM that accepts RFC 5424 syslog over TLS, or an HTTPS collector.

### What leaves the host

Only the security events. A Fluent Bit forwarder drops every other line
(start-up messages, errors). Each event is the line eduLIMS wrote:

```json
{"time":"2026-11-11T20:40:56.387Z","level":"warn","app":"edulims","log":"security","event":"authz_fail","outcome":"refused","actor_type":"user","actor_id":"0193…","reason":"missing_role","status":403,"required_roles":"teacher","request_id":"0193…"}
```

`time` is UTC. Besides `level`, `app`, `log` and `event`, a line carries only
these fields: `outcome`, `actor_type`, `actor_id`, `target_type`,
`target_id`, `reason`, `provider`, `request_id`, `roles`, `previous_roles`,
`required_roles`, `ban_expires_at`, `provider_id`, `protocol`, `fields`,
`attest_pkce`, `sessions_ended`, `test_outcome`, `removed_audit_events`,
`removed_sessions`, `removed_admin_grants`, `resealed_providers`,
`resealed_id_tokens`, `kind`, `status`, `command`, `migration`, `direction`,
`variables` and `cause`. They hold ids, codes and counts; `fields`,
`variables` and `cause` are lists of codes. eduLIMS replaces any value or
list item that contains a space or an `@` with `redacted`, so a name, an
e-mail address, a token or a grade cannot leave the host. An error line names
its cause by error class and code (a SQLSTATE such as `42P01`, or
`ECONNREFUSED`), never by its message. The events are:

| `event` | When |
|---|---|
| every action of the activity log (`authn_login_success`, `authz_role_change`, `idp_created`, `admin_grant_created`, `sys_retention_prune`, `sys_data_key_rotated` and the others) | the same moment the row is written to the activity log in the Admin portal, also for the host commands (`admin grant` and `revoke`, `idp add`, `enable`, `disable` and `rekey`), which act as `system`; a refused host command writes its row with `"outcome":"refused"` and the reason code (`last_admin`, `role_conflict`, `exists`) |
| `migration_failed` | `migrate` failed: the migration, the direction and the cause, or `database_tls_required` |
| `retention_prune_failed` | a prune failed, scheduled or by hand |
| `cli_command_failed` | a host command stopped on an error: the command, the cause, and for a configuration error the names of the invalid variables |
| `authz_fail` | a server function refused a call: 401 without a session, 403 without the role |
| `authz_role_write_refused` | a role set eduLIMS does not allow was refused |
| `idp_role_conflict` | the identity provider sent a role set eduLIMS does not allow |
| `admin_action_failed` | an Admin portal action failed in the sign-in library |
| `audit_write_failed` | an activity-log row could not be written |

The activity log in the database stays the record. A line written in a
transaction that later rolls back can still reach the stream, so read a
stream event without its database row as an attempt.

### Turn it on (Docker)

The deploy bundle holds `compose.logship.yaml` and the two Fluent Bit
configurations in `docker/logship/`; keep them beside `compose.yaml`. Add to
`.env` (`.env.example` lists every `LOGSHIP_` value):

```sh
COMPOSE_FILE=compose.yaml:compose.logship.yaml
LOGSHIP_OUTPUT=syslog        # or http
LOGSHIP_HOST=siem.example.org
LOGSHIP_PORT=6514
```

For `http`, also set `LOGSHIP_HTTP_URI` and, for the platform's token,
`LOGSHIP_HTTP_HEADER` (`Authorization Bearer <token>`). When a private CA
signed the platform's certificate, put the CA certificate in
`config/logship/`, readable by uid 65534, and set
`LOGSHIP_TLS_CA_FILE=/etc/logship/tls/ca.crt`. Then apply it and check that
the forwarder delivers:

```sh
docker compose up -d --wait
docker compose logs logship
```

How it works: Docker's `fluentd` log driver on the `edulims` service sends
each stdout line to the `logship` service (Fluent Bit 5.2.0, pinned by
digest), which listens on `127.0.0.1:24224` only. No container mounts the
Docker socket. The forwarder runs as uid 65534 with a read-only root
filesystem and no capabilities, on its own network, so no other container can
write into the stream. It verifies the platform's certificate. With `syslog`
each event is one RFC 5424 message (facility 10, security/authorization;
APP-NAME `edulims`; MSGID `security`; the JSON line as MSG). With `http` it
posts a JSON array of events per batch. While the platform is unreachable,
Fluent Bit keeps the events in memory and retries; a restart of the forwarder
in that time loses them, and the host copy stays.

`docker compose logs edulims` keeps working: Docker reads the lines from its
local cache.

Turn it off by removing the `COMPOSE_FILE` line and recreating the stack:

```sh
docker compose up -d --wait --remove-orphans
```

### Without the forwarder: Docker's syslog driver

When the platform takes syslog over TLS and you do not need the filter,
Docker can send straight to it. Put this in `compose.override.yaml` and leave
`compose.logship.yaml` out:

```yaml
services:
  edulims:
    logging:
      driver: syslog
      options:
        syslog-address: tcp+tls://siem.example.org:6514
        syslog-format: rfc5424micro
        syslog-facility: authpriv
        tag: edulims
```

This ships every line eduLIMS writes, start-up messages and errors included,
not the security events alone. This route is not tested here.

### Podman hosts

Podman has neither the `fluentd` nor the `syslog` log driver, so
`compose.logship.yaml` does not apply there. On a systemd host Podman writes
container output to the journal by default; forward the entries whose
`CONTAINER_NAME` is the eduLIMS container with the
host's own tools (`systemd-journal-upload`, or rsyslog with `imjournal` and
TLS). This route is not tested here.

## Local development

`compose.dev.yaml` runs what `pnpm dev` needs: the same PostgreSQL image with
the same databases, a read-only `edulims_readonly` role for the Postgres MCP
server, and Keycloak in development mode with the `edulims` realm imported
from `docker/keycloak/edulims-realm.json` (an OIDC and a SAML client, and
users with roles assigned directly, through groups, or both, each with its
name as password; the
[demo accounts](https://edulims.eu/get-started/demo-accounts/) list them).
The realm is imported when the Keycloak container is created, so a changed
realm file needs `pnpm dev:db:stop && pnpm dev:db`. It also creates the
`edulims_test` and `edulims_e2e` databases and gives the `edulims` role
`CREATEDB` (`docker/postgres/init/30-edulims-test-databases.sh`): every
`pnpm test` and `pnpm test:e2e` run creates its own database next to one of
them and drops it at the end. On a dev volume created before that grant, run
the script once by hand (its header has the command).
FerroEHR is the opt-in `ferroehr` profile. `pnpm dev:db` starts the stack
with `podman compose`, or `docker compose` without Podman; the header of
`compose.dev.yaml` has the commands.

`pnpm db:seed` registers the development Keycloak through the admin service
as two identity providers, `keycloak` (OIDC) and `keycloak-saml` (SAML), when
it runs and `EDULIMS_IDP_PRIVATE_ORIGINS` allows its origin (the example env
file does), so `pnpm db:reset && pnpm db:seed` gives working Keycloak buttons.
It adds, next to the development login users, a fictional demo set: 70
people (students, teachers, administrators and coordinators, every address
`@example.test`) with accounts at those two providers, live and expired
sessions, three blocked students and about four weeks of activity-log events.
The demo people have no password and no Keycloak user, so nobody signs in as
one; they exist to fill the Admin portal. The seed prints counts only, and
running it again changes nothing. `pnpm db:reset` gives a fresh copy.

The host CLI runs on the developer machine through the pnpm scripts, against
`DATABASE_URL` from `.env`: `pnpm db:migrate`, `pnpm db:prune`,
`pnpm idp:add <file|->`, `pnpm idp:list`, `pnpm idp:enable <id>`,
`pnpm idp:disable <id>`, `pnpm idp:rekey`, `pnpm admin:grant <email>` and
`pnpm admin:revoke <email>`, each `node src/server/cli.ts <command>`.
