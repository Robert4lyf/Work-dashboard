const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
  await page.clock.pauseAt(new Date(2026, 8, 23, 9, 0, 30));
});

test('single-task mode shows one step, ticks it off and moves on', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await app.addSub('Draft');
  await app.addSub('Review');
  await app.addQuest('Email');
  await page.click('header [data-zen]');
  await expect(page.locator('#v-zen')).toBeVisible();
  await expect(page.locator('header')).toBeHidden();
  await expect(page.locator('nav')).toBeHidden();
  await expect(page.locator('.ztrail')).toHaveText('Report');
  await expect(page.locator('.zt')).toHaveText('Draft');
  await page.click('#v-zen [data-toggle]');
  await expect(page.locator('.zt')).toHaveText('Review');
  await page.click('#v-zen [data-toggle]');
  // (the task's last step: it asks what's next, and stays open)
  await expect(page.locator('#sheettitle')).toHaveText("What's next?");
  await page.click('#sheet [data-sheetclose]:not(.sheetback)');
  await expect(page.locator('.zt')).toHaveText('Email');
  await page.keyboard.press('Escape');
  await expect(page.locator('#v-zen')).toBeHidden();
  await expect(page.locator('nav')).toBeVisible();
});

test('timer in single-task mode: start, pause, and Done saves the time', async ({ app, page }) => {
  await app.addQuest('Report');
  await page.keyboard.press('Escape'); // leave the task box so z is a shortcut
  await page.keyboard.press('z');
  await page.click('[data-zstart]');
  await expect(page.locator('#zclock')).toHaveText('25:00');
  await page.clock.fastForward('05:00');
  await expect(page.locator('#zclock')).toHaveText('20:00');
  await page.click('#v-zen [data-pause]');
  expect((await app.state()).timer.left).not.toBeUndefined();
  await page.click('#v-zen [data-pause]');
  await page.click('#v-zen [data-stop="done"]');
  const s = await app.state();
  expect(s.timer).toBeNull();
  expect(s.quests[0].done).toBe(true);
  expect(s.daily['2026-09-23']['']).toBe(5);
  await expect(page.locator('.zt')).toHaveText('Nothing left to do.');
});

test("the header's Focus button opens the task the header shows", async ({ app, page }) => {
  await app.addQuest('Report');
  await app.addQuest('Email');
  // An older pick on the Focus tab doesn't win over what the header shows.
  await app.setState(s => (s.focusQ = s.quests[1].id));
  await page.reload();
  await expect(page.locator('#hnow')).toContainText('Report');
  await page.click('header [data-zen]');
  await expect(page.locator('.zt')).toHaveText('Report');
});

test('Focus on another task while a session is paused asks first: back to it, or save it and switch', async ({
  app,
  page,
}) => {
  await app.addQuest('Report');
  await app.addQuest('Email');
  const email = (await app.state()).quests.find(q => q.text === 'Email').id;
  await page.evaluate(id => {
    S.top3 = { day: today(), ids: [S.quests[0].id, id] };
    save();
    renderAll();
  }, email);
  await page.click('header [data-zen]');
  await expect(page.locator('.zt')).toHaveText('Report');
  await page.click('[data-zstart]');
  await page.clock.fastForward('03:00');
  await page.click('#v-zen [data-pause]');
  await page.click('#zenexit');
  // Focus on Email: not Report's session, quietly.
  await page.click(`.top3 [data-zen][data-q="${email}"]`);
  await expect(page.locator('#sheettitle')).toHaveText('Switch focus?');
  await expect(page.locator('#sheet')).toContainText('Report has a paused session (3 min)');
  await page.click('#sheet [data-sheetans="back"]');
  await expect(page.locator('.zt')).toHaveText('Report');
  await expect(page.locator('#zclock')).toHaveText('22:00');
  await page.click('#zenexit');
  // Cancel: nothing changes.
  await page.click(`.top3 [data-zen][data-q="${email}"]`);
  await page.click('#sheet [data-sheetclose]:not(.sheetback)');
  await expect(page.locator('#v-zen')).toBeHidden();
  expect((await app.state()).timer).not.toBeNull();
  // Save and switch: Report's 3 minutes are kept, Email is in front.
  await page.click(`.top3 [data-zen][data-q="${email}"]`);
  await page.click('#sheetok');
  await expect(page.locator('.zt')).toHaveText('Email');
  const s = await app.state();
  expect(s.timer).toBeNull();
  expect(s.daily['2026-09-23']['']).toBe(3);
});
