// Bug hunt after moving waiting to subquests: every place a waiting step can be.
const { test, expect } = require('./fixtures');

test.beforeEach(async ({ page, app }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
  await page.clock.pauseAt(new Date(2026, 8, 23, 9, 0, 30));
  // (the same helpers in the page, for setState)
  await page.evaluate(() => {
    window.q = (id, text, kids = [], extra = {}) => ({ id, text, children: kids, ...extra });
    window.wait = (who, due = '') => ({ who, note: '', due, since: '2026-09-20' });
  });
});

test('waiting steps on Upcoming quests and on quests back in the Inbox are listed and chased', async ({
  app,
  page,
}) => {
  await app.setState(s => {
    s.later = [
      {
        ...q('L', 'Contract', [q('Lw', 'Signed copy', [], { wait: wait('Legal', '2026-09-24') })]),
        start: '2026-09-28',
      },
    ];
    s.inbox = [
      { id: 'i1', text: 'Budget', node: q('B', 'Budget', [q('Bw', 'Figures', [], { wait: wait('Sam') })]) },
    ];
  });
  await app.go('waiting');
  const v = page.locator('#v-waiting');
  await expect(v.locator('.row')).toHaveCount(2);
  await expect(v.locator('.row', { hasText: 'Signed copy' })).toContainText('in Contract');
  await expect(v.locator('.row', { hasText: 'Signed copy' })).toContainText('on Upcoming');
  await expect(v.locator('.row', { hasText: 'Figures' })).toContainText('in Inbox');
  const want = await page.evaluate(() => wantedNotices(new Date(2026, 8, 23, 9).getTime()));
  expect(want.find(n => n.key.startsWith('chase:'))).toMatchObject({
    body: 'Contract / Signed copy (Legal)',
  });
  // The Inbox item says so, and "Got it" works on either.
  await app.go('inbox');
  await expect(page.locator('#v-inbox .tag.wait')).toHaveText('Waiting on Sam');
  await app.go('waiting');
  await v.locator('.row', { hasText: 'Figures' }).locator('[data-waitclear]').click();
  await v.locator('.row', { hasText: 'Signed copy' }).locator('[data-waitclear]').click();
  const s = await app.state();
  expect(s.inbox[0].node.children[0].wait).toBeUndefined();
  expect(s.later[0].children[0].wait).toBeUndefined();
});

test('finished quests set waiting reopen properly', async ({ app, page }) => {
  await app.setState(s => {
    s.quests = [q('a', 'Budget', [], { est: 60 }), q('b', 'Report', [q('b1', 'Draft')])];
  });
  await page.evaluate(() => setWaiting('a', { who: 'Sam', note: '', due: '' }));

  // Report is finished (logged), then set waiting: no longer done, and no longer logged.
  await page.evaluate(() => {
    const bf = snapshot();
    find('b1').n.done = true;
    settle(bf);
  });
  expect((await app.state()).log.map(x => x.text)).toContain('Report');
  await page.evaluate(() => setWaiting('b', { who: 'Ann', note: 'Sign-off', due: '' }));
  let s = await app.state();
  expect(s.quests[1].children.map(c => c.text).sort()).toEqual(['Draft', 'Sign-off']); // (done ones sink)
  expect(s.log.map(x => x.text)).not.toContain('Report');

  // A finished quest with no steps: set waiting reopens it with a waiting step (not nothing).
  await app.setState(s => (s.quests = [q('c', 'Invoice', [], { done: true })]));
  await page.evaluate(() => setWaiting('c', { who: 'Finance', note: '', due: '' }));
  s = await app.state();
  expect(s.quests[0].done).toBe(false);
  expect(s.quests[0].children[0]).toMatchObject({ text: 'Hear back', wait: { who: 'Finance' } });
});

test("a repeat's template leaves out waiting steps; the week summary heads groups with their quest", async ({
  app,
  page,
}) => {
  const t = await page.evaluate(() =>
    strip(
      fix({
        id: 'x',
        text: 'Weekly',
        children: [
          { id: 'y', text: 'Draft' },
          { id: 'z', text: 'Hear back', wait: { who: 'Sam' } },
        ],
      }),
    ),
  );
  expect(t.children.map(c => c.text)).toEqual(['Draft']);

  await app.setState(s => {
    s.log = [
      { id: '1', d: '2026-09-23', text: 'Report', trail: [], p: '' },
      { id: '2', d: '2026-09-23', text: 'Draft', trail: ['Report'], p: '' },
      { id: '3', d: '2026-09-23', text: 'Leaf', trail: ['Report', 'Draft'], p: '' },
      { id: '4', d: '2026-09-23', text: 'Loose', trail: [], p: '' },
    ];
  });
  expect(await page.evaluate(() => weekText())).toBe(
    'Week of 21 Sep: 4 done, 0m focus\n\nReport\n- Draft\n- Draft / Leaf\n\nOther\n- Loose',
  );
});

test('a waiting Inbox item given a subquest there still gets one waiting step on Today', async ({
  app,
  page,
}) => {
  await app.setState(s => (s.inbox = [{ id: 'ib1', text: 'Signed contract', wait: wait('Legal') }]));
  await app.go('inbox');
  await page.click('[data-steps="ib1"]');
  await page.fill('[data-subfor="ib1"] input', 'Scan it');
  await page.press('[data-subfor="ib1"] input', 'Enter');
  expect((await app.state()).inbox[0].node.children.map(c => c.text)).toEqual(['Scan it']);
  await page.click('#v-inbox [data-promote]');
  const n = (await app.state()).quests[0];
  expect(n.children.map(c => [c.text, !!c.wait])).toEqual([
    ['Scan it', false],
    ['Hear back', true],
  ]);
});
