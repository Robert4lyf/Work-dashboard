// Release B: the Waiting Centre: follow-up history, grouping, chase actions, the review.
const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 10, 5, 9) }); // Thursday 5 Nov 2026
  await app.open();
  await page.clock.pauseAt(new Date(2026, 10, 5, 9, 0, 30));
  await page.evaluate(() => {
    S.quests = [
      fix({
        id: 'q1',
        text: 'Q3 report',
        children: [
          fix({
            id: 's1',
            text: 'Budget approval',
            wait: { who: 'Sarah', note: 'sign-off', due: '2026-11-05', since: '2026-11-01' },
          }),
        ],
      }),
      fix({
        id: 'q2',
        text: 'Purchase',
        children: [
          fix({
            id: 's2',
            text: 'PO confirmation',
            wait: { who: 'sarah', note: '', due: '2026-11-03', since: '2026-10-30' },
          }),
        ],
      }),
      fix({
        id: 'q3',
        text: 'Vendor',
        children: [
          fix({
            id: 's3',
            text: 'Quote',
            wait: { who: 'Dana', note: '', due: '', since: '2026-11-04', expect: '2026-11-10' },
          }),
        ],
      }),
      fix({
        id: 'q4',
        text: 'Figures',
        children: [
          fix({
            id: 's4',
            text: 'Updated figures',
            wait: { who: 'Sarah', note: '', due: '2026-11-07', since: '2026-11-04' },
          }),
        ],
      }),
    ];
    save();
    renderAll();
  });
});

test('existing waiting records read as before; the centre groups by urgency and by person', async ({
  app,
  page,
}) => {
  const s = await app.state();
  expect(s.quests[0].children[0].wait).toEqual({
    who: 'Sarah',
    note: 'sign-off',
    due: '2026-11-05',
    since: '2026-11-01',
  });
  await app.go('waiting');
  const heads = () => page.$$eval('#v-waiting .wgroup', hs => hs.map(h => h.firstChild.textContent.trim()));
  expect(await heads()).toEqual(['To chase', 'Due soon', 'Reply promised']);
  await expect(page.locator('#v-waiting .wgroup').nth(0)).toContainText('2');
  await expect(page.locator('#v-waiting .row').nth(0)).toContainText('PO confirmation'); // (most overdue first)
  await expect(page.locator('#v-waiting .row').nth(0)).toContainText('Chase now');
  await expect(page.locator('#v-waiting .row', { hasText: 'Quote' })).toContainText('reply by 10 Nov');
  await page.click('[data-wview="person"]');
  expect(await heads()).toEqual(['sarah', 'Dana']); // (one group for both spellings, named as first met)
  await expect(page.locator('#v-waiting .wgroup').nth(0)).toContainText('3 outstanding');
  await page.reload();
  await app.go('waiting');
  expect(await heads()).toEqual(['To chase', 'Due soon', 'Reply promised']); // (urgency is the default)
  await expect(page.locator('#v-waiting .row')).toHaveCount(4);
});

