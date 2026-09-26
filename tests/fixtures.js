// Shared test setup: every test gets a fresh app with no network beyond localhost
// (fonts and the Supabase library are blocked, so sync is off), plus helpers.
const base = require('@playwright/test');

const test = base.test.extend({
  app: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(
      u => !u.href.startsWith('http://localhost'),
      r => r.abort(),
    );
    const app = {
      page,
      errors,
      open: async () => {
        await page.goto('/');
        await page.waitForFunction(() => typeof window.renderAll === 'function');
      },
      state: () => page.evaluate(() => JSON.parse(localStorage.getItem('work-cockpit-v1'))),
      setState: fn =>
        page.evaluate(src => {
          const s = JSON.parse(localStorage.getItem('work-cockpit-v1'));
          new Function('s', src)(s);
          localStorage.setItem('work-cockpit-v1', JSON.stringify(s));
        }, `(${fn})(s)`),
      // New quests come in through the Inbox, then move to Today.
      addQuest: async text => {
        await page.click('nav [data-v=inbox]');
        await page.fill('#iin', text);
        await page.press('#iin', 'Enter');
        await page.click('#v-inbox [data-promote] >> nth=0');
        await page.click('nav [data-v=today]');
      },
      addSub: async text => {
        await page.fill('#sin', text);
        await page.press('#sin', 'Enter');
      },
      openQuest: text => page.click(`#v-today .open >> text="${text}"`),
      order: () => page.$$eval('#v-today .row .open > span', x => x.map(e => e.textContent)),
      // Views without a tab (Focus, and History/Projects under Review) are opened directly.
      go: async v => {
        const tab = page.locator(`nav [data-v=${v}]`);
        if (await tab.count()) await tab.click();
        else await page.evaluate(v => go(v), v);
      },
    };
    await use(app);
    base.expect(errors, 'page errors').toEqual([]);
  },
});

module.exports = { test, expect: base.expect };
