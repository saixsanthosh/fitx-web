#!/bin/bash
# Applies every migration in supabase/migrations to a throwaway local PostgreSQL database (with
# stand-ins for what Supabase provides), runs the Phase 10 migrations a second time, and then the
# Phase 10 checks. Nothing touches a real project. Needs PostgreSQL 15 or newer (initdb, pg_ctl, psql).
# Usage: admin/tests/database/run-database-checks.sh [port]     (default 54329)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PORT="${1:-54329}"
WORK="$(mktemp -d)"
DATA="$WORK/pg"
cleanup() { pg_ctl -D "$DATA" -m fast stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

LC_ALL=C initdb -D "$DATA" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
LC_ALL=C pg_ctl -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$WORK/server.log" -w start >/dev/null
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "create database fitx" >/dev/null
"${PSQL[@]}" -d fitx -f "$HERE/supabase-stubs.sql" >/dev/null 2>"$WORK/stubs.log" || { cat "$WORK/stubs.log"; exit 1; }
count=0
for file in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d fitx --single-transaction -f "$file" >/dev/null 2>"$WORK/last.log" || { echo "FAILED: $(basename "$file")"; cat "$WORK/last.log"; exit 1; }
  count=$((count + 1))
done
echo "All $count migrations applied."
for file in "$ROOT"/supabase/migrations/202611181800*.sql; do
  "${PSQL[@]}" -d fitx --single-transaction -f "$file" >/dev/null 2>"$WORK/last.log" || { echo "Re-run FAILED: $(basename "$file")"; cat "$WORK/last.log"; exit 1; }
done
echo "Phase 10 migrations ran a second time without errors."
"${PSQL[@]}" -d fitx -f "$HERE/phase10-checks.sql"
