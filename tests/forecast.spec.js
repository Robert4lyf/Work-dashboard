// Release C: estimates, capacity and the workload forecast.
const { test, expect } = require('./fixtures');
const shift = (ds, n) => {
  const d = new Date(ds + 'T12:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

const seed = () => {
  S.quests = [
    fix({ id: 'q1', text: 'Big report', est: 420, due: shift(today(), 1) }),
    fix({ id: 'q2', text: 'Small', est: 30 }),
    fix({
      id: 'q3',
      text: 'Stepped',
      est: 999, // (ignored: its steps carry the estimate)
      children: [fix({ id: 's1', text: 'A', est: 60 }), fix({ id: 's2', text: 'B', est: 90, done: true })],
    }),
    fix({ id: 'q4', text: 'No estimate' }),
  ];
  S.later = [fix({ id: 'L1', text: 'Later', est: 120, start: shift(today(), 3) })];
  S.templates = [fix({ id: 't1', text: 'Daily standup', est: 15, days: [0, 1, 2, 3, 4, 5, 6], monthDay: 0 })];
  S.cap = [60, 300, 300, 300, 300, 300, 60];
  save();
  renderAll();
};
const alloc = (page, span) =>
  page.evaluate(span => {
    const f = allocate(span);
    return {
      load: f.load,
      cap: f.cap,
      days: f.days.map(d => [
        d.load,
        d.cap,
        d.over,
        d.items.map(x => x.text + ':' + x.take + (x.over ? '!' : '')),
      ]),
      none: f.none.map(q => q.text),
      recs: recommendations(f).map(r => r.text + (r.move ? ' ->' + r.move.text : '')),
    };
  }, span);

test('estimates: steps replace the quest’s, what’s left is the estimate less focus time, junk is dropped', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  const e = await page.evaluate(() => ({
    q3: effEst(find('q3').n),
    q3left: remEst(find('q3').n),
    q1: effEst(find('q1').n),
    label: estLabel(find('q3').n),
  }));
  expect(e).toEqual({ q3: 150, q3left: 60, q1: 420, label: '2h 30m · 1h 0m left (steps)' });
  await page.evaluate(() => {
    S.sessions.push({ tag: 'work', mins: 100, t: Date.now(), q: 'q1', p: '' });
    S.quests.push(
      fix({ id: 'j1', text: 'Junk', est: -5 }),
      fix({ id: 'j2', text: 'Junk2', est: 'abc' }),
      fix({ id: 'j3', text: 'Huge', est: 99999 }),
    );
    save();
  });
  const s = await app.state();
  expect(s.quests.filter(q => q.text.startsWith('Junk') || q.text === 'Huge').map(q => q.est)).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect(await page.evaluate(() => [remEst(find('q1').n), estLabel(find('q1').n)])).toEqual([
    320,
    '7h 0m · 5h 20m left',
  ]);
  // The chip on the quest page sets it (a preset, or typed); the steps' parent says to set theirs.
  await app.openQuest('Small');
  await expect(page.locator('[data-estpick="q2"]')).toHaveText('Estimate 30m');
  await page.click('[data-estpick="q2"]');
  await page.click('[data-sheetans="120"]');
  expect((await app.state()).quests[1].est).toBe(120);
  await page.click('[data-estpick="q2"]');
  await page.fill('#sheetin', '45');
  await page.click('#sheetok');
  expect((await app.state()).quests[1].est).toBe(45);
  await page.click('[data-estpick="q2"]');
  await page.click('[data-sheetans="0"]');
  expect((await app.state()).quests[1].est).toBeUndefined();
  await expect(page.locator('[data-estpick="q2"]')).toHaveText('+ Estimate');
  await page.evaluate(() => {
    path = [];
    go('today');
  });
  await app.openQuest('Stepped');
  await page.click('[data-estpick="q3"]');
  await expect(page.locator('#toast')).toContainText('Its steps carry the estimate');
  expect(app.errors).toEqual([]);
});

test('the forecast is the same every time: due first, split across days, overruns on the due day, repeats fixed, unestimated counted', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  const wd = new Date().getDay();
  const f = await alloc(page, 7);
  // Today: capacity for today; Big report (due tomorrow, 7h) takes today's room then tomorrow's;
  // what doesn't fit by tomorrow is tomorrow's overrun.
  const cap0 = [60, 300, 300, 300, 300, 300, 60][wd],
    cap1 = [60, 300, 300, 300, 300, 300, 60][(wd + 1) % 7];
  expect(f.days[0][1]).toBe(cap0);
  expect(f.days[0][3][0]).toBe('Big report:' + cap0);
  const d1 = f.days[1];
  expect(d1[3][0]).toBe('Daily standup:15');
  expect(d1[3].some(x => x.startsWith('Big report:'))).toBe(true);
  const overrun = 420 - cap0 - Math.max(0, cap1 - 15);
  expect(d1[2]).toBe(overrun > 0 ? overrun : 0);
  expect(f.none).toEqual(['No estimate']);
  expect(f.load).toBe(420 + 30 + 60 + 120 + 15 * 6);
  expect(f.recs.join('\n')).toContain('1 quest without an estimate is left out');
  if (overrun > 0) expect(f.recs[0]).toMatch(/^Tomorrow is over by/);
  // Twice the same.
  expect(await alloc(page, 7)).toEqual(f);
  expect(await alloc(page, 14)).toEqual(await alloc(page, 14));
  // Later quests from their start day; nothing before.
  const f14 = await alloc(page, 14);
  expect(f14.days.slice(0, 3).some(d => d[3].some(x => x.startsWith('Later')))).toBe(false);
  expect(f14.days.slice(3).some(d => d[3].some(x => x.startsWith('Later')))).toBe(true);
  // A move is offered only to a later day with room before the due date, and is a button that asks.
  await page.evaluate(() => {
    S.quests = [
      fix({ id: 'a', text: 'Alpha', est: 240, due: shift(today(), 2) }),
      fix({ id: 'b', text: 'Beta', est: 240, due: shift(today(), 2) }),
    ];
    S.later = [];
    S.templates = [];
    S.cap = [300, 300, 300, 300, 300, 300, 300];
    save();
  });
  const g = await alloc(page, 7);
  expect(g.days.map(d => d[0])).toEqual([300, 180, 0, 0, 0, 0, 0]);
  expect(g.recs).toEqual([`Everything planned fits: 8h 0m of 35h 0m over 7 days.`]);
  await page.evaluate(() => {
    S.quests.push(
      fix({ id: 'c', text: 'Gamma', est: 600, due: shift(today(), 1) }),
      fix({ id: 'd', text: 'Delta', est: 60 }),
    );
    save();
  });
  const h = await alloc(page, 7);
  // Gamma fills today and tomorrow; Alpha and Beta are due the day after and only one fits:
  // Beta's rest is that day's overrun, and the offer is to move Beta past its due date.
  expect(h.days.map(d => d[0])).toEqual([300, 300, 480, 60, 0, 0, 0]);
  expect(h.days[2][2]).toBe(180);
  expect(h.recs[0]).toMatch(
    /^.+ is over by 3h 0m: 8h 0m planned against 5h 0m \(Alpha 4h 0m, Beta 1h 0m, Beta 3h 0m\)\. Moving Beta to .+ would fit \(4h 0m free that day\), after its due date\. ->Beta$/,
  );
  await app.go('review');
  await page.click('[data-rsub="forecast"]');
  await expect(page.locator('.rday.over')).toHaveCount(1);
  await page.click('[data-fmove="b"]');
  await expect(page.locator('#sheettitle')).toContainText('Move “Beta” to');
  await page.click('#sheetok');
  const s = await app.state();
  expect(s.quests.map(q => q.id)).toEqual(['a', 'c', 'd']);
  expect(s.later[0]).toMatchObject({ id: 'b', start: shift(today(), 3) });
  await expect(page.locator('.rday.over')).toHaveCount(0);
  await page.click('.rday >> nth=1');
  await expect(page.locator('.fday')).toContainText('Gamma');
  expect(app.errors).toEqual([]);
});

