-- cockpit_put_wrun and the wrun guard, one session at a time (run.sh runs the concurrent cases).
\set ON_ERROR_STOP 1
\set VERBOSITY terse
\set A 11111111-1111-1111-1111-111111111111
\set B 22222222-2222-2222-2222-222222222222

set role authenticated;
select t.as_user(:'A');

-- A new run, then a change made to its revision.
select public.cockpit_put_wrun('wrun:r1', 0, t.run('r1', 1, '{"cur":"s1"}'), 'op-r1-create') as res \gset
select t.eq(:'res'::jsonb->>'status', 'accepted', 'a new run is accepted');
select t.eq(:'res'::jsonb->>'rev', '1', 'at revision 1');
select public.cockpit_put_wrun('wrun:r1', 1, t.run('r1', 2, '{"cur":"s2","st":{"s1":{"o":"done"}}}'), 'op-r1-s1done') as res \gset
select t.eq(:'res'::jsonb->>'status', 'accepted', 'a change made to the stored revision is accepted');
select t.eq((select data->>'cur' from cockpit_items where key = 'wrun:r1'), 's2', 'and stored');
select t.eq((select kind from cockpit_items where key = 'wrun:r1'), 'wrun', 'as a wrun row');

-- Base revision mismatch.
select public.cockpit_put_wrun('wrun:r1', 1, t.run('r1', 2, '{"cur":"s2","note":"stale"}'), 'op-r1-stale') as res \gset
select t.eq(:'res'::jsonb->>'status', 'conflict', 'a change made to an older revision is refused');
select t.eq(:'res'::jsonb->>'rev', '2', 'with the revision stored now');
select t.eq(:'res'::jsonb->'data'->>'cur', 's2', 'and the stored run');
select t.ok((select data->>'note' from cockpit_items where key = 'wrun:r1') is null, 'nothing of the refused change is stored');
select public.cockpit_put_wrun('wrun:r1', 5, t.run('r1', 6), 'op-r1-ahead') as res \gset
select t.eq(:'res'::jsonb->>'status', 'conflict', 'a base ahead of the stored revision is refused too');

-- Duplicate op ids: the same change sent again (its answer lost) is applied once.
select seq as seq_before from cockpit_items where key = 'wrun:r1' \gset
select public.cockpit_put_wrun('wrun:r1', 1, t.run('r1', 2, '{"cur":"s2","st":{"s1":{"o":"done"}}}'), 'op-r1-s1done') as res \gset
select t.eq(:'res'::jsonb->>'status', 'duplicate', 'a change sent again is recognised');
select t.eq(:'res'::jsonb->>'rev', '2', 'with the revision it made');
select t.eq(:'res'::jsonb->>'cur_rev', '2', 'and the revision stored now');
select t.eq((select seq::text from cockpit_items where key = 'wrun:r1'), :'seq_before', 'and not written again');
-- (even with other data, or another base: an op id names one change)
select public.cockpit_put_wrun('wrun:r1', 2, t.run('r1', 3, '{"cur":"s9"}'), 'op-r1-s1done') as res \gset
select t.eq(:'res'::jsonb->>'status', 'duplicate', 'an op id already applied is never applied again');
select t.eq((select data->>'cur' from cockpit_items where key = 'wrun:r1'), 's2', 'the run is unchanged');
select t.raises($$ select public.cockpit_put_wrun('wrun:r2', 0, t.run('r2', 1), 'op-r1-s1done') $$,
  'used for another run', 'an op id reused for another run is refused');

-- Two different steps from the same stale base (two devices that both had revision 2).
select public.cockpit_put_wrun('wrun:r1', 2, t.run('r1', 3, '{"cur":"s3","st":{"s1":{"o":"done"},"s2":{"o":"done"}}}'), 'op-dev1-s2') as res \gset
select t.eq(:'res'::jsonb->>'status', 'accepted', 'the first device''s step is accepted');
select public.cockpit_put_wrun('wrun:r1', 2, t.run('r1', 3, '{"cur":"s2","st":{"s1":{"o":"done"}},"checks":[true]}'), 'op-dev2-tick') as res \gset
select t.eq(:'res'::jsonb->>'status', 'conflict', 'the second device''s other step, from the same base, is refused');
select t.eq(:'res'::jsonb->'data'->>'cur', 's3', 'and gets the first device''s run back');

