// Release A: the quest page as a workspace: what's next, the one action to hand, and the
// resources (articles, flows, web links) linked to the quest.
const { test, expect } = require('./fixtures');

const seed = () => {
  S.kbcats = [{ id: 'c1', name: 'Finance', parent: '' }];
  S.kb = [
    { id: 'a1', cat: 'c1', title: 'Weekly report procedure', body: 'Open SSRS.', edited: 1, imgs: [] },
    { id: 'a2', cat: 'c1', title: 'Supplier credits', body: 'How to find them.', edited: 1, imgs: [] },
  ];
  S.flows = [
    { id: 'f1', name: 'Run weekly report', url: 'ms-powerautomate:/console/flow/run?id=1', last: 0 },
  ];
  S.quests = [
    fix({
      id: 'q1',
      text: 'Weekly reporting',
      children: [fix({ id: 's1', text: 'Pull extract', done: true }), fix({ id: 's2', text: 'Reconcile' })],
    }),
    fix({ id: 'q2', text: 'Call Sam' }),
  ];
  save();
  renderAll();
};

test.beforeEach(async ({ app, page }) => {
  await app.open();
  await page.evaluate(seed);
});
// The resources panel starts folded while empty.
const openRes = page => page.evaluate(() => (document.querySelector('#resd').open = true));

test('the page leads with the next step and one primary action; resources fold away when empty', async ({
  app,
  page,
}) => {
  await app.openQuest('Weekly reporting');
  await expect(page.locator('.facts .qnext b')).toHaveText('Reconcile');
  // The sticky footer: the one thing to do next, and the rest of the actions behind ⋯.
  await expect(page.locator('.qfoot .btn:not(.qmore)')).toHaveText(['Focus: Reconcile']);
  await expect(page.locator('.qfoot [data-qact]')).toHaveCount(1);
  const res = page.locator('#resd');
  await expect(res).not.toHaveAttribute('open', '');
  await expect(res.locator('summary')).toContainText('none yet');
  // Focus: Reconcile opens single-task mode on that step.
  await page.click('.qfoot [data-zen]');
  await expect(page.locator('#v-zen .zt')).toHaveText('Reconcile');
  await page.keyboard.press('Escape');
  // A quest without steps: Mark done and Focus on this.
  await page.click('[data-crumb="-1"]');
  await app.openQuest('Call Sam');
  await expect(page.locator('.qfoot .btn:not(.qmore)')).toHaveText(['Mark done', 'Focus on this']);
  await expect(page.locator('.facts .qnext')).toHaveCount(0);
});

