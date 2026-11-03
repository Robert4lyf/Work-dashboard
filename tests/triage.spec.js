// Release A: guided inbox triage: the Inbox's items one at a time, one decision each.
const { test, expect } = require('./fixtures');

const seed = () => {
  S.kbcats = [{ id: 'c1', name: 'Finance', parent: '' }];
  S.inbox = [
    {
      id: 'i1',
      text: 'Supplier onboarding',
      node: fix({
        id: 'n1',
        text: 'Supplier onboarding',
        notes: 'From the call with Dana:\nW-9 form, bank details. See https://example.com/x',
        children: [fix({ id: 'k1', text: 'Get W-9' }), fix({ id: 'k2', text: 'Bank details' })],
      }),
    },
    { id: 'i2', text: 'Renew parking permit' },
    { id: 'i3', text: 'Ask Jo about the budget' },
    { id: 'i4', text: 'Old idea' },
  ];
  save();
  renderAll();
};
const card = page => page.locator('#v-inbox .tcard');

test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
  await page.evaluate(seed);
  await app.go('inbox');
});

test('Process inbox walks the items: Today, Later, Waiting, Delete and Skip, with progress', async ({
  app,
  page,
}) => {
  await page.click('[data-triagestart]');
  await expect(page.locator('#v-inbox .tprog')).toHaveText('0 of 4 processed');
  // The first item, with its notes (links clickable) and subquests.
  await expect(card(page).locator('.ttitle')).toHaveText('Supplier onboarding');
  await expect(card(page).locator('.tnotes a')).toHaveAttribute('href', 'https://example.com/x');
  await expect(card(page).locator('.tsubs li')).toHaveCount(2);
  await expect(page.locator('#v-inbox #iform')).toHaveCount(0); // (no capture box in triage)
  // Today: the quest keeps its notes and subquests; the next item shows.
  await page.click('[data-tdo="today"]');
  let s = await app.state();
  expect(s.quests[0]).toMatchObject({ text: 'Supplier onboarding' });
  expect(s.quests[0].children.map(c => c.text)).toEqual(['Get W-9', 'Bank details']);
  expect(s.quests[0].notes).toContain('Dana');
  await expect(page.locator('#v-inbox .tprog')).toHaveText('1 of 4 processed');
  await expect(card(page).locator('.ttitle')).toHaveText('Renew parking permit');
  // Later: tomorrow, through the usual scheduling.
  await page.click('[data-tdo="later"]');
  await expect(page.locator('#v-inbox .tpane [data-sched]')).toHaveCount(2);
  await page.click('#v-inbox .tpane [data-sched]:has-text("Tomorrow")');
  s = await app.state();
  expect(s.later[0]).toMatchObject({ text: 'Renew parking permit', start: '2026-09-24' });
  await expect(page.locator('#v-inbox .tprog')).toHaveText('2 of 4 processed');
  await expect(card(page).locator('.ttitle')).toHaveText('Ask Jo about the budget');
  // Waiting: who and when to chase; the item stays in the Inbox, waiting, and counts as done.
  await page.click('[data-tdo="waiting"]');
  await expect(page.locator('#twho')).toBeFocused();
  await page.fill('#twho', 'Jo');
  await page.fill('#tdue', '2026-09-30');
  await page.click('#twform .btn.blue');
  s = await app.state();
  expect(s.inbox.find(i => i.id === 'i3').wait).toMatchObject({ who: 'Jo', due: '2026-09-30' });
  await expect(page.locator('#v-inbox .tprog')).toHaveText('3 of 4 processed');
  await expect(card(page).locator('.ttitle')).toHaveText('Old idea');
  // Skip, then nothing is left but the skipped one; go through it again and delete it.
  await page.click('[data-tdo="skip"]');
  await expect(page.locator('#v-inbox .tprog')).toHaveText('3 of 4 processed, 1 skipped');
  await expect(page.locator('#v-inbox .empty')).toContainText('skipped');
  await page.click('[data-triageagain]');
  await expect(card(page).locator('.ttitle')).toHaveText('Old idea');
  await page.click('[data-tdo="delete"]');
  await expect(page.locator('#toast')).toContainText('Cleared');
  await expect(page.locator('#v-inbox .tprog')).toHaveText('4 of 4 processed');
  await expect(page.locator('#v-inbox .empty')).toContainText('All processed');
  // Undo brings the item back into the walk.
  await page.click('#undo');
  await expect(card(page).locator('.ttitle')).toHaveText('Old idea');
  await expect(page.locator('#v-inbox .tprog')).toHaveText('3 of 4 processed');
  await page.click('[data-triageexit]');
  await expect(page.locator('#iform')).toBeVisible();
  expect((await app.state()).inbox.map(i => i.text)).toEqual(['Ask Jo about the budget', 'Old idea']);
});

