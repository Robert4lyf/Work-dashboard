const { test, expect } = require('./fixtures');

test('a shared link lands in the inbox once, and the URL is cleaned up', async ({ app, page }) => {
  await page.goto('/index.html?title=Q3%20plan&text=Q3%20plan%20draft&url=https%3A%2F%2Fexample.com%2Fq3');
  await expect(page.locator('nav [data-v=inbox]')).toHaveAttribute('aria-current', 'page');
  expect((await app.state()).inbox.map(x => x.text)).toEqual(['Q3 plan draft · https://example.com/q3']);
  expect(new URL(page.url()).search).toBe('');
  await page.reload();
  expect((await app.state()).inbox).toHaveLength(1);
});

test('long shared text keeps the full text in the notes', async ({ app, page }) => {
  const long = 'x'.repeat(300);
  await page.goto('/index.html?text=' + long);
  const it = (await app.state()).inbox[0];
  expect(it.text).toHaveLength(200);
  expect(it.node.notes).toBe(long);
});

test('the manifest declares the share target', async ({ page }) => {
  const res = await page.request.get('/manifest.webmanifest');
  expect((await res.json()).share_target.params).toEqual({ title: 'title', text: 'text', url: 'url' });
});

test('app-icon shortcuts open the inbox ready to type, or the Focus tab', async ({ app, page }) => {
  await page.goto('/index.html?capture=1');
  await expect(page.locator('#iin')).toBeFocused();
  expect(new URL(page.url()).search).toBe('');
  await page.goto('/index.html?focus=1');
  await expect(page.locator('#v-focus')).toBeVisible();
  const m = await (await page.request.get('/manifest.webmanifest')).json();
  expect(m.shortcuts.map(s => s.short_name)).toEqual(['Capture', 'Talk', 'Focus']);
});