test('articles, flows and web links can be linked, opened and removed; a step shares them', async ({
  app,
  page,
}) => {
  await app.openQuest('Weekly reporting');
  await openRes(page);
  await page.click('[data-resadd="kb"]');
  await expect(page.locator('#sheet .qact')).toHaveText([/Supplier credits/, /Weekly report procedure/]);
  await page.click('#sheet [data-linkkb="a1"]');
  await expect(page.locator('#sheet')).toHaveCount(0);
  await page.click('[data-resadd="flow"]');
  await page.click('#sheet [data-linkflow="f1"]');
  await page.click('[data-resadd="url"]');
  await page.fill('#resurl', 'reports.example.com/ssrs');
  await page.fill('#reslabel', 'SSRS portal');
  await page.press('#reslabel', 'Enter');
  const rows = page.locator('#resd .resrow');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Weekly report procedure');
  await expect(rows.nth(1).locator('a')).toHaveAttribute('href', 'ms-powerautomate:/console/flow/run?id=1');
  const web = rows.nth(2).locator('a');
  await expect(web).toHaveText(/SSRS portal/);
  await expect(web).toHaveAttribute('href', 'https://reports.example.com/ssrs');
  await expect(web).toHaveAttribute('target', '_blank');
  await expect(web).toHaveAttribute('rel', 'noopener noreferrer');
  let s = await app.state();
  expect(s.quests[0].links.map(l => l.kind)).toEqual(['kb', 'flow', 'url']);
  expect(s.quests[0].links[2]).toMatchObject({
    url: 'https://reports.example.com/ssrs',
    label: 'SSRS portal',
  });
  // The same article can't be linked twice (it's no longer offered).
  await page.click('[data-resadd="kb"]');
  await expect(page.locator('#sheet .qact')).toHaveText([/Supplier credits/]);
  await page.keyboard.press('Escape');

  // They survive a reload, and a step's page shows them to use (not to change).
  await page.reload();
  await app.openQuest('Weekly reporting');
  await expect(page.locator('#resd .resrow')).toHaveCount(3);
  await page.click('#v-today .open >> text="Reconcile"');
  await expect(page.locator('#resd .resrow')).toHaveCount(3);
  await expect(page.locator('#resd [data-unlink]')).toHaveCount(0);
  await expect(page.locator('#resd summary')).toContainText("the quest's");
  // Opening the article from here, and its ‹ comes back to the quest.
  await page.click('#resd [data-sart="a1"]');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Weekly report procedure');
  await expect(page.locator('#v-knowledge [data-kbback]')).toHaveText('‹ Back to the quest');
  await page.click('#v-knowledge [data-kbback]');
  await expect(page.locator('#v-today h1')).toHaveText('Reconcile');

  // Removing one, with Undo.
  await page.click('[data-crumb="0"]');
  await page.click('#resd .resrow >> nth=0 >> [data-unlink]');
  await expect(page.locator('#resd .resrow')).toHaveCount(2);
  await page.click('#undo');
  await expect(page.locator('#resd .resrow')).toHaveCount(3);
  s = await app.state();
  expect(s.quests[0].links).toHaveLength(3);
});

test('unsafe or malformed web addresses are refused, typed or synced in', async ({ app, page }) => {
  await app.openQuest('Weekly reporting');
  await openRes(page);
  await page.click('[data-resadd="url"]');
  for (const bad of ['javascript:alert(1)', 'ftp://x.y/z', 'not a link', 'data:text/html,hi']) {
    await page.fill('#resurl', bad);
    await page.press('#resurl', 'Enter');
    await expect(page.locator('#toast')).toContainText('Enter a web address');
    await expect(page.locator('#sheet .sheetbox')).toBeVisible();
  }
  await page.keyboard.press('Escape');
  expect((await app.state()).quests[0].links).toBeUndefined();
  // From a synced row or a backup: only sound links survive normalisation.
  await app.setState(s => {
    s.quests[0].links = [
      { id: 'ok', kind: 'url', url: 'https://good.example.com/' },
      { id: 'js', kind: 'url', url: 'javascript:alert(1)' },
      { id: 'bad"id', kind: 'kb', ref: 'a1' },
      { id: 'kb', kind: 'kb', ref: 'a2' },
      { id: 'kb', kind: 'kb', ref: 'a1' },
      { kind: 'flow', ref: 'f1' },
      'junk',
      { id: 'weird', kind: 'other', ref: 'a1' },
    ];
  });
  await page.reload();
  const links = (await app.state()).quests[0].links;
  expect(links.map(l => l.id)).toEqual(['ok', 'kb']);
  expect(links[0].label).toBe('');
  await expect(page.locator('#resd .resrow a[href^="javascript"]')).toHaveCount(0);
});

