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
