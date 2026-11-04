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
-- take a run back: an update of a 'wrun:' row must carry a higher revision than the one stored.
-- One that doesn't is skipped, not an error, so the rest of its batch is still written; the row
-- isn't returned, and the app that sent it takes the stored run instead (as it does for an older
-- edit, see cockpit_items_stamp). Deleting a run that is over (succeeded or cancelled) is still
-- allowed from anywhere: that is only the app's tidying of old runs.
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
  if n > o then return new; end if;
  if new.deleted and not old.deleted and old.data->>'status' in ('succeeded', 'cancelled') then
    return new;
  end if;
  return null;
end $$;
revoke all on function public.cockpit_items_wrun_guard() from public, anon, authenticated;
drop trigger if exists cockpit_items_wrun_guard on public.cockpit_items;
create trigger cockpit_items_wrun_guard before update on public.cockpit_items
  for each row when (old.key like 'wrun:%') execute function public.cockpit_items_wrun_guard();

-- (so the app can call the function straight away)
notify pgrst, 'reload schema';

-- ROLLBACK: to remove this again, run the four lines between the markers without their "-- ".
-- The runs stay as they are (their `rev` is kept and simply ignored), and the app goes back to
-- the newer edit winning.
-- BEGIN ROLLBACK
-- drop trigger if exists cockpit_items_wrun_guard on public.cockpit_items;
-- drop function if exists public.cockpit_items_wrun_guard();
-- drop function if exists public.cockpit_put_wrun(text, integer, jsonb, text);
-- drop table if exists public.cockpit_wrun_ops;
-- END ROLLBACK
