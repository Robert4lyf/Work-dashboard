const { test, expect } = require('./fixtures');

test('font and colour choices apply at once and survive a reload', async ({ app, page }) => {
  await app.open();
  await app.go('account');
  await page.click('[data-look="font"][data-val="plain"]');
  await page.click('[data-look="theme"][data-val="dark"]');
  const root = () =>
    page.evaluate(() => ({
      font: document.documentElement.dataset.font,
      theme: document.documentElement.dataset.theme,
      family: getComputedStyle(document.querySelector('h2')).fontFamily,
    }));
  let r = await root();
  expect(r).toMatchObject({ font: 'plain', theme: 'dark' });
  expect(r.family).not.toContain('Press Start');
  await page.reload();
  r = await root();
  expect(r).toMatchObject({ font: 'plain', theme: 'dark' });
  // Appearance is per device: it is not part of the synced data.
  expect(JSON.stringify(await app.state())).not.toContain('plain');
  await app.go('account');
  await page.click('[data-look="font"][data-val=""]');
  await page.click('[data-look="theme"][data-val=""]');
  r = await root();
  expect(r.font).toBeUndefined();
  expect(r.theme).toBeUndefined();
});
