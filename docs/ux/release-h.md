# Release H: the final mile

What still stood between the app and an everyday recommendation after Release G, what was
changed, what was measured, and what's left. Release G's notes are `release-g.md`; the sync and
deployment notes for this release are `release-h-sync.md`.

## Checkpoint 0: the truth at the start

Main at `2de1282` (Release G merged). Full suite 438 passed; the PostgreSQL tests 107 checks
passed; Prettier clean.

Release G's remaining issues, checked against the code:

| Issue | Still there? |
| --- | --- |
| Today's tasks begin ~1,700px down a 390px phone on a busy day | Yes: 1,701px (Scenario A) |
| Today is ~3,800px tall with 25 tasks | Yes: 3,823px |
| Heavy-data Today redraws slow | Yes: every redraw replaced the whole view |
| Background-sync redraws slower in Release G | Yes (as measured there) |
| Workflow revision checks need a manual migration | Yes, by design; the user has installed it |
| Other records newer-edit-wins | Yes, by design for tasks and notes |
| Automation reports without an execution id ambiguous | Worse than documented: see `release-h-sync.md` |
| No real-device Android validation | Yes: still outstanding (no device here) |
| Terminology and navigation inconsistent | Yes: twelve navigation defects confirmed |

Two read-only audits ran first: sync and database (with real-PostgreSQL probes) and navigation,
wording and Undo (with probes in the running app). Their confirmed findings are fixed below.

## Checkpoint 1: Today on a phone

Two structures were tried on Scenario A (25 tasks, Top 3, three meetings, four waiting, ten
things needing attention) at 390 × 844:

