// Release H, checkpoint 4: interaction polish. Back (Android's gesture, history.back()) returns to
// where a page was opened from, with the scroll and the keyboard where they were; a sheet with
// words typed into it asks before closing; a reload keeps your place.
const { test, expect } = require('./fixtures');
const { gDay } = require('./releasegdata');

async function day(app, page, more) {
  await page.clock.install({ time: new Date(2026, 10, 4, 11, 0) });
  await app.open();
  await app.setState(gDay);
  if (more) await app.setState(more);
  await page.reload({ keepPlace: true });
}
// The back gesture, and the app's own step for it done.
const back = page =>
  page.evaluate(
    () =>
      new Promise(r => {
        addEventListener('popstate', () => setTimeout(r, 0), { once: true });
        history.back();
      }),
  );
const where = page =>
  page.evaluate(() => ({
    view,
    path: [...path],
    wfOpen,
    kbArt,
    wfView,
    setSub,
    reviewSub,
    y: Math.round(scrollY),
    focus:
      document.activeElement && document.activeElement.dataset ? { ...document.activeElement.dataset } : null,
  }));
// (on Today, under Upcoming, the row of one task, and whether it's on the screen)
const upRowShown = (page, id) =>
  page.evaluate(id => {
    const r = document.querySelector(`#upd [data-upid="${id}"]`);
    if (!r || !r.checkVisibility()) return false;
    const b = r.getBoundingClientRect();
    return b.top >= 0 && b.bottom <= innerHeight;
  }, id);

