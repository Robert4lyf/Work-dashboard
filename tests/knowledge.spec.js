const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => {
  await app.open();
});

test('categories and sub-categories hold articles, sorted A to Z and collapsible', async ({ app, page }) => {
  await app.go('knowledge');
  const v = page.locator('#v-knowledge');
  for (const name of ['Processes', 'Contacts', 'Tools']) {
    await page.fill('#kbcatin', name);
    await page.press('#kbcatin', 'Enter');
  }
  await expect(v.locator('#kbtree > .kcat > summary')).toHaveText(['Contacts 0', 'Processes 0', 'Tools 0']);

  // A sub-category, named in the prompt.
  // Closed to begin with.
  await expect(v.locator('#kbtree [data-kbsub]').first()).toBeHidden();
  await v.locator('#kbtree > .kcat', { hasText: 'Processes' }).locator('> summary').click();
  page.once('dialog', d => d.accept('Day care commissioning'));
  await v.locator('.kcat', { hasText: 'Processes' }).locator('[data-kbsub]').first().click();
  const sub = v.locator('.kcat .kcat', { hasText: 'Day care commissioning' });
  await expect(sub).toBeVisible();

  // Two articles in it, added out of order: listed A to Z.
  await sub.locator('> summary').click();
  for (const [title, body] of [
    ['Weekly returns', 'Send by Friday.'],
    ['Article 1', 'Step 1: open https://example.com/tool.\nStep 2: done'],
  ]) {
    await sub.locator('[data-kbnew]').first().click();
    await page.fill('#kbt', title);
    await page.fill('#kbb', body);
    await page.click('#kbform .btn.green');
    await expect(v.locator('.kbtitle')).toHaveText(title);
    await page.click('[data-kbback]');
  }
  // Sub-category is still open after saving (its parents were revealed).
  await expect(sub.locator('.kbrow')).toHaveText(['Article 1', 'Weekly returns']);
  await expect(v.locator('.kcat', { hasText: 'Processes' }).first().locator('> summary')).toHaveText(
    'Processes 2',
  );

  // Collapsing hides its contents.
  await v.locator('.kcat', { hasText: 'Processes' }).first().locator('> summary').click();
  await expect(sub).toBeHidden();
  await v.locator('.kcat', { hasText: 'Processes' }).first().locator('> summary').click();

  // Reading one: the text as written, with its link clickable and its place shown.
  await sub.locator('.kbrow', { hasText: 'Article 1' }).click();
  await expect(v.locator('.kbtrail')).toHaveText('Processes › Day care commissioning');
  await expect(v.locator('.kbtext a')).toHaveAttribute('href', 'https://example.com/tool');
  await expect(v.locator('.kbtext')).toContainText('Step 2: done');

  // Edit: rename and move it to Contacts.
  await page.click('[data-kbedit]');
  await page.fill('#kbt', 'Who manages day care');
  await page.selectOption('#kbc', { label: 'Contacts' });
  await page.click('#kbform .btn.green');
  await expect(v.locator('.kbtrail')).toHaveText('Contacts');
  const s = await app.state();
  expect(s.kb.find(a => a.title === 'Who manages day care').cat).toBe(
    s.kbcats.find(c => c.name === 'Contacts').id,
  );

  // Search finds it by its text, across categories.
  await page.click('[data-kbback]');
  await page.fill('#kbq', 'example.com');
  await expect(v.locator('#kbres .kbrow')).toHaveCount(1);
  await expect(v.locator('#kbres .kbrow')).toContainText('Who manages day care');
  await expect(v.locator('#kbtree')).toBeHidden();
  await page.fill('#kbq', '');
  await expect(v.locator('#kbtree')).toBeVisible();

  // Deleting a category takes what's in it (after a second tap), and can be undone.
  const del = v
    .locator('.kcat', { hasText: 'Processes' })
    .first()
    .locator('> .kbody > .links [data-kbdelcat]');
  await del.click();
  await expect(del).toHaveText('Delete it and 1 article?');
  await del.click();
  expect((await app.state()).kb.map(a => a.title)).toEqual(['Who manages day care']);
  expect((await app.state()).kbcats.map(c => c.name).sort()).toEqual(['Contacts', 'Tools']);
  await page.click('#undo');
  expect((await app.state()).kbcats).toHaveLength(4);
});

