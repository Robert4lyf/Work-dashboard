# Release G, checkpoint 2: process runs synced with a revision check

Up to Release F, a process run (`S.wruns`, one row `wrun:<id>` in `public.cockpit_items`) synced
like every other record: newer edit wins. Release F made a stale tap harmless once the newer run
had reached the device. Two devices that each changed the same run before syncing still resolved
silently: one run overwrote the other. For runs that launch automations, wait on people and record
approvals, that is an integrity risk.

This checkpoint makes the server the judge of run changes, keeps a refused change instead of
dropping it, and binds Acknowledge and Add to the Inbox to the failure they were drawn for.

## Design

The simplest design that protects: compare-and-swap on a revision number, per run, on the
server. No event log, no merge engine.

1. **A revision on every run.** `r.rev` is an integer in the run's data. The server makes it one
   higher on every change it accepts. A run from before reads as 0 (`cleanRun` keeps `rev` only
   once it's above 0, so old runs aren't rewritten just to add it).
2. **One function writes runs.** `cockpit_put_wrun(p_key, p_base_rev, p_data, p_op)`
   (`supabase/release-g-runs.sql`, SECURITY DEFINER). In one transaction it locks the run (an
   advisory lock on user and key, which also covers a run not stored yet, then `select … for
   update` on the row) and:
   - returns the earlier result if the op id `p_op` was already applied (`duplicate`);
   - refuses the change if the stored revision isn't `p_base_rev` (`conflict`, with the stored
     run);
   - otherwise writes `p_data` (or a tombstone that keeps the id and revision, if `p_data` is
     null), records the op id and returns `accepted`.

   It also checks that the new `rev` is exactly base + 1, that the data keeps the run's id, that
   it's an object of at most 256 KB (UTF-8 bytes of its jsonb text), and that the key and op id
   are well formed. A user can make at most 600 changes an hour (SQLSTATE 54000); a change
   already applied is still answered as a duplicate.
3. **Ordinary writes can't take a run back, or jump it ahead.** A `BEFORE UPDATE` trigger on
   `cockpit_items` (`cockpit_items_wrun_guard`) skips an update of a `wrun:` row unless its `rev`
   is exactly the stored one + 1 and below 999,999,999 (so no write can push a run to the
   function's limit and block every later change). It returns NULL rather than raising, so the rest
   of an upsert batch is still written. The skipped row isn't in what the upsert returns, so the
   app that sent it treats it as lost and fetches the stored run, as it already does for an older
   edit. The one exception: deleting a run that is over (succeeded or cancelled) is allowed from
   any copy, because that is only the app's tidying of old runs; the trigger then stores the
   tombstone as `{id, rev: stored + 1}`, so the run can't be brought back at an old revision.
4. **The app sends runs through the function.** `pushDirty` (js/sync.js) sends every dirty `wrun:`
   record through `cockpit_put_wrun` first, one at a time, then upserts the rest as before.
   - The base is the revision this device last took in or had accepted (`sync2.wrev`).
   - The change is frozen when first sent (`sync2.wop`: op id, base, the exact data, and the
     number of the last journal entry it holds) and saved before it goes. If the answer is lost,
     the same op is sent again, unchanged, and comes back `duplicate`.
   - While a change is out, the run stays marked as changed here even if it's changed back to
     what was last synced; once the change is taken, anything different here is sent next. So a
     change undone while its write is in flight follows it, and device and server agree.
   - Several changes made offline go as one change, from one base to base + 1.
   - A run the server refuses for what it is (bad input, SQLSTATE 22023, or a 400) is parked
     (`sync2.wbad`): not sent again until it changes, said on its page ("Not synced: …", with
     **Use the server's**, which takes the server's run and writes what wasn't sent into its
     history), and the rest of the sync goes on. The app checks a run's size the way the server
     does (UTF-8 bytes of the jsonb text) before sending, so a run over 256 KB (a 30-step
     verification with long CJK text, say) is parked here with its size. Too many changes in an
     hour leaves the runs for later and sends the rest.
5. **A pull never replaces a run changed here and not yet accepted.** With the function
   installed, the server decides between the two (step 4). Without it, the old rule applies.

### The journal: what "Apply mine on top" replays

Each transition is noted per run in `sync2.wjour`, numbered (`q`, rising on this device; when a
change is taken, the entries up to the number it held are dropped, however the journal was
trimmed meanwhile), (this device's own bookkeeping, saved with the
sync state) with what it was asked. That covers begin, step done/skipped/chosen (with how: by
hand, choice, guide, reply, automation), fail, retry, pause, resume, cancel, a check ticked, a
launch recorded, a guide linked, waiting started, a waiting item re-keyed, acknowledge and notes.
`wfTx` wraps every transition function. Only the outermost call is noted (a result applied on
Resume is part of the Resume), and a call that changes nothing isn't noted. When the server
accepts a change, the entries it held are dropped.

A change to a run that came through none of the transitions (a backup restored, say) is noted
as a `replace`: `sync2.wjh` holds each run's hash as last explained (by a transition, a sync or a
row taken in), and `markDirty` notes a `replace` when a run differs from it. A conflict over a
`replace` is never settled on its own; **Apply mine on top** then puts this device's whole
version in place of the server's (at the server's revision).

