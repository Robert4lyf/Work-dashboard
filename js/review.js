/* the Review tab: the weekly review, plus History as a sub-page */
let reviewSub = 'week', // 'week' or 'log'
  reviewStep = 0; // which step of the weekly review is showing
// Friday to Sunday, if this week (Monday on) hasn't been reviewed yet.
const reviewDue = () => [5, 6, 0].includes(new Date().getDay()) && (!S.reviewed || S.reviewed < weekStart());
function renderReview() {
  const tab = (k, l) =>
    `<button class="chip" data-rsub="${k}" aria-pressed="${reviewSub === k}">${l}</button>`;
  let h = `<div class="chips rtabs">${tab('week', 'Week')}${tab('log', 'History')}</div>`;
  if (reviewSub === 'week') h += renderWeek();
  setHTML($('#v-review'), h);
}
// This calendar week, Monday to Sunday: its first day.
function weekStart() {
  const [y, m, d] = today().split('-').map(Number);
  return shift(today(), -((new Date(y, m - 1, d).getDay() + 6) % 7));
}
function weekFocus() {
  const since = weekStart();
  let focus = 0;
  for (const d in S.daily) if (d >= since) for (const t in S.daily[d]) focus += S.daily[d][t];
  return focus;
}
function weekDone() {
  const since = weekStart();
  return S.log.filter(x => x.d >= since);
}
// The weekly review, one step at a time: each says "all clear" when there's nothing to do.
function renderWeek() {
  const [y, m, d] = weekStart().split('-').map(Number),
    done = weekDone(),
    focus = weekFocus(),
    ints = S.interrupts.filter(x => x.t >= new Date(y, m - 1, d).getTime()).length;
  const steps = [];
  const step = (title, body, n) =>
    steps.push({ title, body: body || '<p class="hint wclear">All clear.</p>', n });
  // 1. Empty the Inbox.
  step(
    'Inbox',
    S.inbox.length
      ? `<p>${S.inbox.length} item${S.inbox.length === 1 ? '' : 's'} to sort.</p><button class="btn sm" data-goto="inbox">Sort the Inbox</button>`
      : '',
    S.inbox.length,
  );
  // 2. Decide on anything that's been sitting on Today.
  const stale = S.quests.filter(q => !isDone(q) && !q.wait && !onlyWaiting(q) && ageOf(q) >= STALE);
  step('Carried over', stale.length ? carriedRows(stale) : '', stale.length);
  // 3. Chase what you're waiting on.
  const wait = waitingNodes();
  step(
    'Waiting',
    wait
      .map(
        ({ n, trail }) =>
          `<div class="crow"><p>${esc([...trail, n.text].join(' / '))}${n.wait.who ? ` <small>from ${esc(n.wait.who)}</small>` : ''} ${chaseTag(n.wait)}</p><div class="chips"><button class="chip" data-waitclear="${n.id}">Got it</button></div></div>`,
      )
      .join(''),
    wait.length,
  );
  // 4. What's coming back next week.
  const soon = S.later.filter(n => n.start <= shift(today(), 7));
  step(
    'Coming up',
    soon
      .map(n => `<div class="crow"><p>${esc(n.text)} <small>${dayLabel(n.start)}</small></p></div>`)
      .join(''),
    soon.length,
  );
  // 5. What got done, ready to paste into an update.
  step(
    'Done this week',
    done.length
      ? `<ul class="wdone">${done.map(x => `<li>${esc([...x.trail, x.text].join(' / '))}</li>`).join('')}</ul><button class="btn sm" id="copyweek">Copy summary</button>`
      : '',
    done.length,
  );
  reviewStep = Math.max(0, Math.min(reviewStep, steps.length - 1));
  const cur = steps[reviewStep],
    last = reviewStep === steps.length - 1;
  let h = `<p class="hint wsum">This week (from ${dayLabel(weekStart())}): <b>${done.length}</b> done · <b>${hm(focus)}</b> focus · <b>${ints}</b> interruption${ints === 1 ? '' : 's'}${S.reviewed ? ` · last reviewed ${dayLabel(S.reviewed)}` : ''}</p>`;
  h += `<div class="wdots" aria-hidden="true">${steps.map((s, i) => `<span class="${i === reviewStep ? 'on' : ''}${s.n ? ' has' : ''}"></span>`).join('')}</div>`;
  h += `<p class="hint wstepno">Step ${reviewStep + 1} of ${steps.length}</p>`;
  h += `<div class="wstep box"><h2>${cur.title}${cur.n ? ` <small>${cur.n}</small>` : ''}</h2>${cur.body}</div>`;
  h += `<div class="acts wnav">${reviewStep ? '<button class="btn" data-rstep="-1">Back</button>' : ''}${
    last
      ? '<button class="btn green" id="reviewed">Mark week reviewed</button>'
      : `<button class="btn blue" data-rstep="1">${cur.n ? 'Next' : 'Next'}</button>`
  }</div>`;
  return h;
}
// A plain-text summary of the week, grouped by quest (steps under their quest's title).
function weekText() {
  const by = {},
    head = x => (x.trail.length ? x.trail[0] : 'Other');
  weekDone().forEach(x => (by[head(x)] = by[head(x)] || []).push(x));
  return (
    `Week of ${niceDate(weekStart())}: ${weekDone().length} done, ${hm(weekFocus())} focus\n\n` +
    Object.keys(by)
      .sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b))
      .map(k => k + '\n' + by[k].map(x => '- ' + [...x.trail.slice(1), x.text].join(' / ')).join('\n'))
      .join('\n\n')
  );
}
