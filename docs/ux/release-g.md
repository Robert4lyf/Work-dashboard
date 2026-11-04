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
