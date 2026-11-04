/* Release E: scheduled work, and what can be acted on now.
   A task can be scheduled: something that happens on a day, maybe at a time (a meeting, an
   appointment, a training session). n.scheduled = { date: 'YYYY-MM-DD', time: 'HH:MM' (optional) },
   local calendar values, never converted to UTC. It isn't a deadline (n.due) or a "do later"
   (n.start, on Upcoming): a task scheduled for a later day does sit on Upcoming until that day
   (start = the date), and comes back to Today keeping its schedule. Nothing completes it but you.
   Only tasks are scheduled, not their steps.

   Actionable: something can be done on it now. Not finished, not scheduled, and with a step
   that isn't waiting on someone (or, with no steps, not waiting itself). Every "what next" in the
   app (the header, Top 3, Focus, single-task mode, Continue) asks the same question here. */
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
// In the order they happen: earlier days first (the ones to review), then by time, a day's
// untimed ones after its timed ones.
const schedOrder = (a, b) =>
  a.scheduled.date < b.scheduled.date
    ? -1
    : a.scheduled.date > b.scheduled.date
      ? 1
      : (a.scheduled.time || '99') < (b.scheduled.time || '99')
        ? -1
        : (a.scheduled.time || '99') > (b.scheduled.time || '99')
          ? 1
          : 0;
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
    path = [];
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

/* Today: the Scheduled section (what's happening at a set time) */
function renderScheduledToday() {
  const ns = S.quests.filter(isScheduled).sort(schedOrder);
  if (!ns.length) return '';
  const rows = ns
    .map(n => {
      const st = schedStatus(n),
        done = !n.children.length
          ? `<button class="btn sm" data-toggle="${n.id}" aria-label="Mark done: ${esc(n.text)}">Done</button>`
          : '';
      return `<div class="secrow schedrow sch-${st.k}" data-qid="${n.id}"><span class="stime">${n.scheduled.date === today() ? esc(n.scheduled.time || 'Any time') : `<small>${esc(niceDate(n.scheduled.date))}</small>${esc(n.scheduled.time || '')}`}</span><button class="open" data-open="${n.id}"><span>${esc(n.text)}</span><small>${esc(st.label)}${n.due ? ' · ' + dueTag(n) : ''}</small></button>${done}${moreBtn(n)}</div>`;
    })
    .join('');
  return `<section class="todaysec schedsec" aria-labelledby="schedhead"><div class="sechead"><h2 id="schedhead">Scheduled <small>${ns.length}</small></h2></div><div class="slist box">${rows}</div></section>`;
}

/* Today: the Waiting section (what Today's tasks are waiting on) */
// Today's waiting steps, most urgent first, each with its task. A task with nothing else left to
// do is shown only here; one with other steps to do stays in Today's tasks as well.
function todayWaiting() {
  // (each waiting step's task from one walk of Today, not a search per step; each one's urgency
  // worked out once, not on every comparison: Release G, measured at 70ms on a heavy day)
  const top = new Map(),
    walk = (n, q) => {
      top.set(n.id, q);
      n.children.forEach(c => walk(c, q));
    };
  S.quests.forEach(q => walk(q, q));
  const rank = new Map(BUCKETS.map(([k], i) => [k, i]));
  return openWaiting(S.quests)
    .map(x => ({ ...x, q: top.get(x.n.id) || null, o: rank.get(waitBucket(x.n.wait)) ?? -1 }))
    .sort((a, b) => a.o - b.o || (a.n.wait.due || '9').localeCompare(b.n.wait.due || '9'));
}
function renderWaitingToday() {
  const ws = todayWaiting();
  if (!ws.length) return '';
  const all = waitingNodes().length,
    rows = ws
      .map(({ n, q }) => {
        const w = n.wait,
          chase = waitBucket(w) === 'chase',
          only = q && taskState(q) === 'waiting',
          meta = [
            w.who ? 'on ' + esc(w.who) : '',
            q && q !== n ? `${esc(q.text)}` : '',
            w.expect && w.expect >= today() ? 'reply by ' + esc(dayLabel(w.expect)) : '',
          ]
            .filter(Boolean)
            .join(' · ');
        // One action: a follow-up when one is due, else the reply; the rest under ⋯.
        const act = chase
          ? `<button class="btn sm blue" data-chase="${n.id}">Follow up</button>`
          : `<button class="btn sm" data-waitclear="${n.id}">Reply received</button>`;
        return `<div class="secrow wrow" data-wid="${n.id}"><button class="open" data-open="${(q || n).id}"><span>${esc(n.text)}</span><small>${meta}${meta ? ' ' : ''}${chaseTag(w) || (w.due ? '' : '<span class="tag">No chase date</span>')}</small></button>${act}<button class="qmore" data-wact="${n.id}" aria-label="Actions: ${esc(n.text)}" aria-haspopup="dialog">${dots}</button></div>`;
      })
      .join('');
  return `<section class="todaysec waitsec2" aria-labelledby="waithead"><div class="sechead"><h2 id="waithead">Waiting <small>${ws.length}</small></h2><button class="linkbtn" data-goto="waiting">View all${all > ws.length ? ' ' + all : ''}</button></div><div class="slist box">${rows}</div></section>`;
}
