#!/usr/bin/env node
// Release G performance bench: loads each dataset (tests/perf/data.js) into the app, served from
// this checkout, and times what a user does: opening the app, Today's redraws, tab switches, a
// search keystroke, saving, the sync bookkeeping and taking in synced rows. Median of N runs, at a
// phone-sized viewport (390x844), unthrottled and with the CPU slowed x4 (the realistic phone
// figure). Optionally profiles the slow operations (CDP Profiler, hot functions by self and total
// time) and counts calls of the usual suspects (find, taskState, top3State...).
//
//   node tests/perf/bench.js                         everything (about 10 minutes)
//   node tests/perf/bench.js --sizes=busy,heavy --throttle=4 --runs=3 --no-profile
//   options: --sizes= --throttle= --runs= --port= --no-profile --no-instrument
//            --out=<md file> (default docs/ux/release-g-perf-baseline.md; the generated part sits
//            between the bench:start and bench:end markers, so notes around it are kept)
//            --json=<file> (also write the raw results there)
//            --from-json=a.json,b.json (no run: the report again from saved results; given several,
//            each figure is the lowest of their medians, which on a shared, busy machine is the run
//            least slowed by other work; call counts and profiles come from the first)
//
// Not a Playwright test (it isn't run by `npx playwright test`): a plain Node script using the
// pinned Playwright library, from this checkout's node_modules or the main checkout's.
const path = require('path');
const fs = require('fs');
const http = require('http');
const { SIZES, dataset } = require('./data');

const ROOT = path.resolve(__dirname, '../..');
const pw = (() => {
  for (const p of [
    path.join(ROOT, 'node_modules/playwright'),
    '/home/user/Work-dashboard/node_modules/playwright',
  ])
    try {
      return require(p);
    } catch (e) {}
  return require('playwright');
})();
const CHROMIUM = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

const arg = (k, d) => {
  const a = process.argv.find(x => x === '--' + k || x.startsWith('--' + k + '='));
  if (!a) return d;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};
const OPT = {
  sizes: String(arg('sizes', 'typical,busy,heavy,extreme')).split(','),
  throttle: String(arg('throttle', '1,4')).split(',').map(Number),
  runs: Number(arg('runs', 5)),
  port: Number(arg('port', 4231)),
  profile: !arg('no-profile', false),
  instrument: !arg('no-instrument', false),
  out: path.resolve(ROOT, String(arg('out', 'docs/ux/release-g-perf-baseline.md'))),
  json: arg('json', '') ? path.resolve(String(arg('json'))) : '',
  fromJson: arg('from-json', '') ? String(arg('from-json')).split(',') : [],
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const median = a => {
  const s = [...a].sort((x, y) => x - y);
  return s.length
    ? s.length % 2
      ? s[(s.length - 1) / 2]
      : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
    : NaN;
};
const r1 = x => Math.round(x * 10) / 10;

/* the server: this checkout, on a port of its own. A small static server rather than
   python3 -m http.server: that one answers the app's 40 scripts one by one, slowly and unevenly,
   which swamped the app's own start-up time. Scripts may be cached (max-age), as the service worker
   caches them on the phone, so a reload measures the app, not the network. */
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const free = port =>
  new Promise(ok => {
    const s = http.createServer().once('error', () => ok(false));
    s.listen(port, '127.0.0.1', () => s.close(() => ok(true)));
  });
async function serve() {
  let port = OPT.port;
  while (!(await free(port))) port++;
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, path.normalize(p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream',
      'Cache-Control': p.endsWith('.html') ? 'no-cache' : 'max-age=3600',
    });
    res.end(fs.readFileSync(f));
  });
  await new Promise(ok => server.listen(port, '127.0.0.1', ok));
  return { proc: { kill: () => server.close() }, url: `http://localhost:${port}/` };
}

