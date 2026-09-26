const { test, expect } = require('./fixtures');

// Fake speech: what the app says is recorded; `hear(t)` answers the open microphone.
test.beforeEach(async ({ app, page }) => {
  await page.addInitScript(() => {
    window.__said = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak: u => {
          window.__said.push(u.text);
          Promise.resolve().then(() => u.onend && u.onend());
        },
        cancel() {},
      },
    });
    window.SpeechSynthesisUtterance = class {
      constructor(t) {
        this.text = t;
      }
    };
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start() {
        window.__rec = this;
      }
      stop() {}
      abort() {}
    };
    window.hear = t => {
      const r = window.__rec;
      window.__rec = null;
      r.onresult({ results: [[{ transcript: t }]] });
      r.onend();
    };
  });
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
  await page.clock.pauseAt(new Date(2026, 8, 23, 9, 0, 30));
});
const said = page => page.evaluate(() => window.__said[window.__said.length - 1]);
async function hear(page, t) {
  await page.waitForFunction(() => window.__rec);
  await page.evaluate(t => hear(t), t);
}

test('talk mode is off until turned on in Settings', async ({ app, page }) => {
  await app.addQuest('Report');
  await expect(page.locator('#talkbtn')).toHaveCount(0);
  await app.go('account');
  await page.click('[data-talkpref="on"]');
  await expect(page.locator('#talkbtn')).toBeVisible();
  await page.click('[data-talkpref="off"]');
  await expect(page.locator('#talkbtn')).toHaveCount(0);
});

test('talk mode: reads the day, then takes spoken commands', async ({ app, page }) => {
  await app.addQuest('Write report');
  await app.addQuest('Call Sam');
  await app.addQuest('Plan sprint');
  await app.setState(s => (s.quests[0].est = 60));
  await page.reload();
  await app.go('inbox');
  await page.fill('#iin', 'Book dentist');
  await page.press('#iin', 'Enter');
  await app.go('account');
  await page.click('[data-talkpref="on"]');
  await page.click('#talkbtn');
  await expect(page.locator('#v-talk')).toBeVisible();
  await expect(page.locator('nav')).toBeHidden();
  const brief = await said(page);
  expect(brief).toContain('0 of 3 done.');
  expect(brief).toContain('1 hour planned');
  expect(brief).toContain('Next up: Write report.');
  expect(brief).toContain('1 in the inbox.');

  await hear(page, 'Done');
  expect(await said(page)).toBe('Done: Write report. Next up: Call Sam.');
  expect((await app.state()).quests.find(q => q.text === 'Write report').done).toBe(true);

  await hear(page, 'Waiting on Sam');
  expect((await app.state()).quests.find(q => q.text === 'Call Sam').wait).toMatchObject({ who: 'Sam' });
  expect(await said(page)).toContain('Next up: Plan sprint.');

  await hear(page, 'Tomorrow');
  let s = await app.state();
  expect(s.later).toMatchObject([{ text: 'Plan sprint', start: '2026-09-24' }]);

  await hear(page, 'add buy milk');
  expect((await app.state()).inbox.map(x => x.text)).toEqual(['Buy milk', 'Book dentist']);

  // Sorting the inbox, one item at a time.
  await hear(page, 'inbox');
  expect(await said(page)).toBe('Buy milk. Today, tomorrow, next week, delete, or skip?');
  await hear(page, 'today');
  expect(await said(page)).toContain('Book dentist.');
  await hear(page, 'next week');
  s = await app.state();
  expect(s.inbox).toEqual([]);
  expect(s.quests.map(q => q.text)).toContain('Buy milk');
  expect(s.later.find(x => x.text === 'Book dentist').start).toBe('2026-09-28');
  expect(await said(page)).toBe('Inbox clear. Next up: Buy milk.');

  await hear(page, 'blah');
  expect(await said(page)).toContain('Say help');
  await expect(page.locator('#v-talk .tlog')).toContainText('blah');
  await hear(page, 'stop');
  await expect(page.locator('#v-talk')).toBeHidden();
  await expect(page.locator('nav')).toBeVisible();
});

test('talk mode: "start" starts a focus session on Next up', async ({ app, page }) => {
  await app.addQuest('Write report');
  await app.go('account');
  await page.click('[data-talkpref="on"]');
  await page.click('#talkbtn');
  await hear(page, 'start focus');
  await expect(page.locator('#v-talk')).toBeHidden();
  await expect(page.locator('#v-zen .zt')).toHaveText('Write report');
  expect((await app.state()).timer.q).toBe((await app.state()).quests[0].id);
});

test('the talk shortcut waits for a tap before speaking', async ({ page }) => {
  await page.goto('/?talk=1');
  await expect(page.locator('#talkgo')).toBeVisible();
  expect(await page.evaluate(() => window.__said.length)).toBe(0);
  await page.click('#talkgo');
  expect(await said(page)).toContain('Nothing on Today yet.');
});
