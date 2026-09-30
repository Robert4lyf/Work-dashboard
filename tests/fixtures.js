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
    // A reload waits for writes to the store to finish first, then, like opening, for the app to
    // have started (it reads the store first).
    const reload = page.reload.bind(page);
    page.reload = async (...a) => {
      await page.evaluate(() => (window.storeDone ? storeDone() : null)).catch(() => {});
      const r = await reload(...a);
      await page.waitForFunction(() => window.appReady === true);
      return r;
    };
    const app = {
      page,
      errors,
      open: async () => {
        await page.goto('/');
        await page.waitForFunction(() => window.appReady === true);
      },
      // The app's data as saved (the state in memory is what the store holds, pictures included).
      state: () => page.evaluate(() => JSON.parse(JSON.stringify(S))),
      // Changes the saved data as a raw object (as a test would edit the saved copy), for the
      // reload that usually follows.
      setState: fn =>
        page.evaluate(async src => {
          const s = JSON.parse(JSON.stringify(S));
          new Function('s', src)(s);
          norm(s);
          persistLocal();
          await storeDone();
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
      // A quest's tag (folded to the one it has) and its "More" (do later, repeat...).
      setTag: async name => {
        await page.evaluate(
          () => document.querySelector('#tagd') && (document.querySelector('#tagd').open = true),
        );
        await page.click(`[data-settag="${name}"]`);
      },
      openMore: () =>
        page.evaluate(
          () => document.querySelector('#mored') && (document.querySelector('#mored').open = true),
        ),
      openQuest: text => page.click(`#v-today .open >> text="${text}"`),
      order: () => page.$$eval('#v-today .row .open > span', x => x.map(e => e.textContent)),
      // Views without a tab (Focus, and History under Review) are opened directly.
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
