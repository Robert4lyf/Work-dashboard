const { test, expect } = require('./fixtures');

// Fixes from a review of the whole app.
test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 23, 58) });
  await app.open();
});

test('waiting: cleared in the Inbox stays cleared; a waiting quest moved to the Inbox stays waiting', async ({
  page,
}) => {
  const q = await page.evaluate(() => {
    S.inbox = [
      {
        id: 'i1',
        text: 'Ask',
        wait: { who: 'Sam', since: today() },
        node: fix({ id: 'n1', text: 'Ask', wait: { who: 'Sam' } }),
      },
    ];
    setWaiting('i1', null);
    promoteInbox('i1');
    return S.quests.find(x => x.id === 'n1');
  });
  expect(q.wait).toBeUndefined();

  const n = await page.evaluate(() => {
    S.quests.push(fix({ id: 'n2', text: 'Report', wait: { who: 'Ann', since: today() } }));
    moveToInbox('n2');
    return { inbox: S.inbox[0].wait, waiting: waitingNodes().length };
  });
  expect(n.inbox).toMatchObject({ who: 'Ann' });
  expect(n.waiting).toBe(1);
});

test('the day rolls over at midnight with the app left open', async ({ page }) => {
  await page.evaluate(() => {
    S.quests.push(fix({ id: 'd1', text: 'Finished', done: true }));
    save();
    renderAll();
  });
  await page.clock.fastForward('03:00');
  expect(await page.evaluate(() => [S.day, S.quests.map(q => q.id)])).toEqual(['2026-09-24', []]);
});

test('sync: record kinds from a newer version are never deleted; the daily reset counts as of midnight', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    sync2.synced['reminder:1'] = 'abc';
    markDirty();
    const unknown = sync2.dirty['reminder:1'];
    S.day = shift(today(), -1);
    S.quests.push(fix({ id: 'd2', text: 'x', done: true }));
    sync2.synced['quest:d2'] = 'old';
    rollover();
    return { unknown, at: sync2.dirty['quest:d2'].at, midnight: new Date(2026, 8, 23).getTime() };
  });
  expect(r.unknown).toBeUndefined();
  expect(r.at).toBe(r.midnight);
});

test('a crafted backup can’t put markup into ids or tag colours', async ({ page }) => {
  const s = await page.evaluate(() => {
    norm({ quests: [{ id: 'a"><img src=x>', text: 't' }], tags: [{ name: 'x', color: 'red"><b>' }] });
    return { id: S.quests[0].id, color: S.tags[0].color };
  });
  expect(s.id).toBe('aimgsrc=x');
  expect(s.color).toBe('#C2C3C7');
});

test('a ringing alarm takes the keyboard: Dismiss is focused, shortcuts and the page behind are off', async ({
  page,
}) => {
  await page.evaluate(() => {
    S.alarms = [{ id: 'r1', time: '23:59', label: '', device: '', day: today(), done: '', snooze: 0 }];
    save();
    renderAll();
  });
  await page.clock.fastForward('01:30');
  await expect(page.locator('#v-alarm')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement.dataset.adismiss)).toBe('r1');
  expect(await page.evaluate(() => document.querySelector('.wrap').inert)).toBe(true);
  await page.keyboard.press('s');
  expect(await page.evaluate(() => view)).toBe('today');
  await page.keyboard.press('Enter');
  await expect(page.locator('#v-alarm')).toBeHidden();
  expect(await page.evaluate(() => document.querySelector('.wrap').inert)).toBe(false);
});

test('the header keeps keyboard focus through its minute refresh; Delete arms on the first tap with a row menu open', async ({
  page,
}) => {
  await page.focus('#hstats button');
  await page.evaluate(() => renderHeader());
  expect(await page.evaluate(() => document.activeElement.closest('#hstats') !== null)).toBe(true);

  await page.evaluate(() => {
    S.quests = [fix({ id: 'q1', text: 'Row' })];
    S.later = [fix({ id: 'L1', text: 'Later one', start: '2026-10-01' })];
    panels.upd = true;
    save();
    renderAll();
  });
  await page.click('[data-xopen="q1"]');
  await page.click('[data-dellater="L1"]');
  await expect(page.locator('[data-dellater="L1"]')).toHaveText('Delete?');
});
