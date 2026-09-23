-- Work Cockpit: run this once in Supabase > SQL Editor > New query.
create table if not exists public.cockpit_state (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb  not null,
  edited_at  bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.cockpit_state enable row level security;

-- Each signed-in user can only see and change their own row.
create policy "read own state"   on public.cockpit_state for select using (auth.uid() = user_id);
create policy "insert own state" on public.cockpit_state for insert with check (auth.uid() = user_id);
create policy "update own state" on public.cockpit_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
