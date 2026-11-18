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
  await app.go('today');
  await expect(page.locator('#v-today')).toBeVisible();
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
  await expect(page.locator('#upd')).toHaveJSProperty('open', true);
  await page.evaluate(() => history.back());
  await expect(page.getByRole('button', { name: 'Month end', exact: true })).toBeFocused();
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
  expect(new Set((await layout()).map(card => card.height)).size).toBe(1);
  await expect(page.getByRole('textbox', { name: 'New step' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('each card has its own collapsible history with dated updates that survive reload', async ({
  app,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await start(app, page);
  const report = page.getByRole('article', { name: 'Weekly reporting' });
  const toggle = report.getByRole('button', { name: 'History for Weekly reporting' });
  const update = report.getByRole('textbox', { name: 'New project update' });
  const height = (await report.boundingBox()).height;
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(update).toBeHidden();
  await toggle.click();
  await expect(update).toBeVisible();
  await update.fill('Draft sent for review');
  await toggle.click();
  await toggle.click();
  await expect(update).toHaveValue('Draft sent for review');
  await report.getByRole('button', { name: 'Add update' }).click();
  await expect(update).toHaveValue('');
  await expect(report.locator('time')).toHaveCount(1);
  await page.clock.fastForward(1000);
  await update.fill('Feedback received\nRevising the figures');
  await report.getByRole('button', { name: 'Add update' }).click();
  await expect(report.locator('.project-updates p')).toHaveText([
    'Feedback received Revising the figures',
    'Draft sent for review',
  ]);
  expect((await report.boundingBox()).height).toBe(height);
  const preview = report.locator('.project-preview');
  await preview.evaluate(el => (el.scrollTop = el.scrollHeight));
  expect(await preview.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(report.locator('.project-step')).toHaveCount(3);
  await page.getByRole('button', { name: 'History for Supplier replies' }).click();
  await expect(page.getByRole('article', { name: 'Supplier replies' }).locator('time')).toHaveCount(0);

  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(report.locator('time')).toHaveCount(2);
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

test('Today contains only the tasks sent from Projects, with the same completion state', async ({
  app,
  page,
}) => {
  await start(app, page);
  const report = page.getByRole('article', { name: 'Weekly reporting' });
  const send = report.getByRole('button', { name: 'Send to Today: Export ledger' });
  await page.mouse.move(1, 1);
  await expect(send).toHaveCSS('opacity', '0');
  await report.getByText('Export ledger', { exact: true }).hover();
  await expect(send).toHaveCSS('opacity', '1');
  await send.click();
  await page.getByRole('button', { name: 'Send to Today: Read the circular' }).focus();
  await page.keyboard.press('Enter');
  await app.go('today');
  const plan = page.getByRole('region', { name: 'Plan for today' });
  await expect(plan.locator('.plan-row .open > span')).toHaveText(['Export ledger', 'Read the circular']);
  await expect(page.getByRole('heading', { name: "Today's tasks", exact: true })).toHaveCount(0);
  await plan.getByRole('button', { name: /Export ledger Weekly reporting/ }).click();
  await expect(page.locator('#v-today h1')).toHaveText('Export ledger');
  await page.getByRole('button', { name: '‹ Today' }).click();
  await expect(plan).toBeVisible();
  await plan.getByRole('button', { name: 'Mark done: Export ledger' }).click();
  await expect(plan.getByRole('button', { name: 'Mark not done: Export ledger' })).toBeVisible();
  await app.go('projects');
  await expect(report.getByRole('button', { name: 'Mark not done: Export ledger' })).toHaveCount(0);
  await expect(report).toContainText('1 of 4 steps');
  await page.reload();
  await app.go('today');
  await expect(plan.getByRole('button', { name: 'Mark not done: Export ledger' })).toBeVisible();
  await plan.getByRole('button', { name: 'Remove from Today: Read the circular' }).click();
  await expect(plan.getByText('Read the circular')).toHaveCount(0);
  await page.clock.fastForward(24 * 60 * 60_000);
  await expect(plan.getByText('Nothing planned yet.')).toBeVisible();
  await app.go('projects');
  await page.getByRole('button', { name: 'List & board' }).click();
  await expect(page.getByRole('heading', { name: 'Project tasks' })).toBeVisible();
  await app.go('today');
  await expect(plan.getByText('Nothing planned yet.')).toBeVisible();
});
