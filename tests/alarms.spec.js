const { test, expect } = require('./fixtures');

// Wednesday 23 Sep 2026, 9am.
test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
  await page.clock.pauseAt(new Date(2026, 8, 23, 9, 0, 30));
});

async function addAlarm(page, time, label) {
  // The Alarms section starts folded while no alarm is on.
  if ((await page.locator('#alarmd').getAttribute('open')) === null) await page.click('#alarmd summary');
  await page.click('#alarmadd');
  const id = await page.evaluate(() => S.alarms[S.alarms.length - 1].id);
  const row = page.locator('.arow', { has: page.locator(`[data-atime="${id}"]`) });
  await row.locator('[data-atime]').fill(time);
  await row.locator('[data-atime]').dispatchEvent('change');
  if (label) {
    await row.locator('[data-alabel]').fill(label);
    await row.locator('[data-alabel]').dispatchEvent('change');
  }
  return row;
}

test('an alarm rings at its time until dismissed, and can be snoozed', async ({ app, page }) => {
  const row = await addAlarm(page, '09:30', 'Call Sam');
  await expect(row.locator('[data-aon]')).toHaveText('Off');
  await row.locator('[data-aon]').click();
  await expect(row.locator('[data-aon]')).toHaveText('On');
  await expect(page.locator('#hstats')).toContainText('Alarm 09:30');
  await expect(page.locator('#v-alarm')).toBeHidden();

  await page.clock.fastForward('30:00');
  const ring = page.locator('#v-alarm');
  await expect(ring).toBeVisible();
  await expect(ring).toContainText('09:30');
  await expect(ring).toContainText('Call Sam');

  // Snooze: quiet for 5 minutes, then again.
  await ring.locator('[data-asnooze]').click();
  await expect(ring).toBeHidden();
  await expect(page.locator('#hstats')).toContainText('Alarm 09:35');
  await page.clock.fastForward('05:05');
  await expect(ring).toBeVisible();

  await ring.locator('[data-adismiss]').click();
  await expect(ring).toBeHidden();
  await page.clock.fastForward('10:00');
  await expect(ring).toBeHidden();
  await expect(row.locator('[data-aon]')).toHaveText('Done');
  expect((await app.state()).alarms[0]).toMatchObject({ day: '2026-09-23', done: '2026-09-23', snooze: 0 });
});

test('a time already gone today can’t be switched on; several alarms can be set', async ({ app, page }) => {
  const past = await addAlarm(page, '08:00');
  await past.locator('[data-aon]').click();
  await expect(page.locator('#toast')).toContainText('already passed');
  await page.clock.fastForward(3000); // let the toast go
  await expect(past.locator('[data-aon]')).toHaveText('Off');
  const a = await addAlarm(page, '11:00', 'Stand-up');
  const b = await addAlarm(page, '14:15', 'Leave');
  await a.locator('[data-aon]').click();
  await b.locator('[data-aon]').click();
  await expect(page.locator('#alarmd summary')).toContainText('(2 on)');
  // Listed by time.
  expect(await page.$$eval('.arow [data-atime]', xs => xs.map(x => x.value))).toEqual([
    '08:00',
    '11:00',
    '14:15',
  ]);
  await expect(page.locator('#hstats')).toContainText('Alarm 11:00');
});

test('overnight every alarm switches off but stays listed', async ({ app, page }) => {
  const row = await addAlarm(page, '17:00', 'Gym');
  await row.locator('[data-aon]').click();
  await page.clock.setSystemTime(new Date(2026, 8, 24, 8));
  await page.reload();
  const s = await app.state();
  expect(s.alarms).toMatchObject([{ time: '17:00', label: 'Gym', day: '', done: '' }]);
  await page.click('#alarmd summary'); // folded: nothing is on
  await expect(page.locator('.arow [data-aon]')).toHaveText('Off');
  await page.locator('.arow [data-aon]').click(); // on again for the new day
  expect((await app.state()).alarms[0].day).toBe('2026-09-24');
});

test('alarm notifications repeat each minute until dismissed, only to the chosen device', async ({
  app,
  page,
}) => {
  await addAlarm(page, '10:00', 'Report');
  await page.evaluate(() => {
    S.devices.push({ id: 'phone', name: 'Phone', endpoint: 'https://push.example/phone' });
    S.alarms[0].device = 'phone';
    save();
  });
  await page.locator('.arow [data-aon]').click();
  const notices = () =>
    page.evaluate(() => wantedNotices(Date.now()).filter(n => n.key.startsWith('alarm:')));
  let n = await notices();
  expect(n).toHaveLength(10);
  expect(n[0]).toMatchObject({ title: '⏰ Report', device: 'https://push.example/phone' });
  expect(n[1].at - n[0].at).toBe(60000);
  // It rings on the phone, not here.
  await page.clock.fastForward(3600000);
  await expect(page.locator('#v-alarm')).toBeHidden();
  // Dismissed (on any device): no more notifications.
  await page.evaluate(() => dismissAlarm(S.alarms[0].id));
  expect(await notices()).toHaveLength(0);
  // Any device: sent to every device (no device field).
  await page.evaluate(() => {
    const a = S.alarms[0];
    Object.assign(a, { device: '', time: '11:00', done: '' });
    save();
  });
  n = await notices();
  expect(n[0].device).toBeUndefined();
});

