-- After the migration ran a second time, and then after the rollback (run.sh sets :stage).
\set ON_ERROR_STOP 1
\set VERBOSITY terse
\set A 11111111-1111-1111-1111-111111111111

select :'stage' = 'again' as again, :'stage' = 'rolledback' as rolledback \gset

\if :again
select t.eq((select count(*)::text from pg_trigger where tgname = 'cockpit_items_wrun_guard'), '1', 'applied twice: one guard trigger');
select t.eq((select count(*)::text from pg_proc where proname = 'cockpit_put_wrun'), '1', 'one function');
select t.eq((select data->>'cur' from cockpit_items where key = 'wrun:r1' and user_id = :'A'), 's6', 'the runs are untouched');
select t.ok((select count(*) from cockpit_wrun_ops) >= 10, 'and the applied changes are still remembered');
set role authenticated;
select t.as_user(:'A');
select public.cockpit_put_wrun('wrun:r1', 1, t.run('r1', 2, '{"cur":"s2","st":{"s1":{"o":"done"}}}'), 'op-r1-s1done') as res \gset
select t.eq(:'res'::jsonb->>'status', 'duplicate', 'a change from before the second run is still a duplicate');
select public.cockpit_put_wrun('wrun:r1', 6, t.run('r1', 7, '{"cur":"s7"}'), 'op-after-again') as res \gset
select t.eq(:'res'::jsonb->>'status', 'accepted', 'and the function works as before');
reset role;
\endif

\if :rolledback
select t.ok(to_regprocedure('public.cockpit_put_wrun(text,integer,jsonb,text)') is null, 'rolled back: the function is gone');
select t.ok(to_regprocedure('public.cockpit_items_wrun_guard()') is null, 'the guard function is gone');
select t.eq((select count(*)::text from pg_trigger where tgname = 'cockpit_items_wrun_guard'), '0', 'the trigger is gone');
select t.ok(to_regclass('public.cockpit_wrun_ops') is null, 'the op table is gone');
select t.eq((select data->>'rev' from cockpit_items where key = 'wrun:r1' and user_id = :'A'), '7', 'the runs stay, with their revision');
select t.ok(to_regprocedure('public.cockpit_items_stamp()') is not null, 'supabase-setup.sql''s own trigger stays');
set role authenticated;
select t.as_user(:'A');
-- (back to the newer edit winning: an older revision with a newer edit time goes in)
update cockpit_items set data = t.run('r1', 3, '{"cur":"old app"}'), edited_at = 999999999999999 where key = 'wrun:r1';
select t.eq((select data->>'cur' from cockpit_items where key = 'wrun:r1'), 'old app', 'ordinary writes are as before');
reset role;
\endif