-- A cancel against a continue.
select public.cockpit_put_wrun('wrun:r1', 3, t.run('r1', 4, '{"cur":"s4","status":"awaiting_user"}'), 'op-continue') as res \gset
select t.eq(:'res'::jsonb->>'status', 'accepted', 'continuing is accepted');
select public.cockpit_put_wrun('wrun:r1', 3, t.run('r1', 4, '{"cur":"s3","status":"cancelled","fin":5}'), 'op-cancel') as res \gset
select t.eq(:'res'::jsonb->>'status', 'conflict', 'a cancel made to the run before it continued is refused');
select t.eq((select data->>'status' from cockpit_items where key = 'wrun:r1'), 'awaiting_user', 'the run is not cancelled');

-- A retry against a recorded success.
select public.cockpit_put_wrun('wrun:r1', 4, t.run('r1', 5, '{"cur":"s5","st":{"s4":{"o":"done","exec":"x1"}}}'), 'op-success') as res \gset
select t.eq(:'res'::jsonb->>'status', 'accepted', 'the automation''s success is recorded');
select public.cockpit_put_wrun('wrun:r1', 4, t.run('r1', 5, '{"cur":"s4","live":{"tries":1}}'), 'op-retry') as res \gset
select t.eq(:'res'::jsonb->>'status', 'conflict', 'a retry made before the success is refused');
select t.eq((select data->'st'->'s4'->>'exec' from cockpit_items where key = 'wrun:r1'), 'x1', 'the recorded success stays');

-- Deleting a run goes through the same check, and keeps its revision.
select public.cockpit_put_wrun('wrun:d1', 0, t.run('d1', 1), 'op-d1-create') as res \gset
select public.cockpit_put_wrun('wrun:d1', 0, null, 'op-d1-delete-stale') as res \gset
select t.eq(:'res'::jsonb->>'status', 'conflict', 'a stale deletion is refused');
select public.cockpit_put_wrun('wrun:d1', 1, null, 'op-d1-delete') as res \gset
select t.eq(:'res'::jsonb->>'status', 'accepted', 'a deletion made to the stored revision is accepted');
select t.ok((select deleted from cockpit_items where key = 'wrun:d1'), 'the row is a tombstone');
select t.eq((select data->>'rev' from cockpit_items where key = 'wrun:d1'), '2', 'that keeps the run''s revision');
select public.cockpit_put_wrun('wrun:d1', 1, t.run('d1', 2), 'op-d1-revive-stale') as res \gset
select t.eq(:'res'::jsonb->>'status', 'conflict', 'a change made before the deletion is refused');

-- Malformed and oversize input.
select t.raises($$ select public.cockpit_put_wrun('quest:r1', 0, t.run('r1', 1), 'op-bad-key1') $$, 'key must be', 'only wrun: keys');
select t.raises($$ select public.cockpit_put_wrun('wrun:', 0, t.run('', 1), 'op-bad-key2') $$, 'key must be', 'an empty run id');
select t.raises($$ select public.cockpit_put_wrun('wrun:a b', 0, t.run('a b', 1), 'op-bad-key3') $$, 'key must be', 'a run id with a space');
select t.raises($$ select public.cockpit_put_wrun('wrun:' || repeat('x', 41), 0, t.run(repeat('x', 41), 1), 'op-bad-key4') $$, 'key must be', 'a run id over 40 characters');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', 0, t.run('r9', 1), 'short') $$, 'op must be', 'an op id under 8 characters');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', 0, t.run('r9', 1), 'op id with spaces') $$, 'op must be', 'an op id with spaces');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', 0, t.run('r9', 1), null) $$, 'op must be', 'no op id');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', -1, t.run('r9', 0), 'op-neg-base') $$, 'out of range', 'a negative base');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', null, t.run('r9', 1), 'op-null-base') $$, 'out of range', 'no base');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', 999999999, t.run('r9', 1000000000), 'op-huge-base') $$, 'out of range', 'a base at the limit');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', 0, '[1,2]', 'op-array') $$, 'must be an object', 'data that isn''t an object');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', 0, t.run('other', 1), 'op-other-id') $$, 'keep the run', 'data with another run''s id');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', 0, '{"rev":1}', 'op-no-id') $$, 'keep the run', 'data with no id');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', 0, t.run('r9', 2), 'op-rev-skip') $$, 'base revision \+ 1', 'a revision that skips one');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', 0, t.run('r9', 0), 'op-rev-same') $$, 'base revision \+ 1', 'a revision that doesn''t move');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', 0, '{"id":"r9","rev":"1"}', 'op-rev-text') $$, 'base revision \+ 1', 'a revision as text');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', 0, '{"id":"r9","rev":1.5}', 'op-rev-frac') $$, 'base revision \+ 1', 'a fractional revision');
select t.raises($$ select public.cockpit_put_wrun('wrun:r9', 0, t.run('r9', 1, jsonb_build_object('log', repeat('x', 270000))), 'op-oversize') $$, 'too large', 'a run over 256 KB');
select t.ok(not exists (select 1 from cockpit_items where key = 'wrun:r9'), 'none of them wrote anything');

