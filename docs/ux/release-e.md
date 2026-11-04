# Release E: scheduled work and waiting

Screenshots: `release-e/before-today.png` (the app at `337fdcf`) and `release-e/after-today*.png`,
at 390 × 844 with the same seeded data (`tests/releaseedata.js`: the busy day, plus meetings at
10:30 and 14:00, an untimed training day, a briefing tomorrow at 09:15 and a task waiting on IT
with nothing else to do), at 11:00 local time.

## Four states

| State | Meaning | Where it shows |
| --- | --- | --- |
| Actionable | Something can be started or continued now | Today's tasks; Top 3, the header, Focus |
| Scheduled | Happens on a day, maybe at a time | Scheduled (on Today), Upcoming before its day |
| Waiting | Nothing to do until someone replies | Waiting (on Today), the Waiting Centre |
| Done | Finished | Done today |

A task with several steps, one of them waiting, is still actionable: it stays in Today's tasks,
and its waiting step is also listed under Waiting with the task's name. That's a second view of
the same record, not a copy.

## The scheduled data model

`task.scheduled = { date: 'YYYY-MM-DD', time: 'HH:MM' }`, `time` optional. Only top-level tasks
are scheduled (a meeting is a task; its steps, if any, are its agenda).

- Local calendar values, compared as strings: no `Date` parsing into UTC, so a meeting at 01:30
  on the night the clocks change stays at 01:30.
- Checked on every load (`cleanSched` in `js/schedule.js`, from `fix()` in `js/state.js`): a real
  day (not 30 February), and a real 24-hour time, else no schedule. Tasks without one are
  unchanged, so older records read exactly as before.
- Separate from the deadline (`due`) and from Do later (`start`). Scheduling a task for a later
  day puts it on Upcoming (`start` = the date) exactly as Do later would, keeping `scheduled`;
  the morning's reset brings it back to Today with its schedule. Changing an Upcoming task's day,
  or bringing it to Today, moves its scheduled date with it.
- Nothing completes it but you: a passed time shows "Time passed", an earlier day "<day>: not
  marked done". It stays until marked done, rescheduled or unscheduled.
- Synced, backed up and restored as part of its task's record, like the task's other fields.

## The actionability rules (`js/schedule.js`)

- `actionLeaf(n)`: the step (or the task itself, without steps) that can be worked on now, or
  none. Not finished, not a scheduled task, not waiting on someone; the first such step in order.
- `taskState(q)`: `done`, `scheduled`, `waiting` (no actionable step and at least one waiting),
  `ask` (every step ticked: deciding what's next is still yours to act on) or `actionable`.
- `canAct(q)`: actionable or ask.

They decide the header's next task (a saved place, then Top 3, then list order, each skipping
what can't be acted on; with nothing left it says so, and why), Top 3 (a chosen task that's
scheduled or only waiting is set aside with a line saying so, still chosen, and comes back when
it can be worked on; the picker doesn't offer them), Focus (its picker and default), the task
actions (a scheduled task offers Mark done, Reschedule and back to ordinary work, never Focus; a
task only waiting offers its follow-up or its reply), Today's list and board (the same tasks in
both), carried over (never a scheduled task), attention (a past scheduled task is a reminder,
not an overdue deadline) and Forecast (a scheduled estimate is fixed to its day and never
suggested to move; without an estimate it's listed as unestimated).

## Known limitations

- Sync is newer-edit-wins per record. A task moved between Today and Upcoming on one device
  while edited on another is kept once (the finished copy, else where the newest Today order puts
  it), but the losing copy's edit is lost. Rescheduling offline while another device edits the
  same task: the newer edit wins whole.
- The daily reset's changes are dated midnight: an edit made after midnight elsewhere wins.
- Only tasks are scheduled, not steps; a scheduled task's steps aren't offered as work.
- "Later today" turns to "Time passed" at the next redraw, not on the minute.
- A copy of the app from before this release that changes an Upcoming task's day moves `start`
  but not `scheduled.date`.

## Look: Signal

Replaces Release D's neutral palette (same tokens, new values in `styles.css`). White page, black
ink, one signal yellow (`#ffd400`) for the header, the current tab, Top 3 numbers and the
secondary action; black primary buttons; heavy uppercase section headings under a 4px rule;
square corners and 2px black outlines, no shadows; solid status labels (red overdue, yellow
today, orange waiting); scheduled times set large. Dark mode: the same on `#0a0a0a`, yellow
unchanged. All text pairs checked to WCAG AA in both themes.
