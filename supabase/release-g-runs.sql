-- Release G: checked writes for process runs. Run this once in Supabase > SQL Editor, after
-- supabase-setup.sql. Safe to run again: it only adds what's missing and changes no data.
--
-- What it does. A process run is one row in cockpit_items (key 'wrun:<run id>'). Its data holds a
-- revision number, `rev`, one higher on every accepted change. The app writes runs through
-- cockpit_put_wrun below, which takes a change only if it was made to the revision stored now
-- (compare-and-swap). A change made to an older revision is refused and handed back with the
-- stored run, and the app shows the two side by side instead of letting one overwrite the other.
-- Each change carries an id made by the app (`p_op`): sent again (an answer lost on a bad
-- connection), it is recognised and applied once.
--
-- Without this file the app works as before: the newer edit wins. Settings > Health check says
-- which applies. To remove it again, see ROLLBACK at the end.

-- The changes already applied, by their id, so a repeated one isn't applied twice. Kept 30 days.
create table if not exists public.cockpit_wrun_ops (
  user_id uuid        not null references auth.users(id) on delete cascade,
  op      text        not null,
  key     text        not null,
  rev     integer     not null,
  at      timestamptz not null default now(),
  primary key (user_id, op)
);
create index if not exists cockpit_wrun_ops_at on public.cockpit_wrun_ops (user_id, at);
alter table public.cockpit_wrun_ops enable row level security;
-- No policies, and no table rights for app roles: only the function below reads or writes it.
revoke all on table public.cockpit_wrun_ops from public, anon, authenticated;

