// Suggest steps (AI): a stand-in for the suggest-steps function; nothing reaches Claude here.
const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => {
  await app.open();
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

test('suggest steps: asks once what is sent, offers the steps to tick, adds the ticked ones', async ({
  app,
  page,
}) => {
  await app.addQuest('Renew contract');
  await app.openQuest('Renew contract');
  await app.addSub('Draft');
  // Not signed in: no button.
  await expect(page.locator('[data-suggest]')).toHaveCount(0);
  await stub(page, { steps: ['Send to provider', 'Chase signature', 'File copy'] });
  await page.evaluate(() => renderToday());
  await page.click('[data-suggest]');
  // First time on this device: what goes to Claude, before anything is sent.
  await expect(page.locator('#sheetform')).toContainText("quest's name and its steps' names");
  expect(await page.evaluate(() => window.sent.length)).toBe(0);
  await page.click('#sheetok');
  await expect(page.locator('.suggest .optbox')).toHaveText([
    'Send to provider',
    'Chase signature',
    'File copy',
  ]);
  expect(await page.evaluate(() => window.sent)).toEqual([
    { name: 'suggest-steps', body: { quest: 'Renew contract', steps: ['Draft'] } },
  ]);
  await page.locator('.suggest .optbox', { hasText: 'File copy' }).locator('input').uncheck();
  await page.click('[data-sugadd]');
  const q = (await app.state()).quests[0];
  expect(q.children.map(c => c.text)).toEqual(['Draft', 'Send to provider', 'Chase signature']);
  await expect(page.locator('.suggest')).toHaveCount(0);
  // Asked again: no notice this time.
  await page.click('[data-suggest]');
  await expect(page.locator('#sheetform')).toHaveCount(0);
  await expect(page.locator('.suggest .optbox')).toHaveCount(3);
  await page.click('[data-sugclose]');
  await expect(page.locator('[data-suggest]')).toBeVisible();
});

test('suggest steps: a failure says so and adds nothing; steps have no button', async ({ app, page }) => {
  await app.addQuest('Budget');
  await app.openQuest('Budget');
  await page.evaluate(() => localStorage.setItem('dashboard-suggest-ok', '1'));
  await stub(page, 'fail');
  await page.evaluate(() => renderToday());
  await page.click('[data-suggest]');
  await expect(page.locator('.suggest')).toContainText("Couldn't get suggestions");
  await expect(page.locator('[data-sugadd]')).toHaveCount(0);
  await page.click('[data-sugclose]');
  expect((await app.state()).quests[0].children).toEqual([]);
  await app.addSub('Figures');
  await page.click('#v-today .open >> text="Figures"');
  await expect(page.locator('[data-suggest]')).toHaveCount(0);
});

test('suggest steps: ticks survive a sync redraw; an answer for a quest deleted meanwhile adds nothing', async ({
  app,
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await app.addQuest('Report');
  await app.openQuest('Report');
  await page.evaluate(() => localStorage.setItem('dashboard-suggest-ok', '1'));
  await stub(page, { steps: ['Outline', 'Write'] });
  await page.evaluate(() => renderToday());
  await page.click('[data-suggest]');
  await page.locator('.suggest .optbox', { hasText: 'Write' }).locator('input').uncheck();
  await page.evaluate(() => {
    S.quests = S.quests.map(q => ({ ...q })); // (as a sync pull does)
    norm(S);
    inBackground(renderAll);
  });
  await expect(page.locator('.suggest .optbox', { hasText: 'Write' }).locator('input')).not.toBeChecked();
  await page.click('[data-sugadd]');
  expect((await app.state()).quests[0].children.map(c => c.text)).toEqual(['Outline']);

  // Slow answer; the quest goes (another device) before it comes.
  await page.evaluate(() => {
    sb.functions.invoke = () => new Promise(r => (window.answer = () => r({ data: { steps: ['Late'] } })));
  });
  await page.click('[data-suggest]');
  await expect(page.locator('.suggestbusy')).toBeVisible();
  await page.evaluate(() => {
    S.quests = [];
    inBackground(renderAll);
    window.answer();
  });
  await expect(page.locator('.suggest')).toHaveCount(0);
  await page.evaluate(() => addSuggested(suggest && suggest.id));
  expect((await app.state()).quests).toEqual([]);
  expect(errors).toEqual([]);
});
