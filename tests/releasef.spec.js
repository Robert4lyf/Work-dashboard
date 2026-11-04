// Release F: mobile clarity, visual refinement and reliability.
const { test, expect } = require('./fixtures');
const { eDay } = require('./releaseedata');

async function day(app, page, at = new Date(2026, 10, 4, 11, 0)) {
  await page.clock.install({ time: at });
  await app.open();
  await app.setState(eDay);
  await page.reload();
}
const tops = page =>
  page.evaluate(() => {
    const y = s => {
      const e = document.querySelector(s);
      return e ? e.getBoundingClientRect().top + scrollY : null;
    };
    return {
      attn: y('#v-today .attn'),
      top3: y('#v-today .top3'),
      sched: y('#v-today .schedsec'),
      wait: y('#v-today .waitsec2'),
      tasks: y('#v-today .list'),
    };
  });

test.describe('Checkpoint 1: Today on a phone', () => {
  for (const [w, h] of [
    [320, 800],
    [360, 800],
    [390, 844],
    [412, 915],
  ])
    test(`${w}px: attention, Top 3, Scheduled, Waiting, then the list; nothing sideways`, async ({
      app,
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await day(app, page);
      const t = await tops(page);
      expect(t.attn).toBeLessThan(t.top3);
      expect(t.top3).toBeLessThan(t.sched);
      expect(t.sched).toBeLessThan(t.wait);
      // (Waiting above the list: a long day doesn't bury what you're chasing)
      expect(t.wait).toBeLessThan(t.tasks);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });

  test('390 × 844: Top 3 starts on the first screen, Waiting within the second', async ({ app, page }) => {
    await day(app, page);
    const t = await tops(page);
    // (measured before Release F: Top 3 at 527px, Waiting at 3036px, below the whole list)
    expect(t.top3).toBeLessThan(844 - 66 - 200);
    expect(t.wait).toBeLessThan(2 * 844 - 66);
  });

  test('a follow-up from Waiting in its new place still works; the list keeps its tasks', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const names = await page.$$eval('#v-today .list .row .open > span', x => x.map(e => e.textContent));
    await page.click('#v-today .waitsec2 [data-chase]');
    await expect(page.locator('#sheet')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      todayView = 'board';
      renderAll();
    });
    await expect(page.locator('#v-today .waitsec2 + .sechead')).toHaveCount(1);
    await page.evaluate(() => {
      todayView = 'list';
      renderAll();
    });
    expect(await page.$$eval('#v-today .list .row .open > span', x => x.map(e => e.textContent))).toEqual(
      names,
    );
  });

  test('a long name takes two lines in a list, and all of it on its page', async ({ app, page }) => {
    await app.open();
    const long =
      'Write up the quarterly supplier review notes and send them to everyone who was at the meeting';
    await app.addQuest(long);
    const span = page.locator('#v-today .list .row .open > span').first();
    const lh = parseFloat(await span.evaluate(e => getComputedStyle(e).lineHeight));
    expect((await span.boundingBox()).height).toBeLessThan(lh * 2.5);
    await expect(span).toHaveText(long);
  });
});

