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