/* in the page */
// Installed before the app's scripts: when appReady goes true, and a frame wait.
const INIT = () => {
  let ready = false;
  Object.defineProperty(window, 'appReady', {
    configurable: true,
    get: () => ready,
    set: v => {
      ready = v;
      if (v && !window.__readyAt) window.__readyAt = performance.now();
    },
  });
  // (until the frame after this one has been drawn: style, layout and paint included)
  window.__frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  window.__lt = [];
  try {
    new PerformanceObserver(l => window.__lt.push(...l.getEntries().map(e => e.duration))).observe({
      type: 'longtask',
      buffered: true,
    });
  } catch (e) {}
};
// The dataset goes in as saved data (as app.setState does), then the device is made to look
// signed in and fully synced (every record's fingerprint known, nothing waiting to be sent), as
// the user's phone is. (sb stays null: the Supabase library is blocked, so nothing is sent.)
const seedSrc = fill => `(async () => {
  const s = JSON.parse(JSON.stringify(S));
  (${fill})(s);
  norm(s);
  const recs = toRecords(S), now = Date.now();
  let seq = 1;
  sync2 = { cursor: 0, synced: {}, dirty: {}, snapAt: now, at: {}, et: {}, kbimg: 1 };
  recs.forEach((v, k) => {
    sync2.synced[k] = recHash(k, v);
    sync2.at[k] = seq++;
    sync2.et[k] = now - 60000;
  });
  sync2.cursor = seq;
  persistLocal();
  await storeDone();
  return { records: recs.size, quests: S.quests.length };
})()`;

// Times fn (page source, an expression of a function) N times: the synchronous part ('js') and
// until the next frame has been drawn ('frame'). `before`/`after` run untimed around each run.
async function timeOp(page, fn, { before = '', after = '', n = OPT.runs, idb = false } = {}) {
  return page.evaluate(
    async ({ fn, before, after, n, idb }) => {
      const f = (0, eval)('(' + fn + ')'),
        b = before ? (0, eval)('(' + before + ')') : null,
        a = after ? (0, eval)('(' + after + ')') : null,
        js = [],
        work = [],
        frame = [],
        store = [];
      for (let i = 0; i < n; i++) {
        if (b) await b(i);
        await storeDone();
        await __frame();
        const t0 = performance.now();
        const r = f(i);
        if (r && r.then) await r;
        const t1 = performance.now();
        document.documentElement.getBoundingClientRect(); // (style and layout, now)
        const tl = performance.now();
        if (idb) await storeDone();
        const t2 = performance.now();
        await __frame();
        const t3 = performance.now();
        js.push(t1 - t0);
        work.push(tl - t0);
        store.push(t2 - t0);
        frame.push(idb ? tl - t0 + (t3 - t2) : t3 - t0);
        if (a) await a(i);
      }
      await storeDone();
      return { js, work, frame, store };
    },
    { fn, before, after, n, idb },
  );
}

/* the operations, as page source */
const TODAY = `() => { if (view !== 'today') go('today'); if (path.length) openPath([]); }`;
// A step to tick: the first not-done step of a task on Today's list with at least two left to do
// (so ticking it doesn't ask what's next), not waiting, not scheduled.
const PICK_STEP = `() => {
  const q = S.quests.find(q => !q.scheduled && taskState(q) === 'actionable' && !top3Ids().includes(q.id) &&
    q.children.filter(c => !c.done && !c.wait && !c.opt).length >= 3);
  return q && q.children.find(c => !c.done && !c.wait && !c.opt).id;
}`;
const TAP = `id => { let b = document.getElementById('__tap'); if (!b) { b = document.createElement('button'); b.id = '__tap'; b.hidden = true; document.body.appendChild(b); } b.dataset.toggle = id; b.click(); }`;
// 500 rows from a sync (as pullChanges hands them to applyRows): edits to tasks, the log,
// articles, follow-ups, executions and runs, newer than here. Run i makes its own edits.
const ROWS = `i => {
  const recs = [...toRecords(S)].filter(([k]) => /^(quest|log|kb|follow|exec|wrun|inbox):/.test(k));
  const at = Date.now() + 60000;
  let seq = sync2.cursor + 1000 * (i + 1);
  window.__rows = recs.slice(0, 500).map(([key, v]) => {
    const data = JSON.parse(JSON.stringify(v));
    if ('text' in data) data.text = String(data.text).replace(/ \\(r\\d+\\)$/, '') + ' (r' + i + ')';
    else if ('title' in data) data.title = String(data.title).replace(/ \\(r\\d+\\)$/, '') + ' (r' + i + ')';
    else data.note = 'r' + i;
    return { key, data, deleted: false, edited_at: at + i, seq: seq++ };
  });
}`;
const TABS = [
  ['tab_today', `() => go('today')`, `() => go('inbox')`],
  ['tab_inbox', `() => go('inbox')`],
  ['tab_knowledge', `() => go('knowledge')`],
  [
    'tab_processes',
    `() => go('knowledge')`,
    `() => { kbView = 'proc'; wfView = null; }`,
    `() => { kbView = 'ref'; }`,
  ],
  ['tab_review', `() => go('review')`, `() => { reviewSub = 'week'; }`],
  ['tab_forecast', `() => go('review')`, `() => { reviewSub = 'forecast'; }`],
  ['tab_insights', `() => go('review')`, `() => { reviewSub = 'insights'; }`],
  ['tab_history', `() => go('log')`],
  ['tab_ops', `() => go('ops')`],
  ['tab_waiting', `() => go('waiting')`],
];

