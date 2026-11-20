const { test, expect } = require('./fixtures');

test('project detail offers manual summary and step entry when signed in', async ({ app, page }) => {
  await app.open();
  await app.addQuest('Check the rota');
  await app.openQuest('Check the rota');
  await page.evaluate(() => {
    sb = {};
    session = { user: { id: 'u' } };
    renderToday();
    sb = session = null;
  });
  await expect(page.getByRole('button', { name: /Summarise|Suggest steps/ })).toHaveCount(0);
  await expect(page.locator('#fsum')).toBeVisible();
  await expect(page.locator('#sin')).toBeVisible();
});
