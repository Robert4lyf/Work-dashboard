// A computer: the sidebar's extra places, the keyboard (shortcuts, Search, moving about a list),
// the mouse (right-click, double-click, something under the pointer), dialogs in the middle of
// the window, pages of reading width and a project's page beside the board.
const { test, expect } = require('./fixtures');

const WIDE = { width: 1440, height: 900 };
const node = (id, text, extra = {}) => ({ id, text, children: [], ...extra });
function seed(s) {
  const k = (id, text, extra = {}) => ({ id, text, children: [], ...extra });
  s.quests = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'].map((text, i) =>
    k('q' + i, text, {
      children: [k('q' + i + 'a', 'Draft ' + text), k('q' + i + 'b', 'Send ' + text)],
    }),
  );
  s.quests.push(k('solo', 'Solo task'));
  s.inbox = [
    { id: 'i1', text: 'Call landlord' },
    { id: 'i2', text: 'Book train' },
  ];
}
async function start(app, page, size = WIDE) {
  await page.setViewportSize(size);
  await app.open({ home: 'projects' });
  await app.setState(seed);
  await page.reload();
}
const where = page => page.evaluate(() => [view, path.join('/')]);
const focused = page =>
  page.evaluate(() => (document.activeElement.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40));

test('the sidebar has the places with no tab on a phone, each lit when it is showing', async ({
  app,
  page,
}) => {
  await start(app, page);
  const side = page.locator('#sidemore');
  for (const [name, title] of [
    ['Command Centre', 'Command Centre'],
    ['Waiting', 'Waiting'],
    ['Focus', 'Focus'],
    ['Scratchpad', 'Scratchpad'],
  ]) {
    await side.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('#page-title')).toHaveText(title);
    await expect(side.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('nav [aria-current=page]')).toHaveCount(1);
  }
  // History is a part of Review: its own entry is the one lit, and Review's tabs still switch.
  await side.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('#v-log')).toBeVisible();
  await expect(side.getByRole('button', { name: 'History' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('nav [data-v=review]')).not.toHaveAttribute('aria-current', 'page');
  await page.locator('#v-review').getByRole('button', { name: 'Week', exact: true }).click();
  await expect(page.locator('nav [data-v=review]')).toHaveAttribute('aria-current', 'page');
  await expect(side.getByRole('button', { name: 'History' })).not.toHaveAttribute('aria-current', 'page');
  // A tab is a fresh start: nothing of the sidebar's stays lit.
  await page.click('nav [data-v=inbox]');
  await expect(side.locator('[aria-current=page]')).toHaveCount(0);
  // Back from one of them (Android's gesture, or the browser's back) goes to Projects.
  await side.getByRole('button', { name: 'Waiting', exact: true }).click();
  await page.goBack();
  expect(await where(page)).toEqual(['projects', '']);
});

test('on a phone the sidebar’s extras are not shown, and History lights the Review tab', async ({
  app,
  page,
}) => {
  await start(app, page, { width: 390, height: 844 });
  await expect(page.locator('#sidemore')).toBeHidden();
  await page.evaluate(() => go('log'));
  await expect(page.locator('nav [data-v=review]')).toHaveAttribute('aria-current', 'page');
});

test('? and the sidebar’s link list the keyboard shortcuts in a dialog in the middle of the window', async ({
  app,
  page,
}) => {
  await start(app, page);
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Search everything');
  await expect(dialog).toContainText('Projects');
  await expect(dialog).not.toContainText('today');
  const box = await dialog.boundingBox();
  // (clear of the sidebar, and neither along the foot of the window nor off its top)
  expect(box.x).toBeGreaterThan(232);
  expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThan(4);
  expect(Math.abs(box.x + box.width / 2 - (232 + (1440 - 232) / 2))).toBeLessThan(12);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await where(page)).toEqual(['projects', '']);
  await page
    .locator('#sidemore')
    .getByRole('button', { name: /Keyboard shortcuts/ })
    .click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('a sheet on a phone is still along the foot of the screen', async ({ app, page }) => {
  await start(app, page, { width: 390, height: 844 });
  await page.getByRole('button', { name: 'New project' }).click();
  const box = await page.locator('#sheet .sheetbox').boundingBox();
  expect(box.y + box.height).toBeGreaterThan(844 - 20);
});

test('a tall dialog on a short window scrolls inside itself and keeps to the window', async ({
  app,
  page,
}) => {
  await start(app, page, { width: 1280, height: 420 });
  await page.keyboard.press('?');
  const box = await page.locator('#sheet .sheetbox').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(420);
  await page.locator('#sheet').getByRole('button', { name: 'Close' }).scrollIntoViewIfNeeded();
  await page.locator('#sheet').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#sheet')).toHaveCount(0);
});

test('Search by keyboard: Ctrl+K opens it, the arrows choose, Enter opens, Escape steps back out', async ({
  app,
  page,
}) => {
  await start(app, page);
  await page.click('nav [data-v=inbox]');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Control+k');
  await expect(page.locator('#sq')).toBeFocused();
  await page.keyboard.type('draft');
  const hits = page.locator('#sres .srow');
  await expect(hits).toHaveCount(8);
  // (the first result is chosen as soon as there is one; the box keeps the keyboard)
  await expect(hits.nth(0)).toHaveClass(/sel/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(hits.nth(1)).toHaveClass(/sel/);
  await expect(page.locator('#sres .sel')).toHaveCount(1);
  await expect(page.locator('#sq')).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await where(page)).toEqual(['today', 'q1/q1a']);
  // Escape: back to Search (the words still there), then it clears them, then back to the Inbox.
  await page.keyboard.press('Escape');
  expect(await where(page)).toEqual(['search', '']);
  await expect(page.locator('#sq')).toHaveValue('draft');
  await page.locator('#sq').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sq')).toHaveValue('');
  await expect(page.locator('#sq')).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await where(page)).toEqual(['inbox', '']);
  // Typing more moves the choice back to the first result; no results, Enter does nothing odd.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('zzzz');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  expect(await where(page)).toEqual(['search', '']);
});

