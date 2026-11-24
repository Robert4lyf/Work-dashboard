// Release H: the final mile, on a busy day (Scenario A). The old Today list (its jump line, its
// Scheduled and Waiting sections, its Find) has gone: what's drawn again in place is the Projects
// board and a task's page.
const { test, expect } = require('./fixtures');
const { gDay } = require('./releasegdata');

async function day(app, page, at = new Date(2026, 10, 4, 11, 0)) {
  await page.clock.install({ time: at });
  await app.open();
  await app.setState(gDay);
  await page.reload();
}
const card = id => `#v-projects .project-card[data-qid="${id}"]`;
const openProject = (page, id) => page.click(`${card(id)} h2 .project-open`);

test.describe('Checkpoint 1: Projects on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the projects start on the first screen', async ({ app, page }) => {
    await day(app, page);
    // (Today's list started 1,500px down this day, under its sections: the board has none above it)
    const first = page.locator('#v-projects .project-card h2 .project-open').first();
    await expect(first).toBeVisible();
    const box = await first.boundingBox();
    expect(box.y + box.height).toBeLessThan(844 - 64); // (above the tab bar)
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
});

test.describe("Checkpoint 2: the board and a task's page drawn again in place", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // (each card or row element tagged, to tell one left alone from one drawn again)
  const CARDS = '#v-projects .project-card[data-qid]',
    ROWS = '#v-today .row[data-qid]';
  const tag = (page, sel) =>
    page.evaluate(sel => document.querySelectorAll(sel).forEach(r => (r._seen = r.dataset.qid)), sel);
  const redrawn = (page, sel) =>
    page.$$eval(sel, rs => rs.filter(r => r._seen !== r.dataset.qid).map(r => r.dataset.qid));
  // (a view as drawn, without the patch's own marks)
  const html = (page, v) => page.$eval('#' + v, e => e.innerHTML.replace(/ data-(h|page)="[^"]*"/g, ''));
  // (the same view drawn from scratch)
  const scratch = (page, v) =>
    page.evaluate(v => {
      document.getElementById(v).removeAttribute('data-page');
      renderAll();
    }, v);

  test('a sync that changes nothing leaves every card and row alone; one that renames a step redraws only its row', async ({
    app,
    page,
  }) => {
    await day(app, page);
    // The board: every card is the one that was there, and a renamed project reads so on its own.
    expect(await page.locator(CARDS).count()).toBe(31);
    await tag(page, CARDS);
    await page.evaluate(() => inBackground(renderAll));
    expect(await redrawn(page, CARDS)).toEqual([]);
    const id = await page.evaluate(() => {
      const q = S.quests.find(x => x.text === 'Team rota');
      q.text = 'Team rota (v2)';
      inBackground(renderAll);
      return q.id;
    });
    expect((await redrawn(page, CARDS)).filter(x => x !== id)).toEqual([]);
    await expect(page.locator(`${card(id)} h2 .project-open > span`)).toHaveText('Team rota (v2)');
    // A task's page: its steps' rows.
    await openProject(page, 'g2');
    expect(await page.locator(ROWS).count()).toBe(3);
    await tag(page, ROWS);
    await page.evaluate(() => inBackground(renderAll));
    expect(await redrawn(page, ROWS)).toEqual([]);
    await page.evaluate(() => {
      find('g2s1').n.text = 'Draft (v2)';
      inBackground(renderAll);
    });
    expect(await redrawn(page, ROWS)).toEqual(['g2s1']);
    await expect(page.locator('#v-today .row[data-qid="g2s1"] .open > span')).toHaveText('Draft (v2)');
    expect(app.errors).toEqual([]);
  });

  test('ticking redraws what was ticked and what depends on it, not the rest; the order is the order underneath', async ({
    app,
    page,
  }) => {
    await day(app, page);
    // The board: a project without steps, ticked on its card, goes under Completed today.
    await tag(page, CARDS);
    const id = await page.evaluate(() => S.quests.find(q => q.text === 'Renew parking permit').id);
    await page.click(`${card(id)} [data-toggle]`);
    await expect(page.locator(`#projects-done ${card(id).replace('#v-projects ', '')}`)).toHaveCount(1);
    expect(await redrawn(page, CARDS)).toEqual([id]);
    // The cards are in the order of S.quests, whatever was moved (and moved, they're kept).
    await page.evaluate(() => {
      const [a, b] = [
        S.quests.findIndex(q => q.text === 'Team rota'),
        S.quests.findIndex(q => q.text === 'Expenses'),
      ];
      [S.quests[a], S.quests[b]] = [S.quests[b], S.quests[a]];
      renderAll();
    });
    expect(
      await page.$$eval('#active-project-grid > .project-card', cs => cs.map(c => c.dataset.qid)),
    ).toEqual(await page.evaluate(() => S.quests.filter(q => !isDone(q)).map(q => q.id)));
    expect(await redrawn(page, CARDS)).toEqual([id]);
    // A task's page: a step ticked redraws its row alone.
    await openProject(page, 'g2');
    await tag(page, ROWS);
    await page.click('#v-today .row[data-qid="g2s0"] [data-toggle]');
    await expect(page.locator('#v-today .row.done[data-qid="g2s0"]')).toHaveCount(1);
    expect(await redrawn(page, ROWS)).toEqual(['g2s0']);
    // The rows in the DOM are in the order of the task's steps, whatever was moved.
    await page.evaluate(() => {
      const kids = find('g2').n.children,
        [a, b] = [kids.findIndex(c => c.id === 'g2s1'), kids.findIndex(c => c.id === 'g2s2')];
      [kids[a], kids[b]] = [kids[b], kids[a]];
      renderAll();
    });
    const dom = await page.$$eval('#v-today .list.box > .row', rs => rs.map(r => r.dataset.qid));
    expect(dom).toHaveLength(3);
    const want = await page.evaluate(() =>
      find('g2')
        .n.children.filter(c => document.querySelector(`#v-today .list.box > .row[data-qid="${c.id}"]`))
        .map(c => c.id),
    );
    expect(want.slice(0, 2)).toEqual(['g2s2', 'g2s1']);
    // (finished ones go below the rest, as before: compare within each part)
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
    await openProject(page, id);
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
    await expect(page.locator('#v-today .row.done')).toHaveCount(2); // (it was drawn)
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

  test("a word being typed into a card's step box on the board is left as it is by a sync's redraw", async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.click(`${card('g2')} [data-project-add]`);
    await expect(page.locator('#project-step-g2')).toBeFocused();
    await page.keyboard.type('Ring the supplier');
    await page.evaluate(() => {
      const i = document.getElementById('project-step-g2');
      i._mine = 1;
      i.setSelectionRange(5, 8);
    });
    // Another device ticks a step of this project: its card changes around the box.
    await page.evaluate(() => {
      find('g2s0').n.done = true;
      inBackground(renderAll);
    });
    await expect(page.locator(`${card('g2')} .project-meta`)).toContainText('1 of 3 steps');
    expect(
      await page.$eval('#project-step-g2', i => [
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
    // The board: Completed today, once there is one, opened.
    await page.click(`${card('g3')} [data-toggle]`);
    await expect(page.locator('#projects-done')).not.toHaveAttribute('open', '');
    await page.click('#projects-done > summary');
    await page.evaluate(() => {
      renderAll();
      inBackground(renderAll);
    });
    await expect(page.locator('#projects-done')).toHaveAttribute('open', '');
    await expect(page.locator(`#projects-done ${card('g3').replace('#v-projects ', '')}`)).toBeVisible();
    // A task's page: its tag and More.
    const [a, b] = await page.evaluate(() =>
      S.quests
        .filter(q => q.children.length)
        .slice(0, 2)
        .map(q => q.id),
    );
    await openProject(page, a);
    await page.click('#tagd > summary');
    await page.click('#mored > summary');
    await page.evaluate(() => {
      renderAll();
      inBackground(renderAll);
    });
    await expect(page.locator('#tagd')).toHaveAttribute('open', '');
    await expect(page.locator('#mored')).toHaveAttribute('open', '');
    await page.evaluate(() => (document.querySelector('#v-today h1')._mine = 1));
    await page.evaluate(() => renderAll());
    expect(await page.$eval('#v-today h1', h => h._mine)).toBe(1); // (the same page: kept)
    await page.evaluate(id => openPath([id]), b);
    expect(await page.$eval('#v-today h1', h => h._mine)).toBeUndefined();
    expect(app.errors).toEqual([]);
  });

  test('after many changes in a row, drawn in place or in the background, the board is what drawing it from scratch gives', async ({
    app,
    page,
  }) => {
    await day(app, page);
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
      const patched = await html(page, 'v-projects');
      expect(patched).toContain('project-card'); // (the board is what's showing)
      await scratch(page, 'v-projects');
      expect(patched, 'after change ' + i).toBe(await html(page, 'v-projects'));
    }
    await expect(page.locator('#v-projects [data-pkeep]')).toHaveCount(0);
    expect(app.errors).toEqual([]);
  });

  test("after many changes in a row to a task's steps, its page is what drawing it from scratch gives", async ({
    app,
    page,
  }) => {
    await day(app, page);
    await openProject(page, 'q3');
    for (let i = 0; i < 12; i++) {
      await page.evaluate(i => {
        const q = find('q3').n,
          open = q.children.filter(c => !c.done),
          c = open[i % open.length];
        if (i % 4 === 0) c.text += ' x';
        else if (i % 4 === 1) q.children.push(q.children.splice(q.children.indexOf(c), 1)[0]);
        else if (i % 4 === 2)
          q.children.push({ id: 'new' + i, text: 'New step ' + i, done: false, children: [] });
        else if (open.length > 1) c.done = true;
        norm(S);
        save();
        i % 2 ? inBackground(renderAll) : renderAll();
      }, i);
      const patched = await html(page, 'v-today');
      expect(patched).toContain('Megan finance queries'); // (its page is what's showing)
      await scratch(page, 'v-today');
      expect(patched, 'after change ' + i).toBe(await html(page, 'v-today'));
    }
    await expect(page.locator('#v-today [data-pkeep]')).toHaveCount(0);
    expect(app.errors).toEqual([]);
  });

  test('Reorder: a row moved up keeps the keyboard on its Up, though the row is kept and moved', async ({
    app,
    page,
  }) => {
    await day(app, page);
    // (a task with four steps: the third, moved up, is neither first nor last before or after)
    await openProject(page, 'q8');
    await page.click('#reorder');
    await expect(page.locator('#v-today .list .row')).toHaveCount(4);
    const id = await page.$eval('#v-today .list .row:nth-child(3)', r => r.dataset.qid);
    await page.locator('#v-today .list .row:nth-child(3)').evaluate(r => (r._mine = 1));
    await page.click(`[data-up="${id}"]`);
    expect(await page.$eval('#v-today .list .row:nth-child(2)', r => [r.dataset.qid, r._mine])).toEqual([
      id,
      1,
    ]);
    await expect(page.locator(`[data-up="${id}"]`)).toBeFocused();
    expect(await page.evaluate(() => find('q8').n.children.map(c => c.id))).toEqual([
      'q8a',
      id,
      'q8b',
      'q8w',
    ]);
  });

  test("Carried over, in the weekly review: keeping one leaves the others' Keep buttons as they are", async ({
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
    // (the weekly review, a step at a time: Carried over is its second)
    await page.evaluate(() => {
      reviewSub = 'week';
      go('review');
    });
    await page.click('#v-review [data-rstep="1"]');
    await expect(page.locator('#v-review .wstep h2')).toContainText('Carried over');
    const keep = page.locator('#v-review button[data-keep]');
    await expect(keep).toHaveCount(3);
    await keep.first().click();
    await expect(keep).toHaveCount(2);
    await expect(page.locator('#v-review')).not.toContainText('undefined');
    expect(await page.evaluate(() => S.quests.filter(q => q.kept === today()).length)).toBe(1);
  });

  test("a box marked to keep its words, on a page drawn in place: the patch's own marks are its own", async ({
    app,
    page,
  }) => {
    await day(app, page);
    // An Upcoming project's page: its step box is marked data-keep (the patch's marks are data-pkeep).
    await page.click('#v-projects .project-open[data-upcoming-project="m4"]');
    await expect(page.locator('#v-project-record #upcoming-step[data-keep]')).toHaveCount(1);
    const addStep = (id, text) =>
      page.evaluate(
        ([id, text]) => {
          S.later.find(q => q.id === 'm4').children.push({ id, text, done: false, children: [] });
          norm(S);
          save();
          inBackground(renderAll);
        },
        [id, text],
      );
    await page.locator('#upcoming-step').evaluate(i => (i._mine = 1));
    await addStep('m4a', 'Read the pack');
    await expect(page.locator('#v-project-record')).toContainText('Read the pack');
    await expect(page.locator('#v-project-record')).not.toContainText('undefined');
    expect(await page.$eval('#upcoming-step', i => i._mine)).toBe(1); // (drawn in place: the same box)
    const patched = await html(page, 'v-project-record');
    await scratch(page, 'v-project-record');
    expect(patched).toBe(await html(page, 'v-project-record'));
    await expect(page.locator('#v-project-record [data-pkeep]')).toHaveCount(0);
    // Words typed into it stay through a sync's redraw.
    await page.fill('#upcoming-step', 'Print the papers');
    await addStep('m4b', 'Book the room');
    await expect(page.locator('#v-project-record')).toContainText('Book the room');
    await expect(page.locator('#upcoming-step')).toHaveValue('Print the papers');
    await expect(page.locator('#v-project-record #upcoming-step[data-keep]')).toHaveCount(1);
    await expect(page.locator('#v-project-record [data-pkeep]')).toHaveCount(0);
  });

  test("a fold's summary keeps the keyboard through a sync's redraw of its section", async ({
    app,
    page,
  }) => {
    await day(app, page);
    // The board: Completed today.
    await page.click(`${card('g3')} [data-toggle]`);
    await page.focus('#projects-done > summary');
    await page.keyboard.press('Enter');
    await expect(page.locator('#projects-done')).toHaveAttribute('open', '');
    await page.evaluate(() => inBackground(renderAll));
    await expect(page.locator('#projects-done > summary')).toBeFocused();
    await page.evaluate(() => renderAll());
    await expect(page.locator('#projects-done > summary')).toBeFocused();
    await expect(page.locator('#projects-done')).toHaveAttribute('open', '');
    // A task's page: More.
    await openProject(page, 'g2');
    await page.focus('#mored > summary');
    await page.keyboard.press('Enter');
    await expect(page.locator('#mored')).toHaveAttribute('open', '');
    await page.evaluate(() => inBackground(renderAll));
    await expect(page.locator('#mored > summary')).toBeFocused();
    await page.evaluate(() => renderAll());
    await expect(page.locator('#mored > summary')).toBeFocused();
    await expect(page.locator('#mored')).toHaveAttribute('open', '');
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
    await openProject(page, id);
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
    await expect(page.locator('header [data-resume]')).toHaveCount(0);
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

  test('the Follow up sheet fits at 320px with Larger text', async ({ app, page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await day(app, page);
    await page.evaluate(() => {
      document.documentElement.dataset.font = 'large';
      go('waiting');
    });
    // (a waiting item's actions, then Follow up)
    await page.locator('#v-waiting .row [data-wact]').first().click();
    await page.click('#sheet [data-chase]');
    await expect(page.locator('#sheettitle')).toHaveText('Follow up');
    await expect(page.locator('#sheet .fld').first()).toBeVisible();
    const over = await page.$eval('#sheet', s =>
      [...s.querySelectorAll('.fld')].some(
        f => f.getBoundingClientRect().right > s.getBoundingClientRect().right + 0.5,
      ),
    );
    expect(over).toBe(false);
  });

  test('back to the board after the phone turned: the project opened is on the screen', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const id = await page.$eval('#active-project-grid > .project-card:nth-child(6)', r => r.dataset.qid);
    await page.evaluate(id => {
      const r = document.querySelector(`#v-projects .project-card[data-qid="${id}"]`);
      scrollBy(0, r.getBoundingClientRect().top - 500);
    }, id);
    await openProject(page, id);
    // (turned: the board is laid out afresh, so where it was scrolled to is no longer where the card is)
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => history.back());
    const title = page.locator(`${card(id)} h2 .project-open`);
    await expect(title).toBeVisible();
    await expect(title).toBeInViewport({ ratio: 1 });
    const b = await title.evaluate(r => r.getBoundingClientRect().bottom);
    expect(b).toBeLessThanOrEqual(390);
  });
});
