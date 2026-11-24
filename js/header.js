/* header */
// The first unfinished step of the first unfinished task, in list order. Tasks with a waiting
// step come last, as they're listed on Today.
function nextStep() {
  const free = [],
    blocked = [];
  S.quests.forEach(q => !isDone(q) && !q.wait && (showsWaiting(q) ? blocked : free).push(q));
  for (const q of [...free, ...blocked]) {
    const n = actionLeaf(q); // (not a scheduled one, nor one only waiting: see schedule.js)
    if (n) return { n, q };
  }
  return null;
}
// What to work on next in Focus and single-task mode: a place saved today or
// yesterday (the newest), else the first step in list order. Nothing is reordered, chosen or
// started by it. `why` says which: 'place' or 'list'.
function recommend() {
  const since = shift(today(), -1),
    placed = S.quests
      .filter(q => q.resume && !isDone(q) && fmt(new Date(q.resume.at)) >= since)
      .sort((a, b) => b.resume.at - a.resume.at)[0];
  if (placed && !placed.scheduled) {
    const st = placeStep(placed),
      n = st && !isDone(st) && !st.wait ? st : actionLeaf(placed);
    if (n) return { n, q: placed, why: 'place' };
  }
  const nx = nextStep();
  return nx ? { ...nx, why: 'list' } : null;
}
const pageTitles = {
  projects: 'Projects',
  inbox: 'Inbox',
  knowledge: 'Knowledge',
  review: 'Review',
  account: 'Settings',
  search: 'Search',
  focus: 'Focus',
  waiting: 'Waiting',
  notes: 'Scratchpad',
  ops: 'Command Centre',
};
const projectUtilityTitles = { upcoming: 'Upcoming' };
function renderHeader() {
  const title =
    (view === 'today' && !path.length ? projectUtilityTitles[projectUtility] : pageTitles[view]) || '';
  const heading = $('#page-title');
  heading.hidden = !title;
  if (heading.textContent !== title) heading.textContent = title;
  heading.parentElement.classList.toggle('page-header', !!title);
  const t = view !== 'focus' && S.timer;
  const paused = t && t.left != null;
  setIfChanged(
    $('#headerTimer'),
    t
      ? `<button class="timer-link" data-v="focus"><span id="hclock">${mmss(remaining())}</span><small>${paused ? 'Paused · ' : ''}${esc(timerLabel(t))}</small></button><button class="btn sm" data-pause="1">${paused ? 'Resume' : 'Pause'}</button>`
      : '',
  );
  const b = $('#inboxBadge');
  b.hidden = !S.inbox.length;
  b.textContent = S.inbox.length;
  $('#waitBadge').hidden = true; // (the chase count is Today's chip now)
  $('#reviewDot').hidden = !reviewDue();
  renderSyncBadge();
}
const shown = new WeakMap();
function setIfChanged(el, html) {
  if (shown.get(el) === html) return;
  shown.set(el, html);
  // The keyboard stays on the same control (say the tick, after ticking) if it's still there.
  const a = document.activeElement,
    sel = a && el.contains(a) ? focusSel(a) : '';
  el.innerHTML = html;
  const f = sel && el.querySelector(sel);
  if (f) f.focus({ preventScroll: true });
  // (after the user's own action only: a sync's redraw mustn't move the keyboard to another tick)
  else if (sel && !background) (el.querySelector('button') || el).focus({ preventScroll: true });
}
