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
      addQuest: async text => {
        await page.click('nav [data-v=today]');
        await page.fill('#qin', text);
        await page.press('#qin', 'Enter');
      },
      addSub: async text => {
        await page.fill('#sin', text);
        await page.press('#sin', 'Enter');
      },
      openQuest: text => page.click(`#v-today .open >> text="${text}"`),
      order: () => page.$$eval('#v-today .row .open > span', x => x.map(e => e.textContent)),
      go: v => page.click(`nav [data-v=${v}]`),
    };
    await use(app);
    base.expect(errors, 'page errors').toEqual([]);
  },
});

module.exports = { test, expect: base.expect };
