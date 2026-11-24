const { test, expect } = require('./fixtures');

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test.beforeEach(async ({ app }) => {
    await app.open();
    for (const t of ['A', 'B', 'C']) await app.addQuest(t);
  });
  // A project's page, with three steps to drag.
  const steps = async app => {
    await app.openQuest('A');
    for (const t of ['One', 'Two', 'Three']) await app.addSub(t);
  };
  const row = (page, t) => page.locator(`#v-today .row:has(.open > span:text-is("${t}"))`);
  const shown = page => page.locator('#v-today .list .row .open > span');
  const stored = page => page.evaluate(() => S.quests.find(q => q.text === 'A').children.map(c => c.text));

  test('Projects and Inbox are separate pages, and Focus isn’t shown beside them', async ({ page }) => {
    await expect(page.locator('#v-projects')).toBeVisible();
    await expect(page.locator('#v-inbox')).toBeHidden();
    await expect(page.locator('#v-focus')).toBeHidden();
    await page.click('nav [data-v=inbox]');
    await expect(page.locator('#v-inbox')).toBeVisible();
    await expect(page.locator('#v-projects')).toBeHidden();
    await expect(page.locator('#v-today')).toBeHidden();
    await expect(page.locator('#v-focus')).toBeHidden();
  });

  test('drag a project’s steps on its page to reorder them', async ({ app, page }) => {
    await steps(app);
    await expect(page.locator('#v-today .row[draggable="true"]')).toHaveCount(3);
    await row(page, 'Three').dragTo(row(page, 'One'), { targetPosition: { x: 20, y: 5 } });
    await expect(shown(page)).toHaveText(['Three', 'One', 'Two']);
    expect(await stored(page)).toEqual(['Three', 'One', 'Two']);
    // (the board's cards are not dragged this way: projects keep their order)
    expect(await app.order()).toEqual(['A', 'B', 'C']);
    expect(await page.evaluate(() => recommend()?.n.text)).toBe('Three');
  });

  test('a waiting step keeps its place; dragging the rest goes round it; no drop among the finished ones', async ({
    app,
    page,
  }) => {
    await steps(app);
    await app.setState(
      s =>
        (s.quests.find(q => q.text === 'A').children[0].wait = {
          who: 'Sam',
          note: '',
          due: '',
          since: '2026-09-23',
        }),
    );
    await page.reload();
    await app.openQuest('A');
    await expect(shown(page)).toHaveText(['One', 'Two', 'Three']);
    await expect(row(page, 'One')).toHaveClass(/waiting/);
    await row(page, 'Three').dragTo(row(page, 'Two'), { targetPosition: { x: 20, y: 5 } });
    await expect(shown(page)).toHaveText(['One', 'Three', 'Two']);
    expect(await stored(page)).toEqual(['One', 'Three', 'Two']);
    // A finished step is shown last: an open one dropped on it stays where it was.
    await page.click('#v-today [aria-label="Mark done: Two"]');
    await expect(shown(page)).toHaveText(['One', 'Three', 'Two']);
    await row(page, 'One').dragTo(row(page, 'Two'), { targetPosition: { x: 20, y: 30 } });
    await expect(shown(page)).toHaveText(['One', 'Three', 'Two']);
    expect(await stored(page)).toEqual(['One', 'Three', 'Two']);
  });

  test('a running session shows only itself until paused', async ({ page }) => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('z');
    await page.click('#v-zen [data-zstart]');
    await expect(page.locator('#v-zen')).toBeVisible();
    for (const s of ['header', 'nav', '#v-today', '#v-projects']) await expect(page.locator(s)).toBeHidden();
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
  await app.openQuest('A');
  await app.addSub('One');
  await expect(page.locator('#v-today .row')).toHaveCount(1);
  await expect(page.locator('#v-today .row')).not.toHaveAttribute('draggable', 'true');
  await page.click('nav [data-v=projects]');
  await expect(page.locator('#v-projects .project-card')).not.toHaveAttribute('draggable', 'true');
});
