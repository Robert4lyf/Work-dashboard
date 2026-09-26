const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app, page }) => {
  await page.addInitScript(() => {
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start() {
        window.__rec = this;
      }
      stop() {
        this.onend && this.onend();
      }
    };
    window.say = t => {
      window.__rec.onresult({ results: [[{ transcript: t }]] });
      window.__rec.onend();
    };
  });
  await app.open();
  await app.go('inbox');
});

test('voice capture splits on "next item" in order', async ({ app, page }) => {
  await page.click('#mic');
  await expect(page.locator('#mic')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => say('call Sam next item book dentist next item plan next sprint'));
  expect((await app.state()).inbox.map(x => x.text)).toEqual([
    'Call Sam',
    'Book dentist',
    'Plan next sprint',
  ]);
});

test('subquests and tag on an inbox item carry over to Today', async ({ app, page }) => {
  await page.fill('#iin', 'Plan offsite');
  await page.press('#iin', 'Enter');
  const id = (await app.state()).inbox[0].id;
  await page.click(`[data-steps="${id}"]`);
  await page.click(`[data-settag="Meetings"][data-id="${id}"]`);
  const sub = `[data-subfor="${id}"] input`;
  for (const t of ['Book room', 'Agenda']) {
    await page.fill(sub, t);
    await page.press(sub, 'Enter');
  }
  await page.click(`[data-delsub="${id}"] >> nth=0`);
  await page.click('#undo');
  await page.click(`[data-promote="${id}"]`);
  const q = (await app.state()).quests[0];
  expect(q).toMatchObject({ text: 'Plan offsite', tag: 'Meetings' });
  expect(q.children.map(c => c.text)).toEqual(['Book room', 'Agenda']);
});

test('mic is hidden where speech recognition is unavailable', async ({ browser }) => {
  const page = await browser.newPage();
  await page.route(
    u => !u.href.startsWith('http://localhost'),
    r => r.abort(),
  );
  await page.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  await page.goto('/');
  await expect(page.locator('#mic')).toHaveCount(0);
  await page.close();
});

test('tapping an item’s title shows and hides its details; a swipe doesn’t', async ({ page }) => {
  await page.fill('#iin', 'Book dentist');
  await page.press('#iin', 'Enter');
  const title = page.locator('#v-inbox .ititle');
  await expect(page.locator('#v-inbox .iacts .linkbtn')).toHaveCount(0); // no Details link
  await title.click();
  await expect(title).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#v-inbox [data-subfor]')).toBeVisible();
  await title.click();
  await expect(title).toHaveAttribute('aria-expanded', 'false');
  // A short swipe that springs back isn't a tap.
  const box = await title.boundingBox(),
    y = box.y + box.height / 2,
    x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(x + (40 * i) / 5, y);
  await page.mouse.up();
  await expect(title).toHaveAttribute('aria-expanded', 'false');
});
