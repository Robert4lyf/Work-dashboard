#!/usr/bin/env bash
# Tests the Release G and H SQL (supabase/release-g-runs.sql, supabase/release-h.sql) against a
# real PostgreSQL: a throwaway cluster in a temp dir on its own port, a miniature of what Supabase
# provides (bootstrap.sql), supabase-setup.sql, then the two migrations; the cases as two users,
# truly concurrent sessions, a partial install and its repair, the migrations run twice, and the
# rollbacks. Everything is removed afterwards.
#   tests/db/run.sh            (PGBIN=/usr/lib/postgresql/16/bin and PGPORT=54329 by default)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PGPORT:-54329}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "PostgreSQL not found (set PGBIN)"; exit 2; }
DIR="$(mktemp -d)"
A=11111111-1111-1111-1111-111111111111
G="$ROOT/supabase/release-g-runs.sql"
H="$ROOT/supabase/release-h.sql"

# initdb and the server refuse to run as root: as root, they run as the postgres user.
as_pg() {
  if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi
}
cleanup() {
  as_pg "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT
[ "$(id -u)" = 0 ] && chown postgres "$DIR"

as_pg "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust -E UTF8 >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null

PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$DIR" -p "$PORT" -U postgres -d postgres)
OUT="$DIR/out"
run() { "${PSQL[@]}" "$@" 2>&1 | tee -a "$OUT" | grep -E 'ok - |FAIL|ERROR' | sed -E 's/^.*(NOTICE|ERROR): +/  /' || true; }
sql() { run -f - <<<"$1"; } # (SQL and psql's \gset together, which -c doesn't take)
step() { echo "== $*"; }
q() { "${PSQL[@]}" -At -c "$1"; }
apply() { "${PSQL[@]}" -f "$1" >/dev/null 2>&1; }
pass() { echo "ok - $1" | tee -a "$OUT"; }
fail() { echo "FAIL: $1" | tee -a "$OUT"; }
same() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got $2, wanted $3)"; fi; }
# A function's text, settings and SECURITY DEFINER flag, to compare installs.
fn() { q "select md5(prosrc) || coalesce(proconfig::text, '') || prosecdef from pg_proc where proname = '$1'"; }
count_fn() { q "select count(*) from pg_proc where proname = '$1'"; }
probe() { q "set role authenticated; select t.as_user('$A'); select public.cockpit_sync_checks()::text" | tail -1; }
as_a="set role authenticated; select t.as_user('$A');"

step "setup: Supabase stand-in, supabase-setup.sql, release-g-runs.sql, release-h.sql"
"${PSQL[@]}" -f "$HERE/bootstrap.sql" >/dev/null
apply "$ROOT/supabase-setup.sql"
SETUP_FN=$(fn cockpit_exec_report)
# (release-h.sql needs release-g-runs.sql: run first, it stops and changes nothing)
if apply "$H"; then fail "release-h.sql ran without release-g-runs.sql"; else pass "release-h.sql before release-g-runs.sql stops"; fi
same "and changes nothing" "$(count_fn cockpit_sync_checks)" 0
same "nor the report pairing" "$(fn cockpit_exec_report)" "$SETUP_FN"
apply "$G"
same "release-g-runs.sql's cockpit_exec_report is supabase-setup.sql's" "$(fn cockpit_exec_report)" "$SETUP_FN"
GUARD_FN=$(fn cockpit_items_wrun_guard)
apply "$H"
same "release-h.sql's cockpit_exec_report is the same too" "$(fn cockpit_exec_report)" "$SETUP_FN"
same "release-h.sql's guard is release-g-runs.sql's" "$(fn cockpit_items_wrun_guard)" "$GUARD_FN"
DEFINERS="from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef"
same "SECURITY DEFINER functions: all nine there" "$(q "select count(*) $DEFINERS")" 9
same "each with search_path public, pg_temp" \
  "$(q "select count(*) $DEFINERS and coalesce(p.proconfig::text, '') <> '{\"search_path=public, pg_temp\"}'")" 0

step "cases"
run -f "$HERE/cases.sql"

