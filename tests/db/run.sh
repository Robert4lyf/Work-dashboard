#!/usr/bin/env bash
# Tests the Release G SQL (supabase/release-g-runs.sql) against a real PostgreSQL: a throwaway
# cluster in a temp dir on its own port, a miniature of what Supabase provides (bootstrap.sql),
# supabase-setup.sql, then the migration; the cases as two users, two truly concurrent sessions,
# the migration run twice, and the rollback. Everything is removed afterwards.
#   tests/db/run.sh            (PGBIN=/usr/lib/postgresql/16/bin and PGPORT=54329 by default)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PGPORT:-54329}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "PostgreSQL not found (set PGBIN)"; exit 2; }
DIR="$(mktemp -d)"
A=11111111-1111-1111-1111-111111111111

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

step "setup: Supabase stand-in, supabase-setup.sql, the migration"
"${PSQL[@]}" -f "$HERE/bootstrap.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase-setup.sql" >/dev/null 2>&1
"${PSQL[@]}" -f "$ROOT/supabase/release-g-runs.sql" >/dev/null 2>&1

step "cases"
run -f "$HERE/cases.sql"

step "concurrent: two sessions complete the same step of one run"
# The run at revision 1, then session 1 takes it to 2 and holds its transaction open for two
# seconds; session 2, started once session 1 holds the run's lock, makes the same change from revision 1.
as_a="set role authenticated; select t.as_user('$A');"
run -c "$as_a select t.eq((public.cockpit_put_wrun('wrun:c1', 0, t.run('c1', 1, '{\"cur\":\"s1\"}'), 'op-c1-create'))->>'status', 'accepted', 'a run to race on');"
"${PSQL[@]}" -At -c "$as_a begin; select 'session 1: ' || ((public.cockpit_put_wrun('wrun:c1', 1, t.run('c1', 2, '{\"cur\":\"s2\",\"by\":\"one\"}'), 'op-c1-one'))->>'status'); select pg_sleep(2); commit;" >"$DIR/s1" 2>&1 &
S1=$!
for _ in $(seq 50); do
  n=$("${PSQL[@]}" -At -c "select count(*) from pg_locks where locktype = 'advisory' and granted")
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
grep -q 'session 1: accepted' "$DIR/s1" && echo "ok - session 1 was accepted" | tee -a "$OUT" || { cat "$DIR/s1"; echo "FAIL: session 1"; exit 1; }

step "concurrent: two sessions create the same run (a repeat's run made on two devices)"
"${PSQL[@]}" -At -c "$as_a begin; select 'session 1: ' || ((public.cockpit_put_wrun('wrun:c2', 0, t.run('c2', 1, '{\"by\":\"one\"}'), 'op-c2-one'))->>'status'); select pg_sleep(2); commit;" >"$DIR/s1" 2>&1 &
S1=$!
for _ in $(seq 50); do
  n=$("${PSQL[@]}" -At -c "select count(*) from pg_locks where locktype = 'advisory' and granted")
  [ "$n" = 1 ] && break
  sleep 0.1
done
sql "$as_a select public.cockpit_put_wrun('wrun:c2', 0, t.run('c2', 1, '{\"by\":\"two\"}'), 'op-c2-two') as res \gset
select t.eq(:'res'::jsonb->>'status', 'conflict', 'the second creation waits, then is refused (no duplicate-key error)');
select t.eq((select count(*)::text from cockpit_items where key = 'wrun:c2'), '1', 'one row');"
wait $S1 || true
grep -q 'session 1: accepted' "$DIR/s1" && echo "ok - the first creation was accepted" | tee -a "$OUT" || { cat "$DIR/s1"; echo "FAIL: session 1"; exit 1; }

step "the migration applied a second time"
"${PSQL[@]}" -f "$ROOT/supabase/release-g-runs.sql" >/dev/null 2>&1
run -v stage=again -f "$HERE/after.sql"

step "rollback"
sed -n '/^-- BEGIN ROLLBACK/,/^-- END ROLLBACK/p' "$ROOT/supabase/release-g-runs.sql" | grep -v ROLLBACK | sed 's/^-- //' >"$DIR/rollback.sql"
"${PSQL[@]}" -f "$DIR/rollback.sql" >/dev/null
run -v stage=rolledback -f "$HERE/after.sql"

step "the migration applied again after the rollback"
"${PSQL[@]}" -f "$ROOT/supabase/release-g-runs.sql" >/dev/null 2>&1
run -c "set role authenticated; select t.as_user('$A');
select t.eq((public.cockpit_put_wrun('wrun:r1', 3, t.run('r1', 4, '{\"cur\":\"s8\"}'), 'op-reinstalled'))->>'status', 'accepted', 'reinstalled: works on the runs as they were left');"

if grep -qE 'FAIL|ERROR' "$OUT"; then
  echo "FAILED"
  exit 1
fi
echo "$(grep -c 'ok - ' "$OUT") checks passed"
