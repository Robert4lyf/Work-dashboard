// Release F: mobile clarity, visual refinement and reliability.
const { test, expect } = require('./fixtures');
const { eDay } = require('./releaseedata');

async function day(app, page, at = new Date(2026, 10, 4, 11, 0)) {
  await page.clock.install({ time: at });
  await app.open();
  await app.setState(eDay);
  // (Release H folds the rest of Scheduled and Waiting on a phone; these tests are about their
  // rows, so the folds are as a user who has opened them left them: open)
  await page.evaluate(() => ['sched', 'wait'].forEach(k => localStorage.setItem(`dashboard-${k}-open`, '1')));
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

/* Checkpoint 3: Top 3 and Reorder. Five plain tasks a–e (and, for Reorder, a scheduled one and a
   waiting one in between). Changes made "elsewhere" are made on the state and redrawn. */
const five = s => {
  const k = (id, text, x = {}) => ({ id, text, done: false, children: [], ...x });
  s.quests = [k('a', 'Alpha'), k('b', 'Bravo'), k('c', 'Charlie'), k('d', 'Delta'), k('e', 'Echo')];
  s.top3 = { day: today(), ids: ['a', 'b', 'c'] };
};
async function plain(app, page, fn = five) {
  await page.clock.install({ time: new Date(2026, 10, 4, 9, 0) });
  await app.open();
  await app.setState(fn);
  await page.reload();
}
const t3names = page => page.$$eval('#v-today .top3 .t3row .open > span', x => x.map(e => e.textContent));
const elsewhere = (page, fn) =>
  page.evaluate(src => {
    new Function(src)();
    save();
    inBackground(() => renderAll());
  }, `(${fn})()`);
const t3 = page => page.evaluate(() => JSON.parse(JSON.stringify(S.top3)));

test.describe('Checkpoint 3: Top 3 with set-aside choices', () => {
  test('one becoming scheduled is set aside, frees its place, and another can be chosen', async ({
    app,
    page,
  }) => {
    await plain(app, page);
    expect(await t3names(page)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    await elsewhere(page, () => (S.quests[1].scheduled = { date: today(), time: '15:00' }));
    expect(await t3names(page)).toEqual(['Alpha', 'Charlie']);
    await expect(page.locator('#v-today .t3out')).toContainText('Set aside (scheduled): Bravo');
    await page.click('[data-top3pick]');
    // Delta can be chosen: Bravo doesn't hold one of the three.
    await expect(page.locator('#sheet [data-t3tog="d"]')).toBeEnabled();
    await expect(page.locator('#sheet .t3kept')).toContainText('Bravo');
    await page.click('#sheet [data-t3tog="d"]');
    await page.keyboard.press('Escape');
    expect(await t3names(page)).toEqual(['Alpha', 'Charlie', 'Delta']);
    expect(await t3(page)).toEqual({ day: '2026-11-04', ids: ['a', 'c', 'd'], held: ['b'] });
  });

  test('one becoming waiting: the same; back again with a free place, it takes it by itself', async ({
    app,
    page,
  }) => {
    await plain(app, page);
    await elsewhere(page, () => (S.quests[2].wait = { who: 'Sam', note: '', since: today() }));
    expect(await t3names(page)).toEqual(['Alpha', 'Bravo']);
    await expect(page.locator('#v-today .t3out')).toContainText('Set aside (waiting): Charlie');
    // The reply comes: nothing took its place, so it's back where it was.
    await elsewhere(page, () => delete S.quests[2].wait);
    expect(await t3names(page)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    await expect(page.locator('#v-today .t3out, #v-today .t3back')).toHaveCount(0);
  });

  test('back again with the three places full: nothing is pushed out; bringing it back is a choice', async ({
    app,
    page,
  }) => {
    await plain(app, page);
    await elsewhere(page, () => (S.quests[1].scheduled = { date: today() }));
    await page.click('[data-top3pick]');
    await page.click('#sheet [data-t3tog="d"]');
    await page.keyboard.press('Escape');
    await elsewhere(page, () => delete S.quests[1].scheduled);
    // Alpha, Charlie, Delta stay; Bravo is offered back.
    expect(await t3names(page)).toEqual(['Alpha', 'Charlie', 'Delta']);
    await expect(page.locator('#v-today .t3back')).toContainText('Bravo can be worked on again');
    await page.click('#v-today [data-t3back="b"]');
    await expect(page.locator('#sheet .qahint')).toHaveText(
      'Top 3 is full. Take one out to bring back Bravo.',
    );
    await page.click('#sheet [data-t3tog="c"]');
    await page.keyboard.press('Escape');
    expect(await t3names(page)).toEqual(['Alpha', 'Delta', 'Bravo']);
    // (it took the free place, and keeps it: written down as one of the three)
    expect(await t3(page)).toEqual({ day: '2026-11-04', ids: ['a', 'd', 'b'] });
    // Taken out, it's gone for good.
    await page.click('[data-top3pick]');
    await page.click('#sheet [data-t3tog="b"]');
    await page.keyboard.press('Escape');
    expect(await t3names(page)).toEqual(['Alpha', 'Delta']);
    expect(await t3(page)).toEqual({ day: '2026-11-04', ids: ['a', 'd'] });
  });

  test('a set-aside one can be taken out; a finished one keeps its place; a deleted one goes', async ({
    app,
    page,
  }) => {
    await plain(app, page);
    await elsewhere(page, () => (S.quests[1].scheduled = { date: today() }));
    await page.click('[data-top3pick]');
    await page.click('#sheet [data-t3drop="b"]');
    await expect(page.locator('#sheet .t3kept')).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(await t3(page)).toEqual({ day: '2026-11-04', ids: ['a', 'c'] });
    // Alpha done: still one of the three, marked Done.
    await page.click('#v-today .list [data-toggle="a"]');
    expect(await t3names(page)).toEqual(['Alpha', 'Charlie']);
    await expect(page.locator('#v-today .t3row.done')).toHaveCount(1);
    // Charlie deleted elsewhere: its place is free.
    await elsewhere(page, () => (S.quests = S.quests.filter(q => q.id !== 'c')));
    expect(await t3names(page)).toEqual(['Alpha']);
    await page.click('[data-top3pick]');
    await expect(page.locator('#sheet [data-t3tog="d"]')).toBeEnabled();
  });

  test('a new day starts with none, held or not; the record syncs whole and is cleaned on load', async ({
    app,
    page,
  }) => {
    await plain(app, page, {
      toString: () =>
        `function (s) { (${five})(s); s.quests[1].scheduled = { date: today() }; s.top3 = { day: today(), ids: ['a', 'c', 'd'], held: ['b'] }; }`,
    });
    // Synced as two records: the three, and the set-aside ones (which a copy of the app from
    // before Release F doesn't know, so leaves alone).
    expect(
      await page.evaluate(() => {
        const m = toRecords(S);
        return [m.get('meta:top3'), m.get('meta:top3held'), fromRecords(m).top3];
      }),
    ).toEqual([
      { day: '2026-11-04', ids: ['a', 'c', 'd'] },
      { day: '2026-11-04', held: ['b'] },
      { day: '2026-11-04', ids: ['a', 'c', 'd'], held: ['b'] },
    ]);
    // An older copy rewrites meta:top3 (its own choice, without held): the held ones survive; a
    // held record from another day is ignored.
    expect(
      await page.evaluate(() => {
        const m = toRecords(S);
        m.set('meta:top3', { day: today(), ids: ['a', 'e'] });
        const one = fromRecords(m).top3;
        m.set('meta:top3held', { day: '2026-11-03', held: ['b'] });
        return [one, fromRecords(m).top3];
      }),
    ).toEqual([
      { day: '2026-11-04', ids: ['a', 'e'], held: ['b'] },
      { day: '2026-11-04', ids: ['a', 'e'] },
    ]);
    // Junk or merged records: no duplicates, at most three, none held twice.
    expect(
      await page.evaluate(() => [
        cleanTop3({ day: today(), ids: ['a', 'a', 'b', 'c', 'd'], held: ['b', 'e', 'e', 7] }),
        cleanTop3({ day: today(), ids: [], held: ['b'] }),
        cleanTop3({ day: 'x', ids: ['a'] }),
      ]),
    ).toEqual([
      { day: '2026-11-04', ids: ['a', 'b', 'c'], held: ['e'] },
      { day: '2026-11-04', ids: [], held: ['b'] },
      null,
    ]);
    // The next morning: nothing chosen.
    await page.clock.setFixedTime(new Date(2026, 10, 5, 8, 0));
    await page.reload();
    expect(await t3(page)).toBeNull();
    await expect(page.locator('#v-today .top3empty')).toHaveCount(1);
  });

  test('one that took a free place keeps it when the choice it stood in for comes back', async ({
    app,
    page,
  }) => {
    // Bravo chosen, Delta set aside earlier; both waiting.
    await plain(app, page, {
      toString: () =>
        `function (s) { (${five})(s); s.top3 = { day: today(), ids: ['a', 'b', 'c'], held: ['d'] }; }`,
    });
    await elsewhere(page, () => {
      S.quests[1].wait = { who: 'Sam', note: '', since: today() };
      S.quests[3].wait = { who: 'Kim', note: '', since: today() };
    });
    expect(await t3names(page)).toEqual(['Alpha', 'Charlie']);
    // Delta's reply: it takes the free place, and that's written down.
    await elsewhere(page, () => delete S.quests[3].wait);
    expect(await t3names(page)).toEqual(['Alpha', 'Charlie', 'Delta']);
    expect(await t3(page)).toEqual({ day: '2026-11-04', ids: ['a', 'c', 'd'], held: ['b'] });
    // Bravo's reply: Delta stays; Bravo is offered back.
    await elsewhere(page, () => delete S.quests[1].wait);
    expect(await t3names(page)).toEqual(['Alpha', 'Charlie', 'Delta']);
    await expect(page.locator('#v-today .t3back')).toContainText('Bravo can be worked on again');
    // (the same after a sync brings the change in rather than an edit here)
    await page.reload();
    expect(await t3names(page)).toEqual(['Alpha', 'Charlie', 'Delta']);
  });

  test('two devices: the newer choice wins whole, held included', async ({ app, page }) => {
    await plain(app, page);
    // Device B chose later: it set Bravo aside and chose Echo. Its record replaces this one.
    const merged = await page.evaluate(() => {
      const mine = toRecords(S),
        theirs = new Map(mine);
      theirs.set('meta:top3', { day: today(), ids: ['a', 'c', 'e'] });
      theirs.set('meta:top3held', { day: today(), held: ['b'] });
      return fromRecords(theirs).top3;
    });
    expect(merged).toEqual({ day: '2026-11-04', ids: ['a', 'c', 'e'], held: ['b'] });
  });
});

test.describe('Checkpoint 3: Reorder with scheduled and waiting tasks hidden', () => {
  // a (to do), b (scheduled), c (to do), d (waiting), e (to do)
  const mixed = s => {
    const k = (id, text, x = {}) => ({ id, text, done: false, children: [], ...x });
    s.quests = [
      k('a', 'Alpha'),
      k('b', 'Bravo', { scheduled: { date: today(), time: '15:00' } }),
      k('c', 'Charlie'),
      k('d', 'Delta', { wait: { who: 'Sam', note: '', since: today() } }),
      k('e', 'Echo'),
    ];
  };
  const order = page => page.evaluate(() => S.quests.map(q => q.id).join(''));
  const listed = page => page.$$eval('#v-today .list .row', x => x.map(e => e.dataset.qid).join(''));
  test('only the tasks to work on are listed; moves keep the hidden ones where they were', async ({
    app,
    page,
  }) => {
    await plain(app, page, mixed);
    await page.click('#reorder');
    expect(await listed(page)).toBe('ace');
    // Bravo and Delta are still in their own sections, once each.
    await expect(page.locator('#v-today .schedrow[data-qid="b"]')).toHaveCount(1);
    await expect(page.locator('#v-today .list [data-qid="b"], #v-today .list [data-qid="d"]')).toHaveCount(0);
    await page.click('#v-today [data-up="c"]');
    expect(await order(page)).toBe('cabde');
    expect(await listed(page)).toBe('cae');
    // (down: to just after the next one listed; Bravo, hidden, keeps its place after Alpha)
    await page.click('#v-today [data-down="c"]');
    expect(await order(page)).toBe('acbde');
    await page.click('#v-today [data-down="a"]');
    expect(await order(page)).toBe('cabde');
    await page.click('#v-today [data-top="e"]');
    expect(await order(page)).toBe('ecabd');
    expect(await listed(page)).toBe('eca');
    await page.reload();
    expect(await order(page)).toBe('ecabd');
  });

  test('rapid moves, a tick, and tasks coming back into the list mid-reorder', async ({ app, page }) => {
    await plain(app, page, mixed);
    await page.click('#reorder');
    // Rapid: three downs on Alpha in one go, each on the button as redrawn by the one before
    // (the last is disabled by then); it lands last among the listed, nothing lost or doubled.
    // (Clicked in the page, not through the pointer: the row can sit under the fixed tab bar.)
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) document.querySelector('#v-today [data-down="a"]').click();
    });
    expect(await listed(page)).toBe('cea');
    expect((await order(page)).split('').sort().join('')).toBe('abcde');
    // A tick while reordering: Charlie done, still in place, still movable below the open ones.
    await page.click('#v-today .list [data-toggle="c"]');
    expect(await listed(page)).toContain('c');
    // Delta's reply comes, Bravo is unscheduled: both come back into the list at their places.
    await elsewhere(page, () => {
      // (a task's own wait is kept as its "Hear back" step: the reply clears that)
      delete S.quests.find(q => q.id === 'd').children[0].wait;
      delete S.quests.find(q => q.id === 'b').scheduled;
    });
    const o = await order(page);
    expect(await listed(page)).toBe(o);
    expect(o.length).toBe(5);
  });

  test('from the board back to the list, Reorder lists the same tasks', async ({ app, page }) => {
    await plain(app, page, mixed);
    await page.click('[data-tview="board"]');
    await expect(page.locator('#reorder')).toHaveCount(0);
    await page.click('[data-tview="list"]');
    await page.click('#reorder');
    expect(await listed(page)).toBe('ace');
  });
});

