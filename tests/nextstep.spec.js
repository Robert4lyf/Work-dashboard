// Steps turn up as a quest goes: ticking its last step asks what's next instead of finishing it.
const { test, expect } = require('./fixtures');

const setDay = async (page, y, m, d) => {
  await page.clock.setSystemTime(new Date(y, m - 1, d, 9));
  await page.reload();
};
const sheet = page => page.locator('#sheet');

test.beforeEach(async ({ page, app }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
  await app.addQuest('Contract');
  await app.openQuest('Contract');
  await app.addSub('Draft');
});

test('ticking the last step asks; Later keeps the quest open, on Today and the next day', async ({
  app,
  page,
}) => {
  await page.click('[aria-label="Mark done: Draft"]');
  await expect(page.locator('#sheettitle')).toHaveText("What's next?");
  let s = await app.state();
  expect(s.quests[0].done).toBe(false);
  expect(s.log.map(x => x.text)).toEqual(['Draft']); // (the step, not the quest)
  await page.click('#sheet button:has-text("Later")');
  await expect(sheet(page)).toHaveCount(0);
  // The quest's page asks too; Today's row says so, and the header points at it.
  await expect(page.locator('.nextask')).toBeVisible();
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-today .row .tag.asknext')).toBeVisible();
  await expect(page.locator('#donesec')).toHaveCount(0);
  await expect(page.locator('header .go b')).toHaveText("What's next?");
  await setDay(page, 2026, 9, 24);
  s = await app.state();
  expect(s.quests.map(q => q.text)).toEqual(['Contract']);
});

test('the sheet adds the next step, a reminder to work it out, or finishes the quest', async ({
  app,
  page,
}) => {
  await page.click('[aria-label="Mark done: Draft"]');
  await page.fill('#sheetin', 'Fix clause 4');
  await page.press('#sheetin', 'Enter');
  await expect(sheet(page)).toHaveCount(0);
  let s = await app.state();
  expect(s.quests[0].children.map(c => [c.text, c.done])).toEqual([
    ['Fix clause 4', false],
    ['Draft', true],
  ]);
  await expect(page.locator('.nextask')).toHaveCount(0);

  await page.click('[aria-label="Mark done: Fix clause 4"]');
  await page.click('#sheet [data-sheetans="unsure"]');
  s = await app.state();
  expect(s.quests[0].children[0]).toMatchObject({ text: 'Work out the next step', done: false });
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-today .row small')).toContainText('Next: Work out the next step');

  await app.openQuest('Contract');
  await page.click('[aria-label="Mark done: Work out the next step"]');
  await page.click('#sheet [data-sheetans="finish"]');
  s = await app.state();
  expect(s.quests[0].done).toBe(true);
  expect(s.log.map(x => x.text)).toContain('Contract');
  await expect(page.locator('[data-reopen]')).toBeVisible();
  await setDay(page, 2026, 9, 24);
  expect((await app.state()).quests).toHaveLength(0);
});

test("the quest page's buttons; un-ticking or adding a step reopens a finished quest", async ({
  app,
  page,
}) => {
  await page.click('[aria-label="Mark done: Draft"]');
  await page.click('#sheet button:has-text("Later")');
  await page.click('.nextask [data-unsure]');
  expect((await app.state()).quests[0].children.map(c => c.text)).toEqual([
    'Work out the next step',
    'Draft',
  ]);
  await page.click('[aria-label="Mark done: Work out the next step"]');
  await page.click('#sheet button:has-text("Later")');
  await page.click('.nextask [data-finish]');
  let s = await app.state();
  expect(s.quests[0].done).toBe(true);
  expect(s.log.filter(x => x.text === 'Contract')).toHaveLength(1);

  // Reopen: asks again on the page (no sheet), and is no longer logged.
  await page.click('[data-reopen]');
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('.nextask')).toBeVisible();
  expect((await app.state()).log.map(x => x.text)).not.toContain('Contract');
  await page.click('.nextask [data-finish]');

  // Un-ticking a step: not finished any more, and ticking it again asks rather than finishing.
  await page.click('[aria-label="Mark done: Draft"]');
  s = await app.state();
  expect(s.quests[0].done).toBe(false);
  await page.click('[aria-label="Mark done: Draft"]');
  await expect(page.locator('#sheettitle')).toHaveText("What's next?");
  expect((await app.state()).quests[0].done).toBe(false);
  await page.click('#sheet button:has-text("Later")');

  // Finished, then a step added: open again.
  await page.click('.nextask [data-finish]');
  await app.addSub('Send');
  s = await app.state();
  expect(s.quests[0].done).toBe(false);
  expect(s.log.map(x => x.text)).not.toContain('Contract');
});

test('the back gesture closes the sheet and leaves the quest asking', async ({ app, page }) => {
  await page.click('[aria-label="Mark done: Draft"]');
  await expect(sheet(page)).toHaveCount(1);
  await page.evaluate(() => history.back());
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('.nextask')).toBeVisible(); // (still on the quest's page)
  expect((await app.state()).quests[0].done).toBe(false);
});

test('a change from elsewhere while the sheet is up: its answer applies only if still asking', async ({
  app,
  page,
}) => {
  await page.click('[aria-label="Mark done: Draft"]');
  await page.fill('#sheetin', 'Half typed');
  // Another device adds a step meanwhile (arrives as a background redraw).
  await page.evaluate(() => {
    S.quests[0].children.push(fix({ id: 'x', text: 'From phone' }));
    inBackground(renderAll);
  });
  await expect(page.locator('#sheetin')).toHaveValue('Half typed');
  await page.click('#sheet [data-sheetans="finish"]');
  const s = await app.state();
  expect(s.quests[0].done).toBe(false);
  expect(s.quests[0].children.map(c => c.text).sort()).toEqual(['Draft', 'From phone']);
});

test('repeating quests still finish on their last tick', async ({ app, page }) => {
  await page.click('#mored > summary');
  await page.click('#rptd summary');
  await page.click('[data-rpreset="daily"]');
  await page.click('[aria-label="Mark done: Draft"]');
  await expect(sheet(page)).toHaveCount(0);
  expect(await page.evaluate(() => isDone(S.quests[0]))).toBe(true);
});

test('upgrading: a quest finished by its last tick before stays finished; others ask', async ({
  app,
  page,
}) => {
  await app.setState(s => {
    const k = (id, done) => ({ id, text: id, done, children: [] });
    s.quests = [
      { id: 'old', text: 'Old done', children: [k('o1', true)] },
      { id: 'new', text: 'Never logged', children: [k('n1', true)] },
    ];
    s.log = [{ id: 'old', d: today(), text: 'Old done', trail: [] }];
  });
  await page.reload();
  expect(await page.evaluate(() => S.quests.map(q => [q.id, isDone(q), needsNext(q)]).sort())).toEqual([
    ['new', false, true],
    ['old', true, false],
  ]);
  await expect(sheet(page)).toHaveCount(0); // (asks on the list, not with a sheet)
});
