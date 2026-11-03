// Release B: actionable Knowledge: procedure steps in an article, and runs through them.
const { test, expect } = require('./fixtures');

const seed = () => {
  S.kbcats = [{ id: 'c1', name: 'Finance', parent: '' }];
  S.kb = [
    { id: 'a1', cat: 'c1', title: 'Weekly report', body: 'How the report is made.', edited: 1, imgs: [] },
    { id: 'a2', cat: 'c1', title: 'Ledger checks', body: 'Compare totals.', edited: 1, imgs: [] },
  ];
  S.flows = [{ id: 'f1', name: 'Run report', url: 'ms-powerautomate:/console/flow/run?x=1', last: 0 }];
  S.quests = [fix({ id: 'q1', text: 'Weekly reporting', links: [{ id: 'l1', kind: 'kb', ref: 'a1' }] })];
  save();
  renderAll();
};

test.beforeEach(async ({ app, page }) => {
  await app.open();
  await page.evaluate(seed);
});

test('steps are added, edited, reordered and removed in the editor; the article reads as before', async ({
  app,
  page,
}) => {
  await app.go('knowledge');
  await page.click('[data-kbcat="c1"]');
  await page.click('[data-kbart="a1"]');
  await expect(page.locator('#v-knowledge .pshead')).toHaveCount(0); // (a plain article)
  await page.click('[data-kbedit="a1"]');
  await expect(page.locator('#psteps')).toContainText('No steps');
  const add = async (title, extra) => {
    await page.click('#pstepadd');
    await expect(page.locator('#pstitle')).toBeFocused();
    await page.fill('#pstitle', title);
    if (extra) await extra();
    await page.click('#sheet #sheetok');
  };
  await add('Pull the extract', async () => {
    await page.fill('#pstext', 'Portal > Finance');
    await page.fill('#psurl', 'reports.example.com/weekly');
  });
  await add('Run the flow', async () => page.selectOption('#psflow', 'f1'));
  await add('Check totals', async () => {
    await page.selectOption('#pskb', 'a2');
    await page.check('#psverify');
  });
  await expect(page.locator('#psteps .editlist li')).toHaveCount(3);
  // A bad web link is refused, the step not added.
  await page.click('#pstepadd');
  await page.fill('#pstitle', 'Bad');
  await page.fill('#psurl', 'javascript:alert(1)');
  await page.click('#sheet #sheetok');
  await expect(page.locator('#toast')).toContainText('Enter a web address');
  await page.keyboard.press('Escape');
  // Reorder: Check totals up; edit the first; remove the flow step and put it back.
  await page.click('[data-pup] >> nth=-1');
  await page.click('[data-pstep] >> nth=0');
  await expect(page.locator('#pstitle')).toHaveValue('Pull the extract');
  await page.fill('#pstitle', 'Pull the SSRS extract');
  await page.click('#sheet #sheetok');
  expect(await page.$$eval('#psteps .pjump', b => b.map(x => x.firstChild.textContent.trim()))).toEqual([
    'Pull the SSRS extract',
    'Check totals',
    'Run the flow',
  ]);
  await page.click('[data-pdel] >> nth=-1');
  await expect(page.locator('#psteps .editlist li')).toHaveCount(2);
  await page.click('#kbform .btn.green');
  const a = (await app.state()).kb[0];
  expect(a.steps.map(s => s.title)).toEqual(['Pull the SSRS extract', 'Check totals']);
  expect(a.steps[0]).toMatchObject({ text: 'Portal > Finance', url: 'https://reports.example.com/weekly' });
  expect(a.steps[1]).toMatchObject({ kb: 'a2', verify: true });
  expect(a.steps[0].flow).toBeUndefined();
  // Reading: the body as before, then the steps with their actions and a Start button.
  await expect(page.locator('#v-knowledge .kbtext')).toHaveText('How the report is made.');
  await expect(page.locator('#v-knowledge .plist li')).toHaveCount(2);
  await expect(page.locator('#v-knowledge .plist li').nth(0).locator('a')).toHaveAttribute(
    'href',
    'https://reports.example.com/weekly',
  );
  await expect(page.locator('#v-knowledge [data-runstart="a1"]')).toHaveText('Start');
  // Removing every step makes it a plain article again (no empty steps list kept).
  await page.click('[data-kbedit="a1"]');
  await page.click('[data-pdel] >> nth=0');
  await page.click('[data-pdel] >> nth=0');
  await page.click('#kbform .btn.green');
  expect((await app.state()).kb[0].steps).toBeUndefined();
  await expect(page.locator('#v-knowledge .pshead')).toHaveCount(0);
});

