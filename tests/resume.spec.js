// Release A: interruption recovery: save where you stopped, come back to it later.
const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
  await page.clock.pauseAt(new Date(2026, 8, 23, 9, 0, 30));
  await page.evaluate(() => {
    S.quests = [
      fix({
        id: 'q1',
        text: 'Reconciliation',
        children: [fix({ id: 's1', text: 'March totals' }), fix({ id: 's2', text: 'April totals' })],
      }),
      fix({ id: 'q2', text: 'Call Sam' }),
    ];
    save();
    renderAll();
  });
});

test('pause and save my place from a running session: the timer pauses, the minutes are kept, the note is saved', async ({
  app,
  page,
}) => {
  await app.openQuest('Reconciliation');
  await page.click('.qfoot [data-zen]');
  await page.click('[data-zstart]');
  await page.clock.fastForward('07:00');
  await expect(page.locator('#v-zen [data-saveplace]')).toHaveText('Pause and save my place');
  await page.click('#v-zen [data-saveplace]');
  // The session is paused already (a cancel leaves it paused, nothing saved).
  expect((await app.state()).timer.left).not.toBeUndefined();
  await expect(page.locator('#sheettitle')).toHaveText('Save my place');
  await expect(page.locator('#sheet p').first()).toHaveText('At: March totals');
  await page.fill('#sheetin', 'Found a difference in March. Check supplier credits next.');
  await page.click('#sheetok');
  let s = await app.state();
  expect(s.quests[0].resume).toMatchObject({
    note: 'Found a difference in March. Check supplier credits next.',
    step: 's1',
  });
  expect(s.quests[0].resume.at).toBe(new Date(2026, 8, 23, 9, 7, 30).getTime());
  expect(s.timer.left).toBe(18 * 60000);
  // Shown in single-task mode, with the paused timer; stopping keeps the 7 minutes, once.
  await expect(page.locator('#v-zen .zplace')).toContainText('Check supplier credits next');
  await page.click('#v-zen [data-stop="save"]');
  s = await app.state();
  expect(s.timer).toBeNull();
  expect(s.sessions).toHaveLength(1);
  expect(s.daily['2026-09-23']['']).toBe(7);
  expect(s.quests[0].resume.note).toContain('supplier credits'); // (stopping keeps the place)
  // It survives a reload: the quest's row marks it, its page shows it, and search finds it.
  await page.reload();
  await expect(page.locator('#v-today .row', { hasText: 'Reconciliation' }).locator('.tag.place')).toHaveText(
    'Saved place',
  );
  await app.openQuest('Reconciliation');
  const card = page.locator('#placecard');
  await expect(card).toContainText('Where you left off');
  await expect(card).toContainText('Today 09:07');
  await expect(card.locator('.placestep')).toHaveText('At: March totals');
  await page.click('#searchBtn');
  await page.fill('#sq', 'supplier credits');
  await expect(page.locator('#sres .srow')).toContainText('saved place');
});

test('a place can be saved without a timer, from a quest’s actions or a step’s; it updates rather than doubles', async ({
  app,
  page,
}) => {
  await page.click('[aria-label="Actions: Reconciliation"]');
  await page.click('#sheet [data-saveplace]');
  await page.fill('#sheetin', 'Start with the bank export');
  await page.press('#sheetin', 'Enter'); // (Enter in the note is a new line, not a save)
  await expect(page.locator('#sheet .sheetbox')).toBeVisible();
  await page.click('#sheetok');
  let s = await app.state();
  expect(s.quests[0].resume).toMatchObject({ note: 'Start with the bank export', step: 's1' });
  expect(s.timer).toBeNull();
  // From a step's ⋯ on the quest's page: the place moves to that step, one place per quest.
  await app.openQuest('Reconciliation');
  await page.click('[data-qact="s2"]');
  await expect(page.locator('#sheet [data-saveplace]')).toHaveText('Update saved place');
  await page.click('#sheet [data-saveplace]');
  await expect(page.locator('#sheetin')).toHaveValue('Start with the bank export');
  await page.fill('#sheetin', 'April: wait for the bank');
  await page.click('#sheetok');
  s = await app.state();
  expect(s.quests[0].resume).toMatchObject({ note: 'April: wait for the bank', step: 's2' });
  // Shown on the step it points at, not on another step's page.
  await page.click('#v-today .open >> text="April totals"');
  await expect(page.locator('#placecard')).toBeVisible();
  await expect(page.locator('.qfoot [data-resume]')).toHaveText('Resume work');
  await page.click('[data-crumb="0"]');
  await page.click('#v-today .open >> text="March totals"');
  await expect(page.locator('#placecard')).toHaveCount(0);
  await expect(page.locator('.qfoot [data-resume]')).toHaveCount(0);
});

