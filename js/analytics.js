/* operational analytics (Release C), under Review > Insights: counts from the records over a
   period, each against the period before it, in plain sentences worked out the same way every
   time. Every rate says what it's a rate of: a workflow success rate counts only runs with an
   outcome (cancelled and still-running runs are named, not counted); a flow's rate counts only
   verified reports (launches with no word, or no word for a day, are "unconfirmed"); focus time
   is what the timer measured. Exports carry these numbers and nothing else: no tokens, keys or
   account details. */
const INSIGHT_SPANS = [7, 30, 90];
let insightSpan = 30;
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const median = xs => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const daysWord = n => (n === 1 ? '1 day' : n + ' days');
// "12 tasks finished, against 9 the period before (up 33%)". The same words every time.
function trendLine(now, before, what, fmt = String) {
  const w = n => (Array.isArray(what) ? (n === 1 ? what[0] : what[1]) : what);
  if (!now && !before) return `No ${w(0).replace(/^of /, '')} in either period.`;
  if (!before) return `${fmt(now)} ${w(now)} this period, none the period before.`;
  const d = (now - before) / before;
  const how =
    Math.abs(d) < 0.1
      ? 'about the same as'
      : d > 0
        ? `up ${Math.round(d * 100)}% on`
        : `down ${Math.round(-d * 100)}% on`;
  return `${fmt(now)} ${w(now)} this period, ${how} the period before (${fmt(before)}).`;
}
// The period: [from, to] days inclusive, and the one before it.
function periods(span) {
  const to = today(),
    from = shift(to, -(span - 1)),
    pto = shift(from, -1),
    pfrom = shift(pto, -(span - 1));
  return {
    from,
    to,
    pfrom,
    pto,
    fromT: Date.parse(from + 'T00:00'),
    toT: Date.parse(to + 'T23:59:59'),
    pfromT: Date.parse(pfrom + 'T00:00'),
    ptoT: Date.parse(pto + 'T23:59:59'),
  };
}
const inDays = (d, a, b) => d >= a && d <= b;
const inT = (t, a, b) => t >= a && t <= b;
function productivity(p) {
  const done = S.log.filter(l => inDays(l.d, p.from, p.to)).length,
    doneBefore = S.log.filter(l => inDays(l.d, p.pfrom, p.pto)).length,
    focus = d => (inDays(d, p.from, p.to) ? Object.values(S.daily[d] || {}).reduce((a, b) => a + b, 0) : 0),
    focusNow = Object.keys(S.daily).reduce((a, d) => a + focus(d), 0),
    focusBefore = Object.keys(S.daily)
      .filter(d => inDays(d, p.pfrom, p.pto))
      .reduce((a, d) => a + Object.values(S.daily[d]).reduce((x, y) => x + y, 0), 0),
    inter = S.interrupts.filter(x => inT(x.t, p.fromT, p.toT)).length,
    interBefore = S.interrupts.filter(x => inT(x.t, p.pfromT, p.ptoT)).length,
    days = [];
  for (let d = p.from; d <= p.to; d = shift(d, 1))
    days.push({ d, done: S.log.filter(l => l.d === d).length, focus: focus(d) });
  return { done, doneBefore, focusNow, focusBefore, inter, interBefore, days };
}
function workflowStats(p) {
  const runs = S.wruns.filter(r => inT(r.started, p.fromT, p.toT)),
    before = S.wruns.filter(r => inT(r.started, p.pfromT, p.ptoT)),
    by = rs => ({
      n: rs.length,
      ok: rs.filter(r => r.status === 'succeeded').length,
      failed: rs.filter(r => r.status === 'failed').length,
      cancelled: rs.filter(r => r.status === 'cancelled').length,
      open: rs.filter(r => !WRUN_FINAL.includes(r.status)).length,
    }),
    now = by(runs),
    prev = by(before),
    withOutcome = now.ok + now.failed,
    perWf = {};
  runs.forEach(r => {
    const w = (perWf[r.wf] = perWf[r.wf] || { name: r.name, n: 0, ok: 0, failed: 0, durs: [], stages: {} });
    w.n++;
    if (r.status === 'succeeded') {
      w.ok++;
      w.durs.push(r.fin - r.started);
    }
    if (r.status === 'failed') w.failed++;
    Object.keys(r.st).forEach(sid => {
      if (r.st[sid].o !== 'failed') return;
      const s = r.def.find(x => x.id === sid);
      if (s) w.stages[s.title] = (w.stages[s.title] || 0) + 1;
    });
  });
  const table = Object.values(perWf)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)
    .map(w => ({
      ...w,
      med: median(w.durs),
      worst: Object.entries(w.stages).sort((a, b) => b[1] - a[1])[0] || null,
    }));
  return { now, prev, withOutcome, rate: pctOf(now.ok, withOutcome), table };
}
function automationStats(p) {
  const xs = S.execs.filter(x => inT(x.at, p.fromT, p.toT)),
    before = S.execs.filter(x => inT(x.at, p.pfromT, p.ptoT)),
    by = list => {
      const o = { n: list.length, ok: 0, failed: 0, cancelled: 0, unconfirmed: 0, running: 0 };
      list.forEach(x => {
        const st = execState(x);
        if (st === 'succeeded') o.ok++;
        else if (st === 'failed') o.failed++;
        else if (st === 'cancelled') o.cancelled++;
        else if (st === 'unconfirmed') o.unconfirmed++;
        else o.running++;
      });
      o.verified = o.ok + o.failed;
      o.rate = pctOf(o.ok, o.verified);
      return o;
    },
    now = by(xs),
    prev = by(before),
    lag = median(xs.filter(x => x.ev.length).map(x => Math.max(0, x.ev[0].t - x.at))),
    perFlow = {};
  xs.forEach(x => {
    const f = (perFlow[x.flow] = perFlow[x.flow] || {
      name: (S.flows.find(y => y.id === x.flow) || {}).name || 'removed flow',
      list: [],
    });
    f.list.push(x);
  });
  const table = Object.values(perFlow)
    .map(f => ({ name: f.name, ...by(f.list) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);
  return { now, prev, lag, table };
}
function waitingStats(p) {
  // Resolved in the period: each with how long from its (latest earlier) start or reopen.
  const resolved = S.follows.filter(f => f.k === 'resolve' && inT(f.t, p.fromT, p.toT)),
    before = S.follows.filter(f => f.k === 'resolve' && inT(f.t, p.pfromT, p.ptoT)),
    waitOf = f => {
      const start = S.follows
        .filter(x => x.n === f.n && (x.k === 'start' || x.k === 'reopen') && x.t <= f.t)
        .sort((a, b) => b.t - a.t)[0];
      return start ? Math.round((f.t - start.t) / 864e5) : null;
    },
    durs = resolved.map(waitOf).filter(x => x !== null),
    chases = S.follows.filter(f => f.k === 'chase' && inT(f.t, p.fromT, p.toT)).length,
    open = waitingNodes(),
    byWho = {};
  open.forEach(x => {
    const who = x.n.wait.who || 'someone',
      days = x.n.wait.since ? daysBetween(x.n.wait.since, today()) : 0,
      w = (byWho[who] = byWho[who] || { who, n: 0, max: 0, late: 0 });
    w.n++;
    w.max = Math.max(w.max, days);
    if (x.n.wait.due && x.n.wait.due < today()) w.late++;
  });
  const people = Object.values(byWho)
    .sort((a, b) => b.max - a.max || b.n - a.n)
    .slice(0, 6);
  return {
    resolved: resolved.length,
    before: before.length,
    med: median(durs),
    max: Math.max(0, ...durs),
    chases,
    open: open.length,
    people,
  };
}
function ruleStats(p) {
  const logs = S.rlog.filter(l => inT(l.t, p.fromT, p.toT));
  return {
    fired: logs.filter(l => l.out === 'done').length,
    limited: logs.filter(l => l.out === 'limit').length,
    errors: logs.filter(l => l.out === 'err').length,
    dup: logs.filter(l => l.out === 'dup').length,
  };
}
function insights(span = insightSpan) {
  const p = periods(span);
  return {
    p,
    span,
    prod: productivity(p),
    wf: workflowStats(p),
    auto: automationStats(p),
    wait: waitingStats(p),
    rules: ruleStats(p),
    acc: estimateAccuracy(span),
  };
}
/* the sentences, for the page and the text export (the same words) */
function insightLines(x) {
  const L = [];
  L.push([
    'Productivity',
    [
      trendLine(x.prod.done, x.prod.doneBefore, ['task finished', 'tasks finished']),
      trendLine(x.prod.focusNow, x.prod.focusBefore, 'of focus time', hm) +
        (x.prod.focusNow ? ` About ${hm(Math.round(x.prod.focusNow / x.span))} a day.` : ''),
      trendLine(x.prod.inter, x.prod.interBefore, ['interruption noted', 'interruptions noted']),
    ],
  ]);
  const w = x.wf.now;
  L.push([
    'Processes',
    [
      w.n
        ? `${plural(w.n, 'run')} started: ${w.ok} succeeded, ${w.failed} failed, ${w.cancelled} cancelled, ${w.open} still under way. Success rate ${x.wf.rate}% of the ${plural(x.wf.withOutcome, 'run')} with an outcome (cancelled and unfinished runs aren't counted).`
        : 'No process runs started this period.',
      trendLine(w.n, x.wf.prev.n, ['run started', 'runs started']),
      ...x.wf.table.map(
        t =>
          `${t.name}: ${plural(t.n, 'run')}, ${t.ok} succeeded, ${t.failed} failed${t.med ? `, a successful run typically takes ${hm(Math.max(1, Math.round(t.med / 60000)))}` : ''}${t.worst ? `; most failed stage: ${t.worst[0]} (${t.worst[1]})` : ''}.`,
      ),
    ],
  ]);
  const a = x.auto.now;
  L.push([
    'Automation',
    [
      a.n
        ? `${a.n === 1 ? '1 automation launch' : a.n + ' automation launches'}: ${a.ok} verified succeeded, ${a.failed} verified failed, ${a.cancelled} cancelled, ${a.unconfirmed} unconfirmed (no word after a day), ${a.running} awaiting a result. Success rate ${a.rate}% of the ${plural(a.verified, 'verified result')}.${x.auto.lag ? ` A first report typically arrives ${hm(Math.max(1, Math.round(x.auto.lag / 60000)))} after the launch.` : ''}`
        : 'No automation launches this period.',
      trendLine(a.n, x.auto.prev.n, ['launch', 'launches']),
      ...x.auto.table.map(
        t =>
          `${t.name}: ${t.n === 1 ? '1 launch' : t.n + ' launches'}, ${t.ok} succeeded, ${t.failed} failed, ${t.unconfirmed} unconfirmed, ${t.running} awaiting; ${t.rate}% of ${t.verified} verified.`,
      ),
    ],
  ]);
  const wt = x.wait;
  L.push([
    'Waiting',
    [
      trendLine(wt.resolved, wt.before, ['waiting item resolved', 'waiting items resolved']) +
        (wt.med ? ` Typically after ${daysWord(wt.med)}, the longest ${daysWord(wt.max)}.` : ''),
      `${plural(wt.chases, 'follow-up')} recorded. ${plural(wt.open, 'item')} open now.`,
      ...wt.people.map(
        pp =>
          `${pp.who}: ${plural(pp.n, 'open item')}, waiting up to ${daysWord(pp.max)}${pp.late ? `, ${pp.late} past the chase date` : ''}.`,
      ),
    ],
  ]);
  L.push(['Estimates', [accuracyText(x.acc)]]);
  const r = x.rules;
  L.push([
    'Rules',
    [
      r.fired || r.limited || r.errors
        ? `Rules fired ${plural(r.fired, 'time')}, held back by a daily cap ${plural(r.limited, 'time')}, with ${plural(r.errors, 'error')}.`
        : 'No rules fired this period.',
    ],
  ]);
  return L;
}
function insightsText(x = insights()) {
  return [
    `Insights, ${dayLabel(x.p.from)} to ${dayLabel(x.p.to)} (${x.span} days), against the ${x.span} days before`,
    ...insightLines(x).flatMap(([h, ls]) => ['', h, ...ls.map(l => '- ' + l)]),
  ].join('\n');
}
function insightsCsv(x = insights()) {
  const esc2 = v => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  const rows = [
    [
      'date',
      'quests_finished',
      'focus_minutes',
      'runs_started',
      'runs_succeeded',
      'runs_failed',
      'runs_cancelled',
      'launches',
      'launches_succeeded',
      'launches_failed',
      'launches_unconfirmed',
      'waits_resolved',
      'rules_fired',
    ],
  ];
  x.prod.days.forEach(({ d, done, focus }) => {
    const a = Date.parse(d + 'T00:00'),
      b = Date.parse(d + 'T23:59:59'),
      runs = S.wruns.filter(r => inT(r.started, a, b)),
      xs = S.execs.filter(y => inT(y.at, a, b));
    rows.push([
      d,
      done,
      focus,
      runs.length,
      runs.filter(r => r.status === 'succeeded').length,
      runs.filter(r => r.status === 'failed').length,
      runs.filter(r => r.status === 'cancelled').length,
      xs.length,
      xs.filter(y => execState(y) === 'succeeded').length,
      xs.filter(y => execState(y) === 'failed').length,
      xs.filter(y => execState(y) === 'unconfirmed').length,
      S.follows.filter(f => f.k === 'resolve' && inT(f.t, a, b)).length,
      S.rlog.filter(l => l.out === 'done' && inT(l.t, a, b)).length,
    ]);
  });
  return rows.map(r => r.map(esc2).join(',')).join('\n');
}
function downloadText(name, text, type) {
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  } catch (e) {
    toast("Couldn't save the file on this device");
  }
}
/* findings: the few things worth knowing, picked the same way every time from the records.
   Each rule has a bar to clear (so a single failure, or 1 against 2, isn't a finding), says
   what it rests on, and where to act. Order: severity (0 needs action, 1 worth a look, 2 a
   trend), then the size of the evidence, then recency. At most three are shown. */
function findings(x) {
  const out = [],
    p = x.p,
    t = today();
  // 1. A desktop automation failing repeatedly: at least 2 verified failures, and no more successes than failures.
  x.auto.table.forEach(f => {
    if (f.failed >= 2 && f.failed >= f.ok) {
      const last = S.execs
        .filter(e => (S.flows.find(y => y.id === e.flow) || {}).name === f.name && execState(e) === 'failed')
        .sort((a, b) => b.upd - a.upd)[0];
      out.push({
        sev: 0,
        n: f.failed,
        at: last ? last.upd : 0,
        title: `${f.name} keeps failing`,
        why: `${f.failed} of ${f.verified} verified attempts failed in the last ${x.span} days (${f.ok} succeeded).`,
        act: last ? ['Open the latest attempt', `data-xdet="${last.id}"`] : null,
      });
    }
  });
  // 2. One step of a process failing again and again: the same step failed in 2 or more runs.
  x.wf.table.forEach(w => {
    if (w.worst && w.worst[1] >= 2) {
      const wf = S.workflows.find(y => y.name === w.name);
      out.push({
        sev: 0,
        n: w.worst[1],
        at: 0,
        title: `“${w.worst[0]}” fails in ${w.name}`,
        why: `That step failed in ${w.worst[1]} of ${plural(w.n, 'run')} started in the last ${x.span} days.`,
        act: wf ? ['Open the process', `data-wfview="${wf.id}"`] : null,
      });
    }
  });
  // 3. Runs with no movement for three days or more (not paused on purpose).
  const stuck = S.wruns
    .filter(
      r =>
        !WRUN_FINAL.includes(r.status) &&
        r.status !== 'paused' &&
        r.status !== 'ready' &&
        Date.now() - r.at > 3 * 864e5,
    )
    .sort((a, b) => a.at - b.at);
  if (stuck.length)
    out.push({
      sev: 1,
      n: stuck.length,
      at: stuck[0].at,
      title:
        stuck.length === 1
          ? `${stuck[0].name} hasn't moved for ${daysWord(Math.floor((Date.now() - stuck[0].at) / 864e5))}`
          : `${stuck.length} processes haven't moved for 3 days or more`,
      why:
        stuck.length === 1
          ? `Its current step is ${runStage(stuck[0]) ? '“' + runStage(stuck[0]).title + '”' : 'unknown'} (${runWord(stuck[0]).toLowerCase()}).`
          : stuck
              .map(r => r.name)
              .slice(0, 3)
              .join(', ') +
            (stuck.length > 3 ? ', …' : '') +
            '.',
      act: ['Open the oldest', `data-wfopen="${stuck[0].id}"`],
    });
  // 4. Overdue work piling up: three or more open tasks past their due date.
  const late = [];
  (function w(ns) {
    ns.forEach(n => {
      if (isDone(n)) return;
      if (n.due && n.due < t) late.push(n);
      w(n.children);
    });
  })(S.quests);
  if (late.length >= 3)
    out.push({
      sev: 1,
      n: late.length,
      at: Date.now(),
      title: `${late.length} tasks are overdue`,
      why: `The oldest was due ${dayLabel(late.map(n => n.due).sort()[0])}. Overdue work is counted from the tasks on Today, not from history.`,
      act: ['See them in the Command Centre', 'data-goto="ops"'],
    });
  // 5. Waiting that needs chasing again and again: three or more follow-ups on one item in the period, still open.
  const chased = {};
  S.follows
    .filter(f => f.k === 'chase' && inT(f.t, p.fromT, p.toT))
    .forEach(f => (chased[f.n] = (chased[f.n] || 0) + 1));
  Object.entries(chased)
    .filter(([n, c]) => c >= 3 && findWaitable(n).n && findWaitable(n).n.wait)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1)
    .forEach(([n, c]) => {
      const node = findWaitable(n).n;
      out.push({
        sev: 1,
        n: c,
        at: 0,
        title: `Still waiting on ${node.wait.who || 'someone'} after ${plural(c, 'follow-up')}`,
        why: `“${node.text}” has been followed up ${c} times in the last ${x.span} days and is still open.`,
        act: ['Open in Waiting', `data-wgo="${n}"`],
      });
    });
  // 6. Launches that never reported: two or more unconfirmed in the period (tracking on).
  if (x.auto.now.unconfirmed >= 2)
    out.push({
      sev: 1,
      n: x.auto.now.unconfirmed,
      at: 0,
      title: `${x.auto.now.unconfirmed} automation launches never reported a result`,
      why: 'No report arrived within a day of the launch: the automation may not have started, or its report never reached the app.',
      act: ['Check result tracking', 'data-goto="account"'],
    });
  // 7. Estimates running low or high: five or more finished tasks with an estimate, and the typical one off by half.
  if (x.acc.n >= 5 && (x.acc.median >= 1.5 || x.acc.median <= 0.5))
    out.push({
      sev: 2,
      n: x.acc.n,
      at: 0,
      title:
        x.acc.median >= 1.5
          ? `Tasks take about ${x.acc.median.toFixed(1)}× their estimate`
          : `Tasks take about ${x.acc.median.toFixed(1)}× their estimate`,
      why: `From ${plural(x.acc.n, 'finished task')} with an estimate and timer-measured focus time (work done without the timer isn't measured).`,
      act: ['Open the Forecast', 'data-rsub="forecast"'],
    });
  // 8. A real change in what gets finished: at least five in each period, and a third more or less.
  if (x.prod.done >= 5 && x.prod.doneBefore >= 5) {
    const d = (x.prod.done - x.prod.doneBefore) / x.prod.doneBefore;
    if (Math.abs(d) >= 1 / 3)
      out.push({
        sev: 2,
        n: Math.abs(x.prod.done - x.prod.doneBefore),
        at: 0,
        title: `Tasks finished ${d > 0 ? 'up' : 'down'} ${Math.round(Math.abs(d) * 100)}% on the period before`,
        why: `${x.prod.done} finished in the last ${x.span} days against ${x.prod.doneBefore} in the ${x.span} before.`,
        act: ['See the history', 'data-rsub="log"'],
      });
  }
  return out.sort((a, b) => a.sev - b.sev || b.n - a.n || b.at - a.at).slice(0, 3);
}
// How much there is to measure: with fewer than three recorded things in the period, the page
// says what it can measure instead of showing empty sections (fewer than two recorded things).
const insightsSparse = x =>
  x.prod.done + x.wf.now.n + x.auto.now.n + x.wait.resolved + (x.prod.focusNow ? 1 : 0) < 2;
