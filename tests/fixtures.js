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
    // have started (it reads the store first). (storeDone is a top-level const, so it isn't on
    // window: `window.storeDone` was never there, the wait never happened, and a write still under
    // way when the page went was lost: the change just before the reload came back undone.)
    // With the sync library present (the service worker may have cached it), the app starts
    // deferred: the day's reset waits for the first auth event, which arrives a moment later.
    // A test acts only once that has happened, so the reset can't land mid-test.
    const started = async () => {
      await page.waitForFunction(() => window.appReady === true);
      await page
        .waitForFunction(() => typeof sb === 'undefined' || !sb || authSeen, null, { timeout: 5000 })
        .catch(() => {});
    };
    // A fresh reload starts on Projects. keepPlace keeps where the app was, as a real reload does.
    const reload = page.reload.bind(page);
    page.reload = async ({ keepPlace, ...o } = {}) => {
      await page.evaluate(() => (typeof storeDone === 'function' ? storeDone() : null)).catch(() => {});
      if (!keepPlace)
        await page
          .evaluate(() => {
            const drop = () => sessionStorage.removeItem('cockpit.place');
            addEventListener('pagehide', drop);
            document.addEventListener('visibilitychange', drop);
          })
          .catch(() => {});
      const r = await reload(o);
      await started();
      return r;
    };
    const app = {
      page,
      errors,
      // (`home`: a deep link to open at, say 'inbox'; Projects otherwise)
      open: async ({ home = 'projects' } = {}) => {
        // A flow's link (ms-powerautomate:) would hand the page to another app; headless
        // Chromium then swallows later clicks. The tap is still seen by the app's own handlers.
        await page.addInitScript(() =>
          addEventListener(
            'click',
            e => {
              const a = e.target.closest && e.target.closest('a[href^="ms-powerautomate:"]');
              if (a) e.preventDefault();
            },
            true,
          ),
        );
        await page.goto(['projects', 'work'].includes(home) ? '/' : '/#/' + home);
        await started();
      },
      // A Settings group (Release D: Settings is an index of groups, each a page of its own).
      settings: async group => {
        await page.click('nav [data-v=account]');
        await page.click(`[data-setgo="${group}"]`);
      },
      // Knowledge's Processes view (processes, guides, automations and what's under way).
      processes: async () => {
        await app.go('knowledge');
        await page.evaluate(() => {
          kbView = 'proc';
          wfView = null;
          renderKnowledge();
        });
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
      // New projects come in through the Inbox, then move to Projects.
      addQuest: async text => {
        await page.click('nav [data-v=inbox]');
        await page.fill('#iin', text);
        await page.press('#iin', 'Enter');
        await page.click('#v-inbox [data-promote] >> nth=0');
        await page.click('nav [data-v=projects]');
      },
      addSub: async text => {
        await page.fill('#sin', text);
        await page.press('#sin', 'Enter');
      },
      // A task's tag (folded to the one it has) and its "More" (do later, repeat...).
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
      // A project's page, from its card on the board.
      openQuest: async text => {
        if (await page.evaluate(() => view !== 'projects')) await page.click('nav [data-v=projects]');
        await page
          .locator('#v-projects .project-card h2 .project-open')
          .getByText(text, { exact: true })
          .first()
          .click();
      },
      // The projects on the board, in order (the active one first, then each section's).
      order: () =>
        page.$$eval('#v-projects .project-card h2 .project-open > span', x => x.map(e => e.textContent)),
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

// Opens folded sections of a page by id (Today's Needs attention 'attd', Flows 'flowsd'...): their
// contents are there either way, only hidden.
const unfold = (page, ...ids) =>
  page.evaluate(
    ids => ids.forEach(id => document.getElementById(id) && (document.getElementById(id).open = true)),
    ids,
  );

module.exports = { test, expect: base.expect, unfold };
