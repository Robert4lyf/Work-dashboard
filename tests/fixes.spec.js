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

test('round 2: unknown synced kinds don’t reload or drop Undo; a pending edit keeps its time through the reset', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    undoSnap = '{}';
    applyRows([{ key: 'widget:1', data: { a: 1 }, deleted: false, edited_at: 1, seq: 5 }], false);
    applyRows([{ key: 'widget:1', data: { a: 1 }, deleted: false, edited_at: 1, seq: 5 }], false);
    const kept = undoSnap !== null;
    S.quests.push(fix({ id: 'e1', text: 'edit' }));
    markDirty(Date.now());
    const t = sync2.dirty['meta:order'].at;
    S.quests.push(fix({ id: 'e2', text: 'reset' }));
    markDirty(1);
    return { kept, same: sync2.dirty['meta:order'].at === t };
  });
  expect(r).toEqual({ kept: true, same: true });
});

test('round 2: inbox waiting from older versions carries over; the waiting panel keeps Who while typing For what', async ({
  app,
  page,
}) => {
  const w = await page.evaluate(() => {
    norm({ inbox: [{ id: 'i9', text: 'Old', node: { id: 'n9', text: 'Old', wait: { who: 'Bo' } } }] });
    return [S.inbox[0].wait, S.inbox[0].node.wait];
  });
  expect(w).toEqual([{ who: 'Bo', due: '' }, undefined]);

  await page.evaluate(() => {
    S.quests = [fix({ id: 'wq', text: 'Chase' })];
    save();
    renderAll();
  });
  await app.openQuest('Chase');
  if (!(await page.locator('#wwho').isVisible())) await page.click('text=Waiting on someone');
  await page.fill('#wwho', 'Alice');
  await page.dispatchEvent('#wwho', 'change');
  await page.focus('#wnote');
  await page.evaluate(() => inBackground(renderToday));
  await expect(page.locator('#wwho')).toHaveValue('Alice');
});

test('round 2: stopping a paused session later counts its minutes when they were done', async ({ page }) => {
  const d = await page.evaluate(() => {
    S.quests = [fix({ id: 'tq', text: 'Work' })];
    startTimer('tq');
    S.timer.end = Date.now() + (S.timer.mins - 20) * 60000; // 20 minutes in
    togglePause(); // at 23:58
    return S.timer.pausedAt;
  });
  await page.clock.fastForward('10:00'); // past midnight
  const s = await page.evaluate(() => {
    stopAndSave(false);
    return S.sessions[S.sessions.length - 1];
  });
  expect(s.t).toBe(d);
  expect(s.mins).toBe(20);
});

test('round 3: Upcoming rows on Waiting open the Upcoming list; the chase date is kept until Save', async ({
  app,
  page,
}) => {
  await page.evaluate(() => {
    S.quests = [fix({ id: 'p1', text: 'Parent' })];
    S.later = [
      fix({ id: 'u1', text: 'Later waiting', start: '2026-10-01', wait: { who: 'Di', since: today() } }),
    ];
    save();
    renderAll();
  });
  await app.openQuest('Parent');
  await app.go('waiting');
  await page.click('#v-waiting [data-goupd]');
  await expect(page.locator('#upd')).toHaveAttribute('open', '');
  await expect(page.locator('#upd')).toContainText('Later waiting');

  await app.openQuest('Parent');
  if (!(await page.locator('#wdue').isVisible())) await page.click('#waitd summary');
  await page.fill('#wdue', '2026-09-30');
  await page.dispatchEvent('#wdue', 'change');
  await page.evaluate(() => inBackground(renderToday));
  await expect(page.locator('#wdue')).toHaveValue('2026-09-30');
});

test('round 4: a due session waits for the server while held; the waiting panel is not remembered open from a waiting quest', async ({
  page,
}) => {
  // Held (as while the first sync after opening is under way): the tick doesn't finish it.
  const r = await page.evaluate(async () => {
    S.quests = [fix({ id: 'h1', text: 'Hold' })];
    startTimer('h1');
    S.timer.end = Date.now() - 1000;
    const id = holdDue();
    timerTick();
    const held = !!S.timer,
      clock = document.title;
    // Pausing or extending a session that's over does nothing.
    togglePause();
    const paused = S.timer && S.timer.left != null;
    releaseHeld(id);
    return { held, clock, paused, after: !!S.timer, sessions: S.sessions.length };
  });
  expect(r).toMatchObject({ held: true, paused: false, after: false, sessions: 1 });
  expect(r.clock).toContain('00:00'); // the label kept up while held

  await page.evaluate(() => {
    S.quests = [
      fix({ id: 'w1', text: 'Waiting one', wait: { who: 'Al', since: today() } }),
      fix({ id: 'p1', text: 'Plain' }),
    ];
    panels.waitd = false;
    zen = false; // (the session above opened single-task mode)
    save();
    renderAll();
  });
  await page.click('#v-today .open >> text="Waiting one"');
  await expect(page.locator('#waitd')).toHaveAttribute('open', '');
  await page.evaluate(() => openPath([]));
  await page.click('#v-today .open >> text="Plain"');
  expect(await page.locator('#waitd').getAttribute('open')).toBeNull();
});