test('Resume work opens single-task mode on the saved step with the note; the place stays until cleared', async ({
  app,
  page,
}) => {
  await app.setState(s => (s.quests[0].resume = { note: 'Check credits', at: Date.now(), step: 's2' }));
  await page.reload();
  // From the top 3 row and the quest's page alike.
  await page.evaluate(() => setTop3(['q1']));
  await expect(page.locator('.t3row [data-resume]')).toHaveText('Resume');
  await page.click('.t3row [data-resume]');
  await expect(page.locator('#v-zen')).toBeVisible();
  await expect(page.locator('#v-zen .zt')).toHaveText('April totals');
  await expect(page.locator('#v-zen .zplace')).toContainText('Check credits');
  // Starting a session from there keeps the note in view.
  await page.click('[data-zstart]');
  await expect(page.locator('#v-zen .zplace')).toContainText('Check credits');
  expect((await app.state()).timer.q).toBe('s2');
  await page.click('#v-zen [data-discard]');
  await page.click('#v-zen [data-discard]');
  await page.click('#zenexit');
  // Clearing, with Undo.
  await app.openQuest('Reconciliation');
  await page.click('#placecard [data-clearplace]');
  await expect(page.locator('#placecard')).toHaveCount(0);
  expect((await app.state()).quests[0].resume).toBeUndefined();
  await page.click('#undo');
  await expect(page.locator('#placecard')).toBeVisible();
});

test('the interrupted step ticked, the quest finished, moved or deleted: no stale or invalid place', async ({
  app,
  page,
}) => {
  await app.setState(s => (s.quests[0].resume = { note: 'Check credits', at: Date.now(), step: 's1' }));
  await page.reload();
  // The step it pointed at is ticked: the note stays, says so, and Resume goes to the next step.
  await page.click('[aria-label="Actions: Reconciliation"]');
  await page.click('#sheet [data-open]');
  await page.click('[aria-label="Mark done: March totals"]');
  await expect(page.locator('#placecard .placestep')).toHaveText('At: March totals (ticked since)');
  await page.click('.qfoot [data-resume]');
  await expect(page.locator('#v-zen .zt')).toHaveText('April totals');
  await page.keyboard.press('Escape');
  // The step removed: the note still says where it was.
  await page.evaluate(() => {
    S.quests[0].children = S.quests[0].children.filter(c => c.id !== 's1');
    save();
    renderAll();
  });
  await expect(page.locator('#placecard .placestep')).toHaveText('At: a step since removed');
  // To the Inbox and back: the place travels with the quest.
  await page.click('[data-crumb="-1"]');
  await page.click('[aria-label="Actions: Reconciliation"]');
  await page.click('#sheet [data-toinbox]');
  expect((await app.state()).inbox[0].node.resume.note).toBe('Check credits');
  await app.go('inbox');
  await page.click('#v-inbox [data-promote] >> nth=0');
  await app.go('today');
  await expect(page.locator('#v-today .row .tag.place')).toHaveCount(1);
  // Finished: nothing to come back to.
  await app.openQuest('Reconciliation');
  await page.click('[aria-label="Mark done: April totals"]');
  await page.click('#sheet [data-sheetans="finish"]');
  expect((await app.state()).quests.find(q => q.text === 'Reconciliation').resume).toBeUndefined();
  await expect(page.locator('#v-today .tag.place')).toHaveCount(0);
  // Deleted (with Undo) and back: still there.
  await app.setState(
    s =>
      (s.quests.find(q => q.text === 'Call Sam').resume = {
        note: 'Ask about Friday',
        at: Date.now(),
        step: '',
      }),
  );
  await page.reload();
  await page.click('[aria-label="Actions: Call Sam"]');
  await page.click('#sheet [data-delnow]');
  await page.click('#undo');
  expect((await app.state()).quests.find(q => q.text === 'Call Sam').resume.note).toBe('Ask about Friday');
});