async function measure(page, cdp, url) {
  const R = {};
  const put = (k, t) =>
    (R[k] = {
      js: r1(median(t.js)),
      work: r1(median(t.work)),
      frame: r1(median(t.frame)),
      first: r1(t.work[0]), // (the first of the session: cold caches, lazy set-up)
      runs: t,
    });
  // Cold load: a fresh navigation, the store read, the state built and drawn; to appReady.
  const loads = [],
    lcp = [],
    dcl = [];
  for (let i = 0; i < OPT.runs; i++) {
    await page.goto(url);
    await page.waitForFunction(() => window.appReady === true, null, { timeout: 120000 });
    const x = await page.evaluate(async () => {
      await __frame();
      return {
        ready: __readyAt,
        painted: performance.now(),
        dcl: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,
      };
    });
    loads.push(x.ready);
    lcp.push(x.painted);
    dcl.push(x.dcl);
  }
  // (scripts parsed and run, before the store is read; then the app's own start: the store read,
  // the state built, the first draw)
  R.cold_load = { js: r1(median(loads)), frame: r1(median(lcp)), runs: { js: loads, frame: lcp, dcl } };
  R.cold_scripts = { js: r1(median(dcl)) };
  R.cold_start = { js: r1(median(loads.map((x, i) => x - dcl[i]))) };
  await page.evaluate(`(${TODAY})()`);
  // A fixed piece of JS, to show the throttling took (x4 should read about 4x).
  R.calibration = await page.evaluate(() => {
    const t0 = performance.now();
    let x = 0;
    for (let i = 0; i < 3e6; i++) x += Math.sqrt(i);
    return Math.round((performance.now() - t0 + (x < 0 ? 1 : 0)) * 10) / 10;
  });
  R.size = await page.evaluate(() => ({
    stateJSON: stateJSON().length,
    syncJSON: JSON.stringify(sync2).length,
    records: toRecords(S).size,
    quests: S.quests.length,
    steps: S.quests.reduce((a, q) => a + q.children.length, 0),
    log: S.log.length,
    kb: S.kb.length,
    workflows: S.workflows.length,
    wruns: S.wruns.length,
    execs: S.execs.length,
    follows: S.follows.length,
    inbox: S.inbox.length,
    waiting: typeof waitingSorted === 'function' ? waitingSorted().length : null,
  }));
  // Today
  put('renderAll', await timeOp(page, `() => renderAll()`, { before: TODAY }));
  put('bg_sync_redraw', await timeOp(page, `() => inBackground(renderAll)`, { before: TODAY }));
  const step = await page.evaluate(`(${PICK_STEP})()`);
  if (step) {
    put(
      'tick_today',
      await timeOp(page, `() => (${TAP})(${JSON.stringify(step)})`, {
        before: TODAY,
        after: `async () => { (${TAP})(${JSON.stringify(step)}); await storeDone(); await __frame(); }`,
      }),
    );
    // The same tick on the task's own page (where its steps are).
    const q = await page.evaluate(id => find(id).parents[0].id, step);
    put(
      'tick_task_page',
      await timeOp(page, `() => document.querySelector('#v-today [data-toggle="${step}"]').click()`, {
        before: `() => { if (view !== 'today') go('today'); openPath([${JSON.stringify(q)}]); }`,
        after: `async () => { document.querySelector('#v-today [data-toggle="${step}"]').click(); await storeDone(); await __frame(); openPath([]); }`,
      }),
    );
  }
  // Tab switches (from Today, or to Today from the Inbox)
  for (const [k, fn, before, after] of TABS)
    put(
      k,
      await timeOp(page, fn, {
        before: before || TODAY,
        after: after ? `async () => { (${after})(); go('today'); }` : `() => go('today')`,
      }),
    );
  // Search: the header's search, then typing "report" a letter at a time (r, re, rep...).
  put(
    'search_key',
    await timeOp(
      page,
      `i => { const el = $('#sq'); el.value = 'report'.slice(0, i + 1); el.dispatchEvent(new Event('input', { bubbles: true })); }`,
      { before: `i => { if (!i) openSearch(); }` },
    ),
  );
  put(
    'search_open',
    await timeOp(page, `() => openSearch()`, { before: `() => { searchQ = ''; go('today'); }` }),
  );
  await page.evaluate(() => {
    searchQ = '';
    go('today');
  });
  // Saving and the sync bookkeeping
  put('save', await timeOp(page, `() => save()`, { idb: true }));
  R.save.idb = r1(median(R.save.runs.store));
  put('toRecords', await timeOp(page, `() => toRecords(S)`));
  put('markDirty', await timeOp(page, `() => markDirty()`));
  put('stateJSON', await timeOp(page, `() => stateJSON()`));
  put('persistLocal', await timeOp(page, `() => persistLocal()`, { idb: true }));
  R.persistLocal.idb = r1(median(R.persistLocal.runs.store));
  // Taking in 500 rows from a sync (as pullChanges hands them to applyRows): edits to tasks,
  // the log, articles, follow-ups and executions, newer than here.
  put(
    'applyRows500',
    await timeOp(page, `() => applyRows(window.__rows, false, null, true)`, {
      before: ROWS,
      idb: true,
    }),
  );
  // Memory and the page
  await page.evaluate(`(${TODAY})()`);
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  R.heapMB = r1(heap.usedSize / 1048576);
  R.dom = await page.evaluate(() => ({
    all: document.getElementsByTagName('*').length,
    today: $('#v-today').getElementsByTagName('*').length,
    todayHTML: $('#v-today').innerHTML.length,
    height: document.documentElement.scrollHeight,
  }));
  // Long tasks while scrolling Today from top to bottom (wheel steps, as a fling would).
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await __frame();
    await new Promise(r => setTimeout(r, 300));
    __lt.length = 0;
    window.__fd = [];
    let last = performance.now();
    window.__fdOn = true;
    const loop = t => {
      __fd.push(t - last);
      last = t;
      if (__fdOn) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const steps = Math.min(60, Math.ceil(R.dom.height / 400));
  await page.mouse.move(195, 500);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  R.scroll = await page.evaluate(() => {
    __fdOn = false;
    const fd = __fd.slice(1);
    return {
      longTasks: __lt.length,
      longTaskMs: Math.round(__lt.reduce((a, b) => a + b, 0)),
      tbt: Math.round(__lt.reduce((a, b) => a + Math.max(0, b - 50), 0)),
      maxFrame: Math.round(Math.max(0, ...fd)),
      jank: fd.filter(x => x > 50).length,
      scrolledTo: Math.round(scrollY),
    };
  });
  return R;
}

/* profiling: CDP sampling profiles of the slow operations, hot functions by self and total time */
// Several profiles of the same operation (one per run), together.
function hot(profiles, top = 14) {
  const self = new Map(),
    total = new Map();
  let all = 0;
  const key = n => {
    const c = n.callFrame,
      f = c.url ? c.url.split('/').slice(-2).join('/') : '';
    return (c.functionName || '(anonymous)') + (f ? ` ${f}:${c.lineNumber + 1}` : '');
  };
  for (const profile of profiles) {
    const byId = new Map(profile.nodes.map(n => [n.id, n])),
      parent = new Map();
    profile.nodes.forEach(n => (n.children || []).forEach(c => parent.set(c, n.id)));
    profile.samples.forEach((id, i) => {
      const dt = (profile.timeDeltas[i] || 0) / 1000,
        n = byId.get(id),
        k = key(n);
      if (['(idle)', '(program)', '(root)'].includes(n.callFrame.functionName)) return;
      all += dt;
      self.set(k, (self.get(k) || 0) + dt);
      const seen = new Set();
      for (let p = id; p !== undefined; p = parent.get(p)) {
        const pk = key(byId.get(p));
        if (seen.has(pk) || ['(root)', '(anonymous)', 'evaluate'].includes(pk)) continue;
        seen.add(pk);
        total.set(pk, (total.get(pk) || 0) + dt);
      }
    });
  }
  const per = profiles.length || 1,
    list = m =>
      [...m]
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .map(([k, v]) => [k, r1(v / per), Math.round((v / all) * 100)]);
  return { runs: per, sampledMs: r1(all / per), self: list(self), total: list(total) };
}
// [name, set-up (not profiled), the operation (profiled)]: three runs each, per run figures.
const PROFILE_OPS = [
  ['cold_load', null, null],
  ['renderAll', TODAY, `() => renderAll()`],
  ['tick_today', TODAY, 'tick'],
  ['save', TODAY, `() => save()`],
  ['tab_today', `() => go('inbox')`, `() => go('today')`],
  ['tab_ops', TODAY, `() => go('ops')`],
  ['tab_waiting', TODAY, `() => go('waiting')`],
  ['tab_insights', `() => { go('today'); reviewSub = 'insights'; }`, `() => go('review')`],
  ['tab_forecast', `() => { go('today'); reviewSub = 'forecast'; }`, `() => go('review')`],
  ['tab_processes', `() => { go('today'); kbView = 'proc'; wfView = null; }`, `() => go('knowledge')`],
  [
    'search_key',
    `() => { go('today'); searchQ = ''; openSearch(); }`,
    `() => { const el = $('#sq'); el.value = 're'; el.dispatchEvent(new Event('input', { bubbles: true })); }`,
  ],
  ['applyRows500', null, 'rows'],
];
async function profileOps(page, cdp, url) {
  const out = {};
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  const settle = () => page.evaluate(async () => (await storeDone(), await __frame()));
  for (const [k, setup, src] of PROFILE_OPS) {
    const got = [];
    for (let i = 0; i < 3; i++) {
      if (k === 'cold_load') {
        await cdp.send('Profiler.start');
        await page.goto(url);
        await page.waitForFunction(() => window.appReady === true, null, { timeout: 120000 });
        got.push((await cdp.send('Profiler.stop')).profile);
        continue;
      }
      let fn = src;
      if (src === 'tick') fn = `() => (${TAP})(${JSON.stringify(await page.evaluate(`(${PICK_STEP})()`))})`;
      if (src === 'rows') {
        await page.evaluate(`(${ROWS})(${i + 10})`);
        fn = `() => applyRows(window.__rows, false, null, true)`;
      }
      if (setup) await page.evaluate(`(${setup})()`);
      await settle();
      await cdp.send('Profiler.start');
      await page.evaluate(`(${fn})()`);
      got.push((await cdp.send('Profiler.stop')).profile);
      await settle();
    }
    await page.evaluate(() => {
      reviewSub = 'week';
      kbView = 'ref';
      searchQ = '';
      go('today');
    });
    out[k] = hot(got);
  }
  await cdp.send('Profiler.disable');
  return out;
}

/* call counts: the usual suspects, wrapped, through one run of each operation */
const SUSPECTS = [
  'find',
  'taskState',
  'top3State',
  'settleTop3',
  'isDone',
  'stepsDone',
  'nextLeaf',
  'actionLeaf',
  'waitingSteps',
  'snapshot',
  'toRecords',
  'markDirty',
  'recHash',
  'hashOf',
  'stateJSON',
  'persistLocal',
  'attentionItems',
  'waitingSorted',
  'dueSoon',
  'renderHeader',
  'renderToday',
  'renderTop3',
  'renderAttention',
  'renderScheduledToday',
  'renderWaitingToday',
  'setHTML',
];
const COUNT_OPS = [
  ['renderAll', `() => renderAll()`],
  ['tick_today', 'tick'],
  ['save', `() => save()`],
  ['tab_ops', `() => go('ops')`],
  ['tab_waiting', `() => go('waiting')`],
  ['tab_insights', `() => { reviewSub = 'insights'; go('review'); reviewSub = 'week'; }`],
];
async function countCalls(page) {
  await page.evaluate(names => {
    window.__cc = {};
    names.forEach(nm => {
      const d = Object.getOwnPropertyDescriptor(window, nm);
      if (!d || typeof d.value !== 'function' || !d.writable) return;
      const f = d.value,
        c = (__cc[nm] = { calls: 0, all: 0, ms: 0, depth: 0 });
      // (calls from outside it; recursive ones only in `all`)
      window[nm] = function (...a) {
        c.all++;
        if (c.depth++) {
          try {
            return f.apply(this, a);
          } finally {
            c.depth--;
          }
        }
        c.calls++;
        const t0 = performance.now();
        try {
          return f.apply(this, a);
        } finally {
          c.depth--;
          c.ms += performance.now() - t0;
        }
      };
    });
  }, SUSPECTS);
  const out = {};
  for (const [k, src] of COUNT_OPS) {
    let fn = src;
    if (src === 'tick') {
      const step = await page.evaluate(`(${PICK_STEP})()`);
      fn = `() => (${TAP})(${JSON.stringify(step)})`;
    }
    await page.evaluate(`(${TODAY})()`);
    await page.evaluate(() => storeDone());
    out[k] = await page.evaluate(fn => {
      for (const k in __cc) Object.assign(__cc[k], { calls: 0, all: 0, ms: 0 });
      const t0 = performance.now();
      (0, eval)('(' + fn + ')')();
      const total = performance.now() - t0;
      const res = { total: Math.round(total * 10) / 10 };
      for (const k in __cc)
        if (__cc[k].calls) res[k] = [__cc[k].calls, Math.round(__cc[k].ms * 10) / 10, __cc[k].all];
      return res;
    }, fn);
    if (src === 'tick')
      await page.evaluate(`(${TAP})(${JSON.stringify(await page.evaluate(`(${PICK_STEP})()`))})`);
  }
  return out;
}

/* the report */
const OPS = [
  ['cold_load', 'Cold load to appReady', 'js'],
  ['cold_scripts', '  of which: scripts loaded (DOMContentLoaded)', 'js'],
  ['cold_start', '  of which: app start (store read, norm, first draw)', 'js'],
  ['renderAll', 'renderAll() on Today', 'work'],
  ['tick_today', 'Tick a step (from Today)', 'work'],
  ['tick_task_page', "Tick a step (task's page)", 'work'],
  ['bg_sync_redraw', 'Background redraw inBackground(renderAll)', 'work'],
  ['tab_today', 'Tab: Today (from Inbox)', 'work'],
  ['tab_inbox', 'Tab: Inbox', 'work'],
  ['tab_knowledge', 'Tab: Knowledge (Reference)', 'work'],
  ['tab_processes', 'Tab: Knowledge (Processes)', 'work'],
  ['tab_review', 'Tab: Review (Week)', 'work'],
  ['tab_forecast', 'Tab: Review (Forecast)', 'work'],
  ['tab_insights', 'Tab: Review (Insights)', 'work'],
  ['tab_history', 'Tab: History', 'work'],
  ['tab_ops', "Tab: Command Centre go('ops')", 'work'],
  ['tab_waiting', "Tab: Waiting go('waiting')", 'work'],
  ['search_open', 'Open search', 'work'],
  ['search_key', 'Search keystroke to results', 'work'],
  ['save', 'save() (sync part)', 'js'],
  ['save_idb', 'save() incl. IndexedDB write', 'idb'],
  ['toRecords', 'toRecords(S)', 'js'],
  ['markDirty', 'markDirty()', 'js'],
  ['stateJSON', 'stateJSON() (JSON.stringify of S)', 'js'],
  ['applyRows500', 'applyRows, 500 incoming rows', 'work'],
];
// Budgets for the throttled (x4) figure, ms. [busy, heavy]
const BUDGETS = {
  cold_load: [1000, 1500],
  cold_start: [400, 700],
  renderAll: [50, 100],
  tick_today: [50, 100],
  tick_task_page: [50, 100],
  bg_sync_redraw: [50, 100],
  tab: [150, 150],
  search_key: [50, 100],
  search_open: [150, 150],
  save: [30, 50],
  save_idb: [50, 100],
  toRecords: [10, 20],
  markDirty: [20, 40],
  stateJSON: [10, 20],
  applyRows500: [300, 500],
};
const budgetOf = (k, size) => {
  const b = BUDGETS[k] || (k.startsWith('tab_') ? BUDGETS.tab : null);
  if (!b) return null;
  return size === 'typical' ? b[0] : size === 'busy' ? b[0] : b[1];
};
const val = (R, k, kind) => {
  if (k === 'save_idb') return R.save && R.save.idb;
  const x = R[k];
  return x ? x[kind] : undefined;
};
function table(res, rate) {
  const sizes = OPT.sizes.filter(s => res[rate] && res[rate][s]);
  let h = `| Operation (median of ${OPT.runs}, ms) | ${sizes.join(' | ')} |\n|---|${sizes.map(() => '---:').join('|')}|\n`;
  for (const [k, label, kind] of OPS) {
    const cells = sizes.map(s => {
      const v = val(res[rate][s], k, kind);
      if (v === undefined) return '-';
      const b = rate === 4 ? budgetOf(k, s) : null;
      return b !== null && v > b ? `**${v}** (>${b})` : String(v);
    });
    h += `| ${label} | ${cells.join(' | ')} |\n`;
  }
  const extra = [
    ['JS heap after GC, MB', R => R.heapMB],
    ['DOM nodes (page / Today)', R => `${R.dom.all} / ${R.dom.today}`],
    ['Today HTML, KB', R => r1(R.dom.todayHTML / 1024)],
    ['Scroll Today: long tasks (count / ms)', R => `${R.scroll.longTasks} / ${R.scroll.longTaskMs}`],
    ['Scroll Today: worst frame, ms', R => R.scroll.maxFrame],
    ['Saved state JSON, KB', R => r1(R.size.stateJSON / 1024)],
    ['Sync bookkeeping JSON, KB', R => r1(R.size.syncJSON / 1024)],
    ['Records (sync rows)', R => R.size.records],
    ['Calibration loop, ms', R => R.calibration],
  ];
  for (const [label, f] of extra) h += `| ${label} | ${sizes.map(s => f(res[rate][s])).join(' | ')} |\n`;
  return h;
}
// calls / ms, and with recursion the calls made in all: "40 (6406) / 2.4"
const cc = ([calls, ms, all]) => `${calls}${all > calls ? ` (${all})` : ''} / ${ms}`;
function report(res, meta) {
  let h = `<!-- bench:start (generated by tests/perf/bench.js; edit outside the markers) -->\n\n`;
  h += `Generated ${meta.at} on ${meta.cpu}, Chromium ${meta.chromium}, viewport 390x844, commit ${meta.commit}.\n`;
  h += `UI rows: the synchronous JS plus a forced style and layout (getBoundingClientRect), so frame-wait noise is left out; paint is not included (the raw JSON also has \`frame\`, until the next frame was drawn). Bold: over the budget for that size (throttled run only).\n\n`;
  for (const rate of OPT.throttle) {
    h += `### ${rate === 1 ? 'Unthrottled (desktop CPU)' : `CPU throttled x${rate} (phone figure)`}\n\n`;
    h += table(res, rate) + '\n';
  }
  const sz = OPT.sizes.find(s => res[OPT.throttle[0]] && res[OPT.throttle[0]][s]);
  if (sz) {
    h += `### Dataset sizes (after the app's own pruning on load)\n\n| | ${OPT.sizes.join(' | ')} |\n|---|${OPT.sizes.map(() => '---:').join('|')}|\n`;
    for (const k of Object.keys(res[OPT.throttle[0]][sz].size))
      h += `| ${k} | ${OPT.sizes.map(s => (res[OPT.throttle[0]][s] ? res[OPT.throttle[0]][s].size[k] : '-')).join(' | ')} |\n`;
    h += '\n';
  }
  if (res.counts) {
    h += `### Call counts (one run of each operation, unthrottled; calls (with recursive ones) / inclusive ms, timing inflated by the wrapping)\n\n`;
    for (const s in res.counts) {
      h += `**${s}**\n\n| Function | ${COUNT_OPS.map(([k]) => k).join(' | ')} |\n|---|${COUNT_OPS.map(() => '---:').join('|')}|\n`;
      h += `| (operation total ms) | ${COUNT_OPS.map(([k]) => res.counts[s][k].total).join(' | ')} |\n`;
      for (const fn of SUSPECTS) {
        if (!COUNT_OPS.some(([k]) => res.counts[s][k][fn])) continue;
        h += `| ${fn} | ${COUNT_OPS.map(([k]) => (res.counts[s][k][fn] ? cc(res.counts[s][k][fn]) : '')).join(' | ')} |\n`;
      }
      h += '\n';
    }
  }
  if (res.profiles) {
    h += `### Hot functions (CDP sampling profile, unthrottled; ms and % of the operation's JS)\n\n`;
    for (const s in res.profiles)
      for (const k in res.profiles[s]) {
        const p = res.profiles[s][k];
        h += `<details><summary>${s} / ${k}: ${p.sampledMs} ms sampled</summary>\n\n| Self | ms | % | Total (inclusive) | ms | % |\n|---|---:|---:|---|---:|---:|\n`;
        for (let i = 0; i < Math.max(p.self.length, p.total.length); i++) {
          const a = p.self[i] || ['', '', ''],
            b = p.total[i] || ['', '', ''];
          h += `| ${a[0]} | ${a[1]} | ${a[2]} | ${b[0]} | ${b[1]} | ${b[2]} |\n`;
        }
        h += `\n</details>\n\n`;
      }
  }
  const slim = JSON.parse(JSON.stringify(res, (k, v) => (k === 'runs' ? undefined : v)));
  h += `<details><summary>Raw results (JSON)</summary>\n\n\`\`\`json\n${JSON.stringify({ meta, results: slim })}\n\`\`\`\n\n</details>\n\n<!-- bench:end -->\n`;
  return h;
}
function writeReport(h) {
  let doc = fs.existsSync(OPT.out)
    ? fs.readFileSync(OPT.out, 'utf8')
    : '# Release G: performance baseline\n\n';
  const a = doc.indexOf('<!-- bench:start'),
    b = doc.indexOf('<!-- bench:end -->');
  doc = a >= 0 && b > a ? doc.slice(0, a) + h + doc.slice(b + '<!-- bench:end -->\n'.length) : doc + '\n' + h;
  fs.mkdirSync(path.dirname(OPT.out), { recursive: true });
  fs.writeFileSync(OPT.out, doc);
}

// Saved results together: numbers the lowest, anything else from the first.
const lowest = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.min(a, b);
  if (Array.isArray(a) || !a || typeof a !== 'object' || !b || typeof b !== 'object') return a;
  const o = { ...a };
  for (const k in b) o[k] = k in a ? lowest(a[k], b[k]) : b[k];
  return o;
};
function fromJson() {
  const all = OPT.fromJson.map(f => JSON.parse(fs.readFileSync(path.resolve(f), 'utf8')));
  const res = all.map(x => x.results).reduce((a, b) => lowest(a, b));
  ['counts', 'profiles'].forEach(k => (res[k] = all[0].results[k]));
  const meta = { ...all[0].meta, merged: all.map(x => x.meta.at) };
  meta.at = meta.merged.join(' + ') + ` (lowest of ${all.length} runs' medians)`;
  writeReport(report(res, meta));
  log('wrote', OPT.out);
}

