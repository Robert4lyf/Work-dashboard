/* Release E: scheduled work, and what can be acted on now.
   A task can be scheduled: something that happens on a day, maybe at a time (a meeting, an
   appointment, a training session). n.scheduled = { date: 'YYYY-MM-DD', time: 'HH:MM' (optional) },
   local calendar values, never converted to UTC. It isn't a deadline (n.due) or a "do later"
   (n.start, on Upcoming): a task scheduled for a later day does sit on Upcoming until that day
   (start = the date), and comes back to Today keeping its schedule. Nothing completes it but you.
   Only tasks are scheduled, not their steps.

   Actionable: something can be done on it now. Not finished, not scheduled, and with a step
   that isn't waiting on someone (or, with no steps, not waiting itself). Every "what next" in the
   app (the header, Focus, single-task mode, Continue) asks the same question here. */
const SCHED_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// Only a real day and, if given, a real time: else no schedule (a crafted or broken record).
function cleanSched(s) {
  if (!s || typeof s !== 'object') return null;
  const date = cleanDay(s.date);
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number),
    real = new Date(y, m - 1, d);
  if (real.getFullYear() !== y || real.getMonth() !== m - 1 || real.getDate() !== d) return null;
  return typeof s.time === 'string' && SCHED_TIME.test(s.time) ? { date, time: s.time } : { date };
}
const isScheduled = n => !!(n && n.scheduled) && !isDone(n);
// The step (or the task itself, with none) that can be worked on now, or null.
function actionLeaf(n) {
  if (!n || isDone(n) || n.scheduled || n.wait) return null;
  return n.children.length ? nextLeaf(n) : n;
}
// Where a task stands: 'done'; 'scheduled'; 'waiting' (nothing to do until someone replies);
// 'ask' (every step ticked: what's next is yours to decide, so it's still yours to act on);
// 'actionable'.
function taskState(q) {
  if (isDone(q)) return 'done';
  if (q.scheduled) return 'scheduled';
  if (actionLeaf(q)) return 'actionable';
  if (needsNext(q)) return 'ask';
  if (q.wait || waitingSteps(q).length) return 'waiting';
  return 'actionable';
}
const canAct = q => ['actionable', 'ask'].includes(taskState(q));
// "now" as a local HH:MM, for comparing with a scheduled time.
const nowHM = () => {
  const d = new Date();
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
};
// Where a scheduled task stands, in words: { k, label } with k one of later (a later day),
// soon (today, its time still to come), passed (today, its time gone), today (today, no time),
// past (an earlier day, still not recorded).
function schedStatus(n) {
  const s = n.scheduled,
    t = today();
  if (!s) return null;
  if (s.date > t) return { k: 'later', label: dayLabel(s.date) + (s.time ? ', ' + s.time : '') };
  if (s.date < t) return { k: 'past', label: `${dayLabel(s.date)}: not marked done` };
  if (!s.time) return { k: 'today', label: 'Today' };
  return s.time > nowHM() ? { k: 'soon', label: 'Later today' } : { k: 'passed', label: 'Time passed' };
}
// The time (or day) column of a scheduled row.
const schedWhen = n =>
  n.scheduled.date === today()
    ? n.scheduled.time || 'Any time'
    : niceDate(n.scheduled.date) + (n.scheduled.time ? ' ' + n.scheduled.time : '');
const schedTag = n =>
  isScheduled(n)
    ? `<span class="tag sched">Scheduled ${esc(n.scheduled.date === today() ? n.scheduled.time || 'today' : schedWhen(n))}</span>`
    : '';

/* the Schedule sheet: a date, maybe a time; or the schedule removed */
function openScheduleSheet(id) {
  const r = find(id) || find(id, S.later);
  if (!r || r.parents.length) return;
  const n = r.n,
    s = n.scheduled || {};
  popSheet(
    `<form id="schedform" data-id="${n.id}"><h2 id="sheettitle">Schedule</h2><p class="hint qahint">${esc(n.text)}</p>
    <div class="schedflds"><div><label class="f" for="scheddate">Date</label><input class="fld" type="date" id="scheddate" required min="${today()}" value="${esc(s.date && s.date >= today() ? s.date : today())}"></div>
    <div><label class="f" for="schedtime">Time <small class="hint">(optional)</small></label><input class="fld" type="time" id="schedtime" value="${esc(s.time || '')}"></div></div>
    <div class="acts"><button class="btn green" id="sheetok">${n.scheduled ? 'Save' : 'Schedule'}</button><button class="btn" type="button" data-sheetclose="1">Cancel</button></div>${
      n.scheduled
        ? `<div class="links"><button class="linkbtn" type="button" data-schedclear="${n.id}">Unschedule</button></div>`
        : ''
    }</form>`,
    { labelledBy: 'sheettitle' },
  );
  $('#scheddate').focus();
}
document.addEventListener('submit', e => {
  if (e.target.id !== 'schedform' || !window.appReady) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const id = e.target.dataset.id,
    date = $('#scheddate').value,
    time = $('#schedtime').value;
  if (!cleanSched({ date }) || date < today()) return toast('Choose today or a later day', false, 3000);
  closeSheet();
  setSchedule(id, date, time);
});
// Schedule (or reschedule) a task: on Today for today, on Upcoming for a later day (back on Today
// that morning, schedule and all). Its place in the list, its steps and the rest are kept.
function setSchedule(id, date, time) {
  const onToday = find(id),
    later = !onToday && find(id, S.later),
    r = onToday || later;
  if (!r || r.parents.length) return toast('That task has gone', false, 3000);
  const n = r.n;
  if (isDone(n)) return toast('That task is finished', false, 3000);
  // (a focus session on it is yours to end first: its time is kept that way, not guessed at)
  if (S.timer && topOf(S.timer.q) === n)
    return toast('Pause or finish the focus session on it first', false, 3500);
  const sc = cleanSched({ date, time });
  if (!sc) return;
  // (Release G: with Undo)
  withUndo(`Scheduled ${dayLabel(date)}${sc.time ? ', ' + sc.time : ''}`, () =>
    applySchedule(n, r, onToday, later, sc, date),
  );
}
function applySchedule(n, r, onToday, later, sc, date) {
  n.scheduled = sc;
  if (onToday && date > today()) {
    r.arr.splice(r.arr.indexOf(n), 1);
    n.start = date;
    delete n.since;
    delete n.kept;
    S.later.push(n);
    if (path[0] === n.id) path = []; // (not another project's page, open beside the board)
  } else if (later && date === today()) {
    S.later.splice(S.later.indexOf(n), 1);
    delete n.start;
    S.quests.push(n);
  } else if (later) n.start = date;
  S.later.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  save();
  renderAll();
}
function clearSchedule(id) {
  const r = find(id) || find(id, S.later);
  if (!r || !r.n.scheduled) return;
  withUndo('Unscheduled', () => {
    delete r.n.scheduled;
    save();
    renderAll();
  });
}
function schedClick(d) {
  if (d.schedset) return openScheduleSheet(d.schedset);
  if (d.schedclear) {
    closeSheet();
    return clearSchedule(d.schedclear);
  }
}