-- Write one process run, if it was changed from the revision stored now.
--   p_key       'wrun:<run id>' (the run id: 1 to 40 letters, digits, _ or -)
--   p_base_rev  the revision the change was made to (0 for a run the server hasn't got)
--   p_data      the run with rev = p_base_rev + 1 and its own id; null deletes it
--   p_op        the app's id for this change (8 to 64 letters, digits, _ or -)
-- Returns one of
--   {"status":"accepted",  "rev", "seq", "edited_at"}
--   {"status":"duplicate", "rev" (what that change made), "cur_rev", "data", "deleted", "seq", "edited_at"}
--   {"status":"conflict",  "rev" (stored now), "data", "deleted", "seq", "edited_at"}
-- Bad input is refused with an error. Only the signed-in user's own rows are read or written.
create or replace function public.cockpit_put_wrun(p_key text, p_base_rev integer, p_data jsonb, p_op text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := auth.uid();
  rid text;
  done_key text;
  done_rev integer;
  had boolean;
  cur_data jsonb;
  cur_deleted boolean;
  cur_edited bigint;
  cur_seq bigint;
  cur_rev integer := 0;
  new_rev integer;
  out_seq bigint;
  out_edited bigint;
  ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if u is null then raise exception 'sign in first' using errcode = '28000'; end if;
  if p_key is null or p_key !~ '^wrun:[A-Za-z0-9_-]{1,40}$' then
    raise exception 'key must be wrun:<run id>' using errcode = '22023';
  end if;
  if p_op is null or p_op !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'op must be 8 to 64 letters, digits, _ or -' using errcode = '22023';
  end if;
  if p_base_rev is null or p_base_rev < 0 or p_base_rev >= 999999999 then
    raise exception 'base revision out of range' using errcode = '22023';
  end if;
  rid := substr(p_key, 6);
  new_rev := p_base_rev + 1;
  if p_data is not null then
    if jsonb_typeof(p_data) <> 'object' then
      raise exception 'data must be an object' using errcode = '22023';
    end if;
    if octet_length(p_data::text) > 262144 then
      raise exception 'run too large (at most 256 KB)' using errcode = '22023';
    end if;
    if jsonb_typeof(p_data->'id') is distinct from 'string' or p_data->>'id' <> rid then
      raise exception 'data must keep the run''s id' using errcode = '22023';
    end if;
    if jsonb_typeof(p_data->'rev') is distinct from 'number' or (p_data->>'rev') !~ '^\d{1,10}$'
       or (p_data->>'rev')::bigint <> new_rev then
      raise exception 'rev must be the base revision + 1' using errcode = '22023';
    end if;
  end if;
  -- One at a time per run (this also covers a run not stored yet), then its row.
  perform pg_advisory_xact_lock(hashtextextended('cockpit_wrun:' || u::text || ':' || p_key, 0));
  select i.data, i.deleted, i.edited_at, i.seq into cur_data, cur_deleted, cur_edited, cur_seq
    from cockpit_items i where i.user_id = u and i.key = p_key for update;
  had := found;
  if had and jsonb_typeof(cur_data->'rev') = 'number' and (cur_data->>'rev') ~ '^\d{1,9}$' then
    cur_rev := (cur_data->>'rev')::integer;
  end if;
  -- Applied before (its answer was lost): the same result again, nothing applied twice.
  select o.key, o.rev into done_key, done_rev from cockpit_wrun_ops o where o.user_id = u and o.op = p_op;
  if found then
    if done_key <> p_key then
      raise exception 'that op id was used for another run' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'duplicate', 'rev', done_rev, 'cur_rev', cur_rev, 'data', cur_data,
      'deleted', coalesce(cur_deleted, false), 'seq', cur_seq, 'edited_at', cur_edited);
  end if;
  -- Made to another revision than the one stored: refused, with what is stored.
  if cur_rev <> p_base_rev then
    return jsonb_build_object('status', 'conflict', 'rev', cur_rev, 'data', cur_data,
      'deleted', coalesce(cur_deleted, false), 'seq', cur_seq, 'edited_at', cur_edited);
  end if;
  -- A runaway script (or a leaked session) can't flood the account: at most 600 changes an hour.
  if (select count(*) from cockpit_wrun_ops o where o.user_id = u and o.at > now() - interval '1 hour') >= 600 then
    raise exception 'too many run changes: at most 600 an hour' using errcode = '54000';
  end if;
  -- (a deleted run keeps its id and revision in its row, so a later change is checked as well)
  if had then
    update cockpit_items
      set data = coalesce(p_data, jsonb_build_object('id', rid, 'rev', new_rev)),
          deleted = p_data is null, kind = 'wrun', edited_at = greatest(ms, cur_edited + 1)
      where user_id = u and key = p_key
      returning seq, edited_at into out_seq, out_edited;
  else
    insert into cockpit_items (user_id, key, kind, data, deleted, edited_at)
      values (u, p_key, 'wrun', coalesce(p_data, jsonb_build_object('id', rid, 'rev', new_rev)), p_data is null, ms)
      returning seq, edited_at into out_seq, out_edited;
  end if;
  if out_seq is null then raise exception 'the run was not written'; end if;
  insert into cockpit_wrun_ops (user_id, op, key, rev) values (u, p_op, p_key, new_rev);
  delete from cockpit_wrun_ops o where o.user_id = u and o.at < now() - interval '30 days';
  return jsonb_build_object('status', 'accepted', 'rev', new_rev, 'seq', out_seq, 'edited_at', out_edited);
end $$;
revoke all on function public.cockpit_put_wrun(text, integer, jsonb, text) from public, anon;
grant execute on function public.cockpit_put_wrun(text, integer, jsonb, text) to authenticated;

-- Ordinary writes (an upsert from a copy of the app from before this, or any other client) can't
-- take a run back or jump it ahead: an update of a 'wrun:' row must carry exactly the next
-- revision (below 999999999, the function's limit). One that doesn't is skipped, not an error,
-- so the rest of its batch is still written; the row isn't returned, and the app that sent it
-- takes the stored run instead (as it does for an older edit, see cockpit_items_stamp). Deleting
-- a run that is over (succeeded or cancelled) is still allowed from anywhere, as the app's tidying
-- of old runs, and the tombstone keeps the next revision, so the run can't come back at an old one.
-- (Since Release H it also checks the run keeps its own id and stays within 256 KB, as the function
-- does; the same as in release-h.sql.)
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

-- Automation reports (the same function as in supabase-setup.sql and release-h.sql, kept the same
-- in all three, so running these files again in any order never brings back an older pairing): a
-- report that names no execution is paired with a launch only when exactly one launch of its flow
-- is waiting to hear; a named execution is taken only if it is that flow's. Its arguments, checks,
-- limits and rights are as before. (Release G paired with the oldest launch waiting, which could
-- be one that never ran, or another run's; Release H changed that, see release-h.sql.)
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

-- (so the app can call the function straight away)
notify pgrst, 'reload schema';

-- ROLLBACK: to remove this again, run the four lines between the markers without their "-- ".
-- Run release-h.sql's ROLLBACK first, if you ran it. (cockpit_exec_report stays as it is:
-- supabase-setup.sql has the same version.)
-- The runs stay as they are (their `rev` is kept and simply ignored), and the app goes back to
-- the newer edit winning.
-- BEGIN ROLLBACK
-- drop trigger if exists cockpit_items_wrun_guard on public.cockpit_items;
-- drop function if exists public.cockpit_items_wrun_guard();
-- drop function if exists public.cockpit_put_wrun(text, integer, jsonb, text);
-- drop table if exists public.cockpit_wrun_ops;
-- END ROLLBACK