test('a repeat’s fresh copy never inherits a saved place; malformed places are dropped', async ({
  app,
  page,
}) => {
  await page.evaluate(() => {
    const q = S.quests[0];
    q.resume = { note: 'Stale from last week', at: Date.now(), step: 's1' };
    setRepeat(q, t => (t.days = [0, 1, 2, 3, 4, 5, 6]));
    S.quests = S.quests.filter(x => x !== q);
    S.day = shift(today(), -1);
    rollover();
    renderAll();
  });
  const fresh = (await app.state()).quests.find(q => q.text === 'Reconciliation');
  expect(fresh.resume).toBeUndefined();
  await app.setState(s => {
    s.quests[0].resume = { note: 42, at: 'x' };
    s.quests[1].resume = { note: '   ', at: Date.now(), step: '' };
  });
  await page.reload();
  const s = await app.state();
  expect(s.quests[0].resume).toBeUndefined();
  expect(s.quests[1].resume).toBeUndefined();
});

test('Save my place on the Focus tab; resuming a paused session on the same quest just resumes it', async ({
  app,
  page,
}) => {
  await app.go('focus');
  await page.selectOption('#fq', 'q2');
  await page.click('#start');
  await page.clock.fastForward('03:00');
  await page.click('#v-zen [data-pause]');
  await page.keyboard.press('Escape');
  await expect(page.locator('#v-focus [data-saveplace]')).toHaveText('Save my place');
  await page.click('#v-focus [data-saveplace]');
  await page.fill('#sheetin', 'Left a voicemail');
  await page.click('#sheetok');
  expect((await app.state()).quests[1].resume).toMatchObject({ note: 'Left a voicemail', step: '' });
  // On the quest's page: the session is paused, so the primary action is to resume it.
  await app.go('today');
  await app.openQuest('Call Sam');
  await expect(page.locator('.qfoot .btn:not(.qmore)')).toHaveText(['Resume focus']);
  await page.click('.qfoot [data-pause]');
  await expect(page.locator('#v-zen')).toBeVisible();
  const t = (await app.state()).timer;
  expect(t.left).toBeUndefined();
  expect(t.q).toBe('q2');
  // And Resume work on another quest while a session runs elsewhere is refused.
  await page.click('#v-zen [data-pause]');
  await page.keyboard.press('Escape');
  await app.setState(s => (s.quests[0].resume = { note: 'x', at: Date.now(), step: 's1' }));
  await page.reload();
  await page.click('[aria-label="Actions: Reconciliation"]');
  await page.click('#sheet [data-resume]');
  await expect(page.locator('#toast')).toContainText('running session');
  await expect(page.locator('#v-zen')).toBeHidden();
});

test('review fixes: the row mark stays a small tag; editing the note keeps the step and time; an empty place is refused', async ({
  app,
  page,
}) => {
  await app.setState(
    s => (s.quests[0].resume = { note: 'Check credits', at: Date.now() - 3600e3, step: 's2' }),
  );
  await page.reload();
  const tag = page.locator('#v-today .row .tag.place');
  const box = await tag.boundingBox();
  expect(box.height).toBeLessThan(30); // (not styled as the card on the quest's page)
  await app.openQuest('Reconciliation');
  await expect(page.locator('#placecard .placestep')).toHaveText('At: April totals');
  await page.click('#placecard [data-saveplace]');
  await page.fill('#sheetin', 'Check credits (typo fixed)');
  await page.click('#sheetok');
  let s = await app.state();
  expect(s.quests[0].resume.step).toBe('s2'); // (still the step it was on, not the first open one)
  await expect(page.locator('#placecard .placestep')).toHaveText('At: April totals');
  // The same note saved again: the time is left as it was.
  const at = s.quests[0].resume.at;
  await page.click('#placecard [data-saveplace]');
  await page.click('#sheetok');
  expect((await app.state()).quests[0].resume.at).toBe(at);
  // A quest without steps and no note: nothing to save.
  await page.click('[data-crumb="-1"]');
  await page.click('[aria-label="Actions: Call Sam"]');
  await page.click('#sheet [data-saveplace]');
  await page.click('#sheetok');
  await expect(page.locator('#toast')).toContainText('Write a note first');
  expect((await app.state()).quests[1].resume).toBeUndefined();
});
