const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => {
  await app.open();
});

const PIC = 'data:image/png;base64,' + 'A'.repeat(2000);
const saved = page => page.evaluate(() => storeDone().then(readSaved));
const savedLen = page =>
  page.evaluate(() =>
    storeDone()
      .then(() => readKV(picDb))
      .then(kv => kv.state.length),
  );
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
  await page.evaluate(
    pic =>
      new Promise(ok => {
        const s = JSON.parse(JSON.stringify(S));
        s.noteImgs = [{ id: 'old', src: pic, at: 1 }];
        const tx = picDb.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(JSON.stringify(s), 'state');
        tx.oncomplete = ok;
      }),
    PIC,
  );
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

test('round 6: many pictures at once still save (they move to IndexedDB first), and a reload moves the rest', async ({
  page,
}) => {
  // More than localStorage could hold with their data: still saved, in full, and synced.
  await page.evaluate(() => {
    const big = 'data:image/png;base64,' + 'A'.repeat(1e6);
    S.noteImgs = Array.from({ length: 12 }, (_, i) => ({ id: 'b' + i, src: big + i, at: i }));
    save();
  });
  await page.waitForFunction(() => localSaved && allPics().every(p => picStored.has(p.id)));
  expect(await savedLen(page)).toBeLessThan(100000);
  expect(
    await page.evaluate(() => Object.keys(sync2.dirty).filter(k => k.startsWith('noteimg:')).length),
  ).toBe(12);
  // A picture saved in the copy (a reload before it was stored, or an older version): moved on start.
  await page.evaluate(
    () =>
      new Promise(ok => {
        const s = JSON.parse(JSON.stringify(S));
        s.noteImgs.push({ id: 'late', src: 'data:image/png;base64,' + 'B'.repeat(200000), at: 99 });
        const tx = picDb.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(JSON.stringify(s), 'state');
        tx.oncomplete = ok;
      }),
  );
  await page.reload();
  await page.waitForFunction(() => picStored.has('late'));
  expect(await savedLen(page)).toBeLessThan(100000);
});

test('round 6: back while an alarm rings stays in the app; reloads don’t pile up history entries', async ({
  app,
  page,
}) => {
  const before = await page.evaluate(() => history.length);
  await page.reload();
  await page.reload();
  expect(await page.evaluate(() => history.length)).toBe(before);
  await page.evaluate(() => {
    document.querySelector('#v-alarm').hidden = false;
  });
  await page.goBack();
  await expect(page.locator('#v-alarm')).toBeVisible();
  expect(page.url()).toContain('localhost');
});

test('round 6: taps before the app has started do nothing (no errors); a draft’s deleted category falls back', async ({
  page,
}) => {
  await page.evaluate(() => {
    S.kbcats = [{ id: 'a', name: 'A', parent: '' }];
    save();
    localStorage.setItem('dashboard-kbdraft', JSON.stringify({ cat: 'zzz', title: 'D', body: 'b' }));
  });
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...a) => {
      const r = open(...a);
      const d = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess');
      let cb = null;
      Object.defineProperty(r, 'onsuccess', {
        set: v => (cb = v),
        get: () => cb,
      });
      r.addEventListener('success', e => setTimeout(() => cb && cb(e), 800));
      return r;
    };
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.click('nav [data-v=inbox]');
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.appReady === true);
  expect(errors).toEqual([]);
  await expect(page.locator('#kbc')).toHaveValue('a');
});

test('stage 2: the saved copy and sync bookkeeping live in the store; an older localStorage copy moves over once', async ({
  page,
}) => {
  await page.evaluate(() => {
    S.quests = [fix({ id: 'q', text: 'Kept' })];
    save();
  });
  await page.evaluate(() => storeDone());
  // Nothing of the app's data is in localStorage any more.
  expect(
    await page.evaluate(() => [
      localStorage.getItem('work-cockpit-v1'),
      localStorage.getItem('work-cockpit-v1-sync'),
    ]),
  ).toEqual([null, null]);
  await page.reload();
  expect(await page.evaluate(() => S.quests.map(q => q.text))).toEqual(['Kept']);
  // A device from before (data in localStorage, nothing in the store): taken in, then removed.
  await page.evaluate(
    () =>
      new Promise(ok => {
        localStorage.setItem(
          'work-cockpit-v1',
          JSON.stringify({ ...JSON.parse(JSON.stringify(S)), quests: [fix({ id: 'o', text: 'Older' })] }),
        );
        localStorage.setItem(
          'work-cockpit-v1-sync',
          JSON.stringify({ cursor: 7, synced: {}, dirty: {}, snapAt: 0 }),
        );
        const r = indexedDB.deleteDatabase('dashboard-pics');
        r.onsuccess = r.onerror = r.onblocked = ok;
      }),
  );
  await page.reload();
  expect(await page.evaluate(() => [S.quests.map(q => q.text), sync2.cursor])).toEqual([['Older'], 7]);
  await page.waitForFunction(() => localStorage.getItem('work-cockpit-v1') === null);
  await page.reload();
  expect(await page.evaluate(() => [S.quests.map(q => q.text), sync2.cursor])).toEqual([['Older'], 7]);
});
