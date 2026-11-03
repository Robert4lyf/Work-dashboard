// Today shows each task's steps as a bar, a block per step.
const { test, expect } = require('./fixtures');

test.beforeEach(async ({ page, app }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
});
const bars = page =>
  page.$$eval('#v-today .row', rows =>
    rows.map(r => {
      const b = r.querySelector('.stepbar');
      return [
        r.querySelector('.open > span').textContent,
        b && b.getAttribute('aria-label'),
        b && [...b.children].map(i => i.className.replace('s-', '') || '-').join(' '),
      ];
    }),
  );

test("each task with steps shows a bar: done, next, waiting, to do, and what's next", async ({
  app,
  page,
}) => {
  await app.setState(s => {
    const k = (id, done, extra = {}) => ({ id, text: id, done, children: [], ...extra });
    s.quests = [
      {
        id: 'q1',
        text: 'Budget',
        children: [
          k('c', false),
          k('d', false, { wait: { who: 'Jo', note: '', due: '', since: '2026-09-20' } }),
          k('e', false),
          k('o', false, { opt: true }), // (optional: not in the bar)
          k('a', true),
          k('b', true),
        ],
      },
      { id: 'q2', text: 'Asking', children: [k('f', true)] },
      { id: 'q3', text: 'Optional left', children: [k('g', true), k('h', false, { opt: true })] },
      { id: 'q4', text: 'Plain', children: [] },
      { id: 'q5', text: 'Long', children: Array.from({ length: 20 }, (_, i) => k('l' + i, i < 5)) },
    ];
  });
  await page.reload();
  expect(await bars(page)).toEqual([
    ['Asking', "1 of 1 steps done, what's next?", 'done ask'],
    ['Optional left', '1 of 1 steps done', 'done'],
    ['Plain', null, null],
    ['Long', '5 of 20 steps done', 'done done done done done next ' + Array(14).fill('-').join(' ')],
    ['Budget', '2 of 5 steps done, 1 waiting', 'done done next wait -'],
  ]);
  await expect(page.locator('.row:has-text("Long") .stepbar')).toHaveClass(/many/);
  await expect(page.locator('.row:has-text("Budget") .stepbar')).not.toHaveClass(/many/);

  // Ticking a step moves it along; reorder mode keeps the bars.
  await page.evaluate(() => {
    const bf = snapshot();
    find('l5').n.done = true;
    settle(bf);
  });
  expect((await bars(page))[3][1]).toBe('6 of 20 steps done');
  await page.click('#reorder');
  await expect(page.locator('#v-today .stepbar')).toHaveCount(4);
});

test('a finished task shows its full bar under Done today', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await app.addSub('Draft');
  await page.click('[aria-label="Mark done: Draft"]');
  await page.click('#sheet [data-sheetans="finish"]');
  await page.click('[data-crumb="-1"]');
  await page.click('#donesec summary');
  await expect(page.locator('#donesec .stepbar')).toHaveAttribute('aria-label', '1 of 1 steps done');
});
