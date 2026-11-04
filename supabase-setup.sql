-- Dashboard: run this in Supabase > SQL Editor > New query.
-- Safe to run again: it only adds what's missing.
create table if not exists public.cockpit_state (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb  not null,
  edited_at  bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.cockpit_state enable row level security;

-- Each signed-in user can only see and change their own row.
drop policy if exists "read own state"   on public.cockpit_state;
drop policy if exists "insert own state" on public.cockpit_state;
drop policy if exists "update own state" on public.cockpit_state;
create policy "read own state"   on public.cockpit_state for select using (auth.uid() = user_id);
create policy "insert own state" on public.cockpit_state for insert with check (auth.uid() = user_id);
create policy "update own state" on public.cockpit_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Safety net: every time sync replaces your data, the previous version is kept here.
-- The app lists these under Settings > Previous versions. The newest 200 per user are kept.
create table if not exists public.cockpit_history (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  data       jsonb not null,
  edited_at  bigint not null,
  saved_at   timestamptz not null default now()
);
create index if not exists cockpit_history_user on public.cockpit_history (user_id, id desc);

alter table public.cockpit_history enable row level security;
drop policy if exists "read own history" on public.cockpit_history;
create policy "read own history" on public.cockpit_history for select using (auth.uid() = user_id);
drop policy if exists "delete own history" on public.cockpit_history;
create policy "delete own history" on public.cockpit_history for delete using (auth.uid() = user_id);

create or replace function public.cockpit_keep_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.data is distinct from new.data then
    insert into cockpit_history (user_id, data, edited_at) values (old.user_id, old.data, old.edited_at);
    delete from cockpit_history
      where user_id = old.user_id
        and id < (select min(id) from (select id from cockpit_history where user_id = old.user_id order by id desc limit 200) keep);
  end if;
  return new;
end $$;

drop trigger if exists cockpit_keep_history on public.cockpit_state;
create trigger cockpit_keep_history before update on public.cockpit_state
  for each row execute function public.cockpit_keep_history();

-- Per-item storage (version 2 sync). Each quest, inbox item, session... is one row, so devices
-- only exchange what changed and edits to different items never collide.
-- `seq` increases on every write; devices ask for rows with a higher seq than they have seen.
-- Deleted items stay as tombstones (deleted = true) so the deletion reaches every device.
create sequence if not exists public.cockpit_items_seq;
create table if not exists public.cockpit_items (
  user_id    uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  key        text   not null,
  kind       text   not null,
  data       jsonb,
  deleted    boolean not null default false,
  edited_at  bigint not null default 0,
  seq        bigint not null default nextval('public.cockpit_items_seq'),
  primary key (user_id, key)
);
create index if not exists cockpit_items_seq_idx on public.cockpit_items (user_id, seq);

alter table public.cockpit_items enable row level security;
drop policy if exists "read own items"   on public.cockpit_items;
drop policy if exists "insert own items" on public.cockpit_items;
drop policy if exists "update own items" on public.cockpit_items;
create policy "read own items"   on public.cockpit_items for select using (auth.uid() = user_id);
create policy "insert own items" on public.cockpit_items for insert with check (auth.uid() = user_id);
create policy "update own items" on public.cockpit_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.cockpit_items_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  -- The newer edit wins (as in the app): an older one arriving later is dropped, and the
  -- device that sent it takes the newer row on its next pull.
  if tg_op = 'UPDATE' and new.edited_at < old.edited_at then return null; end if;
  new.seq := nextval('public.cockpit_items_seq');
  return new;
end $$;
drop trigger if exists cockpit_items_stamp on public.cockpit_items;
create trigger cockpit_items_stamp before insert or update on public.cockpit_items
  for each row execute function public.cockpit_items_stamp();

-- Live updates: other devices hear about changes within a second.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and tablename = 'cockpit_items') then
    alter publication supabase_realtime add table public.cockpit_items;
  end if;
end $$;

