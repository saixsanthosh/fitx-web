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

# Parallel replies from one account must wait for each other (the per-account advisory lock), or
# together they could pass the hourly limit. Session A replies and keeps its transaction open;
# session B replies on a different request of the same account and must time out waiting for A.
"${PSQL[@]}" -d fitx >"$WORK/lock-a.log" 2>&1 <<'SQL' &
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000c', false);
begin;
select public.fitx_reply_support_request((select id from public.support_requests where subject = 'Second one'), 'Holding the lock');
select pg_sleep(5);
commit;
SQL
holder=$!
held=0
for _ in $(seq 1 50); do
  held=$("${PSQL[@]}" -d fitx -At -c "select count(*) from pg_locks where locktype = 'advisory' and granted")
  [ "$held" -ge 1 ] && break
  sleep 0.2
done
[ "$held" -ge 1 ] || { echo "FAILED: session A never took the support lock"; cat "$WORK/lock-a.log"; exit 1; }
"${PSQL[@]}" -d fitx <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000c', false) \gset ignored_
set lock_timeout = '500ms';
do $$ begin
  perform public.fitx_reply_support_request((select id from public.support_requests where subject = 'Third one'), 'Should wait');
  raise exception 'a parallel reply from the same account did not wait for the per-account lock';
exception when lock_not_available then null; end $$;
\echo ok parallel support replies from one account wait for each other
SQL
wait "$holder" || { echo "FAILED: session A"; cat "$WORK/lock-a.log"; exit 1; }
echo "ALL PHASE 10 DATABASE CHECKS PASSED"
