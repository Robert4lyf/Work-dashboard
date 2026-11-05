// Release H: the final mile. Checkpoint 1: Today on a phone, a busy day (Scenario A).
const { test, expect } = require('./fixtures');
const { gDay } = require('./releasegdata');

async function day(app, page, at = new Date(2026, 10, 4, 11, 0)) {
  await page.clock.install({ time: at });
  await app.open();
  await app.setState(gDay);
  await page.reload();
}
// (more scheduled for today, so there's something to fold: two later meetings)
const moreMeetings = page =>
  page.evaluate(() => {
    ['15:30', '16:30'].forEach((time, i) =>
      S.quests.push({
        id: 'mx' + i,
        text: 'Meeting ' + (i + 1),
        done: false,
        children: [],
        scheduled: { date: today(), time },
      }),
    );
    norm(S);
    save();
    renderAll();
  });
const shownRows = (page, sec) =>
  page.$$eval(`#v-today .${sec} .secrow`, rs =>
    rs.filter(r => r.checkVisibility()).map(r => r.querySelector('.open > span').textContent),
  );

test.describe('Checkpoint 1: Today on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a line at the top says what is further down; a tap goes to the section, the keyboard with it', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const jump = page.locator('#v-today > .tjump');
    await expect(jump).toBeVisible();
    await expect(jump.locator('[data-jump]')).toHaveText(['Scheduled 3↓', 'Waiting 4↓', 'Tasks 25↓']);
    // On the first screen, above the tab bar.
    const box = await jump.boundingBox();
    expect(box.y + box.height).toBeLessThan(844 - 64);
    for (const [k, id] of [
      ['Tasks', 'taskshead'],
      ['Waiting', 'waithead'],
      ['Scheduled', 'schedhead'],
    ]) {
      await page.evaluate(() => scrollTo(0, 0));
      await jump.locator(`[data-jump="${id}"]`).click();
      await expect(page.locator('#' + id)).toBeFocused();
      const top = await page.$eval('#' + id, h => h.closest('.sechead').getBoundingClientRect().top);
      expect(Math.abs(top - 8), k).toBeLessThan(3);
    }
    // Nothing changed, nothing saved: only where the page is.
    expect(app.errors).toEqual([]);
  });

  test('Waiting: the most urgent shown, the rest a tap away with how many are due a chase; kept open or folded', async ({
    app,
    page,
  }) => {
    await day(app, page);
    expect(await shownRows(page, 'waitsec2')).toEqual(['Hear back on figures']);
    const more = page.locator('#waitmore');
    await expect(more.locator('> summary')).toHaveText('3 more 2 to chase');
    await expect(page.locator('#v-today .wrow')).toHaveCount(4); // (all there, three folded)
    await more.locator('> summary').click();
    expect((await shownRows(page, 'waitsec2')).length).toBe(4);
    // Open stays open through a redraw, a sync's redraw and a reload.
    await page.evaluate(() => renderAll());
    await page.evaluate(() => inBackground(renderAll));
    await expect(more).toHaveAttribute('open', '');
    await page.reload();
    await expect(page.locator('#waitmore')).toHaveAttribute('open', '');
    await page.locator('#waitmore > summary').click();
    await page.reload();
    await expect(page.locator('#waitmore')).not.toHaveAttribute('open', '');
    expect(app.errors).toEqual([]);
  });

  test('Scheduled: any whose time went by unrecorded, then the next; the rest a tap away with their times', async ({
    app,
    page,
  }) => {
    await day(app, page);
    // Three: one past, the next, one at any time. One left over isn't folded (it would take
    // nearly the room of its row).
    expect(await shownRows(page, 'schedsec')).toHaveLength(3);
    await expect(page.locator('#schedmore')).toHaveCount(0);
    await moreMeetings(page);
    const shown = await shownRows(page, 'schedsec');
    expect(shown).toHaveLength(2);
    await expect(page.locator('#v-today .schedsec .secrow').first()).toContainText('Time passed');
    await expect(page.locator('#v-today .schedsec .secrow').nth(1)).toContainText('14:00');
    await expect(page.locator('#schedmore > summary')).toHaveText('3 more 15:30, 16:30, Any time');
    // At 14:05 the 14:00 one waits to be recorded, and 15:30 is next.
    await page.clock.setFixedTime(new Date(2026, 10, 4, 14, 5));
    await page.evaluate(() => renderAll());
    await expect(page.locator('#schedmore > summary')).toHaveText('2 more 16:30, Any time');
    expect(app.errors).toEqual([]);
  });

  test('two columns show the whole of Scheduled and Waiting, with no jump line', async ({ app, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await day(app, page);
    await moreMeetings(page);
    await expect(page.locator('#v-today .tjump')).toHaveCount(0);
    await expect(page.locator('#schedmore, #waitmore')).toHaveCount(0);
    expect(await shownRows(page, 'waitsec2')).toHaveLength(4);
    expect(await shownRows(page, 'schedsec')).toHaveLength(5);
  });

  test('Find reaches a finished task: Done today opens for it, and closes again after', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.evaluate(() => {
      S.quests.find(q => q.text === 'Book room for team away day').done = true;
      save();
      renderAll();
    });
    await expect(page.locator('#donesec')).not.toHaveAttribute('open', '');
    await page.click('[data-tfindopen]');
    await page.keyboard.type('book room');
    await expect(page.locator('#donesec')).toHaveAttribute('open', '');
    await expect(page.locator('#donesec .row .open > span')).toHaveText('Book room for team away day');
    await expect(page.locator('#v-today .tnomatch')).toBeHidden();
    await page.fill('#tfind', '');
    await expect(page.locator('#donesec')).not.toHaveAttribute('open', '');
    // (and that wasn't remembered as opened)
    await page.evaluate(() => renderAll());
    await expect(page.locator('#donesec')).not.toHaveAttribute('open', '');
  });

  test("Today's tasks start well up the page", async ({ app, page }) => {
    await day(app, page);
    // (Release G: 1,701px on this day at 390 × 844)
    const y = await page.$eval('#v-today .list', e => e.getBoundingClientRect().top + scrollY);
    expect(y).toBeLessThan(1500);
  });
});

