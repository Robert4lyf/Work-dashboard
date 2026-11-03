const { test, expect } = require('./fixtures');
const { busyDay } = require('./busyday');
const dir = '/tmp/claude-0/-home-user-Work-dashboard/f8a2e18a-076c-519e-8fc5-1b6707b95353/scratchpad/after/';
test('cp3 shots', async ({ app, page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await app.open();
  await app.setState(busyDay);
  await page.evaluate(() => {
    const now = Date.now(),
      day = 864e5,
      t = today();
    S.execs.push({
      id: 'x4',
      flow: 'f1',
      at: now - 3 * day,
      status: 'failed',
      msg: 'Login',
      upd: now - 3 * day,
      ev: [],
    });
    S.log = [1, 2, 3, 4, 5, 6].map(i => ({
      id: 'z' + i,
      d: shift(t, -i),
      text: 'Done ' + i,
      trail: [],
      p: '',
      est: 60,
      m: 100,
    }));
    S.daily = { [t]: { work: 90 }, [shift(t, -1)]: { work: 30 } };
    S.quests[0].est = 120;
    S.quests[1].est = 60;
    S.quests[2].est = 300;
    save();
    renderAll();
  });
  await app.go('review');
  await page.click('[data-rsub="insights"]');
  await page.screenshot({ path: dir + 'insights.png', fullPage: true });
  await page.click('.ibars .ibar >> nth=29');
  await expect(page.locator('.ipick')).toBeVisible();
  await page.click('[data-rsub="forecast"]');
  await page.screenshot({ path: dir + 'forecast.png', fullPage: true });
  await page.click('.rday >> nth=0');
  await page.screenshot({ path: dir + 'forecast-day.png', fullPage: true });
  await page.click('[data-fspan="30"]');
  await page.selectOption('#fdaypick', { index: 2 });
  await expect(page.locator('.fday')).toBeVisible();
  expect(app.errors).toEqual([]);
});
