const { test, expect } = require('./fixtures');

async function addSection(page, name, colour) {
  await page.getByRole('button', { name: 'Add section' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add section' });
  await dialog.getByLabel('Section name').fill(name);
  await dialog.getByLabel('Accent colour').selectOption(colour);
  await dialog.getByRole('button', { name: 'Add section' }).click();
}

async function dragTo(page, handle, target) {
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await expect(target).toHaveClass(/project-drop-target/);
  await page.mouse.up();
}

test('sections accept project drops, can be reordered, and keep their accents and collapsed state', async ({
  app,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await start(app, page);
  await addSection(page, 'Urgent', 'red');
  await addSection(page, 'Tuesdays', 'teal');
  const urgent = page.getByRole('region', { name: 'Urgent', exact: true });
  const tuesdays = page.getByRole('region', { name: 'Tuesdays', exact: true });
  const uncategorised = page.getByRole('region', { name: 'Uncategorised', exact: true });
  const order = () => page.locator('.project-section-toggle span').allTextContents();
  expect(await order()).toEqual(['Urgent', 'Tuesdays', 'Uncategorised']);
  await dragTo(
    page,
    tuesdays.getByRole('button', { name: 'Reorder section Tuesdays' }),
    urgent.locator('.project-section-head'),
  );
  expect(await order()).toEqual(['Tuesdays', 'Urgent', 'Uncategorised']);
  await urgent.getByRole('button', { name: 'Urgent', exact: true }).click();
  await dragTo(
    page,
    uncategorised.getByRole('button', { name: 'Reorder Weekly reporting' }),
    urgent.locator('.project-section-head'),
  );
  await expect(urgent.getByRole('button', { name: 'Urgent', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.reload();
  expect(await order()).toEqual(['Tuesdays', 'Urgent', 'Uncategorised']);
  await expect(urgent.getByRole('button', { name: 'Urgent', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await urgent.getByRole('button', { name: 'Urgent', exact: true }).click();
  const report = urgent.getByRole('article', { name: 'Weekly reporting' });
  await expect(report).toBeVisible();
  await expect(report).toHaveCSS('border-left-color', 'rgb(209, 90, 98)');
  await expect(urgent.locator('.project-section-head')).toHaveCSS('background-color', 'rgb(209, 90, 98)');
  await urgent.getByRole('button', { name: 'Edit section Urgent' }).click();
  await page.getByLabel('Accent colour').selectOption('navy');
  await expect(page.locator('#project-section-swatch')).toHaveCSS('background-color', 'rgb(38, 66, 143)');
  await page.getByRole('button', { name: 'Save section' }).click();
  await expect(report).toHaveCSS('border-left-color', 'rgb(38, 66, 143)');
  await expect(urgent.getByRole('button', { name: 'Urgent', exact: true })).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  );
  await report.getByRole('button', { name: 'Reorder Weekly reporting' }).press('Enter');
  await page.getByRole('button', { name: 'Move to Tuesdays' }).press('Enter');
  await expect(tuesdays.getByRole('article', { name: 'Weekly reporting' })).toBeVisible();
  await tuesdays.getByRole('button', { name: 'Edit section Tuesdays' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete section' }).click();
  await page
    .getByRole('dialog', { name: 'Delete Tuesdays?' })
    .getByRole('button', { name: 'Delete section' })
    .click();
  await expect(tuesdays).toHaveCount(0);
  await expect(uncategorised.getByRole('article', { name: 'Weekly reporting' })).toBeVisible();
  expect(await order()).toEqual(['Urgent', 'Uncategorised']);
});

async function start(app, page) {
  await page.clock.install({ time: new Date(2026, 10, 18, 11, 0) });
  await app.open({ home: 'projects' });
  await app.setState(s => {
    const node = (id, text, extras = {}) => ({ id, text, children: [], ...extras });
    s.quests = [
      node('report', 'Weekly reporting', {
        children: [
          node('export', 'Export ledger'),
          node('match', 'Match balances'),
          node('review', 'Review variances'),
          node('send', 'Send report'),
        ],
      }),
      node('replies', 'Supplier replies', { wait: { who: 'Sam' } }),
      node('meeting', 'Team meeting', { scheduled: { date: s.day, time: '14:00' } }),
      node('read', 'Read the circular'),
      node('archive', 'Archive invoices', { done: true }),
    ];
    s.later = [node('next', 'Month end', { start: '2026-11-24' })];
  });
  await page.reload();
}

test('fresh open shows projects, with waiting, scheduled and upcoming work visible', async ({
  app,
  page,
}) => {
  await start(app, page);
  const projects = page.locator('#v-projects');
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await expect(page.locator('#v-today')).toBeHidden();
  await expect(projects.getByRole('article', { name: 'Supplier replies' })).toContainText('Waiting');
  const meeting = projects.getByRole('article', { name: 'Team meeting' });
  await expect(meeting).toContainText('Scheduled 14:00');
  await expect(meeting.locator('[data-toggle]')).toHaveCount(0);
  await page.clock.fastForward(3 * 60 * 60 * 1000 + 60_000);
  await expect(meeting.getByRole('button', { name: 'Mark done: Team meeting' })).toBeVisible();
  await expect(projects.getByRole('button', { name: 'Month end', exact: true })).toBeVisible();
  await expect(projects.getByText('Archive invoices')).toBeHidden();
  await expect(projects.getByText('Completed today')).toBeVisible();
  await page.evaluate(() => (location.hash = '#/today'));
  await expect(projects).toBeVisible();
  await expect(page.locator('#v-today')).toBeHidden();
});

test('tick and add steps on the card, preserving unfinished input during a redraw', async ({ app, page }) => {
  await start(app, page);
  const report = page.getByRole('article', { name: 'Weekly reporting' });
  await expect(report).toContainText('0 of 4 steps');
  await report.getByRole('button', { name: 'Mark done: Export ledger' }).click();
  await expect(report).toContainText('1 of 4 steps');
  await expect(report.getByText('Send report', { exact: true })).toBeVisible();

  await report.getByRole('button', { name: 'Add step to Weekly reporting' }).click();
  const input = report.getByRole('textbox', { name: 'New step' });
  await expect(input).toBeFocused();
  await input.fill('Prepare notes');
  await page.evaluate(() => {
    find('report').n.text = 'Weekly reporting (updated)';
    inBackground(renderAll);
  });
  const updated = page.getByRole('article', { name: 'Weekly reporting (updated)' });
  const updatedInput = updated.getByRole('textbox', { name: 'New step' });
  await expect(updatedInput).toHaveValue('Prepare notes');
  await expect(updatedInput).toBeFocused();
  await updatedInput.press('Enter');
  await expect(updated).toContainText('1 of 5 steps');
  await expect(updatedInput).toHaveValue('');
  await page.reload();
  expect((await app.state()).quests.find(q => q.id === 'report').children).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'export', done: true }),
      expect.objectContaining({ text: 'Prepare notes' }),
    ]),
  );
});

test('detail uses the existing task page and returns to Projects after reload and Android back', async ({
  app,
  page,
}) => {
  await start(app, page);
  const title = page.locator('#v-projects').getByRole('button', { name: 'Weekly reporting', exact: true });
  await title.click();
  await expect(page.locator('#v-today h1')).toHaveText('Weekly reporting');
  const back = page.getByRole('button', { name: '‹ Projects' });
  await expect(back).toBeVisible();
  await page.reload({ keepPlace: true });
  await back.click();
  await expect(title).toBeFocused();
  await title.click();
  await page.evaluate(() => history.back());
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
  await page.getByRole('button', { name: 'Month end', exact: true }).click();
  await expect(page.locator('#v-project-record h1')).toHaveText('Month end');
  await page.evaluate(() => history.back());
  const upcoming = page.getByRole('button', { name: 'Month end', exact: true });
  await expect(upcoming).toBeFocused();
  await upcoming.click();
  const record = page.locator('#v-project-record');
  await record.getByText('Edit project', { exact: true }).click();
  await record.getByRole('textbox', { name: 'Name', exact: true }).fill('Month-end review');
  await record.getByRole('textbox', { name: 'Name', exact: true }).press('Tab');
  await record.getByRole('textbox', { name: 'Notes' }).fill('Prepare the draft');
  await record.getByRole('textbox', { name: 'New step' }).fill('Check the figures');
  await record.getByRole('button', { name: 'Add step' }).click();
  await record.getByText('Check the figures', { exact: true }).click();
  await record
    .locator('details[open]')
    .getByRole('textbox', { name: 'Name', exact: true })
    .last()
    .fill('Check the final figures');
  await record
    .locator('details[open]')
    .getByRole('textbox', { name: 'Name', exact: true })
    .last()
    .press('Tab');
  expect((await app.state()).later[0]).toMatchObject({
    text: 'Month-end review',
    notes: 'Prepare the draft',
    children: [{ text: 'Check the final figures' }],
  });
  await record.getByLabel('Start date').fill('2026-11-27');
  await expect(record).toContainText('Starts 27 Nov');
  await record.getByRole('button', { name: 'Move to Projects now' }).click();
  await expect(page.locator('#v-today h1')).toHaveText('Month-end review');
  expect((await app.state()).later).toHaveLength(0);
});

test('project cards keep the same dimensions across rows when showing or editing steps', async ({
  app,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await start(app, page);
  const cards = page.locator('#v-projects .project-card:visible');
  const sidewaysOverflow = () =>
    cards
      .locator('.project-preview')
      .evaluateAll(previews => previews.map(preview => preview.scrollWidth - preview.clientWidth));
  const layout = () =>
    cards.evaluateAll(items =>
      items.map(card => {
        const { width, height, top } = card.getBoundingClientRect();
        const actions = card.querySelector('.project-actions').getBoundingClientRect();
        return { width, height, top, footerOffset: actions.bottom - top };
      }),
    );

  const initial = await layout();
  expect(await sidewaysOverflow()).toEqual(initial.map(() => 0));
  expect(new Set(initial.map(card => card.top)).size).toBeGreaterThan(1);
  for (const key of ['width', 'height', 'footerOffset']) {
    expect(new Set(initial.map(card => Math.round(card[key]))).size).toBe(1);
  }
  await page.getByRole('button', { name: 'Add step to Weekly reporting' }).click();
  await expect(page.getByRole('textbox', { name: 'New step' })).toBeFocused();
  expect((await layout()).map(({ height, top }) => [height, top])).toEqual(
    initial.map(({ height, top }) => [height, top]),
  );

  await page.setViewportSize({ width: 320, height: 800 });
  expect(await sidewaysOverflow()).toEqual(initial.map(() => 0));
  expect(new Set((await layout()).map(card => card.height)).size).toBeGreaterThan(1);
  expect(
    await cards.locator('.project-preview').evaluateAll(items =>
      items.map(el => {
        el.scrollTop = 100;
        return el.scrollTop;
      }),
    ),
  ).toEqual(initial.map(() => 0));
  await expect(page.getByRole('textbox', { name: 'New step' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('card History opens a separate sheet and dated updates survive reload', async ({ app, page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await start(app, page);
  const report = page.getByRole('article', { name: 'Weekly reporting' });
  const toggle = report.getByRole('button', { name: 'History for Weekly reporting' });
  const height = (await report.boundingBox()).height;
  await toggle.click();
  const history = page.getByRole('dialog', { name: 'Project history' });
  const update = history.getByRole('textbox', { name: 'New project update' });
  await update.fill('Draft sent for review');
  await history.getByRole('button', { name: 'Close' }).click();
  await toggle.click();
  await expect(update).toHaveValue('Draft sent for review');
  await page.keyboard.press('Escape');
  await toggle.click();
  await expect(update).toHaveValue('Draft sent for review');
  await page.locator('#sheet .sheetback').click({ position: { x: 5, y: 5 } });
  await toggle.click();
  await expect(update).toHaveValue('Draft sent for review');
  await history.getByRole('button', { name: 'Add update' }).click();
  await expect(update).toHaveValue('');
  await expect(history.locator('time')).toHaveCount(1);
  await page.clock.fastForward(1000);
  await update.fill('Feedback received');
  await history.getByRole('button', { name: 'Add update' }).click();
  await expect(history.locator('.project-updates p')).toHaveText([
    'Feedback received',
    'Draft sent for review',
  ]);
  await history.getByRole('button', { name: 'Close' }).click();
  await expect(toggle).toBeFocused();
  expect((await report.boundingBox()).height).toBe(height);
  await expect(report.locator('.project-step')).toHaveCount(3);
  await page.getByRole('button', { name: 'History for Supplier replies' }).click();
  await expect(history.locator('time')).toHaveCount(0);
  await history.getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await toggle.click();
  await expect(history.locator('time')).toHaveCount(2);
});

test('dragging a project across grid rows saves the new order, and the grip offers a move menu', async ({
  app,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await start(app, page);
  const grid = page.locator('#active-project-grid');
  const order = () => grid.locator('.project-card').evaluateAll(cards => cards.map(card => card.dataset.qid));
  const grip = grid.getByRole('button', { name: 'Reorder Read the circular' });
  const first = grid.getByRole('article', { name: 'Weekly reporting' });
  const from = await grip.boundingBox();
  const to = await first.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await expect(first).toHaveClass(/project-drop-target/);
  await page.mouse.up();
  expect(await order()).toEqual(['read', 'report', 'replies', 'meeting']);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  expect(await order()).toEqual(['read', 'report', 'replies', 'meeting']);
  await grip.press('Enter');
  await page.getByRole('button', { name: 'Move later' }).press('Enter');
  expect(await order()).toEqual(['report', 'read', 'replies', 'meeting']);
});

test.describe('touch drag', () => {
  test.use({ hasTouch: true });
  test('dragging a project with a finger moves it without opening the grip menu', async ({ app, page }) => {
    await start(app, page);
    const grid = page.locator('#active-project-grid');
    const grip = grid.getByRole('button', { name: 'Reorder Weekly reporting' });
    const next = grid.getByRole('article', { name: 'Supplier replies' });
    const from = await grip.boundingBox();
    const to = await next.boundingBox();
    const client = await page.context().newCDPSession(page);
    const x = Math.round(from.x + from.width / 2);
    const y = Math.round(from.y + from.height / 2);
    const end = Math.round(to.y + to.height / 2);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 20 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: end }] });
    await expect(next).toHaveClass(/project-drop-target/);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(grid.locator('.project-card').first()).toHaveAttribute('data-qid', 'replies');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test('one Active Task at a time, with old shortcuts opening Projects', async ({ app, page }) => {
  await start(app, page);
  await addSection(page, 'Urgent', 'red');
  const urgent = page.getByRole('region', { name: 'Urgent' });
  const report = page.getByRole('article', { name: 'Weekly reporting' });
  const second = page.getByRole('article', { name: 'Read the circular' });
  const active = page.getByRole('region', { name: 'Active Task' });
  await report.getByRole('button', { name: 'Reorder Weekly reporting' }).click();
  await page.getByRole('button', { name: 'Move to Urgent' }).click();
  await expect(urgent.getByRole('article', { name: 'Weekly reporting' })).toBeVisible();

  await report.getByRole('button', { name: 'Make Weekly reporting active' }).click();
  await expect(active.getByRole('article')).toHaveCount(1);
  await expect(active).toContainText('Weekly reporting');
  await expect(urgent.getByRole('article', { name: 'Weekly reporting' })).toHaveCount(0);
  await second.getByRole('button', { name: 'Make Read the circular active' }).click();
  await expect(active.getByRole('article')).toHaveCount(1);
  await expect(active).toContainText('Read the circular');
  await expect(urgent.getByRole('article', { name: 'Weekly reporting' })).toBeVisible();

  await page.reload();
  await expect(active).toContainText('Read the circular');
  await active.getByRole('button', { name: 'Make Read the circular active' }).click();
  await expect(active.getByRole('article')).toHaveCount(0);
  await expect(second).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Supplier replies' }).locator('.project-step-clock'),
  ).toBeVisible();

  for (const route of ['today', 'work']) {
    await page.evaluate(route => (location.hash = '#/' + route), route);
    await expect(page.locator('#v-projects')).toBeVisible();
    await expect(page.locator('#v-today')).toBeHidden();
  }
  await expect(page.locator('nav [data-v="today"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'List & board' })).toHaveCount(0);
});

test('create a project in a chosen section or Uncategorised and follow up from a waiting card', async ({
  app,
  page,
}) => {
  await start(app, page);
  await addSection(page, 'Urgent', 'red');
  const create = page.getByRole('button', { name: 'New project', exact: true });
  await create.click();
  const form = page.getByRole('dialog', { name: 'New project' });
  await form.getByRole('textbox', { name: 'Project name' }).fill('Call finance');
  await form.getByRole('combobox', { name: 'Section' }).selectOption({ label: 'Urgent' });
  await form.getByRole('button', { name: 'Create project' }).click();
  await expect(
    page.getByRole('region', { name: 'Urgent' }).getByRole('article', { name: 'Call finance' }),
  ).toBeVisible();
  await create.click();
  await form.getByRole('textbox', { name: 'Project name' }).fill('Check handover');
  await form.getByRole('button', { name: 'Create project' }).click();
  await expect(
    page.getByRole('region', { name: 'Uncategorised' }).getByRole('article', { name: 'Check handover' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Waiting on Sam' }).click();
  await page.getByRole('button', { name: 'Follow up' }).click();
  await expect(page.getByRole('dialog', { name: 'Follow up' })).toBeVisible();
});

test('completed projects retain their steps and searchable history across rollover and reload', async ({
  app,
  page,
}) => {
  await start(app, page);
  await addSection(page, 'Finance', 'teal');
  const report = page.getByRole('article', { name: 'Weekly reporting' });
  await report.getByRole('button', { name: 'Reorder Weekly reporting' }).click();
  await page.getByRole('button', { name: 'Move to Finance' }).click();
  await report.getByRole('button', { name: 'History for Weekly reporting' }).click();
  const history = page.getByRole('dialog', { name: 'Project history' });
  await history
    .getByRole('textbox', { name: 'New project update' })
    .fill('Sent via the quarterly export portal');
  await history.getByRole('button', { name: 'Add update' }).click();
  await history.getByRole('button', { name: 'Close' }).click();
  await page.evaluate(() => {
    const before = snapshot();
    const n = find('report').n;
    n.due = '2026-11-21';
    n.links = [
      { id: 'checklist', kind: 'url', url: 'https://example.com/checklist', label: 'Reporting checklist' },
    ];
    n.children.forEach(step => (step.done = true));
    n.done = true;
    settle(before);
  });
  await page.clock.setSystemTime(new Date(2026, 10, 19, 10, 0));
  await page.reload();
  await expect(report).toHaveCount(0);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Completed projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible();
  await page.evaluate(() => {
    S.completedProjects.push({
      id: 'lastyear',
      d: '2025-12-01',
      project: fix({ id: 'lastyear', text: 'Last year’s report', done: true }),
    });
    renderAll();
  });
  const older = page.getByRole('region', { name: 'December 2025' });
  await expect(older.getByRole('button', { name: /Last year’s report/ })).toContainText('1 Dec 2025');

  await page.getByRole('button', { name: /^Weekly reporting/ }).click();
  const detail = page.locator('#v-project-record');
  await expect(detail.getByRole('heading', { name: 'Weekly reporting' })).toBeVisible();
  await expect(detail.getByText('Export ledger')).toBeVisible();
  await expect(detail.getByText('Deadline 21 Nov')).toBeVisible();
  await expect(detail.getByRole('link', { name: /Reporting checklist/ })).toBeVisible();
  await expect(detail.getByText('Sent via the quarterly export portal')).toBeVisible();
  await page.getByRole('button', { name: '‹ Completed projects' }).click();
  await expect(page.getByRole('heading', { name: 'Completed projects' })).toBeVisible();
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('searchbox').fill('quarterly export portal');
  await page
    .locator('#sres')
    .getByRole('button', { name: /^Weekly reporting/ })
    .click();
  await expect(detail.getByText('Sent via the quarterly export portal')).toBeVisible();
  await expect(detail.locator('[data-history-entry]')).toBeFocused();
  await page.reload({ keepPlace: true });
  await expect(detail.getByRole('heading', { name: 'Weekly reporting' })).toBeVisible();
  await detail.getByRole('button', { name: 'Reopen project' }).click();
  await expect(page.locator('#v-today h1')).toHaveText('Weekly reporting');
  await app.go('projects');
  await expect(
    page.getByRole('region', { name: 'Finance' }).getByRole('article', { name: 'Weekly reporting' }),
  ).toBeVisible();
  expect((await app.state()).quests.find(q => q.id === 'report')).toMatchObject({
    done: false,
    due: '2026-11-21',
  });
});

test('the Active Task surfaces the next actionable step and nearest follow-up', async ({ app, page }) => {
  await start(app, page);
  await page.evaluate(() => {
    const q = find('report').n;
    q.children
      .slice(0, 3)
      .forEach((step, i) => (step.wait = { who: 'Colleague ' + i, due: shift(today(), 4 - i) }));
    renderAll();
  });
  await page.getByRole('button', { name: 'Make Weekly reporting active' }).click();
  const active = page.getByRole('region', { name: 'Active Task' });
  await expect(active.locator('.project-step').first()).toContainText('Next · Send report');
  await expect(active.locator('.project-step').nth(1)).toContainText('Waiting on Colleague 2');
});
