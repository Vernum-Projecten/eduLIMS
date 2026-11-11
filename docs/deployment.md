<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Deploying eduLIMS

eduLIMS runs with Docker Compose on one Linux host, beside FerroEHR (the
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
| `edulims-migrate` | `ghcr.io/vernum-projecten/edulims-migrate` | nothing | applies the migrations, then exits |
| `edulims` | `ghcr.io/vernum-projecten/edulims` | `127.0.0.1:3000` | the application |
| `keycloak` (profile) | `quay.io/keycloak/keycloak:26.8.2` | `127.0.0.1:8180` | the optional identity provider |

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

The server and the migration image share one base,
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
build bundles every dependency into `.output/`. The migration image holds the
production `node_modules` and the sources from `pnpm deploy`, and runs
`src/server/db/migrate.ts` with Node.js 26's type stripping.

## Prepare the host

1. A Linux host with Docker Engine and the Compose plugin, at least 2 vCPU
   and 4 GB of memory. On Azure, the VM, its disks and its backups live in an
   EU region (West Europe or North Europe) and nowhere else: the database
   holds student data under the AVG (GDPR), and keeping it in the EU keeps the
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
3. Pull, verify and start:

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

## Identity provider

eduLIMS signs users in through OpenID Connect with Microsoft Entra ID, with
Keycloak, or with both on the sign-in page. Each provider is on when its
variables are set in `.env`.

- **Microsoft Entra ID** is the default for Hanze: students and staff sign
  in with their institution account, and no identity service runs on the
  host. Register an app in the Hanze tenant with the redirect URI that
  eduLIMS's better-auth configuration names under `BETTER_AUTH_URL`, define
  the app roles `edulims-student`, `edulims-docent` and `edulims-beheerder`,
  assign them to users or groups, and set `MICROSOFT_CLIENT_ID`,
  `MICROSOFT_CLIENT_SECRET` and `MICROSOFT_TENANT_ID`.
- **Keycloak** fits a deployment without access to the tenant (a pilot, a
  partner institution, a test environment), or one that federates several
  sources. Start it with the profile, create the realm and a confidential
  client with the standard flow and PKCE S256, and set `KEYCLOAK_ISSUER`
  (`https://<keycloak host>/realms/<realm>`), `KEYCLOAK_CLIENT_ID`,
  `KEYCLOAK_CLIENT_SECRET` and `KEYCLOAK_LABEL`:

  ```sh
  COMPOSE_PROFILES=keycloak docker compose up -d --wait
  ```

  Keycloak stores its state in its own database on the shared PostgreSQL
  server, so the backups below cover it. `docker/keycloak/edulims-realm.json`
  is the development realm; use it as a template only, because its client
  secret and users are public.

### Role mapping

eduLIMS knows three roles: `student`, `docent` and `beheerder`. At sign-in it
reads the claim `OIDC_ROLE_CLAIM` from the ID token and maps each value
through `OIDC_ROLE_MAP`:

```text
OIDC_ROLE_CLAIM=roles
OIDC_ROLE_MAP=edulims-student=student,edulims-docent=docent,edulims-beheerder=beheerder
OIDC_DEFAULT_ROLE=
```

Entra ID writes assigned app roles to `roles`. The development realm writes
its realm roles to `roles` through a protocol mapper; a Keycloak realm you
set up yourself needs the same mapper (realm roles, claim `roles`, added to
the ID token). A user whose token holds no mapped value gets
`OIDC_DEFAULT_ROLE`, or is refused when it is empty. The mapping seeds the
role in the eduLIMS database; the database is what every access check reads,
so a beheerder can change a role in eduLIMS and it applies on the next
request.

## Updating

The risk analysis names vulnerable libraries in the containers as a risk and
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

## Local development

`compose.dev.yaml` runs what `pnpm dev` needs: the same PostgreSQL image with
the same databases, a read-only `edulims_readonly` role for the Postgres MCP
server, and Keycloak in development mode with the `edulims` realm imported
from `docker/keycloak/edulims-realm.json` (users `student`, `docent` and
`beheerder`, each with its name as password). FerroEHR is the opt-in
`ferroehr` profile. The header of `compose.dev.yaml` has the commands.
