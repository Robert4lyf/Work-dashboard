# Release G: performance baseline

Measured on `main` at 89cbc9c (Release F). Nothing in `js/` was changed for this. The tables at the end
come from `tests/perf/bench.js` over the four datasets in `tests/perf/data.js`. There were two full
runs, and each cell is the lower of their two medians of 5. The machine was shared and busy, with a
load average around 15 on 4 cores, so the lower median is the one less slowed by other work. The **x4 CPU throttle
figure is the phone figure**: the calibration loop at the bottom of each table reads about 4x slower
there, which is roughly a mid-range Android phone against this desktop CPU.

## Headline

- **typical** (25 tasks): everything is fast. The only interaction near a budget is the first tick of a
  session (see "AudioContext" below).
- **busy** (100 tasks): it works, but it is already sluggish on a phone. A tick on Today takes about
  **165 ms** and `renderAll()` about **144 ms**, about 3x the 50 ms budget. `save()` takes about
  **40 ms** (55 ms with its IndexedDB write).
- **heavy** (300 tasks on Today plus a lot of history): **not usable on a phone without fixes**. A tick
  takes about **0.8 s** and a Today redraw or background sync redraw about **0.5–0.6 s**. Going back
  to the Today tab takes about **0.5 s**, the Waiting tab about **0.3 s** and taking in a 500-row sync
  about **0.9 s**. The app takes about **0.9 s** to start after its scripts have loaded.
- **extreme** (heavy x2) roughly doubles all of that (a tick takes about 1.4 s, a cold load about
  2.3 s). Scrolling Today then has long tasks: 26 of them, about 2 s in total, over 24,000 px.
- Memory is not a problem: the JS heap is 3–8 MB after GC. **DOM size is the problem.** At heavy,
  Today alone has 13,400 elements and 735 KB of HTML, and the whole page has 24,000 elements.

## What actually costs time (busy and heavy)

Evidence is in the call-count and profile tables under the generated section. Numbers below are x4
(phone) unless marked x1.

| Suspect | Verdict | Evidence |
|---|---|---|
| Repeated full `renderAll()` on every change | **Confirmed: the main cost** | A tick, a save from a sheet and a background sync all redraw the whole of Today. At heavy, `renderAll()` takes 718 ms, but only 126 ms when Today's `innerHTML` write is skipped. **About 85% of the cost is putting 735 KB of HTML into the page, then the style and layout of 13,400 elements.** |
| innerHTML rebuilds of whole views | **Confirmed, same cause** | Today's HTML at heavy: Waiting section 186 KB (3,085 elements), task list 273 KB (5,092), "More" 108 KB, carried-over 76 KB, Needs attention 71 KB. About 255 KB of it sits inside folded `<details>` that nobody is looking at. There are 916 inline SVG icons (one tick, chevron or ⋯ per row). |
| `find()` / `taskState()` per row, O(n²) | **`find` confirmed, `taskState` not** | `todayWaiting()` (js/schedule.js:177) calls `find()` once per waiting step, which is a full tree walk each time: **283 calls into `find`, 243,844 counting its recursion, per Today render at heavy**. Its sort comparator also recomputes `waitBucket()` (with `today()` and `shift()` date parsing) on every comparison. It takes 73 ms; with an id map and the bucket ranked once, 2.3 ms. `taskState` is called 886 times per render for 3.5 ms (x1): not worth touching. |
| `top3State()` per row | **Refuted** | 1–3 calls per render, under 1 ms. |
| `toRecords(S)` on every `save()` (in `markDirty`) | **Confirmed, but the cost is hashing, not `toRecords`** | `toRecords` costs 11 ms at heavy. `markDirty` costs 94–126 ms because it fingerprints every record (3,779 at heavy) through `canon()`, `JSON.stringify` and FNV on every save. Profile: `hashOf` + `canon` + markDirty's loop are about 45% of a save. |
| `JSON.stringify` of the whole state in `persistLocal` | **Confirmed, moderate** | `stateJSON()` takes 45 ms at heavy (1.7 MB). The IndexedDB `put` of that string costs about 7 ms of main thread per save (x1). The sync bookkeeping (300 KB) is stringified and written **twice per save**: once with the state in `persistLocal`, and again by `markDirty` → `saveSyncState`. |
| Forecast / Insights recomputation | **Refuted** | `renderForecast` takes 8.5 ms and `renderInsights` 5.8 ms (x1, heavy). Those tabs take 67–72 ms at heavy x4, within budget, and most of that is layout of the (big) document, not their own maths. |
| *(found)* Cold start draws Today twice | **Confirmed** | `start()` (js/events.js:1032) calls `renderAll()`, then `go(view)` renders the header and the view again. At heavy x1: renderToday 214 ms, then 117 ms more (plus 215 ms in `go`, mostly layout). That is about half of the 0.9 s app-start figure at x4. |
| *(found)* `byName` builds a collator per comparison | **Confirmed** | `a.localeCompare(b, undefined, {…options})` (js/knowledge.js:11) creates an `Intl` collator on every call. In a search keystroke at heavy, `byName` is **80% of the time**. Sorting 300 article titles takes 34.7 ms; with one shared `Intl.Collator`, 0.9 ms, in the same order. Also used for Knowledge, Processes, flows and links. |
| *(found)* Tab switches pay for the big document | **Confirmed, a symptom** | `go()` forces layout (`getBoundingClientRect` on the tab, then `fadeTabs`' `scrollWidth`). At heavy that is 50–110 ms (x1) of style and layout, mostly restyling the hidden 13,400-element Today. Shrinking Today fixes it; removing the forced read would only move it to the next frame. |
| *(found)* First tick of a session creates an AudioContext | **Minor** | `beep()` creates the `AudioContext` on the first gain: 45–175 ms once, inside the tick (headless, so possibly worse than on a phone). |

Scrolling Today is smooth up to heavy: at x4 there were 3 long tasks totalling 164–199 ms and the worst
frame was 50–83 ms. It degrades at extreme.

## Budgets (x4 throttled phone figure)

| Operation | busy | heavy | Over now (x4) |
|---|---:|---:|---|
| Cold load to `appReady` | ≤ 1.0 s | ≤ 1.5 s | extreme only (heavy 1.17 s is within) |
| App start (store read → first draw) | ≤ 400 ms | ≤ 700 ms | heavy 906 ms, extreme |
| Today interaction redraw (tick, `renderAll`) | ≤ 50 ms | ≤ 100 ms | busy (144–165 ms), heavy (600–800 ms) |
| Background sync redraw | ≤ 50 ms | ≤ 100 ms | busy 144 ms, heavy 520 ms |
| Tab switch | ≤ 150 ms | ≤ 150 ms | heavy: Today 528, Waiting 318, Command Centre 195, Processes 167 |
| Search keystroke to results | ≤ 50 ms | ≤ 100 ms | extreme only |
| `save()`, synchronous part | ≤ 30 ms | ≤ 50 ms | busy 40 ms, heavy 131 ms |
| `save()` including the IndexedDB write | ≤ 50 ms | ≤ 100 ms | busy 55 ms, heavy 179 ms |
| `applyRows`, 500 incoming rows | ≤ 300 ms | ≤ 500 ms | heavy 867 ms |
| Long tasks while scrolling Today | 0 | 0 > 100 ms | extreme only |

The generated tables mark every cell over these budgets in bold.

## Recommended optimisations (not implemented)

Ranked by value for risk. The gains are measured in prototypes: the page's functions were patched in a
scratch run, at heavy x4, and nothing in `js/` was changed.

1. **`todayWaiting()`: look up each step's task through a map, and rank buckets before sorting**
   (js/schedule.js:177; nobody else is editing this file). Build `id → task` once per call, and compute
   `waitBucket` once per item rather than in the comparator. **73 ms → 2.3 ms per Today render at
   heavy** (about 10% of `renderAll`, and the same on every tick and sync redraw). The output is
   identical, so the risk is very low.
2. **Draw Today once at start** (js/events.js `start()`): `go(view)` already draws the header and the
   view, so the `renderAll()` before it only needs its other parts (`syncRinging`, `renderZen`), or
   `go` could be told not to redraw. That saves one full Today render at start: **about 0.4–0.5 s of
   the 0.9 s app start at heavy x4** (about 120–210 ms x1). The risk is low. The `finishTimer` branch
   and a restored Knowledge draft (`view = 'knowledge'`) both still end in `go(view)`.
3. **One shared `Intl.Collator` for `byName`** (js/knowledge.js:11): `const coll = new
   Intl.Collator(undefined, { sensitivity: 'base', numeric: true })`, then `coll.compare(a, b) || …`.
   The ordering is identical (checked on all 300 titles). Sorting goes from **34.7 ms → 0.9 ms**, so a
   search keystroke at heavy should go from about 88 ms to about 20 ms. Knowledge and Processes sort
   through it too. There is no risk.
4. **Memoise record fingerprints in `recHash`**, and **write the sync bookkeeping once per save**
   (js/pics.js `recHash`, js/records.js `markDirty`, js/state.js `save`). Keep `key → { json, hash }`,
   where `json` is the native `JSON.stringify` of the record. If that string is unchanged, the hash is
   too, so `canon()` and FNV are skipped. The fingerprints themselves stay exactly the same, so
   nothing is re-sent. **markDirty 126 ms → 41–52 ms at heavy** (about 34 → 12 ms at busy). Inside
   `save()`, letting `persistLocal` write the bookkeeping instead of `markDirty` writing it again
   saves another 18 ms. Together that takes save from about 140 ms to roughly 100 ms at heavy, and
   applyRows and the daily reset gain too. The risk is low to medium: it holds about 1.7 MB more
   memory at heavy, and the ordering in `save()` must keep "not saved here: not marked as synced"
   (with IndexedDB, `persistLocal` always reports success, so only the localStorage path needs care).
5. **Make Today's DOM smaller** (js/today.js and styles.css, so coordinate with the people editing
   them). This is the biggest lever, and three steps can land separately:
   - `content-visibility: auto; contain-intrinsic-size: auto 64px` on Today's rows and sections. CSS
     only. In the prototype, **`renderAll` went from 822 ms to 309 ms (−60%) at heavy**, because
     layout is skipped off-screen. Check scroll restore, `scrollIntoView` to a row and the
     two-column layout.
   - Don't render the bodies of folded `<details>` (Needs attention list, carried-over, Also
     waiting, Upcoming, repeats, flows) until they are opened. That is about 255 KB and about 5,000
     elements at heavy. Medium risk: tests rely on folded contents being in the DOM (see `unfold` in
     tests/fixtures.js), so it needs a toggle handler that renders on open, and test changes.
   - Share the row icons (one `<svg><symbol>` with `<use>`, or a CSS mask) instead of 916 inline SVGs.

   Expected: a Today redraw at heavy of roughly 250–300 ms after 1 and 5. **busy then meets its
   50 ms budget, or comes close.**
6. **Later, and higher risk: redraw incrementally after a tick.** Patch the ticked row, its task's
   step bar, Top 3 and the header, instead of redrawing all of Today. Also consider running
   `markDirty` when idle (flushed before any push, pull or `visibilitychange`). This is the only way
   to get **heavy's** tick under 100 ms on a phone. Leave it until 1–5 have landed and been
   re-measured.

The app's own limits already keep some lists in check: 150 executions, 120 finished workflow runs,
120 days of log and 90 days of rule log. The heavy dataset's 500 executions and 400 runs become 150
and 216 on load. Those limits matter. Raising them would make Command Centre and `applyRows` slower.

## Rerunning

```sh
node tests/perf/bench.js                  # everything: 4 sizes, x1 and x4, 5 runs, profiles (about 8 min)
node tests/perf/bench.js --sizes=busy,heavy --throttle=4 --runs=3 --no-profile --no-instrument
node tests/perf/bench.js --json=/tmp/perf.json   # also the raw results, every run
node tests/perf/bench.js --from-json=/tmp/a.json,/tmp/b.json   # report again from saved runs (lowest median per cell)
```

- The bench serves this checkout on port 4231 (or the next free one; `--port=` sets it) with a small
  built-in static server, and uses Chromium at /opt/pw-browsers/chromium with the pinned Playwright
  from node_modules (this checkout's, or the main checkout's).
- Requests to anything but localhost are refused by the browser's resolver, so the Supabase library
  doesn't load and sync is off. Request interception isn't used: it held every script up on a round
  trip to Node and swamped the load figures.
- The service worker is blocked. Scripts are cacheable, as the service worker caches them on a phone.
- Each dataset goes in as saved data, and the device is made to look fully synced: every record's
  fingerprint is known and nothing is dirty, as on the user's phone.
- The bench rewrites only the part of this file between the `bench:start` and `bench:end` markers.
- Use the datasets in a Playwright test with `app.setState(require('./perf/data').datasets.busy)`.
- **Noise.** The machine was shared with other sessions running test suites. Unthrottled medians at
  heavy moved by up to about 1.5x between runs, so compare x4 figures, from runs made back to back.
  The calibration row shows how loaded the CPU was.

## Generated results

<!-- bench:start (generated by tests/perf/bench.js; edit outside the markers) -->

