// Phase 2: one vocabulary, Knowledge in two views, one way to make new things, checklist-first
// processes, a process's overview before its editor.
const { test, expect } = require('./fixtures');

const seed = () => {
  S.track = true;
  S.flows = [{ id: 'f1', name: 'Export report', url: 'ms-powerautomate:/x' }];
  S.kbcats = [{ id: 'c1', name: 'Finance', parent: '' }];
  S.kb = [
    {
      id: 'a1',
      cat: 'c1',
      title: 'Month-end guide',
      body: 'How.',
      edited: 1,
      imgs: [],
      steps: [
        { id: 'p1', title: 'Pull' },
        { id: 'p2', title: 'Check' },
      ],
    },
    { id: 'a2', cat: 'c1', title: 'Expense policy', body: 'Claims within 30 days.', edited: 1, imgs: [] },
  ];
  S.quests = [fix({ id: 'q1', text: 'Weekly reporting' })];
  save();
  renderAll();
};

test('Knowledge: Reference and Processes views; the "+ New" sheet opens the editor that fits; tasks still go through the Inbox', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await app.go('knowledge');
  await expect(page.locator('.kbtabs [data-kbview="ref"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#kbq')).toHaveAttribute('placeholder', 'Search reference articles');
  await expect(page.locator('#kbtree .tile')).toHaveText(['Finance 2']);
  await page.click('[data-kbview="proc"]');
  const v = page.locator('#v-knowledge');
  await expect(v).toContainText('Processes');
  await expect(v).toContainText('A process is a checklist you can run again');
  await expect(v.locator('.kbsec').nth(1)).toContainText('Guides');
  await expect(v.locator('[data-runstart="a1"]')).toHaveText('Follow');
  await expect(v).toContainText('Desktop automations');
  // The sheet: four answers, in the user's words.
  await page.click('[data-newsheet]');
  await expect(page.locator('#sheet .qact b')).toHaveText([
    'Finish something',
    'Do something again and again',
    'Keep information',
    'Launch a desktop automation',
  ]);
  await page.click('[data-newkind="task"]');
  await expect(page.locator('#v-inbox')).toBeVisible();
  await expect(page.locator('#iin')).toBeFocused();
  expect((await app.state()).quests).toHaveLength(1); // (nothing made on Today)
  await app.go('knowledge');
  await page.click('[data-newsheet]');
  await page.click('[data-newkind="article"]');
  await expect(page.locator('#kbform h2, #v-knowledge h2').first()).toHaveText('New article');
  await page.click('[data-kbcancel]');
  await page.click('[data-kbview="proc"]');
  await page.click('[data-newguide]');
  await expect(page.locator('#v-knowledge h2').first()).toHaveText('New guide');
  await page.click('[data-kbcancel]');
  await page.click('[data-newsheet]');
  await page.click('[data-newkind="flow"]');
  await expect(page.locator('#flowname')).toBeFocused();
  // A guide's row opens the article; its back link names the view it returns to.
  await page.click('[data-kbview="proc"]');
  await page.click('[data-kbart="a1"]');
  await expect(page.locator('[data-kbback]')).toHaveText('‹ Processes');
  await page.click('[data-kbback]');
  await expect(page.locator('[data-kbview="proc"]')).toHaveAttribute('aria-pressed', 'true');
  expect(app.errors).toEqual([]);
});

