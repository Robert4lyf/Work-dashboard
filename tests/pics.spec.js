const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => {
  await app.open();
});

const PIC = 'data:image/png;base64,' + 'A'.repeat(2000);
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('work-cockpit-v1')));
const stored = page => page.waitForFunction(() => allPics().every(p => picStored.has(p.id)));

test('pictures are kept in IndexedDB: the saved copy leaves their data out, and a reload brings them back', async ({
  page,
}) => {
  await page.evaluate(pic => {
    S.noteImgs = [{ id: 'n1', src: pic, at: 1 }];
    S.kb = [{ id: 'a', cat: '', title: 'T', body: '', edited: 1, imgs: [{ id: 'k1', src: pic, at: 1 }] }];
    save();
  }, PIC);
  await stored(page);
  const s = await saved(page);
  expect(s.noteImgs[0].src).toBeUndefined();
  expect(s.kb[0].imgs[0].src).toBeUndefined();
  expect(JSON.stringify(s).length).toBeLessThan(PIC.length);
  await page.reload();
  const back = await page.evaluate(() => [S.noteImgs[0].src.length, S.kb[0].imgs[0].src.length]);
  expect(back).toEqual([PIC.length, PIC.length]);
  // Deleted (and past undo): gone from IndexedDB too.
  await page.evaluate(() => {
    S.noteImgs = [];
    save();
    dropUndo();
    prunePics();
  });
  await page.waitForFunction(() => !picStored.has('n1'));
  await page.reload();
  expect(await page.evaluate(() => S.noteImgs.length)).toBe(0);
});

test('a picture saved before this version (data in the saved copy) moves to IndexedDB', async ({ page }) => {
  await page.evaluate(pic => {
    const s = JSON.parse(localStorage.getItem('work-cockpit-v1')) || {};
    s.noteImgs = [{ id: 'old', src: pic, at: 1 }];
    localStorage.setItem('work-cockpit-v1', JSON.stringify(s));
  }, PIC);
  await page.reload();
  expect(await page.evaluate(() => S.noteImgs[0].src.length)).toBe(PIC.length);
  await page.evaluate(() => save());
  await stored(page);
  expect((await saved(page)).noteImgs[0].src).toBeUndefined();
});

test('a picture whose data is missing on this device is fetched again, not deleted', async ({ page }) => {
  await page.evaluate(pic => {
    S.noteImgs = [{ id: 'n1', src: pic, at: 1 }];
    save();
    sync2.synced['noteimg:n1'] = 'h';
    sync2.kbimg = 1;
    saveSyncState();
  }, PIC);
  await stored(page);
  // The picture's data goes (site data partly cleared).
  await page.evaluate(
    () =>
      new Promise(ok => {
        const tx = picDb.transaction('pics', 'readwrite');
        tx.objectStore('pics').delete('n1');
        tx.oncomplete = ok;
      }),
  );
  await page.reload();
  const r = await page.evaluate(() => ({
    pics: S.noteImgs.length,
    synced: 'noteimg:n1' in sync2.synced,
    tomb: !!sync2.dirty['noteimg:n1'],
    catchUp: !sync2.kbimg,
  }));
  expect(r).toEqual({ pics: 0, synced: false, tomb: false, catchUp: true });
});

test('Android back: steps back through the app, and only leaves it from Today’s list', async ({
  app,
  page,
}) => {
  await page.evaluate(() => {
    S.quests = [fix({ id: 'q', text: 'Quest', children: [fix({ id: 's', text: 'Step' })] })];
    save();
    renderAll();
  });
  await app.openQuest('Quest');
  await app.go('inbox');
  await page.goBack();
  await expect(page.locator('#v-today')).toBeVisible();
  await expect(page.locator('#v-today .crumbs, #v-today [data-crumb]').first()).toBeVisible();
  await page.goBack();
  await expect(page.locator('#v-today .open >> text="Quest"')).toBeVisible();
  // A picture shown full size closes first.
  await page.evaluate(() => {
    S.noteImgs = [{ id: 'm', src: 'data:image/png;base64,iVBORw0KGgo=', at: 1 }];
    save();
  });
  await app.go('notes');
  await page.click('[data-nimg]');
  await page.goBack();
  await expect(page.locator('.nimgfull')).toHaveCount(0);
  await expect(page.locator('#v-notes')).toBeVisible();
});

test('an article left half-written when the app closes comes back', async ({ app, page }) => {
  await page.evaluate(() => {
    S.kbcats = [{ id: 'p', name: 'Processes', parent: '' }];
    save();
    renderAll();
  });
  await app.go('knowledge');
  await page.click('#kc-p > summary');
  await page.click('[data-kbnew]');
  await page.fill('#kbt', 'Half');
  await page.fill('#kbb', 'written');
  await page.evaluate(() => keepKbDraft()); // (as when the app is left)
  await page.reload();
  await expect(page.locator('#kbt')).toHaveValue('Half');
  await expect(page.locator('#kbb')).toHaveValue('written');
  await page.click('#kbform .btn.green');
  await page.reload();
  await expect(page.locator('#kbform')).toHaveCount(0);
});

test('a tag being renamed isn’t put onto another tag when the list changes meanwhile', async ({
  app,
  page,
}) => {
  await app.go('account');
  await page.fill('[data-tagname="0"]', 'Zed');
  await page.evaluate(() => {
    S.tags.shift();
    inBackground(renderAll);
  });
  await page.locator('[data-tagname="0"]').press('Tab');
  const names = await page.evaluate(() => S.tags.map(t => t.name));
  expect(names).not.toContain('Zed');
});

test('text the database can’t hold is dropped where it’s typed: notes, tag names', async ({ app, page }) => {
  await app.go('notes');
  await page.evaluate(() => {
    const box = document.querySelector('#notesin');
    box.value = 'hello\u0000world';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    saveNotesNow();
  });
  expect(await page.evaluate(() => [S.notes, document.querySelector('#notesin').value])).toEqual([
    'helloworld',
    'helloworld',
  ]);
  const tag = await page.evaluate(() => {
    norm({
      tags: [{ name: 'x\u0000y', color: '#C2C3C7' }],
      quests: [fix({ id: 'q', text: 'q', tag: 'x\u0000y' })],
    });
    return [S.tags[0].name, S.quests[0].tag];
  });
  expect(tag).toEqual(['xy', 'xy']);
});