Moves every device makes alike from the same records are marked `eng`: an automation's reported
result, folded in or reconciled, and the day's tidy-up cancelling an unstarted run.

### Conflicts

When the server refuses a change, the device:

1. keeps its version and journal as a conflict (`S.wconflicts`: this device only, in its
   backups, kept across pulls and reloads, at most 20; when the oldest has to go to make room,
   what it held is first written into its run's history, and a run with a conflict isn't pruned);
2. takes the server's run (`applyRows`), which also re-derives any automation result it hasn't
   applied yet.

A refusal that loses nothing is settled without asking (`conflictSettles`):

- a run deleted on either side (only finished runs are ever tidied away);
- the same automation result or tidy-up, already on the server's run, or still to come because
  the server's run still waits for that attempt;
- an acknowledgement of the failure the server already has acknowledged;
- a run only made ready on both devices (a repeat's run, made under the same id): new here (base
  0), still ready, no step outcome, and no history entry the server lacks but its "prepared";
- nothing noted, and no history entry the server lacks (for a run the server already had).

Notes alone are written again on the server's version. Anything else is shown.

The run's page shows each conflict plainly:

> **Conflict:** changed on another device too.
> **This device:** marked “Prepare” done.
> **Server:** Your turn at “Send” · “Prepare” done.
> [Keep the server’s] [Apply mine on top]