/* the page: findings, the key numbers, two charts you can tap, then the detail folded */
let insightPick = null; // the bar tapped: { key, d }
function statTile(label, value, sub) {
  return `<div class="stat"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
}
// "vs 9 before", only when both periods have enough to compare (three or more).
function vsBefore(now, before, fmt = String) {
  if (now < 3 && before < 3) return '';
  if (!before) return 'none the period before';
  const d = (now - before) / before;
  return Math.abs(d) < 0.1 ? 'about the same as before' : `${d > 0 ? 'up' : 'down'} from ${fmt(before)}`;
}
function renderInsights() {
  const x = insights(insightSpan),
    max = Math.max(1, ...x.prod.days.map(d => d.done)),
    fmax = Math.max(1, ...x.prod.days.map(d => d.focus)),
    found = findings(x),
    sparse = insightsSparse(x);
  let h = `<div class="chips">${INSIGHT_SPANS.map(s => `<button class="chip" data-ispan="${s}" aria-pressed="${s === insightSpan}">${s} days</button>`).join('')}</div>
    <p class="hint">${esc(dayLabel(x.p.from))} to today, against the ${x.span} days before. Counts are from this device's records as synced.</p>`;
  // 1. Findings.
  h += '<h2>What stands out</h2>';
  if (found.length)
    h += `<div class="findings">${found
      .map(
        f =>
          `<div class="finding sev${f.sev}"><b>${esc(f.title)}</b><p>${esc(f.why)}</p>${f.act ? `<button class="btn sm" ${f.act[1]}>${esc(f.act[0])}</button>` : ''}</div>`,
      )
      .join('')}</div>`;
  else if (sparse)
    h += `<div class="box findnone"><p><b>Not much to measure yet.</b> Insights are counted from what you finish, the processes you run, the automations that report back and the waiting items you resolve.</p><p class="hint">As those build up, this page shows what stands out: automations that keep failing, process steps that fail, runs that stall, overdue work piling up, items chased again and again, estimates running low, and real changes in what gets finished. Each needs a few recorded cases before it's shown.</p></div>`;
  else
    h += `<p class="hint findnone">Nothing stands out in the last ${x.span} days: no automation or process step failing repeatedly, no stalled runs, no pile-up of overdue work, no item chased three times, and no large change in what gets finished.</p>`;
  if (sparse) {
    h += `<div class="acts"><button class="btn" data-iexport="text">Copy as text</button><button class="btn" data-iexport="csv">Save CSV</button></div>`;
    return h;
  }
  // 2. The key numbers.
  const w = x.wf.now,
    a = x.auto.now;
  h += `<h2>Key numbers</h2><div class="stats">${statTile('Tasks finished', x.prod.done, vsBefore(x.prod.done, x.prod.doneBefore))}${statTile('Focus time (timer)', hm(x.prod.focusNow), vsBefore(x.prod.focusNow, x.prod.focusBefore, hm))}${statTile('Process runs', w.n ? `${w.ok} <small>of ${w.n} completed</small>` : '0', w.n ? `${w.failed} failed · ${w.cancelled} cancelled · ${w.open} under way` : '')}${statTile('Automation attempts', a.n ? `${a.ok} <small>of ${a.verified} verified ok</small>` : '0', a.n ? `${a.failed} failed · ${a.unconfirmed} unconfirmed · ${a.running} awaiting` : '')}</div>`;
  // 3. Two charts, a bar a day; a tap says the day's number (no hover needed).
  const bars = (key, m, label, unit) =>
    `<div class="ibars${x.span > 30 ? ' tight' : ''}" role="group" aria-label="${label}, each day">${x.prod.days
      .map(
        d =>
          `<button class="ibar${insightPick && insightPick.key === key && insightPick.d === d.d ? ' picked' : ''}" data-ibar="${key}" data-d="${d.d}" aria-label="${esc(dayLabel(d.d))}: ${unit(d[key])}" style="height:${Math.round((d[key] / m) * 100)}%"></button>`,
      )
      .join(
        '',
      )}</div>${insightPick && insightPick.key === key ? `<p class="hint ipick" aria-live="polite">${esc(dayLabel(insightPick.d))}: ${unit((x.prod.days.find(d => d.d === insightPick.d) || {})[key] || 0)}</p>` : ''}`;
  h += `<h2>Trends</h2><p class="hint ilabel">Tasks finished, each day</p>${bars('done', max, 'Tasks finished', n => plural(n, 'task'))}<p class="hint ilabel">Focus time, each day (timer)</p>${bars('focus', fmax, 'Focus minutes', hm)}`;
  h += `<details id="itable"${panels.itable ? ' open' : ''}><summary>As a table</summary><table class="itab"><thead><tr><th>Day</th><th>Finished</th><th>Focus</th></tr></thead><tbody>${
    x.prod.days
      .filter(d => d.done || d.focus)
      .map(d => `<tr><td>${esc(dayLabel(d.d))}</td><td>${d.done}</td><td>${hm(d.focus)}</td></tr>`)
      .join('') || '<tr><td colspan="3">Nothing recorded</td></tr>'
  }</tbody></table></details>`;
  // 4. The detail, folded: the same sentences the text export carries.
  h += `<details id="idetail"${panels.idetail ? ' open' : ''}><summary>Details</summary>${insightLines(x)
    .map(
      ([head, lines]) =>
        `<h3>${esc(head)}</h3><ul class="ilines">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`,
    )
    .join('')}</details>`;
  // 5. Exports.
  h += `<div class="acts"><button class="btn" data-iexport="text">Copy as text</button><button class="btn" data-iexport="csv">Save CSV</button></div><p class="hint">Exports hold these counts only: no tokens, keys or account details.</p>`;
  return h;
}
function insightClick(d) {
  if (d.ispan) {
    insightSpan = +d.ispan;
    insightPick = null;
    renderReview();
  }
  if (d.ibar) {
    insightPick =
      insightPick && insightPick.key === d.ibar && insightPick.d === d.d ? null : { key: d.ibar, d: d.d };
    renderReview();
  }
  if (d.iexport === 'text') copyText(insightsText());
  if (d.iexport === 'csv') downloadText(`dashboard-insights-${today()}.csv`, insightsCsv(), 'text/csv');
}