test('capacity is assumed until set, then synced as its own record; accuracy compares estimates with focus time', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.quests = [fix({ id: 'q1', text: 'One', est: 60 })];
    save();
    renderAll();
  });
  await app.go('review');
  await page.click('[data-rsub="forecast"]');
  await expect(page.locator('#v-review')).toContainText('capacity assumed');
  await expect(page.locator('.rec.cap')).toBeVisible();
  await page.click('#capd summary');
  await page.fill('[data-cap="1"]', '120');
  await page.dispatchEvent('[data-cap="1"]', 'change');
  const s = await app.state();
  expect(s.cap).toEqual([0, 120, 300, 300, 300, 300, 0]);
  expect(await page.evaluate(() => toRecords(S).has('meta:cap'))).toBe(true);
  await expect(page.locator('#v-review')).not.toContainText('capacity assumed');
  // Finishing a quest with an estimate records it with the focus time on it.
  await page.evaluate(() => {
    S.sessions.push({ tag: 'work', mins: 90, t: Date.now(), q: 'q1', p: '' });
    const bf = snapshot();
    find('q1').n.done = true;
    settle(bf);
  });
  const log = (await app.state()).log;
  expect(log[0]).toMatchObject({ id: 'q1', est: 60, m: 90 });
  await page.click('#accd summary');
  await expect(page.locator('#accd')).toContainText(
    '1 finished quest with an estimate took 1h 30m of focus time against 1h 0m estimated; the typical quest took 1.5× its estimate, and 0 of 1 came within a quarter of it. Estimates tend to run low.',
  );
  // Junk capacity is dropped.
  await page.evaluate(() => {
    S.cap = [1, 2];
    norm(S);
  });
  expect((await app.state()).cap).toBeNull();
  expect(app.errors).toEqual([]);
});
