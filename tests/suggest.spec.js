const { test, expect } = require('./fixtures');

async function openProject(app, page) {
  await app.open();
  await app.addQuest('Check the rota');
  await app.openQuest('Check the rota');
  await page.getByRole('textbox', { name: 'New step' }).fill('Review shifts');
  await page.getByRole('textbox', { name: 'New step' }).press('Enter');
}

async function mockClaude(page) {
  await page.evaluate(() => {
    window.claudeRequests = [];
    sb = {
      functions: {
        invoke: async (name, { body }) => {
          window.claudeRequests.push({ name, body });
          return body.mode === 'summary'
            ? { data: { summary: 'The rota is ready to review.' } }
            : { data: { steps: ['Review shifts', 'Check cover', 'Send the rota'] } };
        },
      },
    };
    session = { user: { id: 'test-user' } };
    renderToday();
  });
}

test('suggestions require sign-in and consent and only selected new steps are added', async ({
  app,
  page,
}) => {
  await openProject(app, page);
  const action = page.getByRole('button', { name: 'Suggest steps (AI)', exact: true });
  await expect(action).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Summarise (AI)', exact: true })).toHaveCount(0);

  await mockClaude(page);
  await action.click();
  const dialog = page.getByRole('dialog', { name: 'Suggest steps (AI)' });
  await expect(dialog).toContainText('the project name and its step names');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => window.claudeRequests)).toEqual([]);
  await action.click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Review shifts' })).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: 'Send the rota' }).uncheck();
  await dialog.getByRole('button', { name: 'Add selected steps' }).click();
  expect(await page.evaluate(() => window.claudeRequests)).toEqual([
    { name: 'suggest-steps', body: { quest: 'Check the rota', steps: ['Review shifts'] } },
  ]);
  const project = (await app.state()).quests.find(q => q.text === 'Check the rota');
  expect(project.children.map(n => n.text)).toEqual(['Review shifts', 'Check cover']);
  await action.click();
  await expect(dialog.getByRole('checkbox', { name: 'Send the rota' })).toBeVisible();
});

test('a Claude summary remains a draft until accepted and can be appended to the existing text', async ({
  app,
  page,
}) => {
  await openProject(app, page);
  await page.locator('#fsum').fill('My status update.');
  await mockClaude(page);
  const action = page.getByRole('button', { name: 'Summarise (AI)', exact: true });
  await action.click();
  const dialog = page.getByRole('dialog', { name: 'Summarise (AI)' });
  await expect(dialog).toContainText('including their status and who you are waiting on');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog).toContainText('The rota is ready to review.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#fsum')).toHaveValue('My status update.');
  expect(await page.evaluate(() => window.claudeRequests)).toEqual([
    {
      name: 'suggest-steps',
      body: {
        mode: 'summary',
        quest: 'Check the rota',
        summary: 'My status update.',
        steps: [{ text: 'Review shifts', done: false, waiting: '' }],
      },
    },
  ]);
  await action.click();
  await dialog.getByRole('button', { name: 'Add to summary' }).click();
  await expect(page.locator('#fsum')).toHaveValue('My status update.\nThe rota is ready to review.');
  await action.click();
  await dialog.getByRole('button', { name: 'Replace summary' }).click();
  await expect(page.locator('#fsum')).toHaveValue('The rota is ready to review.');
});

test('cancelling a pending Claude request leaves the project alone', async ({ app, page }) => {
  await openProject(app, page);
  await mockClaude(page);
  await page.evaluate(() => {
    localStorage.setItem('dashboard-suggest-ok', '1');
    sb.functions.invoke = () => new Promise(resolve => (window.finishClaudeRequest = resolve));
  });
  await page.getByRole('button', { name: 'Suggest steps (AI)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Suggest steps (AI)' });
  await expect(dialog.getByRole('status')).toHaveText('Asking Claude…');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.evaluate(() => window.finishClaudeRequest({ data: { steps: ['Send the rota'] } }));
  await expect(dialog).toHaveCount(0);
  const project = (await app.state()).quests.find(q => q.text === 'Check the rota');
  expect(project.children.map(n => n.text)).toEqual(['Review shifts']);
});
