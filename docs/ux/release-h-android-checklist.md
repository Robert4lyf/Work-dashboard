# Release H: checklist for your Android phone

Everything in this release was tested in Chromium with phone emulation (390 × 844, 320 × 800,
360 × 800, 412 × 915, touch, light and dark). That is not the same as your phone: the installed
app, its keyboard, system back and large text haven't been tried on a real device. About ten
minutes, on the installed app (reload it twice first so it's on Release H: Settings shows the
version).

Today
- [ ] The line under the yellow header says Scheduled n ↓, Waiting n ↓, Tasks n ↓. Each tap lands
      on that section's bar, not hidden under anything.
- [ ] Waiting shows its most urgent item; "n more" (with "n to chase") opens the rest. Close the
      app and reopen: it's as you left it, open or folded.
- [ ] Scheduled shows a meeting whose time has passed (if any) and the next one; "n more" lists
      the other times.
- [ ] Tick a step on Today: the row updates straight away; nothing else on the page jumps.
- [ ] Open Find (the magnifier), type a finished task's name: "Done today" opens to show it.
      Typing with the keyboard's suggestions works as usual (no letters lost or reversed).

Typing and sync
- [ ] On a task's page, start typing a new step and wait for a sync (or make a change on another
      device): what you've typed, and the cursor, stay put.
- [ ] Open a sheet (Follow up on a waiting item), type a note, press system back: it asks
      "Discard what you typed?". Back again (or Discard) closes it; Keep editing keeps it.

Back, everywhere
- [ ] Today → a task → back: the list where you left it, the row you opened under your finger.
- [ ] Waiting tab → an item → back: Waiting. Search → any result (a task, an article, a
      process) → back: Search, with your words.
- [ ] A process run → "For: <task>" → back: the run. The run → Settings: Automations → back: the run.
- [ ] Review → Forecast → an Upcoming task → back: Forecast.
- [ ] Switch to another app for a while (long enough for Android to unload this one) and come
      back: you're where you were.

Processes and automations
- [ ] A process run's page says "Synced, checked by the server" (after you've run
      `supabase/release-h.sql`; before that it may say Release G's check is on).
- [ ] Turn on airplane mode and change a step: it says "Saved on this device, not yet synced",
      and then "Synced…" when you're back online.
- [ ] Settings > Health check > Run check: "Process run checks ✓ On".

Look and feel
- [ ] With the phone's text size at its largest, Today's jump line and the "n more" lines are
      readable and nothing overlaps.
- [ ] Dark mode (and automatic, with the phone in dark mode): the new lines are readable.
- [ ] Turn the phone sideways and back: Today keeps its place.
