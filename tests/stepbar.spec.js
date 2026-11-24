// How far a task's steps have got: a count on its card on the board, a bar on its own page.
// (The old Today list drew a bar of blocks, a block per step, on each row; the list is gone, and a
// step has no steps of its own, so no row carries that bar now.)
const { test, expect } = require('./fixtures');

test.beforeEach(async ({ page, app }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
});
// Each card: its name, its "N of M steps" (null without steps), and the steps it previews, a
// waiting one marked.
const cards = page =>
  page.$$eval('#v-projects .project-card', cs =>
    cs.map(c => {
      const m = [...c.querySelectorAll('.project-meta > span')].find(s => / steps$/.test(s.textContent));
      return [
        c.querySelector('.project-open > span').textContent,
        m ? m.textContent : null,
        [...c.querySelectorAll('.project-step')]
          .map(
            li =>
              li.querySelector('.project-step-name > span').textContent +
              (li.classList.contains('project-step-done') ? ' (done)' : '') +
              (li.querySelector('.project-step-clock') ? ' (waiting)' : ''),
          )
          .join(', '),
      ];
    }),
  );

test("each task with steps shows how far it's got: done, next, waiting, to do, and what's next", async ({
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
          k('o', false, { opt: true }),
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
  // The board: every step counted (an optional one too), the open ones first in the preview.
  expect(await cards(page)).toEqual([
    ['Budget', '2 of 6 steps', 'c, d (waiting), e'],
    ['Asking', '1 of 1 steps', 'f (done)'],
    ['Optional left', '1 of 2 steps', 'h, g (done)'],
    ['Plain', null, ''],
    ['Long', '5 of 20 steps', 'l5, l6, l7'],
  ]);
  const card = t => page.locator('#v-projects .project-card', { hasText: t });
  await expect(card('Budget').locator('.project-wait')).toHaveText('Waiting on Jo');
  await expect(card('Long').locator('.project-actions [data-open]')).toHaveText('17 more steps');
  await expect(card('Budget').locator('.project-actions [data-open]')).toHaveText('3 more steps');
  await expect(card('Plain').locator('.project-meta')).toHaveCount(0);

  // Its own page: a bar of the steps that count (not the optional one), what's next, and each
  // step's row, the waiting one marked.
  const page1 = async t => {
    await app.openQuest(t);
    const v = page.locator('#v-today');
    return [
      await v.locator('.prog > div').evaluate(e => e.style.width),
      await v.locator('.prog + .hint').textContent(),
      await v.locator('.qnext').textContent(),
    ];
  };
  expect(await page1('Budget')).toEqual(['40%', '2 / 5 complete + 1 optional', 'Nextc']);
  await expect(page.locator('#v-today .list .row .open > span')).toHaveText(['c', 'd', 'e', 'o', 'a', 'b']);
  await expect(page.locator('#v-today .list .row.waiting .open > span')).toHaveText(['d']);
  await expect(page.locator('#v-today .list .row.done .open > span')).toHaveText(['a', 'b']);
  await expect(page.locator('#v-today .list .stepbar')).toHaveCount(0); // (a step has no steps: no bar)
  expect(await page1('Asking')).toEqual(['100%', '1 / 1 complete', "NextEvery step is ticked: what's next?"]);
  expect(await page1('Optional left')).toEqual(['100%', '1 / 1 complete + 1 optional', 'Nexth']);
  expect(await page1('Long')).toEqual(['25%', '5 / 20 complete', 'Nextl5']);

  // Ticking a step moves it along, on the page and on the board.
  await page.evaluate(() => {
    const bf = snapshot();
    find('l5').n.done = true;
    settle(bf);
  });
  await expect(page.locator('#v-today .prog + .hint')).toHaveText('6 / 20 complete');
  await page.click('[data-crumb="-1"]');
  expect((await cards(page))[4]).toEqual(['Long', '6 of 20 steps', 'l6, l7, l8']);
});

test('a finished task shows its full count under Completed today', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await app.addSub('Draft');
  await page.click('[aria-label="Mark done: Draft"]');
  await page.click('#sheet [data-sheetans="finish"]');
  await page.click('[data-crumb="-1"]');
  const done = page.locator('#v-projects details[data-project-completed]');
  await expect(done.locator('summary')).toHaveText('Completed today 1');
  await done.locator('summary').click();
  expect(await cards(page)).toEqual([['Report', '1 of 1 steps', 'Draft (done)']]);
  await expect(done.locator('.project-card')).toHaveCount(1);
});
