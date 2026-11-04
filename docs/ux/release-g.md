# Release G: the excellence release

Scenario A (`tests/releasegdata.js`): the busy day. 25 ordinary tasks, a Top 3, three meetings,
four waiting commitments, two failed automations, several overdue tasks and a saved place, at
11:00. Phone figures at 390 × 844 unless stated.

## Baseline (Release F, `89cbc9c`)

Measured, not estimated (`docs/ux/release-g/before-measure.json`):

| | 390 × 844 | 320 × 800 |
| --- | --- | --- |
| Needs attention | 231px tall | 295px |
| Top 3 starts at | 474px | 557px |
| Waiting starts at | 1049px | 1390px |
| Today's tasks start at | 1659px | 2092px |
| A task row, on average | 87px | 95px |
| The list | 2179px (25 rows, 22 segmented bars) | 2379px |
| The page | 4144px | 4777px |
| Top 3 tasks repeated in the list | 3 of 3, unmarked | |

### What stood in the way

- **Today's list was long and repetitive.** Every task with steps carried a full-width segmented
  bar on its own line; on a busy day that's the list's longest part, and it says the same thing
  as "Next: …". Nothing narrowed the list: finding one task meant scrolling or the global search.
- **The Top 3 were in the list twice, unmarked.** Nothing in the list said which tasks were the
  priorities.
- **Needs attention grew with the failures.** Every failure was drawn in full above Top 3, so a bad
  morning pushed everything else down.
- **Process runs could be overwritten between devices.** Newer-edit-wins per record: two devices
  acting on one run before syncing kept only one device's step. Ack and Add to Inbox after a
  failure weren't tied to that failure.
- **Mixed touch targets.** ⋯, chips and section links were 40px, below the 44px target.

## Checkpoint 1: everyday use

- **Rows.** A task's steps as a count ("1/3") at the start of its second line, with the bar kept
  as a 3px line along the row's foot. It's coloured as before (done, next, waiting), so no
  information is lost, and it costs no height. Compared on the rendered page against a
  count-only row: without the line, the rows lost their at-a-glance progress. Rows are 77px on
  average, down from 87px.
- **Top 3 in the list.** They keep their place in the list, marked with their number in the Top 3
  turquoise. They aren't hidden: hiding them would make the list's count and order lie, and
  "where did that task go" is worse than a short repeat.
- **Filter.** All · Due · Started, with counts. Due means overdue or due today, the task or one of
  its steps. Started means a step done or a saved place. The list keeps its order, and the
  records are untouched. The choice is kept on this device. Reorder always lists everything.
  The board shows what the list shows.
- **Find.** A search button beside the chips opens a box. It matches every word typed, in a
  task's name, summary or steps. It keeps its words, caret and keyboard focus through sync
  redraws. "No tasks match" offers Show all.
- **Needs attention.** The count and kinds, the one item that matters most with its action
  (failures first, then overdue, chases due, due today; the same order as the Command
  Centre), then "N more" folded. Open or folded is remembered on this device. Its height no
  longer grows with the number of failures.
