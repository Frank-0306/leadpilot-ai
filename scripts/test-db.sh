#!/usr/bin/env bash
# Applies the Supabase migrations to a throwaway Postgres database and runs the
# SQL test suite in supabase/tests. Usage:
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="leadpilot_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
run() { psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }
run supabase/tests/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do echo "migrate: $f"; run "$f" >/dev/null; done
for f in supabase/tests/[1-9]*.sql; do echo "test:    $f"; run "$f"; done
echo "All database tests passed."
