// Release G: the excellence release, on a busy day (Scenario A). The old Today list (its filters
// and Find, its Needs attention line, Top 3) has gone: these go through the Projects board.
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

test.describe('Checkpoint 1: a busy day', () => {
  test('a project says how far its steps have got, on its card and on its page; a step is a row', async ({
    app,
    page,
  }) => {
    await day(app, page);
    // Every task is a card: the 30 on the board, and the one put off under Upcoming.
    expect(await page.locator('#v-projects .project-card').count()).toBe(31);
    expect(await app.order()).toHaveLength(31);
    const w = page.locator(card('q0'));
    await expect(w.locator('h2 .project-open > span')).toHaveText('Walsingham sale');
    await expect(w.locator('.project-meta')).toHaveText('1 of 3 steps');
    await expect(w.locator('.project-step')).toHaveCount(3);
    await expect(w.locator('.project-step.project-step-done')).toHaveCount(1);
    // Its page: the count and the bar, and its steps a row each, no taller than before.
    await openProject(page, 'q0');
    await expect(page.locator('#v-today .node.facts > h1')).toHaveText('Walsingham sale');
    await expect(page.locator('#v-today .node .prog + .hint')).toHaveText('1 / 3 complete');
    expect(await page.$eval('#v-today .node .prog > div', e => e.style.width)).toBe('33%');
    const rows = page.locator('#v-today .list .row');
    expect(await rows.count()).toBe(3);
    // (87px a row on average before Release G)
    const hs = await rows.evaluateAll(r => r.map(e => e.offsetHeight));
    expect(hs.reduce((a, h) => a + h, 0) / hs.length).toBeLessThan(80);
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
        projects: () => go('projects'),
        task: () => {
          go('projects');
          document.querySelector('#v-projects .project-card h2 .project-open').click();
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
        // (the screen meant is the one showing)
        expect(await page.evaluate(() => view), k).toBe({ task: 'today' }[k] || k);
        await expect(page.locator('#v-' + (k === 'task' ? 'today' : k))).toBeVisible();
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

  test('easily-made moves can be undone: to the Inbox, to another day, a schedule', async ({ app, page }) => {
    await day(app, page);
    const snap = () =>
      page.evaluate(() =>
        JSON.stringify([S.quests.map(q => [q.id, q.scheduled]), S.later.map(q => q.id), S.inbox.length]),
      );
    const undo = async () => {
      await expect(page.locator('#toast #undo')).toBeVisible();
      await page.click('#toast #undo');
    };
    const id = await page.evaluate(() => S.quests.find(q => canAct(q)).id);
    for (const act of [
      id => moveToInbox(id),
      id => schedule('q', id, shift(today(), 1)),
      id => setSchedule(id, today(), '15:00'),
    ]) {
      const before = await snap();
      await page.evaluate(act, id);
      expect(await snap()).not.toBe(before);
      await undo();
      expect(await snap()).toBe(before);
    }
    // The same from the task's own actions, on its page: each a tap, each undone from its toast.
    const name = await page.evaluate(id => find(id).n.text, id);
    for (const [pick, went] of [
      ['#sheet button:has-text("Move to Inbox")', 'Moved to the Inbox'],
      ['#sheet [data-sched] >> text="Do tomorrow"', 'On Upcoming until'],
      ['#sheet [data-sched] >> text="Do next week"', 'On Upcoming until'],
    ]) {
      const before = await snap();
      await openProject(page, id);
      await page.click('#v-today .qfoot .qmore[data-qact]');
      await page.click(pick);
      await expect(page.locator('#toast')).toContainText(went);
      expect(await snap()).not.toBe(before);
      await expect(page.locator(`${card(id)} h2 .project-open[data-open]`)).toHaveCount(0); // (off the board)
      await undo();
      expect(await snap()).toBe(before);
      await expect(page.locator(`${card(id)} h2 .project-open[data-open] > span`)).toHaveText(name);
    }
    // A sync arriving meanwhile ends the chance to undo (it wouldn't put back the other device's change).
    await page.evaluate(id => moveToInbox(id), id);
    await page.evaluate(() => dropUndo());
    await expect(page.locator('#toast #undo')).toHaveCount(0);
  });
});

test.describe('Checkpoint 4: accessibility', () => {
  test('each main screen has a heading list a screen reader can follow; every control has a name', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const screens = {
      projects: [() => go('projects'), ['Projects', 'Active Task', 'Uncategorised', 'Walsingham sale']],
      task: [
        () => document.querySelector('#v-projects .project-card h2 .project-open').click(),
        ['Walsingham sale', 'Steps'],
      ],
      knowledge: [() => go('knowledge'), ['Knowledge']],
      review: [() => go('review'), ['Review']],
      account: [() => go('account'), ['Settings']],
      ops: [() => go('ops'), ['Command Centre', 'Needs attention']],
    };
    for (const [k, [fn, want]] of Object.entries(screens)) {
      await page.evaluate(`(${fn})()`);
      expect(await page.evaluate(() => view), k).toBe({ task: 'today' }[k] || k);
      // (one page title, and it's the first heading)
      await expect(page.locator('h1').filter({ visible: true })).toHaveText([want[0]]);
      const r = await page.evaluate(() => {
        const vis = e => e.getClientRects().length && !e.closest('[hidden]');
        return {
          heads: [...document.querySelectorAll('h1,h2,h3,[role=heading]')]
            .filter(vis)
            .map(h => h.textContent.trim()),
          noname: [...document.querySelectorAll('button, a[href], input, select, textarea, summary')]
            .filter(vis)
            .filter(
              e =>
                !(
                  e.getAttribute('aria-label') ||
                  e.textContent ||
                  e.getAttribute('placeholder') ||
                  // (a field named by its <label>, as a task's deadline and notes are)
                  [...(e.labels || [])].map(l => l.textContent).join('') ||
                  ''
                ).trim(),
            )
            .map(e => e.outerHTML.slice(0, 60)),
        };
      });
      expect(r.heads[0], k).toBe(want[0]);
      for (const w of want)
        expect(
          r.heads.some(h => h.startsWith(w)),
          `${k}: ${w}`,
        ).toBe(true);
      expect(r.noname, k).toEqual([]);
    }
    await page.evaluate(() => go('knowledge'));
    await expect(page.getByRole('heading', { name: 'Knowledge', exact: true, level: 1 })).toBeVisible();
  });
});

test.describe('Checkpoint 3: review fixes', () => {
  test('back from a task opened elsewhere returns there, where it was; the board keeps its scroll', async ({
    app,
    page,
  }) => {
    await day(app, page);
    // From Waiting: the crumb says so, and back returns to Waiting.
    await page.evaluate(() => go('waiting'));
    await page.click('#v-waiting .row .open >> nth=0');
    await expect(page.locator('#v-today .crumbs button').first()).toHaveText('‹ Waiting');
    await page.evaluate(() => history.back());
    await expect(page.locator('#v-waiting')).toBeVisible();
    // From Forecast, scrolled: back returns to Forecast at the same place.
    await page.evaluate(() => {
      reviewSub = 'forecast';
      go('review');
    });
    await page.evaluate(() => document.querySelectorAll('#v-review details').forEach(d => (d.open = true)));
    const opener = page.locator('#v-review [data-open]').filter({ visible: true }).first();
    if (await opener.count()) {
      await page.evaluate(() => window.scrollTo(0, 300));
      const y = await page.evaluate(() => window.scrollY);
      await opener.click();
      await expect(page.locator('#v-today .node')).toHaveCount(1);
      await page.click('#v-today .crumbs [data-crumb="-1"]');
      await expect(page.locator('#v-review')).toBeVisible();
      expect(await page.evaluate(() => reviewSub)).toBe('forecast');
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThan(5);
    }
    // The board: open the 16th project far down, back: the board is where it was.
    await page.evaluate(() => go('projects'));
    const title = page.locator('#v-projects .project-card h2 .project-open').nth(15);
    await title.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    const top0 = await title.evaluate(e => e.getBoundingClientRect().top);
    const id = await title.getAttribute('data-open');
    await title.click();
    expect(await page.evaluate(() => [view, path.join('/')])).toEqual(['today', id]);
    await expect(page.locator('#v-today .crumbs button').first()).toHaveText('‹ Projects');
    await page.evaluate(() => history.back());
    await expect(page.locator('#v-projects')).toBeVisible();
    // (the card just left is where it was on the screen)
    const back = page.locator('#v-projects .project-card h2 .project-open').nth(15);
    await expect(back).toHaveAttribute('data-open', id);
    expect(Math.abs((await back.evaluate(e => e.getBoundingClientRect().top)) - top0)).toBeLessThan(5);
  });

  test('a save that fails says so until a save works; moving to the Inbox keeps finished steps', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.evaluate(() => {
      window.__realTx = picDb.transaction.bind(picDb);
      picDb.transaction = (...a) => {
        const tx = window.__realTx(...a);
        // (aborted at once: the write fails every time, as with a full disk; not a race)
        if (a[0] === 'kv' && a[1] === 'readwrite') tx.abort();
        return tx;
      };
    });
    await page.evaluate(() => save());
    await expect(page.locator('#savewarn')).toBeVisible();
    await page.evaluate(() => save());
    await expect(page.locator('#savewarn')).toBeVisible(); // (still there, not a passing message)
    await page.evaluate(() => (picDb.transaction = window.__realTx));
    await page.evaluate(() => save());
    await expect(page.locator('#savewarn')).toHaveCount(0);
    // Walsingham sale, a step finished: to the Inbox and back, the step is still finished.
    const id = await page.evaluate(() => S.quests.find(q => q.text === 'Walsingham sale').id);
    await page.evaluate(id => moveToInbox(id), id);
    await page.evaluate(() => promoteInbox(S.inbox[0].id));
    expect(
      await page.evaluate(id => S.quests.find(q => q.id === id).children.filter(c => c.done).length, id),
    ).toBe(1);
  });

  test('typed words wait for you: the Inbox box and a step box, per task', async ({ app, page }) => {
    await day(app, page);
    await app.go('inbox');
    await page.fill('#iin', 'Call the bank');
    await app.go('projects');
    await app.go('inbox');
    await expect(page.locator('#iin')).toHaveValue('Call the bank');
    await app.go('projects');
    const [a, b] = await page.evaluate(() =>
      S.quests
        .filter(q => q.children.length)
        .map(q => q.id)
        .slice(0, 2),
    );
    await openProject(page, a);
    await page.fill('#sin', 'Ring Jo');
    // To another task's page by the board (its ‹ Projects, then the other's card): not its words.
    await page.click('#v-today [data-crumb="-1"]');
    await openProject(page, b);
    await expect(page.locator('#v-today .node.facts > h1')).toHaveText(
      await page.evaluate(id => find(id).n.text, b),
    );
    await expect(page.locator('#sin')).toHaveValue('');
    // (and straight from one page to the next, as the board beside a page does it)
    await page.evaluate(id => openPath([id]), a);
    await expect(page.locator('#sin')).toHaveValue('Ring Jo');
    await page.evaluate(id => openPath([id]), b);
    await expect(page.locator('#sin')).toHaveValue('');
    // Back (Android's gesture) to the board, and the first task again: its words.
    await page.evaluate(() => history.back());
    await expect(page.locator('#v-projects')).toBeVisible();
    await openProject(page, a);
    await expect(page.locator('#sin')).toHaveValue('Ring Jo');
  });

  test('why a task is due shows on its card; a step is named with its task in Needs attention', async ({
    app,
    page,
  }) => {
    await day(app, page);
    // (due: its own deadline today or gone by, or a step's)
    const due = await page.evaluate(() =>
      S.quests
        .filter(
          q =>
            !isDone(q) &&
            ((q.due && q.due <= today()) || q.children.some(c => !isDone(c) && c.due && c.due <= today())),
        )
        .map(q => q.id),
    );
    expect(due.length).toBeGreaterThan(2);
    for (const id of due)
      await expect(page.locator(`${card(id)} .project-meta`).locator('.tag.late, .tag.now')).not.toHaveCount(
        0,
      );
    // (and no other card says so)
    expect(
      await page.$$eval('#v-projects .project-card', cs =>
        cs
          .filter(c => c.querySelector('.project-meta .tag.late, .project-meta .tag.now'))
          .map(c => c.dataset.qid),
      ),
    ).toEqual(due);
    await expect(page.locator(`${card('q6')} .project-meta .tag.late`)).toHaveText('Step overdue');
    const att = await page.evaluate(() => attentionItems().map(i => i.text));
    expect(att).toContain('Client onboarding: Review');
    await page.evaluate(() => go('ops'));
    await expect(page.locator('#v-ops .attlist')).toContainText('Client onboarding: Review');
  });

  test('search finds a guide by its steps; a sheet puts the page behind out of reach', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.evaluate(() => {
      S.kb.push({
        id: 'gq',
        cat: '',
        title: 'Month end',
        body: '',
        edited: 1,
        imgs: [],
        steps: [{ id: 's1', title: 'Download the bank statements' }],
      });
      save();
    });
    await page.evaluate(() => {
      go('search');
    });
    await page.fill('#searchin, #v-search input', 'bank statements');
    await expect(page.locator('#v-search')).toContainText('Month end');
    await page.evaluate(() => go('projects'));
    await page.click('#v-projects [data-project-new]');
    await expect(page.locator('#sheettitle')).toHaveText('New project');
    expect(
      await page.evaluate(() => [document.querySelector('.wrap').inert, document.querySelector('nav').inert]),
    ).toEqual([true, true]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet')).toHaveCount(0);
    expect(
      await page.evaluate(() => [document.querySelector('.wrap').inert, document.querySelector('nav').inert]),
    ).toEqual([false, false]);
  });
});

test.describe('Checkpoint 5: adversarial review fixes', () => {
  test('drafts: kept when going back to Search; the Inbox box regardless of the task open', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const id = await page.evaluate(() => S.quests.find(q => q.children.length).id);
    await page.evaluate(() => go('search'));
    await page.evaluate(id => {
      const q = S.quests.find(x => x.id === id);
      document.querySelector('#sq').value = q.text;
      searchQ = q.text;
      renderSearch();
    }, id);
    await page.click(`#v-search [data-open="${id}"]`);
    await page.fill('#sin', 'Ring Jo');
    await page.evaluate(() => history.back());
    await expect(page.locator('#v-search')).toBeVisible();
    await page.click(`#v-search [data-open="${id}"]`);
    await expect(page.locator('#sin')).toHaveValue('Ring Jo');
    // The Inbox box: the task whose page is open doesn't matter.
    await app.go('inbox');
    await page.fill('#iin', 'Call the bank');
    await app.go('today');
    expect(await page.evaluate(() => [view, path.join('/')])).toEqual(['today', id]);
    await page.evaluate(() => openPath([]));
    expect(await page.evaluate(() => view)).toBe('projects');
    await app.go('inbox');
    await expect(page.locator('#iin')).toHaveValue('Call the bank');
  });

  test('a task opened from Search then removed: back from the next task is to Projects, not Search', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const [a, b] = await page.evaluate(() =>
      S.quests
        .filter(canAct)
        .map(q => q.id)
        .slice(3, 5),
    );
    await page.evaluate(() => go('search'));
    await page.evaluate(id => {
      returnTo = null;
      const q = S.quests.find(x => x.id === id);
      searchQ = q.text;
      renderSearch();
    }, a);
    await page.click(`#v-search [data-open="${a}"]`);
    await expect(page.locator('#v-today .crumbs button').first()).toHaveText('‹ Search');
    await page.evaluate(id => {
      S.quests = S.quests.filter(q => q.id !== id);
      inBackground(renderAll);
    }, a);
    // (its page has gone from under it: the board)
    await expect(page.locator('#v-projects')).toBeVisible();
    await expect(page.locator(card(a))).toHaveCount(0);
    await openProject(page, b);
    await expect(page.locator('#v-today .crumbs button').first()).toHaveText('‹ Projects');
    await page.evaluate(() => history.back());
    await expect(page.locator('#v-projects')).toBeVisible();
    expect(await page.evaluate(() => view)).toBe('projects');
    await expect(page.locator('#v-search')).toBeHidden();
  });

  test('a summary written in the one-line box keeps its lines once left', async ({ app, page }) => {
    await day(app, page);
    // A summary written in the one-line box: three lines once left.
    const id = await page.evaluate(() => S.quests.find(q => !q.summary).id);
    await openProject(page, id);
    expect(await page.$eval('#fsum', e => e.rows)).toBe(1);
    await page.fill('#fsum', 'Waiting on the planning team\nthen the board signs it off');
    await page.locator('#fsum').blur();
    expect(await page.$eval('#fsum', e => e.rows)).toBe(3);
  });
});