test('record a follow-up: history, next chase date, promised reply; the copied message; got it and reopen', async ({
  app,
  page,
}) => {
  await app.go('waiting');
  await page.click('#v-waiting [data-wact="s1"]');
  await expect(page.locator('#sheet .qact')).toHaveText([
    'Record a follow-up',
    /Response received/,
    /Change the next chase date/,
    'Copy a follow-up message',
    'Open',
    'Open the task: Q3 report',
  ]);
  await page.click('#sheet [data-chase]');
  await expect(page.locator('#funote')).toBeFocused();
  await page.fill('#funote', 'Emailed Sarah, awaiting approval');
  await page.fill('#fudue', '2026-11-09');
  await page.fill('#fuexp', '2026-11-08');
  await page.click('#sheetok');
  await expect(page.locator('#toast')).toContainText('Follow-up recorded');
  let s = await app.state();
  const w = () => app.state().then(s => s.quests[0].children[0].wait);
  expect(await w()).toMatchObject({ due: '2026-11-09', expect: '2026-11-08', last: '2026-11-05' });
  expect(s.follows.map(f => [f.n, f.k, f.note])).toEqual([
    ['s1', 'chase', 'Emailed Sarah, awaiting approval'],
    ['s1', 'expect', 'by 8 Nov'],
  ]);
  // It moved out of "To chase" (chased recently; next chase on the 9th), and the row says so.
  await expect(page.locator('#v-waiting .row', { hasText: 'Budget approval' })).toContainText(
    'followed up Today',
  );
  // A second follow-up, the date only.
  await page.click('#v-waiting [data-wact="s1"]');
  await page.click('#sheet [data-chasedate]');
  await expect(page.locator('#funote')).toHaveCount(0);
  await page.fill('#fudue', '2026-11-12');
  await page.click('#sheetok');
  expect((await w()).due).toBe('2026-11-12');
  expect((await app.state()).follows).toHaveLength(2); // (a date change alone isn't a follow-up)
  // The message to paste.
  const copied = await page.evaluate(() => followMessage('s1'));
  expect(copied).toBe(
    'Hi Sarah,\n\nFollowing up on: Budget approval (for Q3 report).\nAsked 1 Nov; reply expected by 8 Nov.\nLast follow-up 5 Nov: Emailed Sarah, awaiting approval.\n\nCould you let me know where this stands?\n\nThanks',
  );
  // The step's page shows the history; Got it resolves (history kept), Set waiting reopens.
  // (the row itself, not its buttons: "Reply received" is one of them)
  await page.locator('#v-waiting .row', { hasText: 'Budget approval' }).locator('.open').click();
  await app.go('today');
  await app.openQuest('Q3 report');
  await page.click('#v-today .open >> text="Budget approval"');
  await expect(page.locator('#waitd .flist li').first()).toContainText('Reply promised: by 8 Nov');
  await expect(page.locator('#wexp')).toHaveValue('2026-11-08');
  await page.click('#waitd [data-waitclear]');
  s = await app.state();
  expect(s.quests[0].children[0].wait).toBeUndefined();
  expect(s.follows.map(f => f.k)).toEqual(['chase', 'expect', 'resolve']);
  await page.evaluate(() => (document.querySelector('#waitd').open = true));
  await expect(page.locator('#waitd [data-waitsave]')).toHaveText('Reopen: set waiting again');
  await expect(page.locator('#waitd .flist li').first()).toContainText('Resolved');
  await page.fill('#wwho', 'Sarah');
  await page.click('#waitd [data-waitsave]');
  s = await app.state();
  expect(s.quests[0].children[0].wait).toMatchObject({ who: 'Sarah', since: '2026-11-05' });
  expect(s.follows.map(f => f.k)).toEqual(['chase', 'expect', 'resolve', 'reopen']);
});

test('the chase notification follows the next chase date; the review puts overdue chases first', async ({
  app,
  page,
}) => {
  let want = await page.evaluate(() =>
    wantedNotices(new Date(2026, 10, 5, 9).getTime())
      .filter(n => n.key.startsWith('chase:'))
      .map(n => n.key),
  );
  expect(want).toEqual(['chase:s1:2026-11-05', 'chase:s4:2026-11-07']); // (the 3rd has passed; Dana has no date)
  await page.evaluate(() => {
    S.quests[0].children[0].wait.due = '2026-11-20';
    save();
  });
  want = await page.evaluate(() =>
    wantedNotices(new Date(2026, 10, 5, 9).getTime())
      .filter(n => n.key.startsWith('chase:'))
      .map(n => n.key),
  );
  expect(want).toEqual(['chase:s1:2026-11-20', 'chase:s4:2026-11-07']);
  // Friday: the review's Waiting step.
  await page.clock.setSystemTime(new Date(2026, 10, 6, 9));
  await page.evaluate(() => {
    S.quests[2].children[0].wait.expect = '2026-11-05'; // (Dana's promised reply has slipped)
    save();
  });
  await app.go('review');
  await page.click('[data-rstep="1"]');
  await page.click('[data-rstep="1"]');
  const step = page.locator('#v-review .wstep');
  await expect(step.locator('h2')).toContainText('Waiting');
  await expect(step.locator('.wsum2')).toHaveText('2 items to chase, 1 promised reply overdue.');
  await expect(step.locator('.crow').nth(0)).toContainText('PO confirmation');
  await expect(step.locator('.crow').nth(1)).toContainText('Quote');
  await expect(step.locator('.crow').nth(1)).toContainText('Reply overdue');
  await step.locator('.crow').nth(0).locator('[data-chase]').click();
  await expect(page.locator('#sheettitle')).toHaveText('Record a follow-up');
  await page.keyboard.press('Escape');
});

