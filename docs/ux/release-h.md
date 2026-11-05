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
| Today's tasks start (px from the top) | 1,701 | 1,445 |
| Page height | 3,823 | 3,343 |
| Taps from the first screen to Today's tasks | scroll ~2 screens | 1 (Tasks ↓) |
| At 320 × 800: Today's tasks start | 2,187 | 1,833 |

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
