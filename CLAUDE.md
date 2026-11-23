# Work dashboard: notes for Claude

## Always bug-hunt major changes

Almost every major change to this app has introduced bugs that the existing tests missed. So after
any major change (a new feature, a UI/layout rework, anything touching sync, storage, navigation or
the focus timer), run a bug-hunt round **before merging**:

- Probe the change in the running app with throwaway Playwright specs (`tests/zz-*.spec.js`,
  deleted afterwards): every button and state it touches, Android back (`history.back()`), a sync
  pull or background redraw arriving mid-action (sheets, typed text, open panels), reloads, and
  page errors.
- Probe at both sizes: a desktop window (1440×900: the sidebar, the board beside a project's page,
  centred dialogs, the keyboard shortcuts and Escape, right-click and hover) and a phone (390×844).
  The tests default to the phone size, so a desktop check has to set the viewport itself. Check a
  second tab open at the same time too (`context.newPage()`): a save in one must show in the other
  (`js/tabs.js`).
- For big changes, run several passes in parallel: a UI/interaction pass, a static code audit of
  the diff (callers of anything renamed, data-* attributes vs. handlers, CSS rules overridden later
  in the file), and a sync/state pass using the fake-Supabase harness in `tests/sync.spec.js`.
- Fix every confirmed bug with a regression test, then run the full suite (`npx playwright test`)
  and Prettier (`npx prettier --check js tests styles.css`).

Small, contained changes still get a quick check of the touched paths.

## Project basics

- Vanilla JS PWA, no build step. Scripts load in order from `index.html`; new `js/` files must also
  go in the `APP` list in `sw.js`.
- Tests: Playwright (`tests/`), served by `python3 -m http.server 4173`. If the pinned Playwright
  can't find its browser, run with a throwaway config (outside the repo) that spreads
  `playwright.config.js` and sets `use.launchOptions.executablePath` to an installed Chromium.
- The user works mostly on a computer (Chrome, a wide window, keyboard and mouse) and also uses the
  app on Android Chrome. Desktop-only behaviour lives in `js/desk.js` and the last section of
  `styles.css`; it must never change what a phone shows.
