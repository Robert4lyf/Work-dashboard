// Phases 2 and 3: the journeys the overhaul is for, end to end, with the taps counted.
const { test, expect } = require('./fixtures');

// A tap counter: every click or Enter the journey makes, so the count is measured, not guessed.
const tapper = page => {
  let n = 0;
  return {
    click: async sel => {
      n++;
      await page.click(sel);
    },
    enter: async () => {
      n++;
      await page.keyboard.press('Enter');
    },
    taps: () => n,
  };
};

test('Journey A: capture a task, process it, move it to Today, add a step, finish it: still quick, no process interface in the way', async ({
  app,
  page,
}) => {
  await app.open();
  const t = tapper(page);
  await t.click('nav [data-v=inbox]');
  await page.fill('#iin', 'Call the landlord');
  await t.enter();
  expect((await app.state()).inbox.map(i => i.text)).toEqual(['Call the landlord']);
  await t.click('[data-triagestart]');
  await t.click('[data-tdo="today"]');
  expect((await app.state()).quests.map(q => q.text)).toEqual(['Call the landlord']);
  await t.click('nav [data-v=today]');
  await t.click('#v-today .open');
  await page.fill('#sin', 'Find the number');
  await t.enter();
  expect((await app.state()).quests[0].children.map(c => c.text)).toEqual(['Find the number']);
  await t.click('[data-toggle]');
  await t.click('#sheet [data-sheetans="finish"]');
  const s = await app.state();
  expect(s.quests[0].done).toBe(true);
  expect(s.log.map(l => l.text)).toContain('Call the landlord');
  expect(t.taps()).toBeLessThanOrEqual(10);
  expect(app.errors).toEqual([]);
});

test('Journey C: find a process in Knowledge, see its purpose and state, start it, follow the current step', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.workflows = [
      {
        id: 'w1',
        name: 'Supplier onboarding',
        desc: 'Everything a new supplier needs before the first order.',
        ver: 1,
        days: [],
        monthDay: 0,
        stages: [
          { id: 's1', type: 'manual', title: 'Collect the forms' },
          { id: 's2', type: 'manual', title: 'Check the bank details' },
        ],
      },
    ];
    save();
  });
  const t = tapper(page);
  await t.click('nav [data-v=knowledge]');
  await t.click('[data-kbview="proc"]');
  await t.click('[data-wfview="w1"]');
  await expect(page.locator('.kbdesc')).toHaveText('Everything a new supplier needs before the first order.');
  await expect(page.locator('.wfstate')).toContainText('Not started');
  await expect(page.locator('#wfform')).toHaveCount(0); // (the overview, not the editor)
  await t.click('.wfstate [data-wfstart]');
  await expect(page.locator('.pstep h3')).toHaveText('Collect the forms');
  await t.click('[data-wfact="done"]');
  await expect(page.locator('.pstep h3')).toHaveText('Check the bank details');
  expect(t.taps()).toBe(5);
  // Found by search too, with what it is and what tapping does.
  await page.evaluate(() => openSearch());
  await page.fill('#sq', 'supplier');
  await expect(page.locator('#sres [data-wfview="w1"]')).toContainText('Process · continue');
  expect(app.errors).toEqual([]);
});

test('Journey D: a guide from a reference article: follow some steps, leave, come back and resume, finish', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.kbcats = [{ id: 'c1', name: 'IT', parent: '' }];
    S.kb = [
      {
        id: 'a1',
        cat: 'c1',
        title: 'Set up a laptop',
        body: 'For a new starter.',
        edited: 1,
        imgs: [],
        steps: [
          { id: 'p1', title: 'Join it to the domain' },
          { id: 'p2', title: 'Install the apps' },
          { id: 'p3', title: 'Hand it over' },
        ],
      },
    ];
    save();
  });
  await app.go('knowledge');
  await page.click('[data-kbcat="c1"]');
  await page.click('[data-kbart="a1"]');
  await expect(page.locator('.pshead h2')).toContainText('Guide');
  await page.click('[data-runstart="a1"]');
  await page.click('[data-rundone]');
  await expect(page.locator('.pstep h3')).toHaveText('Install the apps');
  // Leaving the app and coming back: the run is where it was; Processes offers to continue it.
  await page.reload();
  await app.processes();
  await expect(page.locator('#wfhead')).toHaveText('In progress 1');
  await expect(page.locator('[data-runopen]').first()).toContainText('Set up a laptop');
  await page.click('[data-runopen] >> nth=1');
  await expect(page.locator('.pstep h3')).toHaveText('Install the apps');
  await page.click('[data-rundone]');
  await page.click('[data-rundone]');
  await page.click('[data-runfinish]');
  await expect(page.locator('#toast')).toContainText('Guide finished');
  const s = await app.state();
  expect(s.runs[0].fin).toBeGreaterThan(0);
  expect(s.wruns).toHaveLength(0); // (a guide is not a process run)
  expect(app.errors).toEqual([]);
});

test('Journey H: resume after an interruption: Today shows where work stopped, the task opens, its linked guide is a tap away', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.kb = [
      {
        id: 'a1',
        cat: '',
        title: 'Board pack guide',
        body: '',
        edited: 1,
        imgs: [],
        steps: [{ id: 'p1', title: 'Collect' }],
      },
    ];
    S.quests = [
      fix({
        id: 'q1',
        text: 'Board pack',
        children: [fix({ id: 's1', text: 'Draft' }), fix({ id: 's2', text: 'Review' })],
        resume: { note: 'Totals checked to row 40; next the notes', at: Date.now() - 3600e3, step: 's1' },
        links: [{ id: 'l1', kind: 'kb', ref: 'a1', label: '' }],
      }),
      fix({ id: 'q2', text: 'Other' }),
    ];
    save();
    renderAll();
  });
  await expect(page.locator('#hnow')).toContainText('Pick up where you left off');
  await page.click('#hnow .go');
  await expect(page.locator('#v-today h1')).toHaveText('Board pack');
  await expect(page.locator('.placebox')).toContainText('Totals checked to row 40');
  await page.evaluate(() => (document.querySelector('#resd').open = true));
  await expect(page.locator('#resd .open small').first()).toHaveText('Guide');
  await page.click('[data-sart="a1"]');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Board pack guide');
  await expect(page.locator('[data-kbback]')).toHaveText('‹ Back to the task');
  await page.click('[data-kbback]');
  await expect(page.locator('#v-today h1')).toHaveText('Board pack');
  expect(app.errors).toEqual([]);
});
