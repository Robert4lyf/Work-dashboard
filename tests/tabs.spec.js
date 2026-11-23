// Two tabs of the app open at once (a computer: the installed app and a browser tab). A tab that
// saves tells the others, and they take in the saved copy instead of saving their own older one
// over it.
const { test, expect } = require('./fixtures');

async function second(context) {
  const p = await context.newPage();
  await p.route(
    u => !u.href.startsWith('http://localhost'),
    r => r.abort(),
  );
  await p.goto('/');
  await p.waitForFunction(() => window.appReady === true);
  return p;
}
const inbox = p => p.evaluate(() => S.inbox.map(i => i.text));

test('a change saved in one tab shows in the other, and neither overwrites the other', async ({
  app,
  page,
  context,
}) => {
  await app.open({ home: 'projects' });
  const two = await second(context);
  await page.click('nav [data-v=inbox]');
  await page.fill('#iin', 'from tab one');
  await page.press('#iin', 'Enter');
  await expect.poll(() => inbox(two)).toEqual(['From tab one']);
  // (drawn there too, without a reload)
  await expect(two.locator('#inboxBadge')).toHaveText('1');
  await two.click('nav [data-v=inbox]');
  await two.fill('#iin', 'from tab two');
  await two.press('#iin', 'Enter');
  await expect(page.locator('#v-inbox')).toContainText('From tab two');
  expect(await inbox(page)).toEqual(['From tab two', 'From tab one']);
  // Both survive a reload of either tab.
  await page.reload({ keepPlace: true });
  expect(await inbox(page)).toEqual(['From tab two', 'From tab one']);
  await two.close();
});

test('words being typed, an open sheet and the place on the page survive another tab’s save', async ({
  app,
  page,
  context,
}) => {
  await app.open({ home: 'projects' });
  await app.setState(s => {
    s.quests = [{ id: 'a', text: 'Alpha', children: [{ id: 'a1', text: 'First', children: [] }] }];
  });
  await page.reload();
  const two = await second(context);
  await page.getByRole('button', { name: 'Alpha', exact: true }).click();
  await page.fill('#sin', 'half-typed st');
  await two.evaluate(() => {
    S.quests[0].children.push(fix({ id: 'a2', text: 'Added elsewhere' }));
    save();
  });
  await expect(page.locator('#v-today')).toContainText('Added elsewhere');
  await expect(page.locator('#sin')).toHaveValue('half-typed st');
  // A sheet stays up, and what it adds lands on top of the other tab's change.
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.locator('#sheet .sheetbox')).toBeVisible();
  await two.evaluate(() => {
    S.inbox.unshift({ id: 'i1', text: 'While the sheet was open' });
    save();
  });
  await expect.poll(() => inbox(page)).toEqual(['While the sheet was open']);
  await expect(page.locator('#sheet .sheetbox')).toBeVisible();
  await page.keyboard.press('Escape');
  // The open task deleted in the other tab: said so, and the page falls back.
  await two.evaluate(() => {
    S.quests = [];
    save();
  });
  await expect(page.locator('#toast')).toContainText('removed in another tab');
  expect(app.errors).toEqual([]);
  await two.close();
});

test('an undo on offer is dropped when another tab saves (it would put this tab’s old copy back)', async ({
  app,
  page,
  context,
}) => {
  await app.open({ home: 'projects' });
  await app.setState(s => {
    s.inbox = [
      { id: 'i1', text: 'One' },
      { id: 'i2', text: 'Two' },
    ];
  });
  await page.reload();
  const two = await second(context);
  await page.click('nav [data-v=inbox]');
  await page.evaluate(() => withUndo('Deleted', () => ((S.inbox = S.inbox.slice(1)), save(), renderAll())));
  await expect(page.locator('#undo')).toBeVisible();
  await expect.poll(() => inbox(two)).toEqual(['Two']);
  await two.evaluate(() => {
    S.inbox.push({ id: 'i3', text: 'Three' });
    save();
  });
  await expect.poll(() => inbox(page)).toEqual(['Two', 'Three']);
  await expect(page.locator('#undo')).toHaveCount(0);
  await two.close();
});
