// Release H: the final mile. Checkpoint 1: Today on a phone, a busy day (Scenario A).
const { test, expect } = require('./fixtures');
const { gDay } = require('./releasegdata');

async function day(app, page, at = new Date(2026, 10, 4, 11, 0)) {
  await page.clock.install({ time: at });
  await app.open();
  await app.setState(gDay);
  await page.reload();
}
// (more scheduled for today, so there's something to fold: two later meetings)
const moreMeetings = page =>
  page.evaluate(() => {
    ['15:30', '16:30'].forEach((time, i) =>
      S.quests.push({
        id: 'mx' + i,
        text: 'Meeting ' + (i + 1),
        done: false,
        children: [],
        scheduled: { date: today(), time },
      }),
    );
    norm(S);
    save();
    renderAll();
  });
const shownRows = (page, sec) =>
  page.$$eval(`#v-today .${sec} .secrow`, rs =>
    rs.filter(r => r.checkVisibility()).map(r => r.querySelector('.open > span').textContent),
  );

test.describe('Checkpoint 1: Today on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a line at the top says what is further down; a tap goes to the section, the keyboard with it', async ({
    app,
    page,
  }) => {
    await day(app, page);
    const jump = page.locator('#v-today > .tjump');
    await expect(jump).toBeVisible();
    await expect(jump.locator('[data-jump]')).toHaveText(['Scheduled 3↓', 'Waiting 4↓', 'Tasks 25↓']);
    // On the first screen, above the tab bar.
    const box = await jump.boundingBox();
    expect(box.y + box.height).toBeLessThan(844 - 64);
    for (const [k, id] of [
      ['Tasks', 'taskshead'],
      ['Waiting', 'waithead'],
      ['Scheduled', 'schedhead'],
    ]) {
      await page.evaluate(() => scrollTo(0, 0));
      await jump.locator(`[data-jump="${id}"]`).click();
      await expect(page.locator('#' + id)).toBeFocused();
      const top = await page.$eval('#' + id, h => h.closest('.sechead').getBoundingClientRect().top);
      expect(Math.abs(top - 8), k).toBeLessThan(3);
    }
    // Nothing changed, nothing saved: only where the page is.
    expect(app.errors).toEqual([]);
  });

  test('Waiting: the most urgent shown, the rest a tap away with how many are due a chase; kept open or folded', async ({
    app,
    page,
  }) => {
    await day(app, page);
    expect(await shownRows(page, 'waitsec2')).toEqual(['Hear back on figures']);
    const more = page.locator('#waitmore');
    await expect(more.locator('> summary')).toHaveText('3 more 2 to chase');
    await expect(page.locator('#v-today .wrow')).toHaveCount(4); // (all there, three folded)
    await more.locator('> summary').click();
    expect((await shownRows(page, 'waitsec2')).length).toBe(4);
    // Open stays open through a redraw, a sync's redraw and a reload.
    await page.evaluate(() => renderAll());
    await page.evaluate(() => inBackground(renderAll));
    await expect(more).toHaveAttribute('open', '');
    await page.reload();
    await expect(page.locator('#waitmore')).toHaveAttribute('open', '');
    await page.locator('#waitmore > summary').click();
    await page.reload();
    await expect(page.locator('#waitmore')).not.toHaveAttribute('open', '');
    expect(app.errors).toEqual([]);
  });

  test('Scheduled: any whose time went by unrecorded, then the next; the rest a tap away with their times', async ({
    app,
    page,
  }) => {
    await day(app, page);
    // Three: one past, the next, one at any time. One left over isn't folded (it would take
    // nearly the room of its row).
    expect(await shownRows(page, 'schedsec')).toHaveLength(3);
    await expect(page.locator('#schedmore')).toHaveCount(0);
    await moreMeetings(page);
    const shown = await shownRows(page, 'schedsec');
    expect(shown).toHaveLength(2);
    await expect(page.locator('#v-today .schedsec .secrow').first()).toContainText('Time passed');
    await expect(page.locator('#v-today .schedsec .secrow').nth(1)).toContainText('14:00');
    await expect(page.locator('#schedmore > summary')).toHaveText('3 more 15:30, 16:30, Any time');
    // At 14:05 the 14:00 one waits to be recorded, and 15:30 is next.
    await page.clock.setFixedTime(new Date(2026, 10, 4, 14, 5));
    await page.evaluate(() => renderAll());
    await expect(page.locator('#schedmore > summary')).toHaveText('2 more 16:30, Any time');
    expect(app.errors).toEqual([]);
  });

  test('two columns show the whole of Scheduled and Waiting, with no jump line', async ({ app, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await day(app, page);
    await moreMeetings(page);
    await expect(page.locator('#v-today .tjump')).toHaveCount(0);
    await expect(page.locator('#schedmore, #waitmore')).toHaveCount(0);
    expect(await shownRows(page, 'waitsec2')).toHaveLength(4);
    expect(await shownRows(page, 'schedsec')).toHaveLength(5);
  });

  test('Find reaches a finished task: Done today opens for it, and closes again after', async ({
    app,
    page,
  }) => {
    await day(app, page);
    await page.evaluate(() => {
      S.quests.find(q => q.text === 'Book room for team away day').done = true;
      save();
      renderAll();
    });
    await expect(page.locator('#donesec')).not.toHaveAttribute('open', '');
    await page.click('[data-tfindopen]');
    await page.keyboard.type('book room');
    await expect(page.locator('#donesec')).toHaveAttribute('open', '');
    await expect(page.locator('#donesec .row .open > span')).toHaveText('Book room for team away day');
    await expect(page.locator('#v-today .tnomatch')).toBeHidden();
    await page.fill('#tfind', '');
    await expect(page.locator('#donesec')).not.toHaveAttribute('open', '');
    // (and that wasn't remembered as opened)
    await page.evaluate(() => renderAll());
    await expect(page.locator('#donesec')).not.toHaveAttribute('open', '');
  });

  test("Today's tasks start well up the page", async ({ app, page }) => {
    await day(app, page);
    // (Release G: 1,701px on this day at 390 × 844)
    const y = await page.$eval('#v-today .list', e => e.getBoundingClientRect().top + scrollY);
    expect(y).toBeLessThan(1500);
  });
});
