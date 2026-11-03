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
// "12 quests finished, against 9 the period before (up 33%)". The same words every time.
function trendLine(now, before, what, fmt = String) {
  const w = n => (Array.isArray(what) ? (n === 1 ? what[0] : what[1]) : what);
  if (!now && !before) return `No ${w(0)} in either period.`;
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
      trendLine(x.prod.done, x.prod.doneBefore, ['quest finished', 'quests finished']),
      trendLine(x.prod.focusNow, x.prod.focusBefore, 'of focus time', hm) +
        (x.prod.focusNow ? ` About ${hm(Math.round(x.prod.focusNow / x.span))} a day.` : ''),
      trendLine(x.prod.inter, x.prod.interBefore, ['interruption noted', 'interruptions noted']),
    ],
  ]);
  const w = x.wf.now;
  L.push([
    'Workflows',
    [
      w.n
        ? `${plural(w.n, 'run')} started: ${w.ok} succeeded, ${w.failed} failed, ${w.cancelled} cancelled, ${w.open} still under way. Success rate ${x.wf.rate}% of the ${plural(x.wf.withOutcome, 'run')} with an outcome (cancelled and unfinished runs aren't counted).`
        : 'No workflow runs started this period.',
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
        ? `${a.n === 1 ? '1 flow launch' : a.n + ' flow launches'}: ${a.ok} verified succeeded, ${a.failed} verified failed, ${a.cancelled} cancelled, ${a.unconfirmed} unconfirmed (no word after a day), ${a.running} awaiting a result. Success rate ${a.rate}% of the ${plural(a.verified, 'verified result')}.${x.auto.lag ? ` A first report typically arrives ${hm(Math.max(1, Math.round(x.auto.lag / 60000)))} after the launch.` : ''}`
        : 'No flow launches this period.',
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
/* the page */
function renderInsights() {
  const x = insights(insightSpan),
    max = Math.max(1, ...x.prod.days.map(d => d.done)),
    fmax = Math.max(1, ...x.prod.days.map(d => d.focus));
  let h = `<div class="chips">${INSIGHT_SPANS.map(s => `<button class="chip" data-ispan="${s}" aria-pressed="${s === insightSpan}">${s} days</button>`).join('')}</div>
    <p class="hint">${esc(dayLabel(x.p.from))} to ${esc(dayLabel(x.p.to))}, against the ${x.span} days before. Counts come from this device's records as synced; rates say what they're a rate of.</p>`;
  const bars = (key, m, label) =>
    `<div class="ibars${x.span > 30 ? ' tight' : ''}" role="img" aria-label="${label}, each day">${x.prod.days.map(d => `<span class="ibar" title="${esc(dayLabel(d.d))}: ${d[key]}" style="height:${Math.round((d[key] / m) * 100)}%"></span>`).join('')}</div>`;
  insightLines(x).forEach(([head, lines], i) => {
    h += `<h2>${esc(head)}</h2>`;
    if (i === 0)
      h += `<p class="hint ilabel">Quests finished, each day</p>${bars('done', max, 'Quests finished')}<p class="hint ilabel">Focus time, each day</p>${bars('focus', fmax, 'Focus minutes')}`;
    h += `<ul class="ilines">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
  });
  h += `<div class="acts"><button class="btn" data-iexport="text">Copy as text</button><button class="btn" data-iexport="csv">Save CSV</button></div><p class="hint">Exports hold these counts only: no tokens, keys or account details.</p>`;
  return h;
}
function insightClick(d) {
  if (d.ispan) {
    insightSpan = +d.ispan;
    renderReview();
  }
  if (d.iexport === 'text') copyText(insightsText());
  if (d.iexport === 'csv') downloadText(`dashboard-insights-${today()}.csv`, insightsCsv(), 'text/csv');
}
