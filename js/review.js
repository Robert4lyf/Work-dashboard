/* the Review tab: the weekly review, plus Projects and History as sub-pages */
let reviewSub = 'week'; // 'week', 'projects' or 'log'
// Friday to Sunday, if the week hasn't been reviewed yet (a review counts for 5 days).
const reviewDue = () =>
  [5, 6, 0].includes(new Date().getDay()) && (!S.reviewed || daysBetween(S.reviewed, today()) >= 5);
function renderReview() {
  const tab = (k, l) =>
    `<button class="chip" data-rsub="${k}" aria-pressed="${reviewSub === k}">${l}</button>`;
  let h = `<div class="chips rtabs">${tab('week', 'Week')}${tab('projects', 'Projects')}${tab('log', 'History')}</div>`;
  if (reviewSub === 'week') h += renderWeek();
  setHTML($('#v-review'), h);
}
function weekDone() {
  const since = shift(today(), -6);
  return S.log.filter(x => x.d >= since);
}
// The weekly review: one page, top to bottom, each step saying "all clear" when there's nothing to do.
function renderWeek() {
  const since = shift(today(), -6),
    done = weekDone(),
    ints = S.interrupts.filter(x => x.t > Date.now() - 7 * 864e5).length;
  let focus = 0;
  for (const d in S.daily) if (d >= since) for (const t in S.daily[d]) focus += S.daily[d][t];
  const step = (title, body, n) =>
    `<div class="wstep box"><h2>${title}${n ? ` <small>${n}</small>` : ''}</h2>${body || '<p class="hint wclear">All clear.</p>'}</div>`;
  let h = `<p class="hint wsum">Last 7 days: <b>${done.length}</b> done · <b>${hm(focus)}</b> focus · <b>${ints}</b> interruption${ints === 1 ? '' : 's'}${S.reviewed ? ` · last reviewed ${dayLabel(S.reviewed)}` : ''}</p>`;

  // 1. Empty the Inbox.
  h += step(
    'Inbox',
    S.inbox.length
      ? `<p>${S.inbox.length} item${S.inbox.length === 1 ? '' : 's'} to sort.</p><button class="btn sm" data-goto="inbox">Sort the Inbox</button>`
      : '',
    S.inbox.length,
  );
  // 2. Decide on anything that's been sitting on Today.
  const stale = S.quests.filter(q => !isDone(q) && !q.wait && ageOf(q) >= STALE);
  h += step('Carried over', stale.length ? carriedRows(stale) : '', stale.length);
  // 3. Chase what you're waiting on.
  const wait = waitingNodes();
  h += step(
    'Waiting',
    wait
      .map(
        ({ n }) =>
          `<div class="crow"><p>${esc(n.text)}${n.wait.who ? ` <small>from ${esc(n.wait.who)}</small>` : ''} ${chaseTag(n.wait)}</p><div class="chips"><button class="chip" data-waitclear="${n.id}">Got it</button></div></div>`,
      )
      .join(''),
    wait.length,
  );
  // 4. Every active project should have something open.
  const idle = S.projects.filter(p => !p.done && !openInProject(p.id).length);
  h += step(
    'Projects with nothing open',
    idle
      .map(
        p =>
          `<div class="crow"><p>${esc(p.name)}</p><div class="chips"><button class="chip" data-rsub="projects">Add work</button><button class="chip" data-projdone="${p.id}">Finish</button></div></div>`,
      )
      .join(''),
    idle.length,
  );
  // 5. What's coming back next week.
  const soon = S.later.filter(n => n.start <= shift(today(), 7));
  h += step(
    'Coming up',
    soon
      .map(n => `<div class="crow"><p>${esc(n.text)} <small>${dayLabel(n.start)}</small></p></div>`)
      .join(''),
    soon.length,
  );
  // 6. What got done, ready to paste into an update.
  h += step(
    'Done this week',
    done.length
      ? `<ul class="wdone">${done.map(x => `<li>${esc([...x.trail, x.text].join(' / '))}</li>`).join('')}</ul><button class="btn sm" id="copyweek">Copy summary</button>`
      : '',
    done.length,
  );
  return h + '<button class="btn green" id="reviewed" style="width:100%">Mark week reviewed</button>';
}
// A plain-text summary of the week, grouped by project.
function weekText() {
  const by = {};
  weekDone().forEach(x => (by[projectName(x.p) || 'Other'] = by[projectName(x.p) || 'Other'] || []).push(x));
  const since = shift(today(), -6);
  let focus = 0;
  for (const d in S.daily) if (d >= since) for (const t in S.daily[d]) focus += S.daily[d][t];
  return (
    `Week to ${niceDate(today())}: ${weekDone().length} done, ${hm(focus)} focus\n\n` +
    Object.keys(by)
      .sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b))
      .map(k => k + '\n' + by[k].map(x => '- ' + [...x.trail, x.text].join(' / ')).join('\n'))
      .join('\n\n')
  );
}