test('flows: a button per flow opens its Run URL; only Run URLs are accepted', async ({ app, page }) => {
  await app.go('knowledge');
  const v = page.locator('#v-knowledge');
  await page.fill('#flowname', 'Bad');
  await page.fill('#flowurl', 'javascript:alert(1)');
  await page.click('#flowform .btn');
  await expect(page.locator('#toast')).toContainText("isn't a Run URL");
  expect(((await app.state()) || {}).flows || []).toEqual([]);

  const url = 'ms-powerautomate:/console/flow/run?environmentid=abc&workflowid=123&source=Other';
  await page.fill('#flowname', 'Weekly report');
  await page.fill('#flowurl', url);
  await page.click('#flowform .btn');
  await page.fill('#flowname', 'Archive emails');
  await page.fill('#flowurl', url + '4');
  await page.click('#flowform .btn');
  await expect(v.locator('.flows a')).toHaveText(['Archive emails', 'Weekly report']);
  await expect(v.locator('.flows a', { hasText: 'Weekly report' })).toHaveAttribute('href', url);

  // Renamed in place; deleted after a second tap.
  await v.locator('[data-flowname]').first().fill('Archive inbox');
  await v.locator('[data-flowname]').first().press('Tab');
  await expect(v.locator('.flows a')).toHaveText(['Archive inbox', 'Weekly report']);
  await v.locator('[data-delflow]').first().click();
  await v.locator('[data-delflow]').first().click();
  expect((await app.state()).flows.map(f => f.name)).toEqual(['Weekly report']);
});

test('synced knowledge rows are cleaned: bad links dropped, orphans shown, loops broken', async ({
  app,
  page,
}) => {
  await page.evaluate(() => {
    norm({
      kbcats: [
        { id: 'a', name: 'A', parent: 'b' },
        { id: 'b', name: 'B', parent: 'a' },
      ],
      kb: [{ id: 'x', cat: 'gone', title: 'Lost one', body: '' }],
      flows: [
        { id: 'f1', name: 'Evil', url: 'javascript:alert(1)' },
        { id: 'f2', name: 'Quote', url: 'ms-powerautomate:/x"onclick="alert(1)' },
        { id: 'f3', name: 'Good', url: 'ms-powerautomate:/console/flow/run?workflowid=1' },
      ],
    });
    save();
    renderAll();
  });
  await app.go('knowledge');
  const s = await app.state();
  expect(s.flows.map(f => f.name)).toEqual(['Good']);
  expect(s.kbcats.some(c => !c.parent)).toBe(true);
  await expect(page.locator('#kc-lost > summary')).toHaveText('Uncategorised 1');
  // They sync as records of their own.
  const back = await page.evaluate(() => fromRecords(toRecords(S), S.day));
  expect(back.flows.map(f => f.id)).toEqual(['f3']);
  expect(back.kb.map(a => a.id)).toEqual(['x']);
  expect(back.kbcats).toHaveLength(2);
});

test('an article being written survives a background redraw', async ({ app, page }) => {
  await app.go('knowledge');
  await page.fill('#kbcatin', 'Processes');
  await page.press('#kbcatin', 'Enter');
  await page.click('#kbtree .kcat > summary');
  await page.click('[data-kbnew]');
  await page.fill('#kbt', 'Draft');
  await page.fill('#kbb', 'Half written');
  await page.locator('#kbt').focus();
  await page.evaluate(() => inBackground(renderAll));
  await expect(page.locator('#kbb')).toHaveValue('Half written');
  await expect(page.locator('#kbt')).toHaveValue('Draft');
});

