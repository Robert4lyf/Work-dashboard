# Release H, checkpoint 3: trustworthy synchronisation

Release G made the server the judge of process-run changes (`docs/ux/release-g-sync.md`). An audit
of that work, with probes against a real PostgreSQL, found ways a run could still be moved by
something that wasn't its own, or lose this device's work without saying so. This checkpoint fixes
each one with the smallest change that keeps old data and old copies of the app working, and says
plainly what is and isn't guaranteed now.

## What changed, finding by finding

| Finding | Fix | Regression test |
| --- | --- | --- |
| **HIGH-1** A report naming no execution was paired with the *oldest* launch of its flow still waiting, including one that never ran (Power Automate Desktop asks to confirm a run started by URL; a phone can't run the link at all) or another run's. A run's step could be completed by someone else's result. | `cockpit_exec_report` pairs a report naming no execution only when **exactly one** launch of that flow is waiting (requested or running, within a day, no result reported). With none or several it stores it unpaired (`execution = ''`): the app makes it an execution of its own (`u<row id>`), a step waiting on that automation keeps waiting, and its page says a result came that names no attempt (`strayLine`), with "It succeeded (checked by hand)" / "It failed" to confirm. | `tests/db/cases.sql` (two waiting: unpaired; the audit's never-ran + other-run case; over a day old or deleted not counted; run_ref); `tests/releaseh-sync.spec.js` "HIGH-1"; `tests/releaseg-review.spec.js` 1 updated |
| **HIGH-2** The docs said a Run URL can't carry an execution id. Microsoft documents `&inputArguments={"<External name>": <value>}` on `ms-powerautomate:/console/flow/run?…`. | Opt-in per flow: **Pass the attempt’s id to the flow** (`f.passId`, default off, a field of the `flow:` row, edited under Knowledge > Processes > Manage automations). At the tap, the one click handler for every `a[data-flow]` (Today chips, the automations list, a run's Launch, the Launch after Try again, an attempt's Run again, task links, search, the Command Centre, guides) creates the execution, then sets the link's `href` to the Run URL + `&inputArguments=` + `encodeURIComponent(JSON.stringify({ExecId: <id>}))` before the browser follows it (the handler runs in the capture phase; the browser reads `href` after dispatch), and sends the launch to the server at once. The server takes a named execution only if this user has an `exec:` row of that id **and that flow**; otherwise it is neither taken nor replaced by a guess. `foldExecEvent` also requires `x.flow === flow`. | `tests/releaseh-sync.spec.js` "HIGH-2" (each path's href at the moment of the tap; off = as saved; synced; paired by id; another flow's id refused by the server and by the fold); `tests/db/cases.sql` (named id: own flow taken, other flow / unknown / other user's not) |
| **MED-3** The day's tidy-up on one device cancelled a still-ready run that another device had started offline; the start then couldn't be replayed ("the run is over") and only Keep was offered. | `rolloverWorkflows` doesn't tidy a run this device has a journal for, a change being sent, or a conflict about (`wrunUnsent`). In a conflict where the server's run differs from the base only by the tidy-up (never started, "not started that day", one revision on: `tidiedOnly`), **Apply mine on top** is offered and puts this device's version on top. | `tests/releaseh-sync.spec.js` "MED-3" |
| **MED-4** `conflictSettles` settled whenever the server's run was deleted, assuming only finished runs are deleted. A delete (or a restore without the run) of a run still under way silently dropped this device's unsynced work. | Settles on a tombstone only when this device's run is over **and** it changed nothing but notes or engine moves. Otherwise the conflict is kept (`gone: 1`), the run stays on this device, unsent and not replaced by pulls (`wrunHeld`), and its page offers **Keep the server's** (delete it here too, nothing sent) or **Apply mine on top** (sent on top of the deletion's revision). | `tests/releaseh-sync.spec.js` "MED-4" (both ways out, across a reload; and a tidied finished run still settles) |
| **MED-5** The run page said "Synced" with or without the server's check. | The status line says one of: **Synced, checked by the server**; **Saved on this device, not yet synced**; **Conflict: needs your choice**; **Synced, but the server’s check isn’t installed: the newer edit wins**; **Synced, but the server’s check is only partly installed**; **Not synced: the last sync failed**; **Not synced** (parked). A Launch or a Try again on a run says, in one line, that another device could overwrite its progress while unprotected and signed in; nothing is blocked. The health check asks `cockpit_sync_checks()` (new, `release-h.sql`) whether the function, the guard trigger (enabled) and its function exist, and reports a partial install distinctly with what to run; without the new function it falls back to Release G's probe and says so. The app asks once a session (first sync with runs), on every Health check run and on **Sync now**; and an ordinary upsert of a run turned away while the app thought the function missing makes it ask again at once: installed, the change goes through the function instead of becoming a conflict. | `tests/releaseh-sync.spec.js` "MED-5"; `tests/releaseg-sync.spec.js` (the words; "Not synced: the last sync failed" after a lost answer); `tests/db/run.sh` "a partial install" |
| **MED-6** A refused run change still pushed its related records: the execution it set aside (`aside`, `ack`), waiting items, rule-log entries. | Each journal entry notes the attempts it set aside (`ax`). On a refusal, those set-asides are undone where the server's run still waits for that attempt or took its result (`undoAside`), so the run and the execution agree; the execution then isn't sent at all (it's as last synced). The rest is documented below. | `tests/releaseh-sync.spec.js` "MED-6" |
| **MED-7** `held` counted a reported failure as already on the server when the server's step had that attempt with *any* outcome, so a failure could settle silently over a success confirmed by hand. | A `fail` entry is held only if the server's step has that attempt **failed** (or the server's failure list has it). | `tests/releaseh-sync.spec.js` "MED-7" |
| **LOW** The guard let a direct write of the next revision store another run's id or any size; a lost answer asked again after its op id expired (30 days) was a false conflict; Release G-era SECURITY DEFINER functions in `supabase-setup.sql` had `search_path = public` without `pg_temp`. | The guard also requires the row's key unchanged, a string `id` equal to the key's run id, and at most 256 KB (`octet_length(data::text)`, as the function). `putRun` treats a stored run equal to what was sent, revision aside (`sameRun`), as accepted. Every SECURITY DEFINER function runs with `search_path = public, pg_temp` (setup.sql; `release-h.sql` alters an existing install's). | `tests/db/cases.sql` (another id, non-text id, over 256 KB, key moved); `tests/db/run.sh` (all nine definer functions; an older install's fixed); `tests/releaseh-sync.spec.js` "LOW" |

## Guarantees (with `release-g-runs.sql` and `release-h.sql` installed)

Release G's guarantees stand (`docs/ux/release-g-sync.md`, Guarantees). In addition:

- **A report moves only its own attempt.** A report naming an execution moves only that execution,
  and only if it is that flow's. A report naming none moves a launch only when that launch is the
  only one of its flow waiting; otherwise it moves nothing and the step waits for you.
- **A refused change never takes this device's work away in silence**, including when the other
  device deleted the run or restored a backup without it, or only tidied it away for the day.
- **The run page tells the truth about protection.** It never says "Synced, checked by the
  server" unless the server answered that its function is there (and, asked through
  `cockpit_sync_checks`, its guard).
- **A refused change's set-aside of an attempt doesn't outlive the refusal** where the server's
  run still holds that attempt.

## Not guaranteed

- **Only process runs are checked.** Tasks, notes, Inbox items, executions, guide runs, waiting
  items, flows, rules and the rest remain newer-edit-wins. For ordinary tasks and notes this is
  deliberate: they are edited freely on every device, and a merge prompt for each would cost more
  than the rare overwrite.
- **Related records of a refused run change** (multi-record consistency, MED-6): only the
  execution's set-aside is undone. Still sent, and staying, are:
  - a waiting item made by "Start waiting" (the run's step names it; refused, the item stays in
    the Inbox, harmless and visible);
  - a guide run opened from a step (`run:` row);
  - an Inbox item made by Add to the Inbox, and anything a rule did on this device for a change
    the server then refused (its item or task stays; the rule log says it fired);
  - a launch recorded by a tap (the automation really was opened: the attempt stays, on its own).
  Each is a record of its own, newer-edit-wins, and none moves the server's run.
- **The `ExecId` hand-over has not been tested on a real Power Automate Desktop install here.**
  The app's side is tested (the link carries the id at the moment of the tap, the server and the
  fold pair by it). Whether Power Automate Desktop passes `inputArguments` into an input variable
  with the external name `ExecId` on your version, and whether it asks to confirm such a run, is
  per Microsoft's documentation only. Check it once on your computer before relying on it.
- **A report naming an attempt the server doesn't have yet** (the flow reported before the tap
  reached the server: a device offline when tapped, a very fast flow) is kept on its own, not
  guessed. The app sends a passed-on launch at once to make this unlikely.
- **Unpaired means "you confirm".** Without `ExecId`, a second launch of the same flow within a
  day (including a tap on a phone, which can't run the link, or a launch nobody confirmed in Power
  Automate Desktop) makes every report naming no attempt unpaired until those launches get a
  result or a day passes. That is the safe direction (nothing is completed wrongly), at the cost
  of confirming by hand. Turning on **Pass the attempt’s id** avoids it.
- **Direct writes past the function** (an older copy of the app, a script with the user's
  session) can still store the next revision of a run without an op id and outside the hourly
  limit; the guard now checks the id, the key and the size, and refuses anything but exactly the
  next revision. Such a write can also delete a run that isn't over if it carries the next
  revision (the function can delete any run at its revision too); the app now keeps such a run
  as a conflict on a device that changed it (MED-4). The row is the user's own data either way.
- **Conflicts are this device's.** Lost with the device before you choose, the refused change is
  lost; the server's run is intact.

## The guard's direct-update path

`cockpit_items_wrun_guard` is a `BEFORE UPDATE` trigger on `wrun:` rows. An `insert … on conflict
do update` from the app's ordinary upsert takes the row lock on the existing row before the
trigger runs. A second upsert of the same row waits for that lock; under READ COMMITTED it then
re-reads the committed row and runs the trigger against **that** version. So two direct upserts
both carrying revision `n + 1` over a stored `n` are serialised: the first is stored, the second
sees stored `n + 1`, and the guard skips it (`return null`, so it isn't in what the upsert
returns, and its device fetches the stored run). Proven on real PostgreSQL 16 by
`tests/db/run.sh`, step "concurrent: two direct upserts of the same next revision (an older copy
of the app on two devices)": the second session waits over a second for the first's lock, returns
no row, and the first one's run is stored at revision 3. (The function's path is serialised by an
advisory lock as well as the row lock, tested by the two "concurrent" steps before it.)

## Automation correlation protocol

1. **Explicit id (recommended, opt-in per flow).** Tick **Pass the attempt’s id to the flow**. The
   launch opens `…/console/flow/run?…&inputArguments=%7B%22ExecId%22%3A%22<id>%22%7D`. In Power
   Automate Desktop, give the flow an input variable (text, external name `ExecId`, empty by
   default) and send `execution = %ExecId%` in each report (README, Reporting from Power Automate
   Desktop). The server takes the id only if it is that user's execution of that flow.
2. **`run_ref`** keeps a script's reports together: the first one's pairing is reused.
3. **Unpaired fallback.** With no id, the report goes to the flow's one waiting launch, or to
   nothing. Nothing is ever guessed among several; an unpaired result never moves a run.

A tap is never a result, and nothing launches or retries an automation on its own: sending,
resending, settling a conflict and replaying a journal never open a Run URL.

## Deploying to your Supabase project

Nothing here was run against a real Supabase project; `tests/db/run.sh` runs the files against a
local PostgreSQL 16 with a stand-in for Supabase's roles and `auth.uid()`.

1. **Before.** Take a backup on one device (Settings > Backup). Sync every device you use, so no
   device holds unsent run changes.
2. **See what is installed.** Supabase > SQL Editor > New query:

   ```sql
   select proname, proconfig from pg_proc
     where proname in ('cockpit_put_wrun', 'cockpit_items_wrun_guard', 'cockpit_exec_report', 'cockpit_sync_checks');
   select tgname, tgenabled from pg_trigger where tgname = 'cockpit_items_wrun_guard';
   ```

3. **Run the files, in this order**, each as its own query (paste, Run):
   - `supabase/release-g-runs.sql`, if `cockpit_put_wrun` isn't listed. (Running it again is
     harmless: it now installs Release H's pairing and guard too.)
   - `supabase/release-h.sql`. It runs in one transaction and stops, changing nothing, if
     `cockpit_put_wrun` is missing ("Run supabase/release-g-runs.sql first").
   - From scratch: `supabase-setup.sql`, then these two.
4. **Verify.**

   ```sql
   -- all three: cockpit_put_wrun, cockpit_items_wrun_guard, cockpit_sync_checks
   select proname from pg_proc where proname in ('cockpit_put_wrun', 'cockpit_items_wrun_guard', 'cockpit_sync_checks');
   -- the guard is on: tgenabled = 'O'
   select tgname, tgenabled from pg_trigger where tgname = 'cockpit_items_wrun_guard';
   -- Release H's pairing: true
   select prosrc like '%waiting <> 1%' from pg_proc where proname = 'cockpit_exec_report';
   -- no SECURITY DEFINER function without pg_temp: no rows
   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and coalesce(p.proconfig::text, '') not like '%pg_temp%';
   ```

   (`cockpit_sync_checks()` needs a signed-in user, so it answers "sign in first" in the SQL
   Editor; the app's health check calls it.)
5. **Reload the app on every device** (twice if an old version is cached), then Settings > Health
   check > Run check: **Process run checks ✓ On: run changes are checked by the server**. A run's
   page says **Synced, checked by the server**.
6. **Optional: the id hand-over.** On one flow, add the `ExecId` input variable and the
   `execution` field in its report, tick **Pass the attempt’s id**, launch it once from a run, and
   check the step completes with that attempt (its details show the same id).

### Health check expectations

| Server | Health check |
| --- | --- |
| Both files | ✓ On: run changes are checked by the server |
| `release-g-runs.sql` only | ✓ On (run supabase/release-h.sql to check the guard too) |
| Function without guard (trigger dropped or disabled) | ✗ Partly installed: the function is there but not the guard… |
| Guard without function (stale schema cache, a partial rollback) | ✗ Partly installed: the guard is there but not the function… |
| Neither | ✗ Not installed: the newer edit wins |

### Recovering from a partial deployment

Run `supabase/release-g-runs.sql`, then `supabase/release-h.sql`, again. Both are idempotent and
change no data; together they recreate the function, the op table, the guard trigger (enabled)
and the probe (`tests/db/run.sh`, "a partial install, and its repair"). If the health check still
says the function is missing right after, the schema cache is stale: both files end with
`notify pgrst, 'reload schema'`; run that line alone, or wait a minute. Run changes refused while
the guard was there without the function are kept on their devices as conflicts (Release G);
choose on each run's page once it is fixed.

### Rollback

- `release-h.sql`: run the line between `-- BEGIN ROLLBACK` and `-- END ROLLBACK` at its end
  (`drop function if exists public.cockpit_sync_checks();`). The app goes back to Release G's
  probe. The stricter pairing and guard checks are deliberately kept: they are what
  `supabase-setup.sql` and `release-g-runs.sql` install too, and every copy of the app works with
  them. `search_path` with `pg_temp` needs no undoing.
- Then, to remove the run checks altogether, `release-g-runs.sql`'s rollback (four lines). The
  runs stay, with their revision; the app goes back to newer edit wins.

### Older copies of the app after the migration

- **A Release G copy** works as before against Release H's server. Reports naming no attempt are
  paired less often (only with exactly one launch waiting), so its steps more often wait for a
  confirmation by hand. It never passes `ExecId` (it doesn't know the setting), ignores `passId`,
  and drops it if it rewrites that flow's row (a rename, or a tap, which records when the flow was
  last used): tick it again once every device is updated. Its run page still says just "Synced".
- **A copy from before Release G** can create runs but not change existing ones (refused by the
  guard; it then takes the server's run), as with Release G. Update it.
- **This copy against a Release G-only server** works; its health check says to run
  `release-h.sql`. If `supabase-setup.sql` wasn't re-run either, the server still pairs the
  oldest waiting launch.

## Tests

- `bash tests/db/run.sh` (PostgreSQL 16, throwaway cluster): setup.sql, `release-h.sql` refused
  before `release-g-runs.sql`, the two migrations, `cockpit_exec_report` identical in all three
  files, the guard identical in both migrations, every SECURITY DEFINER function with
  `search_path = public, pg_temp`; the cases (`tests/db/cases.sql`, Release H's pairing, the
  stricter guard, the probe); three concurrent steps (the function twice, two direct upserts); a
  partial install and its repair; the migrations twice in either order; both rollbacks;
  reinstalling.
- `tests/releaseh-sync.spec.js`: one test per finding (above), with `tests/fakesb.js` (now with
  Release H's pairing and `cockpit_sync_checks`; `srv.checksFn = false` is a server without
  `release-h.sql`). Each fails against the app as it was before this checkpoint, but "a finished
  run tidied away… still settles", which guards against over-correcting MED-4.
