# Release F: mobile clarity, visual refinement and reliability

Screenshots: `release-f/before-*.png` (the app at `dd75f4c`) and `release-f/after-*.png`, with the
same seeded data (Scenario A: the Release E day, so 20 tasks, two failed processes, scheduled
meetings and three waiting items, plus three Top 3 choices and a paused focus session), at
11:00 local time. Phone shots are full-page at 390 × 844; desktop at 1440 × 900. `*-autodark`
is the app following the device with the device in dark mode.

## Today on a phone

Order: what you're on (the header), Needs attention, Top 3, carried over, **Scheduled, Waiting**,
then Today's tasks and the folded rest. Waiting used to come after the whole list. On a wide
screen (from 1240px) the two columns stay as they were: the header, Top 3 and the list on the
left; Needs attention, Scheduled and Waiting down the right. One `drawToday()` builds the
sections and composes them for the layout; nothing is copied.

Where each section starts (Scenario A, px from the top of the page):

| 390 × 844 | Top 3 | Scheduled | Waiting | Today's tasks |
| --- | --- | --- | --- | --- |
| Before | 527 | 809 | 3036 | 1147 |
| After | 473 | 745 | 1048 | 1408 |

Density came from overhead, not from smaller text or targets: the Today title and date share a
line; tighter section bars; one 12px step between sections; a narrow time column on Scheduled
rows; smaller empty states; long names take at most two lines in lists (all of it on the task's
page). The header keeps the next step on its own full-width line, since a side-by-side layout
cut long step names short.

## Colour by meaning

| Colour | Means | Where |
| --- | --- | --- |
| Yellow | What you're on | The header, the current tab |
| Red | Gone wrong, or overdue | Needs attention (failures, overdue work) |
| Turquoise | Your priorities | Top 3 |
| Neutral | Routine | Scheduled, Waiting, Today's tasks, a task's Steps |

A row's own action (Focus, Resume, Follow up) is outlined, so the header's action is the one that
stands out. Status labels (Overdue, Due today, Chase now) keep their colours. Heavy type,
geometric signs and 3px outlines stay.

**Automatic dark mode.** With the app following the device and the device in dark mode, the
header was a purple gradient under near-black type: an old `--grad` in the system-dark block
came after the yellow one and won. It's removed. The browser bar and manifest colours now match
the page (`#f7f3ea`, `#121212`). A test checks the header, section bars, chips, buttons, the tab
bar, a field and its placeholder, the focus ring and a sheet at WCAG AA in all four states:
explicit light and dark, and automatic with the device light or dark.

## Top 3: set-aside choices

`S.top3 = { day, ids, held }`. `ids` holds up to three; `held` (new, optional) holds choices that
have been set aside.

- A chosen task that becomes scheduled, or has nothing left but waiting, is **set aside**. It's
  still chosen, but it holds no place, so another can be chosen. Top 3 names it.
- When it can be worked on again it takes a free place by itself. Nothing is pushed out:
  with all three places taken, Top 3 says it can be worked on again, with **Bring back**,
  which opens the picker to make room.
- One that took a free place keeps it. `settleTop3()` writes this down when the state is saved
  or a sync is taken in, never while drawing. A choice coming back later finds the places
  taken and is offered back.
- The picker lists set-aside choices with **Take out**. Finished ones keep their place for the
  day. A deleted one goes. A new day starts with none.
- `held` syncs as a record of its own (`meta:top3held`). A copy of the app from before this
  release leaves an unknown meta record alone, where it would have rewritten `meta:top3`
  without the field. Two devices choosing at once: the newer choice wins, as before.

## Reorder

The list in Reorder mode is the same as outside it: what can be worked on, and what's done.
Scheduled and waiting tasks stay in their own sections instead of appearing twice.

There is one order underneath, `S.quests`. Moves are made against the tasks listed
(`moveAmong` in `js/today.js`):

- **Up** puts the task just before the listed task above it.
- **Down** puts it just after the listed task below it.
- **Top** puts it just before the first listed task.

Hidden tasks keep their places among the rest. Nothing is dropped or copied. The same moves
give the same order on every device. With A (to do), B (scheduled), C (to do), D (waiting), E:
moving C up gives C A B D E, then C down gives A C B D E (B stays after A). A task's steps, all
of them listed, swap as before.

## Workflow actions bound to their stages

Every stage action on the run page carries the stage it was drawn for (`data-wstage`): Mark
done, Verified, the checks, a decision, Report a problem, Skip, Try again, the automation
confirmation, Follow the guide, Start waiting, Reply received and Launch.

At action time, and again when a Skip, Report-a-problem or retry sheet is answered:

1. The latest run is looked up.
2. Its current stage must be the one drawn, and the action must belong to that stage's type.
3. The run's status must allow it.
4. The step's own needs must be met: checks ticked, a finished guide, a valid choice, the
   confirmation offered, a waiting item.

Otherwise nothing changes: "That step has moved on", and the page redraws. A stale Launch opens
nothing and records nothing.

The rules also hold inside the transition functions, whoever calls them. `completeStage` takes
how the step was done (`hand`, `pick`, `guide`, `auto`, `confirm`, `reply`):

- A verification step needs its checks.
- A decision needs a valid choice.
- A guide step needs its guide finished.
- An automation completes only from its own result or the offered confirmation.
- A waiting step completes only once its item is no longer waiting.
- A failed step only skips (where allowed) or retries.

## Flaky tests

The guide-resume test (`journeys2.spec.js`) and the unfinished-task test (`nextstep.spec.js`)
both lost the last change made before a reload. The tests' reload wrapper was meant to wait for
the store's writes first, but it checked `window.storeDone`. `storeDone` is a top-level `const`,
so it isn't on `window`: the wait never ran. A reload straight after a tap could then drop that
tap's write.

The wrapper (and its copy in `sync.spec.js`) now checks `typeof storeDone`, and a regression test
slows every write to the store and reloads. With writes held for 150ms, copies of the two tests
failed 6 times in 20 before the fix and 0 times in 100 after. The app itself was right.

## Known limitations

- Sync is still newer-edit-wins per record. A stale action is refused against a run already
  updated on this device. Two devices acting on the same step offline, or before either syncs,
  resolve as before: there's no cross-device locking.
- Ack and Add to Inbox on a failed run are run-level, so a stale one applies to the run's current
  failure.
- A chosen task moved to Upcoming or the Inbox drops out of Top 3 (it isn't listed as set aside).
  If it comes back the same day before anything takes its place, it takes its place back.
- After a set-aside choice is replaced and then finished, it's simply done; it doesn't come back
  as a Done row in Top 3.
- In Reorder, Down then Up doesn't always restore the order relative to hidden tasks. Each move
  is relative to the listed neighbour, and hidden tasks keep their own relative order.
- A copy of the app from before this release shows only the three, not the set-aside choices.
  It still keeps them for the newer copies.