test('a category can be moved into another, or back to the top level, but not into itself', async ({
  app,
  page,
}) => {
  await page.evaluate(() => {
    S.kbcats = [
      { id: 'p', name: 'Processes', parent: '' },
      { id: 'd', name: 'Day care', parent: '' },
      { id: 'x', name: 'Extra', parent: 'd' },
    ];
    save();
    renderAll();
  });
  await app.go('knowledge');
  await page.click('#kc-d > summary');
  await page.click('#kc-d > .kbody > .links [data-kbmove]');
  // Not into itself or its own sub-category.
  const opts = await page.$$eval('#kbmv option', o => o.map(x => x.textContent));
  expect(opts).toEqual(['Top level', 'Processes']);
  await page.selectOption('#kbmv', { label: 'Processes' });
  await page.click('[data-kbmvgo]');
  expect((await app.state()).kbcats.find(c => c.id === 'd').parent).toBe('p');
  await expect(page.locator('#kc-p #kc-d #kc-x')).toHaveCount(1);
  await expect(page.locator('#kc-d > summary')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Moved to Processes');
  await page.click('#kc-d > .kbody > .links [data-kbmove]');
  await page.selectOption('#kbmv', { label: 'Top level' });
  await page.click('[data-kbmvgo]');
  expect((await app.state()).kbcats.find(c => c.id === 'd').parent).toBe('');
});

test('articles can have pictures: pasted or added while writing, kept only on Save', async ({
  app,
  page,
}) => {
  await page.evaluate(() => {
    S.kbcats = [{ id: 'p', name: 'Processes', parent: '' }];
    save();
    renderAll();
  });
  await app.go('knowledge');
  await page.click('#kc-p > summary');
  await page.click('[data-kbnew]');
  await page.fill('#kbt', 'Guide');
  await page.fill('#kbb', 'Typed text');
  // Pasted into the article box: added below, and the text is left alone.
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    c.getContext('2d').fillRect(0, 0, 400, 300);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 's.png', { type: 'image/png' }));
    document
      .querySelector('#kbb')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#kbimgs img')).toHaveCount(1);
  await expect(page.locator('#kbb')).toHaveValue('Typed text');
  await expect(page.locator('#kbt')).toHaveValue('Guide');
  await page.click('#kbform .btn.green');
  let s = await app.state();
  expect(s.kb[0].imgs).toHaveLength(1);
  // Shown with the article; full size on a tap.
  await expect(page.locator('#v-knowledge .kbimgs img')).toHaveCount(1);
  await page.click('[data-kbimg]');
  await expect(page.locator('#v-knowledge .nimgfull img')).toBeVisible();
  await page.click('.nimgfull .btn[data-kbimgclose]');
  await expect(page.locator('#v-knowledge .nimgfull')).toHaveCount(0);
  // Removed while editing, then cancelled: still there.
  await page.click('[data-kbedit]');
  await page.click('[data-kbimgdel]');
  await expect(page.locator('#kbimgs img')).toHaveCount(0);
  await page.click('[data-kbcancel]');
  expect((await app.state()).kb[0].imgs).toHaveLength(1);
  // Removed and saved: gone. Pictures stay out of the snapshot history.
  await page.click('[data-kbedit]');
  await page.click('[data-kbimgdel]');
  await page.click('#kbform .btn.green');
  expect((await app.state()).kb[0].imgs).toEqual([]);
  // Rows with anything but a picture are dropped.
  const n = await page.evaluate(() => {
    norm({ kb: [{ id: 'z', cat: '', title: 't', body: '', imgs: [{ id: 'm', src: 'javascript:1' }] }] });
    return S.kb[0].imgs.length;
  });
  expect(n).toBe(0);
});

test('a flow remembers when its button was last used', async ({ app, page }) => {
  await page.evaluate(() => {
    S.flows = [{ id: 'f', name: 'Report', url: 'ms-powerautomate:/console/flow/run?workflowid=1' }];
    save();
    renderAll();
  });
  await app.go('knowledge');
  await expect(page.locator('.flow small')).toHaveText('Not used yet');
  // (the link itself can't open here: just the tap is checked)
  await page.evaluate(() => {
    const a = document.querySelector('a[data-flow]');
    a.addEventListener('click', e => e.preventDefault());
    a.click();
  });
  await expect(page.locator('.flow small')).toContainText('Last used Today');
  expect((await app.state()).flows[0].last).toBeGreaterThan(0);
});

