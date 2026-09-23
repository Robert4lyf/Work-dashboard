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

test('botanical style: palette, rounded shapes and its fonts, loaded only when chosen', async ({
  app,
  page,
}) => {
  await app.open();
  const fontsLink = () => page.locator('#botanical-fonts').count();
  expect(await fontsLink()).toBe(0);
  await app.go('account');
  await page.click('[data-look="style"][data-val="botanical"]');
  const look = () =>
    page.evaluate(() => {
      const box = getComputedStyle(document.querySelector('header'));
      return {
        style: document.documentElement.dataset.style,
        radius: box.borderTopLeftRadius,
        header: box.backgroundColor,
        heading: getComputedStyle(document.querySelector('h2')).fontFamily,
      };
    });
  let r = await look();
  expect(r).toMatchObject({ style: 'botanical', radius: '14px', header: 'rgb(47, 74, 58)' });
  expect(r.heading).toContain('Fraunces');
  expect(await fontsLink()).toBe(1);
  await page.reload();
  expect((await look()).style).toBe('botanical');
  expect(await fontsLink()).toBe(1);
  // Plain font still overrides the style's fonts.
  await app.go('account');
  await page.click('[data-look="font"][data-val="plain"]');
  expect((await look()).heading).not.toContain('Fraunces');
  await page.click('[data-look="style"][data-val=""]');
  r = await look();
  expect(r.style).toBeUndefined();
  expect(r.radius).toBe('0px');
});