test('bad follow-up records are dropped; old ones are pruned; a resolved item’s history survives a reload', async ({
  app,
  page,
}) => {
  await app.setState(s => {
    s.follows = [
      { id: 'ok', n: 's1', t: Date.now(), d: '2026-11-05', k: 'chase', note: 'fine' },
      { id: 'old', n: 's1', t: Date.now() - 200 * 864e5, d: '2026-04-01', k: 'chase', note: 'ancient' },
      { id: 'bad kind', n: 's1', t: Date.now(), k: 'poke' },
      { id: 'nodate', n: 's1', t: Date.now(), k: 'chase', note: 42 },
      'junk',
    ];
    s.quests[0].children[0].wait = {
      who: 7,
      note: ['x'],
      due: 'soon',
      expect: 'next week',
      since: '2026-11-01',
    };
  });
  await page.reload();
  await page.evaluate(() => save()); // (pruning by age happens on a save, as for sessions and the log)
  const s = await app.state();
  expect(s.follows.map(f => f.id).sort()).toEqual(['nodate', 'ok']);
  expect(s.follows.find(f => f.id === 'nodate').note).toBe('');
  expect(s.quests[0].children[0].wait).toEqual({ who: '', note: '', due: '', since: '2026-11-01' }); // (unsound values emptied, keys kept)
});

test('review fixes: an Inbox item’s waiting details are checked; history follows the item to Today and back', async ({
  app,
  page,
}) => {
  // A crafted synced Inbox row: nothing from it reaches an attribute unescaped, and a number
  // where a name belongs doesn't break the Centre.
  await app.setState(s => {
    s.inbox = [
      {
        id: 'i1',
        text: 'Crafted',
        wait: {
          who: 7,
          note: { x: 1 },
          due: '9" autofocus onfocus="window.__x=1',
          expect: '2026-12-01"><b>',
          since: 'x',
        },
      },
      { id: 'i2', text: 'Plain', wait: { who: 'Sam', note: '', due: '', since: '2026-11-01' } },
    ];
  });
  await page.reload();
  const s0 = await app.state();
  expect(s0.inbox[0].wait).toEqual({ who: '', note: '', due: '', since: '' });
  await app.go('waiting');
  await expect(page.locator('#v-waiting .row')).toHaveCount(6); // (the four steps, and both items)
  await page.click('#v-waiting [data-wact="i1"]');
  await page.click('#sheet [data-chase]');
  await expect(page.locator('#funote')).toBeVisible();
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
  await page.keyboard.press('Escape');
  // The history of an item added waiting in the Centre goes with it to Today (a step of its own).
  await page.click('#v-waiting [data-wact="i2"]');
  await page.click('#sheet [data-chase]');
  await page.fill('#funote', 'Pinged Sam');
  await page.click('#sheetok');
  await app.go('inbox');
  await page.click('[data-promote="i2"]');
  let s = await app.state();
  const step = s.quests.find(q => q.text === 'Plain').children[0];
  expect(step.wait).toMatchObject({ who: 'Sam', last: '2026-11-05' });
  expect(s.follows.filter(f => f.n === step.id).map(f => f.k)).toEqual(['chase']);
  expect(s.follows.some(f => f.n === 'i2')).toBe(false);
  // And back to the Inbox: the step's history stays with the step (the wait is the step's).
  // (Release E: with only a waiting step, the task is under Waiting; its actions are on its page)
  await app.go('today');
  await page.click(`#v-today .wrow [data-wact="${step.id}"]`);
  await page.click(`#sheet [data-open="${s.quests.find(q => q.text === 'Plain').id}"]`);
  await page.click('.qfoot .qmore');
  await page.click('#sheet [data-toinbox]');
  s = await app.state();
  expect(s.inbox[0].node.children[0].id).toBe(step.id);
  expect(s.follows.filter(f => f.n === step.id)).toHaveLength(1);
  // Setting an item waiting from the Inbox, or in triage, starts its history like the Centre.
  // (the crafted item still counts as waiting, on no one: clearing it resolves, setting it starts)
  await app.go('inbox');
  await page.click('[data-steps="i1"]');
  const iwait = async who => {
    await page.fill('[data-iwait="i1"]', who);
    await page.dispatchEvent('[data-iwait="i1"]', 'change');
    return (await app.state()).follows.filter(f => f.n === 'i1').map(f => f.k);
  };
  expect(await iwait('')).toEqual(['resolve']);
  expect(await iwait('Dana')).toEqual(['resolve', 'reopen']);
  expect(await iwait('')).toEqual(['resolve', 'reopen', 'resolve']);
  // No empty expect key is written (it would only be stripped elsewhere and sent back).
  await app.go('today');
  await app.openQuest('Q3 report');
  await page.click('#v-today .open >> text="Budget approval"');
  await page.evaluate(() => (document.querySelector('#waitd').open = true));
  await page.fill('#wnote', 'changed');
  await page.press('#wnote', 'Tab');
  expect('expect' in (await app.state()).quests.find(q => q.text === 'Q3 report').children[0].wait).toBe(
    false,
  );
});
