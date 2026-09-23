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
    const fits = await page.$$eval(
      'nav button',
      bs =>
        bs.every(b => b.scrollWidth <= b.clientWidth) &&
        bs.at(-1).getBoundingClientRect().right <= innerWidth,
    );
    expect(fits).toBe(true);
    for (const v of ['today', 'inbox', 'focus', 'log', 'account']) {
      await app.go(v);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
