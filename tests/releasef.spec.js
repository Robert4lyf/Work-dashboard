// Release F: mobile clarity, visual refinement and reliability.
const { test, expect } = require('./fixtures');
const { eDay } = require('./releaseedata');

async function day(app, page, at = new Date(2026, 10, 4, 11, 0)) {
  await page.clock.install({ time: at });
  await app.open();
  await app.setState(eDay);
  await page.reload();
}
const tops = page =>
  page.evaluate(() => {
    const y = s => {
      const e = document.querySelector(s);
      return e ? e.getBoundingClientRect().top + scrollY : null;
    };
    return {
      attn: y('#v-today .attn'),
      top3: y('#v-today .top3'),
      sched: y('#v-today .schedsec'),
      wait: y('#v-today .waitsec2'),
      tasks: y('#v-today .list'),
    };
  });

test.describe('Checkpoint 1: Today on a phone', () => {
  for (const [w, h] of [
    [320, 800],
    [360, 800],
    [390, 844],
    [412, 915],
  ])
    test(`${w}px: attention, Top 3, Scheduled, Waiting, then the list; nothing sideways`, async ({
      app,
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await day(app, page);
      const t = await tops(page);
      expect(t.attn).toBeLessThan(t.top3);
      expect(t.top3).toBeLessThan(t.sched);
      expect(t.sched).toBeLessThan(t.wait);
      // (Waiting above the list: a long day doesn't bury what you're chasing)
      expect(t.wait).toBeLessThan(t.tasks);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });

  test('390 × 844: Top 3 starts on the first screen, Waiting within the second', async ({ app, page }) => {
    await day(app, page);
    const t = await tops(page);
    // (measured before Release F: Top 3 at 527px, Waiting at 3036px, below the whole list)
    expect(t.top3).toBeLessThan(844 - 66 - 200);
    expect(t.wait).toBeLessThan(2 * 844 - 66);
  });

  test('a follow-up from Waiting in its new place still works; the list keeps its tasks', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const names = await page.$$eval('#v-today .list .row .open > span', x => x.map(e => e.textContent));
    await page.click('#v-today .waitsec2 [data-chase]');
    await expect(page.locator('#sheet')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      todayView = 'board';
      renderAll();
    });
    await expect(page.locator('#v-today .waitsec2 + .sechead')).toHaveCount(1);
    await page.evaluate(() => {
      todayView = 'list';
      renderAll();
    });
    expect(await page.$$eval('#v-today .list .row .open > span', x => x.map(e => e.textContent))).toEqual(
      names,
    );
  });

  test('a long name takes two lines in a list, and all of it on its page', async ({ app, page }) => {
    await app.open();
    const long =
      'Write up the quarterly supplier review notes and send them to everyone who was at the meeting';
    await app.addQuest(long);
    const span = page.locator('#v-today .list .row .open > span').first();
    const lh = parseFloat(await span.evaluate(e => getComputedStyle(e).lineHeight));
    expect((await span.boundingBox()).height).toBeLessThan(lh * 2.5);
    await expect(span).toHaveText(long);
  });
});
