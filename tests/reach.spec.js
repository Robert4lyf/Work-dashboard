const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const webpush = require('web-push');

// Minimal stand-in for Supabase: signed in, an in-memory notices table.
function fakeSupabase() {
  const notices = (window.__notices = []);
  const table = name => {
    const q = { f: [] };
    const run = () => {
      if (name !== 'cockpit_notices') return [];
      return notices.filter(r => q.f.every(fn => fn(r)));
    };
    const api = {
      select: () => api,
      eq: (k, v) => (q.f.push(r => r[k] === v), api),
      is: (k, v) => (q.f.push(r => (r[k] ?? null) === v), api),
      in: (k, vs) => (q.f.push(r => vs.includes(r[k])), api),
      neq: () => api,
      gt: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async rows => {
        if (name === 'cockpit_notices')
          [].concat(rows).forEach(r => {
            const i = notices.findIndex(n => n.key === r.key);
            if (i >= 0) notices[i] = { ...notices[i], ...r };
            else notices.push({ sent_at: null, ...r });
          });
        return { error: null };
      },
      delete: () => {
        q.del = true;
        return api;
      },
      then(res, rej) {
        if (q.del) {
          const gone = run(),
            keep = notices.filter(n => !gone.includes(n));
          notices.length = 0;
          notices.push(...keep);
          return Promise.resolve({ error: null }).then(res, rej);
        }
        return Promise.resolve({ data: run(), error: null }).then(res, rej);
      },
    };
    return api;
  };
  window.supabase = {
    createClient: () => ({
      auth: {
        onAuthStateChange(cb) {
          setTimeout(() => cb('INITIAL_SESSION', { user: { id: 'u1', email: 'me@example.com' } }), 0);
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
      from: table,
      rpc: async () => ({ data: null, error: null }),
      channel() {
        const c = { on: () => c, subscribe: () => c };
        return c;
      },
      removeChannel() {},
    }),
  };
}

async function open(browser, time) {
  const ctx = await browser.newContext({ timezoneId: 'Europe/London', locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(
    u => !u.href.startsWith('http://localhost'),
    r => r.abort(),
  );
  await page.clock.install({ time });
  await page.addInitScript(fakeSupabase);
  await page.goto('/');
  await expect(page.locator('#syncBtn')).toHaveText('Synced');
  return { page, errors };
}

test('notices queued for the timer, deadlines and Upcoming, and kept in step', async ({ browser }) => {
  const { page, errors } = await open(browser, new Date('2026-09-23T08:00:00+01:00'));
  await page.evaluate(() => {
    S.pushKey = 'x';
    S.quests.push(fix({ id: 'q1', text: 'Report', due: '2026-09-24' }));
    S.later.push(fix({ id: 'l1', text: 'Book venue', start: '2026-09-25' }));
    S.timer = { end: Date.now() + 25 * 60e3, mins: 25, tag: 'Design', q: null };
    save();
  });
  await page.evaluate(() => syncNotices());
  let keys = (await page.evaluate(() => window.__notices)).map(n => n.key).sort();
  expect(keys).toEqual([
    'due:q1:2026-09-24',
    'start:l1:2026-09-25',
    'timer:' + (await page.evaluate(() => S.timer.end)),
  ]);
  const due = (await page.evaluate(() => window.__notices)).find(n => n.key.startsWith('due:'));
  expect(new Date(due.at).toISOString()).toBe('2026-09-24T08:00:00.000Z'); // 9am UK time
  // Finishing the quest and stopping the timer removes their notices.
  await page.evaluate(() => {
    S.quests[0].done = true;
    S.timer = null;
    save();
  });
  await page.evaluate(() => syncNotices());
  keys = (await page.evaluate(() => window.__notices)).map(n => n.key);
  expect(keys).toEqual(['start:l1:2026-09-25']);
  expect(errors).toEqual([]);
});

test('keys generated in the browser work with the server-side push library', async ({ browser }) => {
  const { page } = await open(browser, new Date('2026-09-23T08:00:00+01:00'));
  await page.click('nav [data-v=account]');
  await page.click('#pushkeys');
  const pub = await page.locator('.banner code').nth(0).innerText(),
    priv = await page.locator('.banner code').nth(1).innerText();
  expect(await page.evaluate(() => S.pushKey)).toBe(pub);
  webpush.setVapidDetails('mailto:me@example.com', pub, priv);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const details = webpush.generateRequestDetails(
    {
      endpoint: 'https://push.example.com/abc',
      keys: { p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
    },
    JSON.stringify({ title: 'Hi' }),
  );
  expect(details.headers.Authorization).toMatch(/^vapid t=.+, k=/);
  expect(details.body.length).toBeGreaterThan(0);
});

test('send-notices: sends due notices, skips stale ones, forgets gone devices', async () => {
  const { sendDue } = await import('../supabase/functions/send-notices/core.mjs');
  const now = new Date('2026-09-23T09:00:00Z');
  const db = {
    notices: [
      {
        user_id: 'u1',
        key: 'a',
        at: '2026-09-23T08:59:00Z',
        title: 'Due today',
        body: 'Report',
        sent_at: null,
      },
      { user_id: 'u1', key: 'old', at: '2026-09-22T20:00:00Z', title: 'Old', body: '', sent_at: null },
      { user_id: 'u1', key: 'later', at: '2026-09-23T10:00:00Z', title: 'Later', body: '', sent_at: null },
      { user_id: 'u2', key: 'lonely', at: '2026-09-23T08:59:00Z', title: 'Hi', body: '', sent_at: null },
    ],
    subs: [
      { endpoint: 'e1', user_id: 'u1', p256dh: 'p', auth: 'a' },
      { endpoint: 'gone', user_id: 'u1', p256dh: 'p', auth: 'a' },
    ],
    from(t) {
      const self = this,
        f = [];
      let upd = null,
        del = false;
      const rows = () =>
        (t === 'cockpit_notices' ? self.notices : self.subs).filter(r => f.every(fn => fn(r)));
      const api = {
        select: () => api,
        is: (k, v) => (f.push(r => r[k] === v), api),
        lte: (k, v) => (f.push(r => r[k] <= v), api),
        eq: (k, v) => (f.push(r => r[k] === v), api),
        in: (k, vs) => (f.push(r => vs.includes(r[k])), api),
        limit: () => api,
        update: v => ((upd = v), api),
        delete: () => ((del = true), api),
        then(res) {
          if (upd) rows().forEach(r => Object.assign(r, upd));
          if (del) self.subs = self.subs.filter(r => !rows().includes(r));
          return Promise.resolve({ data: rows(), error: null }).then(res);
        },
      };
      return api;
    },
  };
  const sent = [];
  const push = {
    sendNotification: async (sub, payload) => {
      if (sub.endpoint === 'gone') throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push([sub.endpoint, JSON.parse(payload)]);
    },
  };
  const r = await sendDue({ db, push, now, log: { warn() {} } });
  expect(r).toEqual({ sent: 1, skipped: 1, removed: 1 });
  expect(sent).toEqual([['e1', { title: 'Due today', body: 'Report', tag: 'a' }]]);
  expect(
    db.notices
      .filter(n => n.sent_at)
      .map(n => n.key)
      .sort(),
  ).toEqual(['a', 'lonely', 'old']);
  expect(db.subs.map(s => s.endpoint)).toEqual(['e1']);
  // Why a notice didn't go out is kept on it, for the app's test to show.
  expect(db.notices.find(n => n.key === 'a').error).toBeNull();
  expect(db.notices.find(n => n.key === 'lonely').error).toBe('no devices have notifications turned on');
});

test('lost the private key: New keys makes a fresh pair after a confirm', async ({ browser }) => {
  const { page, errors } = await open(browser, new Date('2026-09-23T08:00:00+01:00'));
  await page.evaluate(() => {
    S.pushKey = 'old-key';
    save();
  });
  await page.click('nav [data-v=account]');
  await expect(page.locator('#pushkeys')).toHaveCount(0);
  await page.click('#pushnewkeys');
  await expect(page.locator('#pushnewkeys')).toHaveText('Replace keys?');
  expect(await page.evaluate(() => S.pushKey)).toBe('old-key');
  await page.click('#pushnewkeys');
  await expect(page.locator('.banner code')).toHaveCount(2);
  const pub = await page.locator('.banner code').nth(0).innerText();
  expect(pub).not.toBe('old-key');
  expect(await page.evaluate(() => S.pushKey)).toBe(pub);
  await expect(page.locator('#pushnewkeys')).toHaveCount(0); // hidden while the new pair shows
  expect(errors).toEqual([]);
});
