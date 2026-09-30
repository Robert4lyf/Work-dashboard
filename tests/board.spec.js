const { test, expect } = require('./fixtures');

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test.beforeEach(async ({ app, page }) => {
    await app.open();
    for (const t of ['A', 'B', 'C']) await app.addQuest(t);
    await app.go('today');
  });

  test('Today and Inbox are separate pages, and Focus isn’t shown beside them', async ({ page }) => {
    await expect(page.locator('#v-today')).toBeVisible();
    await expect(page.locator('#v-inbox')).toBeHidden();
    await expect(page.locator('#v-focus')).toBeHidden();
    await page.click('nav [data-v=inbox]');
    await expect(page.locator('#v-inbox')).toBeVisible();
    await expect(page.locator('#v-today')).toBeHidden();
    await expect(page.locator('#v-focus')).toBeHidden();
  });

  test('drag within Today to reorder', async ({ app, page }) => {
    const row = t => page.locator(`#v-today .row:has(.open > span:text-is("${t}"))`);
    await row('C').dragTo(row('A'), { targetPosition: { x: 20, y: 5 } });
    expect(await app.order()).toEqual(['C', 'A', 'B']);
    await expect(page.locator('#hnow b')).toHaveText('C');
  });

  test('a waiting quest (shown lower down) can only be dropped among the waiting ones', async ({
    app,
    page,
  }) => {
    await app.setState(s => (s.quests[0].wait = { who: 'Sam', note: '', due: '', since: '2026-09-23' }));
    await page.reload();
    const row = t => page.locator(`#v-today .row:has(.open > span:text-is("${t}"))`);
    await expect(page.locator('#v-today .list .row .open > span')).toHaveText(['B', 'C', 'A']);
    await row('C').dragTo(row('A'), { targetPosition: { x: 20, y: 5 } }); // across groups: ignored
    expect((await app.state()).quests.map(q => q.text)).toEqual(['A', 'B', 'C']);
    await row('C').dragTo(row('B'), { targetPosition: { x: 20, y: 5 } }); // within: reorders
    await expect(page.locator('#v-today .list .row .open > span')).toHaveText(['C', 'B', 'A']);
  });

  test('a running session shows only itself until paused', async ({ page }) => {
    await page.click('header [data-zen]');
    await page.click('#v-zen [data-zstart]');
    await expect(page.locator('#v-zen')).toBeVisible();
    for (const s of ['header', 'nav', '#v-today']) await expect(page.locator(s)).toBeHidden();
    await expect(page.locator('#zenexit')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('t');
    await expect(page.locator('nav')).toBeHidden();
    await page.click('#v-zen [data-pause]');
    await page.click('#zenexit');
    await expect(page.locator('nav')).toBeVisible();
  });
});

test('no dragging on phones', async ({ app, page }) => {
  await app.open();
  await app.addQuest('A');
  await expect(page.locator('#v-today .row')).not.toHaveAttribute('draggable', 'true');
});
