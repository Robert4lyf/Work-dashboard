const { test, expect } = require('./fixtures');

for (const width of [320, 360, 390, 1280]) {
  test(`${width}px: tabs fit and nothing scrolls sideways`, async ({ app, page }) => {
    await page.setViewportSize({ width, height: 800 });
    await app.open();
    await app.go('inbox');
    for (let i = 0; i < 12; i++) {
      await page.fill('#iin', 'item ' + i);
      await page.press('#iin', 'Enter');
    }
    // Every tab shows its whole label; the bar may scroll sideways instead.
    const clipped = await page.$$eval(
      'nav button',
      bs => bs.filter(b => b.scrollWidth > b.clientWidth).length,
    );
    expect(clipped).toBe(0);
    for (const v of ['projects', 'inbox', 'knowledge', 'review', 'account']) {
      await app.go(v);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // The current tab is scrolled fully into view.
      const box = await page.locator(`nav [data-v=${v}]`).boundingBox();
      expect(box.x >= 0 && box.x + box.width <= width).toBe(true);
    }
  });
}

test('on a narrow phone the tab strip scrolls, with a fade hinting at hidden tabs', async ({ app, page }) => {
  // (Release D: whether all five fit at 320–360px depends on the device's font, so the scrolling
  // is checked where it can't fit with any font: a folded phone's 280px outer screen)
  await page.setViewportSize({ width: 280, height: 800 });
  await app.open();
  await page.evaluate(() => fadeTabs());
  const cls = () => page.$eval('#tabs', t => [...t.classList].filter(c => c.startsWith('more-')).join(' '));
  expect(await cls()).toBe('more-right');
  await app.go('account');
  await expect(page.locator('nav [data-v=account]')).toHaveText('Settings');
  expect(await cls()).toBe('more-left');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => fadeTabs());
  expect(await cls()).toBe('');
});

test('the page stays clear of the system bars (no viewport-fit=cover), so the tab bar keeps its height', async ({
  app,
  page,
}) => {
  await app.open();
  expect(await page.getAttribute('meta[name=viewport]', 'content')).not.toContain('viewport-fit=cover');
});

test.describe('a wide desktop', () => {
  const { eDay } = require('./releaseedata');
  test.use({ viewport: { width: 1440, height: 900 } });
  const box = (page, s) => page.locator(s).boundingBox();
  async function day(app, page) {
    await page.clock.install({ time: new Date(2026, 10, 4, 11, 0) });
    await app.open();
    await app.setState(eDay);
    await page.reload();
  }

  test('a card gone from under the keyboard leaves it on the board, not on the page', async ({
    app,
    page,
  }) => {
    await day(app, page);
    // (Team meeting, 10:30 and now past: ticked, its card goes to the folded "Completed today")
    await page.locator('#v-projects .project-card[data-qid="m1"] .check[data-toggle]').focus();
    await page.keyboard.press('Enter');
    expect((await app.state()).quests.find(q => q.id === 'm1').done).toBe(true);
    await expect(page.locator('#active-project-grid .project-card[data-qid="m1"]')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.activeElement !== document.body && !!document.activeElement.closest('#v-projects'),
      ),
    ).toBe(true);
  });

  test("a task's actions sit at the foot of the window, never over the page's end", async ({ app, page }) => {
    await app.open();
    await page.evaluate(() => {
      S.quests.push({ id: 'lq1', text: 'Aldenham query', children: [] });
      norm(S);
      renderAll();
    });
    await app.openQuest('Aldenham query');
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const f = await box(page, '.qfoot'),
      more = await box(page, '#v-today > details.more'),
      vh = await page.evaluate(() => innerHeight);
    expect(f.y + f.height).toBeLessThanOrEqual(vh + 1);
    // (no tab bar to clear on a desktop: at the end of the page it follows what's above it)
    expect(f.y).toBeGreaterThanOrEqual(more.y + more.height - 1);
  });

  test('single-task mode sits in the middle of the window, the sidebar gone', async ({ app, page }) => {
    await day(app, page);
    await page.evaluate(() => setZen(true));
    await expect(page.locator('nav')).toBeHidden();
    const z = await box(page, '#v-zen'),
      // (the page's width less the scrollbar's gutter)
      vw = await page.evaluate(() => document.body.getBoundingClientRect().width);
    expect(Math.abs(z.x + z.width / 2 - vw / 2)).toBeLessThan(2);
    await page.evaluate(() => setZen(false));
    await expect(page.locator('nav')).toBeVisible();
  });
});
