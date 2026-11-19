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
// yesterday (the newest), else the first Top 3 task with a step to do, else the first step in
// list order. Nothing is reordered, chosen or started by it. `why` says which: 'place', 'top3'
// (with its rank) or 'list'.
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
  // (ranked as the Top 3 card shows them: top3Ids leaves out the set-aside ones)
  const ids = top3Ids();
  let rank = 0;
  for (let i = 0; i < ids.length; i++) {
    const q = S.quests.find(x => x.id === ids[i]);
    if (!q) continue;
    rank++;
    const n = actionLeaf(q);
    if (n) return { n, q, why: 'top3', rank };
  }
  const nx = nextStep();
  return nx ? { ...nx, why: 'list' } : null;
}
function renderHeader() {
  document.querySelector('header').classList.toggle('project-header', view === 'projects');
  $('#project-title').hidden = view !== 'projects';
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