test.describe('Checkpoint 2: Today drawn again in place', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // (each row element tagged, to tell a row left alone from one drawn again)
  const tag = page =>
    page.evaluate(() =>
      document.querySelectorAll('#v-today .row[data-qid]').forEach(r => (r._seen = r.dataset.qid)),
    );
  const redrawn = page =>
    page.$$eval('#v-today .row[data-qid]', rs =>
      rs.filter(r => r._seen !== r.dataset.qid).map(r => r.dataset.qid),
    );

  test('a sync that changes nothing leaves every row alone; one that renames a task redraws only its row', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await tag(page);
    await page.evaluate(() => inBackground(renderAll));
    expect(await redrawn(page)).toEqual([]);
    const id = await page.evaluate(() => {
      const q = S.quests.find(x => x.text === 'Team rota');
      q.text = 'Team rota (v2)';
      inBackground(renderAll);
      return q.id;
    });
    expect(await redrawn(page)).toEqual([id]);
    await expect(page.locator(`#v-today .row[data-qid="${id}"] .open > span`)).toHaveText('Team rota (v2)');
    expect(app.errors).toEqual([]);
  });

  test('ticking a task redraws its row and what depends on it, not the rest; the order is the order underneath', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await tag(page);
    const id = await page.evaluate(() => S.quests.find(q => q.text === 'Renew parking permit').id);
    await page.click(`#v-today .row[data-qid="${id}"] [data-toggle]`);
    await expect(page.locator(`#donesec .row[data-qid="${id}"]`)).toHaveCount(1);
    expect(await redrawn(page)).toEqual([id]);
    // The rows in the DOM are in the order of S.quests, whatever was moved.
    await page.evaluate(() => {
      const [a, b] = [
        S.quests.findIndex(q => q.text === 'Team rota'),
        S.quests.findIndex(q => q.text === 'Expenses'),
      ];
      [S.quests[a], S.quests[b]] = [S.quests[b], S.quests[a]];
      renderAll();
    });
    const dom = await page.$$eval('#v-today .list.box > .row', rs => rs.map(r => r.dataset.qid));
    const want = await page.evaluate(() => {
      const shown = new Set(
        [...document.querySelectorAll('#v-today .list.box > .row')].map(r => r.dataset.qid),
      );
      return S.quests.filter(q => shown.has(q.id)).map(q => q.id);
    });
    // (waiting ones go below the rest, as before: compare within each part)
    const rank = await page.evaluate(ids => ids.map(id => listRank(find(id).n)), dom);
    expect(rank).toEqual([...rank].sort((x, y) => x - y));
    for (const k of new Set(rank))
      expect(dom.filter((_, i) => rank[i] === k)).toEqual(want.filter(id => rank[dom.indexOf(id)] === k));
    expect(app.errors).toEqual([]);
  });

  test("a word being typed on a task's page is left exactly as it is by a sync's redraw: the same box, its words, its place", async ({
    app,
    page,
  }) => {
    await day(app, page);
    const id = await page.evaluate(() => S.quests.find(q => q.children.length > 1).id);
    await page.evaluate(id => openPath([id]), id);
    await page.click('#sin');
    await page.keyboard.type('Ring the supplier');
    await page.evaluate(() => {
      const i = document.getElementById('sin');
      i._mine = 1;
      i.setSelectionRange(5, 8);
    });
    // Another device ticks a step of this task: the page changes around the box.
    await page.evaluate(() => {
      const r = find(path[0]).n;
      r.children.find(c => !c.done).done = true;
      inBackground(renderAll);
    });
    expect(
      await page.$eval('#sin', i => [
        i._mine,
        i.value,
        i.selectionStart,
        i.selectionEnd,
        document.activeElement === i,
      ]),
    ).toEqual([1, 'Ring the supplier', 5, 8, true]);
    expect(app.errors).toEqual([]);
  });

  test('open sections stay open through redraws; a different page is drawn from scratch', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.click('#attd > summary');
    await page.click('#waitmore > summary');
    await page.evaluate(() => {
      renderAll();
      inBackground(renderAll);
    });
    await expect(page.locator('#attd')).toHaveAttribute('open', '');
    await expect(page.locator('#waitmore')).toHaveAttribute('open', '');
    const [a, b] = await page.evaluate(() =>
      S.quests
        .filter(q => q.children.length)
        .slice(0, 2)
        .map(q => q.id),
    );
    await page.evaluate(id => openPath([id]), a);
    await page.evaluate(() => (document.querySelector('#v-today h1')._mine = 1));
    await page.evaluate(id => openPath([id]), b);
    expect(await page.$eval('#v-today h1', h => h._mine)).toBeUndefined();
    expect(app.errors).toEqual([]);
  });
  test('after many changes in a row, drawn in place or in the background, the page is what drawing it from scratch gives', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const html = () => page.$eval('#v-today', e => e.innerHTML.replace(/ data-(h|keep|page)="[^"]*"/g, ''));
    for (let i = 0; i < 12; i++) {
      await page.evaluate(i => {
        const qs = S.quests.filter(q => !q.done),
          q = qs[(i * 7) % qs.length];
        if (i % 4 === 0) q.text += ' x';
        else if (i % 4 === 1 && q.children.some(c => !c.done)) q.children.find(c => !c.done).done = true;
        else if (i % 4 === 2) S.quests.push(S.quests.splice(S.quests.indexOf(q), 1)[0]);
        else if (!q.children.length) q.done = true;
        norm(S);
        save();
        i % 2 ? inBackground(renderAll) : renderAll();
      }, i);
      const patched = await html();
      await page.evaluate(() => {
        document.getElementById('v-today').removeAttribute('data-page');
        renderAll();
      });
      expect(patched, 'after change ' + i).toBe(await html());
    }
    await expect(page.locator('#v-today [data-keep]')).toHaveCount(0);
    expect(app.errors).toEqual([]);
  });

  test('Reorder: a row moved up keeps the keyboard on its Up, though the row is kept and moved', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.click('#reorder');
    const id = await page.$eval('#v-today .list .row:nth-child(3)', r => r.dataset.qid);
    await page.locator('#v-today .list .row:nth-child(3)').evaluate(r => (r._mine = 1));
    await page.click(`[data-up="${id}"]`);
    expect(await page.$eval('#v-today .list .row:nth-child(2)', r => [r.dataset.qid, r._mine])).toEqual([
      id,
      1,
    ]);
    await expect(page.locator(`[data-up="${id}"]`)).toBeFocused();
  });
  test("Carried over: keeping one leaves the others' Keep buttons as they are (the patch's own marks are its own)", async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.evaluate(() => {
      S.quests
        .filter(q => !q.done && !q.scheduled)
        .slice(0, 3)
        .forEach(q => (q.since = shift(today(), -5)));
      save();
    });
    await page.reload();
    await page.click('#carrd > summary');
    await expect(page.locator('#carrd button[data-keep]')).toHaveCount(3);
    await page.locator('#carrd button[data-keep]').first().click();
    await expect(page.locator('#carrd button[data-keep]')).toHaveCount(2);
    await expect(page.locator('#carrd')).not.toContainText('undefined');
    const html = () => page.$eval('#v-today', e => e.innerHTML.replace(/ data-(h|page)="[^"]*"/g, ''));
    const patched = await html();
    await page.evaluate(() => {
      document.getElementById('v-today').removeAttribute('data-page');
      renderAll();
    });
    expect(patched).toBe(await html());
  });

  test('Find opening Done today, then a sync redraw: it closes when the words are cleared, and stays unremembered', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.evaluate(() => {
      S.quests.find(q => q.text === 'Book room for team away day').done = true;
      save();
      renderAll();
    });
    await page.click('[data-tfindopen]');
    await page.keyboard.type('book room');
    await expect(page.locator('#donesec')).toHaveAttribute('open', '');
    await page.evaluate(() => inBackground(renderAll));
    await expect(page.locator('#donesec')).toHaveAttribute('open', '');
    await page.fill('#tfind', '');
    await expect(page.locator('#donesec')).not.toHaveAttribute('open', '');
    await page.evaluate(() => renderAll());
    await expect(page.locator('#donesec')).not.toHaveAttribute('open', '');
    expect(await page.evaluate(() => panels.donesec)).not.toBe(true);
  });

  test("a fold's summary keeps the keyboard through a sync's redraw of its section", async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.focus('#waitmore > summary');
    await page.keyboard.press('Enter');
    await expect(page.locator('#waitmore')).toHaveAttribute('open', '');
    await page.evaluate(() => inBackground(renderAll));
    await expect(page.locator('#waitmore > summary')).toBeFocused();
    await page.evaluate(() => renderAll());
    await expect(page.locator('#waitmore > summary')).toBeFocused();
  });
});

