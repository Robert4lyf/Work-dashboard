// A task's summary: optional, written by you under its name; Claude drafts one only on asking.
const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => {
  await app.open();
  await app.addQuest('Walsingham');
  await app.openQuest('Walsingham');
  await app.addSub('Organise visits');
});

test('the summary is optional, typed under the name, and shows under it on Today', async ({ app, page }) => {
  await expect(page.locator('#fsum')).toHaveValue('');
  expect((await app.state()).quests[0]).not.toHaveProperty('summary'); // (none: nothing stored)
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-today .qsum')).toHaveCount(0);

  await app.openQuest('Walsingham');
  await page.fill('#fsum', 'Offer accepted.\nVisits next week.');
  expect((await app.state()).quests[0].summary).toBe('Offer accepted.\nVisits next week.');
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-today .qsum')).toHaveText('Offer accepted.\nVisits next week.');
  // The name is still the row's name (the summary isn't taken for it).
  expect(await app.order()).toEqual(['Walsingham']);
  await page.reload();
  await expect(page.locator('#v-today .qsum')).toHaveText('Offer accepted.\nVisits next week.');

  // Cleared: gone again.
  await app.openQuest('Walsingham');
  await page.fill('#fsum', '  ');
  expect((await app.state()).quests[0]).not.toHaveProperty('summary');

  // Found by search.
  await page.fill('#fsum', 'Offer accepted');
  await page.click('#searchBtn');
  await page.fill('#sq', 'accepted');
  await expect(page.locator('#sres')).toContainText('Walsingham');
});

test('typing in the summary survives a background redraw', async ({ app, page }) => {
  await page.click('#fsum');
  await page.keyboard.type('Half way');
  await page.evaluate(() => inBackground(renderAll));
  await expect(page.locator('#fsum')).toHaveValue('Half way');
  await page.keyboard.type(' there');
  expect((await app.state()).quests[0].summary).toBe('Half way there');
});
