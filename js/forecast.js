/* workload forecasting (Release C): estimates on quests and steps, how much time each day has,
   and a forecast of the next 7, 14 or 30 days worked out the same way every time (below).
   Nothing here moves a quest: a recommendation is a button, and the move is yours.
   Estimates: n.est, minutes. A quest's estimate is the sum of its steps' estimates when any
   step has one (its own is then ignored: no double counting), else its own. What's left of it
   is the estimate less the focus time spent on it (never below zero), which is a guess from
   two measured things, and said so.
   Capacity: S.cap, minutes for each weekday (Sunday first); until set, CAP_DEFAULT, shown as
   assumed. The forecast (allocate) fills days in order: quests sorted by due date (undated
   last), today's top 3 first, then list order; each takes the first days with room between its
   start and its due date, split across days when bigger than a day's room; what doesn't fit by
   its due date lands on that day as an overrun. Repeating quests count on their days with the
   template's estimate and don't move. Quests without an estimate are counted, not planned. */
const EST_MAX = 1440,
  CAP_DEFAULT = [0, 300, 300, 300, 300, 300, 0],
  FORECAST_SPANS = [7, 14, 30];
let forecastSpan = 7;
function cleanEst(n) {
  if (n.est === undefined || n.est === null) return;
  const e = Math.round(+n.est);
  if (e > 0 && e <= EST_MAX) n.est = e;
  else delete n.est;
}
function cleanCap(c) {
  if (!Array.isArray(c) || c.length !== 7) return null;
  const out = c.map(v => (Number.isFinite(+v) && +v >= 0 ? Math.min(Math.round(+v), 960) : 0));
  return out;
}
const capacity = () => S.cap || CAP_DEFAULT;
const capOf = ds => {
  const [y, m, d] = ds.split('-').map(Number);
  return capacity()[new Date(y, m - 1, d).getDay()];
};
// The estimate for a quest: its steps' (when any has one), else its own.
function effEst(n) {
  const kids = n.children.filter(c => effEst(c) > 0);
  if (kids.length) return kids.reduce((a, c) => a + effEst(c), 0);
  return n.est || 0;
}
const stepsEstimated = n => n.children.some(c => effEst(c) > 0);
// What's left: open steps' estimates, else the estimate less the focus time on it.
function remEst(n) {
  if (isDone(n)) return 0;
  if (stepsEstimated(n)) return n.children.reduce((a, c) => a + remEst(c), 0);
  return n.est ? Math.max(0, n.est - spent(n)) : 0;
}
const estLabel = n => {
  const e = effEst(n);
  if (!e) return '';
  const left = remEst(n);
  return `${hm(e)}${left !== e ? ` · ${hm(left)} left` : ''}${stepsEstimated(n) ? ' (steps)' : ''}`;
};
/* the forecast */
function forecastDays(span) {
  const out = [];
  for (let i = 0; i < span; i++) {
    const d = shift(today(), i);
    out.push({ d, cap: capOf(d), load: 0, items: [], over: 0 });
  }
  return out;
}
function forecastItems(span) {
  const t = today(),
    end = shift(t, span - 1),
    top3 = S.top3 && S.top3.day === t ? S.top3.ids : [],
    items = [],
    none = [];
  S.quests.forEach((q, i) => {
    if (isDone(q)) return;
    const min = remEst(q);
    if (!min) return none.push(q);
    items.push({
      id: q.id,
      text: q.text,
      min,
      from: t,
      due: q.due && q.due < t ? t : q.due || '',
      late: !!(q.due && q.due < t),
      top: top3.includes(q.id) ? 0 : 1,
      i,
    });
  });
  S.later.forEach((q, i) => {
    if (!q.start || q.start > end) return;
    const min = remEst(q);
    if (!min) return none.push(q);
    items.push({
      id: q.id,
      text: q.text,
      min,
      from: q.start,
      due: q.due || '',
      top: 1,
      i: 1000 + i,
      later: true,
    });
  });
  // Repeating quests on their days (after today: today's copy is on the list already).
  S.templates.forEach(tp => {
    const min = effEst(tp);
    if (!repeats(tp) || !min) return;
    for (let i = 1; i < span; i++) {
      const d = shift(t, i),
        [y, m, dd] = d.split('-').map(Number),
        wd = new Date(y, m - 1, dd).getDay(),
        last = new Date(y, m, 0).getDate();
      if (
        tp.days.includes(wd) ||
        (tp.monthDay && (tp.monthDay === dd || (tp.monthDay > last && dd === last)))
      )
        items.push({
          id: tp.id + '-' + d,
          text: tp.text,
          min,
          from: d,
          due: d,
          fixed: true,
          top: 1,
          i: 2000,
        });
    }
  });
  // (plain string order: a locale compare would put the undated marker before digits)
  const dueKey = x => x.due || '9999';
  items.sort((a, b) => {
    if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
    if (dueKey(a) !== dueKey(b)) return dueKey(a) < dueKey(b) ? -1 : 1;
    return a.top - b.top || a.i - b.i;
  });
  return { items, none };
}
function allocate(span = forecastSpan) {
  const days = forecastDays(span),
    at = Object.fromEntries(days.map((x, i) => [x.d, i])),
    { items, none } = forecastItems(span);
  items.forEach(it => {
    it.chunks = [];
    let left = it.min,
      d = at[it.from] ?? 0;
    const last = it.fixed
      ? d
      : it.due && at[it.due] !== undefined && at[it.due] >= d
        ? at[it.due]
        : days.length - 1;
    if (it.fixed) {
      days[d].load += left;
      days[d].items.push({ ...it, take: left });
      it.chunks.push([days[d].d, left]);
      return;
    }
    for (; left > 0 && d <= last; d++) {
      const room = days[d].cap - days[d].load;
      if (room <= 0) continue;
      const take = Math.min(room, left);
      days[d].load += take;
      days[d].items.push({ ...it, take });
      it.chunks.push([days[d].d, take]);
      left -= take;
    }
    if (left > 0) {
      // No room by its due date (or the horizon): it lands there anyway, as an overrun.
      days[last].load += left;
      days[last].over += left;
      days[last].items.push({ ...it, take: left, over: true });
      it.chunks.push([days[last].d, left]);
      it.over = left;
    }
  });
  const cap = days.reduce((a, x) => a + x.cap, 0),
    load = days.reduce((a, x) => a + x.load, 0);
  return { days, items, none, cap, load, assumed: !S.cap };
}
// Recommendations, each with why, in a fixed order: overruns (earliest day first), then what's
// unplanned. A move is offered only where a later day has room before the quest is due.
function recommendations(f) {
  const out = [];
  if (f.assumed)
    out.push({
      k: 'cap',
      text: 'Capacity is assumed: 5h on weekdays, none at weekends. Set yours below so the forecast is yours.',
    });
  f.days.forEach((day, di) => {
    if (day.load <= day.cap) return;
    const over = day.load - day.cap,
      names = day.items.map(x => `${x.text} ${hm(x.take)}`).join(', ');
    const rec = {
      k: 'over',
      text: `${dayLabel(day.d)} is over by ${hm(over)}: ${hm(day.load)} planned against ${hm(day.cap)} (${names}).`,
    };
    // Everything placed by then is due by then (that's the order), so something has to slip: the
    // smallest quest that didn't fit, to the first later day with room for all of it. Said
    // plainly that it's past its due date; the move is a button, not done here.
    const slip = day.items.filter(x => x.over && !x.fixed && !x.later).sort((a, b) => a.min - b.min)[0];
    if (slip) {
      const to = f.days.find((x, j) => j > di && x.cap - x.load >= slip.min);
      if (to) {
        rec.move = { id: slip.id, text: slip.text, d: to.d };
        rec.text += ` Moving ${slip.text} to ${dayLabel(to.d)} would fit (${hm(to.cap - to.load)} free that day), ${slip.late ? 'though it is already overdue' : 'after its due date'}.`;
      } else rec.text += ` No later day in view has room for ${slip.text}.`;
    } else rec.text += " What doesn't fit repeats that day or was already scheduled.";
    out.push(rec);
  });
  f.items
    .filter(x => x.over && !f.days.some(d => d.over && d.items.some(y => y.id === x.id && y.over)))
    .forEach(x => out.push({ k: 'over', text: `${x.text} doesn't fit before it's due.` }));
  if (f.none.length)
    out.push({
      k: 'none',
      text: `${plural(f.none.length, 'quest')} without an estimate ${f.none.length === 1 ? 'is' : 'are'} left out of the plan.`,
      ids: f.none.slice(0, 6).map(q => [q.id, q.text]),
    });
  if (!out.length)
    out.push({
      k: 'ok',
      text: `Everything planned fits: ${hm(f.load)} of ${hm(f.cap)} over ${plural(f.days.length, 'day')}.`,
    });
  return out;
}
// How estimates have compared with the focus time on finished quests (last 30 days).
function estimateAccuracy(days = 30) {
  const cut = shift(today(), -days),
    rows = S.log.filter(l => l.d >= cut && l.est > 0 && Number.isFinite(l.m));
  if (!rows.length) return { n: 0 };
  const ratios = rows.map(l => l.m / l.est).sort((a, b) => a - b),
    median = ratios[Math.floor(ratios.length / 2)],
    within = rows.filter(l => Math.abs(l.m - l.est) <= l.est * 0.25).length,
    est = rows.reduce((a, l) => a + l.est, 0),
    m = rows.reduce((a, l) => a + l.m, 0);
  return { n: rows.length, median, within, est, m };
}
function accuracyText(a) {
  if (!a.n)
    return 'No finished quests with an estimate yet: finish a few with an estimate set and the comparison appears here.';
  const word =
    a.median > 1.25
      ? 'Estimates tend to run low.'
      : a.median < 0.75
        ? 'Estimates tend to run high.'
        : 'Estimates are about right.';
  return `Over the last 30 days, ${plural(a.n, 'finished quest')} with an estimate took ${hm(a.m)} of focus time against ${hm(a.est)} estimated; the typical quest took ${a.median.toFixed(1)}× its estimate, and ${a.within} of ${a.n} came within a quarter of it. ${word} (Focus time is what the timer measured; work done without the timer isn't counted.)`;
}
/* the Review tab's Forecast page */
function renderForecast() {
  const f = allocate(forecastSpan),
    recs = recommendations(f),
    pct = f.cap ? Math.round((f.load / f.cap) * 100) : 0;
  let h = `<div class="chips">${FORECAST_SPANS.map(s => `<button class="chip" data-fspan="${s}" aria-pressed="${s === forecastSpan}">${s} days</button>`).join('')}</div>
    <h2>Workload radar</h2><p class="hint">${hm(f.load)} planned of ${hm(f.cap)} capacity (${pct}%)${f.assumed ? ' · capacity assumed' : ''}${f.none.length ? ` · ${plural(f.none.length, 'quest')} unestimated` : ''}</p>
    <div class="radar${forecastSpan > 14 ? ' tight' : ''}" role="img" aria-label="Planned time against capacity, each day">${f.days
      .map(day => {
        const r = day.cap ? day.load / day.cap : day.load ? 2 : 0,
          cls = !day.load ? 'none' : r > 1 ? 'over' : r > 0.8 ? 'tight' : 'ok',
          hgt = Math.min(100, Math.round(r * 60));
        return `<button class="rday ${cls}" data-fday="${day.d}" title="${esc(dayLabel(day.d))}: ${hm(day.load)} of ${hm(day.cap)}"><span class="rbar" style="height:${hgt}%"></span><small>${forecastSpan > 14 ? (new Date(day.d + 'T12:00').getDay() === 1 ? 'M' : '') : WD[new Date(day.d + 'T12:00').getDay()].slice(0, forecastSpan > 7 ? 1 : 3)}</small></button>`;
      })
      .join('')}</div>`;
  h += `<h2>What to do about it</h2><ul class="recs">${recs
    .map(
      r =>
        `<li class="rec ${r.k}"><p>${esc(r.text)}</p>${r.move ? `<button class="btn sm blue" data-fmove="${r.move.id}" data-fdate="${r.move.d}">Move ${esc(r.move.text)} to ${esc(dayLabel(r.move.d))}</button>` : ''}${
          r.ids
            ? `<div class="chips">${r.ids.map(([id, t]) => `<button class="chip" data-open="${id}">${esc(t)}</button>`).join('')}</div>`
            : ''
        }</li>`,
    )
    .join('')}</ul>`;
  const open = f.days.find(d => d.d === forecastDay);
  if (open)
    h += `<div class="box fday"><h3>${esc(dayLabel(open.d))} · ${hm(open.load)} of ${hm(open.cap)}</h3>${
      open.items.length
        ? `<ul class="flist">${open.items.map(x => `<li><small>${hm(x.take)}${x.over ? ' over' : ''}</small><span>${x.fixed ? esc(x.text) + ' <small>(repeats)</small>' : `<button class="linkbtn" data-open="${x.id}">${esc(x.text)}</button>`}${x.due ? ` <small>due ${esc(dayLabel(x.due))}</small>` : ''}</span></li>`).join('')}</ul>`
        : '<p class="hint">Nothing planned.</p>'
    }</div>`;
  h += `<details id="capd"${panels.capd ? ' open' : ''}><summary>Capacity per weekday${f.assumed ? ' <small>(assumed)</small>' : ''}</summary><p class="hint">Minutes of quest time you can plan each day.</p><div class="capgrid">${WEEK.map(
    wd =>
      `<label><span>${WD[wd]}</span><input class="fld" type="number" min="0" max="960" step="15" value="${capacity()[wd]}" data-cap="${wd}" aria-label="Capacity ${WD[wd]}, minutes"></label>`,
  ).join('')}</div></details>`;
  h += `<details id="accd"${panels.accd ? ' open' : ''}><summary>Estimates against focus time</summary><p class="hint">${esc(accuracyText(estimateAccuracy()))}</p></details>`;
  h += `<details id="howd"${panels.howd ? ' open' : ''}><summary>How the forecast is worked out</summary><p class="hint">Each day has its capacity. Quests are taken in order of due date (undated last), today's top 3 first, then list order, and each takes the first days with room between its start and its due date, split across days when it's bigger than a day's room. A quest that can't fit by its due date is placed on that day anyway and shown as an overrun. Repeating quests count on their days with the template's estimate and don't move. A quest's estimate is its steps' estimates when any step has one, else its own; what's left is the estimate less focus time on it. Quests without an estimate are counted but not planned. Nothing is moved for you: each move is a button.</p></details>`;
  return h;
}
let forecastDay = '';
function forecastClick(d, b) {
  if (d.fspan) {
    forecastSpan = +d.fspan;
    forecastDay = '';
    renderReview();
  }
  if (d.fday) {
    forecastDay = forecastDay === d.fday ? '' : d.fday;
    renderReview();
  }
  if (d.fmove) {
    const r = find(d.fmove);
    if (!r || r.parents.length) return toast("That quest isn't on Today any more", false, 3000);
    const date = d.fdate;
    sheet(
      {
        title: `Move “${r.n.text}” to ${dayLabel(date)}?`,
        text: 'It goes to Upcoming and comes back to Today that day.',
        ok: 'Move',
      },
      () => {
        schedule('q', d.fmove, date);
        toast('Moved to ' + dayLabel(date));
      },
    );
  }
  if (d.estpick) {
    const r = find(d.estpick) || find(d.estpick, S.later);
    if (!r) return;
    const n = r.n;
    if (stepsEstimated(n)) return toast('Its steps carry the estimate: set theirs', false, 3000);
    sheet(
      {
        title: 'Estimate, in minutes',
        label: 'Minutes',
        value: n.est ? String(n.est) : '',
        ok: 'Set',
        maxlength: 4,
        extra: [
          ['15', '15m'],
          ['30', '30m'],
          ['60', '1h'],
          ['120', '2h'],
          ['240', '4h'],
          ...(n.est ? [['0', 'Clear']] : []),
        ],
      },
      v => {
        const raw = typeof v === 'object' ? v.pick : v,
          e = Math.round(+raw);
        if (!raw.trim() && raw !== '0') return;
        if (e > 0 && e <= EST_MAX) n.est = e;
        else if (e === 0) delete n.est;
        else return toast('Minutes, 1 to 1440', false, 3000);
        save();
        renderAll();
      },
    );
  }
}
function capChange(el) {
  const wd = +el.dataset.cap,
    v = Math.round(+el.value);
  if (!(wd >= 0 && wd <= 6) || !Number.isFinite(v)) return;
  S.cap = [...capacity()];
  S.cap[wd] = Math.max(0, Math.min(960, v));
  save();
  renderReview();
}
