// Phase 3: rules you can read, start from, and preview without side effects; help that can be
// dismissed.
const { test, expect } = require('./fixtures');

test('rule templates make a rule in two taps; the editor says when it can run; the preview makes nothing', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    const now = Date.now();
    S.flows = [{ id: 'f1', name: 'Export', url: 'ms-powerautomate:/x' }];
    S.execs = [
      {
        id: 'x1',
        flow: 'f1',
        q: '',
        at: now - 3600e3,
        status: 'failed',
        msg: 'Timeout',
        upd: now - 3000e3,
        ref: '',
        ev: [],
      },
      {
        id: 'x2',
        flow: 'f1',
        q: '',
        at: now - 7200e3,
        status: 'failed',
        msg: 'Login',
        upd: now - 7000e3,
        ref: '',
        ev: [],
      },
    ];
    S.workflows = [
      {
        id: 'w1',
        name: 'Report',
        ver: 1,
        days: [],
        monthDay: 0,
        stages: [{ id: 's1', type: 'manual', title: 'A' }],
      },
    ];
    save();
  });
  await app.go('account');
  await page.click('[data-rulenew]');
  await expect(page.locator('#sheet .qact b')).toHaveText([
    'When a process fails, add an Inbox item',
    'When an automation fails, flag it in the Inbox',
    'When a reply arrives, add the next step to the Inbox',
    'When a recurring process is due, add a task for it to Today',
    'When a chase date comes, add a reminder to the Inbox',
    'From scratch',
  ]);
  await page.click('[data-ruletpl="1"]');
  await expect(page.locator('#rlname')).toHaveValue('When an automation fails, flag it in the Inbox');
  await expect(page.locator('#rlon')).toHaveValue('exec_failed');
  await expect(page.locator('.rlwhen')).toContainText('not in the background');
  await expect(page.locator('.rlprev')).toHaveText(
    'When a desktop automation reports a failure, add an inbox item: “Check {name}: {err}”. In the last 30 days this would have fired 2 times.',
  );
  // The preview reads the records and creates nothing.
  const before = await page.evaluate(() => JSON.stringify(canon({ ...S, editedAt: 0 })));
  await page.click('[data-rulepreview]');
  await expect(page.locator('#rldry')).toContainText('would have fired 2 times, making for example:');
  await expect(page.locator('#rldry li').first()).toContainText('an Inbox item: “Check Export: ');
  await expect(page.locator('#rldry')).toContainText('Nothing was made now');
  expect(await page.evaluate(() => JSON.stringify(canon({ ...S, editedAt: 0 })))).toBe(before);
  expect((await app.state()).inbox).toHaveLength(0);
  // Switching the trigger changes the "when it can run" line; a day rule says it checks on opening.
  await page.selectOption('#rlon', 'day');
  await expect(page.locator('.rlwhen')).toContainText(
    'Checks when the app is first opened on the chosen days',
  );
  await page.click('[data-rlday="4"]');
  await page.click('[data-rulepreview]');
  await expect(page.locator('#rldry')).toContainText('On Thu, when the app is first opened that day');
  await page.selectOption('#rlon', 'exec_failed');
  await page.click('#sheetok');
  await expect(page.locator('#sheet')).toHaveCount(0);
  // The list: trigger, action, when it runs, enabled, last run.
  const row = page.locator('#v-account .rulerow').first();
  await expect(row).toContainText('When a desktop automation reports a failure, add an inbox item');
  await expect(row).toContainText('Runs when the automation’s report reaches the app');
  await expect(row).toContainText('Has not run yet');
  await expect(row.locator('[data-ruleon]')).toHaveText('On');
  // It fires once on the next failure, and the row says so.
  await page.evaluate(() => {
    foldExecEvent({
      id: 9,
      execution: 'x1',
      flow: 'f1',
      status: 'failed',
      message: 'Again',
      reported_at: new Date().toISOString(),
    });
    save();
    renderAccount();
  });
  expect((await app.state()).inbox.map(i => i.text)).toEqual(['Check Export: Again']);
  await expect(row).toContainText('Last ran Today');
  await expect(row).toContainText('ok');
  await page.click('[data-ruleon]');
  await expect(row).toContainText('off');
  expect(app.errors).toEqual([]);
});

test('help lines appear where they help, dismiss, and stay dismissed on this device', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.quests = [fix({ id: 'q1', text: 'No estimate' })];
    save();
  });
  await app.go('review');
  await page.click('[data-rsub="forecast"]');
  await expect(page.locator('.hintbox[data-hint="fcest"]')).toContainText(
    'Tasks without an estimate aren’t counted',
  );
  await page.click('[data-hintoff="fcest"]');
  await expect(page.locator('.hintbox[data-hint="fcest"]')).toHaveCount(0);
  await page.reload();
  await app.go('review');
  await page.click('[data-rsub="forecast"]');
  await expect(page.locator('.hintbox[data-hint="fcest"]')).toHaveCount(0);
  await app.processes();
  await page.click('[data-newproc]');
  await page.click('#sheet [data-wfnew]');
  await expect(page.locator('.hintbox[data-hint="proc"]')).toContainText('Write the steps as a checklist');
  await page.fill('#wfname', 'X');
  await page.click('[data-hintoff="proc"]');
  await expect(page.locator('#wfname')).toHaveValue('X'); // (dismissing a tip keeps what's typed)
  await page.evaluate(() => inBackground(renderAll));
  await expect(page.locator('.hintbox[data-hint="proc"]')).toHaveCount(0);
  await expect(page.locator('#wfname')).toHaveValue('X');
  expect(app.errors).toEqual([]);
});