-- Another user: their own rows only, never this one's.
select t.as_user(:'B');
select t.ok(not exists (select 1 from cockpit_items where key = 'wrun:r1'), 'another user can''t read the run');
select public.cockpit_put_wrun('wrun:r1', 0, t.run('r1', 1, '{"cur":"b"}'), 'op-r1-create') as res \gset
select t.eq(:'res'::jsonb->>'status', 'accepted', 'the same key and op id for another user is their own run');
select t.as_user(:'A');
select t.eq((select data->>'rev' from cockpit_items where key = 'wrun:r1'), '5', 'the first user''s run is untouched');
select t.eq((select data->>'cur' from cockpit_items where key = 'wrun:r1'), 's5', 'and still theirs');
reset role;
select t.eq((select count(*)::text from cockpit_items where key = 'wrun:r1'), '2', 'two rows, one per user');
select t.eq((select user_id::text from cockpit_items where key = 'wrun:r1' and data->>'cur' = 'b'), :'B', 'the second one the second user''s');
set role authenticated;
select t.as_user(:'A');
select t.raises($$ select * from cockpit_wrun_ops $$, 'permission denied', 'the op table can''t be read directly');
select t.raises($$ insert into cockpit_wrun_ops (user_id, op, key, rev) values (auth.uid(), 'op-forged', 'wrun:r1', 9) $$, 'permission denied', 'nor written');

-- Not signed in.
select t.as_user('');
select t.raises($$ select public.cockpit_put_wrun('wrun:r1', 5, t.run('r1', 6), 'op-anon-1') $$, 'sign in first', 'no user: refused');
reset role;
set role anon;
select t.raises($$ select public.cockpit_put_wrun('wrun:r1', 5, t.run('r1', 6), 'op-anon-2') $$, 'permission denied', 'the anon role can''t call it at all');
reset role;
set role authenticated;
select t.as_user(:'A');

-- The guard: ordinary upserts can't take a run back, and don't fail their batch.
insert into cockpit_items (user_id, key, kind, data, edited_at)
  values (auth.uid(), 'quest:q1', 'quest', '{"id":"q1","text":"Q"}', 1),
         (auth.uid(), 'wrun:r1', 'wrun', t.run('r1', 4, '{"cur":"old"}'), 99999999999999)
  on conflict (user_id, key) do update set data = excluded.data, edited_at = excluded.edited_at
  returning key \gset upsert_