-- Capture from anywhere: a secret token lets shortcuts (Android, email...) add inbox items
-- without signing in. Settings > Capture creates or replaces your token.
create table if not exists public.cockpit_capture_tokens (
  token      text primary key,
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.cockpit_capture_tokens enable row level security;
-- No policies: the table is only reachable through the two functions below.

create or replace function public.cockpit_new_capture_token() returns text
language plpgsql security definer set search_path = public as $$
declare t text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  delete from cockpit_capture_tokens where user_id = auth.uid();
  insert into cockpit_capture_tokens (token, user_id) values (t, auth.uid());
  return t;
end $$;
revoke execute on function public.cockpit_new_capture_token() from public, anon;
grant execute on function public.cockpit_new_capture_token() to authenticated;

create or replace function public.cockpit_capture(token text, text text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  u uuid;
  body text := trim(coalesce(text, ''));
  id text := 'cap' || replace(gen_random_uuid()::text, '-', '');
  item jsonb;
begin
  select t.user_id into u from cockpit_capture_tokens t where t.token = cockpit_capture.token;
  if u is null then raise exception 'unknown capture token'; end if;
  if body = '' then return false; end if;
  -- As for alerts: a runaway script or a leaked link can't flood the Inbox (or every device
  -- that syncs it) with huge or endless items.
  body := left(body, 20000);
  perform pg_advisory_xact_lock(hashtext('cockpit_capture:' || u::text));
  if (select count(*) from cockpit_items i where i.user_id = u and i.key like 'inbox:cap%'
      and i.edited_at > (extract(epoch from now() - interval '1 hour') * 1000)::bigint) >= 60 then
    raise exception 'too many captures: at most 60 an hour';
  end if;
  item := jsonb_build_object('id', id, 'text', left(regexp_replace(body, '\s+', ' ', 'g'), 200));
  -- Long text keeps its full version in the notes.
  if length(body) > 200 then
    item := item || jsonb_build_object('node', jsonb_build_object(
      'id', id || 'n', 'text', left(regexp_replace(body, '\s+', ' ', 'g'), 200), 'notes', body, 'children', '[]'::jsonb));
  end if;
  insert into cockpit_items (user_id, key, kind, data, edited_at)
    values (u, 'inbox:' || id, 'inbox', item, (extract(epoch from now()) * 1000)::bigint);
  return true;
end $$;
revoke execute on function public.cockpit_capture(text, text) from public;
grant execute on function public.cockpit_capture(text, text) to anon, authenticated;

-- The calendar feed was removed; this clears it out of databases that had it.
drop function if exists public.cockpit_calendar_ics();
drop table if exists public.cockpit_calendar;

-- Notifications: each device that turns them on stores its push subscription here, and the app
-- keeps a queue of upcoming notices (timer end, deadlines...). The send-notices function
-- (supabase/functions/send-notices) sends the due ones every minute (supabase/notifications-cron.sql).
create table if not exists public.cockpit_push_subs (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.cockpit_push_subs enable row level security;
drop policy if exists "own push subscriptions" on public.cockpit_push_subs;
create policy "own push subscriptions" on public.cockpit_push_subs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.cockpit_notices (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key     text not null,
  at      timestamptz not null,
  title   text not null,
  body    text not null default '',
  sent_at timestamptz,
  primary key (user_id, key)
);
alter table public.cockpit_notices add column if not exists error text; -- why a notice wasn't delivered
alter table public.cockpit_notices add column if not exists device text; -- send only to this push endpoint (alarms)
create index if not exists cockpit_notices_due on public.cockpit_notices (at) where sent_at is null;
alter table public.cockpit_notices enable row level security;
drop policy if exists "own notices" on public.cockpit_notices;
create policy "own notices" on public.cockpit_notices for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Alerts from anywhere: scripts and flows (PowerShell, Power Automate Desktop...) call this with
-- the capture token to notify your phone and, optionally, add the alert to the Dashboard.
--   to = 'phone'   notification only
--        'inbox'   notification + an Inbox item (the default)
--        'today'   notification + a quest on Today
--        'waiting' an Inbox item waiting on `who`, to chase on `due` (yyyy-mm-dd), + notification
create or replace function public.cockpit_alert(
  token text, title text, body text default '', "to" text default 'inbox', who text default '', due text default ''
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  u uuid;
  t text := left(regexp_replace(trim(coalesce(title, '')), '\s+', ' ', 'g'), 200);
  b text := left(trim(coalesce(body, '')), 4000);
  dest text := lower(coalesce(nullif(trim("to"), ''), 'inbox'));
  id text := 'alert' || replace(gen_random_uuid()::text, '-', '');
  ms bigint := (extract(epoch from now()) * 1000)::bigint;
  item jsonb;
  chase text := '';
begin
  select c.user_id into u from cockpit_capture_tokens c where c.token = cockpit_alert.token;
  if u is null then raise exception 'unknown capture token'; end if;
  if t = '' then raise exception 'title is required'; end if;
  if dest not in ('phone', 'inbox', 'today', 'waiting') then
    raise exception 'to must be phone, inbox, today or waiting';
  end if;
  -- A runaway script (or a leaked token) can't flood the phone or the lists. The lock makes
  -- calls for the same person take turns, so parallel requests can't all slip under the limit.
  perform pg_advisory_xact_lock(hashtext('cockpit_alert:' || u::text));
  if (select count(*) from cockpit_notices n where n.user_id = u and n.key like 'alert:%'
      and n.at > now() - interval '1 hour') >= 60 then
    raise exception 'too many alerts: at most 60 an hour';
  end if;
  delete from cockpit_notices n where n.user_id = u and n.key like 'alert:%'
    and n.sent_at < now() - interval '30 days';
  if dest = 'today' then
    insert into cockpit_items (user_id, key, kind, data, edited_at) values (u, 'quest:' || id, 'quest',
      jsonb_build_object('id', id, 'text', t, 'notes', b, 'children', '[]'::jsonb), ms);
  elsif dest in ('inbox', 'waiting') then
    item := jsonb_build_object('id', id, 'text', t);
    if b <> '' then
      item := item || jsonb_build_object('node', jsonb_build_object('id', id || 'n', 'text', t, 'notes', b, 'children', '[]'::jsonb));
    end if;
    if dest = 'waiting' then
      -- Only a real date (2026-02-30 isn't one) becomes the chase date.
      begin
        if coalesce(due, '') ~ '^\d{4}-\d{2}-\d{2}$' and to_char(due::date, 'YYYY-MM-DD') = due then
          chase := due;
        end if;
      exception when others then chase := '';
      end;
      -- The date where you are (the database runs on UTC): change the zone if you're elsewhere.
      item := item || jsonb_build_object('wait', jsonb_build_object(
        'who', left(trim(coalesce(who, '')), 60), 'note', '', 'since', to_char(now() at time zone 'Europe/London', 'YYYY-MM-DD'),
        'due', chase));
    end if;
    insert into cockpit_items (user_id, key, kind, data, edited_at) values (u, 'inbox:' || id, 'inbox', item, ms);
  end if;
  -- The send-notices job pushes it within a minute.
  insert into cockpit_notices (user_id, key, at, title, body) values (u, 'alert:' || id, now(), t, left(b, 300));
  return true;
end $$;
revoke execute on function public.cockpit_alert(text, text, text, text, text, text) from public;
grant execute on function public.cockpit_alert(text, text, text, text, text, text) to anon, authenticated;

-- For the app's health check: is the every-minute job that sends notifications set up, and what
-- did its last call to the send-notices function get back? (Only states and status codes.)
create or replace function public.cockpit_notify_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  out jsonb := jsonb_build_object('cron', false, 'net', false);
  r record;
  n int;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  begin
    execute $q$ select active from cron.job where jobname = 'dashboard-notices' $q$ into r;
    get diagnostics n = row_count; -- (EXECUTE doesn't set FOUND)
    out := out || jsonb_build_object('cron', n > 0, 'active', n > 0 and r.active);
  exception when others then null; -- pg_cron isn't enabled
  end;
  begin
    execute $q$ select status_code, created, error_msg from net._http_response order by created desc limit 1 $q$ into r;
    get diagnostics n = row_count;
    out := out || jsonb_build_object('net', true);
    if n > 0 then
      -- (only whether it timed out or failed: the log is project-wide, not this job's alone)
      out := out || jsonb_build_object('status', r.status_code, 'at', r.created, 'error',
        case when r.error_msg is null then null when r.error_msg ilike '%timeout%' then 'Timed out' else 'Failed' end);
    end if;
  exception when others then null; -- pg_net isn't enabled
  end;
  return out;
end $$;
revoke execute on function public.cockpit_notify_status() from public, anon;
grant execute on function public.cockpit_notify_status() to authenticated;

-- Automation execution tracking (Release B). The app records an execution when a flow's button
-- is tapped (kind 'exec' in cockpit_items, synced like everything else); the flow itself, or a
-- script, then reports what really happened through cockpit_exec_report with an execution
-- token. Reports are kept as their own append-only rows here (never edited), and the app folds
-- them into its execution records. A tapped button is never taken as a result: without a
-- report, an execution stays unconfirmed.
--
-- The execution token is separate from the capture token and does one thing: add a status
-- report. It can't read anything, and can't change quests, notes or articles. Settings > Flows
-- and automations creates or replaces it (the old one stops working at once) or revokes it.
create table if not exists public.cockpit_exec_tokens (
  token      text primary key,
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.cockpit_exec_tokens enable row level security;
-- No policies: only reachable through the functions below.

create or replace function public.cockpit_new_exec_token() returns text
language plpgsql security definer set search_path = public as $$
declare t text := 'x' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  delete from cockpit_exec_tokens where user_id = auth.uid();
  insert into cockpit_exec_tokens (token, user_id) values (t, auth.uid());
  return t;
end $$;
revoke execute on function public.cockpit_new_exec_token() from public, anon;
grant execute on function public.cockpit_new_exec_token() to authenticated;

create or replace function public.cockpit_revoke_exec_token() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  delete from cockpit_exec_tokens where user_id = auth.uid();
  return true;
end $$;
revoke execute on function public.cockpit_revoke_exec_token() from public, anon;
grant execute on function public.cockpit_revoke_exec_token() to authenticated;

-- One row per report. `execution` is the app's execution id when it's known: given by the
-- caller, matched by run_ref to an earlier report, or paired here with the oldest unconfirmed
-- launch of that flow. Otherwise the app makes an execution of its own for the report.
create sequence if not exists public.cockpit_exec_events_seq;
create table if not exists public.cockpit_exec_events (
  id          bigint primary key default nextval('public.cockpit_exec_events_seq'),
  user_id     uuid not null references auth.users(id) on delete cascade,
  execution   text not null default '',
  flow        text not null,
  status      text not null,
  message     text not null default '',
  run_ref     text not null default '',
  reported_at timestamptz not null default now()
);
create index if not exists cockpit_exec_events_user on public.cockpit_exec_events (user_id, id);
alter table public.cockpit_exec_events enable row level security;
drop policy if exists "read own exec events" on public.cockpit_exec_events;
create policy "read own exec events" on public.cockpit_exec_events for select using (auth.uid() = user_id);
-- (no insert, update or delete policies: rows come only from the function below, and stay as reported)

-- Live updates for reports too, so the app hears a result within a second.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and tablename = 'cockpit_exec_events') then
    alter publication supabase_realtime add table public.cockpit_exec_events;
  end if;
end $$;

-- Report an execution's status. Called by Power Automate Desktop, PowerShell or any script:
--   token      the execution token (Settings > Flows and automations)
--   flow       the flow's id in the app (shown beside the flow under Knowledge > Flows)
--   status     running | succeeded | failed | cancelled
--   message    a short, plain description (an error's text, a count): at most 300 characters,
--              kept as text, never report contents or personal information
--   execution  the app's execution id, if the script knows it (optional)
--   run_ref    the script's own id for this run, so its reports stay together (optional)
-- Returns {"execution": <id or "">, "event": <row id>}. At most 120 reports an hour.
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
  -- Which execution this is about: the caller's say, else the run it reported before (an
  -- earlier report with no execution of its own stands for one, named 'u' + its row id, as the
  -- app names it), else the OLDEST launch of this flow still waiting to hear: requested or
  -- running, within a day, with no result reported for it yet. (Oldest, not newest: a report
  -- coming late from an attempt a retry has set aside goes to that attempt, never to the newer
  -- one that took its place. Release G.)
  if x = '' and r <> '' then
    select coalesce(nullif(e.execution, ''), 'u' || e.id) into x from cockpit_exec_events e
      where e.user_id = u and e.flow = f and e.run_ref = r
        and e.reported_at > now() - interval '7 days'
      order by e.id limit 1;
    x := coalesce(x, '');
  end if;
  if x = '' then
    select i.data->>'id' into x from cockpit_items i
      where i.user_id = u and i.kind = 'exec' and not i.deleted
        and i.data->>'flow' = f and i.data->>'status' in ('requested', 'running')
        and (case when (i.data->>'at') ~ '^\d{1,16}$' then (i.data->>'at')::bigint else 0 end)
            > (extract(epoch from now() - interval '24 hours') * 1000)::bigint
        and not exists (select 1 from cockpit_exec_events e where e.user_id = u
          and e.execution = i.data->>'id' and e.status in ('succeeded', 'failed', 'cancelled'))
      order by (case when (i.data->>'at') ~ '^\d{1,16}$' then (i.data->>'at')::bigint else 0 end), i.key
      limit 1;
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
