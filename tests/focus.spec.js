const { test, expect } = require('./fixtures');

// The clock is paused, so time only moves when a test fast-forwards it.
test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
  await page.clock.pauseAt(new Date(2026, 8, 23, 9, 0, 30));
});

test('session defaults to Next up, takes its tag, and Done ticks it off', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await page.click('[data-settag="Design"]');
  await app.addSub('Draft');
  await app.addQuest('Email');
  await app.go('focus');
  expect(await page.$eval('#fq', e => e.options[e.selectedIndex].text)).toBe('Report / Draft');
  await page.click('#start');
  let s = await app.state();
  expect(s.timer.tag).toBe('Design');
  await expect(page.locator('#v-zen')).toBeVisible();
  await expect(page.locator('.zt')).toHaveText('Draft');
  await page.click('#v-zen [data-plus5]');
  expect((await app.state()).timer.mins).toBe(30);
  await page.clock.fastForward('10:00');
  await page.click('#v-zen [data-stop="done"]');
  s = await app.state();
  expect(s.timer).toBeNull();
  expect(s.daily['2026-09-23'].Design).toBe(10);
  expect(s.quests.find(q => q.text === 'Report').children[0].done).toBe(true);
  expect(await page.$eval('#fq', e => e.options[e.selectedIndex].text)).toBe('Email');
});

test('pause excludes paused time; header shows the timer on other tabs', async ({ app, page }) => {
  await app.go('focus');
  await page.selectOption('#fq', 'none');
  await page.click('#start');
  await page.clock.fastForward('05:00');
  await page.click('#v-zen [data-pause]');
  await page.clock.fastForward('10:00');
  await page.click('#zenexit');
  await expect(page.locator('#v-focus')).toBeVisible();
  await app.go('today');
  await expect(page.locator('header #hclock')).toHaveText('20:00');
  // Resuming puts you back in single-task mode.
  await page.keyboard.press('p');
  await expect(page.locator('#v-zen')).toBeVisible();
  await page.clock.fastForward('02:00');
  await page.click('#v-zen [data-stop="save"]');
  expect((await app.state()).daily['2026-09-23']['']).toBe(7);
});

test('the timer finishes on its own', async ({ app, page }) => {
  await app.go('focus');
  await page.click('#start');
  await page.clock.fastForward('26:00');
  const s = await app.state();
  expect(s.timer).toBeNull();
  expect(s.daily['2026-09-23']['']).toBe(25);
});

test('History shows focus time by tag and finished items', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.go('focus');
  await page.click('#start');
  await page.clock.fastForward('26:00');
  await page.keyboard.press('Escape');
  await page.click('[aria-label="Mark done: Report"]');
  await app.go('log');
  await expect(page.locator('#v-log')).toContainText('Untagged');
  await expect(page.locator('#v-log')).toContainText('Report');
  await page.click('[data-range="30"]');
  await expect(page.locator('#v-log .bars h2')).toContainText('30 days');
});

test('a running session holds you in single-task mode until you pause', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.go('focus');
  await page.click('#start');
  await expect(page.locator('#v-zen')).toBeVisible();
  await expect(page.locator('nav')).toBeHidden();
  // No way out while it runs: no Exit, and Esc and tab shortcuts do nothing.
  await expect(page.locator('#zenexit')).toHaveCount(0);
  await expect(page.locator('#v-zen .zx')).toHaveText('Pause to leave single-task mode');
  for (const k of ['Escape', 't', 'l']) await page.keyboard.press(k);
  await expect(page.locator('#v-zen')).toBeVisible();
  // Pausing unlocks it; leaving keeps the (paused) timer.
  await page.click('#v-zen [data-pause]');
  await page.keyboard.press('Escape');
  await expect(page.locator('#v-focus #clock')).toBeVisible();
  expect((await app.state()).timer).not.toBeNull();
  // Resuming from the Focus tab goes straight back in; so does reopening the app.
  await page.click('#v-focus [data-pause]');
  await expect(page.locator('#v-zen')).toBeVisible();
  await page.reload();
  await expect(page.locator('#v-zen')).toBeVisible();
  await expect(page.locator('#zenexit')).toHaveCount(0);
  await page.click('#v-zen [data-discard]');
  await page.click('#v-zen [data-discard]');
  expect((await app.state()).timer).toBeNull();
  await expect(page.locator('#v-zen [data-zstart]')).toBeVisible();
});