(async () => {
  if (OPT.fromJson.length) return fromJson();
  const { proc, url } = await serve();
  log('serving', ROOT, 'at', url);
  // Nothing beyond localhost (fonts, the Supabase library: so sync is off), blocked by the browser
  // itself: request interception (page.route) holds every script up on a round trip to Node.
  const browser = await pw.chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'],
  });
  const res = {},
    chromium = browser.version();
  try {
    for (const rate of OPT.throttle) {
      res[rate] = {};
      for (const size of OPT.sizes) {
        if (!SIZES[size]) throw new Error('unknown size ' + size);
        const ctx = await browser.newContext({
          viewport: { width: 390, height: 844 },
          serviceWorkers: 'block',
        });
        await ctx.addInitScript(INIT);
        const page = await ctx.newPage(),
          errors = [];
        page.on('pageerror', e => errors.push(e.message));
        const cdp = await ctx.newCDPSession(page);
        await page.goto(url);
        await page.waitForFunction(() => window.appReady === true);
        const seeded = await page.evaluate(seedSrc(dataset(size)));
        await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        log(`x${rate} ${size}: seeded`, seeded);
        res[rate][size] = await measure(page, cdp, url);
        res[rate][size].errors = errors;
        log(`x${rate} ${size}:`, OPS.map(([k, , kind]) => `${k}=${val(res[rate][size], k, kind)}`).join(' '));
        if (rate === 1 && OPT.instrument && ['busy', 'heavy'].includes(size)) {
          await page.goto(url);
          await page.waitForFunction(() => window.appReady === true);
          (res.counts = res.counts || {})[size] = await countCalls(page);
          log(`counts ${size}`, JSON.stringify(res.counts[size]));
        }
        if (rate === 1 && OPT.profile && ['busy', 'heavy'].includes(size)) {
          await page.goto(url);
          await page.waitForFunction(() => window.appReady === true);
          (res.profiles = res.profiles || {})[size] = await profileOps(page, cdp, url);
          log(`profiled ${size}`);
        }
        if (errors.length) log('page errors', errors);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    proc.kill();
  }
  const meta = {
    at: new Date().toISOString(),
    cpu: (() => {
      try {
        const c = fs.readFileSync('/proc/cpuinfo', 'utf8').match(/model name\s*:\s*(.*)/);
        return (c ? c[1] : 'unknown CPU') + ` x${require('os').cpus().length}`;
      } catch (e) {
        return 'unknown CPU';
      }
    })(),
    chromium,
    commit: (() => {
      try {
        return require('child_process')
          .execSync('git rev-parse --short HEAD', { cwd: ROOT })
          .toString()
          .trim();
      } catch (e) {
        return '?';
      }
    })(),
    runs: OPT.runs,
  };
  writeReport(report(res, meta));
  if (OPT.json) fs.writeFileSync(OPT.json, JSON.stringify({ meta, results: res }, null, 1));
  log('wrote', OPT.out);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