Generated 2026-11-04T19:07:30.170Z + 2026-11-04T18:55:07.495Z (lowest of 2 runs' medians) on Intel(R) Xeon(R) Processor @ 2.10GHz x4, Chromium 153.0.8010.12, viewport 390x844, commit 89cbc9c.
UI rows: the synchronous JS plus a forced style and layout (getBoundingClientRect), so frame-wait noise is left out; paint is not included (the raw JSON also has `frame`, until the next frame was drawn). Bold: over the budget for that size (throttled run only).

### Unthrottled (desktop CPU)

| Operation (median of 5, ms) | typical | busy | heavy | extreme |
|---|---:|---:|---:|---:|
| Cold load to appReady | 55.3 | 103.2 | 529.6 | 547.2 |
|   of which: scripts loaded (DOMContentLoaded) | 26.9 | 30.6 | 90.2 | 65 |
|   of which: app start (store read, norm, first draw) | 29.5 | 66.5 | 439.4 | 482.2 |
| renderAll() on Today | 9.4 | 27.5 | 173.5 | 255.4 |
| Tick a step (from Today) | 15.2 | 39.5 | 232.3 | 309.9 |
| Tick a step (task's page) | 6.5 | 16 | 46.5 | 68.9 |
| Background redraw inBackground(renderAll) | 9.5 | 25.4 | 245.1 | 239.4 |
| Tab: Today (from Inbox) | 7.2 | 27.9 | 204.7 | 234.3 |
| Tab: Inbox | 2.6 | 5.6 | 35.2 | 42.4 |
| Tab: Knowledge (Reference) | 2.5 | 5.8 | 20.9 | 29.4 |
| Tab: Knowledge (Processes) | 4.4 | 11.1 | 49.2 | 62.6 |
| Tab: Review (Week) | 2.8 | 4.9 | 20.6 | 33.7 |
| Tab: Review (Forecast) | 5.2 | 5.6 | 18 | 28.3 |
| Tab: Review (Insights) | 5.4 | 7.1 | 19.3 | 29.6 |
| Tab: History | 2.8 | 8 | 17.7 | 30.4 |
| Tab: Command Centre go('ops') | 4.8 | 13.5 | 52 | 89.8 |
| Tab: Waiting go('waiting') | 3.5 | 13.2 | 109.8 | 139.2 |
| Open search | 3.8 | 7.8 | 21.1 | 29.3 |
| Search keystroke to results | 5.3 | 11.2 | 29.3 | 28.1 |
| save() (sync part) | 3.2 | 9.5 | 38.2 | 55.6 |
| save() incl. IndexedDB write | 4.8 | 11.7 | 49.1 | 64.7 |
| toRecords(S) | 0.2 | 0.5 | 1.3 | 2 |
| markDirty() | 1.8 | 6 | 23.2 | 29.5 |
| stateJSON() (JSON.stringify of S) | 0.5 | 2.1 | 11.5 | 17.3 |
| applyRows, 500 incoming rows | 16 | 47.7 | 219.7 | 373.7 |
| JS heap after GC, MB | 3.1 | 3.9 | 5.8 | 7.9 |
| DOM nodes (page / Today) | 1496 / 821 | 5836 / 3473 | 24430 / 13421 | 47297 / 26189 |
| Today HTML, KB | 44.1 | 187.5 | 734.8 | 1433.2 |
| Scroll Today: long tasks (count / ms) | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Scroll Today: worst frame, ms | 17 | 33 | 17 | 17 |
| Saved state JSON, KB | 92.8 | 493.7 | 1705.9 | 3103.9 |
| Sync bookkeeping JSON, KB | 18.2 | 77.3 | 299.9 | 575.5 |
| Records (sync rows) | 245 | 1023 | 3779 | 7087 |
| Calibration loop, ms | 6.1 | 6.5 | 12.8 | 5.4 |

### CPU throttled x4 (phone figure)

| Operation (median of 5, ms) | typical | busy | heavy | extreme |
|---|---:|---:|---:|---:|
| Cold load to appReady | 250.6 | 375.6 | 1075.2 | **2332.8** (>1500) |
|   of which: scripts loaded (DOMContentLoaded) | 109.3 | 116.8 | 158.7 | 167.7 |
|   of which: app start (store read, norm, first draw) | 125.5 | 252.4 | **905.6** (>700) | **2092.8** (>700) |
| renderAll() on Today | 49 | **144.4** (>50) | **598.7** (>100) | **1219.7** (>100) |
| Tick a step (from Today) | **63.7** (>50) | **164.5** (>50) | **794.9** (>100) | **1403.6** (>100) |
| Tick a step (task's page) | 32.9 | **69.5** (>50) | **162.4** (>100) | **314.6** (>100) |
| Background redraw inBackground(renderAll) | **50.6** (>50) | **144.2** (>50) | **519.9** (>100) | **1284.3** (>100) |
| Tab: Today (from Inbox) | 39.4 | 118 | **528.4** (>150) | **1059.6** (>150) |
| Tab: Inbox | 13.1 | 24.3 | 102.3 | **211.4** (>150) |
| Tab: Knowledge (Reference) | 11.6 | 24.8 | 73.9 | **152** (>150) |
| Tab: Knowledge (Processes) | 17.5 | 45.8 | **166.5** (>150) | **291.8** (>150) |
| Tab: Review (Week) | 12.4 | 30.7 | 86.5 | **164.6** (>150) |
| Tab: Review (Forecast) | 17.3 | 30.5 | 67.3 | **161.9** (>150) |
| Tab: Review (Insights) | 20.7 | 32.3 | 72.2 | **159.3** (>150) |
| Tab: History | 14.6 | 27.4 | 61.7 | **163** (>150) |
| Tab: Command Centre go('ops') | 19.5 | 53.5 | **194.6** (>150) | **549.1** (>150) |
| Tab: Waiting go('waiting') | 19.1 | 53.5 | **318.1** (>150) | **780.9** (>150) |
| Open search | 14.3 | 23.6 | 69.3 | **156** (>150) |
| Search keystroke to results | 20.8 | 29.4 | 88.5 | **152.1** (>100) |
| save() (sync part) | 12 | **39.6** (>30) | **130.5** (>50) | **317.1** (>50) |
| save() incl. IndexedDB write | 15.1 | **54.6** (>50) | **178.5** (>100) | **329.4** (>100) |
| toRecords(S) | 0.9 | 2.1 | 7.7 | 11.1 |
| markDirty() | 7 | **31** (>20) | **94** (>40) | **181.3** (>40) |
| stateJSON() (JSON.stringify of S) | 1.9 | 9.5 | **45.1** (>20) | **66.1** (>20) |
| applyRows, 500 incoming rows | 65.9 | 244.1 | **867** (>500) | **2006** (>500) |
| JS heap after GC, MB | 3.2 | 3.9 | 5.8 | 7.9 |
| DOM nodes (page / Today) | 1496 / 821 | 5836 / 3473 | 24430 / 13421 | 47297 / 26189 |
| Today HTML, KB | 44.1 | 187.5 | 734.8 | 1433.2 |
| Scroll Today: long tasks (count / ms) | 0 / 0 | 0 / 0 | 3 / 164 | 26 / 1949 |
| Scroll Today: worst frame, ms | 17 | 17 | 50 | 117 |
| Saved state JSON, KB | 92.8 | 493.7 | 1705.9 | 3103.9 |
| Sync bookkeeping JSON, KB | 18.2 | 77.3 | 300 | 575.5 |
| Records (sync rows) | 245 | 1023 | 3779 | 7087 |
| Calibration loop, ms | 23.5 | 26.2 | 27.5 | 26.5 |

### Dataset sizes (after the app's own pruning on load)

| | typical | busy | heavy | extreme |
|---|---:|---:|---:|---:|
| stateJSON | 95069 | 505542 | 1746828 | 3178346 |
| syncJSON | 18626 | 79204 | 307145 | 589313 |
| records | 245 | 1023 | 3779 | 7087 |
| quests | 25 | 100 | 300 | 600 |
| steps | 100 | 405 | 1454 | 2922 |
| log | 60 | 250 | 1000 | 2000 |
| kb | 15 | 60 | 300 | 600 |
| workflows | 4 | 15 | 60 | 120 |
| wruns | 10 | 80 | 216 | 336 |
| execs | 20 | 100 | 150 | 150 |
| follows | 8 | 60 | 400 | 800 |
| inbox | 7 | 23 | 120 | 240 |
| waiting | 6 | 40 | 400 | 800 |

### Call counts (one run of each operation, unthrottled; calls (with recursive ones) / inclusive ms, timing inflated by the wrapping)

**busy**

| Function | renderAll | tick_today | save | tab_ops | tab_waiting | tab_insights |
|---|---:|---:|---:|---:|---:|---:|
| (operation total ms) | 24.3 | 70.9 | 31.3 | 46.2 | 13.3 | 15.4 |
| find | 32 (6406) / 3.4 | 36 (6472) / 1 |  | 10 (1641) / 1.5 | 1 / 0 | 1 / 0 |
| taskState | 231 / 0.8 | 234 / 0.8 | 3 / 0 | 8 / 0.1 |  |  |
| top3State | 1 / 0 | 2 / 0 | 1 / 0 | 1 / 0.1 |  |  |
| settleTop3 |  | 1 / 0 | 1 / 0 |  |  |  |
| isDone | 6521 / 1.4 | 8868 / 2.5 | 12 / 0 | 7692 / 3.9 | 1196 / 0.2 | 1156 / 0.2 |
| stepsDone | 104 / 0 | 404 / 0.1 |  |  |  |  |
| nextLeaf | 469 / 0.3 | 472 / 0.4 | 3 / 0 | 8 / 0 |  |  |
| actionLeaf | 214 / 0.5 | 217 / 0.5 | 3 / 0 | 8 / 0.1 |  |  |
| waitingSteps | 190 / 0.5 | 190 / 0.7 |  |  |  |  |
| snapshot |  | 2 / 1.6 |  |  |  |  |
| toRecords |  | 1 / 0.6 | 1 / 0.9 |  |  |  |
| markDirty |  | 1 / 11.6 | 1 / 19.6 |  |  |  |
| recHash |  | 1024 / 7.5 | 1025 / 6.1 |  |  |  |
| hashOf |  | 1024 / 7.4 | 1025 / 5.9 |  |  |  |
| stateJSON |  | 1 / 3.2 | 1 / 2.4 |  |  |  |
| persistLocal |  | 1 / 6.3 | 1 / 11.1 |  |  |  |
| attentionItems | 1 / 1.7 | 1 / 2.1 |  | 1 / 4.4 |  |  |
| dueSoon | 1 / 0.4 | 1 / 0.3 |  |  |  |  |
| renderHeader | 1 / 0.5 | 1 / 2.1 |  | 1 / 1.2 | 1 / 0.5 | 1 / 0.4 |
| renderToday | 1 / 23.4 | 1 / 26 |  |  |  |  |
| renderTop3 | 1 / 0.3 | 1 / 0.5 |  |  |  |  |
| renderAttention | 1 / 1.8 | 1 / 2.1 |  |  |  |  |
| renderScheduledToday | 1 / 0.1 | 1 / 0 |  |  |  |  |
| renderWaitingToday | 1 / 4.2 | 1 / 2 |  |  |  |  |
| setHTML | 1 / 12.3 | 1 / 16.7 |  | 1 / 1.6 | 1 / 1.2 | 1 / 0.9 |

**heavy**

| Function | renderAll | tick_today | save | tab_ops | tab_waiting | tab_insights |
|---|---:|---:|---:|---:|---:|---:|
| (operation total ms) | 139.5 | 201.5 | 58 | 99 | 105.9 | 39.5 |
| find | 283 (243844) / 31.7 | 287 (243912) / 22.1 |  | 102 (77752) / 8 |  |  |
| taskState | 886 / 5.6 | 889 / 14.1 | 3 / 0 | 21 / 0.2 | 3 / 0 | 3 / 0 |
| top3State | 2 / 0 | 3 / 0.1 | 1 / 0 | 2 / 0.1 | 1 / 0 | 1 / 0 |
| settleTop3 |  | 1 / 0 | 1 / 0.1 |  |  |  |
| isDone | 22445 / 14.5 | 30429 / 8.9 | 12 / 0 | 26693 / 10.1 | 4157 / 0.4 | 3997 / 1 |
| stepsDone | 379 / 0.1 | 1319 / 2.2 |  | 1 / 0 |  |  |
| nextLeaf | 1610 / 1.2 | 1613 / 1.6 | 3 / 0 | 21 / 0.1 | 4 / 0 | 4 / 0 |
| actionLeaf | 831 / 3.9 | 834 / 6.2 | 3 / 0 | 21 / 0.2 | 4 / 0 | 4 / 0 |
| waitingSteps | 598 / 1.9 | 598 / 0.6 |  | 1 / 0 |  |  |
| snapshot |  | 2 / 3.4 |  |  |  |  |
| toRecords |  | 1 / 3.1 | 1 / 1.2 |  |  |  |
| markDirty |  | 1 / 50.6 | 1 / 34.2 |  |  |  |
| recHash |  | 3780 / 38.9 | 3781 / 27.4 |  |  |  |
| hashOf |  | 3780 / 37.4 | 3781 / 24 |  |  |  |
| stateJSON |  | 1 / 10.1 | 1 / 15.1 |  |  |  |
| persistLocal |  | 1 / 17.7 | 1 / 22.7 |  |  |  |
| attentionItems | 1 / 5.7 | 1 / 8.3 |  | 1 / 8.4 |  |  |
| dueSoon | 1 / 8.8 | 1 / 1 |  |  |  |  |
| renderHeader | 1 / 1.2 | 1 / 0.6 |  | 1 / 1.5 | 1 / 0.6 | 1 / 0.9 |
| renderToday | 1 / 138 | 1 / 116.4 |  |  |  |  |
| renderTop3 | 1 / 1.2 | 1 / 6.9 |  |  |  |  |
| renderAttention | 1 / 5.9 | 1 / 8.5 |  |  |  |  |
| renderScheduledToday | 1 / 0 | 1 / 0 |  |  |  |  |
| renderWaitingToday | 1 / 46.2 | 1 / 30.2 |  |  |  |  |
| setHTML | 1 / 62.1 | 1 / 48 |  | 1 / 2.4 | 1 / 22.6 | 1 / 1.7 |

### Hot functions (CDP sampling profile, unthrottled; ms and % of the operation's JS)

<details><summary>busy / cold_load: 136.2 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| getBoundingClientRect | 39.6 | 29 | (anonymous) js/events.js:1050 | 109.6 | 80 |
| setHTML js/tree.js:418 | 22.5 | 16 | start js/events.js:1003 | 108.8 | 80 |
| (garbage collector) | 19 | 14 | go js/events.js:40 | 65 | 48 |
| find js/tree.js:21 | 5.5 | 4 | renderView js/events.js:12 | 51.5 | 38 |
| (anonymous) js/state.js:262 | 4.5 | 3 | renderToday js/today.js:178 | 51.4 | 38 |
| stepBar js/today.js:57 | 2.8 | 2 | drawToday js/today.js:209 | 51.3 | 38 |
| (anonymous) js/schedule.js:184 | 2.6 | 2 | getBoundingClientRect | 39.6 | 29 |
| today js/state.js:23 | 2.2 | 2 | renderAll js/events.js:6 | 30.2 | 22 |
| querySelector | 2 | 1 | setHTML js/tree.js:418 | 22.5 | 16 |
| load js/state.js:426 | 2 | 1 | (garbage collector) | 19 | 14 |
| (anonymous) | 1.8 | 1 | load js/state.js:426 | 12.1 | 9 |
| renderScheduledToday js/schedule.js:159 | 1.8 | 1 | renderWaitingToday js/schedule.js:188 | 11.3 | 8 |
| execRun js/ops.js:71 | 1.6 | 1 | norm js/state.js:210 | 10.1 | 7 |
| (anonymous) js/ops.js:73 | 1.5 | 1 | todayWaiting js/schedule.js:177 | 8.9 | 7 |

</details>

<details><summary>busy / renderAll: 61.7 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| setHTML js/tree.js:418 | 32.8 | 53 | renderAll js/events.js:6 | 61.6 | 100 |
| carriedRows js/today.js:338 | 13.4 | 22 | renderToday js/today.js:178 | 60.7 | 98 |
| openWaiting js/waiting.js:11 | 9 | 15 | renderView js/events.js:12 | 60.7 | 98 |
| shift js/state.js:24 | 1.6 | 3 | drawToday js/today.js:209 | 60.6 | 98 |
| daysBetween js/state.js:404 | 0.6 | 1 | setHTML js/tree.js:418 | 32.8 | 53 |
| w js/tree.js:175 | 0.5 | 1 | carriedRows js/today.js:338 | 14.1 | 23 |
| list js/today.js:143 | 0.5 | 1 | renderCarried js/today.js:330 | 14.1 | 23 |
| niceDate js/state.js:30 | 0.4 | 1 | renderWaitingSection js/today.js:295 | 9.4 | 15 |
| renderHeader js/header.js:49 | 0.4 | 1 | waitingSorted js/waiting.js:322 | 9 | 15 |
| renderAll js/events.js:6 | 0.3 | 1 | openWaiting js/waiting.js:11 | 9 | 15 |
| find js/tree.js:21 | 0.2 | 0 | (anonymous) js/waiting.js:12 | 9 | 15 |
| drawToday js/today.js:209 | 0.2 | 0 | waitingNodes js/waiting.js:19 | 9 | 15 |
| row js/today.js:23 | 0.2 | 0 | renderWaitingToday js/schedule.js:188 | 1.9 | 3 |
| esc js/state.js:16 | 0.2 | 0 | (anonymous) js/schedule.js:193 | 1.6 | 3 |

</details>

<details><summary>busy / tick_today: 84.3 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| setHTML js/tree.js:418 | 35.7 | 42 | click | 79.3 | 94 |
| (anonymous) js/pics.js:75 | 6.5 | 8 | (anonymous) js/events.js:352 | 79.2 | 94 |
| stateJSON js/pics.js:125 | 6.2 | 7 | settle js/tree.js:71 | 78.4 | 93 |
| hashOf js/records.js:175 | 4.3 | 5 | renderAll js/events.js:6 | 42.7 | 51 |
| AudioContext | 3.1 | 4 | renderView js/events.js:12 | 41.7 | 49 |
| canon js/records.js:166 | 3.1 | 4 | renderToday js/today.js:178 | 41.6 | 49 |
| put | 3 | 4 | drawToday js/today.js:209 | 41.5 | 49 |
| recHash js/pics.js:174 | 2.8 | 3 | setHTML js/tree.js:418 | 35.7 | 42 |
| (anonymous) | 2.8 | 3 | save js/state.js:455 | 31.4 | 37 |
| (garbage collector) | 2 | 2 | persistLocal js/state.js:441 | 15.9 | 19 |
| (anonymous) js/records.js:172 | 1.4 | 2 | markDirty js/records.js:220 | 15.5 | 18 |
| waitBucket js/waiting.js:332 | 1 | 1 | (anonymous) js/records.js:240 | 12.2 | 15 |
| saveSyncState js/records.js:189 | 0.9 | 1 | recHash js/pics.js:174 | 11.6 | 14 |
| persistLocal js/state.js:441 | 0.8 | 1 | writeKV js/pics.js:74 | 9.9 | 12 |

</details>

<details><summary>busy / save: 16.8 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| stateJSON js/pics.js:125 | 3.7 | 22 | save js/state.js:455 | 16.6 | 99 |
| canon js/records.js:166 | 2.9 | 17 | markDirty js/records.js:220 | 10.1 | 60 |
| hashOf js/records.js:175 | 2.7 | 16 | (anonymous) js/records.js:240 | 6.7 | 40 |
| put | 1.6 | 10 | hashOf js/records.js:175 | 6.6 | 40 |
| (anonymous) js/records.js:33 | 1.3 | 8 | recHash js/pics.js:174 | 6.6 | 40 |
| (anonymous) js/records.js:172 | 1 | 6 | persistLocal js/state.js:441 | 6.1 | 36 |
| saveSyncState js/records.js:189 | 0.9 | 5 | canon js/records.js:166 | 3.9 | 23 |
| persistLocal js/state.js:441 | 0.9 | 5 | stateJSON js/pics.js:125 | 3.7 | 22 |
| transaction | 0.4 | 2 | (anonymous) js/records.js:172 | 3.2 | 19 |
| markDirty js/records.js:220 | 0.2 | 1 | (anonymous) js/pics.js:75 | 2.3 | 14 |
| (anonymous) js/pics.js:75 | 0.2 | 1 | writeKV js/pics.js:74 | 2.3 | 14 |
| toRecords js/records.js:30 | 0.2 | 1 | put | 1.6 | 10 |
| save js/state.js:455 | 0.2 | 1 | saveSyncState js/records.js:189 | 1.6 | 10 |
| (anonymous) | 0.1 | 1 | toRecords js/records.js:30 | 1.5 | 9 |

</details>

<details><summary>busy / tab_today: 67.4 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| getBoundingClientRect | 37.8 | 56 | go js/events.js:40 | 66.6 | 99 |
| setHTML js/tree.js:418 | 21.1 | 31 | getBoundingClientRect | 37.8 | 56 |
| find js/tree.js:21 | 1.3 | 2 | drawToday js/today.js:209 | 27.5 | 41 |
| stepBar js/today.js:57 | 0.7 | 1 | renderToday js/today.js:178 | 27.5 | 41 |
| (anonymous) js/today.js:328 | 0.6 | 1 | renderView js/events.js:12 | 27.5 | 41 |
| toggle | 0.5 | 1 | setHTML js/tree.js:418 | 21.1 | 31 |
| execRun js/ops.js:71 | 0.4 | 1 | renderWaitingToday js/schedule.js:188 | 1.8 | 3 |
| w js/tree.js:175 | 0.4 | 1 | todayWaiting js/schedule.js:177 | 1.7 | 3 |
| $ js/state.js:15 | 0.4 | 1 | list js/today.js:143 | 1.4 | 2 |
| timerTick js/focus.js:345 | 0.4 | 1 | find js/tree.js:21 | 1.3 | 2 |
| (anonymous) js/today.js:149 | 0.3 | 0 | (anonymous) js/schedule.js:179 | 1.3 | 2 |
| shift js/state.js:24 | 0.3 | 0 | (anonymous) js/today.js:149 | 1 | 2 |
| (anonymous) | 0.2 | 0 | renderAttention js/today.js:306 | 1 | 1 |
| today js/state.js:23 | 0.2 | 0 | row js/today.js:23 | 1 | 1 |

</details>

<details><summary>busy / tab_ops: 52.8 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| fadeTabs js/events.js:32 | 31.3 | 59 | go js/events.js:40 | 51.1 | 97 |
| execRun js/ops.js:71 | 5 | 9 | fadeTabs js/events.js:32 | 31.3 | 59 |
| go js/events.js:40 | 4.7 | 9 | renderView js/events.js:12 | 14.3 | 27 |
| (anonymous) js/ops.js:73 | 2.5 | 5 | renderOps js/ops.js:358 | 14.3 | 27 |
| setHTML js/tree.js:418 | 1.7 | 3 | opsOutcomes js/ops.js:257 | 8 | 15 |
| (garbage collector) | 1.5 | 3 | execRun js/ops.js:71 | 7.5 | 14 |
| esc js/state.js:16 | 1 | 2 | (anonymous) js/ops.js:274 | 6.5 | 12 |
| opsOutcomes js/ops.js:257 | 0.7 | 1 | (anonymous) js/ops.js:73 | 2.5 | 5 |
| (anonymous) js/ops.js:223 | 0.5 | 1 | setHTML js/tree.js:418 | 1.7 | 3 |
| (anonymous) js/ops.js:220 | 0.4 | 1 | opsComing js/ops.js:217 | 1.6 | 3 |
| find js/tree.js:21 | 0.3 | 1 | attentionItems js/ops.js:76 | 1.5 | 3 |
| _promiseAwareJsonValueNoThrow | 0.2 | 0 | (garbage collector) | 1.5 | 3 |
| shift js/state.js:24 | 0.2 | 0 | (anonymous) js/ops.js:220 | 1.1 | 2 |
| attentionItems js/ops.js:76 | 0.2 | 0 | esc js/state.js:16 | 1 | 2 |

</details>

<details><summary>busy / tab_waiting: 47 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| fadeTabs js/events.js:32 | 20.6 | 44 | go js/events.js:40 | 29.6 | 63 |
| (garbage collector) | 17.1 | 36 | fadeTabs js/events.js:32 | 20.6 | 44 |
| setHTML js/tree.js:418 | 7.3 | 15 | (garbage collector) | 17.1 | 36 |
| esc js/state.js:16 | 0.3 | 1 | renderView js/events.js:12 | 8.2 | 17 |
| (anonymous) js/waiting.js:387 | 0.3 | 1 | renderWaiting js/waiting.js:349 | 8 | 17 |
| (anonymous) | 0.2 | 1 | setHTML js/tree.js:418 | 7.3 | 15 |
| setIfChanged js/header.js:107 | 0.2 | 0 | renderHeader js/header.js:49 | 0.6 | 1 |
| go js/events.js:40 | 0.2 | 0 | (anonymous) js/waiting.js:374 | 0.6 | 1 |
| shift js/state.js:24 | 0.1 | 0 | (anonymous) js/waiting.js:387 | 0.5 | 1 |
| renderView js/events.js:12 | 0.1 | 0 | waitingRows js/waiting.js:383 | 0.5 | 1 |
| dayLabel js/state.js:36 | 0.1 | 0 | esc js/state.js:16 | 0.3 | 1 |
| waitingSorted js/waiting.js:322 | 0.1 | 0 | setIfChanged js/header.js:107 | 0.2 | 0 |
| renderHeader js/header.js:49 | 0.1 | 0 | shift js/state.js:24 | 0.1 | 0 |
| whoList js/waiting.js:125 | 0.1 | 0 | dayLabel js/state.js:36 | 0.1 | 0 |

</details>

<details><summary>busy / tab_insights: 47.6 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| getBoundingClientRect | 12.9 | 27 | go js/events.js:40 | 45.9 | 96 |
| querySelector | 10.6 | 22 | renderReview js/review.js:6 | 21.3 | 45 |
| (anonymous) js/analytics.js:62 | 7.7 | 16 | renderView js/events.js:12 | 21.3 | 45 |
| setHTML js/tree.js:418 | 6.1 | 13 | renderInsights js/analytics.js:489 | 15.2 | 32 |
| bars js/analytics.js:519 | 1.7 | 4 | getBoundingClientRect | 12.9 | 27 |
| (anonymous) | 1.6 | 3 | insights js/analytics.js:191 | 11.6 | 24 |
| (anonymous) js/analytics.js:116 | 0.9 | 2 | querySelector | 10.6 | 22 |
| productivity js/analytics.js:50 | 0.8 | 2 | productivity js/analytics.js:50 | 8.8 | 18 |
| (anonymous) js/analytics.js:79 | 0.4 | 1 | (anonymous) js/analytics.js:62 | 7.7 | 16 |
| go js/events.js:40 | 0.4 | 1 | setHTML js/tree.js:418 | 6.1 | 13 |
| setIfChanged js/header.js:107 | 0.4 | 1 | bars js/analytics.js:519 | 1.9 | 4 |
| esc js/state.js:16 | 0.3 | 1 | automationStats js/analytics.js:111 | 1.1 | 2 |
| insights js/analytics.js:191 | 0.3 | 1 | by js/analytics.js:114 | 1.1 | 2 |
| (anonymous) js/analytics.js:225 | 0.2 | 1 | (anonymous) js/analytics.js:143 | 1 | 2 |

</details>

<details><summary>busy / tab_forecast: 14.9 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| getBoundingClientRect | 11.1 | 75 | go js/events.js:40 | 14.6 | 98 |
| setHTML js/tree.js:418 | 0.5 | 3 | getBoundingClientRect | 11.1 | 75 |
| setIfChanged js/header.js:107 | 0.3 | 2 | renderReview js/review.js:6 | 2 | 14 |
| renderSyncBadge js/sync.js:31 | 0.3 | 2 | renderView js/events.js:12 | 2 | 14 |
| go js/events.js:40 | 0.3 | 2 | renderForecast js/forecast.js:276 | 1.3 | 9 |
| (anonymous) | 0.2 | 2 | renderHeader js/header.js:49 | 0.9 | 6 |
| renderReview js/review.js:6 | 0.2 | 1 | forecastItems js/forecast.js:62 | 0.7 | 5 |
| (anonymous) js/forecast.js:68 | 0.2 | 1 | allocate js/forecast.js:138 | 0.7 | 5 |
| renderHeader js/header.js:49 | 0.2 | 1 | (anonymous) js/forecast.js:68 | 0.6 | 4 |
| renderForecast js/forecast.js:276 | 0.2 | 1 | setHTML js/tree.js:418 | 0.5 | 3 |
| querySelectorAll | 0.1 | 1 | remEst js/forecast.js:42 | 0.4 | 3 |
| remEst js/forecast.js:42 | 0.1 | 1 | setIfChanged js/header.js:107 | 0.3 | 2 |
| toggle | 0.1 | 1 | renderSyncBadge js/sync.js:31 | 0.3 | 2 |
| $ js/state.js:15 | 0.1 | 1 | $ js/state.js:15 | 0.2 | 1 |

</details>

<details><summary>busy / tab_processes: 32 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| getBoundingClientRect | 19.4 | 61 | go js/events.js:40 | 31.5 | 99 |
| byName js/knowledge.js:11 | 5.7 | 18 | getBoundingClientRect | 19.4 | 61 |
| setHTML js/tree.js:418 | 2.2 | 7 | renderKnowledge js/knowledge.js:110 | 9.4 | 29 |
| renderHeader js/header.js:49 | 1.4 | 4 | renderView js/events.js:12 | 9.4 | 29 |
| (anonymous) js/knowledge.js:150 | 1.1 | 3 | kbProcesses js/create.js:118 | 7.2 | 23 |
| (anonymous) | 0.4 | 1 | byName js/knowledge.js:11 | 5.7 | 18 |
| setIfChanged js/header.js:107 | 0.4 | 1 | (anonymous) js/create.js:121 | 5.6 | 18 |
| $ js/state.js:15 | 0.3 | 1 | renderHeader js/header.js:49 | 2.3 | 7 |
| today js/state.js:23 | 0.2 | 1 | setHTML js/tree.js:418 | 2.2 | 7 |
| (anonymous) js/header.js:22 | 0.2 | 1 | kbFlows js/knowledge.js:142 | 1.4 | 4 |
| go js/events.js:40 | 0.1 | 0 | (anonymous) js/knowledge.js:150 | 1.1 | 4 |
| flowStatus js/execs.js:247 | 0.1 | 0 | recommend js/header.js:19 | 0.5 | 1 |
| quickActions js/today.js:286 | 0.1 | 0 | setIfChanged js/header.js:107 | 0.4 | 1 |
| evaluate | 0.1 | 0 | $ js/state.js:15 | 0.3 | 1 |

</details>

<details><summary>busy / search_key: 10.9 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| (anonymous) | 3.6 | 33 | dispatchEvent | 7.2 | 66 |
| (anonymous) js/search.js:67 | 2.6 | 24 | typedSearch js/search.js:20 | 7 | 64 |
| byName js/knowledge.js:11 | 1.3 | 11 | (anonymous) js/events.js:325 | 7 | 64 |
| typedSearch js/search.js:20 | 0.9 | 8 | searchResults js/search.js:52 | 6.1 | 56 |
| shift js/state.js:24 | 0.5 | 5 | w js/search.js:66 | 3.1 | 28 |
| has js/search.js:57 | 0.3 | 3 | (anonymous) js/search.js:67 | 2.9 | 27 |
| searchResults js/search.js:52 | 0.3 | 3 | byName js/knowledge.js:11 | 1.3 | 11 |
| esc js/state.js:16 | 0.2 | 2 | (anonymous) js/search.js:111 | 1.1 | 10 |
| (anonymous) js/search.js:112 | 0.2 | 2 | (anonymous) js/search.js:163 | 0.9 | 8 |
| w js/search.js:66 | 0.2 | 2 | dayLabel js/state.js:36 | 0.6 | 6 |
| dispatchEvent | 0.2 | 1 | day js/search.js:58 | 0.6 | 6 |
| (anonymous) js/search.js:163 | 0.1 | 1 | shift js/state.js:24 | 0.5 | 5 |
| _promiseAwareJsonValueNoThrow | 0.1 | 1 | (anonymous) js/search.js:112 | 0.4 | 4 |
| today js/state.js:23 | 0.1 | 1 | has js/search.js:57 | 0.3 | 3 |

</details>

<details><summary>busy / applyRows500: 85.3 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| canon js/records.js:166 | 37.1 | 44 | applyRows js/sync.js:128 | 85 | 100 |
| setHTML js/tree.js:418 | 10.4 | 12 | markDirty js/records.js:220 | 45.1 | 53 |
| hashOf js/records.js:175 | 5.9 | 7 | recHash js/pics.js:174 | 44.2 | 52 |
| stateJSON js/pics.js:125 | 4.5 | 5 | hashOf js/records.js:175 | 44 | 52 |
| put | 3.2 | 4 | (anonymous) js/records.js:240 | 39.7 | 47 |
| saveSyncState js/records.js:189 | 2.1 | 2 | canon js/records.js:166 | 38.1 | 45 |
| querySelectorAll | 2.1 | 2 | (anonymous) js/records.js:172 | 37.2 | 44 |
| persistLocal js/state.js:441 | 2 | 2 | inBackground js/tree.js:399 | 19.8 | 23 |
| (anonymous) js/records.js:33 | 1.2 | 1 | renderAll js/events.js:6 | 19.8 | 23 |
| (anonymous) js/records.js:96 | 1.1 | 1 | drawToday js/today.js:209 | 19 | 22 |
| (anonymous) js/records.js:240 | 1 | 1 | renderToday js/today.js:178 | 19 | 22 |
| toRecords js/records.js:30 | 1 | 1 | renderView js/events.js:12 | 19 | 22 |
| (anonymous) js/records.js:172 | 0.9 | 1 | setHTML js/tree.js:418 | 12.5 | 15 |
| cleanText js/state.js:45 | 0.8 | 1 | persistLocal js/state.js:441 | 9.1 | 11 |

</details>

<details><summary>heavy / cold_load: 475.5 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| getBoundingClientRect | 111.6 | 23 | (anonymous) js/events.js:1050 | 431.9 | 91 |
| setHTML js/tree.js:418 | 105.5 | 22 | start js/events.js:1003 | 431.1 | 91 |
| find js/tree.js:21 | 70.9 | 15 | renderToday js/today.js:178 | 278.8 | 59 |
| (garbage collector) | 29 | 6 | renderView js/events.js:12 | 278.8 | 59 |
| (anonymous) js/ops.js:73 | 17.8 | 4 | drawToday js/today.js:209 | 278.7 | 59 |
| load js/state.js:426 | 9.2 | 2 | go js/events.js:40 | 228.5 | 48 |
| shift js/state.js:24 | 7.1 | 1 | renderAll js/events.js:6 | 164.7 | 35 |
| get result | 6.2 | 1 | getBoundingClientRect | 111.6 | 23 |
| isDone js/tree.js:5 | 5.2 | 1 | setHTML js/tree.js:418 | 105.5 | 22 |
| today js/state.js:23 | 5 | 1 | renderWaitingToday js/schedule.js:188 | 101.8 | 21 |
| esc js/state.js:16 | 4.8 | 1 | todayWaiting js/schedule.js:177 | 94.1 | 20 |
| niceDate js/state.js:30 | 4.8 | 1 | (anonymous) js/schedule.js:179 | 73.5 | 15 |
| start js/events.js:1003 | 4.4 | 1 | find js/tree.js:21 | 70.9 | 15 |
| (anonymous) js/schedule.js:184 | 3.7 | 1 | load js/state.js:426 | 33 | 7 |

</details>

<details><summary>heavy / renderAll: 83.1 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| setHTML js/tree.js:418 | 47.5 | 57 | renderAll js/events.js:6 | 80.4 | 97 |
| find js/tree.js:21 | 12.4 | 15 | renderToday js/today.js:178 | 79.6 | 96 |
| (anonymous) js/schedule.js:179 | 2.9 | 3 | renderView js/events.js:12 | 79.6 | 96 |
| (garbage collector) | 2.5 | 3 | drawToday js/today.js:209 | 79.4 | 96 |
| shift js/state.js:24 | 1.9 | 2 | setHTML js/tree.js:418 | 47.5 | 57 |
| o js/schedule.js:184 | 1.8 | 2 | renderWaitingToday js/schedule.js:188 | 21 | 25 |
| today js/state.js:23 | 1.6 | 2 | todayWaiting js/schedule.js:177 | 19.6 | 24 |
| esc js/state.js:16 | 1.1 | 1 | (anonymous) js/schedule.js:179 | 15.3 | 18 |
| querySelectorAll | 0.8 | 1 | find js/tree.js:21 | 12.4 | 15 |
| list js/today.js:143 | 0.8 | 1 | o js/schedule.js:184 | 4 | 5 |
| row js/today.js:23 | 0.8 | 1 | (anonymous) js/schedule.js:183 | 4 | 5 |
| execRun js/ops.js:71 | 0.8 | 1 | list js/today.js:143 | 2.8 | 3 |
| w js/tree.js:175 | 0.6 | 1 | (garbage collector) | 2.5 | 3 |
| (anonymous) js/schedule.js:193 | 0.6 | 1 | (anonymous) js/schedule.js:184 | 2.2 | 3 |

</details>

<details><summary>heavy / tick_today: 175.1 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| setHTML js/tree.js:418 | 46.4 | 26 | click | 166.7 | 95 |
| find js/tree.js:21 | 19.8 | 11 | (anonymous) js/events.js:352 | 166.6 | 95 |
| stateJSON js/pics.js:125 | 13.2 | 8 | settle js/tree.js:71 | 165.6 | 95 |
| hashOf js/records.js:175 | 11.8 | 7 | renderAll js/events.js:6 | 103.2 | 59 |
| recHash js/pics.js:174 | 6.6 | 4 | renderToday js/today.js:178 | 102.6 | 59 |
| (garbage collector) | 6.1 | 3 | renderView js/events.js:12 | 102.6 | 59 |
| saveSyncState js/records.js:189 | 5.3 | 3 | drawToday js/today.js:209 | 102.5 | 59 |
| put | 5.2 | 3 | save js/state.js:455 | 59.8 | 34 |
| canon js/records.js:166 | 4.9 | 3 | setHTML js/tree.js:418 | 46.4 | 26 |
| attentionItems js/ops.js:76 | 3.4 | 2 | markDirty js/records.js:220 | 34.6 | 20 |
| shift js/state.js:24 | 3.4 | 2 | renderWaitingToday js/schedule.js:188 | 32.4 | 19 |
| (anonymous) js/records.js:172 | 2.5 | 1 | todayWaiting js/schedule.js:177 | 29.4 | 17 |
| markDirty js/records.js:220 | 2.3 | 1 | recHash js/pics.js:174 | 25.7 | 15 |
| persistLocal js/state.js:441 | 2.3 | 1 | persistLocal js/state.js:441 | 21.5 | 12 |

</details>

<details><summary>heavy / save: 58 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| stateJSON js/pics.js:125 | 15.3 | 26 | save js/state.js:455 | 57.8 | 100 |
| hashOf js/records.js:175 | 10.5 | 18 | markDirty js/records.js:220 | 33.1 | 57 |
| canon js/records.js:166 | 9 | 16 | (anonymous) js/records.js:240 | 24.6 | 42 |
| persistLocal js/state.js:441 | 3.7 | 6 | persistLocal js/state.js:441 | 23.9 | 41 |
| saveSyncState js/records.js:189 | 3.7 | 6 | recHash js/pics.js:174 | 23.1 | 40 |
| put | 3.4 | 6 | hashOf js/records.js:175 | 22.5 | 39 |
| (anonymous) js/records.js:172 | 3 | 5 | stateJSON js/pics.js:125 | 15.3 | 26 |
| (anonymous) js/pics.js:75 | 1.8 | 3 | canon js/records.js:166 | 12 | 21 |
| markDirty js/records.js:220 | 1.7 | 3 | (anonymous) js/records.js:172 | 10.6 | 18 |
| (anonymous) js/records.js:33 | 1.6 | 3 | writeKV js/pics.js:74 | 5.6 | 10 |
| (anonymous) js/records.js:240 | 1.6 | 3 | (anonymous) js/pics.js:75 | 5.5 | 9 |
| recHash js/pics.js:174 | 0.5 | 1 | saveSyncState js/records.js:189 | 4.6 | 8 |
| (anonymous) js/records.js:53 | 0.4 | 1 | put | 3.4 | 6 |
| (anonymous) js/procedures.js:67 | 0.3 | 0 | toRecords js/records.js:30 | 2.2 | 4 |

</details>

<details><summary>heavy / tab_today: 181.1 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| getBoundingClientRect | 103.6 | 57 | go js/events.js:40 | 179.5 | 99 |
| setHTML js/tree.js:418 | 34 | 19 | getBoundingClientRect | 103.6 | 57 |
| find js/tree.js:21 | 16 | 9 | drawToday js/today.js:209 | 74.1 | 41 |
| today js/state.js:23 | 2.9 | 2 | renderToday js/today.js:178 | 74.1 | 41 |
| shift js/state.js:24 | 2.4 | 1 | renderView js/events.js:12 | 74.1 | 41 |
| renderWaitingToday js/schedule.js:188 | 1.6 | 1 | setHTML js/tree.js:418 | 34 | 19 |
| pad js/state.js:21 | 1.4 | 1 | renderWaitingToday js/schedule.js:188 | 26.4 | 15 |
| todayWaiting js/schedule.js:177 | 1.3 | 1 | todayWaiting js/schedule.js:177 | 24.3 | 13 |
| querySelectorAll | 1.2 | 1 | find js/tree.js:21 | 16 | 9 |
| attentionItems js/ops.js:76 | 1.2 | 1 | (anonymous) js/schedule.js:179 | 10.8 | 6 |
| (garbage collector) | 1.1 | 1 | waitBucket js/waiting.js:332 | 5.6 | 3 |
| list js/today.js:143 | 1.1 | 1 | o js/schedule.js:184 | 4.6 | 3 |
| isDone js/tree.js:5 | 1 | 1 | (anonymous) js/schedule.js:183 | 4.6 | 3 |
| execRun js/ops.js:71 | 0.9 | 1 | (anonymous) js/schedule.js:184 | 4.4 | 2 |

</details>

<details><summary>heavy / tab_ops: 106.4 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| fadeTabs js/events.js:32 | 74.9 | 70 | go js/events.js:40 | 105.9 | 100 |
| find js/tree.js:21 | 7.2 | 7 | fadeTabs js/events.js:32 | 74.9 | 70 |
| setHTML js/tree.js:418 | 3.8 | 4 | renderOps js/ops.js:358 | 30.1 | 28 |
| (anonymous) js/ops.js:73 | 2.4 | 2 | renderView js/events.js:12 | 30.1 | 28 |
| findWaitable js/waiting.js:30 | 2.3 | 2 | opsOutcomes js/ops.js:257 | 16.2 | 15 |
| execRun js/ops.js:71 | 1.6 | 2 | (anonymous) js/ops.js:291 | 10.8 | 10 |
| spent js/tree.js:168 | 1.4 | 1 | findWaitable js/waiting.js:30 | 9.4 | 9 |
| (anonymous) js/ops.js:291 | 1.4 | 1 | find js/tree.js:21 | 7.2 | 7 |
| opsOutcomes js/ops.js:257 | 1.2 | 1 | opsComing js/ops.js:217 | 5.4 | 5 |
| (anonymous) js/ops.js:223 | 1 | 1 | execRun js/ops.js:71 | 4 | 4 |
| (anonymous) js/ops.js:220 | 0.8 | 1 | setHTML js/tree.js:418 | 3.8 | 4 |
| execFailures js/execs.js:103 | 0.7 | 1 | (anonymous) js/ops.js:220 | 3.1 | 3 |
| (anonymous) js/ops.js:275 | 0.6 | 1 | attentionItems js/ops.js:76 | 3 | 3 |
| isDone js/tree.js:5 | 0.6 | 1 | (anonymous) js/ops.js:274 | 2.7 | 3 |

</details>

<details><summary>heavy / tab_waiting: 156.6 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| fadeTabs js/events.js:32 | 132.3 | 84 | go js/events.js:40 | 156.2 | 100 |
| setHTML js/tree.js:418 | 15.4 | 10 | fadeTabs js/events.js:32 | 132.3 | 84 |
| waitingRows js/waiting.js:383 | 1.1 | 1 | renderWaiting js/waiting.js:349 | 21.3 | 14 |
| shift js/state.js:24 | 1.1 | 1 | renderView js/events.js:12 | 21.3 | 14 |
| querySelectorAll | 1 | 1 | setHTML js/tree.js:418 | 15.4 | 10 |
| (anonymous) js/waiting.js:374 | 0.7 | 0 | (anonymous) js/waiting.js:374 | 4.7 | 3 |
| waitingNodes js/waiting.js:19 | 0.6 | 0 | waitingRows js/waiting.js:383 | 2.9 | 2 |
| setIfChanged js/header.js:107 | 0.5 | 0 | (anonymous) js/waiting.js:387 | 1.4 | 1 |
| (anonymous) js/waiting.js:387 | 0.5 | 0 | renderHeader js/header.js:49 | 1.2 | 1 |
| esc js/state.js:16 | 0.4 | 0 | shift js/state.js:24 | 1.1 | 1 |
| dayLabel js/state.js:36 | 0.3 | 0 | querySelectorAll | 1 | 1 |
| today js/state.js:23 | 0.3 | 0 | waitBucket js/waiting.js:332 | 0.9 | 1 |
| querySelector | 0.2 | 0 | dayLabel js/state.js:36 | 0.8 | 0 |
| renderHeader js/header.js:49 | 0.2 | 0 | waitingNodes js/waiting.js:19 | 0.8 | 0 |

</details>

<details><summary>heavy / tab_insights: 47.5 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| getBoundingClientRect | 34.9 | 74 | go js/events.js:40 | 46.6 | 98 |
| setHTML js/tree.js:418 | 1.5 | 3 | getBoundingClientRect | 34.9 | 74 |
| go js/events.js:40 | 1.2 | 3 | renderReview js/review.js:6 | 8.2 | 17 |
| daysBetween js/state.js:404 | 0.9 | 2 | renderView js/events.js:12 | 8.2 | 17 |
| $ js/state.js:15 | 0.7 | 1 | renderInsights js/analytics.js:489 | 6.7 | 14 |
| (anonymous) | 0.6 | 1 | insights js/analytics.js:191 | 4.8 | 10 |
| productivity js/analytics.js:50 | 0.5 | 1 | waitingStats js/analytics.js:147 | 2.4 | 5 |
| w js/analytics.js:402 | 0.5 | 1 | setHTML js/tree.js:418 | 1.5 | 3 |
| querySelector | 0.4 | 1 | (anonymous) js/analytics.js:161 | 1.4 | 3 |
| querySelectorAll | 0.4 | 1 | productivity js/analytics.js:50 | 1.1 | 2 |
| waitingStats js/analytics.js:147 | 0.4 | 1 | findings js/analytics.js:336 | 1 | 2 |
| (anonymous) js/analytics.js:161 | 0.4 | 1 | daysBetween js/state.js:404 | 0.9 | 2 |
| pctOf js/analytics.js:10 | 0.4 | 1 | renderHeader js/header.js:49 | 0.8 | 2 |
| setIfChanged js/header.js:107 | 0.3 | 1 | w js/analytics.js:402 | 0.8 | 2 |

</details>

<details><summary>heavy / tab_forecast: 46.1 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| getBoundingClientRect | 32.3 | 70 | go js/events.js:40 | 44.8 | 97 |
| spent js/tree.js:168 | 4.1 | 9 | getBoundingClientRect | 32.3 | 70 |
| renderHeader js/header.js:49 | 1.3 | 3 | renderReview js/review.js:6 | 9.5 | 21 |
| stepsEstimated js/forecast.js:40 | 1.3 | 3 | renderView js/events.js:12 | 9.5 | 21 |
| setHTML js/tree.js:418 | 1.1 | 2 | renderForecast js/forecast.js:276 | 8.2 | 18 |
| forecastItems js/forecast.js:62 | 0.9 | 2 | allocate js/forecast.js:138 | 7.3 | 16 |
| querySelector | 0.6 | 1 | forecastItems js/forecast.js:62 | 7.2 | 16 |
| querySelectorAll | 0.6 | 1 | (anonymous) js/forecast.js:68 | 6.3 | 14 |
| (anonymous) js/tree.js:170 | 0.5 | 1 | remEst js/forecast.js:42 | 6.2 | 13 |
| (anonymous) | 0.5 | 1 | spent js/tree.js:168 | 4.6 | 10 |
| toggle | 0.4 | 1 | renderHeader js/header.js:49 | 2.6 | 6 |
| renderForecast js/forecast.js:276 | 0.4 | 1 | stepsEstimated js/forecast.js:40 | 1.3 | 3 |
| renderReview js/review.js:6 | 0.3 | 1 | setHTML js/tree.js:418 | 1.1 | 2 |
| remEst js/forecast.js:42 | 0.2 | 1 | querySelector | 0.6 | 1 |

</details>

<details><summary>heavy / tab_processes: 66 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| getBoundingClientRect | 49.2 | 75 | go js/events.js:40 | 65.4 | 99 |
| setHTML js/tree.js:418 | 4.3 | 6 | getBoundingClientRect | 49.2 | 75 |
| byName js/knowledge.js:11 | 2.6 | 4 | renderView js/events.js:12 | 15.4 | 23 |
| kbProcesses js/create.js:118 | 2.1 | 3 | renderKnowledge js/knowledge.js:110 | 15.3 | 23 |
| shift js/state.js:24 | 1.3 | 2 | kbProcesses js/create.js:118 | 10.9 | 16 |
| kbActivity js/create.js:42 | 1 | 1 | setHTML js/tree.js:418 | 4.3 | 6 |
| activityRow js/create.js:50 | 0.8 | 1 | processRow js/create.js:162 | 2.8 | 4 |
| wfRuns js/workflows.js:1178 | 0.7 | 1 | byName js/knowledge.js:11 | 2.6 | 4 |
| wfOpenRun js/workflows.js:1180 | 0.4 | 1 | (anonymous) js/create.js:121 | 1.9 | 3 |
| esc js/state.js:16 | 0.4 | 1 | dayLabel js/state.js:36 | 1.4 | 2 |
| timerTick js/focus.js:345 | 0.4 | 1 | shift js/state.js:24 | 1.3 | 2 |
| latestExec js/execs.js:95 | 0.3 | 0 | activityRow js/create.js:50 | 1.2 | 2 |
| querySelector | 0.3 | 0 | kbFlows js/knowledge.js:142 | 1.1 | 2 |
| (anonymous) | 0.2 | 0 | kbActivity js/create.js:42 | 1 | 1 |

</details>

<details><summary>heavy / search_key: 40.6 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| byName js/knowledge.js:11 | 12 | 30 | dispatchEvent | 34.4 | 85 |
| (anonymous) js/search.js:170 | 6.6 | 16 | (anonymous) js/events.js:325 | 34.3 | 84 |
| typedSearch js/search.js:20 | 5.2 | 13 | typedSearch js/search.js:20 | 34.1 | 84 |
| (garbage collector) | 4.5 | 11 | searchResults js/search.js:52 | 28.9 | 71 |
| searchResults js/search.js:52 | 1.8 | 4 | byName js/knowledge.js:11 | 12 | 30 |
| (anonymous) | 1.4 | 3 | (anonymous) js/search.js:111 | 11.4 | 28 |
| (anonymous) js/search.js:67 | 1.2 | 3 | (anonymous) js/search.js:170 | 6.6 | 16 |
| esc js/state.js:16 | 1.2 | 3 | (garbage collector) | 4.5 | 11 |
| w js/search.js:66 | 1.1 | 3 | w js/search.js:66 | 4.1 | 10 |
| shift js/state.js:24 | 1.1 | 3 | (anonymous) js/search.js:67 | 3.5 | 9 |
| has js/search.js:57 | 0.6 | 2 | (anonymous) js/search.js:163 | 2.3 | 6 |
| (anonymous) js/search.js:163 | 0.5 | 1 | day js/search.js:58 | 1.8 | 4 |
| flat js/search.js:41 | 0.3 | 1 | dayLabel js/state.js:36 | 1.6 | 4 |
| kbTrail js/knowledge.js:73 | 0.3 | 1 | shift js/state.js:24 | 1.3 | 3 |

</details>

<details><summary>heavy / applyRows500: 217.8 ms sampled</summary>

| Self | ms | % | Total (inclusive) | ms | % |
|---|---:|---:|---|---:|---:|
| setHTML js/tree.js:418 | 66.9 | 31 | applyRows js/sync.js:128 | 210.1 | 96 |
| find js/tree.js:21 | 22.9 | 11 | renderAll js/events.js:6 | 120 | 55 |
| put | 16.2 | 7 | inBackground js/tree.js:399 | 120 | 55 |
| hashOf js/records.js:175 | 13.9 | 6 | renderToday js/today.js:178 | 118.8 | 55 |
| stateJSON js/pics.js:125 | 12.2 | 6 | renderView js/events.js:12 | 118.8 | 55 |
| canon js/records.js:166 | 9.4 | 4 | drawToday js/today.js:209 | 118.7 | 54 |
| (garbage collector) | 7.2 | 3 | setHTML js/tree.js:418 | 68.5 | 31 |
| saveSyncState js/records.js:189 | 6 | 3 | renderWaitingToday js/schedule.js:188 | 33.1 | 15 |
| (anonymous) js/ops.js:73 | 3.9 | 2 | todayWaiting js/schedule.js:177 | 31.6 | 14 |
| (anonymous) js/records.js:172 | 3.5 | 2 | markDirty js/records.js:220 | 27.7 | 13 |
| shift js/state.js:24 | 3.5 | 2 | recHash js/pics.js:174 | 27.5 | 13 |
| persistLocal js/state.js:441 | 2.7 | 1 | hashOf js/records.js:175 | 26.8 | 12 |
| (anonymous) js/records.js:33 | 2.6 | 1 | (anonymous) js/schedule.js:179 | 24.6 | 11 |
| today js/state.js:23 | 2.2 | 1 | find js/tree.js:21 | 22.9 | 11 |

</details>

<details><summary>Raw results (JSON)</summary>

```json
{"meta":{"at":"2026-11-04T19:07:30.170Z + 2026-11-04T18:55:07.495Z (lowest of 2 runs' medians)","cpu":"Intel(R) Xeon(R) Processor @ 2.10GHz x4","chromium":"153.0.8010.12","commit":"89cbc9c","runs":5,"merged":["2026-11-04T19:07:30.170Z","2026-11-04T18:55:07.495Z"]},"results":{"1":{"typical":{"cold_load":{"js":55.3,"frame":78.8},"cold_scripts":{"js":26.9},"cold_start":{"js":29.5},"calibration":6.1,"size":{"stateJSON":95069,"syncJSON":18626,"records":245,"quests":25,"steps":100,"log":60,"kb":15,"workflows":4,"wruns":10,"execs":20,"follows":8,"inbox":7,"waiting":6},"renderAll":{"js":4.2,"work":9.4,"frame":20,"first":9.4},"bg_sync_redraw":{"js":4,"work":9.5,"frame":19.5,"first":9.6},"tick_today":{"js":8.7,"work":15.2,"frame":19.8,"first":60.1},"tick_task_page":{"js":4.7,"work":6.5,"frame":16.8,"first":6.8},"tab_today":{"js":7.2,"work":7.2,"frame":18.7,"first":8.7},"tab_inbox":{"js":2.6,"work":2.6,"frame":11.3,"first":2.6},"tab_knowledge":{"js":2.5,"work":2.5,"frame":14.3,"first":3.5},"tab_processes":{"js":4.4,"work":4.4,"frame":15.2,"first":7},"tab_review":{"js":2.8,"work":2.8,"frame":14.4,"first":4.9},"tab_forecast":{"js":5.2,"work":5.2,"frame":12.7,"first":8.7},"tab_insights":{"js":5.4,"work":5.4,"frame":14.8,"first":8},"tab_history":{"js":2.8,"work":2.8,"frame":15,"first":4.6},"tab_ops":{"js":4.7,"work":4.8,"frame":14.7,"first":5.9},"tab_waiting":{"js":3.5,"work":3.5,"frame":15.1,"first":6.6},"search_key":{"js":1.9,"work":5.3,"frame":18.8,"first":6.9},"search_open":{"js":3.8,"work":3.8,"frame":6,"first":3.3},"save":{"js":3.2,"work":3.2,"frame":9,"first":3.3,"idb":4.8},"toRecords":{"js":0.2,"work":0.2,"frame":13.6,"first":0.2},"markDirty":{"js":1.8,"work":1.8,"frame":16.5,"first":1.9},"stateJSON":{"js":0.5,"work":0.6,"frame":16.7,"first":0.5},"persistLocal":{"js":1.6,"work":1.6,"frame":14.3,"first":1.4,"idb":3.8},"applyRows500":{"js":11.3,"work":16,"frame":27.7,"first":22.2},"heapMB":3.1,"dom":{"all":1496,"today":821,"todayHTML":45142,"height":5582},"scroll":{"longTasks":0,"longTaskMs":0,"tbt":0,"maxFrame":17,"jank":0,"scrolledTo":4738},"errors":[]},"busy":{"cold_load":{"js":103.2,"frame":129.2},"cold_scripts":{"js":30.6},"cold_start":{"js":66.5},"calibration":6.5,"size":{"stateJSON":505542,"syncJSON":79204,"records":1023,"quests":100,"steps":405,"log":250,"kb":60,"workflows":15,"wruns":80,"execs":100,"follows":60,"inbox":23,"waiting":40},"renderAll":{"js":12.8,"work":27.5,"frame":33.4,"first":27.9},"bg_sync_redraw":{"js":10.2,"work":25.4,"frame":30.7,"first":26.8},"tick_today":{"js":23.9,"work":39.5,"frame":46.6,"first":68.7},"tick_task_page":{"js":13.9,"work":16,"frame":20.7,"first":14.5},"tab_today":{"js":27.9,"work":27.9,"frame":38.6,"first":33},"tab_inbox":{"js":5.6,"work":5.6,"frame":7.5,"first":9.3},"tab_knowledge":{"js":5.8,"work":5.8,"frame":6.8,"first":6.1},"tab_processes":{"js":11.1,"work":11.1,"frame":13.9,"first":12.9},"tab_review":{"js":4.9,"work":4.9,"frame":6.3,"first":7.1},"tab_forecast":{"js":5.6,"work":5.6,"frame":6.5,"first":14.4},"tab_insights":{"js":7.1,"work":7.1,"frame":11.9,"first":12},"tab_history":{"js":8,"work":8,"frame":11.3,"first":6.7},"tab_ops":{"js":13.5,"work":13.5,"frame":16.7,"first":24.1},"tab_waiting":{"js":13.2,"work":13.2,"frame":19.2,"first":14.7},"search_key":{"js":4.5,"work":11.2,"frame":17.5,"first":15.5},"search_open":{"js":7.8,"work":7.8,"frame":9.7,"first":5.4},"save":{"js":9.5,"work":9.5,"frame":14,"first":24.6,"idb":11.7},"toRecords":{"js":0.5,"work":0.5,"frame":17.1,"first":0.4},"markDirty":{"js":6,"work":6,"frame":16,"first":5.5},"stateJSON":{"js":2.1,"work":2.1,"frame":16.6,"first":2.9},"persistLocal":{"js":4,"work":4.1,"frame":11.6,"first":4.2,"idb":7.3},"applyRows500":{"js":31.7,"work":47.7,"frame":53.5,"first":56.6},"heapMB":3.9,"dom":{"all":5836,"today":3473,"todayHTML":191969,"height":22635},"scroll":{"longTasks":0,"longTaskMs":0,"tbt":0,"maxFrame":33,"jank":0,"scrolledTo":21791},"errors":[]},"heavy":{"cold_load":{"js":529.6,"frame":636.5},"cold_scripts":{"js":90.2},"cold_start":{"js":439.4},"calibration":12.8,"size":{"stateJSON":1746828,"syncJSON":307145,"records":3779,"quests":300,"steps":1454,"log":1000,"kb":300,"workflows":60,"wruns":216,"execs":150,"follows":400,"inbox":120,"waiting":400},"renderAll":{"js":77.5,"work":173.5,"frame":217.1,"first":137.8},"bg_sync_redraw":{"js":63.3,"work":245.1,"frame":303.3,"first":106.9},"tick_today":{"js":157.1,"work":232.3,"frame":256.6,"first":360.5},"tick_task_page":{"js":43.6,"work":46.5,"frame":54.2,"first":52.5},"tab_today":{"js":204.6,"work":204.7,"frame":249.6,"first":204.7},"tab_inbox":{"js":35.2,"work":35.2,"frame":45.5,"first":22.8},"tab_knowledge":{"js":20.9,"work":20.9,"frame":28.8,"first":18.2},"tab_processes":{"js":49.2,"work":49.2,"frame":63,"first":43.1},"tab_review":{"js":20.6,"work":20.6,"frame":33.2,"first":20.7},"tab_forecast":{"js":18,"work":18,"frame":29.5,"first":21.7},"tab_insights":{"js":19.3,"work":19.3,"frame":34.6,"first":33.1},"tab_history":{"js":17.6,"work":17.7,"frame":26.6,"first":24.3},"tab_ops":{"js":52,"work":52,"frame":78,"first":81},"tab_waiting":{"js":109.8,"work":109.8,"frame":130.9,"first":79.4},"search_key":{"js":17.3,"work":29.3,"frame":43.4,"first":29.3},"search_open":{"js":21.1,"work":21.1,"frame":30.4,"first":17.1},"save":{"js":38.2,"work":38.3,"frame":43.4,"first":38.3,"idb":49.1},"toRecords":{"js":1.3,"work":1.3,"frame":16.6,"first":1.3},"markDirty":{"js":23.2,"work":23.2,"frame":27,"first":23.2},"stateJSON":{"js":11.5,"work":11.5,"frame":17.2,"first":10.3},"persistLocal":{"js":23.8,"work":23.8,"frame":25.5,"first":15,"idb":45},"applyRows500":{"js":153.5,"work":219.7,"frame":225.1,"first":295.2},"heapMB":5.8,"dom":{"all":24430,"today":13421,"todayHTML":752440,"height":90016},"scroll":{"longTasks":0,"longTaskMs":0,"tbt":0,"maxFrame":17,"jank":0,"scrolledTo":24000},"errors":[]},"extreme":{"cold_load":{"js":547.2,"frame":620.5},"cold_scripts":{"js":65},"cold_start":{"js":482.2},"calibration":5.4,"size":{"stateJSON":3178346,"syncJSON":589313,"records":7087,"quests":600,"steps":2922,"log":2000,"kb":600,"workflows":120,"wruns":336,"execs":150,"follows":800,"inbox":240,"waiting":800},"renderAll":{"js":124.5,"work":255.4,"frame":289.9,"first":255.4},"bg_sync_redraw":{"js":122.2,"work":239.4,"frame":277.8,"first":239.4},"tick_today":{"js":193,"work":309.9,"frame":348.8,"first":321.3},"tick_task_page":{"js":66.5,"work":68.9,"frame":74.4,"first":62.5},"tab_today":{"js":234.3,"work":234.3,"frame":294.2,"first":234.3},"tab_inbox":{"js":42.4,"work":42.4,"frame":52.8,"first":42.4},"tab_knowledge":{"js":29.4,"work":29.4,"frame":35.6,"first":30.6},"tab_processes":{"js":62.6,"work":62.6,"frame":79.3,"first":62.6},"tab_review":{"js":33.7,"work":33.7,"frame":46.2,"first":36.5},"tab_forecast":{"js":28.3,"work":28.3,"frame":34.8,"first":34.1},"tab_insights":{"js":29.6,"work":29.6,"frame":42.2,"first":35.6},"tab_history":{"js":30.4,"work":30.4,"frame":45.9,"first":32.1},"tab_ops":{"js":89.8,"work":89.8,"frame":113.9,"first":96.5},"tab_waiting":{"js":139.2,"work":139.2,"frame":192.9,"first":132.3},"search_key":{"js":22.1,"work":28.1,"frame":30.8,"first":36},"search_open":{"js":29.3,"work":29.3,"frame":36,"first":29.3},"save":{"js":55.6,"work":55.6,"frame":56.5,"first":59.5,"idb":64.7},"toRecords":{"js":2,"work":2,"frame":16.5,"first":2},"markDirty":{"js":29.5,"work":29.5,"frame":30.5,"first":31.4},"stateJSON":{"js":17.3,"work":17.3,"frame":19.3,"first":16.9},"persistLocal":{"js":24.9,"work":24.9,"frame":32.3,"first":24.9,"idb":49.3},"applyRows500":{"js":232.3,"work":373.7,"frame":379.3,"first":377.8},"heapMB":7.9,"dom":{"all":47297,"today":26189,"todayHTML":1467646,"height":174439},"scroll":{"longTasks":0,"longTaskMs":0,"tbt":0,"maxFrame":17,"jank":0,"scrolledTo":24000},"errors":[]}},"4":{"typical":{"cold_load":{"js":250.6,"frame":316.7},"cold_scripts":{"js":109.3},"cold_start":{"js":125.5},"calibration":23.5,"size":{"stateJSON":95069,"syncJSON":18629,"records":245,"quests":25,"steps":100,"log":60,"kb":15,"workflows":4,"wruns":10,"execs":20,"follows":8,"inbox":7,"waiting":6},"renderAll":{"js":21.6,"work":49,"frame":71.1,"first":41.8},"bg_sync_redraw":{"js":19.4,"work":50.6,"frame":70.3,"first":46.4},"tick_today":{"js":36.3,"work":63.7,"frame":88.7,"first":96.3},"tick_task_page":{"js":24.3,"work":32.9,"frame":49.8,"first":32.9},"tab_today":{"js":39.4,"work":39.4,"frame":57.6,"first":57.2},"tab_inbox":{"js":13.1,"work":13.1,"frame":24.5,"first":13.1},"tab_knowledge":{"js":11.6,"work":11.6,"frame":17.6,"first":16.3},"tab_processes":{"js":17.4,"work":17.5,"frame":29.5,"first":27.9},"tab_review":{"js":12.4,"work":12.4,"frame":19.1,"first":18.8},"tab_forecast":{"js":17.3,"work":17.3,"frame":23.3,"first":33},"tab_insights":{"js":20.7,"work":20.7,"frame":27,"first":39.2},"tab_history":{"js":14.6,"work":14.6,"frame":27.7,"first":24.6},"tab_ops":{"js":19.5,"work":19.5,"frame":27.2,"first":8.6},"tab_waiting":{"js":19.1,"work":19.1,"frame":32.4,"first":25.5},"search_key":{"js":6.5,"work":20.8,"frame":33.3,"first":25.3},"search_open":{"js":14.3,"work":14.3,"frame":20.5,"first":15.5},"save":{"js":12,"work":12,"frame":13.9,"first":13.3,"idb":15.1},"toRecords":{"js":0.9,"work":0.9,"frame":16.6,"first":0.2},"markDirty":{"js":7,"work":7,"frame":16.3,"first":6.5},"stateJSON":{"js":1.9,"work":2,"frame":16.5,"first":2},"persistLocal":{"js":4.4,"work":4.5,"frame":13.5,"first":4.8,"idb":7.6},"applyRows500":{"js":43.2,"work":65.9,"frame":76.1,"first":68.2},"heapMB":3.2,"dom":{"all":1496,"today":821,"todayHTML":45142,"height":5582},"scroll":{"longTasks":0,"longTaskMs":0,"tbt":0,"maxFrame":17,"jank":0,"scrolledTo":4738},"errors":[]},"busy":{"cold_load":{"js":375.6,"frame":461.1},"cold_scripts":{"js":116.8},"cold_start":{"js":252.4},"calibration":26.2,"size":{"stateJSON":505542,"syncJSON":79192,"records":1023,"quests":100,"steps":405,"log":250,"kb":60,"workflows":15,"wruns":80,"execs":100,"follows":60,"inbox":23,"waiting":40},"renderAll":{"js":61.2,"work":144.4,"frame":176.5,"first":129.8},"bg_sync_redraw":{"js":55.7,"work":144.2,"frame":176.7,"first":125.6},"tick_today":{"js":89.8,"work":164.5,"frame":193.2,"first":164.5},"tick_task_page":{"js":59.2,"work":69.5,"frame":89.2,"first":65.9},"tab_today":{"js":118,"work":118,"frame":160.3,"first":138.6},"tab_inbox":{"js":24.3,"work":24.3,"frame":48.5,"first":24.3},"tab_knowledge":{"js":24.8,"work":24.8,"frame":40.9,"first":32.4},"tab_processes":{"js":45.8,"work":45.8,"frame":69,"first":60.8},"tab_review":{"js":30.6,"work":30.7,"frame":43.3,"first":23.3},"tab_forecast":{"js":30.5,"work":30.5,"frame":47.3,"first":42.3},"tab_insights":{"js":32.3,"work":32.3,"frame":45.2,"first":31.1},"tab_history":{"js":27.2,"work":27.4,"frame":39.3,"first":37},"tab_ops":{"js":53.5,"work":53.5,"frame":79.9,"first":64.2},"tab_waiting":{"js":53.5,"work":53.5,"frame":71,"first":55.6},"search_key":{"js":11.9,"work":29.4,"frame":38.4,"first":47.6},"search_open":{"js":23.6,"work":23.6,"frame":35.3,"first":27.6},"save":{"js":39.6,"work":39.6,"frame":45,"first":37,"idb":54.6},"toRecords":{"js":2.1,"work":2.1,"frame":16.8,"first":2.1},"markDirty":{"js":31,"work":31,"frame":45.6,"first":34.4},"stateJSON":{"js":9.5,"work":9.5,"frame":16,"first":11.2},"persistLocal":{"js":19.4,"work":19.4,"frame":20.6,"first":17.5,"idb":26},"applyRows500":{"js":155.6,"work":244.1,"frame":245.5,"first":228.6},"heapMB":3.9,"dom":{"all":5836,"today":3473,"todayHTML":191969,"height":22635},"scroll":{"longTasks":0,"longTaskMs":0,"tbt":0,"maxFrame":17,"jank":0,"scrolledTo":21791},"errors":[]},"heavy":{"cold_load":{"js":1075.2,"frame":1270.2},"cold_scripts":{"js":158.7},"cold_start":{"js":905.6},"calibration":27.5,"size":{"stateJSON":1746825,"syncJSON":307178,"records":3779,"quests":300,"steps":1454,"log":1000,"kb":300,"workflows":60,"wruns":216,"execs":150,"follows":400,"inbox":120,"waiting":400},"renderAll":{"js":253.5,"work":598.7,"frame":680.2,"first":598.7},"bg_sync_redraw":{"js":251.9,"work":519.9,"frame":609.7,"first":510},"tick_today":{"js":494.2,"work":794.9,"frame":907.3,"first":599},"tick_task_page":{"js":151,"work":162.4,"frame":194.2,"first":131.9},"tab_today":{"js":528.4,"work":528.4,"frame":659.3,"first":503.8},"tab_inbox":{"js":102.3,"work":102.3,"frame":124.9,"first":86.5},"tab_knowledge":{"js":73.9,"work":73.9,"frame":96.5,"first":96.5},"tab_processes":{"js":166.5,"work":166.5,"frame":231.7,"first":163.7},"tab_review":{"js":86.5,"work":86.5,"frame":117.4,"first":99.9},"tab_forecast":{"js":67.3,"work":67.3,"frame":98.7,"first":91},"tab_insights":{"js":72.2,"work":72.2,"frame":110.7,"first":72.2},"tab_history":{"js":61.7,"work":61.7,"frame":105.3,"first":61.7},"tab_ops":{"js":194.6,"work":194.6,"frame":235.2,"first":194.6},"tab_waiting":{"js":318.1,"work":318.1,"frame":433.1,"first":423.3},"search_key":{"js":60.3,"work":88.5,"frame":99.5,"first":111.3},"search_open":{"js":69.3,"work":69.3,"frame":95.5,"first":60.4},"save":{"js":130.5,"work":130.5,"frame":158.3,"first":223.4,"idb":178.5},"toRecords":{"js":7.7,"work":7.7,"frame":16.9,"first":8.8},"markDirty":{"js":94,"work":94.1,"frame":94.9,"first":94.1},"stateJSON":{"js":45.1,"work":45.2,"frame":55.6,"first":64.2},"persistLocal":{"js":65.7,"work":65.7,"frame":68.2,"first":91.6,"idb":87.8},"applyRows500":{"js":530.4,"work":867,"frame":874.7,"first":1028.9},"heapMB":5.8,"dom":{"all":24430,"today":13421,"todayHTML":752440,"height":90016},"scroll":{"longTasks":3,"longTaskMs":164,"tbt":14,"maxFrame":50,"jank":0,"scrolledTo":24000},"errors":[]},"extreme":{"cold_load":{"js":2332.8,"frame":2661.6},"cold_scripts":{"js":167.7},"cold_start":{"js":2092.8},"calibration":26.5,"size":{"stateJSON":3178346,"syncJSON":589318,"records":7087,"quests":600,"steps":2922,"log":2000,"kb":600,"workflows":120,"wruns":336,"execs":150,"follows":800,"inbox":240,"waiting":800},"renderAll":{"js":640.4,"work":1219.7,"frame":1495,"first":1484.5},"bg_sync_redraw":{"js":619,"work":1284.3,"frame":1466.4,"first":1444.1},"tick_today":{"js":867.6,"work":1403.6,"frame":1567.2,"first":1403.6},"tick_task_page":{"js":304.5,"work":314.6,"frame":346.1,"first":278.5},"tab_today":{"js":1059.6,"work":1059.6,"frame":1326.4,"first":993.6},"tab_inbox":{"js":211.4,"work":211.4,"frame":292.6,"first":224.1},"tab_knowledge":{"js":152,"work":152,"frame":197.5,"first":152.6},"tab_processes":{"js":291.8,"work":291.8,"frame":421.4,"first":390.4},"tab_review":{"js":164.6,"work":164.6,"frame":179.3,"first":164.6},"tab_forecast":{"js":161.9,"work":161.9,"frame":263.3,"first":251.1},"tab_insights":{"js":159.3,"work":159.3,"frame":231.3,"first":198.2},"tab_history":{"js":163,"work":163,"frame":187,"first":144.9},"tab_ops":{"js":549.1,"work":549.1,"frame":673,"first":680.7},"tab_waiting":{"js":780.9,"work":780.9,"frame":1045.5,"first":876.3},"search_key":{"js":115.4,"work":152.1,"frame":186.2,"first":152.1},"search_open":{"js":156,"work":156,"frame":245.8,"first":124.1},"save":{"js":317.1,"work":317.6,"frame":320.7,"first":372.3,"idb":329.4},"toRecords":{"js":11.1,"work":11.1,"frame":17.1,"first":11.1},"markDirty":{"js":181.3,"work":181.4,"frame":188.5,"first":192.7},"stateJSON":{"js":66.1,"work":66.1,"frame":92,"first":87.9},"persistLocal":{"js":131.3,"work":131.3,"frame":134.4,"first":67.8,"idb":166},"applyRows500":{"js":1196,"work":2006,"frame":2008.6,"first":1314.8},"heapMB":7.9,"dom":{"all":47297,"today":26189,"todayHTML":1467646,"height":174439},"scroll":{"longTasks":26,"longTaskMs":1949,"tbt":599,"maxFrame":117,"jank":15,"scrolledTo":24000},"errors":[]}},"counts":{"busy":{"renderAll":{"total":24.3,"find":[32,3.4,6406],"taskState":[231,0.8,231],"top3State":[1,0,1],"isDone":[6521,1.4,6521],"stepsDone":[104,0,104],"nextLeaf":[469,0.3,469],"actionLeaf":[214,0.5,214],"waitingSteps":[190,0.5,190],"attentionItems":[1,1.7,1],"dueSoon":[1,0.4,1],"renderHeader":[1,0.5,1],"renderToday":[1,23.4,1],"renderTop3":[1,0.3,1],"renderAttention":[1,1.8,1],"renderScheduledToday":[1,0.1,1],"renderWaitingToday":[1,4.2,1],"setHTML":[1,12.3,1]},"tick_today":{"total":70.9,"find":[36,1,6472],"taskState":[234,0.8,234],"top3State":[2,0,2],"settleTop3":[1,0,1],"isDone":[8868,2.5,8868],"stepsDone":[404,0.1,404],"nextLeaf":[472,0.4,472],"actionLeaf":[217,0.5,217],"waitingSteps":[190,0.7,190],"snapshot":[2,1.6,2],"toRecords":[1,0.6,1],"markDirty":[1,11.6,1],"recHash":[1024,7.5,1024],"hashOf":[1024,7.4,1024],"stateJSON":[1,3.2,1],"persistLocal":[1,6.3,1],"attentionItems":[1,2.1,1],"dueSoon":[1,0.3,1],"renderHeader":[1,2.1,1],"renderToday":[1,26,1],"renderTop3":[1,0.5,1],"renderAttention":[1,2.1,1],"renderScheduledToday":[1,0,1],"renderWaitingToday":[1,2,1],"setHTML":[1,16.7,1]},"save":{"total":31.3,"taskState":[3,0,3],"top3State":[1,0,1],"settleTop3":[1,0,1],"isDone":[12,0,12],"nextLeaf":[3,0,3],"actionLeaf":[3,0,3],"toRecords":[1,0.9,1],"markDirty":[1,19.6,1],"recHash":[1025,6.1,1025],"hashOf":[1025,5.9,1025],"stateJSON":[1,2.4,1],"persistLocal":[1,11.1,1]},"tab_ops":{"total":46.2,"find":[10,1.5,1641],"taskState":[8,0.1,8],"top3State":[1,0.1,1],"isDone":[7692,3.9,7692],"nextLeaf":[8,0,8],"actionLeaf":[8,0.1,8],"attentionItems":[1,4.4,1],"renderHeader":[1,1.2,1],"setHTML":[1,1.6,1]},"tab_waiting":{"total":13.3,"find":[1,0,1],"isDone":[1196,0.2,1196],"renderHeader":[1,0.5,1],"setHTML":[1,1.2,1]},"tab_insights":{"total":15.4,"find":[1,0,1],"isDone":[1156,0.2,1156],"renderHeader":[1,0.4,1],"setHTML":[1,0.9,1]}},"heavy":{"renderAll":{"total":139.5,"find":[283,31.7,243844],"taskState":[886,5.6,886],"top3State":[2,0,2],"isDone":[22445,14.5,22445],"stepsDone":[379,0.1,379],"nextLeaf":[1610,1.2,1610],"actionLeaf":[831,3.9,831],"waitingSteps":[598,1.9,598],"attentionItems":[1,5.7,1],"dueSoon":[1,8.8,1],"renderHeader":[1,1.2,1],"renderToday":[1,138,1],"renderTop3":[1,1.2,1],"renderAttention":[1,5.9,1],"renderScheduledToday":[1,0,1],"renderWaitingToday":[1,46.2,1],"setHTML":[1,62.1,1]},"tick_today":{"total":201.5,"find":[287,22.1,243912],"taskState":[889,14.1,889],"top3State":[3,0.1,3],"settleTop3":[1,0,1],"isDone":[30429,8.9,30429],"stepsDone":[1319,2.2,1319],"nextLeaf":[1613,1.6,1613],"actionLeaf":[834,6.2,834],"waitingSteps":[598,0.6,598],"snapshot":[2,3.4,2],"toRecords":[1,3.1,1],"markDirty":[1,50.6,1],"recHash":[3780,38.9,3780],"hashOf":[3780,37.4,3780],"stateJSON":[1,10.1,1],"persistLocal":[1,17.7,1],"attentionItems":[1,8.3,1],"dueSoon":[1,1,1],"renderHeader":[1,0.6,1],"renderToday":[1,116.4,1],"renderTop3":[1,6.9,1],"renderAttention":[1,8.5,1],"renderScheduledToday":[1,0,1],"renderWaitingToday":[1,30.2,1],"setHTML":[1,48,1]},"save":{"total":58,"taskState":[3,0,3],"top3State":[1,0,1],"settleTop3":[1,0.1,1],"isDone":[12,0,12],"nextLeaf":[3,0,3],"actionLeaf":[3,0,3],"toRecords":[1,1.2,1],"markDirty":[1,34.2,1],"recHash":[3781,27.4,3781],"hashOf":[3781,24,3781],"stateJSON":[1,15.1,1],"persistLocal":[1,22.7,1]},"tab_ops":{"total":99,"find":[102,8,77752],"taskState":[21,0.2,21],"top3State":[2,0.1,2],"isDone":[26693,10.1,26693],"stepsDone":[1,0,1],"nextLeaf":[21,0.1,21],"actionLeaf":[21,0.2,21],"waitingSteps":[1,0,1],"attentionItems":[1,8.4,1],"renderHeader":[1,1.5,1],"setHTML":[1,2.4,1]},"tab_waiting":{"total":105.9,"taskState":[3,0,3],"top3State":[1,0,1],"isDone":[4157,0.4,4157],"nextLeaf":[4,0,4],"actionLeaf":[4,0,4],"renderHeader":[1,0.6,1],"setHTML":[1,22.6,1]},"tab_insights":{"total":39.5,"taskState":[3,0,3],"top3State":[1,0,1],"isDone":[3997,1,3997],"nextLeaf":[4,0,4],"actionLeaf":[4,0,4],"renderHeader":[1,0.9,1],"setHTML":[1,1.7,1]}}},"profiles":{"busy":{"cold_load":{"sampledMs":136.2,"self":[["getBoundingClientRect",39.6,29],["setHTML js/tree.js:418",22.5,16],["(garbage collector)",19,14],["find js/tree.js:21",5.5,4],["(anonymous) js/state.js:262",4.5,3],["stepBar js/today.js:57",2.8,2],["(anonymous) js/schedule.js:184",2.6,2],["today js/state.js:23",2.2,2],["querySelector",2,1],["load js/state.js:426",2,1],["(anonymous)",1.8,1],["renderScheduledToday js/schedule.js:159",1.8,1],["execRun js/ops.js:71",1.6,1],["(anonymous) js/ops.js:73",1.5,1]],"total":[["(anonymous) js/events.js:1050",109.6,80],["start js/events.js:1003",108.8,80],["go js/events.js:40",65,48],["renderView js/events.js:12",51.5,38],["renderToday js/today.js:178",51.4,38],["drawToday js/today.js:209",51.3,38],["getBoundingClientRect",39.6,29],["renderAll js/events.js:6",30.2,22],["setHTML js/tree.js:418",22.5,16],["(garbage collector)",19,14],["load js/state.js:426",12.1,9],["renderWaitingToday js/schedule.js:188",11.3,8],["norm js/state.js:210",10.1,7],["todayWaiting js/schedule.js:177",8.9,7]]},"renderAll":{"sampledMs":61.7,"self":[["setHTML js/tree.js:418",32.8,53],["carriedRows js/today.js:338",13.4,22],["openWaiting js/waiting.js:11",9,15],["shift js/state.js:24",1.6,3],["daysBetween js/state.js:404",0.6,1],["w js/tree.js:175",0.5,1],["list js/today.js:143",0.5,1],["niceDate js/state.js:30",0.4,1],["renderHeader js/header.js:49",0.4,1],["renderAll js/events.js:6",0.3,1],["find js/tree.js:21",0.2,0],["drawToday js/today.js:209",0.2,0],["row js/today.js:23",0.2,0],["esc js/state.js:16",0.2,0]],"total":[["renderAll js/events.js:6",61.6,100],["renderToday js/today.js:178",60.7,98],["renderView js/events.js:12",60.7,98],["drawToday js/today.js:209",60.6,98],["setHTML js/tree.js:418",32.8,53],["carriedRows js/today.js:338",14.1,23],["renderCarried js/today.js:330",14.1,23],["renderWaitingSection js/today.js:295",9.4,15],["waitingSorted js/waiting.js:322",9,15],["openWaiting js/waiting.js:11",9,15],["(anonymous) js/waiting.js:12",9,15],["waitingNodes js/waiting.js:19",9,15],["renderWaitingToday js/schedule.js:188",1.9,3],["(anonymous) js/schedule.js:193",1.6,3]]},"tick_today":{"sampledMs":84.3,"self":[["setHTML js/tree.js:418",35.7,42],["(anonymous) js/pics.js:75",6.5,8],["stateJSON js/pics.js:125",6.2,7],["hashOf js/records.js:175",4.3,5],["AudioContext",3.1,4],["canon js/records.js:166",3.1,4],["put",3,4],["recHash js/pics.js:174",2.8,3],["(anonymous)",2.8,3],["(garbage collector)",2,2],["(anonymous) js/records.js:172",1.4,2],["waitBucket js/waiting.js:332",1,1],["saveSyncState js/records.js:189",0.9,1],["persistLocal js/state.js:441",0.8,1]],"total":[["click",79.3,94],["(anonymous) js/events.js:352",79.2,94],["settle js/tree.js:71",78.4,93],["renderAll js/events.js:6",42.7,51],["renderView js/events.js:12",41.7,49],["renderToday js/today.js:178",41.6,49],["drawToday js/today.js:209",41.5,49],["setHTML js/tree.js:418",35.7,42],["save js/state.js:455",31.4,37],["persistLocal js/state.js:441",15.9,19],["markDirty js/records.js:220",15.5,18],["(anonymous) js/records.js:240",12.2,15],["recHash js/pics.js:174",11.6,14],["writeKV js/pics.js:74",9.9,12]]},"save":{"sampledMs":16.8,"self":[["stateJSON js/pics.js:125",3.7,22],["canon js/records.js:166",2.9,17],["hashOf js/records.js:175",2.7,16],["put",1.6,10],["(anonymous) js/records.js:33",1.3,8],["(anonymous) js/records.js:172",1,6],["saveSyncState js/records.js:189",0.9,5],["persistLocal js/state.js:441",0.9,5],["transaction",0.4,2],["markDirty js/records.js:220",0.2,1],["(anonymous) js/pics.js:75",0.2,1],["toRecords js/records.js:30",0.2,1],["save js/state.js:455",0.2,1],["(anonymous)",0.1,1]],"total":[["save js/state.js:455",16.6,99],["markDirty js/records.js:220",10.1,60],["(anonymous) js/records.js:240",6.7,40],["hashOf js/records.js:175",6.6,40],["recHash js/pics.js:174",6.6,40],["persistLocal js/state.js:441",6.1,36],["canon js/records.js:166",3.9,23],["stateJSON js/pics.js:125",3.7,22],["(anonymous) js/records.js:172",3.2,19],["(anonymous) js/pics.js:75",2.3,14],["writeKV js/pics.js:74",2.3,14],["put",1.6,10],["saveSyncState js/records.js:189",1.6,10],["toRecords js/records.js:30",1.5,9]]},"tab_today":{"sampledMs":67.4,"self":[["getBoundingClientRect",37.8,56],["setHTML js/tree.js:418",21.1,31],["find js/tree.js:21",1.3,2],["stepBar js/today.js:57",0.7,1],["(anonymous) js/today.js:328",0.6,1],["toggle",0.5,1],["execRun js/ops.js:71",0.4,1],["w js/tree.js:175",0.4,1],["$ js/state.js:15",0.4,1],["timerTick js/focus.js:345",0.4,1],["(anonymous) js/today.js:149",0.3,0],["shift js/state.js:24",0.3,0],["(anonymous)",0.2,0],["today js/state.js:23",0.2,0]],"total":[["go js/events.js:40",66.6,99],["getBoundingClientRect",37.8,56],["drawToday js/today.js:209",27.5,41],["renderToday js/today.js:178",27.5,41],["renderView js/events.js:12",27.5,41],["setHTML js/tree.js:418",21.1,31],["renderWaitingToday js/schedule.js:188",1.8,3],["todayWaiting js/schedule.js:177",1.7,3],["list js/today.js:143",1.4,2],["find js/tree.js:21",1.3,2],["(anonymous) js/schedule.js:179",1.3,2],["(anonymous) js/today.js:149",1,2],["renderAttention js/today.js:306",1,1],["row js/today.js:23",1,1]]},"tab_ops":{"sampledMs":52.8,"self":[["fadeTabs js/events.js:32",31.3,59],["execRun js/ops.js:71",5,9],["go js/events.js:40",4.7,9],["(anonymous) js/ops.js:73",2.5,5],["setHTML js/tree.js:418",1.7,3],["(garbage collector)",1.5,3],["esc js/state.js:16",1,2],["opsOutcomes js/ops.js:257",0.7,1],["(anonymous) js/ops.js:223",0.5,1],["(anonymous) js/ops.js:220",0.4,1],["find js/tree.js:21",0.3,1],["_promiseAwareJsonValueNoThrow",0.2,0],["shift js/state.js:24",0.2,0],["attentionItems js/ops.js:76",0.2,0]],"total":[["go js/events.js:40",51.1,97],["fadeTabs js/events.js:32",31.3,59],["renderView js/events.js:12",14.3,27],["renderOps js/ops.js:358",14.3,27],["opsOutcomes js/ops.js:257",8,15],["execRun js/ops.js:71",7.5,14],["(anonymous) js/ops.js:274",6.5,12],["(anonymous) js/ops.js:73",2.5,5],["setHTML js/tree.js:418",1.7,3],["opsComing js/ops.js:217",1.6,3],["attentionItems js/ops.js:76",1.5,3],["(garbage collector)",1.5,3],["(anonymous) js/ops.js:220",1.1,2],["esc js/state.js:16",1,2]]},"tab_waiting":{"sampledMs":47,"self":[["fadeTabs js/events.js:32",20.6,44],["(garbage collector)",17.1,36],["setHTML js/tree.js:418",7.3,15],["esc js/state.js:16",0.3,1],["(anonymous) js/waiting.js:387",0.3,1],["(anonymous)",0.2,1],["setIfChanged js/header.js:107",0.2,0],["go js/events.js:40",0.2,0],["shift js/state.js:24",0.1,0],["renderView js/events.js:12",0.1,0],["dayLabel js/state.js:36",0.1,0],["waitingSorted js/waiting.js:322",0.1,0],["renderHeader js/header.js:49",0.1,0],["whoList js/waiting.js:125",0.1,0]],"total":[["go js/events.js:40",29.6,63],["fadeTabs js/events.js:32",20.6,44],["(garbage collector)",17.1,36],["renderView js/events.js:12",8.2,17],["renderWaiting js/waiting.js:349",8,17],["setHTML js/tree.js:418",7.3,15],["renderHeader js/header.js:49",0.6,1],["(anonymous) js/waiting.js:374",0.6,1],["(anonymous) js/waiting.js:387",0.5,1],["waitingRows js/waiting.js:383",0.5,1],["esc js/state.js:16",0.3,1],["setIfChanged js/header.js:107",0.2,0],["shift js/state.js:24",0.1,0],["dayLabel js/state.js:36",0.1,0]]},"tab_insights":{"sampledMs":47.6,"self":[["getBoundingClientRect",12.9,27],["querySelector",10.6,22],["(anonymous) js/analytics.js:62",7.7,16],["setHTML js/tree.js:418",6.1,13],["bars js/analytics.js:519",1.7,4],["(anonymous)",1.6,3],["(anonymous) js/analytics.js:116",0.9,2],["productivity js/analytics.js:50",0.8,2],["(anonymous) js/analytics.js:79",0.4,1],["go js/events.js:40",0.4,1],["setIfChanged js/header.js:107",0.4,1],["esc js/state.js:16",0.3,1],["insights js/analytics.js:191",0.3,1],["(anonymous) js/analytics.js:225",0.2,1]],"total":[["go js/events.js:40",45.9,96],["renderReview js/review.js:6",21.3,45],["renderView js/events.js:12",21.3,45],["renderInsights js/analytics.js:489",15.2,32],["getBoundingClientRect",12.9,27],["insights js/analytics.js:191",11.6,24],["querySelector",10.6,22],["productivity js/analytics.js:50",8.8,18],["(anonymous) js/analytics.js:62",7.7,16],["setHTML js/tree.js:418",6.1,13],["bars js/analytics.js:519",1.9,4],["automationStats js/analytics.js:111",1.1,2],["by js/analytics.js:114",1.1,2],["(anonymous) js/analytics.js:143",1,2]]},"tab_forecast":{"sampledMs":14.9,"self":[["getBoundingClientRect",11.1,75],["setHTML js/tree.js:418",0.5,3],["setIfChanged js/header.js:107",0.3,2],["renderSyncBadge js/sync.js:31",0.3,2],["go js/events.js:40",0.3,2],["(anonymous)",0.2,2],["renderReview js/review.js:6",0.2,1],["(anonymous) js/forecast.js:68",0.2,1],["renderHeader js/header.js:49",0.2,1],["renderForecast js/forecast.js:276",0.2,1],["querySelectorAll",0.1,1],["remEst js/forecast.js:42",0.1,1],["toggle",0.1,1],["$ js/state.js:15",0.1,1]],"total":[["go js/events.js:40",14.6,98],["getBoundingClientRect",11.1,75],["renderReview js/review.js:6",2,14],["renderView js/events.js:12",2,14],["renderForecast js/forecast.js:276",1.3,9],["renderHeader js/header.js:49",0.9,6],["forecastItems js/forecast.js:62",0.7,5],["allocate js/forecast.js:138",0.7,5],["(anonymous) js/forecast.js:68",0.6,4],["setHTML js/tree.js:418",0.5,3],["remEst js/forecast.js:42",0.4,3],["setIfChanged js/header.js:107",0.3,2],["renderSyncBadge js/sync.js:31",0.3,2],["$ js/state.js:15",0.2,1]]},"tab_processes":{"sampledMs":32,"self":[["getBoundingClientRect",19.4,61],["byName js/knowledge.js:11",5.7,18],["setHTML js/tree.js:418",2.2,7],["renderHeader js/header.js:49",1.4,4],["(anonymous) js/knowledge.js:150",1.1,3],["(anonymous)",0.4,1],["setIfChanged js/header.js:107",0.4,1],["$ js/state.js:15",0.3,1],["today js/state.js:23",0.2,1],["(anonymous) js/header.js:22",0.2,1],["go js/events.js:40",0.1,0],["flowStatus js/execs.js:247",0.1,0],["quickActions js/today.js:286",0.1,0],["evaluate",0.1,0]],"total":[["go js/events.js:40",31.5,99],["getBoundingClientRect",19.4,61],["renderKnowledge js/knowledge.js:110",9.4,29],["renderView js/events.js:12",9.4,29],["kbProcesses js/create.js:118",7.2,23],["byName js/knowledge.js:11",5.7,18],["(anonymous) js/create.js:121",5.6,18],["renderHeader js/header.js:49",2.3,7],["setHTML js/tree.js:418",2.2,7],["kbFlows js/knowledge.js:142",1.4,4],["(anonymous) js/knowledge.js:150",1.1,4],["recommend js/header.js:19",0.5,1],["setIfChanged js/header.js:107",0.4,1],["$ js/state.js:15",0.3,1]]},"search_key":{"sampledMs":10.9,"self":[["(anonymous)",3.6,33],["(anonymous) js/search.js:67",2.6,24],["byName js/knowledge.js:11",1.3,11],["typedSearch js/search.js:20",0.9,8],["shift js/state.js:24",0.5,5],["has js/search.js:57",0.3,3],["searchResults js/search.js:52",0.3,3],["esc js/state.js:16",0.2,2],["(anonymous) js/search.js:112",0.2,2],["w js/search.js:66",0.2,2],["dispatchEvent",0.2,1],["(anonymous) js/search.js:163",0.1,1],["_promiseAwareJsonValueNoThrow",0.1,1],["today js/state.js:23",0.1,1]],"total":[["dispatchEvent",7.2,66],["typedSearch js/search.js:20",7,64],["(anonymous) js/events.js:325",7,64],["searchResults js/search.js:52",6.1,56],["w js/search.js:66",3.1,28],["(anonymous) js/search.js:67",2.9,27],["byName js/knowledge.js:11",1.3,11],["(anonymous) js/search.js:111",1.1,10],["(anonymous) js/search.js:163",0.9,8],["dayLabel js/state.js:36",0.6,6],["day js/search.js:58",0.6,6],["shift js/state.js:24",0.5,5],["(anonymous) js/search.js:112",0.4,4],["has js/search.js:57",0.3,3]]},"applyRows500":{"sampledMs":85.3,"self":[["canon js/records.js:166",37.1,44],["setHTML js/tree.js:418",10.4,12],["hashOf js/records.js:175",5.9,7],["stateJSON js/pics.js:125",4.5,5],["put",3.2,4],["saveSyncState js/records.js:189",2.1,2],["querySelectorAll",2.1,2],["persistLocal js/state.js:441",2,2],["(anonymous) js/records.js:33",1.2,1],["(anonymous) js/records.js:96",1.1,1],["(anonymous) js/records.js:240",1,1],["toRecords js/records.js:30",1,1],["(anonymous) js/records.js:172",0.9,1],["cleanText js/state.js:45",0.8,1]],"total":[["applyRows js/sync.js:128",85,100],["markDirty js/records.js:220",45.1,53],["recHash js/pics.js:174",44.2,52],["hashOf js/records.js:175",44,52],["(anonymous) js/records.js:240",39.7,47],["canon js/records.js:166",38.1,45],["(anonymous) js/records.js:172",37.2,44],["inBackground js/tree.js:399",19.8,23],["renderAll js/events.js:6",19.8,23],["drawToday js/today.js:209",19,22],["renderToday js/today.js:178",19,22],["renderView js/events.js:12",19,22],["setHTML js/tree.js:418",12.5,15],["persistLocal js/state.js:441",9.1,11]]}},"heavy":{"cold_load":{"sampledMs":475.5,"self":[["getBoundingClientRect",111.6,23],["setHTML js/tree.js:418",105.5,22],["find js/tree.js:21",70.9,15],["(garbage collector)",29,6],["(anonymous) js/ops.js:73",17.8,4],["load js/state.js:426",9.2,2],["shift js/state.js:24",7.1,1],["get result",6.2,1],["isDone js/tree.js:5",5.2,1],["today js/state.js:23",5,1],["esc js/state.js:16",4.8,1],["niceDate js/state.js:30",4.8,1],["start js/events.js:1003",4.4,1],["(anonymous) js/schedule.js:184",3.7,1]],"total":[["(anonymous) js/events.js:1050",431.9,91],["start js/events.js:1003",431.1,91],["renderToday js/today.js:178",278.8,59],["renderView js/events.js:12",278.8,59],["drawToday js/today.js:209",278.7,59],["go js/events.js:40",228.5,48],["renderAll js/events.js:6",164.7,35],["getBoundingClientRect",111.6,23],["setHTML js/tree.js:418",105.5,22],["renderWaitingToday js/schedule.js:188",101.8,21],["todayWaiting js/schedule.js:177",94.1,20],["(anonymous) js/schedule.js:179",73.5,15],["find js/tree.js:21",70.9,15],["load js/state.js:426",33,7]]},"renderAll":{"sampledMs":83.1,"self":[["setHTML js/tree.js:418",47.5,57],["find js/tree.js:21",12.4,15],["(anonymous) js/schedule.js:179",2.9,3],["(garbage collector)",2.5,3],["shift js/state.js:24",1.9,2],["o js/schedule.js:184",1.8,2],["today js/state.js:23",1.6,2],["esc js/state.js:16",1.1,1],["querySelectorAll",0.8,1],["list js/today.js:143",0.8,1],["row js/today.js:23",0.8,1],["execRun js/ops.js:71",0.8,1],["w js/tree.js:175",0.6,1],["(anonymous) js/schedule.js:193",0.6,1]],"total":[["renderAll js/events.js:6",80.4,97],["renderToday js/today.js:178",79.6,96],["renderView js/events.js:12",79.6,96],["drawToday js/today.js:209",79.4,96],["setHTML js/tree.js:418",47.5,57],["renderWaitingToday js/schedule.js:188",21,25],["todayWaiting js/schedule.js:177",19.6,24],["(anonymous) js/schedule.js:179",15.3,18],["find js/tree.js:21",12.4,15],["o js/schedule.js:184",4,5],["(anonymous) js/schedule.js:183",4,5],["list js/today.js:143",2.8,3],["(garbage collector)",2.5,3],["(anonymous) js/schedule.js:184",2.2,3]]},"tick_today":{"sampledMs":175.1,"self":[["setHTML js/tree.js:418",46.4,26],["find js/tree.js:21",19.8,11],["stateJSON js/pics.js:125",13.2,8],["hashOf js/records.js:175",11.8,7],["recHash js/pics.js:174",6.6,4],["(garbage collector)",6.1,3],["saveSyncState js/records.js:189",5.3,3],["put",5.2,3],["canon js/records.js:166",4.9,3],["attentionItems js/ops.js:76",3.4,2],["shift js/state.js:24",3.4,2],["(anonymous) js/records.js:172",2.5,1],["markDirty js/records.js:220",2.3,1],["persistLocal js/state.js:441",2.3,1]],"total":[["click",166.7,95],["(anonymous) js/events.js:352",166.6,95],["settle js/tree.js:71",165.6,95],["renderAll js/events.js:6",103.2,59],["renderToday js/today.js:178",102.6,59],["renderView js/events.js:12",102.6,59],["drawToday js/today.js:209",102.5,59],["save js/state.js:455",59.8,34],["setHTML js/tree.js:418",46.4,26],["markDirty js/records.js:220",34.6,20],["renderWaitingToday js/schedule.js:188",32.4,19],["todayWaiting js/schedule.js:177",29.4,17],["recHash js/pics.js:174",25.7,15],["persistLocal js/state.js:441",21.5,12]]},"save":{"sampledMs":58,"self":[["stateJSON js/pics.js:125",15.3,26],["hashOf js/records.js:175",10.5,18],["canon js/records.js:166",9,16],["persistLocal js/state.js:441",3.7,6],["saveSyncState js/records.js:189",3.7,6],["put",3.4,6],["(anonymous) js/records.js:172",3,5],["(anonymous) js/pics.js:75",1.8,3],["markDirty js/records.js:220",1.7,3],["(anonymous) js/records.js:33",1.6,3],["(anonymous) js/records.js:240",1.6,3],["recHash js/pics.js:174",0.5,1],["(anonymous) js/records.js:53",0.4,1],["(anonymous) js/procedures.js:67",0.3,0]],"total":[["save js/state.js:455",57.8,100],["markDirty js/records.js:220",33.1,57],["(anonymous) js/records.js:240",24.6,42],["persistLocal js/state.js:441",23.9,41],["recHash js/pics.js:174",23.1,40],["hashOf js/records.js:175",22.5,39],["stateJSON js/pics.js:125",15.3,26],["canon js/records.js:166",12,21],["(anonymous) js/records.js:172",10.6,18],["writeKV js/pics.js:74",5.6,10],["(anonymous) js/pics.js:75",5.5,9],["saveSyncState js/records.js:189",4.6,8],["put",3.4,6],["toRecords js/records.js:30",2.2,4]]},"tab_today":{"sampledMs":181.1,"self":[["getBoundingClientRect",103.6,57],["setHTML js/tree.js:418",34,19],["find js/tree.js:21",16,9],["today js/state.js:23",2.9,2],["shift js/state.js:24",2.4,1],["renderWaitingToday js/schedule.js:188",1.6,1],["pad js/state.js:21",1.4,1],["todayWaiting js/schedule.js:177",1.3,1],["querySelectorAll",1.2,1],["attentionItems js/ops.js:76",1.2,1],["(garbage collector)",1.1,1],["list js/today.js:143",1.1,1],["isDone js/tree.js:5",1,1],["execRun js/ops.js:71",0.9,1]],"total":[["go js/events.js:40",179.5,99],["getBoundingClientRect",103.6,57],["drawToday js/today.js:209",74.1,41],["renderToday js/today.js:178",74.1,41],["renderView js/events.js:12",74.1,41],["setHTML js/tree.js:418",34,19],["renderWaitingToday js/schedule.js:188",26.4,15],["todayWaiting js/schedule.js:177",24.3,13],["find js/tree.js:21",16,9],["(anonymous) js/schedule.js:179",10.8,6],["waitBucket js/waiting.js:332",5.6,3],["o js/schedule.js:184",4.6,3],["(anonymous) js/schedule.js:183",4.6,3],["(anonymous) js/schedule.js:184",4.4,2]]},"tab_ops":{"sampledMs":106.4,"self":[["fadeTabs js/events.js:32",74.9,70],["find js/tree.js:21",7.2,7],["setHTML js/tree.js:418",3.8,4],["(anonymous) js/ops.js:73",2.4,2],["findWaitable js/waiting.js:30",2.3,2],["execRun js/ops.js:71",1.6,2],["spent js/tree.js:168",1.4,1],["(anonymous) js/ops.js:291",1.4,1],["opsOutcomes js/ops.js:257",1.2,1],["(anonymous) js/ops.js:223",1,1],["(anonymous) js/ops.js:220",0.8,1],["execFailures js/execs.js:103",0.7,1],["(anonymous) js/ops.js:275",0.6,1],["isDone js/tree.js:5",0.6,1]],"total":[["go js/events.js:40",105.9,100],["fadeTabs js/events.js:32",74.9,70],["renderOps js/ops.js:358",30.1,28],["renderView js/events.js:12",30.1,28],["opsOutcomes js/ops.js:257",16.2,15],["(anonymous) js/ops.js:291",10.8,10],["findWaitable js/waiting.js:30",9.4,9],["find js/tree.js:21",7.2,7],["opsComing js/ops.js:217",5.4,5],["execRun js/ops.js:71",4,4],["setHTML js/tree.js:418",3.8,4],["(anonymous) js/ops.js:220",3.1,3],["attentionItems js/ops.js:76",3,3],["(anonymous) js/ops.js:274",2.7,3]]},"tab_waiting":{"sampledMs":156.6,"self":[["fadeTabs js/events.js:32",132.3,84],["setHTML js/tree.js:418",15.4,10],["waitingRows js/waiting.js:383",1.1,1],["shift js/state.js:24",1.1,1],["querySelectorAll",1,1],["(anonymous) js/waiting.js:374",0.7,0],["waitingNodes js/waiting.js:19",0.6,0],["setIfChanged js/header.js:107",0.5,0],["(anonymous) js/waiting.js:387",0.5,0],["esc js/state.js:16",0.4,0],["dayLabel js/state.js:36",0.3,0],["today js/state.js:23",0.3,0],["querySelector",0.2,0],["renderHeader js/header.js:49",0.2,0]],"total":[["go js/events.js:40",156.2,100],["fadeTabs js/events.js:32",132.3,84],["renderWaiting js/waiting.js:349",21.3,14],["renderView js/events.js:12",21.3,14],["setHTML js/tree.js:418",15.4,10],["(anonymous) js/waiting.js:374",4.7,3],["waitingRows js/waiting.js:383",2.9,2],["(anonymous) js/waiting.js:387",1.4,1],["renderHeader js/header.js:49",1.2,1],["shift js/state.js:24",1.1,1],["querySelectorAll",1,1],["waitBucket js/waiting.js:332",0.9,1],["dayLabel js/state.js:36",0.8,0],["waitingNodes js/waiting.js:19",0.8,0]]},"tab_insights":{"sampledMs":47.5,"self":[["getBoundingClientRect",34.9,74],["setHTML js/tree.js:418",1.5,3],["go js/events.js:40",1.2,3],["daysBetween js/state.js:404",0.9,2],["$ js/state.js:15",0.7,1],["(anonymous)",0.6,1],["productivity js/analytics.js:50",0.5,1],["w js/analytics.js:402",0.5,1],["querySelector",0.4,1],["querySelectorAll",0.4,1],["waitingStats js/analytics.js:147",0.4,1],["(anonymous) js/analytics.js:161",0.4,1],["pctOf js/analytics.js:10",0.4,1],["setIfChanged js/header.js:107",0.3,1]],"total":[["go js/events.js:40",46.6,98],["getBoundingClientRect",34.9,74],["renderReview js/review.js:6",8.2,17],["renderView js/events.js:12",8.2,17],["renderInsights js/analytics.js:489",6.7,14],["insights js/analytics.js:191",4.8,10],["waitingStats js/analytics.js:147",2.4,5],["setHTML js/tree.js:418",1.5,3],["(anonymous) js/analytics.js:161",1.4,3],["productivity js/analytics.js:50",1.1,2],["findings js/analytics.js:336",1,2],["daysBetween js/state.js:404",0.9,2],["renderHeader js/header.js:49",0.8,2],["w js/analytics.js:402",0.8,2]]},"tab_forecast":{"sampledMs":46.1,"self":[["getBoundingClientRect",32.3,70],["spent js/tree.js:168",4.1,9],["renderHeader js/header.js:49",1.3,3],["stepsEstimated js/forecast.js:40",1.3,3],["setHTML js/tree.js:418",1.1,2],["forecastItems js/forecast.js:62",0.9,2],["querySelector",0.6,1],["querySelectorAll",0.6,1],["(anonymous) js/tree.js:170",0.5,1],["(anonymous)",0.5,1],["toggle",0.4,1],["renderForecast js/forecast.js:276",0.4,1],["renderReview js/review.js:6",0.3,1],["remEst js/forecast.js:42",0.2,1]],"total":[["go js/events.js:40",44.8,97],["getBoundingClientRect",32.3,70],["renderReview js/review.js:6",9.5,21],["renderView js/events.js:12",9.5,21],["renderForecast js/forecast.js:276",8.2,18],["allocate js/forecast.js:138",7.3,16],["forecastItems js/forecast.js:62",7.2,16],["(anonymous) js/forecast.js:68",6.3,14],["remEst js/forecast.js:42",6.2,13],["spent js/tree.js:168",4.6,10],["renderHeader js/header.js:49",2.6,6],["stepsEstimated js/forecast.js:40",1.3,3],["setHTML js/tree.js:418",1.1,2],["querySelector",0.6,1]]},"tab_processes":{"sampledMs":66,"self":[["getBoundingClientRect",49.2,75],["setHTML js/tree.js:418",4.3,6],["byName js/knowledge.js:11",2.6,4],["kbProcesses js/create.js:118",2.1,3],["shift js/state.js:24",1.3,2],["kbActivity js/create.js:42",1,1],["activityRow js/create.js:50",0.8,1],["wfRuns js/workflows.js:1178",0.7,1],["wfOpenRun js/workflows.js:1180",0.4,1],["esc js/state.js:16",0.4,1],["timerTick js/focus.js:345",0.4,1],["latestExec js/execs.js:95",0.3,0],["querySelector",0.3,0],["(anonymous)",0.2,0]],"total":[["go js/events.js:40",65.4,99],["getBoundingClientRect",49.2,75],["renderView js/events.js:12",15.4,23],["renderKnowledge js/knowledge.js:110",15.3,23],["kbProcesses js/create.js:118",10.9,16],["setHTML js/tree.js:418",4.3,6],["processRow js/create.js:162",2.8,4],["byName js/knowledge.js:11",2.6,4],["(anonymous) js/create.js:121",1.9,3],["dayLabel js/state.js:36",1.4,2],["shift js/state.js:24",1.3,2],["activityRow js/create.js:50",1.2,2],["kbFlows js/knowledge.js:142",1.1,2],["kbActivity js/create.js:42",1,1]]},"search_key":{"sampledMs":40.6,"self":[["byName js/knowledge.js:11",12,30],["(anonymous) js/search.js:170",6.6,16],["typedSearch js/search.js:20",5.2,13],["(garbage collector)",4.5,11],["searchResults js/search.js:52",1.8,4],["(anonymous)",1.4,3],["(anonymous) js/search.js:67",1.2,3],["esc js/state.js:16",1.2,3],["w js/search.js:66",1.1,3],["shift js/state.js:24",1.1,3],["has js/search.js:57",0.6,2],["(anonymous) js/search.js:163",0.5,1],["flat js/search.js:41",0.3,1],["kbTrail js/knowledge.js:73",0.3,1]],"total":[["dispatchEvent",34.4,85],["(anonymous) js/events.js:325",34.3,84],["typedSearch js/search.js:20",34.1,84],["searchResults js/search.js:52",28.9,71],["byName js/knowledge.js:11",12,30],["(anonymous) js/search.js:111",11.4,28],["(anonymous) js/search.js:170",6.6,16],["(garbage collector)",4.5,11],["w js/search.js:66",4.1,10],["(anonymous) js/search.js:67",3.5,9],["(anonymous) js/search.js:163",2.3,6],["day js/search.js:58",1.8,4],["dayLabel js/state.js:36",1.6,4],["shift js/state.js:24",1.3,3]]},"applyRows500":{"sampledMs":217.8,"self":[["setHTML js/tree.js:418",66.9,31],["find js/tree.js:21",22.9,11],["put",16.2,7],["hashOf js/records.js:175",13.9,6],["stateJSON js/pics.js:125",12.2,6],["canon js/records.js:166",9.4,4],["(garbage collector)",7.2,3],["saveSyncState js/records.js:189",6,3],["(anonymous) js/ops.js:73",3.9,2],["(anonymous) js/records.js:172",3.5,2],["shift js/state.js:24",3.5,2],["persistLocal js/state.js:441",2.7,1],["(anonymous) js/records.js:33",2.6,1],["today js/state.js:23",2.2,1]],"total":[["applyRows js/sync.js:128",210.1,96],["renderAll js/events.js:6",120,55],["inBackground js/tree.js:399",120,55],["renderToday js/today.js:178",118.8,55],["renderView js/events.js:12",118.8,55],["drawToday js/today.js:209",118.7,54],["setHTML js/tree.js:418",68.5,31],["renderWaitingToday js/schedule.js:188",33.1,15],["todayWaiting js/schedule.js:177",31.6,14],["markDirty js/records.js:220",27.7,13],["recHash js/pics.js:174",27.5,13],["hashOf js/records.js:175",26.8,12],["(anonymous) js/schedule.js:179",24.6,11],["find js/tree.js:21",22.9,11]]}}}}}
```

</details>

<!-- bench:end -->
