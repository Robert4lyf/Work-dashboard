const { test, expect } = require('./fixtures');

// Friday 25 Sep 2026, 9am.
test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 8, 25, 9) });
  await app.open();
  await page.clock.pauseAt(new Date(2026, 8, 25, 9, 0, 30));
});

test('five tabs; History sits under Review; Focus opens from the header', async ({ app, page }) => {
  await expect(page.locator('nav [data-v]')).toHaveText([
    'Today',
    /^Inbox/,
    'Knowledge',
    'Review',
    'Settings',
  ]);
  await page.click('nav [data-v=review]');
  await expect(page.locator('#v-review .rtabs button')).toHaveText(['Week', 'History']);
  await page.click('[data-rsub="log"]');
  await expect(page.locator('#v-log')).toBeVisible();
  await expect(page.locator('nav [data-v=review]')).toHaveAttribute('aria-current', 'page');
  // (the header shows today's focus time once there is some; tapping it opens Focus)
  await page.evaluate(() => {
    S.daily[today()] = { Design: 25 };
    renderHeader();
  });
  await page.click('header [data-v=focus]');
  await expect(page.locator('#v-focus')).toBeVisible();
  await page.keyboard.press('l'); // history shortcut still works
  await expect(page.locator('#v-log')).toBeVisible();
});

test('weekly review: steps, copyable summary, and the Friday prompt', async ({ app, page }) => {
  await app.addQuest('Old report');
  await app.addQuest('Budget review');
  await app.addQuest('Ship sitemap');
  await app.setState(s => {
    s.quests[0].since = '2026-09-20';
    s.quests[1].wait = { who: 'Sam', note: '', due: '2026-09-25', since: '2026-09-24' };
    s.quests[2].done = true;
    s.log.push({ id: s.quests[2].id, d: '2026-09-25', text: 'Ship sitemap', trail: ['Website'], p: '' });
    // Last Saturday: within 7 days, but last week.
    s.log.push({ id: 'old', d: '2026-09-19', text: 'Last week thing', trail: [], p: '' });
    s.inbox.push({ id: 'i1', text: 'Loose idea' });
  });
  await page.reload();
  // It's Friday and the week hasn't been reviewed: the header says so.
  await page.click('#v-today .attn [data-rsub="week"]');
  await expect(page.locator('nav #reviewDot')).toBeVisible();
  const v = page.locator('#v-review');
  await expect(v.locator('.wsum')).toContainText('1 done');
  // One step at a time, Next through them.
  const step = t => v.locator('.wstep', { has: page.locator('h2', { hasText: t }) });
  const next = () => page.click('[data-rstep="1"]');
  await expect(v.locator('.wstepno')).toHaveText('Step 1 of 5');
  await expect(step('Inbox')).toContainText('1 item to sort');
  await next();
  await expect(step('Carried over')).toContainText('Old report 5 days');
  // Decisions work from here too.
  await step('Carried over').locator('[data-keep]').click();
  await expect(step('Carried over')).toContainText('All clear.'); // kept: off the list until tomorrow
  await next();
  // (a quest set waiting before this is waiting through a step of its own now)
  await expect(step('Waiting')).toContainText('Budget review / Hear back from Sam');
  await next();
  await page.click('[data-rstep="-1"]');
  await expect(step('Waiting')).toBeVisible();
  await next();
  await expect(step('Coming up')).toContainText('All clear.');
  await next();
  await expect(step('Done this week')).toContainText('Ship sitemap');
  await expect(step('Done this week')).not.toContainText('Last week thing');
  await expect(v.locator('.wsum')).toContainText('This week (from Mon 21 Sep)');
  expect(await page.evaluate(() => weekText())).toBe(
    'Week of 21 Sep: 1 done, 0m focus\n\nWebsite\n- Ship sitemap',
  );
  await page.click('#reviewed');
  expect((await app.state()).reviewed).toBe('2026-09-25');
  await app.go('today'); // (a tab is drawn when opened)
  await expect(page.locator('#v-today .attn [data-rsub="week"]')).toHaveCount(0);
  await expect(page.locator('nav #reviewDot')).toBeHidden();
});

test('inbox swipes: left sends to Today (undoable), right shows quick options', async ({ app, page }) => {
  await app.go('inbox');
  for (const t of ['Book dentist', 'Reply to Sam']) {
    await page.fill('#iin', t);
    await page.press('#iin', 'Enter');
  }
  const swipe = async (text, dx) => {
    const box = await page.locator('#v-inbox .item', { hasText: text }).locator('p').boundingBox();
    const y = box.y + box.height / 2,
      x = box.x + box.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(x + (dx * i) / 5, y);
    await page.mouse.up();
  };
  await swipe('Reply to Sam', -140);
  let s = await app.state();
  expect(s.quests.map(q => q.text)).toEqual(['Reply to Sam']);
  await page.click('#undo');
  expect((await app.state()).quests).toEqual([]);

  // A short swipe does nothing.
  await swipe('Book dentist', -40);
  await expect(page.locator('#v-inbox .iacts.quick')).toHaveCount(0);
  await swipe('Book dentist', 140);
  const quick = page.locator('#v-inbox .item', { hasText: 'Book dentist' }).locator('.iacts.quick');
  await expect(quick.locator('.chip')).toHaveText(['Tomorrow', 'Next week', 'Waiting…', 'Clear']);
  await quick.locator('[data-sched]').first().click();
  s = await app.state();
  expect(s.later).toMatchObject([{ text: 'Book dentist', start: '2026-09-26' }]);

  // Waiting… opens the details with the waiting box ready.
  await swipe('Reply to Sam', 140);
  await page.click('#v-inbox [data-waiton]');
  const id = (await app.state()).inbox[0].id;
  await expect(page.locator(`[data-iwait="${id}"]`)).toBeFocused();
});

test('health check, signed out: says what is and isn’t set up', async ({ app, page }) => {
  await app.go('account');
  await page.evaluate(() => (document.querySelector('#advd').open = true)); // (Advanced, idempotent)
  await page.click('#healthrun');
  const rows = page.locator('.health .hrow2');
  await expect(rows.first()).toContainText('Supabase settings');
  await expect(rows.first()).toHaveClass(/bad/);
  await expect(rows.first()).toContainText('Library not loaded'); // (the CDN is blocked in tests)
  await expect(page.locator('.health')).toContainText('Works offline');
  await expect(page.locator('#healthrun')).toHaveText('Run again');
});