select t.eq(:'upsert_key', 'quest:q1', 'a batch with a regressing run writes the rest (only the quest comes back)');
select t.eq((select data->>'cur' from cockpit_items where key = 'wrun:r1'), 's5', 'the run isn''t taken back to an older revision');
update cockpit_items set data = t.run('r1', 5, '{"cur":"same"}'), edited_at = 99999999999999 where key = 'wrun:r1';
select t.eq((select data->>'cur' from cockpit_items where key = 'wrun:r1'), 's5', 'nor overwritten at the same revision');
update cockpit_items set data = (data - 'rev') || '{"cur":"older app"}', edited_at = 99999999999999 where key = 'wrun:r1';
select t.eq((select data->>'cur' from cockpit_items where key = 'wrun:r1'), 's5', 'nor by an older copy of the app (no revision)');
update cockpit_items set deleted = true, data = null, edited_at = 99999999999999 where key = 'wrun:r1';
select t.ok(not (select deleted from cockpit_items where key = 'wrun:r1'), 'nor deleted while under way');
update cockpit_items set data = t.run('r1', 6, '{"cur":"s6"}'), edited_at = 99999999999999 where key = 'wrun:r1';
select t.eq((select data->>'cur' from cockpit_items where key = 'wrun:r1'), 's6', 'a higher revision may be written directly');
select public.cockpit_put_wrun('wrun:f1', 0, t.run('f1', 1, '{"status":"succeeded","fin":1}'), 'op-f1-create') as res \gset
update cockpit_items set deleted = true, data = null, edited_at = 99999999999999 where key = 'wrun:f1';
select t.ok((select deleted from cockpit_items where key = 'wrun:f1'), 'a finished run can be tidied away by any copy');
select t.eq((select data::text from cockpit_items where key = 'wrun:f1'), '{"id": "f1", "rev": 2}', 'and its tombstone keeps the next revision');
update cockpit_items set deleted = false, data = t.run('f1', 1, '{"status":"running"}'), edited_at = 99999999999999 where key = 'wrun:f1';
select t.ok((select deleted from cockpit_items where key = 'wrun:f1'), 'so it can''t be brought back at an old revision');
update cockpit_items set data = t.run('r1', 999999999, '{"cur":"jump"}'), edited_at = 99999999999999 where key = 'wrun:r1';
select t.eq((select data->>'cur' from cockpit_items where key = 'wrun:r1'), 's6', 'nor can a run be jumped to the last revision (it would block every later change)');
update cockpit_items set data = t.run('r1', 8, '{"cur":"skip"}'), edited_at = 99999999999999 where key = 'wrun:r1';
select t.eq((select data->>'cur' from cockpit_items where key = 'wrun:r1'), 's6', 'nor skip a revision');
insert into cockpit_items (user_id, key, kind, data, edited_at) values (auth.uid(), 'wrun:n1', 'wrun', '{"id":"n1"}', 1);
select t.ok(exists (select 1 from cockpit_items where key = 'wrun:n1'), 'a new run can still be inserted by an older copy');
update cockpit_items set data = '{"id":"q1","text":"Q2"}', edited_at = 2 where key = 'quest:q1';
select t.eq((select data->>'text' from cockpit_items where key = 'quest:q1'), 'Q2', 'other rows are as before');
update cockpit_items set data = '{"id":"r1","rev":"999"}', edited_at = 99999999999999 where key = 'wrun:r1';
select t.eq((select data->>'cur' from cockpit_items where key = 'wrun:r1'), 's6', 'a revision that isn''t a number is read as 0: refused, without an error');

-- At most 600 changes an hour per user (a duplicate is still answered).
reset role;
insert into cockpit_wrun_ops (user_id, op, key, rev)
  select :'B', 'op-flood-' || g, 'wrun:flood', g from generate_series(1, 600) g;
set role authenticated;
select t.as_user(:'B');
select t.raises($$ select public.cockpit_put_wrun('wrun:r2', 0, t.run('r2', 1), 'op-r2-after-flood') $$, 'too many run changes', 'the 601st change in an hour is refused');
select t.eq((public.cockpit_put_wrun('wrun:r1', 0, t.run('r1', 1, '{"cur":"b"}'), 'op-r1-create'))->>'status', 'duplicate', 'a change already applied is still answered');
reset role;
delete from cockpit_wrun_ops where op like 'op-flood-%';

-- Automation reports with no execution id go to the oldest launch still waiting, so a late
-- report from an attempt a retry set aside never lands on the newer attempt.
insert into cockpit_exec_tokens (token, user_id) values ('xtok-a', :'A');
insert into cockpit_items (user_id, key, kind, data, edited_at) values
  (:'A', 'exec:x1', 'exec', jsonb_build_object('id', 'x1', 'flow', 'f9', 'status', 'requested', 'aside', 1,
     'at', (extract(epoch from now() - interval '10 minutes') * 1000)::bigint), 1),
  (:'A', 'exec:x2', 'exec', jsonb_build_object('id', 'x2', 'flow', 'f9', 'status', 'requested',
     'at', (extract(epoch from now() - interval '1 minute') * 1000)::bigint), 1);
set role anon;
select t.eq((public.cockpit_exec_report('xtok-a', 'f9', 'running'))->>'execution', 'x1', 'a report goes to the oldest launch waiting (the one set aside)');
select t.eq((public.cockpit_exec_report('xtok-a', 'f9', 'succeeded', 'late'))->>'execution', 'x1', 'still waiting after a running report: its result goes there too');
select t.eq((public.cockpit_exec_report('xtok-a', 'f9', 'succeeded'))->>'execution', 'x2', 'once it has its result, the next report goes to the newer launch');
select t.eq((public.cockpit_exec_report('xtok-a', 'f9', 'failed'))->>'execution', '', 'with none waiting, a report is its own');
select t.eq((public.cockpit_exec_report('xtok-a', 'f9', 'failed', '', 'x2'))->>'execution', 'x2', 'one naming its execution goes there');
reset role;
