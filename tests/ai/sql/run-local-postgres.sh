#!/bin/zsh
# Applies every FITX migration the coach depends on to a throwaway local Postgres (port 3469, data in a
# temp folder that is deleted afterwards), then runs coach-migration-checks.sql as two test members.
# Needs PostgreSQL's initdb, pg_ctl and psql on PATH (for example `brew install postgresql@17`).
# Never point this at a real Supabase project.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
TMP="$(mktemp -d)"
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 PGHOST=127.0.0.1 PGPORT="${FITX_TEST_PG_PORT:-3469}" PGUSER=postgres PGDATABASE=postgres
cleanup() { pg_ctl -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM
initdb -D "$TMP/data" -U postgres -A trust --locale=C -E UTF8 >/dev/null
pg_ctl -D "$TMP/data" -o "-p $PGPORT -k '' -c listen_addresses=127.0.0.1" -l "$TMP/pg.log" -w start >/dev/null
psql -q -v ON_ERROR_STOP=1 -f "$HERE/supabase-stubs.sql" >/dev/null
for m in 20260924162506_initial_fitx_schema 20260924164105_harden_trigger_function_privileges 20260924170604_fitx_v1_core_product \
         20260924171527_fitx_preferences_water_goal 20260924174525_fitx_foreign_key_indexes 20261115100000_fitx_workout_session_pause_timing \
         20261115110000_fitx_workout_prescription_targets 20261117090000_fitx_profiles_intro_flag 20261117100000_fitx_profiles_column_privileges \
         20261117110000_fitx_food_search_quota 20261118150000_fitx_ai_coach; do
  psql -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/migrations/$m.sql" >/dev/null 2>&1 || { echo "migration failed: $m"; exit 1; }
done
# The coach migration must be safe to run twice.
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/migrations/20261118150000_fitx_ai_coach.sql" >/dev/null 2>&1 || { echo "coach migration is not re-runnable"; exit 1; }
psql -q -f "$HERE/coach-migration-checks.sql"