test('Search opened from a project’s page goes back to it, by Escape and by the back gesture', async ({
  app,
  page,
}) => {
  await start(app, page);
  await page.getByRole('button', { name: 'Charlie', exact: true }).click();
  await page.keyboard.press('/');
  await expect(page.locator('#sq')).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await where(page)).toEqual(['today', 'q2']);
  await page.keyboard.press('/');
  await page.goBack();
  expect(await where(page)).toEqual(['today', 'q2']);
  // (and from there back is still to Projects)
  await page.keyboard.press('Escape');
  expect(await where(page)).toEqual(['projects', '']);
});

test('on a phone Search chooses nothing by itself and Enter still puts the keyboard away', async ({
  app,
  page,
}) => {
  await start(app, page, { width: 390, height: 844 });
  await page.click('#searchBtn');
  await page.fill('#sq', 'draft');
  await expect(page.locator('#sres .sel')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('#sq')).not.toBeFocused();
  expect(await where(page)).toEqual(['search', '']);
});

test('Ctrl+Z takes the Undo on offer; in a field it stays the field’s own', async ({ app, page }) => {
  await start(app, page);
  await page.click('nav [data-v=inbox]');
  await page.locator('#v-inbox').getByRole('button', { name: 'Delete' }).first().click();
  await expect(page.locator('#undo')).toBeVisible();
  // In the capture box Ctrl+Z is the box's own undo: the item stays deleted.
  await page.fill('#iin', 'typed');
  await page.keyboard.press('Control+z');
  expect((await app.state()).inbox.map(i => i.text)).toEqual(['Book train']);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Control+z');
  expect((await app.state()).inbox.map(i => i.text)).toEqual(['Call landlord', 'Book train']);
  await expect(page.locator('#toast')).toHaveText('Undone');
  // With nothing to undo it does nothing.
  await page.keyboard.press('Control+z');
  expect((await app.state()).inbox).toHaveLength(2);
});

test('J and K (and the arrows, once a card is selected) move about the board; Enter opens; X ticks', async ({
  app,
  page,
}) => {
  await start(app, page);
  await page.keyboard.press('j');
  expect(await focused(page)).toBe('Alpha');
  await page.keyboard.press('j');
  expect(await focused(page)).toBe('Bravo');
  await page.keyboard.press('k');
  expect(await focused(page)).toBe('Alpha');
  await page.keyboard.press('k'); // (at the start: stays)
  expect(await focused(page)).toBe('Alpha');
  // Three cards to a row at this width: down is the card underneath, right the next one.
  await page.keyboard.press('ArrowDown');
  expect(await focused(page)).toBe('Delta');
  await page.keyboard.press('ArrowRight');
  expect(await focused(page)).toBe('Echo');
  await page.keyboard.press('ArrowUp');
  expect(await focused(page)).toBe('Bravo');
  await page.keyboard.press('ArrowLeft');
  expect(await focused(page)).toBe('Alpha');
  // X ticks a project that has no steps of its own (one with steps is opened to tick them).
  await page.getByRole('button', { name: 'Solo task', exact: true }).focus();
  await page.keyboard.press('x');
  expect((await app.state()).quests.find(q => q.id === 'solo').done).toBe(true);
  // Enter opens; on its page J goes down the steps and X ticks the one selected.
  await page.getByRole('button', { name: 'Bravo', exact: true }).focus();
  await page.keyboard.press('Enter');
  expect(await where(page)).toEqual(['today', 'q1']);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('j');
  expect(await focused(page)).toBe('Draft Bravo');
  await page.keyboard.press('j');
  expect(await focused(page)).toBe('Send Bravo');
  await page.keyboard.press('x');
  const bravo = (await app.state()).quests.find(q => q.id === 'q1');
  expect(bravo.children.map(c => [c.text, !!c.done])).toEqual(
    expect.arrayContaining([
      ['Draft Bravo', false],
      ['Send Bravo', true],
    ]),
  );
  // The arrow keys with nothing selected still scroll the page: no card takes the keyboard.
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  // Typing J in a field is just a letter.
  await page.click('nav [data-v=inbox]');
  await page.locator('#iin').focus();
  await page.keyboard.type('jk');
  await expect(page.locator('#iin')).toHaveValue('jk');
});

