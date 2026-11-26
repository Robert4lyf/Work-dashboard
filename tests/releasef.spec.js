// Release F: mobile clarity, visual refinement and reliability.
const { test, expect } = require('./fixtures');
const { eDay } = require('./releaseedata');

async function day(app, page, at = new Date(2026, 10, 4, 11, 0)) {
  await page.clock.install({ time: at });
  await app.open();
  await app.setState(eDay);
  await page.reload();
}
const sideways = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

test.describe('Checkpoint 1: a busy day on a phone', () => {
  // (Today's own order, attention, Top 3, Scheduled, Waiting, then the list, went with that page:
  // the day is the Projects board now, with the Waiting page and the Command Centre beside it)
  for (const [w, h] of [
    [320, 800],
    [360, 800],
    [390, 844],
    [412, 915],
  ])
    test(`${w}px: the board, Waiting and the Command Centre; nothing sideways`, async ({ app, page }) => {
      await page.setViewportSize({ width: w, height: h });
      await day(app, page);
      await expect(page.locator('#v-projects .project-card[data-qid="m2"] .project-meta')).toContainText(
        'Scheduled 14:00',
      );
      expect(await sideways(page)).toBe(false);
      await app.go('waiting');
      await expect(page.locator('#v-waiting .row[data-wid="b1a"]')).toHaveCount(1);
      expect(await sideways(page)).toBe(false);
      await app.go('ops');
      await expect(page.locator('#v-ops .attlist .attrow').first()).toBeVisible();
      expect(await sideways(page)).toBe(false);
    });

  test("a follow-up from a card's waiting link still works; the board keeps its projects", async ({
    app,
    page,
  }) => {
    await day(app, page);
    const names = await app.order();
    await page.click('#v-projects .project-card[data-qid="b1"] .project-wait[data-wact="b1a"]');
    await page.click('#sheet [data-chase="b1a"]');
    await expect(page.locator('#sheet #fuform')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet')).toHaveCount(0);
    expect(names).toContain('Finance system access');
    expect(await app.order()).toEqual(names);
  });

  test('a long name takes two lines in a list, and all of it on its page', async ({ app, page }) => {
    await app.open();
    const long =
      'Write up the quarterly supplier review notes and send them to everyone who was at the meeting';
    await app.addQuest(long);
    // The project: all of its name on its card and on its page.
    await expect(page.locator('#v-projects .project-card .project-open > span')).toHaveText(long);
    await app.openQuest(long);
    const h1 = page.locator('#v-today .node.facts > h1');
    await expect(h1).toHaveText(long);
    expect(await h1.evaluate(e => e.scrollHeight <= e.clientHeight && e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    // A step of that name: two lines in the list of steps, all of it on its own page.
    await app.addSub(long);
    const span = page.locator('#v-today .list .row .open > span').first();
    const lh = parseFloat(await span.evaluate(e => getComputedStyle(e).lineHeight));
    expect((await span.boundingBox()).height).toBeLessThan(lh * 2.5);
    await expect(span).toHaveText(long);
    await page.click('#v-today .list .row .open');
    await expect(h1).toHaveText(long);
    expect((await h1.boundingBox()).height).toBeGreaterThan(
      parseFloat(await h1.evaluate(e => getComputedStyle(e).lineHeight)) * 2.5,
    );
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
          check('header .hsearch, header .syncbtn, header .timer-link, header .btn');
          // (the board: its section bars and their links, the cards' labels and buttons)
          check('#v-projects h2, #v-projects h3, #v-projects summary, #v-projects .linkbtn');
          check('#v-projects .tag');
          check('#v-projects .btn');
          // (a project's page: the Steps bar and its Reorder, its labels and buttons)
          check('#v-today .sechead h2, #v-today .sechead .linkbtn');
          check('#v-today .tag');
          check('#v-today .btn');
          check('nav button');
          return out;
        });
      await expect(page.locator('#v-projects .tag.late').first()).toBeVisible();
      expect(await audit()).toEqual([]);
      await app.openQuest('Fletcher Way');
      await expect(page.locator('#v-today .sechead #reorder')).toBeVisible();
      await expect(page.locator('#v-today .tag.late').first()).toBeVisible();
      expect(await audit()).toEqual([]);
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
      await app.openQuest('Fletcher Way');
      await page.click('#v-today .qfoot .qmore');
      await expect(page.locator('#sheet .sheetbox .qact').first()).toBeVisible();
      // (as it rests: the sheet comes up under the pointer, and the action there, Delete, would be
      // measured against its hover tint, a translucent colour this reads as a solid one)
      await page.mouse.move(0, 0);
      await expect(page.locator('#sheet .qact.del')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
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

/* Checkpoint 3: Reorder. (Top 3, and Today's list that left scheduled and waiting tasks out, are
   gone: Reorder is for a project's steps now.) One project with five steps a–e, Delta waiting on
   Sam. Changes made "elsewhere" are made on the state and redrawn. */
const five = s => {
  const k = (id, text, x = {}) => ({ id, text, done: false, children: [], ...x });
  s.quests = [
    k('p', 'Project', {
      children: [
        k('a', 'Alpha'),
        k('b', 'Bravo'),
        k('c', 'Charlie'),
        k('d', 'Delta', { wait: { who: 'Sam', note: '', since: today() } }),
        k('e', 'Echo'),
      ],
    }),
  ];
};
async function plain(app, page, fn = five) {
  await page.clock.install({ time: new Date(2026, 10, 4, 9, 0) });
  await app.open();
  await app.setState(fn);
  await page.reload();
}
const elsewhere = (page, fn) =>
  page.evaluate(src => {
    new Function(src)();
    save();
    inBackground(() => renderAll());
  }, `(${fn})()`);

test.describe("Checkpoint 3: Reorder on a project's steps", () => {
  const order = page => page.evaluate(() => S.quests[0].children.map(n => n.id).join(''));
  const listed = page => page.$$eval('#v-today .list .row', x => x.map(e => e.dataset.qid).join(''));

  test('rapid moves, a tick, and a reply coming in mid-reorder', async ({ app, page }) => {
    await plain(app, page);
    await app.openQuest('Project');
    await page.click('#reorder');
    expect(await listed(page)).toBe('abcde');
    // Rapid: five downs on Alpha in one go, each on the button as redrawn by the one before
    // (the last is disabled by then); it lands last, nothing lost or doubled.
    // (Clicked in the page, not through the pointer: the row can sit under the fixed tab bar.)
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) document.querySelector('#v-today [data-down="a"]').click();
    });
    expect(await listed(page)).toBe('bcdea');
    expect(await order(page)).toBe('bcdea');
    await expect(page.locator('#v-today [data-down="a"]')).toBeDisabled();
    // A tick while reordering: Charlie done, still listed.
    await page.click('#v-today .list [data-toggle="c"]');
    expect(await listed(page)).toContain('c');
    await expect(page.locator('#v-today .list .row.done[data-qid="c"]')).toHaveCount(1);
    // Delta's reply comes: it stays in the list at its place, waiting no more.
    await expect(page.locator('#v-today .list .row.waiting[data-qid="d"]')).toHaveCount(1);
    await elsewhere(page, () => delete S.quests[0].children.find(n => n.id === 'd').wait);
    await expect(page.locator('#v-today .list .row.waiting')).toHaveCount(0);
    const o = await order(page);
    expect(await listed(page)).toBe(o);
    expect(o.split('').sort().join('')).toBe('abcde');
    await expect(page.locator('#reorder')).toHaveText('Done');
    await page.reload();
    expect(await order(page)).toBe(o);
  });
});

test.describe('Android scenarios (390 × 844)', () => {
  test('B: a meeting rescheduled stays scheduled, never Focus work; to tomorrow it goes to Upcoming', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const card = page.locator('#v-projects .project-card[data-qid="m2"]');
    await expect(card.locator('.project-meta .tag.sched')).toHaveText('Scheduled 14:00');
    await app.openQuest('Supplier review call');
    await page.click('#v-today .qfoot .qmore');
    await page.click('#sheet [data-schedset="m2"]');
    await page.fill('#schedtime', '16:30');
    await page.click('#sheetok');
    await expect(page.locator('#v-today .schedpick')).toHaveText('Scheduled 16:30');
    let s = await app.state();
    const m2 = s.quests.find(q => q.id === 'm2');
    expect(m2.done).toBe(false);
    expect(m2.scheduled).toEqual({ date: '2026-11-04', time: '16:30' });
    // Not Focus work (on its page or in its actions), not the header's next task.
    expect(await page.evaluate(() => canAct(S.quests.find(q => q.id === 'm2')))).toBe(false);
    expect(await page.evaluate(() => (recommend() || {}).q && recommend().q.id)).not.toBe('m2');
    await expect(page.locator('#v-today .qfoot [data-zen]')).toHaveCount(0);
    await page.click('#v-today .qfoot .qmore');
    await expect(page.locator('#sheet [data-schedset="m2"]')).toHaveCount(1);
    await expect(page.locator('#sheet [data-zen]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.click('#v-today [data-crumb="-1"]');
    await expect(card.locator('.project-meta .tag.sched')).toHaveText('Scheduled 16:30');
    await expect(card.locator('[data-open="m2"]')).toHaveCount(1);
    // To tomorrow: off today's projects, on Upcoming with its schedule; it survives a reload and a
    // sync copy.
    await page.evaluate(() => setSchedule('m2', shift(today(), 1), '09:00'));
    await expect(page.locator('#v-projects [data-open="m2"]')).toHaveCount(0);
    await expect(card.locator('[data-upcoming-project="m2"]')).toHaveCount(1);
    await expect(card.locator('.project-meta .tag.sched')).toHaveText('Scheduled 5 Nov 09:00');
    await page.reload();
    await expect(card.locator('[data-upcoming-project="m2"]')).toHaveCount(1);
    s = await app.state();
    const up = s.later.find(q => q.id === 'm2');
    expect(up.scheduled).toEqual({ date: '2026-11-05', time: '09:00' });
    expect(up.start).toBe('2026-11-05');
    expect(
      await page.evaluate(() => fromRecords(toRecords(S)).later.find(q => q.id === 'm2').scheduled),
    ).toEqual({
      date: '2026-11-05',
      time: '09:00',
    });
  });

  test('C: a follow-up is recorded, then the reply: it leaves Waiting and its task can be worked on', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const card = page.locator('#v-projects .project-card[data-qid="b1"]'),
      actable = () => page.evaluate(() => canAct(S.quests.find(q => q.id === 'b1')));
    await app.go('waiting');
    const row = page.locator('#v-waiting .row[data-wid="b1a"]');
    await row.locator('[data-wact]').click();
    await page.click('#sheet [data-chase="b1a"]');
    await page.fill('#funote', 'Rang the IT desk');
    await page.click('#sheetok');
    // Still waiting (now chased again in two days), history kept.
    await expect(row).toHaveCount(1);
    let s = await app.state();
    expect(s.follows.filter(f => f.n === 'b1a').map(f => f.k)).toContain('chase');
    // Its task is nothing to work on yet: waiting on its card, no Focus on its page.
    expect(await actable()).toBe(false);
    await app.go('projects');
    await expect(card.locator('.project-wait[data-wact="b1a"]')).toHaveText('Waiting on IT · Chase 6 Nov');
    await expect(card.locator('.project-step[data-qid="b1a"] .check')).toHaveCount(0);
    await app.openQuest('Finance system access');
    await expect(page.locator('#v-today .qfoot [data-zen]')).toHaveCount(0);
    await app.go('waiting');
    await row.locator('[data-waitclear]').click();
    await expect(row).toHaveCount(0);
    s = await app.state();
    expect(s.follows.filter(f => f.n === 'b1a').map(f => f.k)).toEqual(
      expect.arrayContaining(['chase', 'resolve']),
    );
    // Its task can be worked on now: its step has its tick on the card, and Focus on its page.
    expect(await actable()).toBe(true);
    await app.go('projects');
    await expect(card.locator('.project-wait')).toHaveCount(0);
    await expect(card.locator('.project-meta')).not.toContainText('Waiting');
    await expect(card.locator('.project-step[data-qid="b1a"] .check')).toHaveCount(1);
    await app.openQuest('Finance system access');
    await expect(page.locator('#v-today .qfoot [data-zen][data-q="b1a"]')).toHaveCount(1);
  });
});

test.describe('Checkpoint 3: QA fixes', () => {
  test('Reorder is offered only with two steps to reorder', async ({ app, page }) => {
    await plain(app, page, s => {
      const k = (id, text, x = {}) => ({ id, text, done: false, children: [], ...x });
      s.quests = [
        k('p', 'One step', { children: [k('a', 'Alpha')] }),
        k('q', 'Two steps', { children: [k('b', 'Bravo'), k('c', 'Charlie')] }),
      ];
    });
    await app.openQuest('One step');
    await expect(page.locator('#v-today .list .row')).toHaveCount(1);
    await expect(page.locator('#reorder')).toHaveCount(0);
    await app.openQuest('Two steps');
    await expect(page.locator('#v-today .list .row')).toHaveCount(2);
    await expect(page.locator('#reorder')).toHaveCount(1);
  });
});

test.describe('Checkpoint 5: UI and accessibility QA fixes', () => {
  const ratio = (page, a, b) =>
    page.evaluate(
      ([a, b]) => {
        const rgb = s => (s.match(/[\d.]+/g) || []).map(Number).slice(0, 3);
        const lum = c =>
          c
            .map(v => v / 255)
            .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
            .reduce((x, v, i) => x + v * [0.2126, 0.7152, 0.0722][i], 0);
        const [x, y] = [lum(rgb(a)), lum(rgb(b))];
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      },
      [a, b],
    );
  for (const font of ['', 'large'])
    test(`320px${font ? ', Larger text' : ''}: names on cards, Waiting and Reorder rows keep their words`, async ({
      app,
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.clock.install({ time: new Date(2026, 10, 4, 11, 0) });
      await app.open();
      await page.evaluate(
        f => localStorage.setItem('dashboard-look', JSON.stringify(f ? { font: f } : {})),
        font,
      );
      await app.setState(eDay);
      await page.reload();
      const widths = sel => page.$$eval(sel, x => x.map(e => Math.round(e.getBoundingClientRect().width)));
      // A card's name (a scheduled or waiting project's too) breaks between words, never inside
      // one: each word is on one line.
      const broken = await page.$$eval('#v-projects .project-card .project-open > span', x =>
        x.flatMap(e => {
          const t = e.firstChild,
            out = [];
          for (const m of t.data.matchAll(/\S+/g)) {
            const r = document.createRange();
            r.setStart(t, m.index);
            r.setEnd(t, m.index + m[0].length);
            if (new Set([...r.getClientRects()].map(b => Math.round(b.top))).size > 1) out.push(m[0]);
          }
          return out;
        }),
      );
      expect(broken).toEqual([]);
      expect(await page.locator('#v-projects .project-card').count()).toBeGreaterThan(20);
      // A label is one line, never broken mid-word.
      const tagH = sel => page.$$eval(sel, x => x.map(e => e.getBoundingClientRect().height));
      for (const h of await tagH('#v-projects .project-meta .tag')) expect(h).toBeLessThan(26);
      await expect(page.locator('#searchBtn')).toBeInViewport();
      await expect(page.locator('#syncBtn')).toBeInViewport();
      // (about 70px before: the name squeezed beside the time, Done and ⋯)
      await app.go('waiting');
      const waiting = await widths('#v-waiting .row .open > span');
      expect(waiting.length).toBeGreaterThan(2);
      for (const w of waiting) expect(w).toBeGreaterThan(160);
      for (const h of await tagH('#v-waiting .row .tag')) expect(h).toBeLessThan(26);
      await app.openQuest('Client onboarding');
      await page.click('#reorder');
      const steps = await widths('#v-today .list .row .open > span');
      expect(steps.length).toBeGreaterThan(2);
      for (const w of steps) expect(w).toBeGreaterThan(160);
      for (const h of await tagH('#v-today .list .tag')) expect(h).toBeLessThan(26);
    });

  test('Command Centre shows its whole name, also with Larger text and nothing needing attention', async ({
    app,
    page,
  }) => {
    for (const [w, font, data] of [
      // (the empty ones first: nothing from the busy day is left to need attention)
      [320, '', false],
      [320, 'large', false],
      [390, 'large', true],
    ]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.clock.install({ time: new Date(2026, 10, 4, 11, 0) });
      await app.open();
      await page.evaluate(
        f => localStorage.setItem('dashboard-look', JSON.stringify(f ? { font: f } : {})),
        font,
      );
      if (data) await app.setState(eDay);
      else await app.setState(s => (s.quests = []));
      await page.reload();
      // (its name is the page's title now: Today's chip to it went with Today)
      await app.go('ops');
      const cc = page.locator('#page-title');
      await expect(cc).toHaveText('Command Centre');
      await expect(cc).toBeInViewport({ ratio: 1 });
      expect(await cc.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
      await expect(page.locator(data ? '#v-ops .attlist .attrow' : '#v-ops .opsquiet').first()).toBeVisible();
    }
  });

  test('dark, and automatic dark: the focus ring and the sync dot show on the toolbar', async ({
    app,
    page,
  }) => {
    for (const [theme, scheme] of [
      ['dark', 'light'],
      ['', 'dark'],
    ]) {
      await page.emulateMedia({ colorScheme: scheme });
      await app.open();
      await page.evaluate(
        t => localStorage.setItem('dashboard-look', JSON.stringify(t ? { theme: t } : {})),
        theme,
      );
      await page.reload();
      await page.focus('#searchBtn');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const [ring, dot, bg] = await page.evaluate(() => [
        getComputedStyle(document.activeElement).outlineColor,
        getComputedStyle(document.querySelector('#syncBtn'), '::before').backgroundColor,
        getComputedStyle(document.querySelector('header')).backgroundColor,
      ]);
      expect(await ratio(page, ring, bg)).toBeGreaterThan(3);
      expect(await ratio(page, dot, bg)).toBeGreaterThan(3);
    }
  });

  test('the attention panel is outlined like the other panels; Due today is not the current-work yellow', async ({
    app,
    page,
  }) => {
    await day(app, page);
    // (the attention panel is the Command Centre's now)
    await app.go('ops');
    const edge = sel =>
      page.$eval(sel, e => {
        const cs = getComputedStyle(e);
        return [cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor, cs.borderLeftWidth];
      });
    const att = await edge('#v-ops .attlist');
    expect(parseFloat(att[0])).toBeGreaterThan(0);
    expect(att[1]).toBe('solid');
    expect(att).toEqual(await edge('#v-ops .opsec .list.box'));
    await app.go('projects');
    const due = await page.$eval('#v-projects .project-meta .tag.now', e => [
      e.textContent,
      getComputedStyle(e).backgroundColor,
    ]);
    expect(due[0]).toBe('Due today');
    const header = await page.$eval('header', e => getComputedStyle(e).backgroundColor);
    const yellow = await page.evaluate(() => {
      const i = document.createElement('i');
      i.style.background = 'var(--signal)';
      document.body.append(i);
      const c = getComputedStyle(i).backgroundColor;
      i.remove();
      return c;
    });
    expect(yellow).toBe('rgb(255, 214, 10)');
    expect(due[1]).not.toBe(header);
    expect(due[1]).not.toBe(yellow);
  });

  test("Reorder's buttons say which step they move; the keyboard stays on the row after Top", async ({
    app,
    page,
  }) => {
    await plain(app, page);
    await app.openQuest('Project');
    await page.click('#reorder');
    await expect(page.locator('#v-today [data-top="c"]')).toHaveAttribute(
      'aria-label',
      'Move to top: Charlie',
    );
    await expect(page.locator('#v-today [data-up="c"]')).toHaveAttribute('aria-label', 'Move up: Charlie');
    await page.focus('#v-today [data-top="c"]');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => S.quests[0].children[0].id)).toBe('c');
    expect(
      await page.evaluate(() => {
        const a = document.activeElement;
        return a !== document.body && a.closest('[data-qid]') && a.closest('[data-qid]').dataset.qid;
      }),
    ).toBe('c');
  });
});