test.describe('Checkpoint 5: review fixes', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the step box is empty after a step is added, typed in and sent with Enter twice', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const id = await page.evaluate(() => S.quests.find(q => q.children.length > 1).id);
    await page.evaluate(id => openPath([id]), id);
    const n0 = await page.evaluate(id => find(id).n.children.length, id);
    await page.click('#sin');
    await page.keyboard.type('Gather figures');
    await page.keyboard.press('Enter');
    await expect(page.locator('#sin')).toHaveValue('');
    await expect(page.locator('#sin')).toBeFocused();
    await page.keyboard.type('Draft it');
    await page.keyboard.press('Enter');
    const kids = await page.evaluate(id => find(id).n.children.map(c => c.text), id);
    expect(kids.length).toBe(n0 + 2);
    expect(kids).toContain('Gather figures');
    expect(kids).toContain('Draft it');
  });

  test('with a focus session paused, the header offers no other task to continue; the session is named with its task', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.evaluate(() => {
      const q = S.quests.find(q => q.text === 'Fletcher Way'),
        c = q.children.find(c => !c.done);
      S.timer = { q: c.id, mins: 25, left: 24 * 60 * 1000, started: Date.now() };
      save();
      go('focus');
    });
    await expect(page.locator('#hact [data-resume]')).toHaveCount(0);
    await expect(page.locator('#clock small')).toContainText('Fletcher Way · ');
  });

  test("Search: a sync's redraw waits while the keyboard is composing a word, then happens", async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.evaluate(() => go('search'));
    await page.click('#sq');
    await page.keyboard.type('Hel');
    const same = await page.evaluate(() => {
      const i = document.getElementById('sq');
      i._mine = 1;
      i.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      inBackground(renderAll);
      const kept = document.getElementById('sq')._mine === 1;
      i.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      return kept;
    });
    expect(same).toBe(true);
    await expect(page.locator('#sq')).toHaveValue('Hel');
  });

  test('the jump line keeps to one line with Larger text at 360px; the Follow up sheet fits at 320px', async ({
    app,
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await day(app, page);
    await page.evaluate(() => {
      document.documentElement.dataset.font = 'large';
      renderAll();
    });
    const tops = await page.$$eval('#v-today .tjump [data-jump]', bs =>
      bs.map(b => Math.round(b.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size).toBe(1);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.locator('#v-today .wrow [data-chase]').first().click();
    const over = await page.$eval('#sheet', s =>
      [...s.querySelectorAll('.fld')].some(
        f => f.getBoundingClientRect().right > s.getBoundingClientRect().right + 0.5,
      ),
    );
    expect(over).toBe(false);
  });

  test('back to the list after the phone turned: the row opened is on the screen', async ({ app, page }) => {
    await day(app, page);
    const id = await page.$eval('#v-today .list .row:nth-child(6)', r => r.dataset.qid);
    await page.evaluate(id => {
      const r = document.querySelector(`#v-today .row[data-qid="${id}"]`);
      scrollBy(0, r.getBoundingClientRect().top - 600);
    }, id);
    await page.click(`#v-today .row[data-qid="${id}"] .open`);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => history.back());
    await expect(page.locator(`#v-today .row[data-qid="${id}"]`)).toBeVisible();
    const b = await page.$eval(`#v-today .row[data-qid="${id}"]`, r => r.getBoundingClientRect().bottom);
    expect(b).toBeLessThanOrEqual(390);
  });
});
