#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Creates the eduLIMS login role and the database it owns, and, when their
# passwords are set, the Keycloak role and database and the read-only eduLIMS
# role. The PostgreSQL image's entrypoint runs every script in
# /docker-entrypoint-initdb.d/ once, in name order, as the bootstrap
# superuser, and only when the data directory is empty. On a server that
# already holds data, run it by hand (docs/deployment.md):
#
#   docker compose exec -T postgres bash < docker/postgres/init/20-edulims.sh
#
# The server is ghcr.io/ferrohealth/ferroehr-postgres in both compose files,
# and that image's own 10-ferroehr-init.sh creates the FerroEHR role, database
# and schemas before this script runs.
#
# The script is idempotent: a second run sets the passwords again and creates
# only what is missing.
#
#   EDULIMS_DB_USER            the eduLIMS login role (default edulims)
#   EDULIMS_DB_PASSWORD        its password (required)
#   EDULIMS_DB_NAME            the eduLIMS database (default edulims)
#   KEYCLOAK_DB_USER           the Keycloak login role (default keycloak)
#   KEYCLOAK_DB_PASSWORD       its password; unset means no Keycloak database
#   KEYCLOAK_DB_NAME           the Keycloak database (default keycloak)
#   EDULIMS_READONLY_USER      a read-only role on the eduLIMS database
#                              (default edulims_readonly)
#   EDULIMS_READONLY_PASSWORD  its password; unset means no read-only role.
#                              compose.dev.yaml sets it for the Postgres MCP
#                              server; compose.yaml does not.
set -Eeuo pipefail

superuser="${POSTGRES_USER:-postgres}"

# psql_db DB ARGS...: psql as the bootstrap superuser, stopping at the first
# error, with no ~/.psqlrc.
psql_db() {
  local db="$1"
  shift
  psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$superuser" --dbname "$db" "$@"
}

# owned_database USER PASSWORD DB: a login role and a database it owns, which
# only it (and the superuser) may connect to.
#
# The values reach SQL as psql variables, quoted by format() (%I for an
# identifier, %L for a literal), so a password with a quote in it cannot
# change the statement. \gexec runs each row the SELECT returns.
owned_database() {
  local user="$1" password="$2" database="$3"
  echo "edulims init: role '${user}', database '${database}'"
  psql_db postgres -v user="$user" -v password="$password" -v database="$database" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'user')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'user')
\gexec

SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'user', :'password')
\gexec

SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0', :'database', :'user', 'UTF8')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database')
\gexec

-- Every role is a member of PUBLIC, so without this the FerroEHR role could
-- open this database. The owner keeps its own privileges.
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database')
\gexec
SQL
  # The public schema belongs to the owner, so its migrations create tables
  # there without a grant from the superuser.
  psql_db "$database" -v user="$user" <<'SQL'
SELECT format('ALTER SCHEMA public OWNER TO %I', :'user')
\gexec
SQL
}

# readonly_role USER PASSWORD DB OWNER: a login role that reads every table
# OWNER has made or will make in DB's public schema, in read-only
# transactions by default.
readonly_role() {
  local user="$1" password="$2" database="$3" owner="$4"
  echo "edulims init: read-only role '${user}' on '${database}'"
  psql_db postgres -v user="$user" -v password="$password" -v database="$database" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'user')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'user')
\gexec

SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'user', :'password')
\gexec

SELECT format('ALTER ROLE %I SET default_transaction_read_only = on', :'user')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database', :'user')
\gexec
SQL
  # Default privileges attach to the role that creates the objects, so they
  # are set FOR ROLE the owner, whose migrations create the tables.
  psql_db "$database" -v user="$user" -v owner="$owner" <<'SQL'
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'user')
\gexec

SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', :'user')
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO %I', :'owner', :'user')
\gexec
SQL
}

edulims_user="${EDULIMS_DB_USER:-edulims}"
edulims_db="${EDULIMS_DB_NAME:-edulims}"
owned_database "$edulims_user" \
  "${EDULIMS_DB_PASSWORD:?EDULIMS_DB_PASSWORD must be set for the eduLIMS database role}" \
  "$edulims_db"

if [[ -n "${KEYCLOAK_DB_PASSWORD:-}" ]]; then
  owned_database "${KEYCLOAK_DB_USER:-keycloak}" "$KEYCLOAK_DB_PASSWORD" "${KEYCLOAK_DB_NAME:-keycloak}"
fi

if [[ -n "${EDULIMS_READONLY_PASSWORD:-}" ]]; then
  readonly_role "${EDULIMS_READONLY_USER:-edulims_readonly}" "$EDULIMS_READONLY_PASSWORD" \
    "$edulims_db" "$edulims_user"
fi

echo "edulims init: done"
