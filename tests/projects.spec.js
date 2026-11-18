const { test, expect } = require('./fixtures');

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
  const layout = () =>
    cards.evaluateAll(items =>
      items.map(card => {
        const { width, height, top } = card.getBoundingClientRect();
        const actions = card.querySelector('.project-actions').getBoundingClientRect();
        return { width, height, top, footerOffset: actions.bottom - top };
      }),
    );

  const initial = await layout();
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
  await expect(report.locator('.project-step')).toHaveCount(3);
  await page.getByRole('button', { name: 'History for Supplier replies' }).click();
  await expect(page.getByRole('article', { name: 'Supplier replies' }).locator('time')).toHaveCount(0);

  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(report.locator('time')).toHaveCount(2);
});
