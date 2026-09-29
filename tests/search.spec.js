const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => {
  await app.open();
});

test('search finds quests, steps, inbox, notes, knowledge, flows and done items, and opens them', async ({
  app,
  page,
}) => {
  await page.evaluate(() => {
    S.quests = [
      fix({
        id: 'q1',
        text: 'Budget review',
        children: [fix({ id: 's1', text: 'Chase budget figures' })],
        wait: { who: 'Custon', note: 'plans', due: '', since: today() },
      }),
    ];
    S.later = [fix({ id: 'l1', text: 'Budget for Q4', start: shift(today(), 3) })];
    S.inbox = [{ id: 'i1', text: 'Budget idea' }];
    S.notes = 'first line\nremember the budget meeting at 3\nlast line';
    S.kbcats = [{ id: 'c', name: 'Processes', parent: '' }];
    S.kb = [{ id: 'a', cat: 'c', title: 'Commissioning', body: 'Step 1: check the budget code', imgs: [] }];
    S.flows = [{ id: 'f', name: 'Budget report', url: 'ms-powerautomate:/console/flow/run?workflowid=1' }];
    S.log = [{ id: 'x', d: today(), text: 'Sent budget pack', trail: [], p: '' }];
    save();
    renderAll();
  });
  await page.click('#searchBtn');
  await expect(page.locator('#v-search')).toBeVisible();
  await expect(page.locator('#sq')).toBeFocused();
  await page.fill('#sq', 'budget');
  const groups = page.locator('#sres .sgroup > h2');
  await expect(groups).toHaveText([
    'Today 2',
    'Upcoming 1',
    'Inbox 1',
    'Notes 1',
    'Knowledge 1',
    'Flows 1',
    'Done 1',
  ]);
  await expect(page.locator('#sres mark').first()).toHaveText('budget');
  // A step shows where it sits; the knowledge match shows the text around it.
  await expect(page.locator('#sres [data-open="s1"]')).toContainText('Budget review');
  await expect(page.locator('#sres [data-sart="a"]')).toContainText('check the budget code');

  // Waiting details count too.
  await page.fill('#sq', 'custon');
  await expect(page.locator('#sres [data-open="q1"]')).toContainText('waiting on Custon');

  // Opening results.
  await page.fill('#sq', 'commissioning');
  await page.click('#sres [data-sart="a"]');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Commissioning');
  await page.keyboard.press('/');
  await expect(page.locator('#sq')).toBeFocused();
  await page.fill('#sq', 'chase budget');
  await page.click('#sres [data-open="s1"]');
  await expect(page.locator('#v-today')).toBeVisible();
  await page.click('#searchBtn');
  await page.fill('#sq', 'meeting');
  await page.click('#sres [data-goto="notes"]');
  await expect(page.locator('#v-notes')).toBeVisible();

  await page.click('#searchBtn');
  await page.fill('#sq', 'zzz');
  await expect(page.locator('#sres')).toHaveText('Nothing matches.');
});
