-- Release H: trustworthy synchronisation. Run this once in Supabase > SQL Editor, AFTER
-- supabase-setup.sql and supabase/release-g-runs.sql (if you already ran those, this is the only
-- file to run). Safe to run again: it replaces two functions and the guard trigger, adds one
-- function, sets search_path on seven, and changes no data. It stops, changing nothing, if release-g-runs.sql hasn't been run.
--
-- What it changes (docs/ux/release-h-sync.md has the why):
--  1. cockpit_exec_report pairs a report that names no execution with a launch only when exactly
--     one launch of that flow is waiting to hear; with none or several it leaves it unpaired (a
--     launch that never ran, or another run's, can no longer take the report). An execution id
--     the caller gives is taken only if this user has an execution of that id for that flow.
--  2. The guard on ordinary writes of process runs also checks what cockpit_put_wrun checks: the
--     run keeps its own id and stays within 256 KB.
--  3. cockpit_sync_checks(): what the app's health check asks to tell a full install from a
--     partial one (the function without the guard, or the guard without the function).
--  4. Every SECURITY DEFINER function from supabase-setup.sql runs with search_path
--     public, pg_temp (pg_temp last, so a caller's temporary table can't stand in for a real one).
-- To remove it again, see ROLLBACK at the end.

begin;

do $$ begin
  if to_regprocedure('public.cockpit_put_wrun(text,integer,jsonb,text)') is null then
    raise exception 'Run supabase/release-g-runs.sql first, then this file again (nothing was changed)';
  end if;
end $$;

-- 1. Automation reports (the same function as in supabase-setup.sql and release-g-runs.sql, kept
-- the same in all three). Its arguments, checks, limits and rights are as before.
create or replace function public.cockpit_exec_report(
  token text, flow text, status text, message text default '', execution text default '', run_ref text default ''
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid;
  f text := trim(coalesce(flow, ''));
  s text := lower(trim(coalesce(status, '')));
  m text := left(trim(regexp_replace(regexp_replace(coalesce(message, ''), '[[:cntrl:]]+', ' ', 'g'), '\s+', ' ', 'g')), 300);
  x text := trim(coalesce(execution, ''));
  r text := left(trim(coalesce(run_ref, '')), 60);
  named boolean;
  waiting integer;
  fname text;
  ev bigint;
begin
  select t.user_id into u from cockpit_exec_tokens t where t.token = cockpit_exec_report.token;
  if u is null then raise exception 'unknown execution token'; end if;
  if f !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'flow must be the flow''s id'; end if;
  if s not in ('running', 'succeeded', 'failed', 'cancelled') then
    raise exception 'status must be running, succeeded, failed or cancelled';
  end if;
  if x !~ '^[A-Za-z0-9_-]{0,40}$' then raise exception 'execution must be an execution id'; end if;
  if r !~ '^[A-Za-z0-9_.:-]{0,60}$' then raise exception 'run_ref may only hold letters, digits and ._:-'; end if;
  m := trim(m);
  -- A runaway script (or a leaked token) can't flood the account; calls take turns per person.
  perform pg_advisory_xact_lock(hashtext('cockpit_exec:' || u::text));
  if (select count(*) from cockpit_exec_events e where e.user_id = u
      and e.reported_at > now() - interval '1 hour') >= 120 then
    raise exception 'too many reports: at most 120 an hour';
  end if;
  delete from cockpit_exec_events e where e.user_id = u and e.reported_at < now() - interval '90 days';
  delete from cockpit_notices n where n.user_id = u and n.key like 'exec:%' and n.sent_at < now() - interval '30 days';
  -- Which execution this is about (Release H):
  --  1. the one the caller names, but only if this user has an execution of that id for this
  --     flow (the app passes it to a flow set up to take it, see README). One it hasn't (a typo,
  --     another flow's, a launch not synced yet) is neither taken nor replaced by a guess.
  --  2. else the run it reported before (an earlier report with no execution of its own stands
  --     for one, named 'u' + its row id, as the app names it);
  --  3. else, with no id given, the launch of this flow still waiting to hear (requested or
  --     running, within a day, no result reported for it yet), but only when exactly ONE is
  --     waiting. With none, or two or more (a launch that never ran, another run's, one a retry
  --     set aside), the report is left unpaired: the app makes it an execution of its own, and a
  --     step waiting on an automation waits for you to confirm it. A guess is never made.
  named := x <> '';
  if named and not exists (select 1 from cockpit_items i where i.user_id = u and i.key = 'exec:' || x
      and not i.deleted and i.data->>'id' = x and i.data->>'flow' = f) then
    x := '';
  end if;
  if x = '' and r <> '' then
    select coalesce(nullif(e.execution, ''), 'u' || e.id) into x from cockpit_exec_events e
      where e.user_id = u and e.flow = f and e.run_ref = r
        and e.reported_at > now() - interval '7 days'
      order by e.id limit 1;
    x := coalesce(x, '');
  end if;
  if x = '' and not named then
    select count(*), min(i.data->>'id') into waiting, x from cockpit_items i
      where i.user_id = u and i.kind = 'exec' and not i.deleted
        and i.data->>'flow' = f and i.data->>'status' in ('requested', 'running')
        and (case when (i.data->>'at') ~ '^\d{1,16}$' then (i.data->>'at')::bigint else 0 end)
            > (extract(epoch from now() - interval '24 hours') * 1000)::bigint
        and not exists (select 1 from cockpit_exec_events e where e.user_id = u
          and e.execution = i.data->>'id' and e.status in ('succeeded', 'failed', 'cancelled'));
    if waiting <> 1 then x := ''; end if;
    x := coalesce(x, '');
    if x !~ '^[A-Za-z0-9_-]{1,40}$' then x := ''; end if;
  end if;
  insert into cockpit_exec_events (user_id, execution, flow, status, message, run_ref)
    values (u, x, f, s, m, r) returning id into ev;
  -- A failure is worth a notification (the send-notices job pushes it within a minute).
  if s = 'failed' then
    select i.data->>'name' into fname from cockpit_items i
      where i.user_id = u and i.key = 'flow:' || f and not i.deleted;
    insert into cockpit_notices (user_id, key, at, title, body)
      values (u, 'exec:' || ev, now(), 'Flow failed: ' || left(coalesce(fname, f), 60), left(m, 300))
      on conflict (user_id, key) do nothing;
  end if;
  return jsonb_build_object('execution', x, 'event', ev);
end $$;
revoke execute on function public.cockpit_exec_report(text, text, text, text, text, text) from public;
grant execute on function public.cockpit_exec_report(text, text, text, text, text, text) to anon, authenticated;

-- 2. The guard on ordinary writes of process runs (the same as in release-g-runs.sql).
create or replace function public.cockpit_items_wrun_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  o integer := 0;
  n integer := 0;
begin
  if jsonb_typeof(old.data->'rev') = 'number' and (old.data->>'rev') ~ '^\d{1,9}$' then
    o := (old.data->>'rev')::integer;
  end if;
  if jsonb_typeof(new.data->'rev') = 'number' and (new.data->>'rev') ~ '^\d{1,9}$' then
    n := (new.data->>'rev')::integer;
  end if;
  -- (Release H: and, as cockpit_put_wrun checks, the same row, the run's own id, at most 256 KB)
  if new.key is distinct from old.key then return null; end if;
  if n = o + 1 and n < 999999999 then
    if jsonb_typeof(new.data->'id') is distinct from 'string' or new.data->>'id' <> substr(new.key, 6)
       or octet_length(new.data::text) > 262144 then
      return null;
    end if;
    return new;
  end if;
  if new.deleted and not old.deleted and old.data->>'status' in ('succeeded', 'cancelled') and o < 999999998 then
    new.data := jsonb_build_object('id', old.data->'id', 'rev', o + 1);
    return new;
  end if;
  return null;
end $$;
revoke all on function public.cockpit_items_wrun_guard() from public, anon, authenticated;
drop trigger if exists cockpit_items_wrun_guard on public.cockpit_items;
create trigger cockpit_items_wrun_guard before update on public.cockpit_items
  for each row when (old.key like 'wrun:%') execute function public.cockpit_items_wrun_guard();

-- 3. For the app's health check: is each part of the run checks installed? (It reads only the
-- catalog, never a row.) {"release": "h", "put_wrun": bool, "guard": bool, "guard_fn": bool}
create or replace function public.cockpit_sync_checks() returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '28000'; end if;
  return jsonb_build_object(
    'release', 'h',
    'put_wrun', to_regprocedure('public.cockpit_put_wrun(text,integer,jsonb,text)') is not null,
    'guard', exists (select 1 from pg_trigger t
      where t.tgrelid = to_regclass('public.cockpit_items') and t.tgname = 'cockpit_items_wrun_guard'
        -- (on as triggers normally fire: 'O' or 'A'; 'R', replica only, never fires for the app)
        and t.tgenabled in ('O', 'A')),
    'guard_fn', to_regprocedure('public.cockpit_items_wrun_guard()') is not null);
end $$;
revoke all on function public.cockpit_sync_checks() from public, anon;
grant execute on function public.cockpit_sync_checks() to authenticated;

-- 4. search_path with pg_temp last for the SECURITY DEFINER functions supabase-setup.sql made
-- before this release (re-running supabase-setup.sql does the same).
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.cockpit_keep_history()', 'public.cockpit_new_capture_token()', 'public.cockpit_capture(text,text)',
    'public.cockpit_alert(text,text,text,text,text,text)', 'public.cockpit_notify_status()',
    'public.cockpit_new_exec_token()', 'public.cockpit_revoke_exec_token()'] loop
    if to_regprocedure(f) is not null then
      execute format('alter function %s set search_path = public, pg_temp', f);
    end if;
  end loop;
end $$;

commit;

-- (so the app can call the new function straight away)
notify pgrst, 'reload schema';

-- ROLLBACK: to remove this again, run the line between the markers without its "-- ". The app
-- then goes back to its Release G check (Settings > Health check can't tell a partial install).
-- The pairing (1) and the guard's extra checks (2) are deliberately not undone: they are what
-- supabase-setup.sql and release-g-runs.sql install too, and every copy of the app works with
-- them. To remove the run checks altogether, use release-g-runs.sql's ROLLBACK. search_path (4)
-- only narrows where names are looked up and needs no undoing.
-- BEGIN ROLLBACK
-- drop function if exists public.cockpit_sync_checks();
-- END ROLLBACK
