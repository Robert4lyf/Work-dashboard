// Today as a board: lanes by stage, a tile per quest; the choice is the device's own.
const { test, expect } = require('./fixtures');

test.beforeEach(async ({ page, app }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
  await app.setState(s => {
    const k = (id, done, extra = {}) => ({ id, text: id, done, children: [], ...extra });
    const w = who => ({ who, note: '', due: '', since: '2026-09-20' });
    s.quests = [
      { id: 'q1', text: 'Walsingham', children: [k('Organise visits', false), k('a', true)] },
      { id: 'q2', text: 'Fletcher Way', children: [k('f', true), k('g', false, { wait: w('Laura') })] },
      { id: 'q3', text: 'Filbert Close', children: [k('h', false)] },
      { id: 'q4', text: 'Megan queries', children: [k('j', true)] },
      { id: 'q5', text: 'Call the bank', children: [] },
    ];
  });
  await page.reload();
});
const lanes = page =>
  page.$$eval('#v-today .blane', ls =>
    ls.map(l => [l.dataset.lane, [...l.querySelectorAll('.qtopen > span')].map(x => x.textContent)]),
  );

test('switch to the board: lanes by stage; the choice is kept over a reload, and back to the list', async ({
  app,
  page,
}) => {
  await expect(page.locator('[data-tview="list"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#v-today .blane')).toHaveCount(0);
  await page.click('[data-tview="board"]');
  expect(await lanes(page)).toEqual([
    ['doing', ['Walsingham']],
    ['ask', ['Megan queries']],
    ['todo', ['Filbert Close', 'Call the bank']],
    ['wait', ['Fletcher Way']],
  ]);
  await expect(page.locator('#reorder')).toHaveCount(0); // (no Reorder on the board)
  await expect(page.locator('#v-today .list .row')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-tview="board"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#v-today .blane')).toHaveCount(4);
  await page.click('[data-tview="list"]');
  await expect(page.locator('#v-today .blane')).toHaveCount(0);
  expect(await app.order()).toEqual([
    'Walsingham',
    'Filbert Close',
    'Megan queries',
    'Call the bank',
    'Fletcher Way',
  ]);
});

test('on the board: a tile opens its quest, back returns to the board; one without steps is ticked there', async ({
  app,
  page,
}) => {
  await page.click('[data-tview="board"]');
  await page.click('.qtopen:has-text("Walsingham")');
  await expect(page.locator('.node h1')).toHaveText('Walsingham');
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-today .blane')).toHaveCount(4);
  // (and the back gesture)
  await page.click('.qtopen:has-text("Walsingham")');
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-today .blane')).toHaveCount(4);
  await page.click('.qtile:has-text("Call the bank") .check');
  expect(await lanes(page)).toContainEqual(['done', ['Call the bank']]);
  expect((await app.state()).quests.find(q => q.id === 'q5').done).toBe(true);
  // The last step of a quest: asks what's next, as in the list.
  await page.click('.qtopen:has-text("Filbert Close")');
  await page.click('[aria-label="Mark done: h"]');
  await expect(page.locator('#sheettitle')).toHaveText("What's next?");
  await page.click('#sheet button:has-text("Later")');
  await page.click('[data-crumb="-1"]');
  expect(await lanes(page)).toContainEqual(['ask', ['Filbert Close', 'Megan queries']]);
});

test('a lane keeps where it was scrolled to over a background redraw', async ({ app, page }) => {
  await app.setState(s => {
    for (let i = 0; i < 6; i++) s.quests.push({ id: 'n' + i, text: 'New ' + i, children: [] });
  });
  await page.reload();
  await page.click('[data-tview="board"]');
  const lane = page.locator('.blane[data-lane="todo"] .lanetiles');
  await lane.evaluate(l => (l.scrollLeft = 300));
  const x = await lane.evaluate(l => l.scrollLeft);
  expect(x).toBeGreaterThan(100);
  await page.evaluate(() => inBackground(renderAll));
  expect(await lane.evaluate(l => l.scrollLeft)).toBe(x);
});