test('a renamed article keeps its link; a deleted article or flow shows as gone and can be unlinked', async ({
  app,
  page,
}) => {
  await app.setState(s => {
    s.quests[0].links = [
      { id: 'l1', kind: 'kb', ref: 'a1' },
      { id: 'l2', kind: 'flow', ref: 'f1' },
    ];
    s.kb[0].title = 'Weekly report procedure (v2)';
    s.flows = [];
  });
  await page.reload();
  await app.openQuest('Weekly reporting');
  const rows = page.locator('#resd .resrow');
  await expect(rows.nth(0)).toContainText('Weekly report procedure (v2)');
  await expect(rows.nth(1)).toContainText('Flow removed');
  await expect(rows.nth(1).locator('a')).toHaveCount(0);
  await page.click('#resd .resrow >> nth=1 >> [data-unlink]');
  await expect(rows).toHaveCount(1);
  // The article deleted in Knowledge: its row says so, the link record itself is untouched
  // (so the article coming back from another device re-links on its own).
  await page.evaluate(() => {
    S.kb = [];
    save();
    renderAll();
  });
  await expect(rows.nth(0)).toContainText('Removed from Knowledge');
  expect((await app.state()).quests[0].links).toEqual([{ id: 'l1', kind: 'kb', ref: 'a1' }]);
});

test('resources travel with the quest to the Inbox, to Upcoming and back, and into a repeat’s copies', async ({
  app,
  page,
}) => {
  await app.setState(s => (s.quests[0].links = [{ id: 'l1', kind: 'kb', ref: 'a1' }]));
  await page.reload();
  // To the Inbox and back.
  await page.click('[aria-label="Actions: Weekly reporting"]');
  await page.click('#sheet [data-toinbox]');
  let s = await app.state();
  expect(s.inbox[0].node.links).toHaveLength(1);
  await app.go('inbox');
  await page.click('#v-inbox [data-promote] >> nth=0');
  await app.go('today');
  s = await app.state();
  expect(s.quests.find(q => q.text === 'Weekly reporting').links).toHaveLength(1);
  // To Upcoming and back.
  await page.click('[aria-label="Actions: Weekly reporting"]');
  await page.click('#sheet [data-sched]:has-text("Do tomorrow")');
  s = await app.state();
  expect(s.later[0].links).toHaveLength(1);
  await page.click('#upd > summary');
  await page.click('#upd [data-now]');
  s = await app.state();
  expect(s.quests.find(q => q.text === 'Weekly reporting').links).toHaveLength(1);
  // A repeat's fresh copy has them too (the procedure is needed every time).
  await page.evaluate(() => {
    const q = S.quests.find(x => x.text === 'Weekly reporting');
    setRepeat(q, t => (t.days = [0, 1, 2, 3, 4, 5, 6]));
    S.quests = S.quests.filter(x => x !== q);
    S.day = shift(today(), -1);
    rollover();
    renderAll();
  });
  s = await app.state();
  expect(s.quests.find(q => q.text === 'Weekly reporting').links).toEqual([
    { id: 'l1', kind: 'kb', ref: 'a1' },
  ]);
});

test('the primary action follows the quest’s state: waiting, every step ticked, finished', async ({
  app,
  page,
}) => {
  await app.openQuest('Weekly reporting');
  // Only waiting steps left: review what you're waiting on.
  await page.evaluate(() => {
    const q = S.quests[0];
    q.children[1].wait = { who: 'Sam', note: '', due: '', since: today() };
    save();
    renderAll();
  });
  await expect(page.locator('.facts .qnext b')).toHaveText('Nothing until you hear back');
  await expect(page.locator('.qfoot .btn:not(.qmore)')).toHaveText(['Review waiting']);
  // Every step ticked: finish it.
  await page.evaluate(() => {
    const q = S.quests[0];
    delete q.children[1].wait;
    q.children[1].done = true;
    q.asked = 1;
    save();
    renderAll();
  });
  await expect(page.locator('.qfoot .btn:not(.qmore)')).toHaveText(['Finish quest']);
  await page.click('.qfoot [data-finish]');
  await expect(page.locator('.facts .qnext b')).toHaveText('Finished');
  await expect(page.locator('.qfoot .btn:not(.qmore)')).toHaveText(['Reopen quest']);
  await expect(page.locator('#resd')).toHaveCount(1); // (resources still there to add)
});
