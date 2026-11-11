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

## Identity provider

eduLIMS signs users in through OpenID Connect with Microsoft Entra ID, with
Keycloak, or with both on the sign-in page. A provider is on when all of its
variables are set in `.env` (all or none), and a production server refuses to
start with no provider at all.

- **Microsoft Entra ID** suits an institution that already uses it: students
  and staff sign in with their institution account, and no identity service
  runs on the host. Register an app in the institution's tenant with the redirect URI
  `<BETTER_AUTH_URL>/api/auth/callback/microsoft`, define the app roles
  `edulims-student`, `edulims-teacher` and `edulims-admin`, assign them to
  users or groups, and set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`
  and `MICROSOFT_TENANT_ID`.
- **Keycloak** fits a deployment without access to the tenant (a pilot, a
  partner institution, a test environment), or one that federates several
  sources. Start it with the profile, create the realm and a confidential
  client with the standard flow, PKCE S256, the redirect URI
  `<BETTER_AUTH_URL>/api/auth/callback/keycloak` and the valid post logout
  redirect URI `<BETTER_AUTH_URL>/login` (signing out of eduLIMS also ends
  the Keycloak session and returns the user to the sign-in page; without it
  Keycloak shows its own "You are logged out" page), and set `KEYCLOAK_ISSUER`
  (`https://<keycloak host>/realms/<realm>`; plain `http` is accepted only on
  localhost outside production), `KEYCLOAK_CLIENT_ID` and
  `KEYCLOAK_CLIENT_SECRET`. `KEYCLOAK_LABEL` is the sign-in button's text
  (default "Sign in with Keycloak").

  ```sh
  COMPOSE_PROFILES=keycloak docker compose up -d --wait
  ```

  Keycloak stores its state in its own database on the shared PostgreSQL
  server, so the backups below cover it. `docker/keycloak/edulims-realm.json`
  is the development realm; use it as a template only, because its client
  secret and users are public.

### One account per provider

eduLIMS never links accounts across identity providers. A user who first
signs in with Entra ID cannot later sign in with Keycloak under the same email
address, or the other way round: the sign-in page answers "This email address
already signs in through another sign-in method" (error code
`account_not_linked`) and no session starts. A Keycloak realm with
self-registration, or a federation that lets users set their own address,
therefore cannot take over an Entra ID user's account, roles or classes. To
move a user from one provider to the other, an administrator removes the old
eduLIMS account first.

### Role mapping

eduLIMS knows three roles: `student`, `teacher` and `admin`. At sign-in it
reads the claim `OIDC_ROLE_CLAIM` (a dot path) from the ID token, and from
the ID token only, and maps each value through `OIDC_ROLE_MAP`. The defaults:

```text
# OIDC_ROLE_CLAIM: `roles` for Entra ID, `realm_access.roles` for Keycloak
OIDC_ROLE_MAP=edulims-student:student,edulims-teacher:teacher,edulims-admin:admin
OIDC_DEFAULT_ROLE=
```

Every value in the claim is mapped, so a user can hold more than one role.
The allowed role sets are student, teacher, admin, and teacher with admin
together ([ADR 0012](adr/0012-multiple-roles-and-portal-switcher.md)).
Student is exclusive: a token that maps to student and teacher, or student
and admin, refuses the sign-in with the error `role_conflict`, and the
sign-in page tells the user to contact their administrator. The refusal is
logged with the provider id only. A user whose token holds no mapped value
gets `OIDC_DEFAULT_ROLE`, and is refused with `no_edulims_role` when it is
unset (deny by default). The mapping stores the role set in the eduLIMS
database, sorted and comma-separated (`teacher,admin`); the database is what
every access check reads, so a role changed in eduLIMS applies on the next
request. Every write of a role set, from the provider, the seed or the
better-auth admin endpoints, passes the same check.

Roles are a set, not a ranking: admin does not include teacher, and teacher
does not include admin. Each server function checks the one role it needs.

#### Microsoft Entra ID: app roles, assigned to users or to groups

