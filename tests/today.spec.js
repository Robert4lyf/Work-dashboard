const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => app.open());
// The steps on a project's page, in the order shown.
const stepNames = page => page.$$eval('#v-today .row .open > span', x => x.map(e => e.textContent));

test('completing a task logs it, puts it under Completed today and moves Next up', async ({ app, page }) => {
  for (const t of ['A', 'B', 'C']) await app.addQuest(t);
  expect(await page.evaluate(() => recommend()?.n.text)).toBe('A');
  await page.click('#v-projects [aria-label="Mark done: A"]');
  expect(await app.order()).toEqual(['B', 'C', 'A']);
  await expect(page.locator('#active-project-grid .project-card h2')).toHaveText(['B', 'C']);
  expect(await page.evaluate(() => recommend()?.n.text)).toBe('B');
  expect((await app.state()).log.map(x => x.text)).toEqual(['A']);
  // Finished projects fold away under "Completed today"; open it to un-tick one.
  const done = page.locator('#projects-done');
  await expect(done.locator('summary')).toHaveText('Completed today 1');
  await expect(done.locator('.project-card h2')).toHaveText(['A']);
  await expect(done.locator('.project-card')).toBeHidden();
  await done.locator('summary').click();
  await page.click('#projects-done [aria-label="Mark not done: A"]');
  expect((await app.state()).log).toEqual([]);
  expect(await app.order()).toEqual(['B', 'C', 'A']);
  await expect(page.locator('#projects-done')).toHaveCount(0);
});

test('reorder: Top makes a step the next one; open steps stay above ticked ones', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  for (const t of ['A', 'B', 'C']) await app.addSub(t);
  await page.locator('#v-today').getByRole('button', { name: 'Mark done: A' }).click();
  await page.click('#reorder');
  await page.click('[data-top]:not([disabled]) >> nth=0');
  expect(await stepNames(page)).toEqual(['C', 'B', 'A']);
  expect(await page.evaluate(() => recommend()?.n.text)).toBe('C');
  const bDownDisabled = await page.evaluate(
    () =>
      [...document.querySelectorAll('#v-today .row')]
        .find(r => r.querySelector('.open>span').textContent === 'B')
        .querySelector('[data-down]').disabled,
  );
  expect(bDownDisabled).toBe(true);
  await expect(page.locator('.row.done [data-top]')).toHaveCount(0);
  // The board's preview of the project follows the new order.
  await page.click('#reorder');
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-projects .project-step-name')).toHaveText(['C', 'B', 'A']);
});

test('steps: next step and sinking', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await app.addSub('Draft');
  await app.addSub('Review');
  expect(await page.evaluate(() => recommend()?.q.text)).toBe('Report');
  await page.locator('#v-today').getByRole('button', { name: 'Mark done: Draft' }).click();
  expect(await page.evaluate(() => recommend()?.n.text)).toBe('Review');
  expect(await stepNames(page)).toEqual(['Review', 'Draft']);
});

test('a task’s ⋯ offers Inbox or Delete among its actions; delete can be undone', async ({ app, page }) => {
  await app.addQuest('Email Bob');
  await app.addQuest('Plan trip');
  await app.openQuest('Email Bob');
  // Cancelling (or the backdrop) closes the sheet without doing anything.
  await page.click('.qfoot [aria-label="More actions"]');
  await expect(page.locator('#sheettitle')).toHaveText('Email Bob');
  await expect(page.locator('#sheet .qact[data-toinbox]')).toHaveText('Move to Inbox');
  await expect(page.locator('#sheet .qact[data-delnow]')).toContainText('Delete');
  await page.click('#sheet .sheetback', { position: { x: 10, y: 10 } });
  await expect(page.locator('#sheet')).toHaveCount(0);
  expect((await app.state()).quests).toHaveLength(2);

  await page.click('.qfoot [aria-label="More actions"]');
  await page.click('#sheet [data-delnow]');
  await expect(page.locator('#sheet')).toHaveCount(0);
  expect((await app.state()).quests.map(q => q.text)).toEqual(['Plan trip']);
  // (its page has gone with it: back on the board)
  await expect(page.locator('#v-projects')).toBeVisible();
  await page.click('#undo');
  expect((await app.state()).quests).toHaveLength(2);

  await app.openQuest('Plan trip');
  await page.click('.qfoot [aria-label="More actions"]');
  await page.locator('#sheet [data-toinbox]').click();
  const s = await app.state();
  expect(s.quests.map(q => q.text)).toEqual(['Email Bob']);
  expect(s.inbox[0].text).toBe('Plan trip');
  expect(await app.order()).toEqual(['Email Bob']);
});

test('tags are set on the task and shown on its page', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await app.setTag('Design');
  expect((await app.state()).quests[0].tag).toBe('Design');
  // (the board's cards carry no tag: it's on the project's page, folded to the one it has)
  await page.click('[data-crumb="-1"]');
  await app.openQuest('Report');
  await expect(page.locator('#tagd > summary .tag')).toHaveText('Design');
});

test('an overdue task says so on its card, and is counted in the Command Centre', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await page.click('#mored > summary');
  await page.click('#fdet > summary');
  await page.fill('#fdue', '2000-01-01');
  await page.dispatchEvent('#fdue', 'change');
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-projects .project-card .project-meta .tag.late')).toHaveText('Overdue');
  await app.go('ops');
  await expect(page.locator('#v-ops .opsec h2').first()).toHaveText('Needs attention 1');
  await expect(page.locator('#v-ops .attlist .attrow')).toHaveCount(1);
  await expect(page.locator('#v-ops .attlist .attrow')).toContainText('Report');
  await expect(page.locator('#v-ops .attlist .attrow')).toContainText('Overdue');
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

test('an empty board points to the Inbox, where new work comes in; n captures there', async ({
  app,
  page,
}) => {
  await expect(page.locator('#v-projects input')).toHaveCount(0);
  await page.click('#v-projects [data-goto="inbox"]');
  await expect(page.locator('#iin')).toBeFocused();
  await page.fill('#iin', 'Plan offsite');
  await page.press('#iin', 'Enter');
  await page.click('#v-inbox [data-promote]');
  expect((await app.state()).quests.map(q => q.text)).toEqual(['Plan offsite']);
  // On Projects, n captures to the Inbox; on a task's page it adds a step.
  await app.go('projects');
  await page.keyboard.press('n');
  await expect(page.locator('#iin')).toBeFocused();
  await app.openQuest('Plan offsite');
  await page.keyboard.press('n');
  await expect(page.locator('#sin')).toBeFocused();
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
  await app.settings('tags');
  const tag = page.locator('[data-tagname="1"]');
  await tag.fill('Meetings XY');
  for (let i = 0; i < 2; i++) await page.evaluate(() => inBackground(renderAll));
  await expect(page.locator('[data-tagname="1"]')).toHaveValue('Meetings XY');
  await expect(page.locator('[data-tagname="1"]')).toBeFocused();

  // The waiting panel's fields before it's set (kept until "Set waiting"): after two redraws too.
  await page.evaluate(() => {
    S.quests = [fix({ id: 'q', text: 'Task one' })];
    save();
  });
  await app.openQuest('Task one');
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
