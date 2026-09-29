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