- **Keep the server's** writes what this device did into the run's history ("kept the server’s;
  not applied from this device: …") and removes the conflict. Nothing is discarded silently.
- **Apply mine on top** is offered only when every noted change still applies to the server's
  run. It is tried on a copy first, by the same Release F rules (the transition functions check
  the current step, how a step may be done, ticked checks, a finished guide, a valid choice, the
  run's status), and again when tapped. If it no longer fits, the page says why ("Mine can’t be
  applied: not the current step."). Applied, each change is a new change from the server's
  revision, with its own op id, and the history says "applied this device’s on top".
- A retry or a skip of a failed step is bound to the failure it was made for. It isn't applied to
  a newer failure.

**Nothing launches an automation while a conflict is settled or a change is sent again.** A launch
in the journal is the record of the tap made on this device. Replayed, it attaches that attempt to
the step if the step is still waiting for one, and opens nothing. Only a tap on Launch opens an
automation.

### Saved, synced, conflict

The run's status line ends with where its last change stands, while sync is set up and signed
in: **Saved on this device** (changed here, not yet accepted by the server), **Synced** or
**Conflict**. A process completed offline says "Completed on this device; not synced yet" rather
than "Process completed".

### Automation reports

Executions keep their ids and their states: requested, running, succeeded, failed, cancelled, and
unconfirmed (no word for a day). A launch request is never a result. A stage completes from a
report only through `completeStage(…, { by: 'auto', exec })`, and `failStage` takes the attempt the
same way. Both are refused unless the step is waiting for that very attempt (`r.live.exec`), so:

- a duplicate report of the same result finds the step already moved on and changes nothing;
- a late "running" after a result is ignored (as before, in `foldExecEvent`);
- a delayed report for an older attempt never completes or fails the newer attempt;
- a report that names no execution (the normal case: a launch by its `ms-powerautomate:` link
  can't pass one on) is paired by `cockpit_exec_report` with the **oldest** launch of that flow
  still waiting to hear (requested or running, within a day, no result reported yet), not the
  newest. So the late report of an attempt a retry has set aside goes to that attempt, never to the
  newer one. (The function is replaced in the migration, keeping its arguments, checks, limits and
  rights, with `search_path = public, pg_temp`; `supabase-setup.sql` has the same version, so
  re-running it doesn't undo this.)
- an attempt the step no longer waits for (a retry, a new launch, the step done by hand or skipped,
  the run cancelled) is marked `aside` on its own record (synced) and acknowledged, so it isn't
  flagged as waiting; it's still the attempt its own late reports are paired with, and its results
  never move the run;
- two devices that both fold the same report both move the run. One change is accepted, and the
  other settles on its own (same attempt, same outcome).

A success reported on one device for an attempt that the other device had already set aside (by
a retry the server accepted) is shown as a conflict, not dropped.

### Failure occurrences: Acknowledge and Add to the Inbox

- Every failure gets an id, `r.fid`, unique across devices: `'x' + attempt` for an automation's
  reported failure (the same on every device that folds the report), else `'f' + uid()`.
  `failOcc(r)` is the current one's (a failure from before is named by its time, `t<ms>`).
  `r.occ` only counts a run's failures, for the words ("failure 2 of this run").
- The step's outcome keeps its `fid`. `r.fails` keeps the last 12 failures (id, step, time, error,
  attempt), so a retry no longer loses the failure.
- Acknowledge and Add to the Inbox carry `data-wocc`. At the tap, the run must still be failed with
  that failure, or the answer is "That failure has changed" and the page redraws. `r.ack` stores
  the failure acknowledged. A `1` from a copy of the app from before still counts.
- Add to the Inbox makes that failure's item:
  - the step, time, error, attempt and a link to the run (`#/wrun/<id>`, also as a resource), plus
    the run's summary;
  - its id is derived from the run and the failure (`keyId('wfail:' + run + ':' + fid)`). A second
    tap, on any device, makes no second item ("Already in the Inbox").
- An automation's failure has the same binding in its details sheet (`data-xocc`, the id of the
  failure report). Its Inbox item's id is derived from the attempt and the report.

## Guarantees

With `supabase/release-g-runs.sql` installed:

- **No lost update between devices.** A change to a run is stored only if it was made to the
  revision stored at that moment. Two changes made from the same revision can never both be
  stored, whether concurrent, offline or delayed. The second is refused and reaches its device
  as a conflict.
- **No silent loss of what a device did.** A refused change is either shown, or settled only when
  it matches one of the cases listed above. Keeping the server's version records what wasn't
  applied in the run's history.
- **Applied once.** An op id is applied at most once per user (30 days). A change sent again after
  a lost answer returns `duplicate`.
- **No regression by ordinary writes.** No upsert (an older copy of the app, a script with the
  user's session) can set a run to an equal or lower revision, or delete a run that isn't over.
- **No automation launched by sync.** Sending, resending and settling never open a launch URL.
- **Stale controls are refused.** A step's actions are bound to the step (Release F). Acknowledge
  and Add to the Inbox are bound to the failure, and a resolution is checked again when tapped.
- **The Inbox gets one item per failure**, on any number of devices, and two failures never share
  one.
- **A refused run doesn't hold up the rest.** A run the server refuses as it is is parked and said
  on its page; every other record still syncs.
- **Reports go to their own attempt.** A report with no execution id goes to the oldest launch of
  its flow still waiting; a step only moves on a result for the attempt it waits for.

## Not guaranteed

- **Without the SQL file**, runs are newer-edit-wins exactly as before. The health check says so
  ("Process run checks ✗ Not installed: the newer edit wins").
- **Other records are unchanged.** Inbox items, executions, guide runs and so on stay
  newer-edit-wins. A run's waiting item or guide run is a record of its own.
- **Side effects already made locally stay.** Rules that fired on a device for a change the server
  then refused have fired: their Inbox item or task stays, and the rule log says so. The same goes
  for an Inbox item made by Add to the Inbox when the acknowledgement is refused.
- **Only this device can settle its conflict.** Conflicts are local: if the device is lost or
  wiped before you choose, the refused change goes with it. It was never accepted, and the
  server's run is intact. A backup restore replaces them with the backup's.
- **Replays fail closed.** "Apply mine on top" is all or nothing. If any one change no longer
  fits, only Keep is offered. A journal longer than 40 entries for one run can't be replayed.
- **Copies of the app from before Release G** can still create runs, but can no longer change
  existing ones once the SQL is installed. Their change is refused and they take the server's run,
  so their unsynced change to a run is lost on that copy. Reload every device after installing.
- **Revisions count accepted changes, not taps.** Several changes made offline are one revision.
- Two devices that disagree about a run while the function is missing, then install it, keep
  whatever newer-edit-wins left.
- **Pairing a report without an execution id is still a guess.** Oldest-first is right when an
  automation reports in the order it was launched. If a set-aside attempt never reports at all, the
  next attempt's report is paired with it: the step then waits (unconfirmed after a day) for you
  to confirm it by hand, rather than taking a result that may not be its own. A script that passes
  `execution` or `run_ref` avoids the guess.
- **With the guard but not the function** (a stale schema cache, a partial rollback), every run
  change is refused. Each one is kept as a conflict on its device, not dropped, but the run can't
  move on until the function is back (re-run the migration).
- **A parked run** stays as it is here until you choose **Use the server's** (or it changes and is
  sent again).

## Compatibility

- **The function is missing** (PostgREST `PGRST202`, a 404, or an answer it can't have given): runs
  go through the ordinary upsert, newer edit wins. There's no toast. The health check has one row
  for it. The app asks again every half hour, so installing the SQL takes effect without a reload.
- **Old runs** (no `rev`) read as revision 0. They're not rewritten until they change.
- **Backups** hold runs with their `rev`, and the device's conflicts. Restoring sends each run as
  a new revision on top of the server's (the base is the server's revision, not the backup's), so
  a restore works whatever revisions the backup has, old backups included.
- **Older copies of the app** treat `rev`, `occ`, `fid`, `fails`, an execution's `aside` and a
  string `ack` as unknown fields
  (`cleanRun` drops them on their side, and the guard keeps them from writing that back over a
  newer run).

## Migration (the user runs this in Supabase)

1. Supabase > SQL Editor > New query: paste `supabase/release-g-runs.sql`, Run.
   - It's idempotent (`create … if not exists`, `create or replace`, `drop trigger if exists`)
     and changes no data.
   - It ends with `notify pgrst, 'reload schema'` so the function is callable straight away.
2. Reload the app on every device.
3. Settings > Health check > Run check: "Process run checks ✓ On".

## Rollback

Run the four lines between `-- BEGIN ROLLBACK` and `-- END ROLLBACK` at the end of the file,
without their `-- `:

```sql
drop trigger if exists cockpit_items_wrun_guard on public.cockpit_items;
drop function if exists public.cockpit_items_wrun_guard();
drop function if exists public.cockpit_put_wrun(text, integer, jsonb, text);
drop table if exists public.cockpit_wrun_ops;
```

The runs stay, with their revision. The app notices the function is gone at its next run change
and goes back to newer edit wins. Running the migration again later picks up from the revisions
stored. `cockpit_exec_report` is left as the migration made it: `supabase-setup.sql` has the same
version (oldest waiting launch), so there's nothing to undo there.

If you re-run `supabase-setup.sql` without this migration, you also get the new report pairing.

## Security review

- **Who can call it.** `cockpit_put_wrun` is executable by `authenticated` only (revoked from
  `public` and `anon`). It raises "sign in first" when `auth.uid()` is null.
- **Whose rows.** Every read and write is filtered by `user_id = auth.uid()`. The key can't name
  another user. The op table is keyed by (user, op), so op ids can't collide across users or tell
  one user about another's.
- **search_path.** Both functions run with `search_path = public, pg_temp`, so a caller can't
  shadow a table or function.
- **Input checks.**
  - The key must match `^wrun:[A-Za-z0-9_-]{1,40}$`, the op id `^[A-Za-z0-9_-]{8,64}$`.
  - The base is 0 to 999,999,998.
  - The data is a JSON object of at most 256 KB, keeps the key's run id, and has `rev` = base + 1
    as a JSON number.
  - Malformed input is refused with an error (SQLSTATE 22023) and writes nothing.
- **The op table** (`cockpit_wrun_ops`) has RLS on and no policies, and table rights are revoked
  from `anon` and `authenticated`. Only the function reaches it. Rows older than 30 days are
  deleted as the user writes.
- **The guard trigger** runs as the caller (not SECURITY DEFINER), only on `wrun:` rows. A
  revision it can't read (not a number) counts as 0, so it refuses rather than errors.
- **No service-role key in the client**, and no new runtime dependency.
- **The report function** (`cockpit_exec_report`, replaced) keeps its signature, token check,
  input checks, 120-an-hour limit and grants, and now runs with `search_path = public, pg_temp`.
- **Denial of service.** At most 600 run changes an hour per user. A user can only lock their own
  runs, one run at a time. The size limit
  caps what one call stores.

## Tests

- **`tests/db/run.sh`** (real PostgreSQL 16, throwaway cluster on port 54329; GitHub Actions job
  `db`). It sets up a stand-in for what Supabase provides (`tests/db/bootstrap.sql`: the roles,
  `auth.users`, `auth.uid()` from `request.jwt.claim.sub`, Supabase's default grants), then
  `supabase-setup.sql` and the migration. The cases (`tests/db/cases.sql`, `tests/db/after.sql`),
  as two users:
  - accepted, conflict and duplicate;
  - two devices doing the same step, and different steps from the same base;
  - a cancel against a continue, and a retry against a recorded success;
  - deletes;
  - an op id reused, including for another run;
  - every malformed and oversize input;
  - another user's key, the op table unreachable, anon and no-user refused;
  - the guard: a mixed batch, the same revision, an old app's write, a delete under way, a finished
    run tidied, a non-numeric rev;
  - two truly concurrent sessions (one holds the lock; the other waits and is refused), for an
    existing run and for creating the same run;
  - the guard: a revision jumped ahead or skipped refused, and a tidied run's tombstone keeping
    the next revision so it can't come back at an old one;
  - the hourly limit;
  - report pairing: oldest waiting launch, set aside or not, then the next once it has a result,
    none waiting, one named; the function the same in `supabase-setup.sql` and the migration, both
    functions with `search_path = public, pg_temp`;
  - the migration applied twice;
  - the rollback;
  - reinstalling.
- **`tests/releaseg-sync.spec.js`** (the app, with `tests/fakesb.js`: the sync.spec.js stand-in
  extended with the function's and the guard's rules, a missing-function mode and lost answers):
  - two devices completing the same step offline (refused, shown, kept, reload, Keep);
  - different changes from a stale revision (applied on top), and a pause against a step done
    (not applicable);
  - one device offline then reconnecting (one change; "Completed on this device");
  - a cancel while the other continues (applied on top);
  - an automation retry against a recorded success, both orders, with nothing launched;
  - delayed, duplicate and out-of-order exec reports;
  - the answer lost after acceptance (same op id, applied once, across a reload too);
  - the function missing (newer edit wins, health check once, no toasts, installed later);
  - backup and restore with revisions, and an old backup;
  - Acknowledge and Add to the Inbox refusing a newer failure, with the item made once across
    two devices;
  - the same for an automation's failure.
- **`tests/releaseg-review.spec.js`**: one regression test per defect found in the concurrency and
  security review (each fails without its fix):
  - a late report from a set-aside attempt;
  - failure ids from two devices;
  - a change undone while its write is in flight;
  - a run too large, or refused, parked without holding up the rest, and Use the server's;
  - a restore over a run changed elsewhere;
  - a run new here with steps done, which the server has too;
  - the journal's numbering after trimming;
  - the conflict cap's note, and pruning;
  - the guard without the function.
- `tests/workflows.spec.js`: the run-level Inbox test now expects the failure's step in the item
  and the failure id in `ack`.
