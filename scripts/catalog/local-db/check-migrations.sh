#!/bin/zsh
# Applies every file in supabase/migrations, in order, to a throwaway local PostgreSQL (17) shaped like a
# Supabase project by the shared stand-in (tests/support/supabase-stub.sql), applies the Workouts v2
# migrations a second time to prove they are safe to re-run, then runs the save/start/finish smoke test.
# As in `npm test`, a migration that needs pg_cron is skipped when this PostgreSQL lacks it. Nothing
# touches a real Supabase project. Needs Homebrew postgresql@17 (initdb, pg_ctl, psql).
# Usage: scripts/catalog/local-db/check-migrations.sh [port]   (default 3441)
set -u
PORT="${1:-3441}"
HERE="${0:A:h}"
ROOT="${HERE:h:h:h}"
WORK="$(mktemp -d)"
export LC_ALL=C LANG=C
PSQL=(psql -X -q -h localhost -p "$PORT" -U postgres -v ON_ERROR_STOP=1)
cleanup() { pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT INT TERM
initdb -D "$WORK/data" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
pg_ctl -D "$WORK/data" -l "$WORK/server.log" -o "-p $PORT -k '' -c listen_addresses=localhost" -w start >/dev/null || { tail "$WORK/server.log"; exit 1; }
"${PSQL[@]}" -c "create database fitx" && "${PSQL[@]}" -d fitx -f "$ROOT/tests/support/supabase-stub.sql" >/dev/null || exit 1
# Supabase has pg_cron; a plain PostgreSQL needs it installed and preloaded.
cron=$("${PSQL[@]}" -d fitx -At -c "select count(*) from pg_available_extensions where name = 'pg_cron' and current_setting('shared_preload_libraries') ~ 'pg_cron'")
for file in "$ROOT"/supabase/migrations/*.sql; do
  if [[ $cron == 0 ]] && grep -qiE 'create[[:space:]]+extension[^;]*pg_cron' "$file"; then
    echo "skipped ${file:t}: needs pg_cron, which this PostgreSQL lacks"
    continue
  fi
  "${PSQL[@]}" -d fitx -1 -f "$file" >"$WORK/out" 2>&1 || { echo "FAILED: ${file:t}"; head -20 "$WORK/out"; exit 2; }
  echo "applied ${file:t}"
done
for file in "$ROOT"/supabase/migrations/202611181300*.sql; do
  "${PSQL[@]}" -d fitx -1 -f "$file" >"$WORK/out" 2>&1 || { echo "RE-RUN FAILED: ${file:t}"; head -20 "$WORK/out"; exit 3; }
done
echo "Workouts v2 migrations re-applied cleanly."
psql -X -h localhost -p "$PORT" -U postgres -d fitx -f "$HERE/workout-rpc-smoke.sql"
