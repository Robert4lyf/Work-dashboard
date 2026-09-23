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
    for (const v of ['today', 'inbox', 'focus', 'log', 'account']) {
      await app.go(v);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // The current tab is scrolled fully into view.
      const box = await page.locator(`nav [data-v=${v}]`).boundingBox();
      expect(box.x >= 0 && box.x + box.width <= width).toBe(true);
    }
  });
}

test('on a phone the tab strip scrolls, with a fade hinting at hidden tabs', async ({ app, page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await app.open();
  const cls = () => page.$eval('#tabs', t => [...t.classList].filter(c => c.startsWith('more-')).join(' '));
  expect(await cls()).toBe('more-right');
  await app.go('account');
  await expect(page.locator('nav [data-v=account]')).toHaveText('Settings');
  expect(await cls()).toBe('more-left');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => fadeTabs());
  expect(await cls()).toBe('');
});