Define the app roles on the app registration and assign them in the
enterprise application, to a user directly or to a group (assigning an app
role to a group needs Entra ID P1 or higher; members of nested groups do not
inherit it). Entra ID writes the effective app roles of the user, direct and
through groups, to the `roles` claim of the ID token, which is the default
`OIDC_ROLE_CLAIM`.

Use app roles, not the `groups` claim. The `groups` claim carries group
object IDs, not names, and a user in more than 200 groups gets an overage
claim instead of the list, which eduLIMS cannot read. If you still map
groups, set `OIDC_ROLE_CLAIM=groups`, turn on the groups claim for the ID
token in the token configuration, and map the object IDs:

```text
OIDC_ROLE_CLAIM=groups
OIDC_ROLE_MAP=<object id of the student group>:student,<object id of the teacher group>:teacher,<object id of the admin group>:admin
```

#### Keycloak: realm roles, direct or through groups

Give a user a realm role directly, through a group that has the role, or
through a composite role. Keycloak writes realm roles to
`realm_access.roles` in the access token by default, which eduLIMS does not
read, so the client needs a "User Realm Role" protocol mapper with token
claim name `realm_access.roles` and "Add to ID token" on. That mapper writes
the effective realm roles: the direct ones, the ones from every group the
user is in, and the ones a composite role expands to. The development realm
has that mapper.

To map group membership instead of roles, add a "Group Membership" mapper
with claim name `groups`, "Full group path" on and "Add to ID token" on (the
development realm has one), and map the group paths:

```text
OIDC_ROLE_CLAIM=groups
OIDC_ROLE_MAP=/Students:student,/Teachers:teacher,/Administrators:admin
```

Group paths change when a group is renamed or moved, and realm roles do not,
so prefer `realm_access.roles`.

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
session 30 days after it expired. The prune command applies both periods. It
is safe to run more than once: a second run removes nothing new. Run it
every day from the migrate image, which holds the command:

```sh
# /etc/cron.d/edulims-prune, as root, 03:30 every night
30 3 * * * root cd /srv/edulims && docker compose run --rm edulims-migrate /app/src/server/db/prune.ts
```

Or, on a host with systemd, a timer instead of cron:

```ini
# /etc/systemd/system/edulims-prune.service
[Service]
Type=oneshot
WorkingDirectory=/srv/edulims
ExecStart=/usr/bin/docker compose run --rm edulims-migrate /app/src/server/db/prune.ts

# /etc/systemd/system/edulims-prune.timer
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable it with `systemctl enable --now edulims-prune.timer`. The command prints
the number of events and sessions it removed. On a development machine,
`pnpm db:prune` does the same against `DATABASE_URL`. The backups above keep
deleted rows for another 30 days, until the oldest dump is removed.

## Local development

`compose.dev.yaml` runs what `pnpm dev` needs: the same PostgreSQL image with
the same databases, a read-only `edulims_readonly` role for the Postgres MCP
server, and Keycloak in development mode with the `edulims` realm imported
from `docker/keycloak/edulims-realm.json` (users with roles assigned
directly, through groups, or both, each with its name as password; the
[demo accounts](https://edulims.eu/get-started/demo-accounts/) list them).
The realm is imported when the Keycloak container is created, so a changed
realm file needs `pnpm dev:db:stop && pnpm dev:db`. It also creates the throwaway
`edulims_test` and `edulims_e2e` databases that `pnpm test` and
`pnpm test:e2e` use (`docker/postgres/init/30-edulims-test-databases.sh`).
FerroEHR is the opt-in `ferroehr` profile. `pnpm dev:db` starts the stack
with `podman compose`, or `docker compose` without Podman; the header of
`compose.dev.yaml` has the commands.

`pnpm db:seed` adds, next to the development login users, a fictional demo
set: 70 people (students, teachers, administrators and coordinators, every
address `@example.test`) with Entra ID and Keycloak accounts, live and expired
sessions, three blocked students and about four weeks of activity-log events.
The demo people have no password and no Keycloak user, so nobody signs in as
one; they exist to fill the Admin portal. The seed prints counts only, and
running it again changes nothing. `pnpm db:reset` gives a fresh copy.
