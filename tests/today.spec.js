const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => app.open());

test('completing a quest logs it, sinks it and moves Next up', async ({ app, page }) => {
  for (const t of ['A', 'B', 'C']) await app.addQuest(t);
  await expect(page.locator('#hnow b')).toHaveText('A');
  await page.click('[aria-label="Mark done: A"]');
  expect(await app.order()).toEqual(['B', 'C', 'A']);
  await expect(page.locator('#hnow b')).toHaveText('B');
  expect((await app.state()).log.map(x => x.text)).toEqual(['A']);
  await page.click('[aria-label="Mark done: A"]');
  expect((await app.state()).log).toEqual([]);
  expect(await app.order()).toEqual(['B', 'C', 'A']);
});

test('reorder: Top makes a quest Next up; open items stay above done ones', async ({ app, page }) => {
  for (const t of ['A', 'B', 'C']) await app.addQuest(t);
  await page.click('[aria-label="Mark done: A"]');
  await page.click('#reorder');
  await page.click('[data-top]:not([disabled]) >> nth=0');
  expect(await app.order()).toEqual(['C', 'B', 'A']);
  await expect(page.locator('#hnow b')).toHaveText('C');
  const bDownDisabled = await page.evaluate(
    () =>
      [...document.querySelectorAll('#v-today .row')]
        .find(r => r.querySelector('.open>span').textContent === 'B')
        .querySelector('[data-down]').disabled,
  );
  expect(bDownDisabled).toBe(true);
  await expect(page.locator('.row.done [data-top]')).toHaveCount(0);
});

test('subquests: next step, sinking, and header tick', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await app.addSub('Draft');
  await app.addSub('Review');
  await expect(page.locator('#hnow')).toContainText('Next up in Report');
  await page.click('header .check');
  await expect(page.locator('#hnow b')).toHaveText('Review');
  expect(await app.order()).toEqual(['Review', 'Draft']);
});

test('× offers Inbox or Delete; delete can be undone', async ({ app, page }) => {
  await app.addQuest('Email Bob');
  await app.addQuest('Plan trip');
  const row = page.locator('#v-today .row', { hasText: 'Email Bob' });
  // Tapping elsewhere closes the choice without doing anything.
  await row.locator('[aria-label="Remove Email Bob"]').click();
  await expect(row.locator('.xchoice button')).toHaveText(['Inbox', 'Delete']);
  await page.click('#v-today h2');
  await expect(row.locator('.xchoice')).toHaveCount(0);
  expect((await app.state()).quests).toHaveLength(2);

  await row.locator('[aria-label="Remove Email Bob"]').click();
  await row.locator('[data-delnow]').click();
  expect((await app.state()).quests.map(q => q.text)).toEqual(['Plan trip']);
  await page.click('#undo');
  expect((await app.state()).quests).toHaveLength(2);

  await page.locator('[aria-label="Remove Plan trip"]').click();
  await page.locator('#v-today [data-toinbox]').click();
  const s = await app.state();
  expect(s.quests.map(q => q.text)).toEqual(['Email Bob']);
  expect(s.inbox[0].text).toBe('Plan trip');
});

test('tags are set on the quest and shown on its row', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await page.click('[data-settag="Design"]');
  expect((await app.state()).quests[0].tag).toBe('Design');
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-today .row .tag')).toHaveText('Design');
});

test('overdue count shows in the header', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await page.click('.node details summary >> nth=0');
  await page.fill('#fdue', '2000-01-01');
  await page.dispatchEvent('#fdue', 'change');
  await expect(page.locator('#hstats')).toContainText('1 overdue');
});

test('a background refresh keeps what you are typing', async ({ app, page }) => {
  await app.go('inbox');
  await page.fill('#iin', 'Half-typed thought');
  await page.evaluate(() => inBackground(renderAll));
  await expect(page.locator('#iin')).toBeFocused();
  await expect(page.locator('#iin')).toHaveValue('Half-typed thought');
  await page.press('#iin', 'Enter');
  expect((await app.state()).inbox.map(i => i.text)).toEqual(['Half-typed thought']);
  // A normal (user-driven) redraw after adding still clears the box.
  await expect(page.locator('#iin')).toHaveValue('');
});

test('Today has no add box: new work comes in through the Inbox', async ({ app, page }) => {
  await expect(page.locator('#v-today input')).toHaveCount(0);
  await page.click('#v-today [data-goto="inbox"]');
  await expect(page.locator('#iin')).toBeFocused();
  await page.fill('#iin', 'Plan offsite');
  await page.press('#iin', 'Enter');
  await page.click('#v-inbox [data-promote]');
  expect((await app.state()).quests.map(q => q.text)).toEqual(['Plan offsite']);
  // On Today, n captures to the Inbox; on a quest's page it adds a subquest.
  await app.go('today');
  await page.keyboard.press('n');
  await expect(page.locator('#iin')).toBeFocused();
  await app.go('today');
  await app.openQuest('Plan offsite');
  await page.keyboard.press('n');
  await expect(page.locator('#sin')).toBeFocused();
});