step "concurrent: two sessions complete the same step of one run"
# The run at revision 1, then session 1 takes it to 2 and holds its transaction open for two
# seconds; session 2, started once session 1 holds the run's lock, makes the same change from revision 1.
run -c "$as_a select t.eq((public.cockpit_put_wrun('wrun:c1', 0, t.run('c1', 1, '{\"cur\":\"s1\"}'), 'op-c1-create'))->>'status', 'accepted', 'a run to race on');"
"${PSQL[@]}" -At -c "$as_a begin; select 'session 1: ' || ((public.cockpit_put_wrun('wrun:c1', 1, t.run('c1', 2, '{\"cur\":\"s2\",\"by\":\"one\"}'), 'op-c1-one'))->>'status'); select pg_sleep(2); commit;" >"$DIR/s1" 2>&1 &
S1=$!
for _ in $(seq 50); do
  n=$(q "select count(*) from pg_locks where locktype = 'advisory' and granted")
  [ "$n" = 1 ] && break
  sleep 0.1
done
sql "$as_a select clock_timestamp() as t0 \gset
select public.cockpit_put_wrun('wrun:c1', 1, t.run('c1', 2, '{\"cur\":\"s2\",\"by\":\"two\"}'), 'op-c1-two') as res \gset
select t.ok(clock_timestamp() - :'t0'::timestamptz > interval '1 second', 'session 2 waited for session 1''s lock');
select t.eq(:'res'::jsonb->>'status', 'conflict', 'then was refused');
select t.eq(:'res'::jsonb->'data'->>'by', 'one', 'and given session 1''s run');
select t.eq((select data->>'by' from cockpit_items where key = 'wrun:c1'), 'one', 'one change stored');
select t.eq((select data->>'rev' from cockpit_items where key = 'wrun:c1'), '2', 'at revision 2');"
wait $S1 || true
grep -q 'session 1: accepted' "$DIR/s1" && pass "session 1 was accepted" || { cat "$DIR/s1"; fail "session 1"; exit 1; }

step "concurrent: two sessions create the same run (a repeat's run made on two devices)"
"${PSQL[@]}" -At -c "$as_a begin; select 'session 1: ' || ((public.cockpit_put_wrun('wrun:c2', 0, t.run('c2', 1, '{\"by\":\"one\"}'), 'op-c2-one'))->>'status'); select pg_sleep(2); commit;" >"$DIR/s1" 2>&1 &
S1=$!
for _ in $(seq 50); do
  n=$(q "select count(*) from pg_locks where locktype = 'advisory' and granted")
  [ "$n" = 1 ] && break
  sleep 0.1
done
sql "$as_a select public.cockpit_put_wrun('wrun:c2', 0, t.run('c2', 1, '{\"by\":\"two\"}'), 'op-c2-two') as res \gset
select t.eq(:'res'::jsonb->>'status', 'conflict', 'the second creation waits, then is refused (no duplicate-key error)');
select t.eq((select count(*)::text from cockpit_items where key = 'wrun:c2'), '1', 'one row');"
wait $S1 || true
grep -q 'session 1: accepted' "$DIR/s1" && pass "the first creation was accepted" || { cat "$DIR/s1"; fail "session 1"; exit 1; }

step "concurrent: two direct upserts of the same next revision (an older copy of the app on two devices)"
# Both write revision 3 over the stored 2, past the function. The row lock serialises them: the
# second waits, is checked again against the first's row (READ COMMITTED re-reads it), and the
# guard skips it, so it isn't returned and its device takes the stored run.
run -c "$as_a select t.eq((public.cockpit_put_wrun('wrun:c3', 0, t.run('c3', 1), 'op-c3-create'))->>'status', 'accepted', 'a run for two direct writes');
select t.eq((public.cockpit_put_wrun('wrun:c3', 1, t.run('c3', 2), 'op-c3-two'))->>'status', 'accepted', 'at revision 2');"
UPS="insert into cockpit_items (user_id, key, kind, data, edited_at) values (auth.uid(), 'wrun:c3', 'wrun', t.run('c3', 3, '{\"by\":\"BY\"}'), 99999999999999) on conflict (user_id, key) do update set data = excluded.data, edited_at = excluded.edited_at returning key"
"${PSQL[@]}" -At -c "$as_a begin; ${UPS//BY/one}; select pg_sleep(2); commit;" >"$DIR/s1" 2>&1 &
S1=$!
for _ in $(seq 50); do
  n=$(q "select count(*) from pg_stat_activity where wait_event = 'PgSleep'")
  [ "$n" = 1 ] && break
  sleep 0.1
