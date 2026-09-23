const { test, expect } = require('./fixtures');

test.describe('desktop board', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test.beforeEach(async ({ app, page }) => {
    await app.open();
    for (const t of ['A', 'B', 'C']) await app.addQuest(t);
    await page.fill('#iin', 'From inbox');
    await page.press('#iin', 'Enter');
  });

  test('Today, Inbox and Focus are shown side by side', async ({ page }) => {
    for (const id of ['#v-today', '#v-inbox', '#v-focus']) await expect(page.locator(id)).toBeVisible();
    const [t, i, f] = await Promise.all(
      ['#v-today', '#v-inbox', '#v-focus'].map(s => page.locator(s).boundingBox()),
    );
    expect(t.x < i.x && i.x < f.x).toBe(true);
    expect(Math.abs(t.y - f.y)).toBeLessThan(2);
  });

  test('History and Settings still get the whole page', async ({ app, page }) => {
    await app.go('log');
    await expect(page.locator('#v-today')).toBeHidden();
    await expect(page.locator('#v-log')).toBeVisible();
  });

  test('drag within Today to reorder', async ({ app, page }) => {
    const row = t => page.locator(`#v-today .row:has(.open > span:text-is("${t}"))`);
    const box = await row('A').boundingBox();
    await row('C').dragTo(row('A'), { targetPosition: { x: 20, y: 5 } });
    expect(await app.order()).toEqual(['C', 'A', 'B']);
    await expect(page.locator('#hnow b')).toHaveText('C');
    expect(box).toBeTruthy();
  });

  test('drag an inbox item into Today, a quest to Inbox, and a quest to Focus', async ({ app, page }) => {
    const row = t => page.locator(`#v-today .row:has(.open > span:text-is("${t}"))`);
    await page.locator('#v-inbox .item', { hasText: 'From inbox' }).dragTo(row('B'), {
      targetPosition: { x: 20, y: 5 },
    });
    expect(await app.order()).toEqual(['A', 'From inbox', 'B', 'C']);
    expect((await app.state()).inbox).toHaveLength(0);

    await row('C').dragTo(page.locator('#v-inbox'));
    expect((await app.state()).inbox.map(x => x.text)).toEqual(['C']);

    await row('B').dragTo(page.locator('#v-focus'));
    expect(await page.$eval('#fq', e => e.options[e.selectedIndex].text)).toBe('B');
  });
});

test('no dragging on phones', async ({ app, page }) => {
  await app.open();
  await app.addQuest('A');
  await expect(page.locator('#v-today .row')).not.toHaveAttribute('draggable', 'true');
});