test('a run goes step by step; a flow step runs only when tapped and is never ticked by it; resume and start afresh', async ({
  app,
  page,
}) => {
  await app.setState(s => {
    s.kb[0].steps = [
      { id: 'p1', title: 'Pull the extract', text: 'From the portal' },
      { id: 'p2', title: 'Run the flow', flow: 'f1' },
      { id: 'p3', title: 'Check totals', kb: 'a2', verify: true },
    ];
  });
  await page.reload();
  await page.evaluate(() => {
    kbArt = 'a1';
    go('knowledge');
  });
  await page.click('[data-runstart="a1"]');
  const card = page.locator('#v-knowledge .pstep');
  await expect(card.locator('h3')).toHaveText('Pull the extract');
  await expect(page.locator('#v-knowledge .runprog')).toHaveText('Step 1 of 3');
  await expect(card.locator('[data-runprev]')).toBeDisabled();
  let s = await app.state();
  expect(s.runs).toHaveLength(1);
  expect(s.runs[0]).toMatchObject({ art: 'a1', q: '', done: [], fin: 0 });
  await card.locator('[data-rundone]').click();
  await expect(card.locator('h3')).toHaveText('Run the flow');
  // The flow's button is a plain link to the flow (nothing ran, nothing ticked).
  const run = card.locator('a[data-flow="f1"]');
  await expect(run).toHaveAttribute('href', 'ms-powerautomate:/console/flow/run?x=1');
  await run.click();
  await expect(card.locator('h3')).toHaveText('Run the flow');
  s = await app.state();
  expect(s.runs[0].done).toEqual(['p1']);
  expect(s.flows[0].last).toBeGreaterThan(0); // (the tap was remembered, as on Today)
  await card.locator('[data-rundone]').click();
  await expect(card.locator('h3')).toHaveText('Check totals');
  await expect(card.locator('.pverify')).toBeVisible();
  await expect(card.locator('[data-rundone]')).toHaveText('Verified, next');
  await expect(card.locator('[data-sart="a2"]')).toBeVisible();
  // Back one step, then jump ahead from the list.
  await card.locator('[data-runprev]').click();
  await expect(card.locator('h3')).toHaveText('Run the flow');
  expect((await app.state()).runs[0].done).toEqual(['p1']);
  await page.click('#v-knowledge .runlist [data-runjump][data-step="p3"]');
  await expect(card.locator('h3')).toHaveText('Check totals');
  // Leave and come back: Resume picks the same run up where it was.
  await app.go('today');
  await page.evaluate(() => {
    kbArt = 'a1';
    kbRun = null;
    go('knowledge');
  });
  await expect(page.locator('[data-runstart="a1"]')).toHaveText('Resume');
  await expect(page.locator('#v-knowledge .hint', { hasText: 'Unfinished' })).toContainText('1 of 3 steps');
  await page.click('[data-runstart="a1"]');
  await expect(card.locator('h3')).toHaveText('Check totals');
  expect((await app.state()).runs).toHaveLength(1);
  await card.locator('[data-rundone]').click(); // (p3 verified; p2 still open)
  await expect(card.locator('h3')).toHaveText('Run the flow');
  await card.locator('[data-rundone]').click();
  await expect(page.locator('#v-knowledge .pstep.done')).toContainText('Every step is done');
  await page.click('[data-runfinish]');
  s = await app.state();
  expect(s.runs[0].fin).toBeGreaterThan(0);
  expect(s.runs[0].done.sort()).toEqual(['p1', 'p2', 'p3']);
  // Starting again: a fresh run, the old one listed under previous runs.
  await page.click('[data-runback]');
  await expect(page.locator('[data-runstart="a1"]')).toHaveText('Start');
  await page.click('#prund summary');
  await expect(page.locator('#prund .flist li')).toHaveCount(1);
  await page.click('[data-runstart="a1"]');
  await expect(card.locator('h3')).toHaveText('Pull the extract');
  s = await app.state();
  expect(s.runs).toHaveLength(2);
  expect(s.runs.find(r => !r.fin).done).toEqual([]);
  // Start afresh leaves the unfinished run behind and begins another.
  await card.locator('[data-rundone]').click();
  await page.click('[data-runfresh]');
  await expect(card.locator('h3')).toHaveText('Pull the extract');
  s = await app.state();
  expect(s.runs.filter(r => !r.fin)).toHaveLength(1);
  expect(s.runs).toHaveLength(3);
  // Android back from a run goes to the article.
  await page.goBack();
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Weekly report');
  await expect(page.locator('#v-knowledge .pstep')).toHaveCount(0);
});