test('J and K go down the Inbox', async ({ app, page }) => {
  await start(app, page);
  await page.click('nav [data-v=inbox]');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('j');
  expect(await focused(page)).toContain('Call landlord');
  await page.keyboard.press('j');
  expect(await focused(page)).toContain('Book train');
});

test('right-click a project or a step for its actions, with Rename', async ({ app, page }) => {
  await start(app, page);
  await page.getByRole('button', { name: 'Delta', exact: true }).click({ button: 'right' });
  const dialog = page.getByRole('dialog', { name: 'Delta' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename' });
  await expect(rename.getByLabel('Name')).toHaveValue('Delta');
  await rename.getByLabel('Name').fill('Delta renamed');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Delta renamed', exact: true })).toBeVisible();
  expect((await app.state()).quests[3].text).toBe('Delta renamed');
  // A step on a card: its own actions.
  await page.locator('.project-step', { hasText: 'Draft Alpha' }).click({ button: 'right' });
  await expect(page.getByRole('dialog', { name: 'Draft Alpha' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark done' }).click();
  expect((await app.state()).quests[0].children.find(c => c.id === 'q0a').done).toBe(true);
  // A field keeps the browser's own menu (paste): no sheet.
  await page.click('nav [data-v=inbox]');
  await page.locator('#iin').click({ button: 'right' });
  await expect(page.locator('#sheet')).toHaveCount(0);
  // An empty name, or Cancel, changes nothing.
  await page.click('nav [data-v=projects]');
  await page.getByRole('button', { name: 'Echo', exact: true }).click({ button: 'right' });
  await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('dialog', { name: 'Rename' }).getByLabel('Name').fill('   ');
  await page.keyboard.press('Enter');
  expect((await app.state()).quests[4].text).toBe('Echo');
});

test('a long press on a touch screen is left to the browser: no actions sheet', async ({ app, page }) => {
  await start(app, page);
  await page.evaluate(() => {
    const el = document.querySelector('.project-card');
    el.dispatchEvent(
      new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: 'touch' }),
    );
  });
  await expect(page.locator('#sheet')).toHaveCount(0);
});

test('double-click the name on a project’s page to rename it', async ({ app, page }) => {
  await start(app, page);
  await page.getByRole('button', { name: 'Golf', exact: true }).click();
  await page.locator('#v-today .node.facts > h1').dblclick();
  const rename = page.getByRole('dialog', { name: 'Rename' });
  await rename.getByLabel('Name').fill('Golf club');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#v-today .node.facts > h1')).toHaveText('Golf club');
  expect((await app.state()).quests[6].text).toBe('Golf club');
});

test('one-column pages keep to a width that reads; the board uses the room', async ({ app, page }) => {
  await start(app, page, { width: 1920, height: 1000 });
  const width = async s => (await page.locator(s).boundingBox()).width;
  expect(await width('#v-projects')).toBeGreaterThan(1200);
  for (const v of ['inbox', 'knowledge', 'review', 'account']) {
    await page.click(`nav [data-v=${v}]`);
    expect(await width('#v-' + v)).toBeLessThanOrEqual(860);
    // (under the page's heading, not off in the middle)
    const h = await page.locator('#page-title').boundingBox(),
      b = await page.locator('#v-' + v).boundingBox();
    expect(Math.abs(h.x - b.x)).toBeLessThan(2);
  }
  await page.keyboard.press('/');
  expect(await width('#sq')).toBeLessThanOrEqual(860);
});

test.describe('a wide window: a project’s page with the board beside it', () => {
  const pane = page => page.locator('#v-projects');
  test('another project is one click away; a tick on either side shows on both; back returns to the board', async ({
    app,
    page,
  }) => {
    await start(app, page, { width: 1440, height: 700 });
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
    const y = await page.evaluate(() => scrollY);
    await page.getByRole('button', { name: 'Foxtrot', exact: true }).click();
    expect(await where(page)).toEqual(['today', 'q5']);
    await expect(pane(page)).toBeVisible();
    await expect(page.locator('#v-today .node.facts > h1')).toHaveText('Foxtrot');
    // Side by side: the board at the left, the page at the right, neither under the other.
    const a = await pane(page).boundingBox(),
      b = await page.locator('#v-today').boundingBox();
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    expect(a.x).toBeGreaterThanOrEqual(232);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // The open project is marked, and showing in the board's own scroll.
    const current = pane(page).locator('.project-current');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText('Foxtrot');
    await expect(current).toBeInViewport();
    // Another project: one click, without leaving.
    await pane(page).getByRole('button', { name: 'Bravo', exact: true }).click();
    await expect(page.locator('#v-today .node.facts > h1')).toHaveText('Bravo');
    await expect(pane(page).locator('.project-current')).toContainText('Bravo');
    // A tick on the page shows on the board's count.
    await page.locator('#v-today').getByRole('button', { name: 'Mark done: Draft Bravo' }).click();
    await expect(pane(page).locator('.project-current')).toContainText('1 of 2 steps');
    // A project with no steps ticked on the board; the page stays.
    await pane(page).getByRole('button', { name: 'Mark done: Solo task' }).click();
    expect((await app.state()).quests.find(q => q.id === 'solo').done).toBe(true);
    expect(await where(page)).toEqual(['today', 'q1']);
    // Back (Escape, or the crumb): Projects where it was, the keyboard on the card last opened.
    await page.keyboard.press('Escape');
    expect(await where(page)).toEqual(['projects', '']);
    await expect(page.locator('body')).not.toHaveClass(/split/);
    expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(3);
    expect(await focused(page)).toBe('Bravo');
    // The board is whole again: its cards with their steps and actions.
    await expect(page.getByRole('article', { name: 'Alpha' }).locator('.project-steps')).toBeVisible();
  });

  test('typed words and the place survive the board redrawing; a reload opens the same two sides', async ({
    app,
    page,
  }) => {
    await start(app, page);
    await page.getByRole('button', { name: 'Charlie', exact: true }).click();
    await page.fill('#sin', 'half a st');
    await pane(page).getByRole('button', { name: 'Mark done: Solo task' }).click();
    await expect(page.locator('#sin')).toHaveValue('half a st');
    await page.fill('#sin', 'A new step');
    await page.press('#sin', 'Enter');
    await expect(pane(page).locator('.project-current')).toContainText('0 of 3 steps');
    await page.reload({ keepPlace: true });
    expect(await where(page)).toEqual(['today', 'q2']);
    await expect(page.locator('body')).toHaveClass(/split/);
    await expect(pane(page).locator('.project-current')).toContainText('Charlie');
    await page.goBack();
    expect(await where(page)).toEqual(['projects', '']);
  });

  test('a step’s page keeps the board; a narrower window shows the page alone; resizing switches', async ({
    app,
    page,
  }) => {
    await start(app, page);
    await page.getByRole('button', { name: 'Alpha', exact: true }).click();
    await page.locator('#v-today .row .open', { hasText: 'Draft Alpha' }).click();
    expect(await where(page)).toEqual(['today', 'q0/q0a']);
    await expect(pane(page)).toBeVisible();
    await expect(pane(page).locator('.project-current')).toContainText('Alpha');
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(pane(page)).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/split/);
    await page.setViewportSize(WIDE);
    await expect(pane(page)).toBeVisible();
    // Up the crumbs to the project, then to Projects.
    await page.keyboard.press('Escape');
    expect(await where(page)).toEqual(['today', 'q0']);
    await page.keyboard.press('Escape');
    expect(await where(page)).toEqual(['projects', '']);
  });

  test('deleting the open project from its page falls back to the whole board', async ({ app, page }) => {
    await start(app, page);
    await page.getByRole('button', { name: 'Hotel', exact: true }).click();
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    expect(await where(page)).toEqual(['projects', '']);
    await expect(page.locator('body')).not.toHaveClass(/split/);
    await expect(pane(page)).toBeVisible();
    await expect(page.locator('#v-today')).toBeHidden();
  });

  test('New project and the keyboard work from the board at the side', async ({ app, page }) => {
    await start(app, page);
    await page.getByRole('button', { name: 'Alpha', exact: true }).click();
    await pane(page).getByRole('button', { name: 'New project' }).click();
    await page.getByRole('dialog').getByLabel('Project name').fill('Made beside');
    await page.keyboard.press('Enter');
    await expect(pane(page).getByRole('button', { name: 'Made beside', exact: true })).toBeVisible();
    expect(await where(page)).toEqual(['today', 'q0']);
    // J from a card goes down the cards; Enter opens the one selected.
    await pane(page).getByRole('button', { name: 'Bravo', exact: true }).focus();
    await page.keyboard.press('j');
    expect(await focused(page)).toBe('Charlie');
    await page.keyboard.press('Enter');
    await expect(page.locator('#v-today .node.facts > h1')).toHaveText('Charlie');
  });
});
