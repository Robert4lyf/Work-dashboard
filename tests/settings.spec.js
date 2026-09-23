const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => app.open());

test('tag rename and delete update quests; delete can be undone', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await page.click('[data-settag="Design"]');
  await page.click('[data-edittags]');
  await expect(page.locator('#v-account')).toBeVisible();
  await page.fill('[data-tagname="0"]', 'UX');
  await page.press('[data-tagname="0"]', 'Tab');
  expect((await app.state()).quests[0].tag).toBe('UX');
  await page.click('[data-deltag="0"]');
  await page.click('[data-deltag="0"]');
  expect((await app.state()).quests[0].tag).toBe('');
  await page.click('#undo');
  expect((await app.state()).quests[0].tag).toBe('UX');
});

test('sync button and s shortcut open the Settings tab', async ({ app, page }) => {
  await page.click('#syncBtn');
  await expect(page.locator('nav [data-v=account]')).toHaveAttribute('aria-current', 'page');
  await app.go('today');
  await page.keyboard.press('s');
  await expect(page.locator('#v-account')).toBeVisible();
});
