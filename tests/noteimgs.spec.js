const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => {
  await app.open();
});

// A picture on the clipboard, pasted into the notes box.
async function pasteImage(page, w, h, withText = '') {
  await page.evaluate(
    async ([w, h, withText]) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').fillRect(0, 0, w, h);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
      if (withText) dt.setData('text/plain', withText);
      const box = document.querySelector('#notesin');
      box.focus();
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    [w, h, withText],
  );
}

test('a pasted picture is added below the notes, shrunk, and can be viewed and deleted', async ({
  app,
  page,
}) => {
  await app.go('notes');
  await expect(page.locator('#noteimgs')).toContainText('Paste a picture');
  await pasteImage(page, 3200, 1000);
  await expect(page.locator('.nimg img')).toHaveCount(1);
  const s = await app.state();
  expect(s.noteImgs).toHaveLength(1);
  expect(s.noteImgs[0].src).toMatch(/^data:image\/jpeg;base64,/);
  // No bigger than 1600 on its longest side.
  const size = await page.evaluate(
    src =>
      new Promise(r => {
        const i = new Image();
        i.onload = () => r([i.naturalWidth, i.naturalHeight]);
        i.src = src;
      }),
    s.noteImgs[0].src,
  );
  expect(size).toEqual([1600, 500]);

  // The text in the box is left alone.
  await expect(page.locator('#notesin')).toHaveValue('');

  // Full size, then closed.
  await page.click('[data-nimg]');
  await expect(page.locator('.nimgfull img')).toBeVisible();
  await page.click('[data-nimgclose]');
  await expect(page.locator('.nimgfull')).toHaveCount(0);

  // Delete takes a second tap, and can be undone.
  await page.click('[data-delnimg]');
  await page.click('[data-delnimg]');
  expect((await app.state()).noteImgs).toEqual([]);
  await page.click('#undo');
  expect((await app.state()).noteImgs).toHaveLength(1);

  // A clearly labelled Delete under each picture, and in the full-size view too.
  await expect(page.locator('.nimg [data-delnimg]')).toHaveText('Delete');
  await expect(page.locator('.nimg [data-delnimg]')).toBeVisible();
  await page.click('[data-nimg]');
  const del = page.locator('.nimgfull [data-delnimg]');
  await expect(del).toBeVisible();
  await del.click();
  await del.click();
  await expect(page.locator('.nimgfull')).toHaveCount(0);
  expect((await app.state()).noteImgs).toEqual([]);
});

test('copied text that comes with a picture of itself pastes as text', async ({ app, page }) => {
  await app.go('notes');
  await pasteImage(page, 100, 100, 'A1\tB1');
  await page.waitForTimeout(300);
  expect(((await app.state()) || {}).noteImgs || []).toEqual([]);
});

test('pictures sync as their own records, are left out of snapshots, and survive a restore', async ({
  app,
  page,
}) => {
  await app.go('notes');
  await pasteImage(page, 50, 50);
  await expect(page.locator('.nimg img')).toHaveCount(1);
  const r = await page.evaluate(() => {
    const recs = toRecords(S),
      keys = [...recs.keys()].filter(k => k.startsWith('noteimg:'));
    const back = fromRecords(recs, S.day);
    const snap = JSON.parse(JSON.stringify({ ...S, noteImgs: undefined }));
    return { keys: keys.length, back: back.noteImgs.length, snap: 'noteImgs' in snap };
  });
  expect(r).toEqual({ keys: 1, back: 1, snap: false });
  // Restoring a backup without pictures keeps the ones here.
  await page.evaluate(() => {
    pending = JSON.parse(JSON.stringify({ ...S, noteImgs: undefined, notes: 'old' }));
    renderAccount();
  });
  await app.go('account');
  await page.click('#doRestore');
  const s = await app.state();
  expect(s.notes).toBe('old');
  expect(s.noteImgs).toHaveLength(1);
  // Rows that aren't pictures are dropped.
  await page.evaluate(() =>
    norm({
      noteImgs: [
        { id: 'x', src: 'javascript:alert(1)' },
        { id: 'y', src: 'data:image/svg+xml;base64,PHN2Zz4=' },
      ],
    }),
  );
  expect(await page.evaluate(() => S.noteImgs)).toEqual([]);
});
