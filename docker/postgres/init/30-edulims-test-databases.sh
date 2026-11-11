#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Development only (compose.dev.yaml mounts it; compose.yaml does not): the
# throwaway databases the test suites use, owned by the eduLIMS role, so a test
# run never touches the development database.
#
#   edulims_test  `pnpm test` (Vitest): cleared and migrated once per run,
#                 every case in a transaction that is rolled back
#   edulims_e2e   `pnpm test:e2e` (Playwright): cleared, migrated and seeded
#                 before the app starts
#
# The PostgreSQL entrypoint runs it once, after 20-edulims.sh has created the
# eduLIMS role, and only when the data directory is empty. On a dev server
# that already holds data, run it by hand (idempotent: it creates only what is
# missing):
#
#   podman compose -f compose.dev.yaml exec -T postgres bash < docker/postgres/init/30-edulims-test-databases.sh
#
#   EDULIMS_DB_USER        the owning role (default edulims), already present
#   EDULIMS_TEST_DB_NAMES  space-separated names (default "edulims_test edulims_e2e")
set -Eeuo pipefail

superuser="${POSTGRES_USER:-postgres}"
owner="${EDULIMS_DB_USER:-edulims}"
read -r -a names <<<"${EDULIMS_TEST_DB_NAMES:-edulims_test edulims_e2e}"

psql_db() {
  local db="$1"
  shift
  psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$superuser" --dbname "$db" "$@"
}

for database in "${names[@]}"; do
  echo "edulims init: test database '${database}' owned by '${owner}'"
  # Values reach SQL as psql variables quoted by format(), as in 20-edulims.sh.
  psql_db postgres -v owner="$owner" -v database="$database" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0', :'database', :'owner', 'UTF8')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database')
\gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database')
\gexec
SQL
  psql_db "$database" -v owner="$owner" <<'SQL'
SELECT format('ALTER SCHEMA public OWNER TO %I', :'owner')
\gexec
SQL
done

echo "edulims init: test databases done"
