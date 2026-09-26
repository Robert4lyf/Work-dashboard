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

test('notes text follows the theme colour, so it stays readable in dark mode', async ({ app, page }) => {
  await app.open();
  await app.addQuest('Report');
  await app.go('account');
  await page.click('[data-look="theme"][data-val="dark"]');
  await app.go('today');
  await app.openQuest('Report');
  const c = await page.evaluate(() => [
    getComputedStyle(document.querySelector('#fnotes')).color,
    getComputedStyle(document.body).color,
  ]);
  expect(c[0]).toBe(c[1]);
});

test('project tags use the text colour, so they read in dark mode', async ({ app, page }) => {
  page.on('dialog', d => d.accept('Fletcher Way'));
  await app.open();
  await app.addQuest('Survey');
  await app.go('account');
  await page.click('[data-look="theme"][data-val="dark"]');
  await app.go('today');
  await app.openQuest('Survey');
  await page.selectOption('[data-setproject]', '__new');
  await page.click('[data-crumb="-1"]');
  const c = await page.evaluate(() => [
    getComputedStyle(document.querySelector('#v-today .tag.proj')).color,
    getComputedStyle(document.body).color,
  ]);
  expect(c[0]).toBe(c[1]);
});
