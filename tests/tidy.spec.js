// The tidy-up: quests have steps and steps don't; fewer controls on screen.
const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => {
  await app.open();
});

test('steps under a step move up beside it, named with it, ticks and waiting kept', async ({ app, page }) => {
  await app.setState(s => {
    s.quests = [
      {
        id: 'q',
        text: 'Contract',
        children: [
          {
            id: 'a',
            text: 'Draft',
            children: [
              { id: 'a1', text: 'Outline', done: true, children: [] },
              { id: 'a2', text: 'Legal', children: [{ id: 'a21', text: 'Check clause', children: [] }] },
            ],
          },
          { id: 'b', text: 'Sign', children: [] },
          {
            id: 'c',
            text: 'Chase',
            wait: { who: 'Sam' },
            children: [{ id: 'c1', text: 'Email', children: [] }],
          },
        ],
      },
    ];
  });
  await page.reload();
  const kids = (await app.state()).quests[0].children;
  expect(kids.map(c => [c.id, c.text, !!c.done, !!c.wait, c.children.length])).toEqual([
    ['a1', 'Draft: Outline', true, false, 0],
    ['a21', 'Draft: Legal: Check clause', false, false, 0],
    ['b', 'Sign', false, false, 0],
    ['c', 'Chase', false, true, 0],
    ['c1', 'Chase: Email', false, false, 0],
  ]);
  // Flattening again changes nothing (so devices don't keep rewriting it).
  await page.reload();
  expect((await app.state()).quests[0].children.map(c => c.text)).toEqual(kids.map(c => c.text));
});

test("a step's page has no subquests of its own; a quest's tag and do-later are folded away", async ({
  app,
  page,
}) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await expect(page.locator('#tagd')).not.toHaveAttribute('open', '');
  await expect(page.locator('#tagd summary')).toContainText('Tag: none');
  await expect(page.locator('[data-sched]').first()).toBeHidden(); // (under More)
  await expect(page.locator('#sopt')).toHaveCount(0);
  await app.setTag('Design');
  await expect(page.locator('#tagd summary')).toContainText('Design');
  await app.addSub('Draft');
  await page.click('#v-today .open >> text="Draft"');
  await expect(page.locator('#sform')).toHaveCount(0);
  await expect(page.locator('#tagd')).toHaveCount(0);
});

test('the header alarm opens the folded alarm list', async ({ app, page }) => {
  await app.setState(s => {
    s.alarms = [
      {
        id: 'al1',
        time: '09:00',
        label: 'Stand-up',
        device: '',
        day: today(),
        done: '',
        snooze: Date.now() + 3600e3,
      },
    ];
  });
  await page.reload();
  await expect(page.locator('#alarmd')).not.toHaveAttribute('open', '');
  await page.click('header .halarm');
  await expect(page.locator('#alarmd')).toHaveAttribute('open', '');
});

test('flattening keeps what a grouping step meant: optional, finished, deadline, notes', async ({
  app,
  page,
}) => {
  await app.setState(s => {
    s.quests = [
      {
        id: 'q',
        text: 'Done quest',
        children: [
          {
            id: 'a',
            text: 'Extras',
            opt: true,
            children: [{ id: 'a1', text: 'Nice to have', children: [] }],
          },
          { id: 'b', text: 'Main', done: true, children: [] },
          {
            id: 'w',
            text: 'Chase',
            wait: { who: 'Sam' },
            children: [{ id: 'w1', text: 'Got it', done: true, children: [] }],
          },
        ],
      },
      {
        id: 'r',
        text: 'Other',
        children: [
          { id: 'g', text: 'Group', due: '2026-10-01', children: [{ id: 'g1', text: 'Step', children: [] }] },
          { id: 'n', text: 'Noted', notes: 'keep me', children: [{ id: 'n1', text: 'Inner', children: [] }] },
        ],
      },
    ];
  });
  await page.reload();
  const s = await app.state(),
    [q, r] = s.quests;
  expect(await page.evaluate(() => isDone(S.quests[0]))).toBe(true); // (still finished)
  expect(q.children.find(c => c.id === 'a1').opt).toBe(true);
  expect(q.children.find(c => c.id === 'w').done).toBe(true);
  expect(r.children.find(c => c.id === 'g1').due).toBe('2026-10-01');
  expect(r.children.map(c => c.id)).toEqual(['g1', 'n', 'n1']);
});

