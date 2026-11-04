// Release G: the excellence release. Checkpoint 1: Today on a busy day (Scenario A).
const { test, expect, unfold } = require('./fixtures');
const { gDay } = require('./releasegdata');

async function day(app, page, at = new Date(2026, 10, 4, 11, 0)) {
  await page.clock.install({ time: at });
  await app.open();
  await app.setState(gDay);
  await page.reload();
}
const names = page => page.$$eval('#v-today .list .row .open > span', x => x.map(e => e.textContent));
const ids = page => page.$$eval('#v-today .list .row', x => x.map(e => e.dataset.qid));

test.describe('Checkpoint 1: a busy day', () => {
  test('rows: the steps as a count and a thin line, no taller than the row; Top 3 marked in place', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const rows = page.locator('#v-today .list .row');
    expect(await rows.count()).toBe(25);
    // (87px a row on average before; the segmented bar under the name took its own line)
    const hs = await rows.evaluateAll(r => r.map(e => e.offsetHeight));
    expect(hs.reduce((a, h) => a + h, 0) / hs.length).toBeLessThan(80);
    const w = page.locator('#v-today .list .row:has-text("Walsingham sale")');
    await expect(w.locator('.sfrac')).toHaveText('1/3');
    // The bar is still there, with its meaning, along the row's foot.
    await expect(w.locator('.stepbar')).toHaveAttribute('aria-label', '1 of 3 steps done');
    expect(await w.locator('.stepbar').evaluate(e => getComputedStyle(e).position)).toBe('absolute');
    // Top 3: the same three, in order, marked with their number; the name is the name.
    const t3 = await page.evaluate(() => top3Ids());
    for (const [i, id] of t3.entries()) {
      const s = page.locator(`#v-today .list .row[data-qid="${id}"] .open > span`);
      await expect(s).toHaveAttribute('data-rank', String(i + 1));
      expect(await s.textContent()).toBe(await page.evaluate(id => S.quests.find(q => q.id === id).text, id));
    }
  });

  test('Due and Started narrow the list in its own order and change nothing; the choice is kept', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const all = await ids(page),
      before = await page.evaluate(() => JSON.stringify(S.quests));
    const due = await page.evaluate(() =>
      todayWork(S.quests)
        .filter(isDueNow)
        .map(q => q.id),
    );
    expect(due.length).toBeGreaterThan(2);
    await expect(page.locator('[data-tfilter="due"] small')).toHaveText(String(due.length));
    await page.click('[data-tfilter="due"]');
    const shown = await ids(page);
    expect(shown).toEqual(all.filter(id => due.includes(id)));
    await page.click('[data-tfilter="started"]');
    for (const id of await ids(page))
      expect(await page.evaluate(id => isStarted(S.quests.find(q => q.id === id)), id)).toBe(true);
    expect(await page.evaluate(() => JSON.stringify(S.quests))).toBe(before);
    // Kept on this device; Reorder always lists everything (and has no filter).
    await page.reload();
    await expect(page.locator('[data-tfilter="started"]')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#reorder');
    await expect(page.locator('#v-today .tfilter')).toHaveCount(0);
    expect(await ids(page)).toEqual(await page.evaluate(() => todayWork(S.quests).map(q => q.id)));
    await page.click('#reorder');
    // The board shows what the list shows.
    await page.click('[data-tview="board"]');
    const tiles = await page.$$eval('#v-today .qtile', x => x.map(e => e.dataset.qid));
    await page.click('[data-tview="list"]');
    expect([...tiles].sort()).toEqual([...(await ids(page))].sort());
    await page.click('[data-tfilter="all"]');
    expect(await ids(page)).toEqual(all);
  });

  test('Find: words in a name or a step; the box keeps its words and the keyboard through redraws', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.click('[data-tfindopen]');
    await expect(page.locator('#tfind')).toBeFocused();
    await page.keyboard.type('harpenden bound');
    expect(await names(page)).toEqual(['Reply to Harpenden about the boundary query']);
    await expect(page.locator('#tfind')).toBeFocused();
    expect(await page.$eval('#tfind', e => [e.value, e.selectionStart])).toEqual(['harpenden bound', 15]);
    // A step's words find its task.
    await page.fill('#tfind', 'gather figures');
    expect(await names(page)).toEqual(['Quarterly safeguarding return']);
    // A sync redraw while typing keeps the words, the match and the keyboard.
    await page.evaluate(() => inBackground(renderAll));
    await expect(page.locator('#tfind')).toHaveValue('gather figures');
    await expect(page.locator('#tfind')).toBeFocused();
    expect(await names(page)).toEqual(['Quarterly safeguarding return']);
    // Nothing matches: says so, and Show all clears it.
    await page.fill('#tfind', 'zzzz');
    await expect(page.locator('#v-today .nowork')).toContainText('No tasks match');
    await page.click('#v-today .nowork [data-tfindclear]');
    expect((await names(page)).length).toBe(25);
    // (the box stays open for other words) The button closes it, and clears it.
    await page.fill('#tfind', 'rota');
    await page.click('[data-tfindopen]');
    await expect(page.locator('#tfind')).toHaveCount(0);
    expect((await names(page)).length).toBe(25);
  });

  test('Needs attention: the count, the one that matters most, the rest a tap away; kept open or folded', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const n = await page.evaluate(() => attentionItems().length);
    await expect(page.locator('#attsum')).toContainText('Needs attention ' + n);
    await expect(page.locator('.attfirst .attrow')).toHaveCount(1);
    await expect(page.locator('.attfirst')).toContainText('Month-end report'); // (a failure first)
    await expect(page.locator('#attd > summary')).toHaveText(`${n - 1} more`);
    await expect(page.locator('#attd .attrow').first()).toBeHidden();
    await page.click('#attd > summary');
    await expect(page.locator('#attd .attrow')).toHaveCount(n - 1);
    // Remembered on this device.
    await page.reload();
    await expect(page.locator('#attd')).toHaveAttribute('open', '');
    await page.click('#attd > summary');
    await page.reload();
    await expect(page.locator('#attd')).not.toHaveAttribute('open', '');
    // The same items, in the same order, as the Command Centre.
    const today = await page.$$eval('#v-today .attn .attrow .open > span', x => x.map(e => e.textContent));
    await page.evaluate(() => go('ops'));
    const ops = await page.$$eval('#v-ops .opsec:first-of-type .attrow .open > span', x =>
      x.map(e => e.textContent),
    );
    expect(today).toEqual(ops);
    // No taller than before (231px with these two failures shown in full), and with more
    // failures it stays the same height: only the first is shown.
    await page.evaluate(() => go('today'));
    const h1 = await page.locator('#v-today .attn').evaluate(e => e.offsetHeight);
    expect(h1).toBeLessThan(225);
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) S.wruns.push({ ...S.wruns.find(r => r.status === 'failed'), id: 'rx' + i });
      renderAll();
    });
    expect(await page.locator('#v-today .attn').evaluate(e => e.offsetHeight)).toBe(h1);
  });

  test('resolving the first item brings up the next; with one left there is no "more"', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.evaluate(() => {
      S.wruns.forEach(r => (r.ack = 1));
      S.execs.forEach(x => (x.ack = 1));
      save();
      renderAll();
    });
    const first = await page.evaluate(() => [...attentionItems()].sort((a, b) => a.sev - b.sev)[0].text);
    await expect(page.locator('.attfirst .open > span')).toHaveText(first);
    await page.evaluate(() => {
      S.quests = S.quests.map(q => ({ ...q, due: '' }));
      S.quests.forEach(q => q.children.forEach(c => delete c.wait));
      save();
      renderAll();
    });
    const left = await page.evaluate(() => attentionItems().length);
    if (left <= 1) await expect(page.locator('#attd')).toHaveCount(0);
  });
});