test.describe('Checkpoint 4: back, scroll, focus, sheets', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('an Upcoming task from the forecast, the Waiting Centre or Search opens at its row; back returns', async ({
    app,
    page,
  }) => {
    await day(app, page, s => {
      s.later[0].wait = { who: 'Board', note: '', due: '2026-11-04', since: '2026-11-03' };
    });
    // 1. The forecast: its entry for an Upcoming task did nothing.
    await page.evaluate(() => {
      reviewSub = 'forecast';
      go('review');
    });
    await page.click('#v-review [data-fday="2026-11-05"]');
    await page.click('#v-review [data-open="m4"]');
    expect((await where(page)).view).toBe('today');
    await expect(page.locator('#upd')).toHaveAttribute('open', '');
    expect(await upRowShown(page, 'm4')).toBe(true);
    await expect(page.locator('#toast')).toContainText('On Upcoming: Board briefing');
    await back(page);
    expect(await where(page)).toMatchObject({ view: 'review', reviewSub: 'forecast' });
    await expect(page.locator('#v-review [data-open="m4"]').first()).toBeVisible();

    // 2. The Waiting Centre: Today at the top with Upcoming far below, and back left the app.
    await page.evaluate(() => go('waiting'));
    await page.click('#v-waiting .row .open[data-goupd]');
    expect(await upRowShown(page, 'm4')).toBe(true);
    await back(page);
    expect((await where(page)).view).toBe('waiting');
    expect((await where(page)).focus).toHaveProperty('goupd');

    // ...and Search, with its words still there.
    await page.click('#searchBtn');
    await page.fill('#sq', 'briefing');
    await page.click('#v-search [data-goupd="m4"]');
    expect(await upRowShown(page, 'm4')).toBe(true);
    await back(page);
    expect((await where(page)).view).toBe('search');
    await expect(page.locator('#sq')).toHaveValue('briefing');
    await expect(page.locator('#v-search [data-goupd="m4"]')).toBeVisible();
  });

  test('Search results that are not tasks come back to Search on back', async ({ app, page }) => {
    await day(app, page);
    const trip = async (q, sel, landed) => {
      await page.click('#searchBtn');
      await page.fill('#sq', q);
      await page
        .locator('#v-search ' + sel)
        .first()
        .click();
      expect(await where(page)).toMatchObject(landed);
      await back(page);
      expect((await where(page)).view, q).toBe('search');
      await expect(page.locator('#sq')).toHaveValue(q);
      await page.click('nav [data-v=today]');
    };
    const art = await page.evaluate(() => S.kb[0]);
    await trip(art.title, `[data-sart="${art.id}"]`, { view: 'knowledge', kbArt: art.id });
    const wf = await page.evaluate(() => S.workflows.find(w => !w.archived));
    await trip(wf.name, `[data-wfview="${wf.id}"]`, { view: 'knowledge', wfView: wf.id });
    const it = await page.evaluate(() => S.inbox[0].text);
    await trip(it, '[data-goto="inbox"]', { view: 'inbox' });
    // Further in (a process's run from its overview): back is a step at a time, then Search.
    await page.click('#searchBtn');
    await page.fill('#sq', wf.name);
    await page.click(`#v-search [data-wfview="${wf.id}"]`);
    await page.evaluate(id => startWorkflow(id), wf.id);
    expect((await where(page)).wfOpen).toBeTruthy();
    await back(page);
    expect(await where(page)).toMatchObject({ view: 'knowledge', wfView: wf.id, wfOpen: null });
    await back(page);
    expect((await where(page)).view).toBe('search');
    // A tab is a fresh start: back from there no longer leads to Search.
    await page.click(`#v-search [data-wfview="${wf.id}"]`);
    await page.click('nav [data-v=inbox]');
    await back(page);
    expect((await where(page)).view).toBe('today');
  });

  test('a process run: its task and Settings come back to the run; back from the run keeps the scroll', async ({
    app,
    page,
  }) => {
    await day(app, page, s => {
      s.track = false;
      const r = s.wruns.find(r => r.id === 'r3');
      r.q = 'q4';
      r.cur = 'm3';
      r.st.m2 = { o: 'done', at: Date.now() };
      delete r.live.run;
    });
    // From Today, scrolled down.
    await page.evaluate(() => scrollTo(0, 900));
    await page.evaluate(() => openWorkflowRun('r3'));
    // "For: <task>", then back: the run, then back: Today where it was.
    await page.click('#v-knowledge .kbtrail [data-open]');
    await expect(page.locator('#v-today [data-crumb="-1"]')).toHaveText('‹ Process');
    await back(page);
    expect(await where(page)).toMatchObject({ view: 'knowledge', wfOpen: 'r3' });
    // Settings: Automations, then back: the run again (not the Settings index, then Today).
    await page.click('#v-knowledge [data-gosec="execsec"]');
    expect(await where(page)).toMatchObject({ view: 'account', setSub: 'auto' });
    await back(page);
    expect(await where(page)).toMatchObject({ view: 'knowledge', wfOpen: 'r3' });
    await back(page);
    const w = await where(page);
    expect(w).toMatchObject({ view: 'today', wfOpen: null });
    expect(Math.abs(w.y - 900)).toBeLessThan(5);

    // The Command Centre, scrolled: the run's ‹ comes back to where it was, the keyboard on the
    // control that opened it.
    await page.evaluate(() => go('ops'));
    await page.evaluate(() => scrollTo(0, 400));
    const opener = page.locator('#v-ops [data-wfopen="r4"]').first();
    await opener.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => Math.round(scrollY));
    expect(y).toBeGreaterThan(100);
    await opener.click();
    await page.click('#v-knowledge [data-wfback]');
    const o = await where(page);
    expect(o.view).toBe('ops');
    expect(Math.abs(o.y - y)).toBeLessThan(5);
    expect(o.focus).toMatchObject({ wfopen: 'r4' });
  });

  test('up from a step by its crumb keeps the way back; a step opened on the page keeps it too', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.evaluate(() => go('waiting'));
    await page.click('#v-waiting .row .open[data-open="g6a"]');
    await page.click('#v-today [data-crumb="0"]');
    expect((await where(page)).path).toEqual(['g6']);
    await expect(page.locator('#v-today [data-crumb="-1"]')).toHaveText('‹ Waiting');
    await back(page);
    expect((await where(page)).view).toBe('waiting');
    // A task from the Waiting Centre, then one of its steps from its page: back, back, Waiting.
    await page.click('#v-waiting .row .open[data-open="g6a"]');
    await page.click('#v-today [data-crumb="0"]');
    await page.click('#v-today [data-open="g6a"]');
    await back(page);
    expect((await where(page)).path).toEqual(['g6']);
    await back(page);
    expect((await where(page)).view).toBe('waiting');
  });

  test('back to the list puts the keyboard on the task that was open, without moving the page', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const open = page.locator('#v-today .list .row[data-qid="g5"] .open');
    await open.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => Math.round(scrollY));
    await open.click();
    await back(page);
    const w = await where(page);
    expect(w.focus).toMatchObject({ open: 'g5' });
    expect(Math.abs(w.y - y)).toBeLessThan(5);
    await expect(open).toBeFocused();
    // From a step's page up to its task's: the step's row.
    await page.click('#v-today .list .row[data-qid="g2"] .open');
    await page.click('#v-today [data-open="g2s1"]');
    await back(page);
    await expect(page.locator('#v-today [data-open="g2s1"]').first()).toBeFocused();
  });

  test('a sheet with words typed in asks before back or a tap beside it closes it', async ({ app, page }) => {
    await day(app, page);
    // Nothing typed: back closes it, as before.
    await page.evaluate(() => openFollowUp('g6a', false));
    await expect(page.locator('#sheettitle')).toHaveText('Follow up');
    await back(page);
    await expect(page.locator('#sheet')).toHaveCount(0);
    // Typed: back asks, in the sheet; Keep editing keeps it all.
    await page.evaluate(() => openFollowUp('g6a', false));
    await page.fill('#funote', 'Emailed Emily twice');
    await back(page);
    await expect(page.locator('#sheetwarn')).toContainText('Discard what you typed?');
    await expect(page.locator('#funote')).toHaveValue('Emailed Emily twice');
    await page.click('#sheetwarn [data-sheetkeep]');
    await expect(page.locator('#sheetwarn')).toHaveCount(0);
    await expect(page.locator('#funote')).toBeFocused();
    // A tap beside it: asks, and leaves it up.
    await page.mouse.click(4, 4);
    await expect(page.locator('#sheetwarn')).toBeVisible();
    await expect(page.locator('#funote')).toHaveValue('Emailed Emily twice');
    // Back while it asks: it goes, nothing saved.
    await back(page);
    await expect(page.locator('#sheet')).toHaveCount(0);
    expect(await page.evaluate(() => S.follows.filter(f => f.note === 'Emailed Emily twice').length)).toBe(0);
    // Discard: it goes too. Cancel, its own button, still closes it straight away.
    await page.evaluate(() => openRuleEditor(''));
    await page.locator('#ruleform input').first().fill('My long rule name');
    await page.mouse.click(4, 4);
    await page.click('#sheetwarn [data-sheetdiscard]');
    await expect(page.locator('#sheet')).toHaveCount(0);
    await page.evaluate(() => openFollowUp('g6a', false));
    await page.fill('#funote', 'x');
    await page.click('#sheet .btn[data-sheetclose]');
    await expect(page.locator('#sheet')).toHaveCount(0);
    // Saved: no question.
    await page.evaluate(() => openFollowUp('g6a', false));
    await page.fill('#funote', 'Called Accounts');
    await page.click('#sheetok');
    await expect(page.locator('#sheet')).toHaveCount(0);
    expect(await page.evaluate(() => S.follows.some(f => f.note === 'Called Accounts'))).toBe(true);
  });

  test('a reload keeps your place: a task, a run; a task gone meanwhile is Today; a deep link wins', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.click('#v-today .list .row[data-qid="g2"] .open');
    await page.reload({ keepPlace: true });
    expect(await where(page)).toMatchObject({ view: 'today', path: ['g2'] });
    await expect(page.locator('#v-today [data-crumb="-1"]')).toBeVisible();
    await page.evaluate(() => openWorkflowRun('r3'));
    await page.reload({ keepPlace: true });
    expect(await where(page)).toMatchObject({ view: 'knowledge', wfOpen: 'r3' });
    await expect(page.locator('#v-knowledge [data-wfback]')).toHaveText('‹ Today');
    // The run is gone by the time the page comes back: Today.
    // (kept, then the run removed as another device would; the page going doesn't keep it again)
    await page.evaluate(() => {
      keepPlace();
      S.wruns = S.wruns.filter(r => r.id !== 'r3');
      save();
      window.appReady = false;
    });
    await page.reload({ keepPlace: true });
    expect(await where(page)).toMatchObject({ view: 'today', wfOpen: null, path: [] });
    // A task deleted meanwhile: Today's list.
    await page.click('#v-today .list .row[data-qid="g3"] .open');
    await page.evaluate(() => {
      keepPlace();
      S.quests = S.quests.filter(q => q.id !== 'g3');
      save();
      window.appReady = false;
    });
    await page.reload({ keepPlace: true });
    expect(await where(page)).toMatchObject({ view: 'today', path: [] });
    await expect(page.locator('#v-today .list')).toBeVisible();
    // A deep link wins over the place kept.
    await page.click('#v-today .list .row[data-qid="g5"] .open');
    await page.evaluate(() => (location.hash = '#/waiting'));
    await expect.poll(async () => (await where(page)).view).toBe('waiting');
    // (and opening the app at one, in the same tab)
    await page.click('nav [data-v=today]');
    expect(await where(page)).toMatchObject({ view: 'today', path: ['g5'] });
    await page.evaluate(() => (typeof storeDone === 'function' ? storeDone() : null));
    await page.goto('about:blank');
    await page.goto('/#/inbox');
    await page.waitForFunction(() => window.appReady === true);
    expect((await where(page)).view).toBe('inbox');
    expect(app.errors).toEqual([]);
  });
});