test('bug fixes: editor keeps typed text through redraws; limits; links; overlays close', async ({
  app,
  page,
}) => {
  await page.evaluate(() => {
    S.kbcats = [{ id: 'p', name: 'Processes', parent: '' }];
    S.quests = [fix({ id: 'q', text: 'Something' })];
    save();
    renderAll();
  });
  await app.go('knowledge');
  await page.click('#kc-p > summary');
  await page.click('[data-kbnew]');
  await page.fill('#kbt', 'Draft title');
  await page.fill('#kbb', 'Draft body');
  // A redraw after a tap elsewhere (here: ticking the header's next step) keeps the draft.
  await page.click('header [data-toggle]');
  await expect(page.locator('#kbt')).toHaveValue('Draft title');
  await expect(page.locator('#kbb')).toHaveValue('Draft body');
  await expect(page.locator('#kbb')).toHaveAttribute('maxlength', '50000');
  await page.click('#kbform .btn.green');

  // Links: brackets that belong to the link stay; an & stays part of it; a full stop after doesn't.
  const html = await page.evaluate(() =>
    kbLinkify('See https://en.wikipedia.org/wiki/Foo_(bar). Or (https://x.com/a?b=1&c=2), ok'),
  );
  expect(html).toContain('href="https://en.wikipedia.org/wiki/Foo_(bar)"');
  expect(html).toContain('href="https://x.com/a?b=1&amp;c=2"');
  expect(html).toContain('</a>), ok');

  // A picture shown full size closes with Escape.
  await page.evaluate(() => {
    S.noteImgs = [{ id: 'm', src: 'data:image/png;base64,iVBORw0KGgo=', at: 1 }];
    save();
    renderAll();
  });
  await app.go('notes');
  await page.click('[data-nimg]');
  await expect(page.locator('.nimgfull')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.nimgfull')).toHaveCount(0);

  // A flow time that can't be right isn't shown.
  const last = await page.evaluate(() => {
    norm({ flows: [{ id: 'f', name: 'x', url: 'ms-powerautomate:/a', last: 9e15 }] });
    return S.flows[0].last;
  });
  expect(last).toBe(0);
});

test('bug fixes: restoring a copy from before Knowledge keeps it; odd synced rows do not break search', async ({
  app,
  page,
}) => {
  await page.evaluate(() => {
    S.kbcats = [{ id: 'p', name: 'Processes', parent: '' }];
    S.kb = [{ id: 'a', cat: 'p', title: 'Guide', body: '', imgs: [] }];
    save();
    const old = JSON.parse(JSON.stringify(S));
    delete old.kb;
    delete old.kbcats;
    delete old.flows;
    pending = old;
    renderAccount();
  });
  await app.go('account');
  await page.click('#doRestore');
  const s = await app.state();
  expect(s.kb.map(a => a.title)).toEqual(['Guide']);
  expect(s.kbcats).toHaveLength(1);

  const r = await page.evaluate(() => {
    S.quests.push(fix({ id: 'n', text: 42 }));
    S.later.push({ id: 'l', text: 'budget later', children: [] });
    S.log.push({ id: 'x', text: 'budget', trail: 'oops' }, { id: 'y', text: 'budget two', trail: [] });
    S.notes = 5;
    searchQ = 'budget';
    const a = searchResults();
    searchQ = '42';
    const b = searchResults();
    return [a.includes('budget later'), b.includes('42')];
  });
  expect(r).toEqual([true, true]);
  // Snippets mark what matched, whatever the case, spacing or characters around it.
  const sn = await page.evaluate(() => [
    snippet('İ'.repeat(60) + ' foo bar', 'foo'),
    snippet('hello foo  bar world', 'foo bar'),
  ]);
  expect(sn[0]).toContain('<mark>foo</mark>');
  expect(sn[1]).toContain('<mark>foo bar</mark>');
});

test('review round 3: a background redraw leaves an article being written alone', async ({ app, page }) => {
  await page.evaluate(() => {
    S.kbcats = [{ id: 'p', name: 'Processes', parent: '' }];
    save();
    renderAll();
  });
  await app.go('knowledge');
  await page.click('#kc-p > summary');
  await page.click('[data-kbnew]');
  await page.fill('#kbb', 'x\n'.repeat(200));
  const same = await page.evaluate(() => {
    const box = document.querySelector('#kbb');
    box.scrollTop = 2000;
    inBackground(renderAll);
    return document.querySelector('#kbb') === box && box.scrollTop > 0;
  });
  expect(same).toBe(true);
});