test("History's Done list puts subquests under their quest (also in the copied text)", async ({
  app,
  page,
}) => {
  await app.setState(s => {
    const d = today();
    s.log = [
      { id: '1', d, text: 'Draft', trail: ['Report'], p: '' },
      { id: '2', d, text: 'Email Sam', trail: [], p: '' },
      { id: '3', d, text: 'Send', trail: ['Report'], p: '' },
      { id: '4', d, text: 'Report', trail: [], p: '' },
      { id: '5', d, text: 'Figures', trail: ['Budget'], p: '' },
    ];
  });
  await app.go('log');
  const top = page.locator('#v-log .logday > ul > li');
  await expect(top).toHaveCount(3);
  await expect(top.nth(0)).toHaveText(/^Report/);
  await expect(top.nth(0).locator('li')).toHaveText(['Draft', 'Send']);
  await expect(top.nth(1)).toHaveText('Email Sam');
  await expect(top.nth(2)).toHaveClass('open'); // (Budget itself isn't finished)
  await expect(top.nth(2).locator('li')).toHaveText(['Figures']);
  expect(await page.evaluate(() => logText().split('\n').slice(1))).toEqual([
    '- Report',
    '  - Draft',
    '  - Send',
    '- Email Sam',
    '- Budget',
    '  - Figures',
  ]);
});

test('a record only converted (flattened, or waiting moved to a step) is dated just after the version it converted', async ({
  app,
  page,
}) => {
  const r = await page.evaluate(() => {
    const nested = {
      id: 'q',
      text: 'Contract',
      children: [{ id: 'a', text: 'Draft', children: [{ id: 'a1', text: 'Outline', children: [] }] }],
    };
    const w = { id: 'w', text: 'Budget', children: [], wait: { who: 'Sam', note: '', due: '', since: '' } };
    // As a device synced before this version has it: the old shapes, synced, from 1000 and 2000.
    const s = JSON.parse(JSON.stringify(S));
    s.quests = [nested, w];
    sync2.et = { ...(sync2.et || {}), 'quest:q': 1000, 'quest:w': 2000 };
    sync2.synced['quest:q'] = hashOf(nested);
    sync2.synced['quest:w'] = hashOf(w);
    norm(s); // (loaded: converted in memory)
    markDirty(); // (the next save)
    const conv = { q: sync2.dirty['quest:q'].at, w: sync2.dirty['quest:w'].at };
    // A real edit afterwards is dated now.
    S.quests[0].children[0].done = true;
    markDirty();
    return { conv, edit: sync2.dirty['quest:q'].at, now: Date.now() };
  });
  expect(r.conv).toEqual({ q: 1001, w: 2001 });
  expect(r.edit).toBeGreaterThan(r.now - 60000);
});

test('old saved templates are removed; repeating quests keep theirs', async ({ app, page }) => {
  await app.setState(s => {
    s.templates = [
      { id: 't1', text: 'Saved one', children: [], days: [], monthDay: 0 },
      { id: 't2', text: 'Weekly', children: [], days: [1], monthDay: 0, auto: true },
      { id: 't3', text: 'Monthly', children: [], days: [], monthDay: 15 },
    ];
  });
  await page.reload();
  const s = await app.state();
  expect(s.templates.map(t => t.id)).toEqual(['t2', 't3']);
  // (and its record goes from the synced copy too: a deletion, dated as a conversion)
  const k = await page.evaluate(() => [...toRecords(S).keys()].filter(k => k.startsWith('template:')));
  expect(k).toEqual(['template:t2', 'template:t3']);
});
