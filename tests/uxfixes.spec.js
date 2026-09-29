// Bug hunt after the UX rework: the back gesture, Today's waiting section, keys under a sheet.
const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => {
  await app.open();
});

test('the back gesture from an article keeps the app open for the next one', async ({ app, page }) => {
  await app.setState(s => {
    s.kbcats = [{ id: 'c1', name: 'Processes', parent: '' }];
    s.kb = [{ id: 'a1', cat: 'c1', title: 'Weekly returns', body: 'Send by Friday.', imgs: [] }];
  });
  await app.go('knowledge');
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.locator('#v-knowledge .tile', { hasText: 'Processes' }).click();
  await page.locator('#v-knowledge .kbrow', { hasText: 'Weekly returns' }).click();
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Weekly returns');
  // Back: article → category → top level → Today, each step still inside the app.
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-knowledge .kbcatname')).toHaveText('Processes');
  expect(errors).toEqual([]);
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-knowledge .kbcatname')).toHaveCount(0);
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-today')).toBeVisible();
  expect(await page.evaluate(() => history.state && history.state.app)).toBe('in');
});

test("an Inbox item under Today's waiting section opens the Inbox", async ({ app, page }) => {
  await app.setState(s => {
    s.inbox = [
      { id: 'i1', text: 'Budget figures', wait: { who: 'Sam', note: '', chase: '' }, at: Date.now() },
    ];
  });
  await app.go('today');
  await page.click('#waitsec > summary');
  await page.click('#waitsec .open[data-v="inbox"]');
  await expect(page.locator('#v-inbox')).toBeVisible();
});

test('shortcut keys do nothing while a sheet is up', async ({ app, page }) => {
  await app.setState(s => {
    s.kbcats = [{ id: 'c1', name: 'Processes', parent: '' }];
  });
  await app.go('knowledge');
  await page.locator('#v-knowledge .tile', { hasText: 'Processes' }).click();
  await page.locator('#v-knowledge [data-kbnew]').click();
  await page.fill('#kbt', 'Half written');
  await page.evaluate(() => history.back()); // leaving the editor asks first
  await expect(page.locator('#sheetform')).toBeVisible();
  await page.keyboard.press('i');
  await expect(page.locator('#sheetform')).toBeVisible();
  await expect(page.locator('#v-inbox')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet')).toHaveCount(0);
  await expect(page.locator('#kbt')).toHaveValue('Half written');
});

// A sync pull rebuilds the state's objects: sheets and panels open meanwhile must still work.
const pullLike = page =>
  page.evaluate(() => {
    S.kbcats = S.kbcats.map(c => ({ ...c })); // (as fromRecords + norm do)
    norm(S);
    inBackground(renderAll);
  });

test('rename and sub-category sheets survive a sync pull while open', async ({ app, page }) => {
  await app.setState(s => {
    s.kbcats = [
      { id: 'c1', name: 'Processes', parent: '' },
      { id: 'c2', name: 'Other', parent: '' },
    ];
  });
  await app.go('knowledge');
  const v = page.locator('#v-knowledge');
  await v.locator('.tile', { hasText: 'Processes' }).click();
  await v.locator('[data-kbren]').click();
  await pullLike(page);
  await page.fill('#sheetin', 'Procedures');
  await page.click('#sheetok');
  await expect(v.locator('.kbcatname')).toHaveText('Procedures');
  expect((await app.state()).kbcats.find(c => c.id === 'c1').name).toBe('Procedures');

  // The parent deleted meanwhile: the new sub-category lands at the top level, visible.
  await v.locator('[data-kbsub]').click();
  await page.evaluate(() => {
    S.kbcats = S.kbcats.filter(c => c.id !== 'c1');
    norm(S);
    inBackground(renderAll);
  });
  await page.fill('#sheetin', 'Orphan');
  await page.click('#sheetok');
  await expect(v.locator('#kbtree .tile', { hasText: 'Orphan' })).toBeVisible();
  expect((await app.state()).kbcats.find(c => c.name === 'Orphan').parent).toBe('');
});

test('the Move choice is kept over a background redraw', async ({ app, page }) => {
  await app.setState(s => {
    s.kbcats = [
      { id: 'top', name: 'Top', parent: '' },
      { id: 'sub', name: 'Sub', parent: 'top' },
      { id: 'oth', name: 'Other', parent: '' },
    ];
  });
  await app.go('knowledge');
  const v = page.locator('#v-knowledge');
  await v.locator('.tile', { hasText: 'Top' }).click();
  await v.locator('.tile', { hasText: 'Sub' }).click();
  await v.locator('[data-kbmove]').click();
  await page.selectOption('#kbmv', 'oth');
  await pullLike(page);
  await expect(page.locator('#kbmv')).toHaveValue('oth');
  await page.click('[data-kbmvgo]');
  expect((await app.state()).kbcats.find(c => c.id === 'sub').parent).toBe('oth');
});