test('Reference: the item becomes an article with its details; the item goes only once it’s saved', async ({
  app,
  page,
}) => {
  await page.click('[data-triagestart]');
  await page.click('[data-tdo="ref"]');
  await expect(page.locator('#v-knowledge #kbform')).toBeVisible();
  await expect(page.locator('#kbt')).toHaveValue('Supplier onboarding');
  await expect(page.locator('#kbb')).toHaveValue(/From the call with Dana[\s\S]*- Get W-9\n- Bank details/);
  expect((await app.state()).inbox).toHaveLength(4); // (still there)
  // Cancelled: back to the same item, untouched.
  await page.click('#kbform [data-kbcancel]');
  await expect(card(page).locator('.ttitle')).toHaveText('Supplier onboarding');
  expect((await app.state()).inbox).toHaveLength(4);
  // Android back from the editor keeps the item too; the Inbox tab picks triage up again.
  await page.click('[data-tdo="ref"]');
  await page.fill('#kbb', 'edited');
  await page.goBack();
  await page.click('#sheet #sheetok'); // (Leave this article?)
  await expect(page.locator('#v-knowledge')).toBeVisible();
  expect((await app.state()).inbox).toHaveLength(4);
  await app.go('inbox');
  await expect(card(page).locator('.ttitle')).toHaveText('Supplier onboarding');
  // Saved: the article exists, the item is gone, Undo puts both back as they were.
  await page.click('[data-tdo="ref"]');
  await page.click('#kbform .btn.green');
  let s = await app.state();
  expect(s.kb.map(a => a.title)).toEqual(['Supplier onboarding']);
  expect(s.kb[0].cat).toBe('c1');
  expect(s.inbox.map(i => i.id)).toEqual(['i2', 'i3', 'i4']);
  await expect(page.locator('#v-inbox .tprog')).toHaveText('1 of 4 processed');
  await expect(card(page).locator('.ttitle')).toHaveText('Renew parking permit');
  await expect(page.locator('#toast')).toContainText('Saved to Knowledge');
  await page.click('#undo');
  s = await app.state();
  expect(s.kb).toEqual([]);
  expect(s.inbox.map(i => i.id)).toEqual(['i1', 'i2', 'i3', 'i4']);
  // Reference while another article is half-written: it asks before leaving that one.
  await page.evaluate(() => {
    kbEdit = { cat: 'c1', title: 'Other draft', body: 'keep me?' };
  });
  await page.click('[data-tdo="ref"]');
  await expect(page.locator('#sheettitle')).toHaveText('Leave this article?');
  await page.click('#sheet [data-sheetclose]:not(.sheetback)');
  expect(await page.evaluate(() => kbEdit.title)).toBe('Other draft');
  await expect(page.locator('#v-inbox .tcard')).toBeVisible();
  await page.click('[data-tdo="ref"]');
  await page.click('#sheet #sheetok');
  await expect(page.locator('#kbt')).toHaveValue('Renew parking permit'); // (the walk had moved on)
  await page.click('#kbform [data-kbcancel]');
  await page.click('[data-triageexit]');
  await page.click('[data-triagestart]');
  // An article saved from the Inbox outside triage (say after a reload mid-edit) still clears the item.
  await page.click('[data-tdo="ref"]');
  await page.evaluate(() => keepKbDraft());
  await page.reload();
  await expect(page.locator('#v-knowledge #kbform')).toBeVisible();
  await page.click('#kbform .btn.green');
  s = await app.state();
  expect(s.kb).toHaveLength(1);
  expect(s.inbox.map(i => i.id)).toEqual(['i2', 'i3', 'i4']);
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Supplier onboarding');
});

test('edge cases: empty Inbox, an item removed elsewhere, double taps, long text, bad metadata, leaving', async ({
  app,
  page,
}) => {
  // Nothing to process: no entry point.
  await page.evaluate(() => {
    S.inbox = [];
    save();
    renderAll();
  });
  await expect(page.locator('[data-triagestart]')).toHaveCount(0);
  await page.evaluate(() => {
    S.inbox = [
      { id: 'a', text: 'First' },
      {
        id: 'b',
        text: 'x'.repeat(200),
        node: fix({ id: 'bn', text: 'x'.repeat(200), notes: 'y '.repeat(3000) }),
      },
      { id: 'c', text: 123, wait: { who: 7 }, node: 'junk' },
    ];
    norm(S);
    save();
    renderAll();
  });
  await page.click('[data-triagestart]');
  await expect(card(page).locator('.ttitle')).toHaveText('First');
  // Removed on another device while shown: the next one shows, nothing breaks.
  await page.evaluate(() => {
    S.inbox = S.inbox.filter(i => i.id !== 'a');
    save();
    inBackground(renderAll);
  });
  await expect(card(page).locator('.ttitle')).toHaveText('x'.repeat(200));
  await expect(page.locator('#v-inbox .tprog')).toHaveText('1 of 3 processed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A double tap on Today moves it once.
  await page.click('[data-tdo="today"]', { clickCount: 2 });
  let s = await app.state();
  expect(s.quests).toHaveLength(1);
  expect(s.inbox).toHaveLength(1);
  // Odd metadata from a synced row draws without errors.
  await expect(card(page).locator('.ttitle')).toHaveText('123');
  // Something arriving from another device joins the walk.
  await page.evaluate(() => {
    S.inbox.push({ id: 'd', text: 'Late arrival' });
    save();
    inBackground(renderAll);
  });
  await expect(page.locator('#v-inbox .tprog')).toHaveText('2 of 4 processed');
  await page.click('[data-tdo="skip"]');
  await expect(card(page).locator('.ttitle')).toHaveText('Late arrival');
  // Typing in the waiting form survives a sync redraw.
  await page.click('[data-tdo="waiting"]');
  await page.fill('#twho', 'Pat');
  await page.evaluate(() => inBackground(renderAll));
  await expect(page.locator('#twho')).toHaveValue('Pat');
  // Leaving the tab leaves triage; Android back from triage goes to the Inbox list.
  await app.go('today');
  await app.go('inbox');
  await expect(page.locator('#iform')).toBeVisible();
  await page.click('[data-triagestart]');
  await page.goBack();
  await expect(page.locator('#iform')).toBeVisible();
  await expect(page.locator('#v-inbox')).toBeVisible();
});