test.describe('Checkpoint 3: touch and recovery', () => {
  test('every control on the main screens is at least 44 × 44 to the finger, and none covers another', async ({
    app,
    page,
  }) => {
    for (const [w, h] of [
      [320, 800],
      [390, 844],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await day(app, page);
      const screens = {
        today: () => go('today'),
        task: () => {
          go('today');
          openPath([S.quests[0].id]);
        },
        inbox: () => go('inbox'),
        knowledge: () => go('knowledge'),
        review: () => go('review'),
        account: () => go('account'),
        ops: () => go('ops'),
        waiting: () => go('waiting'),
      };
      for (const [k, fn] of Object.entries(screens)) {
        await page.evaluate(`(${fn})()`);
        const out = await page.evaluate(() => {
          const small = [],
            covered = [];
          document.querySelectorAll('button, a[href], summary, input, select').forEach(e => {
            const r = e.getBoundingClientRect();
            // (not in a folded section: there it's out of reach, though it still has a size)
            const folded = e.closest('details:not([open])');
            if (folded && !e.closest('summary')) return;
            if (!r.width || e.closest('[hidden], nav') || getComputedStyle(e).visibility === 'hidden') return;
            // (the touch area: the box, and its invisible margin of touch if it has one)
            const a = getComputedStyle(e, '::after');
            let tw = r.width,
              th = r.height;
            if (a.content !== 'none' && a.position === 'absolute') {
              tw -= (parseFloat(a.left) || 0) + (parseFloat(a.right) || 0);
              th -= (parseFloat(a.top) || 0) + (parseFloat(a.bottom) || 0);
            }
            const label = `${e.tagName}.${[...e.classList].join('.')} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20)}"`;
            if (tw < 43.5 || th < 43.5) small.push(`${Math.round(tw)}x${Math.round(th)} ${label}`);
            // (on screen, clear of the fixed tab bar and a task's action bar)
            if (r.top < 0 || r.bottom > innerHeight - 140) return;
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (hit && hit !== e && !e.contains(hit) && !hit.contains(e) && !hit.closest('.qfoot, header'))
              covered.push(label);
          });
          return { small, covered };
        });
        expect(out.small, `${k} at ${w}px`).toEqual([]);
        expect(out.covered, `${k} at ${w}px`).toEqual([]);
      }
    }
  });

  test('easily-made moves can be undone: to the Inbox, to another day, Top 3, a schedule', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const snap = () =>
      page.evaluate(() =>
        JSON.stringify([
          S.quests.map(q => [q.id, q.scheduled]),
          S.later.map(q => q.id),
          S.inbox.length,
          S.top3,
        ]),
      );
    const undo = async () => {
      await expect(page.locator('#toast #undo')).toBeVisible();
      await page.click('#toast #undo');
    };
    const id = await page.evaluate(() => S.quests.find(q => canAct(q) && !inTop3(q.id)).id);
    for (const act of [
      id => moveToInbox(id),
      id => schedule('q', id, shift(today(), 1)),
      () => toggleTop3(top3Ids()[0]),
      id => setSchedule(id, today(), '15:00'),
    ]) {
      const before = await snap();
      await page.evaluate(act, id);
      expect(await snap()).not.toBe(before);
      await undo();
      expect(await snap()).toBe(before);
    }
    // A sync arriving meanwhile ends the chance to undo (it wouldn't put back the other device's change).
    await page.evaluate(id => moveToInbox(id), id);
    await page.evaluate(() => dropUndo());
    await expect(page.locator('#toast #undo')).toHaveCount(0);
  });
});