done
sql "$as_a select clock_timestamp() as t0 \gset
with w as (${UPS//BY/two}) select count(*) as wrote from w \gset
select t.ok(clock_timestamp() - :'t0'::timestamptz > interval '1 second', 'the second direct write waited for the first''s row lock');
select t.eq(:'wrote', '0', 'then was skipped by the guard (nothing returned)');
select t.eq((select data->>'by' from cockpit_items where key = 'wrun:c3'), 'one', 'the first one stored');
select t.eq((select data->>'rev' from cockpit_items where key = 'wrun:c3'), '3', 'at revision 3');"
wait $S1 || true
grep -q 'wrun:c3' "$DIR/s1" && pass "the first direct write was returned" || { cat "$DIR/s1"; fail "direct write 1"; exit 1; }

step "a partial install, and its repair by running the migrations again"
ALL='{"guard": true, "release": "h", "guard_fn": true, "put_wrun": true}'
same "the probe: everything installed" "$(probe)" "$ALL"
q "drop function public.cockpit_put_wrun(text, integer, jsonb, text)" >/dev/null
same "the probe tells the guard without the function" "$(probe)" '{"guard": true, "release": "h", "guard_fn": true, "put_wrun": false}'
apply "$G"
q "drop trigger cockpit_items_wrun_guard on public.cockpit_items" >/dev/null
same "and the function without the guard" "$(probe)" '{"guard": false, "release": "h", "guard_fn": true, "put_wrun": true}'
apply "$H"
same "release-h.sql run again puts the guard back" "$(probe)" "$ALL"
q "alter table public.cockpit_items disable trigger cockpit_items_wrun_guard" >/dev/null
same "a disabled guard counts as missing" "$(probe)" '{"guard": false, "release": "h", "guard_fn": true, "put_wrun": true}'
apply "$H"
same "and is put back too" "$(probe)" "$ALL"
q "alter table public.cockpit_items enable replica trigger cockpit_items_wrun_guard" >/dev/null
same "a guard firing only for replication counts as missing" "$(probe)" '{"guard": false, "release": "h", "guard_fn": true, "put_wrun": true}'
apply "$H"
same "and is put back as well" "$(probe)" "$ALL"
# (an install from before Release H: its functions' search_path without pg_temp)
q "alter function public.cockpit_capture(text, text) set search_path = public" >/dev/null
apply "$H"
same "release-h.sql sets search_path on an older install's functions" \
  "$(q "select proconfig::text from pg_proc where proname = 'cockpit_capture'")" '{"search_path=public, pg_temp"}'

step "the migrations applied a second time"
apply "$G"
apply "$H"
same "applied again, in either order: the same report pairing" "$(fn cockpit_exec_report)" "$SETUP_FN"
apply "$G"
same "and the same guard" "$(fn cockpit_items_wrun_guard)" "$GUARD_FN"
apply "$H"
run -v stage=again -f "$HERE/after.sql"

step "rollback: release-h.sql's, then release-g-runs.sql's"
rollback() { sed -n '/^-- BEGIN ROLLBACK/,/^-- END ROLLBACK/p' "$1" | grep -v ROLLBACK | sed 's/^-- //'; }
rollback "$H" >"$DIR/rollback-h.sql"
"${PSQL[@]}" -f "$DIR/rollback-h.sql" >/dev/null
same "release-h.sql rolled back: the probe is gone" "$(count_fn cockpit_sync_checks)" 0
same "the run checks stay" "$(count_fn cockpit_put_wrun)" 1
rollback "$G" >"$DIR/rollback.sql"
"${PSQL[@]}" -f "$DIR/rollback.sql" >/dev/null
run -v stage=rolledback -f "$HERE/after.sql"
if apply "$H"; then fail "release-h.sql ran without the function"; else pass "release-h.sql now stops again"; fi
same "changing nothing" "$(count_fn cockpit_sync_checks)" 0

step "the migrations applied again after the rollback"
apply "$G"
apply "$H"
run -c "set role authenticated; select t.as_user('$A');
select t.eq((public.cockpit_put_wrun('wrun:r1', 3, t.run('r1', 4, '{\"cur\":\"s8\"}'), 'op-reinstalled'))->>'status', 'accepted', 'reinstalled: works on the runs as they were left');
select t.eq((public.cockpit_sync_checks())->>'guard', 'true', 'and the probe is back');"

if grep -qE 'FAIL|ERROR' "$OUT"; then
  echo "FAILED"
  exit 1
fi
echo "$(grep -c 'ok - ' "$OUT") checks passed"