test.describe('Android scenarios (390 × 844)', () => {
  test('B: a meeting rescheduled stays scheduled, never Focus work; to tomorrow it goes to Upcoming', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.click('#v-today .schedrow[data-qid="m2"] .qmore');
    await page.click('#sheet [data-schedset="m2"]');
    await page.fill('#schedtime', '16:30');
    await page.click('#sheetok');
    await expect(page.locator('#v-today .schedrow[data-qid="m2"] .stime')).toHaveText('16:30');
    let s = await app.state();
    const m2 = s.quests.find(q => q.id === 'm2');
    expect(m2.done).toBe(false);
    expect(m2.scheduled).toEqual({ date: '2026-11-04', time: '16:30' });
    // Not Focus work, not offered for Top 3, not the header's next task.
    expect(await page.evaluate(() => canAct(S.quests.find(q => q.id === 'm2')))).toBe(false);
    expect(await page.evaluate(() => (recommend() || {}).q && recommend().q.id)).not.toBe('m2');
    await page.click('[data-top3pick]');
    await expect(page.locator('#sheet [data-t3tog="m2"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // To tomorrow: off Today, on Upcoming with its schedule; it survives a reload and a sync copy.
    await page.evaluate(() => setSchedule('m2', shift(today(), 1), '09:00'));
    await expect(page.locator('#v-today .schedrow[data-qid="m2"]')).toHaveCount(0);
    await page.reload();
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

  test('C: a follow-up is recorded, then the reply: it leaves Waiting and its task can be chosen', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const row = page.locator('#v-today .waitsec2 .wrow[data-wid="b1a"]');
    await row.locator('[data-chase]').click();
    await page.fill('#funote', 'Rang the IT desk');
    await page.click('#sheetok');
    // Still waiting (now chased again in two days), history kept.
    await expect(row).toHaveCount(1);
    let s = await app.state();
    expect(s.follows.filter(f => f.n === 'b1a').map(f => f.k)).toContain('chase');
    await page.click('[data-top3pick]');
    await expect(page.locator('#sheet [data-t3tog="b1"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await row.locator('[data-waitclear]').click();
    await expect(row).toHaveCount(0);
    s = await app.state();
    expect(s.follows.filter(f => f.n === 'b1a').map(f => f.k)).toEqual(
      expect.arrayContaining(['chase', 'resolve']),
    );
    // Its task is on the list now, and can be one of the Top 3.
    await expect(page.locator('#v-today .list .row[data-qid="b1"]')).toHaveCount(1);
    await page.click('[data-top3pick]');
    await expect(page.locator('#sheet [data-t3tog="b1"]')).toHaveCount(1);
  });
});

test.describe('Checkpoint 3: QA fixes', () => {
  test('a returning choice never pushes out the one that took its place (scheduled, then done)', async ({
    app,
    page,
  }) => {
    await plain(app, page);
    await elsewhere(page, () => (S.quests[1].scheduled = { date: today() }));
    await page.click('[data-top3pick]');
    await page.click('#sheet [data-t3tog="d"]');
    await page.keyboard.press('Escape');
    // Delta scheduled too; Bravo back: Bravo takes the free place, and keeps it.
    await elsewhere(page, () => (S.quests[3].scheduled = { date: today() }));
    await elsewhere(page, () => delete S.quests[1].scheduled);
    expect(await t3names(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);
    // Delta back: offered back, nothing pushed out.
    await elsewhere(page, () => delete S.quests[3].scheduled);
    expect(await t3names(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);
    await expect(page.locator('#v-today .t3back')).toContainText('Delta can be worked on again');
    // Or done instead: still nothing pushed out.
    await elsewhere(page, () => (S.quests[3].done = true));
    expect(await t3names(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });

  test('the open picker follows a sync, so a tap means what it shows; Take out takes out', async ({
    app,
    page,
  }) => {
    await plain(app, page);
    await page.click('[data-top3pick]');
    await expect(page.locator('#sheet [data-t3tog="d"]')).toHaveAttribute('aria-pressed', 'false');
    // Another device takes Charlie out and chooses Delta; the picker shows it at once.
    await elsewhere(page, () => (S.top3 = { day: today(), ids: ['a', 'b', 'd'] }));
    await expect(page.locator('#sheet [data-t3tog="d"]')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#sheet [data-t3tog="d"]');
    expect((await t3(page)).ids).toEqual(['a', 'b']);
    await page.keyboard.press('Escape');
    // A set-aside one that took a place meanwhile: Take out takes it out of the three too.
    await elsewhere(page, () => {
      S.top3 = { day: today(), ids: ['a', 'b', 'd'] };
      S.quests[1].scheduled = { date: today() };
    });
    await page.click('[data-top3pick]');
    await page.click('#sheet [data-t3tog="c"]');
    await expect(page.locator('#sheet .t3kept')).toContainText('Bravo');
    await elsewhere(page, () => delete S.quests[1].scheduled);
    await page.evaluate(() => top3Click({ t3drop: 'b' }));
    expect(await t3(page)).toEqual({ day: '2026-11-04', ids: ['a', 'd', 'c'] });
  });

  test('a scheduled task chosen for Top 3 can be taken out from its actions', async ({ app, page }) => {
    await plain(app, page);
    await elsewhere(page, () => (S.quests[1].scheduled = { date: today(), time: '15:00' }));
    await page.click('#v-today .schedrow[data-qid="b"] .qmore');
    await page.click('#sheet [data-top3="b"]');
    expect(await t3(page)).toEqual({ day: '2026-11-04', ids: ['a', 'c'] });
  });

  test('Reorder is offered only with two tasks in the list to reorder', async ({ app, page }) => {
    await plain(app, page, s => {
      const k = (id, text, x = {}) => ({ id, text, done: false, children: [], ...x });
      s.quests = [
        k('a', 'Alpha'),
        k('b', 'Bravo', { scheduled: { date: today() } }),
        k('d', 'Delta', { wait: { who: 'Sam', note: '', since: today() } }),
      ];
    });
    await expect(page.locator('#v-today .list .row')).toHaveCount(1);
    await expect(page.locator('#reorder')).toHaveCount(0);
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
    test(`320px${font ? ', Larger text' : ''}: names on Scheduled, Waiting and Reorder rows keep their words`, async ({
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
      // (about 70px before: the name squeezed beside the time, Done and ⋯)
      for (const w of await widths('#v-today .secrow .open > span')) expect(w).toBeGreaterThan(160);
      // The header's label on one line.
      const lab = await page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('header'), '::before');
        return parseFloat(cs.height) / parseFloat(cs.lineHeight || cs.fontSize * 1.2);
      });
      expect(lab).toBeLessThan(2);
      await page.click('#reorder');
      for (const w of await widths('#v-today .list .row .open > span')) expect(w).toBeGreaterThan(160);
      // A label is one line, never broken mid-word.
      for (const h of await page.$$eval('#v-today .list .tag', x =>
        x.map(e => e.getBoundingClientRect().height),
      ))
        expect(h).toBeLessThan(26);
    });

  test('Command Centre shows its whole name, also with Larger text and nothing needing attention', async ({
    app,
    page,
  }) => {
    for (const [w, font, data] of [
      [390, 'large', true],
      [320, '', false],
      [320, 'large', false],
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
      const cc = page.locator('#v-today .attcc');
      expect(await cc.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    }
  });

  test('dark, and automatic dark: the focus ring and the sync dot show on the yellow header', async ({
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
    expect(await page.$eval('#v-today .attsum > .attsumline', e => getComputedStyle(e).borderTopWidth)).toBe(
      '3px',
    );
    const due = await page.$eval('#v-today .tag.now', e => getComputedStyle(e).backgroundColor);
    const yellow = await page.$eval('header', e => getComputedStyle(e).backgroundColor);
    expect(due).not.toBe(yellow);
  });

  test("Reorder's buttons say which task they move; the keyboard stays on the row after Top", async ({
    app,
    page,
  }) => {
    await plain(app, page);
    await page.click('#reorder');
    await expect(page.locator('#v-today [data-top="c"]')).toHaveAttribute(
      'aria-label',
      'Move to top: Charlie',
    );
    await expect(page.locator('#v-today [data-up="c"]')).toHaveAttribute('aria-label', 'Move up: Charlie');
    await page.focus('#v-today [data-top="c"]');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => S.quests[0].id)).toBe('c');
    expect(
      await page.evaluate(() => {
        const a = document.activeElement;
        return a !== document.body && a.closest('[data-qid]') && a.closest('[data-qid]').dataset.qid;
      }),
    ).toBe('c');
  });
});