test.describe('Checkpoint 2: contrast in every appearance', () => {
  // explicit light, explicit dark, and following the device (light or dark)
  for (const [name, theme, scheme] of [
    ['light', 'light', 'light'],
    ['dark', 'dark', 'light'],
    ['automatic, device light', '', 'light'],
    ['automatic, device dark', '', 'dark'],
  ])
    test(`${name}: the header, section bars, chips, fields, the tab bar and a sheet read at AA`, async ({
      app,
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.clock.install({ time: new Date(2026, 10, 4, 11, 0) });
      await app.open();
      await page.evaluate(
        t => localStorage.setItem('dashboard-look', JSON.stringify(t ? { theme: t } : {})),
        theme,
      );
      await app.setState(eDay);
      await page.reload();
      const audit = () =>
        page.evaluate(() => {
          const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
          const lum = c =>
            c
              .slice(0, 3)
              .map(v => v / 255)
              .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
              .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
          const ratio = (a, b) => {
            const [x, y] = [lum(rgb(a)), lum(rgb(b))];
            return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
          };
          const bg = e => {
            for (; e; e = e.parentElement) {
              const cs = getComputedStyle(e);
              // (a gradient behind text can't be checked as one colour: that's a failure here)
              if (cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('url(')) return 'gradient';
              const c = rgb(cs.backgroundColor);
              if (c.length === 3 || c[3] > 0.5) return cs.backgroundColor;
            }
            return 'rgb(255, 255, 255)';
          };
          const out = [];
          const check = (sel, min = 4.5, pseudo) =>
            document.querySelectorAll(sel).forEach(e => {
              if (!e.getClientRects().length) return;
              const b = bg(e),
                c = getComputedStyle(e, pseudo).color,
                r = b === 'gradient' ? 0 : ratio(c, b);
              if (r < min)
                out.push(`${sel}${pseudo || ''} ${r.toFixed(2)} "${e.textContent.trim().slice(0, 20)}"`);
            });
          check('header .go small, header .go b, header .clk, header .btn, header::before');
          check('#v-today .sechead h2, #v-today .sechead .linkbtn');
          check('#v-today .tag');
          check('#v-today .btn');
          check('nav button');
          return out;
        });
      expect(await audit()).toEqual([]);
      // The header's own label bar (a pseudo-element: checked against the header's colour).
      const hdr = await page.evaluate(() => {
        const h = getComputedStyle(document.querySelector('header'));
        return [
          h.backgroundImage,
          getComputedStyle(document.querySelector('header'), '::before').color,
          h.backgroundColor,
        ];
      });
      expect(hdr[0]).toBe('none');
      expect(
        await page.evaluate(([c, b]) => {
          const rgb = s => (s.match(/[\d.]+/g) || []).map(Number).slice(0, 3);
          const lum = c =>
            c
              .map(v => v / 255)
              .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
              .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
          const [x, y] = [lum(rgb(c)), lum(rgb(b))];
          return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
        }, hdr.slice(1)),
      ).toBeGreaterThan(4.5);
      // A field's typed text and its placeholder; a sheet's text and buttons.
      await app.go('inbox');
      const fld = await page.evaluate(() => {
        const i = document.querySelector('#iin'),
          cs = getComputedStyle(i);
        return [cs.color, getComputedStyle(i, '::placeholder').color, cs.backgroundColor];
      });
      const r2 = (a, b) =>
        page.evaluate(
          ([a, b]) => {
            const rgb = s => (s.match(/[\d.]+/g) || []).map(Number).slice(0, 3);
            const lum = c =>
              c
                .map(v => v / 255)
                .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
                .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
            const [x, y] = [lum(rgb(a)), lum(rgb(b))];
            return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
          },
          [a, b],
        );
      expect(await r2(fld[0], fld[2])).toBeGreaterThan(4.5);
      expect(await r2(fld[1], fld[2])).toBeGreaterThan(4.5);
      // The focus ring against the page: 3:1.
      await page.focus('#iin');
      const ring = await page.evaluate(() => [
        getComputedStyle(document.activeElement).outlineColor,
        getComputedStyle(document.body).backgroundColor,
      ]);
      expect(await r2(...ring)).toBeGreaterThan(3);
      await app.go('today');
      await page.click('[data-top3pick]');
      const sheet = await page.evaluate(() =>
        [
          ...document.querySelectorAll('#sheet .sheetbox h2, #sheet .sheetbox .btn, #sheet .sheetbox .qact'),
        ].map(e => {
          let b = e;
          while (b && getComputedStyle(b).backgroundColor === 'rgba(0, 0, 0, 0)') b = b.parentElement;
          return [getComputedStyle(e).color, getComputedStyle(b).backgroundColor];
        }),
      );
      for (const [c, b] of sheet) expect(await r2(c, b)).toBeGreaterThan(4.5);
    });
});
