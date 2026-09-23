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
  await expect(page.locator('.zt')).toHaveText('Email');
  await page.keyboard.press('Escape');
  await expect(page.locator('#v-zen')).toBeHidden();
  await expect(page.locator('nav')).toBeVisible();
});

test('timer in single-task mode: start, pause, and Done saves the time', async ({ app, page }) => {
  await app.addQuest('Report');
  await page.keyboard.press('Escape'); // leave the quest box so z is a shortcut
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
