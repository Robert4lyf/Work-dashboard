/* the Command Centre (Release C): one page with what needs you, what's under way, what you
   launch most, what's coming, and what just happened, all read from the records: nothing here
   runs on its own. Opened from Today's chip or the header (no tab of its own), or #/ops.
   Pins (S.pins, synced as meta:pins) are what you launch most: a workflow, a procedure, a flow
   (a deliberate tap on its link, as everywhere), a task or a page. The two routines are lists
   of buttons, nothing more: starting the day doesn't start anything, finishing it doesn't
   finish anything. The status line says how fresh the records are: offline, or when they were
   last synced; signed out, they're this device's only. */
const PIN_KINDS = { wf: 'Process', kb: 'Guide', flow: 'Desktop automation', q: 'Task', view: 'Page' },
  PIN_VIEWS = [
    ['today', 'Today'],
    ['inbox', 'Inbox'],
    ['waiting', 'Waiting Centre'],
    ['forecast', 'Forecast'],
    ['insights', 'Insights'],
    ['workflows', 'Processes'],
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
/* what needs attention: one list, the same on Today (its summary) and here, so the counts agree.
   Each item says what it is, how urgent (sev: 0 a failure, 1 overdue or unconfirmed, 2 for today,
   3 a reminder) and where to act on it. One incident is one item: a flow execution that a
   workflow run launched is part of that run (its failure is the run's failed stage, its details
   a tap away there), found by the run's own reference to it, never by matching names. Opening the
   list acknowledges nothing: an item goes when it's resolved, or acknowledged where it's dealt with. */
const ATT_SEV = ['Failed', 'Overdue', 'Today', 'Reminder'];
// The workflow run an execution belongs to (it launched it), if any.
function execRun(x) {
  return S.wruns.find(
    r => (r.live && r.live.exec === x.id) || Object.values(r.st || {}).some(o => o.exec === x.id),
  );
}
function attentionItems() {
  const t = today(),
    rows = [],
    add = (sev, text, sub, act, attrs) => rows.push({ sev, text, sub, act, attrs });
  S.wruns
    .filter(r => r.status === 'failed' && !r.ack)
    .forEach(r =>
      add(0, r.name, 'Process failed: ' + r.err, 'Open the failed step', `data-wfopen="${r.id}"`),
    );
  execFailures()
    .filter(x => !execRun(x))
    .forEach(x =>
      add(
        0,
        (S.flows.find(f => f.id === x.flow) || {}).name || 'Automation',
        'Automation failed' + (x.msg ? ': ' + x.msg : ''),
        'Open automation details',
        `data-xdet="${x.id}"`,
      ),
    );
  S.execs
    .filter(x => execStale(x) && !x.ack)
    .forEach(x => {
      const r = execRun(x),
        when = 'Launched ' + whenLabel(x.at) + ', no word since';
      if (r && !WRUN_FINAL.includes(r.status))
        add(1, r.name, when + ' from its automation', 'Open process', `data-wfopen="${r.id}"`);
      else if (!r)
        add(
          1,
          (S.flows.find(f => f.id === x.flow) || {}).name || 'Automation',
          when,
          'Open automation details',
          `data-xdet="${x.id}"`,
        );
    });
  const today2 = [];
  (function w(ns) {
    ns.forEach(n => {
      if (isDone(n)) return;
      if (n.due && n.due < t)
        add(1, n.text, 'Overdue, due ' + niceDate(n.due), 'Open task', `data-open="${n.id}"`);
      else if (n.due === t) today2.push([n.text, 'Due today', 'Open task', `data-open="${n.id}"`]);
      w(n.children);
    });
  })(S.quests);
  waitingNodes()
    .filter(x => x.n.wait.due && x.n.wait.due <= t)
    .forEach(x => {
      const who = x.n.wait.who || 'someone';
      if (x.n.wait.due < t)
        add(
          1,
          x.n.text,
          `Chase ${who}, was due ${niceDate(x.n.wait.due)}`,
          'Open in Waiting',
          `data-wgo="${x.n.id}"`,
        );
      else today2.push([x.n.text, `Chase ${who} today`, 'Open in Waiting', `data-wgo="${x.n.id}"`]);
    });
  today2.forEach(r => add(2, ...r));
  S.quests
    .filter(q => isScheduled(q) && q.scheduled.date < t)
    .forEach(q =>
      add(
        3,
        q.text,
        `Scheduled ${dayLabel(q.scheduled.date).replace(/^Yesterday$/, 'yesterday')}: not marked done`,
        'Open task',
        `data-open="${q.id}"`,
      ),
    );
  S.wruns
    .filter(r => r.status === 'ready')
    .forEach(r => add(2, r.name, 'Process ready to start', 'Start process', `data-wfopen="${r.id}"`));
  if (S.inbox.length >= 10)
    add(
      3,
      plural(S.inbox.length, 'Inbox item'),
      'Waiting to be processed',
      'Process the Inbox',
      'data-goto="inbox"',
    );
  if (typeof reviewDue === 'function' && reviewDue())
    add(3, 'Weekly review', 'Due this weekend', 'Open review', 'data-rsub="week"');
  return rows.sort((a, b) => a.sev - b.sev);
}
// (the name the routines and the day's summary use)
const opsAttention = attentionItems;
// A line saying what the items are: "1 failed · 2 overdue · 1 today".
function attentionCounts(items) {
  const n = [0, 0, 0, 0];
  items.forEach(i => n[i.sev]++);
  return ['failed', 'overdue', 'today', n[3] === 1 ? 'reminder' : 'reminders']
    .map((w, i) => (n[i] ? `${n[i]} ${w}` : ''))
    .filter(Boolean)
    .join(' · ');
}
// One item as a row: what it is, why, and (on the right) what tapping it does.
function attentionRow(i) {
  // (not a .row in a .list: those are Today's tasks)
  return `<div class="attrow sev${i.sev}"><button class="open" ${i.attrs}><span>${esc(i.text)}</span><small>${esc(i.sub)} · <em class="attgo">${esc(i.act)} &rsaquo;</em></small></button></div>`;
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
    .filter(r => !r.fin && procOf(r.art) && !guideParent(r)) // (one inside a process: shown as that process)
    .sort((a, b) => b.at - a.at)
    .forEach(r => rows.push({ text: procOf(r.art).title, sub: 'Guide · ' + runLine(r), runopen: r.id }));
  S.execs
    // (an attempt a run under way is waiting on: the run's row says so; any other, its own row)
    .filter(
      x =>
        !EXEC_TERMINAL.includes(x.status) &&
        !execStale(x) &&
        !S.wruns.some(r => r.live.exec === x.id && !WRUN_FINAL.includes(r.status)),
    )
    .sort((a, b) => b.at - a.at)
    .forEach(x =>
      rows.push({
        text: (S.flows.find(f => f.id === x.flow) || {}).name || 'Automation',
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
        wfs.length ? 'processes: ' + wfs.map(w => w.name).join(', ') : '',
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
  // (A failure still needing attention is in Needs attention, not here; a workflow run's own flow
  // execution is part of the run.)
  S.wruns
    .filter(r => WRUN_FINAL.includes(r.status) && !(r.status === 'failed' && !r.ack))
    .forEach(r =>
      rows.push({
        t: r.fin || r.at,
        text: r.name,
        sub: 'Process ' + WRUN_WORD[r.status].toLowerCase() + (r.err ? ': ' + r.err : ''),
        k: r.status === 'succeeded' ? 'ok' : 'bad',
        wfopen: r.id,
      }),
    );
  S.execs
    .filter(x => EXEC_TERMINAL.includes(x.status) && !execRun(x) && !(x.status === 'failed' && !x.ack))
    .forEach(x =>
      rows.push({
        t: x.upd,
        text: (S.flows.find(f => f.id === x.flow) || {}).name || 'Automation',
        sub: 'Automation ' + x.status + (x.msg ? ': ' + x.msg : ''),
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
    h +=
      '<p class="hint">Pin what you use most: a process, a guide, a desktop automation, a task or a page.</p>';
  h += `<div class="acts"><button class="btn sm" data-pinadd="1">Pin something</button>${S.pins.length ? `<button class="btn sm" data-pinedit="1" aria-pressed="${opsEdit}">${opsEdit ? 'Done' : 'Reorder'}</button>` : ''}</div>`;
  return h;
}
function renderOps() {
  if (!$('#v-ops')) return;
  const att = attentionItems(),
    prog = opsProgress(),
    coming = opsComing(),
    out = opsOutcomes();
  let h = `<button class="linkbtn" data-goto="today">&lsaquo; Today</button><h2 class="opshead">Command Centre</h2><p class="hint opsync">${opsSyncLine()}</p>`;
  // Operations first (what needs you, then what's under way); with neither, one quiet line.
  if (att.length)
    h += `<section class="opsec"><div class="sechead"><h2>Needs attention <small>${att.length}</small></h2></div><div class="attlist box">${att.map(attentionRow).join('')}</div></section>`;
  if (prog.length) h += opsSection('In progress', prog, '');
  if (!att.length && !prog.length)
    h += '<p class="slot opsquiet">All clear: nothing needs you and nothing is running.</p>';
  h += `<section class="opsec"><div class="sechead"><h2>Quick launch</h2></div>${renderPins()}</section>`;
  if (out.length)
    h += opsSection(
      'Recent results',
      out,
      '',
      `<button class="linkbtn" data-rsub="insights">Insights</button>`,
    );
  // What's coming, briefly: the Forecast has the rest.
  if (coming.length)
    h += opsSection(
      'Coming up',
      coming.slice(0, 3),
      '',
      `<button class="linkbtn" data-rsub="forecast">${coming.length > 3 ? `All ${coming.length} days in Forecast` : 'Forecast'}</button>`,
    );
  // The two checklists: lists of things to open, one tap each (nothing runs on its own).
  h += `<section class="opsec"><div class="sechead"><h2>Checklists</h2></div><div class="acts opsroutines"><button class="btn sm" data-routine="start">Morning checklist</button><button class="btn sm" data-routine="finish">End-of-day checklist</button></div></section>`;
  setHTML($('#v-ops'), h);
}
function routineSheet(kind) {
  const t = today(),
    f = allocate(7),
    att = opsAttention(),
    nx = recommend(),
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
      [`Processes under way: ${open}`, 'data-goto="ops"', ''],
      [`Tomorrow: ${hm(f.days[1].load)} planned of ${hm(f.days[1].cap)}`, 'data-rsub="forecast"', ''],
      [`Copy today's summary (${plural(done, 'task')} finished)`, 'data-opscopy="1"', ''],
      S.timer ? ['A session is running: stop it from Focus', 'data-goto="focus"', ''] : null,
    ];
  }
  popSheet(
    `<h2 id="sheettitle">${kind === 'start' ? 'Morning checklist' : 'End-of-day checklist'}</h2><p class="hint">Work down the list: each item opens when you tap it. Nothing runs on its own.</p><div class="qalist">${items
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