test('round 5: the keyboard stays in the view after an action; Restore backup is a real button; a hidden toast has no Undo', async ({
  app,
  page,
}) => {
  await page.evaluate(() => {
    S.quests = [fix({ id: 'k1', text: 'Keyboard one' }), fix({ id: 'k2', text: 'Keyboard two' })];
    save();
    renderAll();
  });
  await page.focus('#v-today [aria-label="Mark done: Keyboard one"]');
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => document.activeElement.getAttribute('aria-label'))).toBe(
    'Mark done: Keyboard one',
  );
  // The header's tick too: it moves on to the next quest, and keeps the keyboard.
  await page.focus('#hnow [data-toggle]');
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => document.activeElement.closest('#hnow') !== null)).toBe(true);
  await page.focus('[data-xopen="k2"]');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => document.activeElement.closest('#v-today') !== null)).toBe(true);

  await app.go('account');
  await page.focus('#impbtn');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('impbtn');

  await page.evaluate(() => toast('Gone', true, 100));
  await page.clock.fastForward(200);
  expect(await page.locator('#undo').count()).toBe(0);
});

test('round 6: repeats sent to Tomorrow aren’t doubled; a broken path is cut, not thrown; removing steps earns nothing', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    const t = {
      id: 't1',
      text: 'Standup',
      days: [0, 1, 2, 3, 4, 5, 6],
      monthDay: 0,
      children: [],
      auto: true,
    };
    S.templates.push(t);
    S.quests.push(Object.assign(inst(t), { id: 'q-standup', tpl: 't1' }));
    // Yesterday it was sent to "Tomorrow" (today): overnight it comes back, once.
    S.later.push(Object.assign(S.quests.pop(), { start: today() }));
    S.day = shift(today(), -1);
    save();
    rollover();
    const standups = S.quests.filter(q => q.text === 'Standup').length;

    // A/B open here; B became top-level and A went (as another device could do).
    S.quests = [fix({ id: 'B', text: 'B' })];
    path = ['A', 'B'];
    renderToday();
    const pathAfter = [...path];

    // Removing the open step of a quest doesn't finish it for points.
    const xp = S.xp;
    S.quests = [
      fix({
        id: 'P',
        text: 'P',
        children: [fix({ id: 's1', text: 'done', done: true }), fix({ id: 's2', text: 'open' })],
      }),
    ];
    const bf = snapshot();
    S.quests[0].children.pop();
    settle(bf);
    return { standups, pathAfter, gained: S.xp - xp, logged: S.log.filter(x => x.id === 'P').length };
  });
  expect(r).toEqual({ standups: 1, pathAfter: [], gained: 0, logged: 0 });
});

test('round 6: a saved template with the same name is left alone by Repeat; a finished quest moved to the Inbox comes back open', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    S.templates = [
      {
        id: 'saved',
        text: 'Weekly report',
        days: [1],
        monthDay: 0,
        children: [fix({ id: 'st', text: 'Gather numbers' })],
      },
    ];
    S.quests = [fix({ id: 'wr', text: 'Weekly report' })];
    setRepeat(S.quests[0], t => (t.days = [3]));
    const savedSteps = S.templates.find(t => t.id === 'saved').children.length;

    S.quests.push(fix({ id: 'fin', text: 'Finished', done: true }));
    moveToInbox('fin');
    promoteInbox(S.inbox[0].id);
    return { savedSteps, done: S.quests.find(q => q.id === 'fin').done };
  });
  expect(r).toEqual({ savedSteps: 1, done: false });
});

test('round 6: adding a step while a row’s × menu is open still adds it', async ({ app, page }) => {
  await page.evaluate(() => {
    S.quests = [fix({ id: 'm1', text: 'Menu quest', children: [fix({ id: 'm1a', text: 'Step' })] })];
    save();
    renderAll();
  });
  await app.openQuest('Menu quest');
  await page.click('[data-xopen="m1a"]');
  await page.fill('#sin', 'Another step');
  await page.press('#sin', 'Enter');
  expect(await page.evaluate(() => S.quests[0].children.map(c => c.text))).toEqual(['Step', 'Another step']);
});
