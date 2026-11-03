/* the Command Centre (Release C): one page with what needs you, what's under way, what you
   launch most, what's coming, and what just happened, all read from the records: nothing here
   runs on its own. Opened from Today's chip or the header (no tab of its own), or #/ops.
   Pins (S.pins, synced as meta:pins) are what you launch most: a workflow, a procedure, a flow
   (a deliberate tap on its link, as everywhere), a quest or a page. The two routines are lists
   of buttons, nothing more: starting the day doesn't start anything, finishing it doesn't
   finish anything. The status line says how fresh the records are: offline, or when they were
   last synced; signed out, they're this device's only. */
const PIN_KINDS = { wf: 'Workflow', kb: 'Procedure', flow: 'Flow', q: 'Quest', view: 'Page' },
  PIN_VIEWS = [
    ['today', 'Today'],
    ['inbox', 'Inbox'],
    ['waiting', 'Waiting Centre'],
    ['forecast', 'Forecast'],
    ['insights', 'Insights'],
    ['workflows', 'Workflows'],
  ],
  PINS_MAX = 12;
let opsEdit = false; // pins being reordered
function cleanPins(ps) {
  if (!Array.isArray(ps)) return [];
  const seen = new Set();
  return ps
    .filter(p => p && typeof p === 'object' && PIN_KINDS[p.k] && okRef(p.id))
    .map(p => ({ k: p.k, id: p.id }))
    .filter(p => !seen.has(p.k + p.id) && seen.add(p.k + p.id))
    .slice(0, PINS_MAX);
}
// What a pin points at (name, and whether it's still here).
function pinTarget(p) {
  if (p.k === 'wf') {
    const w = wfById(p.id);
    return w && !w.archived ? { name: w.name } : null;
  }
  if (p.k === 'kb') {
    const a = procOf(p.id);
    return a ? { name: a.title } : null;
  }
  if (p.k === 'flow') {
    const f = S.flows.find(x => x.id === p.id);
    return f ? { name: f.name, url: f.url } : null;
  }
  if (p.k === 'q') {
    const r = find(p.id) || find(p.id, S.later);
    return r && !isDone(r.n) ? { name: r.n.text } : null;
  }
  if (p.k === 'view') {
    const v = PIN_VIEWS.find(x => x[0] === p.id);
    return v ? { name: v[1] } : null;
  }
  return null;
}
function opsSyncLine() {
  if (!navigator.onLine)
    return `<span class="tag late">Offline</span> showing this device's records${lastSync ? ', last synced ' + esc(whenLabel(lastSync)) : ''}.`;
  if (typeof sb === 'undefined' || !sb || !session)
    return `<span class="tag">Not syncing</span> this device's records only.`;
  if (!lastSync)
    return `<span class="tag due">Not synced yet</span> this device's records until the first sync.`;
  const age = Date.now() - lastSync;
  return `${age > 3600e3 ? '<span class="tag due">Stale</span> ' : ''}Synced ${esc(whenLabel(lastSync))}.`;
}
/* the five lists */
function opsAttention() {
  const t = today(),
    rows = [];
  (function w(ns, trail) {
    ns.forEach(n => {
      if (isDone(n)) return;
      if (n.due && n.due < t)
        rows.push({ k: 'late', text: n.text, sub: 'Overdue, due ' + niceDate(n.due), open: n.id });
      else if (n.due === t) rows.push({ k: 'due', text: n.text, sub: 'Due today', open: n.id });
      w(n.children);
    });
  })(S.quests);
  S.wruns
    .filter(r => r.status === 'failed' && !r.ack)
    .forEach(r => rows.push({ k: 'late', text: r.name, sub: 'Workflow failed: ' + r.err, wfopen: r.id }));
  execFailures().forEach(x =>
    rows.push({
      k: 'late',
      text: (S.flows.find(f => f.id === x.flow) || {}).name || 'Flow',
      sub: 'Flow failed' + (x.msg ? ': ' + x.msg : ''),
      xdet: x.id,
    }),
  );
  waitingNodes()
    .filter(x => x.n.wait.due && x.n.wait.due <= t)
    .forEach(x =>
      rows.push({
        k: 'due',
        text: x.n.text,
        sub:
          'Chase ' +
          (x.n.wait.who || 'someone') +
          (x.n.wait.due < t ? ', was due ' + niceDate(x.n.wait.due) : ' today'),
        waiting: x.n.id,
      }),
    );
  S.wruns
    .filter(r => r.status === 'ready')
    .forEach(r => rows.push({ k: 'ready', text: r.name, sub: 'Workflow ready to start', wfopen: r.id }));
  S.execs
    .filter(x => execStale(x) && !x.ack)
    .forEach(x =>
      rows.push({
        k: 'due',
        text: (S.flows.find(f => f.id === x.flow) || {}).name || 'Flow',
        sub: 'Launched ' + whenLabel(x.at) + ', no word since',
        xdet: x.id,
      }),
    );
  if (S.inbox.length >= 10)
    rows.push({
      k: 'due',
      text: plural(S.inbox.length, 'Inbox item'),
      sub: 'Waiting to be processed',
      goto: 'inbox',
    });
  if (typeof reviewDue === 'function' && reviewDue())
    rows.push({ k: 'due', text: 'Weekly review', sub: 'Due this weekend', rsub: 'week' });
  return rows;
}
function opsProgress() {
  const rows = [];
  S.wruns
    .filter(r => !WRUN_FINAL.includes(r.status))
    .sort((a, b) => b.at - a.at)
    .forEach(r =>
      rows.push({
        text: r.name,
        sub: runWord(r) + (runStage(r) ? ' · ' + runStage(r).title : ''),
        wfopen: r.id,
      }),
    );
  S.runs
    .filter(r => !r.fin && procOf(r.art))
    .sort((a, b) => b.at - a.at)
    .forEach(r => rows.push({ text: procOf(r.art).title, sub: 'Procedure · ' + runLine(r), runopen: r.id }));
  S.execs
    .filter(x => !EXEC_TERMINAL.includes(x.status) && !execStale(x))
    .sort((a, b) => b.at - a.at)
    .forEach(x =>
      rows.push({
        text: (S.flows.find(f => f.id === x.flow) || {}).name || 'Flow',
        sub: EXEC_WORD[x.status] + ' · ' + whenLabel(x.at),
        xdet: x.id,
      }),
    );
  S.quests
    .filter(q => q.resume && !isDone(q))
    .sort((a, b) => b.resume.at - a.resume.at)
    .forEach(q => rows.push({ text: q.text, sub: 'Saved place: ' + q.resume.note, open: q.id }));
  return rows;
}
function opsComing() {
  const f = allocate(7),
    rows = [];
  f.days.slice(1).forEach(day => {
    const due = [];
    (function w(ns) {
      ns.forEach(n => {
        if (!isDone(n) && n.due === day.d) due.push(n.text);
        w(n.children);
      });
    })(S.quests);
    S.later.forEach(n => n.start === day.d && due.push(n.text + ' (starts)'));
    const wfs = S.workflows.filter(w => {
      if (w.archived) return false;
      const [y, m, dd] = day.d.split('-').map(Number),
        wd = new Date(y, m - 1, dd).getDay(),
        end = new Date(y, m, 0).getDate();
      return w.days.includes(wd) || (w.monthDay && (w.monthDay === dd || (w.monthDay > end && dd === end)));
    });
    const chase = waitingNodes()
      .filter(x => x.n.wait.due === day.d)
      .map(x => x.n.text);
    if (!day.load && !due.length && !wfs.length && !chase.length) return;
    rows.push({
      text: dayLabel(day.d),
      sub: [
        day.cap || day.load
          ? `${hm(day.load)} planned of ${hm(day.cap)}${day.load > day.cap ? ' (over)' : ''}`
          : '',
        due.length ? 'due: ' + due.join(', ') : '',
        wfs.length ? 'workflows: ' + wfs.map(w => w.name).join(', ') : '',
        chase.length ? 'chase: ' + chase.join(', ') : '',
      ]
        .filter(Boolean)
        .join(' · '),
      over: day.load > day.cap,
    });
  });
  return rows;
}
function opsOutcomes() {
  const rows = [],
    t = today();
  S.wruns
    .filter(r => WRUN_FINAL.includes(r.status))
    .forEach(r =>
      rows.push({
        t: r.fin || r.at,
        text: r.name,
        sub: 'Workflow ' + WRUN_WORD[r.status].toLowerCase() + (r.err ? ': ' + r.err : ''),
        k: r.status === 'succeeded' ? 'ok' : 'bad',
        wfopen: r.id,
      }),
    );
  S.execs
    .filter(x => EXEC_TERMINAL.includes(x.status))
    .forEach(x =>
      rows.push({
        t: x.upd,
        text: (S.flows.find(f => f.id === x.flow) || {}).name || 'Flow',
        sub: 'Flow ' + x.status + (x.msg ? ': ' + x.msg : ''),
        k: x.status === 'succeeded' ? 'ok' : 'bad',
        xdet: x.id,
      }),
    );
  S.log
    .filter(l => l.d >= shift(t, -2))
    .forEach(l =>
      rows.push({ t: Date.parse(l.d + 'T23:59'), text: l.text, sub: 'Finished ' + dayLabel(l.d), k: 'ok' }),
    );
  S.follows
    .filter(f => f.k === 'resolve')
    .forEach(f =>
      rows.push({
        t: f.t,
        text: (findWaitable(f.n).n || {}).text || 'Waiting item',
        sub: 'Reply received',
        k: 'ok',
      }),
    );
  S.rlog
    .filter(l => l.out === 'done')
    .forEach(l =>
      rows.push({ t: l.t, text: (ruleById(l.r) || {}).name || 'Rule', sub: 'Rule: ' + l.m, k: 'ok' }),
    );
  return rows.sort((a, b) => b.t - a.t).slice(0, 8);
}
/* the page */
function opsRow(r) {
  const attrs = r.open
    ? `data-open="${r.open}"`
    : r.wfopen
      ? `data-wfopen="${r.wfopen}"`
      : r.xdet
        ? `data-xdet="${r.xdet}"`
        : r.waiting
          ? `data-wgo="${r.waiting}"`
          : r.runopen
            ? `data-runopen="${r.runopen}"`
            : r.goto
              ? `data-goto="${r.goto}"`
              : r.rsub
                ? `data-rsub="${r.rsub}"`
                : '';
  const inner = `<span>${esc(r.text)}</span><small>${esc(r.sub)}</small>`;
  return `<div class="row oprow ${r.k || ''}${r.over ? ' over' : ''}">${attrs ? `<button class="open" ${attrs}>${inner}</button>` : `<div class="open">${inner}</div>`}</div>`;
}
function opsSection(title, rows, empty, extra = '') {
  return `<section class="opsec"><div class="sechead"><h2>${title}${rows.length ? ` <small>${rows.length}</small>` : ''}</h2>${extra}</div>${rows.length ? `<div class="list box">${rows.map(opsRow).join('')}</div>` : `<p class="hint">${empty}</p>`}</section>`;
}
function renderPins() {
  const pins = S.pins.map(p => ({ ...p, t: pinTarget(p) }));
  let h = '';
  if (pins.length)
    h += `<div class="pins${opsEdit ? ' editing' : ''}">${pins
      .map((p, i) => {
        const label = p.t ? esc(p.t.name) : '<span class="tag gone">Removed</span>',
          cls = 'pin' + (p.t ? '' : ' gone');
        let b;
        if (!p.t) b = `<span class="${cls}">${label}</span>`;
        else if (p.k === 'flow')
          b = `<a class="${cls}" href="${esc(p.t.url)}" data-flow="${p.id}">&#9654; ${label}</a>`;
        else if (p.k === 'wf') b = `<button class="${cls}" data-wfstart="${p.id}">${label}</button>`;
        else if (p.k === 'kb') b = `<button class="${cls}" data-runopen-art="${p.id}">${label}</button>`;
        else if (p.k === 'q') b = `<button class="${cls}" data-open="${p.id}">${label}</button>`;
        else b = `<button class="${cls}" data-opsview="${p.id}">${label}</button>`;
        return `<div class="pinwrap"><small>${PIN_KINDS[p.k]}</small>${b}${
          opsEdit
            ? `<span class="pmv"><button class="mv" data-pinmv="${i}" data-dir="-1" aria-label="Move up"${i === 0 ? ' disabled' : ''}>&#9650;</button><button class="mv" data-pinmv="${i}" data-dir="1" aria-label="Move down"${i === pins.length - 1 ? ' disabled' : ''}>&#9660;</button><button class="x" data-pindel="${i}" aria-label="Unpin ${esc(p.t ? p.t.name : 'removed')}">×</button></span>`
            : ''
        }</div>`;
      })
      .join('')}</div>`;
  else
    h += '<p class="hint">Pin what you launch most: a workflow, a procedure, a flow, a quest or a page.</p>';
  h += `<div class="acts"><button class="btn sm" data-pinadd="1">Pin something</button>${S.pins.length ? `<button class="btn sm" data-pinedit="1" aria-pressed="${opsEdit}">${opsEdit ? 'Done' : 'Reorder'}</button>` : ''}</div>`;
  return h;
}
function renderOps() {
  if (!$('#v-ops')) return;
  const att = opsAttention(),
    prog = opsProgress(),
    coming = opsComing(),
    out = opsOutcomes();
  let h = `<button class="linkbtn" data-goto="today">&lsaquo; Today</button><h2 class="opshead">Command Centre</h2><div class="acts"><button class="btn sm" data-routine="start">Start workday</button><button class="btn sm" data-routine="finish">Finish workday</button></div><p class="hint opsync">${opsSyncLine()}</p>`;
  h += opsSection('Needs attention', att, 'Nothing needs you right now.');
  h += opsSection('In progress', prog, 'Nothing under way.');
  h += `<section class="opsec"><div class="sechead"><h2>Quick launch</h2></div>${renderPins()}</section>`;
  h += opsSection(
    'Coming up',
    coming,
    'Nothing planned in the next six days.',
    `<button class="linkbtn" data-rsub="forecast">Forecast</button>`,
  );
  h += opsSection(
    'Recent outcomes',
    out,
    'Nothing finished lately.',
    `<button class="linkbtn" data-rsub="insights">Insights</button>`,
  );
  setHTML($('#v-ops'), h);
}
function routineSheet(kind) {
  const t = today(),
    f = allocate(7),
    att = opsAttention(),
    nx = nextStep(),
    ids = typeof top3Ids === 'function' ? top3Ids() : [];
  let items;
  if (kind === 'start')
    items = [
      typeof sb !== 'undefined' && sb && session
        ? ['Sync now', 'data-opssync="1"', navigator.onLine ? '' : 'offline']
        : null,
      [`Needs attention: ${att.length ? plural(att.length, 'item') : 'nothing'}`, 'data-goto="ops"', ''],
      [ids.length ? 'Top 3 chosen' : 'Pick your Top 3', 'data-top3pick="1"', ''],
      [
        `Process the Inbox${S.inbox.length ? ` (${S.inbox.length})` : ''}`,
        'data-goto="inbox"',
        S.inbox.length ? '' : 'empty',
      ],
      [
        `Today: ${hm(f.days[0].load)} planned of ${hm(f.days[0].cap)}${f.days[0].load > f.days[0].cap ? ', over' : ''}`,
        'data-rsub="forecast"',
        '',
      ],
      nx ? [`Start on: ${nx.n.text}`, `data-open="${nx.n.id}"`, ''] : null,
    ];
  else {
    const chase = waitingNodes().filter(x => x.n.wait.due && x.n.wait.due <= t).length,
      open = S.wruns.filter(r => !WRUN_FINAL.includes(r.status)).length,
      done = S.log.filter(l => l.d === t).length;
    items = [
      nx ? [`Save your place on ${nx.q.text}`, `data-saveplace="${nx.q.id}"`, ''] : null,
      [`Waiting: ${chase ? plural(chase, 'chase') + ' due' : 'nothing to chase'}`, 'data-goto="waiting"', ''],
      [`Workflows under way: ${open}`, 'data-goto="ops"', ''],
      [`Tomorrow: ${hm(f.days[1].load)} planned of ${hm(f.days[1].cap)}`, 'data-rsub="forecast"', ''],
      [`Copy today's summary (${plural(done, 'quest')} finished)`, 'data-opscopy="1"', ''],
      S.timer ? ['A session is running: stop it from Focus', 'data-goto="focus"', ''] : null,
    ];
  }
  popSheet(
    `<h2 id="sheettitle">${kind === 'start' ? 'Start the workday' : 'Finish the workday'}</h2><p class="hint">Each is a button; nothing happens on its own.</p><div class="qalist">${items
      .filter(Boolean)
      .map(
        ([l, a, note]) =>
          `<button class="qact" ${a}>${esc(l)}${note ? ` <small>${esc(note)}</small>` : ''}</button>`,
      )
      .join(
        '',
      )}</div><div class="acts"><button class="btn" type="button" data-sheetclose="1">Close</button></div>`,
    { labelledBy: 'sheettitle' },
  );
}
function daySummary() {
  const t = today(),
    done = S.log.filter(l => l.d === t),
    focus = Object.values(S.daily[t] || {}).reduce((a, b) => a + b, 0),
    out = opsOutcomes().filter(o => o.t >= Date.parse(t + 'T00:00')),
    att = opsAttention();
  return [
    `${dayLabel(t)} (${t})`,
    `Finished: ${done.length ? done.map(l => l.text).join(', ') : 'nothing'}`,
    `Focus time: ${hm(focus)}`,
    out.length ? 'Outcomes: ' + out.map(o => `${o.text} (${o.sub})`).join('; ') : '',
    att.length ? 'Still needs attention: ' + att.map(a => a.text).join(', ') : 'Nothing needs attention.',
  ]
    .filter(Boolean)
    .join('\n');
}
function openPinPicker() {
  const has = (k, id) => S.pins.some(p => p.k === k && p.id === id),
    opt = (k, id, name) =>
      has(k, id)
        ? ''
        : `<button class="qact" data-pin="${k}" data-id="${id}" data-stay="1">${esc(name)} <small>${PIN_KINDS[k]}</small></button>`;
  const h =
    S.workflows
      .filter(w => !w.archived)
      .map(w => opt('wf', w.id, w.name))
      .join('') +
    S.kb
      .filter(a => a.steps && a.steps.length)
      .map(a => opt('kb', a.id, a.title))
      .join('') +
    S.flows.map(f => opt('flow', f.id, f.name)).join('') +
    S.quests
      .filter(q => !isDone(q))
      .slice(0, 8)
      .map(q => opt('q', q.id, q.text))
      .join('') +
    PIN_VIEWS.map(([id, l]) => opt('view', id, l)).join('');
  popSheet(
    `<h2 id="sheettitle">Pin to Quick launch</h2>${h ? `<div class="qalist">${h}</div>` : '<p class="hint">Everything is pinned already.</p>'}<div class="acts"><button class="btn" type="button" data-sheetclose="1">Done</button></div>`,
    { labelledBy: 'sheettitle' },
  );
}
function opsClick(d, b) {
  if (d.routine) return routineSheet(d.routine);
  if (d.opssync) {
    closeSheet();
    if (typeof sync === 'function') sync();
    return;
  }
  if (d.opscopy) {
    closeSheet();
    return copyText(daySummary());
  }
  if (d.opsview) {
    if (d.opsview === 'forecast' || d.opsview === 'insights') {
      reviewSub = d.opsview;
      return go('review');
    }
    if (d.opsview === 'workflows') return followRoute({ kind: 'workflows', id: '' });
    return go(d.opsview);
  }
  if (d.wgo) {
    waitMark = d.wgo;
    go('waiting');
    const row = $(`#v-waiting [data-wid="${d.wgo}"]`);
    if (row) row.scrollIntoView({ block: 'center' });
    return;
  }
  if (d.runopen) {
    const r = S.runs.find(x => x.id === d.runopen);
    if (r) openRun(r.art, r.q);
    return;
  }
  if (d.runopenArt) return openRun(d.runopenArt, '');
  if (d.pinadd) return openPinPicker();
  if (d.pin) {
    if (S.pins.length >= PINS_MAX) return toast(`At most ${PINS_MAX} pins`, false, 3000);
    S.pins.push({ k: d.pin, id: d.id });
    S.pins = cleanPins(S.pins);
    save();
    renderOps();
    openPinPicker();
    return toast('Pinned');
  }
  if (d.pinedit) {
    opsEdit = !opsEdit;
    return renderOps();
  }
  if (d.pinmv !== undefined) {
    const i = +d.pinmv,
      j = i + +d.dir;
    if (i >= 0 && j >= 0 && j < S.pins.length) {
      [S.pins[i], S.pins[j]] = [S.pins[j], S.pins[i]];
      save();
      renderOps();
    }
    return;
  }
  if (d.pindel !== undefined) {
    S.pins.splice(+d.pindel, 1);
    if (!S.pins.length) opsEdit = false;
    save();
    renderOps();
  }
}