test('notes are saved as you type, and travel with sync records', async ({ app, page }) => {
  await app.go('notes');
  await page.fill('#notesin', 'Door code 4821\nParking: level 2');
  await page.clock.fastForward(1000);
  expect((await app.state()).notes).toBe('Door code 4821\nParking: level 2');
  await expect(page.locator('#notesstate')).toHaveText('Saved');
  const back = await page.evaluate(() => {
    S.alarms.push({ id: 'a1', time: '09:00', label: 'x', device: '', day: '', done: '', snooze: 0 });
    S.devices.push({ id: 'd1', name: 'PC', endpoint: '' });
    const m = toRecords(S);
    return {
      keys: [...m.keys()].filter(k => /^(meta:notes|alarm:|device:)/.test(k)),
      s: fromRecords(m, S.day),
    };
  });
  expect(back.keys).toEqual(expect.arrayContaining(['meta:notes', 'alarm:a1']));
  expect(back.keys.some(k => k.startsWith('device:'))).toBe(true);
  expect(back.s.notes).toBe('Door code 4821\nParking: level 2');
  expect(back.s.alarms[0].label).toBe('x');
  // A reload shows them again.
  await page.reload();
  await app.go('notes');
  await expect(page.locator('#notesin')).toHaveValue('Door code 4821\nParking: level 2');
});

test('review fixes: re-arming makes new notices, a half-typed past time never rings, device warnings', async ({
  app,
  page,
}) => {
  const row = await addAlarm(page, '10:00');
  await row.locator('[data-aon]').click();
  const keys = () =>
    page.evaluate(() =>
      wantedNotices(Date.now())
        .filter(n => n.key.startsWith('alarm:'))
        .map(n => n.key),
    );
  const first = await keys();
  // Off and on again (or a new time): fresh keys, so the server doesn't treat them as already sent.
  await row.locator('[data-aon]').click();
  await page.clock.fastForward(1000);
  await row.locator('[data-aon]').click();
  const second = await keys();
  expect(second).toHaveLength(10);
  expect(second.some(k => first.includes(k))).toBe(false);
  // Typing a new time: a past value on the way (08:00) doesn't ring or switch it off.
  await row.locator('[data-atime]').fill('08:00');
  await row.locator('[data-atime]').dispatchEvent('change');
  await page.clock.fastForward(2000);
  await expect(page.locator('#v-alarm')).toBeHidden();
  await row.locator('[data-atime]').fill('11:30');
  await row.locator('[data-atime]').dispatchEvent('change');
  let a = (await app.state()).alarms[0];
  expect(a).toMatchObject({ time: '11:30', day: '2026-09-23', done: '' });
  // A device without notifications is flagged.
  await page.evaluate(() => {
    S.devices.push({ id: 'old', name: 'Old phone', endpoint: '' });
    S.alarms[0].device = 'old';
    save();
    renderAll();
  });
  await expect(page.locator('.arow .awarn')).toContainText('Old phone has no notifications turned on');
  // Forgetting that device moves its alarms to any device.
  await app.go('account');
  await page.click('[data-forgetdev="old"]');
  await page.click('[data-forgetdev="old"]');
  a = (await app.state()).alarms[0];
  expect(a.device).toBe('');
  expect((await app.state()).devices.some(d => d.id === 'old')).toBe(false);
});

test('notes changed on another device while typing: offered, not silently lost', async ({ app, page }) => {
  await app.go('notes');
  await page.fill('#notesin', 'mine');
  await page.clock.fastForward(1000);
  await page.focus('#notesin');
  await page.evaluate(() => {
    S.notes = 'from the PC: https://example.com';
    inBackground(renderAll);
  });
  await expect(page.locator('#notesstate')).toContainText('Changed on another device');
  await expect(page.locator('#notesin')).toHaveValue('mine');
  await page.click('#notesload');
  await expect(page.locator('#notesin')).toHaveValue('from the PC: https://example.com');
});

test('an alarm ringing at midnight keeps ringing until dismissed; empty notes never sync', async ({
  app,
  page,
}) => {
  await page.clock.setSystemTime(new Date(2026, 8, 23, 23, 50));
  const row = await addAlarm(page, '23:58');
  await row.locator('[data-aon]').click();
  await page.clock.fastForward('09:00'); // 23:59, ringing
  await expect(page.locator('#v-alarm')).toBeVisible();
  await page.clock.fastForward('05:00'); // past midnight
  await page.evaluate(() => rollover());
  await page.clock.fastForward(1500);
  await expect(page.locator('#v-alarm')).toBeVisible();
  await page.click('[data-adismiss]');
  await expect(page.locator('#v-alarm')).toBeHidden();
  await page.evaluate(() => rollover());
  // Next morning it's off, still listed.
  await page.clock.setSystemTime(new Date(2026, 8, 24, 8));
  await page.reload();
  expect((await app.state()).alarms[0]).toMatchObject({ time: '23:58', day: '' });
  // No notes: no notes record (so an empty copy can't win over real notes elsewhere).
  expect(await page.evaluate(() => toRecords(S).has('meta:notes'))).toBe(false);
});