- **A, previews.** Scheduled shows any meeting whose time went by unrecorded, then the next; the
  rest of the day is a tap away, their times in the folded line ("3 more 15:30, 16:30, Any
  time"). Waiting shows the most urgent; the rest a tap away, the line saying how many of them
  are due a chase ("3 more 2 to chase"). Chases due are also in Needs attention.
- **B, an overview to jump from.** A line at the top: Scheduled 3 ↓, Waiting 4 ↓, Tasks 25 ↓.
  A tap scrolls to that section's bar, with the keyboard (and a screen reader) on its heading.
- **Also tried, and dropped:** leaving the Top 3 out of the list under them. It saved 231px, but
  a Top 3 task without steps could then only be ticked through its ⋯ menu (two taps instead of
  one), and the list's count disagreed with its rows.

Kept: A and B together. A cuts what's in the way; B makes Today's tasks one tap from the first
screen however long the day. Scheduled and Waiting stay sections of their own, with their own
bars and counts. A fold is only used when it hides two or more rows (one row would take nearly
the room of its summary). Open or folded is remembered on the device, like Needs attention. Two
columns (from 1240px) show everything, with no jump line.

| 390 × 844, Scenario A | Release G | Release H |
| --- | ---: | ---: |
| Today's tasks start (px from the top) | 1,701 | 1,446 |
| Page height | 3,823 | 3,568 |
| Taps from the first screen to Today's tasks | scroll ~2 screens | 1 (Tasks ↓) |
| At 320 × 800: Today's tasks start | 2,187 | 1,884 |

(Correction: checkpoint 1's commit message says 3,343px for the page. That was measured with the
dropped Top 3 change still in place; 3,568px is the figure for what was kept. Screenshots:
`release-h/before-*.png` and `release-h/after-*.png`, the same data at 11:00; measurements in
`release-h/*-measure.json`.)

Task discovery, looked at again:

- The filters (All, Due, Started) and Find stay as they are: few, predictable, each with its
  count. All clears a filter; Find's box clears with its ×, and "Show all" when nothing matches.
- **Finished tasks** were out of Find's reach (folded in Done today). Find now opens Done today
  while its words match a finished task, and closes it again after (not remembered as opened).
- Filters apply to the board as to the list; the choice is remembered on the device, and the
  chips always show which is on.

Needs attention: the order is deterministic (failures needing intervention, then work launched
with no word since, overdue, chases due, due today), so a routine deadline never comes above a
failed process or automation. Opening an item acknowledges nothing.

## Checkpoint 2: Today drawn again in place

<!-- perf:start -->
Before, every redraw of Today (a tick, a sync, coming back to it) replaced the whole view: on a
heavy day 13,700 elements read in, laid out and drawn again, whatever had changed.

Now Today's new markup is laid over what's on the page (`patchHTML` in `js/tree.js`; no
framework, the markup is still the one source of what's shown):

- Each task row, and Needs attention, Carried over, Scheduled, Waiting and the folded rest,
  carries a fingerprint of its markup with its length (`data-h`). A part that reads the same as
  one on the page is cut from the new markup before it's read in, and the one on the page is
  kept, untouched. A changed one is replaced whole. Children are matched by task id (or id),
  else by kind in order; never by position alone.
- What's kept keeps the keyboard, a half-typed word (and an Android keyboard's composing on it),
  its selection, open panels, a two-tap confirmation and scroll. A field being typed in is left
  exactly as it is. A kept element that has to move (a row moved up in Reorder) gets the keyboard
  back.
- Another page (another task, or the list from a task) is still drawn from scratch, so nothing of
  one task's page can be carried onto another's. Every other view is drawn as before.
- Tests: a sync that changes nothing leaves every row alone; a renamed task redraws its row
  only; typing survives a sync's redraw with its selection; twelve mixed changes in a row give
  exactly the page a from-scratch draw gives; Reorder keeps the keyboard. Most fail with the
  patch switched off.

Tried and not kept: `content-visibility: hidden` on Today while another tab is open, to keep its
layout. No gain measurable through the noise.

### Measured

`tests/perf/bench.js`, Chromium at 390 × 844 with the CPU slowed ×4 (the phone figure). Main
(Release G) and this branch were run alternately, two rounds each, on a quiet machine; each
round is the median of 5. Both rounds are shown (round 1 / round 2). Busy is 100 tasks; heavy is
300 tasks plus 1,000 finished, 300 articles, 400 runs and 500 executions. Until the next frame is
drawn, ms.

| Heavy | Release G | Release H | Change |
| --- | ---: | ---: | ---: |
| Today redraw (`renderAll`) | 778 / 782 | 107 / 135 | −84% |
| Background sync redraw, nothing changed | 758 / 734 | 116 / 105 | −85% |
| Background sync redraw, one task changed | 778 / 775 | 225 / 258 | −69% |
| Tick a step on Today | 855 / 886 | 323 / 312 | −63% |
| Tab to Today | 730 / 749 | 351 / 442 | −46% |
| App start (store read to first draw) | 1,139 / 982 | 782 / 843 | −22% |
| Cold load to ready | 1,370 / 1,141 | 957 / 986 | −16% |
| Today drawn from scratch | 665 / 708 | 575 / 538 | −19% |
| Tick a step on a task's page | 152 / 169 | 156 / 161 | none |
| Tab to Waiting | 510 / 546 | 440 / 464 | −14% |
| Tab to Command Centre | 347 / 285 | 266 / 295 | none (noise) |
| Search keystroke | 66 / 72 | 71 / 90 | **+5 to +18ms (worse)** |
| `save()` | 132 / 118 | 130 / 140 | none to +12ms |
| Taking in 500 synced rows | 1,012 / 1,004 | 861 / 957 | −5 to −15% |

| Busy | Release G | Release H |
| --- | ---: | ---: |
| Today redraw | 198 / 193 | 39 / 47 |
| Background sync redraw | 210 / 270 | 41 / 40 |
| Tick a step on Today | 236 / 233 | 104 / 107 |
| Tab to Today | 196 / 211 | 125 / 159 |

What this shows, plainly:

- The slowest everyday actions on a heavy day are 63–85% quicker: a tick, a sync's redraw, a
  redraw. The 30% target is met for them.
- Drawing Today from scratch (another task's page and back, a first draw) is only ~20% quicker:
  that's still a full read-in and layout of the view.
- Regressions: a search keystroke is 5–18ms slower at heavy, and `save()` up to 12ms slower in
  one round. Neither path was changed by the redraw work; checkpoints 3 and 4 add to sync
  bookkeeping and Search's way back. Within the run-to-run spread seen before (±20%), but
  reported as measured.
- Still over budget at heavy (100ms at ×4): a tick (~320ms, of which `save()` ~130ms), a tab to
  Today (~350–440ms), Waiting (~450ms) and taking in 500 synced rows (~0.9s). These are
  benchmark figures on an emulated slow CPU, not timings on your phone.
<!-- perf:end -->

## Checkpoint 3: trustworthy sync

Details, guarantees, residual risks and the deployment procedure: `release-h-sync.md`. In short:

- **A report naming no attempt can't complete the wrong run.** It was paired with the oldest
  waiting launch of its automation, even one for another run or one that never ran (Power
  Automate Desktop asks before running; a phone can't run the link at all). Proven on real
  PostgreSQL. Now it's paired only when exactly one launch of that automation is waiting;
  otherwise the step waits for you to confirm it by hand.
- **An explicit attempt id, optional per automation.** Microsoft documents `inputArguments` on
  the Run URL, so "Pass the attempt's id to the flow" adds `ExecId` to the link at the tap. The
  server only takes an id that is yours and that automation's. The PAD side is documented, not
  tested on a real PAD install.
- **Protection is said where it matters.** A process run's page says *Synced, checked by the
  server*; *Saved on this device, not yet synced*; *Conflict: needs your choice*; *Synced, but
  the server's check isn't installed: the newer edit wins* (or only partly installed); *Not
  synced: the last sync failed*. Launch and Try again carry a one-line warning while
  unprotected. Nothing is blocked, offline work included. Health check tells a partial install
  apart from a missing one.
- **Conflicts that lost work silently:** the day's tidy-up cancelling a run begun offline
  elsewhere; a run deleted elsewhere (or by a restore) while it had unsent work here; a failure
  report settling over a success confirmed by hand; attempts set aside by a refused change
  staying set aside. Each is fixed with a test.
- **The database guard** also checks a run's key and id and its size; every SECURITY DEFINER
  function searches `public, pg_temp`. Two direct writes of the same revision are serialised by
  the row lock (tested on real PostgreSQL), so the direct path is compare-and-swap too.
- **Production:** `supabase/release-h.sql` needs running once in the SQL editor (after
  `release-g-runs.sql`, already installed). Until then the app works as in Release G, and the
  health check says what's missing. Nothing was run against a real Supabase project.

## Checkpoint 4: navigation, wording, safer sheets

Twelve navigation defects were confirmed by probing the app (Android back is `history.back()`);
ten are fixed, each with a test in `tests/releaseh4.spec.js`:

- Back returns to where you came from after: a Forecast entry for an Upcoming task (it did
  nothing before); an Upcoming item opened from Waiting or Search (back used to leave the app); a
  process run's "For: task" link and its "Settings: Automations" link; any Search result, not
  only tasks (the query is kept); the crumb up from a step.
- Closing a process run puts the page back where it was, the keyboard on what opened it; back to
  a list puts the keyboard on the row that was opened.
- **A sheet with typed words** asks "Discard what you typed?" on back, Escape or a tap outside
  it, instead of dropping them. Sheets with nothing typed close as before.
- **A reload, or Android discarding the page**, keeps your place (the view, task, run, guide or
  article) for that tab. Opening the app afresh still starts on Today; a deep link wins.
- **Delete on a carried-over task** needs two taps, like Delete everywhere else (Undo stays).

Wording, one term per meaning:

| Was | Now | Why |
| --- | --- | --- |
| Resume (a guide, the saved place) | Continue | Resume is kept for un-pausing: the timer, a paused process |
| Clear (an Inbox item), Drop | Delete | They delete |
| Process the Inbox, n processed | Sort the Inbox, n sorted | "Process" is a kind of thing in this app |
| Take out (Top 3) | Remove from Top 3 | As in a task's actions |
| Response received, Resolved | Reply received | As everywhere else |
| Record a follow-up | Follow up | As its button |
| Later (triage) | Do later | As everywhere else |
| Moved to Tue | On Upcoming until Tue | Not to be read as Scheduled |
| inbox | Inbox | It's the Inbox |

On a task's page the header's Continue (for the saved place, often another task) is no longer
styled as the page's main action. Left as they are: Done on a Scheduled row (Mark done doesn't
fit at 320px; it's labelled "Mark done: name" for a screen reader), Delete vs Remove picture
(they do different things).

Undo was audited under rapid actions, navigation, an incoming sync, deletion and the day's
rollover: any later change (a save, a sync that changes anything, rollover) drops the Undo, so
it can't overwrite newer work. No defect found.

## Checkpoint 5: adversarial QA

Eight reviews, by four independent reviewers working from the code and the running app, each
trying to show the release is wrong: (1) first-time use, (2) daily efficiency, (3) mobile
navigation and touch, (4) visual clarity, (5) sync and data integrity, (6) security and database
permissions, (7) performance and accessibility, (8) unexpected sequences. Every confirmed defect
was fixed with a regression test that fails without the fix (checked by running the tests on the
code before each fix).

Found in this release's own changes, and fixed:

- **High: the step box kept its words** after a step was added, so the next step was saved as
  "Gather figuresDraft" (the in-place redraw kept the field). A field is now kept only while it
  holds what the redraw gives it, or while it's being typed in during a sync.
- **High: Carried over's Keep buttons turned into "undefined"** once that section changed: the
  redraw's own placeholder attribute had the same name as the button's. Renamed.
- Find's opening of Done today was remembered as yours and could stay open.
- A fold's summary lost the keyboard when a sync redrew its section.
- The jump line wrapped onto two lines with Larger text or long counts.
- "Keep the server's" on a run deleted elsewhere, then restored there, left this device without
  a run the server had (only a later full re-read would have repaired it).
- The health check took a replica-only guard trigger (which never fires) for an installed one.
- A process run's failure lines ("Not synced", "not installed") were the same grey as "Synced".

Found in older code, fixed while here:

- A field merely tapped into kept stale words through a sync, and the next key press wrote them
  over the other device's edit.
- A sync's redraw of Search or the Inbox replaced the field under a composing keyboard
  (duplicated letters, in Chromium's emulation).
- With a focus session paused, the header offered to continue another task, then refused.
- Back after the phone turned could put the opened row below the screen.
- The Follow up sheet's two date fields overflowed at 320px.
- The keyboard's search key did nothing in Find and Search (it now puts the keyboard away).
- Wording left over: "inbox" in two places; "Later" on "What's next?" (Later means Upcoming
  elsewhere: now "Not now"); "Pick up where you left off" now says "Saved place", which is what
  it is (a stopped focus session doesn't move it).

Checked and held: rapid ticks, ticks during a sync, renames, moves and deletions elsewhere, list
and board, Reorder, Find typing through syncs (real IME composition via CDP), the two-column
breakpoint both ways, names containing markup and the fingerprint attribute itself, 5,000
character names, memory over 100 in-place redraws (flat), the discard prompt under a sync,
contrast of every new element in light, dark and automatic (lowest 4.64:1), no automatic launch
or retry anywhere, cross-user isolation and the new SQL's permissions, migration order and
rollback.

### Scenarios (390 × 844, Scenario A data)

| Journey | Taps | Note |
| --- | --- | --- |
| A: start the next meaningful action | 2 | Continue (or a Top 3 Focus), Start |
| A: reach Today's tasks | 1 | Tasks ↓ (was ~2 screens of scrolling) |
| B: start, pause, capture, sort it, back to the original | 11 | The right task is offered; 8 using the Inbox row's own Today button |
| C: follow up a waiting item | 2 | Follow up, Save |
| D: next meeting, reschedule, mark done | 6 | Never offered as Focus or the next action |
| E: a failed automation in a process | 1 to the failed step | Recovery by Try again or a confirmation by hand; nothing relaunches by itself |
| F: two devices, the same run | — | Conflict shown with both versions; tested on the fake server and real PostgreSQL |
| G: 300 tasks | — | See the measured table above |
| H: first use, add a task | 4 + typing | Through the Inbox, as designed |

### Test results

- `npx playwright test` (full suite, served on 4173): **476 passed, 0 failed**, no retries
  (Release G ended at 438). One test (`releaseg-sync` "the answer lost…") failed once in a loaded run: a race in
  the test, not the app; fixed in the test.
- `bash tests/db/run.sh` (real PostgreSQL 16): 151 checks passed.
- `npm run format:check`: clean.

## Remaining weaknesses

- **Not tested on a real Android phone.** Everything above is Chromium with phone emulation;
  `release-h-android-checklist.md` lists what to try on yours.
- **`supabase/release-h.sql` isn't installed on your project yet.** Until it is, a report naming
  no attempt is paired as in Release G (the oldest waiting launch), and the health check can't
  see the guard. Steps in `release-h-sync.md`.
- **The PAD side of the attempt id** (`ExecId`) is documented from Microsoft's docs, not tried on
  a real Power Automate Desktop.
- **Heavy days are still over budget** for a tick (~320ms at ×4, ~130 of it saving), switching to
  Today (~350–440ms), Waiting (~450ms) and taking in a big sync (~0.9s). A first draw of Today, or
  coming back to it from a task's page, is still a full draw.
- **Other record types stay newer-edit-wins.** For tasks and notes that's by design; waiting
  items, guide runs, rule effects and Inbox items made for a run change that's refused stay as
  they were made (documented in `release-h-sync.md`).
- Reload keeps your place but not a half-typed draft.
- Minor, seen and left: the jump counts don't follow the Due/Started filter (they count the
  sections); a Today with duplicate task ids (not reachable through sync) would show one row.