- **The daily flow.** Open Today → the header names the next step (a saved place first, then the
  Top 3, then the list) with one action → Focus or Resume → tick → the header and single-task
  mode move to the next step. Reviewed and kept: every Focus and Resume button leads to the same
  place for the same task (Release F's switching prompt covers a paused session elsewhere). No
  timer starts, and no step is ticked, on its own.

At 390 × 844 (`docs/ux/release-g/c1-measure.json`): Needs attention 231 → 196px, Top 3 474 → 440px,
rows 87 → 77px, the list 2179 → 1932px, the page 4144 → 3940px. The list itself starts slightly
lower (1659 → 1701px) because of the filter row. With Due chosen, the list is the 5 tasks due.

## Checkpoint 2: process runs that two devices can't overwrite

Full write-up: `docs/ux/release-g-sync.md` (guarantees, conflicts, migration, rollback, security,
limitations).

- Every process run carries a revision. With `supabase/release-g-runs.sql` installed, runs are
  written through `cockpit_put_wrun`, a compare-and-swap on that revision under a row lock.
  The same change sent twice (a lost answer) is applied once (op ids). A guard trigger stops an
  ordinary write from taking a run back to an older revision.
- A change refused because another device got there first is kept on this device as a conflict.
  The run page shows both sides, with **Keep the server's** or **Apply mine on top**
  (replayed through the same stage rules, never relaunching an automation). The run page
  says **Saved on this device**, **Synced** or **Conflict**.
- Ack and Add to Inbox are tied to the failure they were drawn for. There is one Inbox item per
  failure.
- Without the SQL installed the app works as before (newer edit wins) and Settings > Health
  check says so.
- Tested against a real PostgreSQL 16 (`tests/db/run.sh`, 107 checks), including two truly
  concurrent sessions, and in the browser with a two-device fake (`tests/releaseg-sync.spec.js`).

## Checkpoint 3: interaction

- **Touch:** every control on the main screens reaches at least 44 × 44 CSS px, at 320 and
  390px (it was 40px; 36px for the picker's arrows and Estimate). The small ones get an
  invisible margin of touch, so nothing grows on screen. A test checks every control's touch
  area, and that none covers its neighbour.
- **Undo** on the moves easily made by mistake: Move to inbox, Do later, Schedule, Unschedule,
  Top 3 add / remove / clear, Reply received.
- **Back** from a task opened from Waiting, Forecast, Search, the Command Centre or the Inbox
  returns there, where it was scrolled to, and the crumb names it. Back to Today's list
  returns to the row you left.
- **Drafts:** words typed and left in the Inbox box, a task's step box or the Waiting form come
  back with them (per view and task; never a password).
- **Failures that stay visible:** a failed save on the device says so in a line on every screen
  until a save works (it was one passing message).
- Moving a task to the Inbox keeps its finished steps (they were un-ticked without a word).
  A task under Due says why ("Step overdue"). A step in Needs attention is named with its
  task. Search finds a guide by its steps. The Top 3 picker's Done stays in reach. A task's
  empty summary is one line until written in. The page behind a sheet is inert.

## Checkpoint 4: performance and accessibility

Datasets and bench: `tests/perf/data.js`, `tests/perf/bench.js` (typical 25, busy 100, heavy 300
tasks plus 1,000 finished, 300 articles, 400 runs, 500 executions). Baseline:
`docs/ux/release-g-perf-baseline.md`.

Fixed, each a measured bottleneck:

- **Waiting on Today:** each waiting step's task from one walk of Today, not a search per step.
  This was O(n²): 70ms of every Today redraw at heavy.
- **Start-up** draws the view once, not twice.
- **Names compare** with one shared collator: most of a search keystroke with 300 articles.
- **Record fingerprints** are cached by their written form. Every save fingerprinted every
  record.
- **Find** hides rows in place. Drawing Today again on each keystroke cost 0.5–1.3s at heavy.
- **Folded sections** at Today's foot aren't laid out until near.

Tried and not kept: `content-visibility` on Today's rows (28–38% off a redraw, measured).
Rows drawn in over several frames moved the list under a reader coming back to it.

Accessibility:

- Contrast audited in light, dark and automatic (device light and device dark): clean.
- Every control on the main screens has a name.
- Needs attention is a heading like the other sections; Knowledge and Review have headings for
  screen readers.
- A sheet makes the page behind inert.
- Touch targets as above.
- Reduced motion was already honoured.

## Checkpoint 5: adversarial QA

Eight review passes, by independent reviewers working from the code and the running app:

1. first-time use
2. daily productivity
3. mobile ergonomics
4. visual hierarchy
5. concurrency and state
6. security
7. performance and accessibility
8. adversarial regression

Every confirmed defect was fixed with a regression test (most fail without the fix; checked
where practical). They're listed in the commit messages. The main ones:

- A filter or Find words left over from a fuller day stayed applied with no control on screen.
- Find drew its own box again on each keystroke, which breaks an Android keyboard's composing
  (emulated) and was slow at heavy.
- Drafts were lost going back to Search; the Inbox draft depended on the open task.
- A stale way back after a task was removed.
- Clear's Undo was hidden under the picker.
- A summary was cut off after leaving its box.
- The storage line was cleared by an unrelated write.
- Process-run sync (concurrency and security review, all fixed, each with a regression test;
  details in `release-g-sync.md`):
  - A late report from an older automation attempt could complete the newer one. A report
    without an attempt id now goes to the oldest waiting launch, and attempts a step stopped
    waiting for are set aside.
  - Failure ids collided across devices; they're now unique.
  - A run changed back while its write was in flight stayed different from the server's.
  - One run the server refused (too large in bytes, or out of range) blocked all sync. It's now
    parked and shown, and the rest syncs.
  - A tidy-delete lost the revision.
  - A restored backup was dropped silently for a run changed elsewhere.
  - A base-0 settle, the journal trim, and the conflict cap could each drop a change without
    a trace.
  - Fallback mode with the guard installed lost run changes.
  - The new function has an hourly limit, and `search_path` includes `pg_temp`.

## Remaining weaknesses

Not a 10/10: these are what a demanding daily user would still notice.

- **Today is still long on a busy day.** 3,800px at 390 × 844 with 25 tasks. The filter and Find
  make it quicker to narrow, but All still lists everything. Needs attention, Top 3 and
  Waiting each repeat a task or two that's also in the list (on purpose, so nothing hides).
- **Redraws are whole-view.** A tick redraws all of Today. It's fine at 25–100 tasks; at 300 it's
  still several hundred ms on a slow phone (see the performance table). Patching single rows
  is the next step, and the riskiest.
- **The sync guarantees hold only with the migration installed**, and only for process runs.
  Tasks, Inbox items and the rest are still newer-edit-wins per record. Conflicts live on the
  device that made them.
- **Not measured on a real phone.** Everything here is Chromium with mobile emulation and CPU
  throttling. The Android keyboard (IME) behaviour of Find was emulated over CDP, not
  typed on a device. No human usability test was run: the "first-time use" findings are a
  reviewer's walkthrough.
- **Tap counts for the basic journeys are unchanged.** Capture → Today is still 4 taps, through
  the Inbox. A task's Waiting is reached from its page, not from its ⋯. Processes still live
  under a chip in Knowledge.
- **App-wide terms still vary** in places: "Continue" vs "Resume" for a paused run; "Clear" vs
  "Delete".
