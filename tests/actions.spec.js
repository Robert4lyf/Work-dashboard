// Release A: quick actions: a row's ⋯ (and the quest page's) lists only the actions that fit.
const { test, expect } = require('./fixtures');

const labels = page => page.$$eval('#sheet .qact', bs => bs.map(b => b.firstChild.textContent));

test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) }); // (a Wednesday)
  await app.open();
  await page.evaluate(() => {
    S.quests = [
      fix({
        id: 'q1',
        text: 'Report',
        children: [fix({ id: 's1', text: 'Draft' }), fix({ id: 's2', text: 'Send' })],
      }),
      fix({ id: 'q2', text: 'Call Sam' }),
      fix({ id: 'q3', text: 'Old thing', done: true }),
    ];
    save();
    renderAll();
  });
});

test('each state offers its own set: open, with steps, done, every step ticked, waiting', async ({
  app,
  page,
}) => {
  await page.click('[aria-label="Actions: Report"]');
  await expect(page.locator('#sheet [role="dialog"], #sheet .sheetbox[role="dialog"]')).toHaveCount(1);
  expect(await labels(page)).toEqual([
    'Open',
    'Focus: Draft',
    'Add to Top 3',
    'Save my place',
    'Do tomorrow',
    'Do next week',
    'Move to Inbox',
    'Delete',
  ]);
  await page.keyboard.press('Escape');
  await page.click('[aria-label="Actions: Call Sam"]');
  expect(await labels(page)).toContain('Mark done');
  expect(await labels(page)).not.toContain('Resume work');
  await page.keyboard.press('Escape');
  // A finished quest: reopen or delete, nothing to focus on or schedule.
  await page.click('#donesec > summary');
  await page.click('[aria-label="Actions: Old thing"]');
  expect(await labels(page)).toEqual(['Open', 'Mark not done', 'Delete']);
  await page.keyboard.press('Escape');
  // Every step ticked: finish it.
  await page.evaluate(() => {
    S.quests[0].children.forEach(c => (c.done = true));
    S.quests[0].asked = 1;
    save();
    renderAll();
  });
  await page.click('[aria-label="Actions: Report"]');
  expect(await labels(page)).toContain('Finish quest');
  expect(await labels(page).then(l => l.filter(x => x.startsWith('Focus')))).toEqual([]);
  await page.click('#sheet [data-finish]');
  expect((await app.state()).quests.find(q => q.text === 'Report').done).toBe(true);
});

test('the actions act, with feedback and Undo; the sheet closes; scheduling uses the real dates', async ({
  app,
  page,
}) => {
  await page.click('[aria-label="Actions: Report"]');
  await page.click('#sheet [data-sched]:has-text("Do next week")');
  await expect(page.locator('#sheet')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('Moved to Mon 28 Sep');
  let s = await app.state();
  expect(s.later[0]).toMatchObject({ text: 'Report', start: '2026-09-28' });
  await page.click('[aria-label="Actions: Call Sam"]');
  await page.click('#sheet [data-sched]:has-text("Do tomorrow")');
  s = await app.state();
  expect(s.later.map(x => x.start)).toEqual(['2026-09-24', '2026-09-28']);
  // Mark done from the sheet; the quest folds into Done today.
  await page.click('#upd > summary');
  await page.click('#upd [data-now] >> nth=0');
  await page.click('[aria-label="Actions: Call Sam"]');
  await page.click('#sheet [data-toggle]');
  await expect(page.locator('#donesec')).toContainText('Call Sam');
  // Delete with Undo.
  await page.click('#donesec > summary');
  await page.click('[aria-label="Actions: Call Sam"]');
  await page.click('#sheet [data-delnow]');
  await expect(page.locator('#toast')).toContainText('Deleted Call Sam');
  await page.click('#undo');
  expect((await app.state()).quests.map(q => q.text)).toContain('Call Sam');
});

test('keyboard and screen reader: the sheet is a dialog, Tab stays useful, Escape and back close it', async ({
  app,
  page,
}) => {
  await page.focus('[aria-label="Actions: Report"]');
  expect(await page.getAttribute('[aria-label="Actions: Report"]', 'aria-haspopup')).toBe('dialog');
  await page.keyboard.press('Enter');
  const box = page.locator('#sheet .sheetbox');
  await expect(box).toHaveAttribute('role', 'dialog');
  await expect(box).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#sheettitle')).toHaveText('Report');
  // The first action has the keyboard; Tab stays inside the sheet; Enter on an action runs it.
  expect(await page.evaluate(() => document.activeElement.textContent)).toBe('Open');
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.activeElement.textContent)).toBe('Cancel');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.textContent)).toBe('Open');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#v-zen .zt')).toHaveText('Draft');
  await page.keyboard.press('Escape');
  // Android back closes a sheet and stays in the app.
  await page.click('[aria-label="Actions: Report"]');
  await page.goBack();
  await expect(page.locator('#sheet')).toHaveCount(0);
  await expect(page.locator('#v-today .row')).toHaveCount(3);
  // Shortcuts are off while a sheet is up (a stray key can't change tabs under it).
  await page.click('[aria-label="Actions: Report"]');
  await page.keyboard.press('i');
  await expect(page.locator('#v-today')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a sync redraw while a sheet is up leaves it; an action on a quest removed meanwhile does nothing', async ({
  app,
  page,
}) => {
  await page.click('[aria-label="Actions: Call Sam"]');
  await page.evaluate(() => inBackground(renderAll));
  await expect(page.locator('#sheet .sheetbox')).toBeVisible();
  await page.evaluate(() => {
    S.quests = S.quests.filter(q => q.text !== 'Call Sam');
    save();
    inBackground(renderAll);
  });
  await page.click('#sheet [data-toggle]');
  await expect(page.locator('#sheet')).toHaveCount(0);
  expect((await app.state()).quests.map(q => q.text)).toEqual(['Report', 'Old thing']);
  // Rapid double taps on ⋯ open one sheet, not two. (Both taps on the button itself: with the
  // page's height, a second tap at the same spot could land on the sheet that the first opened.)
  await page.evaluate(() => {
    const b = document.querySelector('[aria-label="Actions: Report"]');
    b.click();
    b.click();
  });
  await expect(page.locator('#sheet')).toHaveCount(1);
  await expect(page.locator('#sheettitle')).toHaveText('Report');
});

test('the board’s tiles and a quest page’s steps have the same ⋯; drag-to-reorder still works on desktop', async ({
  app,
  page,
}) => {
  await page.click('[data-tview="board"]');
  await expect(page.locator('.qtile [data-qact]')).toHaveCount(3);
  await page.click('.qtile [data-qact="q2"]');
  expect(await labels(page)).toContain('Mark done');
  await page.keyboard.press('Escape');
  await page.click('[data-tview="list"]');
  // Desktop: the ⋯ doesn't get in the way of dragging rows.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => renderAll());
  const rows = page.locator('#v-today .row[data-drag]');
  await expect(rows).toHaveCount(3);
  await rows.nth(1).dragTo(rows.nth(0), { targetPosition: { x: 10, y: 5 } });
  expect(await app.order()).toEqual(['Call Sam', 'Report', 'Old thing']);
});
