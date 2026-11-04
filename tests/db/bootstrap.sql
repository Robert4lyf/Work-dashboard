-- What Supabase provides and the app's SQL relies on, in miniature: the anon and authenticated
-- roles, auth.users and auth.uid() (read from the request's JWT subject, as PostgREST sets it),
-- and Supabase's default grants on the public schema (RLS is what keeps rows private).
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

-- Test helpers: each check prints "ok - <name>" or stops the run with "FAIL: <name>".
create schema t;
create function t.ok(c boolean, name text) returns void language plpgsql as $$
begin
  if c is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'ok - %', name;
end $$;
create function t.eq(a text, b text, name text) returns void language plpgsql as $$
begin
  if a is distinct from b then raise exception 'FAIL: % (got %, wanted %)', name, a, b; end if;
  raise notice 'ok - %', name;
end $$;
-- `q` must raise an error matching `pat`.
create function t.raises(q text, pat text, name text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlerrm ~* pat then
      raise notice 'ok - % (%)', name, sqlerrm;
      return;
    end if;
    raise exception 'FAIL: % (wrong error: %)', name, sqlerrm;
  end;
  raise exception 'FAIL: % (no error)', name;
end $$;
-- A run's data at a revision, as the app sends it.
create function t.run(id text, rev int, extra jsonb default '{}') returns jsonb language sql as
  $$ select jsonb_build_object('id', id, 'rev', rev, 'wf', 'w1', 'started', 1, 'status', 'running') || extra $$;
-- Act as a signed-in user (as PostgREST does for a request with that user's JWT).
create function t.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
end $$;
grant usage on schema t to public;
grant execute on all functions in schema t to public;