test('a task’s linked procedure: start from the task, progress on the task, back to the task; the task is never finished for it', async ({
  app,
  page,
}) => {
  await app.setState(s => {
    s.kb[0].steps = [
      { id: 'p1', title: 'One' },
      { id: 'p2', title: 'Two' },
    ];
  });
  await page.reload();
  await app.openQuest('Weekly reporting');
  const row = page.locator('#resd .resrow');
  await expect(row.locator('small').first()).toHaveText('Guide');
  await expect(row.locator('.procline')).toContainText('Not started');
  await page.click('#resd [data-runstart="a1"]');
  await expect(page.locator('#v-knowledge .kbtrail')).toContainText('For: Weekly reporting');
  await page.click('#v-knowledge [data-rundone]');
  let s = await app.state();
  expect(s.runs[0]).toMatchObject({ q: 'q1', done: ['p1'] });
  await page.click('#v-knowledge .kbtrail [data-open="q1"]');
  await expect(page.locator('#v-today h1')).toHaveText('Weekly reporting');
  await expect(row.locator('.procline')).toContainText('1 of 2 steps');
  await expect(row.locator('[data-runstart]')).toHaveText('Resume');
  // A run on its own (no task) is separate from the task's. (Knowledge still shows the run
  // left open; the article is a step back.)
  await page.evaluate(() => {
    kbArt = 'a1';
    kbRun = null;
    go('knowledge');
  });
  await page.click('#v-knowledge [data-runstart="a1"]');
  s = await app.state();
  expect(s.runs).toHaveLength(2);
  expect(s.runs.map(r => r.q).sort()).toEqual(['', 'q1']);
  await page.click('[data-runback]');
  // Finish the task's run: the task stays open, its row says done. (Today still shows the
  // task's page, as left: back to the list first.)
  await app.go('today');
  await page.evaluate(() => openPath([]));
  await app.openQuest('Weekly reporting');
  await page.click('#resd [data-runstart="a1"]');
  await page.click('#v-knowledge [data-rundone]');
  await page.click('[data-runfinish]');
  await expect(page.locator('#v-knowledge .pstep.done [data-open="q1"]')).toHaveText('Back to the task');
  await page.click('#v-knowledge .pstep.done [data-open="q1"]');
  s = await app.state();
  expect(s.quests[0].done).toBe(false);
  await expect(row.locator('.procline')).toContainText('Done Today');
  await expect(row.locator('[data-runstart]')).toHaveText('Start');
  // A deleted linked article: the step's action says so; the run view falls back gracefully.
  await page.evaluate(() => {
    S.kb = S.kb.filter(a => a.id !== 'a1');
    save();
    renderAll();
  });
  await expect(row).toContainText('Removed from Knowledge');
  await page.evaluate(() => {
    kbRun = S.runs[0].id;
    go('knowledge');
  });
  await expect(page.locator('#v-knowledge .kbtabs')).toBeVisible();
  expect(await page.evaluate(() => kbRun)).toBeNull();
});

