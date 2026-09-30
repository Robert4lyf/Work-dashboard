const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => app.open());

test('completing a quest logs it, sinks it and moves Next up', async ({ app, page }) => {
  for (const t of ['A', 'B', 'C']) await app.addQuest(t);
  await expect(page.locator('#hnow b')).toHaveText('A');
  await page.click('[aria-label="Mark done: A"]');
  expect(await app.order()).toEqual(['B', 'C', 'A']);
  await expect(page.locator('#hnow b')).toHaveText('B');
  expect((await app.state()).log.map(x => x.text)).toEqual(['A']);
  // Finished quests fold away under "Done today"; open it to un-tick one.
  await page.click('#donesec > summary');
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
  await app.setTag('Design');
  expect((await app.state()).quests[0].tag).toBe('Design');
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-today .row .tag')).toHaveText('Design');
});

test('overdue count shows at the top of Today', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await page.click('#mored > summary');
  await page.click('#fdet > summary');
  await page.fill('#fdue', '2000-01-01');
  await page.dispatchEvent('#fdue', 'change');
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-today .attn')).toContainText('1 overdue');
  await expect(page.locator('#hstats')).not.toContainText('overdue'); // the header stays calm
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

test('the header: the next step on up to two lines, then Focus, Search and the sync dot below', async ({
  app,
  page,
}) => {
  await app.addQuest('Report on everything that happened this quarter, team by team, with figures');
  await expect(page.locator('#hact [data-zen]')).toHaveText('Focus');
  await expect(page.locator('#hstats')).toBeEmpty(); // (no stats line until there's focus time or an alarm)
  await expect(page.locator('#searchBtn')).toBeVisible();
  // A long step wraps onto two lines at most (then cut short), with the buttons on the row under it.
  const title = await page.locator('#hnow .go b').boundingBox(),
    focus = await page.locator('#hact [data-zen]').boundingBox(),
    search = await page.locator('#searchBtn').boundingBox();
  const line = await page.locator('#hnow .go b').evaluate(b => parseFloat(getComputedStyle(b).lineHeight));
  expect(title.height).toBeGreaterThan(line * 1.5);
  expect(title.height).toBeLessThan(line * 2.5);
  expect(focus.y).toBeGreaterThan(title.y + title.height - 1);
  expect(Math.abs(search.y + search.height / 2 - (focus.y + focus.height / 2))).toBeLessThan(6);
  const h = await page.locator('header').boundingBox();
  expect(h.height).toBeLessThan(150);
});

test('a change redraws only the view on screen; another view is drawn when opened', async ({ app, page }) => {
  await app.go('notes');
  await page.evaluate(() => {
    document.querySelector('#v-inbox').innerHTML = '<p id="stale">stale</p>';
    S.inbox.push({ id: 'n1', text: 'New item' });
    save();
    renderAll();
  });
  await expect(page.locator('#stale')).toHaveCount(1);
  await app.go('inbox');
  await expect(page.locator('#stale')).toHaveCount(0);
  await expect(page.locator('#v-inbox')).toContainText('New item');
});

test('deep hunt: typing survives background redraws, in fields with or without an id', async ({
  app,
  page,
}) => {
  // A tag's name (no id): still focused, still as typed, after two redraws.
  await app.go('account');
  const tag = page.locator('[data-tagname="1"]');
  await tag.fill('Meetings XY');
  for (let i = 0; i < 2; i++) await page.evaluate(() => inBackground(renderAll));
  await expect(page.locator('[data-tagname="1"]')).toHaveValue('Meetings XY');
  await expect(page.locator('[data-tagname="1"]')).toBeFocused();

  // The waiting panel's fields before it's set (kept until "Set waiting"): after two redraws too.
  await page.evaluate(() => {
    S.quests = [fix({ id: 'q', text: 'Quest one' })];
    save();
  });
  await app.go('today');
  await app.openQuest('Quest one');
  if (!(await page.locator('#wwho').isVisible())) await page.click('#waitd summary');
  await page.fill('#wwho', 'Pat');
  await page.fill('#wnote', 'the report');
  await page.locator('#wnote').blur();
  for (let i = 0; i < 2; i++) await page.evaluate(() => inBackground(renderAll));
  await expect(page.locator('#wwho')).toHaveValue('Pat');
  await expect(page.locator('#wnote')).toHaveValue('the report');
});

test('deep hunt: clearing a search box clears its results; notes pictures aren’t redrawn while typing', async ({
  app,
  page,
}) => {
  await page.evaluate(() => {
    S.inbox = [{ id: 'i', text: 'Budget idea' }];
    S.noteImgs = [{ id: 'm', src: 'data:image/png;base64,iVBORw0KGgo=', at: 1 }];
    save();
  });
  await page.click('#searchBtn');
  await page.fill('#sq', 'budget');
  await expect(page.locator('#sres .srow')).toHaveCount(1);
  await page.evaluate(() => {
    const i = document.querySelector('#sq');
    i.value = '';
    i.dispatchEvent(new Event('search'));
  });
  await expect(page.locator('#sres')).toHaveText('Type to search everything.');

  await app.go('notes');
  const same = await page.evaluate(() => {
    const img = document.querySelector('#noteimgs img');
    inBackground(renderAll);
    renderAll();
    return document.querySelector('#noteimgs img') === img;
  });
  expect(same).toBe(true);
});

test('on a phone, a row swipes: left shows Inbox / Delete, right ticks a step off', async ({ app, page }) => {
  await app.addQuest('Swipe me');
  await app.addQuest('Keep me');
  const row = page.locator('#v-today .row', { hasText: 'Swipe me' });
  const swipe = async dx => {
    const b = await row.boundingBox();
    const x = b.x + b.width / 2,
      y = b.y + b.height / 2;
    await page.evaluate(
      ({ x, y, dx }) => {
        const el = document.elementFromPoint(x, y);
        const ev = (type, cx) =>
          el.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              clientX: cx,
              clientY: y,
              pointerId: 1,
              pointerType: 'touch',
            }),
          );
        ev('pointerdown', x);
        for (let i = 1; i <= 6; i++) ev('pointermove', x + (dx * i) / 6);
        ev('pointerup', x + dx);
      },
      { x, y, dx },
    );
  };
  await swipe(-140);
  await expect(row.locator('[data-toinbox]')).toBeVisible();
  await expect(row.locator('[data-delnow]')).toBeVisible();
  await swipe(140);
  expect((await app.state()).quests.find(q => q.text === 'Swipe me').done).toBe(true);
});
