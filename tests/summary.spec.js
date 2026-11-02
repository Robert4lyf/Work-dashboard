// A quest's summary: optional, written by you under its name; Claude drafts one only on asking.
const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => {
  await app.open();
  await app.addQuest('Walsingham');
  await app.openQuest('Walsingham');
  await app.addSub('Organise visits');
});

// Signed in, with the function answering `reply` (and recording what it was sent).
const stub = (page, reply) =>
  page.evaluate(reply => {
    window.sent = [];
    sb = {
      functions: {
        invoke: async (name, { body }) => {
          window.sent.push({ name, body });
          return reply === 'fail' ? { data: null, error: new Error('down') } : { data: reply, error: null };
        },
      },
    };
    session = { user: { id: 'u' } };
  }, reply);

test('the summary is optional, typed under the name, and shows under it on Today', async ({ app, page }) => {
  await expect(page.locator('#fsum')).toHaveValue('');
  expect((await app.state()).quests[0]).not.toHaveProperty('summary'); // (none: nothing stored)
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-today .qsum')).toHaveCount(0);

  await app.openQuest('Walsingham');
  await page.fill('#fsum', 'Offer accepted.\nVisits next week.');
  expect((await app.state()).quests[0].summary).toBe('Offer accepted.\nVisits next week.');
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-today .qsum')).toHaveText('Offer accepted.\nVisits next week.');
  // The name is still the row's name (the summary isn't taken for it).
  expect(await app.order()).toEqual(['Walsingham']);
  await page.reload();
  await expect(page.locator('#v-today .qsum')).toHaveText('Offer accepted.\nVisits next week.');

  // Cleared: gone again.
  await app.openQuest('Walsingham');
  await page.fill('#fsum', '  ');
  expect((await app.state()).quests[0]).not.toHaveProperty('summary');

  // Found by search.
  await page.fill('#fsum', 'Offer accepted');
  await page.click('#searchBtn');
  await page.fill('#sq', 'accepted');
  await expect(page.locator('#sres')).toContainText('Walsingham');
});

test('typing in the summary survives a background redraw', async ({ app, page }) => {
  await page.click('#fsum');
  await page.keyboard.type('Half way');
  await page.evaluate(() => inBackground(renderAll));
  await expect(page.locator('#fsum')).toHaveValue('Half way');
  await page.keyboard.type(' there');
  expect((await app.state()).quests[0].summary).toBe('Half way there');
});

test('Summarise (AI): asks once what is sent, offers a draft; yours stays unless you choose', async ({
  app,
  page,
}) => {
  // Not signed in: no button.
  await expect(page.locator('[data-sumai]')).toHaveCount(0);
  await page.fill('#fsum', 'Waiting for Rob.');
  await page.evaluate(() => {
    const bf = snapshot();
    S.quests[0].children.push(fix({ id: 'w', text: 'Survey', wait: { who: 'Rob H', note: '', due: '' } }));
    S.quests[0].children[0].done = true;
    settle(bf);
  });
  await stub(page, { summary: 'Visits are organised. Waiting on Rob H for the survey.' });
  await page.evaluate(() => renderToday());
  await page.click('[data-sumai]');
  await expect(page.locator('#sheetform')).toContainText("quest's name, its steps");
  expect(await page.evaluate(() => window.sent.length)).toBe(0);
  await page.click('#sheetok');
  await expect(page.locator('.sumdraft .sumtext')).toHaveText(
    'Visits are organised. Waiting on Rob H for the survey.',
  );
  expect(await page.evaluate(() => window.sent)).toEqual([
    {
      name: 'suggest-steps',
      body: {
        mode: 'summary',
        quest: 'Walsingham',
        summary: 'Waiting for Rob.',
        steps: [
          { text: 'Survey', done: false, waiting: 'Rob H' },
          { text: 'Organise visits', done: true, waiting: '' },
        ],
      },
    },
  ]);
  // Not used yet: yours is unchanged.
  expect((await app.state()).quests[0].summary).toBe('Waiting for Rob.');
  await page.click('[data-sumuse="add"]');
  expect((await app.state()).quests[0].summary).toBe(
    'Waiting for Rob.\nVisits are organised. Waiting on Rob H for the survey.',
  );
  await expect(page.locator('#fsum')).toHaveValue(
    'Waiting for Rob.\nVisits are organised. Waiting on Rob H for the survey.',
  );

  // Asked again (no notice): replace, or cancel.
  await page.click('[data-sumai]');
  await expect(page.locator('#sheetform')).toHaveCount(0);
  await page.click('[data-sumclose]');
  expect((await app.state()).quests[0].summary).toContain('Waiting for Rob.');
  await page.click('[data-sumai]');
  await page.click('[data-sumuse="replace"]');
  expect((await app.state()).quests[0].summary).toBe(
    'Visits are organised. Waiting on Rob H for the survey.',
  );
});

test('Summarise (AI): a failure, or an old function without summaries, says so and changes nothing', async ({
  app,
  page,
}) => {
  await page.fill('#fsum', 'Mine');
  await page.evaluate(() => localStorage.setItem('dashboard-summary-ok', '1'));
  await stub(page, 'fail');
  await page.evaluate(() => renderToday());
  await page.click('[data-sumai]');
  await expect(page.locator('.sumdraft')).toContainText("Couldn't get a summary");
  await page.click('[data-sumclose]');
  await stub(page, { steps: ['Something'] }); // (a function from before summaries)
  await page.click('[data-sumai]');
  await expect(page.locator('.sumdraft')).toContainText("Couldn't get a summary");
  expect((await app.state()).quests[0].summary).toBe('Mine');
});
