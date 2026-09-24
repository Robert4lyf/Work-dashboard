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
-- The app lists these under Sync > Previous versions. The newest 200 per user are kept.
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

-- Capture from anywhere: a secret token lets shortcuts (Siri, Android, email...) add inbox items
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