test('Journey B: a repeatable process written as a checklist, one step made smarter, a Thursday repeat, started from its overview', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await app.processes();
  await page.click('[data-newproc]');
  await expect(page.locator('#sheet .qact b')).toHaveText([
    'Simple checklist',
    'Weekly report',
    'Approval process',
    'Automation with a check',
    'Month-end process',
    'From scratch',
  ]);
  await page.click('[data-wftplpick="1"]');
  await expect(page.locator('#sheettitle')).toHaveText('Weekly report');
  await expect(page.locator('.tplprev li')).toHaveCount(4);
  await page.click('[data-wftplback]');
  await page.click('#sheet [data-wfnew]');
  await expect(page.locator('#sheet')).toHaveCount(0);
  await expect(page.locator('#wfname')).toBeFocused();
  await page.fill('#wfname', 'Weekly reporting');
  // Steps as typed: Enter adds one, each a plain step.
  for (const t of ['Download the report', 'Check the figures', 'Rename the file', 'Send it']) {
    await page.fill('#wfstepin', t);
    await page.keyboard.press('Enter');
  }
  await expect(page.locator('#wfstages li')).toHaveCount(4);
  // One step made smarter: it launches the automation.
  await page.click('#wfstages [data-wfstage] >> nth=0');
  await expect(page.locator('#wskindhint')).toHaveText('You do it, then mark it done.');
  await page.selectOption('#wstype', 'flow');
  await expect(page.locator('#wskindhint')).toContainText('Launches a desktop automation');
  await page.click('#sheetok');
  await expect(page.locator('#toast')).toContainText('Choose the desktop automation to launch');
  await page.selectOption('#wsflow', 'f1');
  await page.click('#sheetok');
  await expect(page.locator('#wfstages li').first()).toContainText('Run a desktop automation');
  // A check step added with options.
  await page.click('#wfstageadd');
  await page.fill('#wstitle', 'Check the output');
  await page.selectOption('#wstype', 'verify');
  await page.fill('#wschecks', 'Right week\nAll regions');
  await page.click('#sheetok');
  await expect(page.locator('#wfstages li')).toHaveCount(5);
  await page.click('#wfrep summary');
  await page.click('[data-wfday="4"]');
  await expect(page.locator('#wfname')).toHaveValue('Weekly reporting');
  await page.click('#wfform .btn.green');
  // Saved: its overview, with Start to hand; the definition is as written.
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Weekly reporting');
  await expect(page.locator('.wfstate')).toContainText('Not started');
  const w = (await app.state()).workflows[0];
  expect(w.stages.map(s => [s.type, s.title])).toEqual([
    ['flow', 'Download the report'],
    ['manual', 'Check the figures'],
    ['manual', 'Rename the file'],
    ['manual', 'Send it'],
    ['verify', 'Check the output'],
  ]);
  expect(w.days).toEqual([4]);
  await page.click('.wfstate [data-wfstart]');
  await expect(page.locator('#v-knowledge .pstep h3')).toHaveText('Download the report');
  await expect(page.locator('.pstep')).toContainText(
    'Launch the automation; this step completes when its result is reported.',
  );
  // Back from the run returns to where it was started: the process's overview.
  await expect(page.locator('[data-wfback]')).toHaveText('‹ Weekly reporting');
  await page.click('[data-wfback]');
  await expect(page.locator('.wfstate')).toContainText('Your turn');
  await page.click('[data-wfback2]');
  await expect(page.locator('#wfhead')).toHaveText('In progress 1');
  await page.click('[data-wfview]');
  await expect(page.locator('.wfstate .btn')).toHaveText('Continue');
  await page.click('[data-wfedit]');
  await expect(page.locator('#v-knowledge h2').first()).toHaveText('Edit process');
  await page.click('[data-wfcancel]');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Weekly reporting');
  expect(app.errors).toEqual([]);
});

test('the run page says what each step does and what moving on means; buttons say what they do', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await page.evaluate(() => {
    S.workflows = [
      {
        id: 'w1',
        name: 'Checks',
        ver: 1,
        days: [],
        monthDay: 0,
        stages: [
          { id: 's1', type: 'manual', title: 'Prepare' },
          { id: 's2', type: 'verify', title: 'Check', checks: ['A'] },
          { id: 's3', type: 'wait', title: 'Sign-off', who: 'Sam' },
          { id: 's4', type: 'decide', title: 'Outcome', choices: [{ label: 'Go', next: '' }] },
        ],
      },
    ];
    save();
  });
  await app.processes();
  await page.click('[data-wfstart="w1"]');
  await expect(page.locator('.pstep .pnext')).toHaveText(
    'Marking it done moves the process to the next step.',
  );
  await expect(page.locator('[data-wfact="done"]')).toHaveText('Mark done');
  await expect(page.locator('[data-wfact="fail"]')).toHaveText('Report a problem');
  await page.click('[data-wfact="done"]');
  await expect(page.locator('.pstep .pnext')).toContainText('Tick every check');
  await expect(page.locator('[data-wfact="fail"]')).toHaveText('Check failed');
  await page.check('.wchecks input');
  await expect(page.locator('.pstep .pnext')).toContainText('Verified moves the process on');
  await page.click('[data-wfact="done"]');
  await expect(page.locator('.pstep .pnext')).toContainText('Start waiting makes a waiting item');
  await page.click('[data-wfact="waititem"]');
  await expect(page.locator('[data-wfact="received"]')).toHaveText('Mark reply received');
  await page.click('[data-wfact="received"]');
  await expect(page.locator('.pstep .pnext')).toHaveText('Your choice decides which step comes next.');
  await page.click('[data-wfact="pick"]');
  await expect(page.locator('#v-knowledge')).toContainText('Completed');
  expect(app.errors).toEqual([]);
});