test('steps from a synced row or backup are checked; junk never reaches the page; runs are pruned', async ({
  app,
  page,
}) => {
  await app.setState(s => {
    s.kb[0].steps = [
      { id: 'ok', title: 'Fine', url: 'https://x.example.com/', kb: 'a2' },
      { id: 'js', title: 'Bad link', url: 'javascript:alert(1)' },
      { id: 'bad id!', title: 'Bad id' },
      { id: 'ok', title: 'Duplicate id' },
      { id: 'notitle', title: '   ' },
      { id: 'long', title: 'x'.repeat(200), text: 'y'.repeat(2000), flow: 'f1', verify: 'yes' },
      'junk',
    ];
    const old = Date.now() - 100 * 864e5;
    s.runs = [
      { id: 'r-old', art: 'a1', q: '', started: old, at: old, done: [], cur: '', fin: old },
      { id: 'r-stale', art: 'a1', q: '', started: old, at: old, done: ['ok'], cur: '', fin: 0 },
      {
        id: 'r-ok',
        art: 'a1',
        q: '',
        started: Date.now(),
        at: Date.now(),
        done: ['ok', 'ok', 'nope'],
        cur: 'zz z',
        fin: 0,
      },
      { id: 'r-bad', art: 'missing id?', started: 'x' },
      ...Array.from({ length: 14 }, (_, i) => ({
        id: 'r-fin' + i,
        art: 'a1',
        q: '',
        started: Date.now() - i * 1000,
        at: Date.now(),
        done: [],
        cur: '',
        fin: Date.now() - i * 1000,
      })),
    ];
  });
  await page.reload();
  const s = await app.state();
  expect(s.kb[0].steps.map(x => x.id)).toEqual(['ok', 'js', 'long']);
  expect(s.kb[0].steps[1].url).toBeUndefined();
  expect(s.kb[0].steps[2]).toEqual({
    id: 'long',
    title: 'x'.repeat(120),
    text: 'y'.repeat(1000),
    flow: 'f1',
    verify: true,
  });
  expect(s.runs.find(r => r.id === 'r-ok')).toMatchObject({ done: ['ok', 'nope'], cur: '' });
  expect(s.runs.some(r => r.id === 'r-old' || r.id === 'r-stale' || r.id === 'r-bad')).toBe(false);
  expect(s.runs.filter(r => r.fin)).toHaveLength(10); // (the newest ten finished runs per article)
  await page.evaluate(() => {
    kbArt = 'a1';
    go('knowledge');
  });
  expect(
    await page.evaluate(() => document.querySelectorAll('#v-knowledge a[href^="javascript"]').length),
  ).toBe(0);
});

test('review fixes: an article opened from a run shows the article and its ‹ returns to the run; a task-less run shows only its own launches', async ({
  app,
  page,
}) => {
  await app.setState(s => {
    s.kb[0].steps = [
      { id: 'p1', title: 'Read the checks', kb: 'a2' },
      { id: 'p2', title: 'Run', flow: 'f1' },
    ];
    s.track = true;
    s.execs = [
      {
        id: 'e-q',
        flow: 'f1',
        q: 'q1',
        at: Date.now() - 1000,
        status: 'succeeded',
        msg: 'from the task',
        upd: Date.now() - 1000,
        ref: '',
        ev: [],
      },
    ];
  });
  await page.reload();
  await page.evaluate(() => {
    kbArt = 'a1';
    go('knowledge');
  });
  await page.click('[data-runstart="a1"]');
  await page.click('#v-knowledge .pstep [data-sart="a2"]');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Ledger checks');
  await expect(page.locator('#v-knowledge [data-kbback]')).toHaveText('‹ Back to the guide');
  await page.click('#v-knowledge [data-kbback]');
  await expect(page.locator('#v-knowledge .pstep h3')).toHaveText('Read the checks');
  // The run has no quest: the task's execution of the same flow isn't shown as its own.
  await page.click('#v-knowledge [data-rundone]');
  await expect(page.locator('#v-knowledge .pstep h3')).toHaveText('Run');
  await expect(page.locator('#v-knowledge .pstep .xline')).toHaveCount(0);
  await page.click('#v-knowledge .pstep a[data-flow="f1"]');
  await expect(page.locator('#v-knowledge .pstep .xline')).toContainText('Launched, no word yet');
});
