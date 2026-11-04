/* quick actions: one pattern for the things you do with a task, offered from Today's rows (the
   ⋯ on each), a task's page and the top 3. A sheet at the bottom of the screen lists only the
   actions that fit the task as it is now; each acts through the usual click handler. */
function actionSheet(title, items, hint) {
  popSheet(
    `<h2 id="sheettitle">${esc(title)}</h2>${hint ? `<p class="hint qahint">${esc(hint)}</p>` : ''}<div class="qalist">${items
      .map(
        i =>
          `<button class="qact${i.cls ? ' ' + i.cls : ''}" type="button" ${i.attrs}>${esc(i.label)}${i.hint ? `<small>${esc(i.hint)}</small>` : ''}</button>`,
      )
      .join(
        '',
      )}</div><div class="acts"><button class="btn" type="button" data-sheetclose="1">Cancel</button></div>`,
    { labelledBy: 'sheettitle' },
  );
}
// The task or step the next focus session on `n` would be on: its next step, or itself.
// (only what can be acted on now: not a scheduled task, nor a step waiting on someone)
const focusLeaf = n => {
  const r = find(n.id),
    q = r && r.parents[0];
  return q && q.scheduled ? null : actionLeaf(n);
};
// What can be done with a task (or a step) right now. `fromList`: opened from Today's list,
// where opening the task is an action too.
function questActions(id, fromList) {
  const r = find(id);
  if (!r) return [];
  const n = r.n,
    top = !r.parents.length,
    q = r.parents[0] || n, // (a saved place and the top 3 are the task's, step or not)
    d = isDone(n),
    a = [],
    act = (label, attrs, cls, hint) => a.push({ label, attrs, cls, hint });
  if (fromList) act('Open', `data-open="${id}"`);
  // A scheduled task: its own actions (no Focus: it happens at its time).
  if (top && !d && n.scheduled) {
    if (!n.children.length) act('Mark done', `data-toggle="${id}"`, 'go', 'It happened: record it');
    act('Reschedule', `data-schedset="${id}"`, '', schedWhen(n));
    act('Not scheduled: back to ordinary work', `data-schedclear="${id}"`);
    act('Delete', `data-delnow="${id}"`, 'del', 'With Undo');
    return a;
  }
  if (!d && q.scheduled) {
    if (!n.children.length) act('Mark done', `data-toggle="${id}"`);
    act('Delete', `data-delnow="${id}"`, 'del', 'With Undo');
    return a;
  }
  if (!d) {
    if (S.timer && topOf(S.timer.q) === q) act('Resume focus', 'data-pause="1"', 'go');
    else if (q.resume && placeFits(q, n))
      act('Resume work', `data-resume="${q.id}"`, 'go', placeLine(q.resume));
    else {
      const t = focusLeaf(n);
      if (t) act(t === n ? 'Focus on this' : 'Focus: ' + t.text, `data-zen="1" data-q="${t.id}"`, 'go');
    }
  }
  if (top && !d && S.quests.includes(n))
    act(inTop3(id) ? 'Remove from Top 3' : 'Add to Top 3', `data-top3="${id}"`);
  if (!d) act(q.resume ? 'Update saved place' : 'Save my place', `data-saveplace="${id}"`);
  if (q.resume && !isDone(q)) act('Clear saved place', `data-clearplace="${q.id}"`);
  if (!n.children.length) act(d ? 'Mark not done' : 'Mark done', `data-toggle="${id}"`);
  else if (top && needsNext(n)) act('Finish task', `data-finish="${id}"`);
  else if (top && d) act('Reopen task', `data-reopen="${id}"`);
  if (top && !d && S.quests.includes(n))
    act('Schedule', `data-schedset="${id}"`, '', 'A meeting or appointment: a day, maybe a time');
  if (top && !d && S.quests.includes(n)) {
    act('Do tomorrow', `data-sched="${id}" data-kind="q" data-when="${shift(today(), 1)}"`);
    act('Do next week', `data-sched="${id}" data-kind="q" data-when="${nextMonday()}"`);
    act('Move to Inbox', `data-toinbox="${id}"`);
  }
  act('Delete', `data-delnow="${id}"`, 'del', 'With Undo');
  return a;
}
function openQuestActions(id, fromList) {
  const r = find(id);
  if (!r) return;
  actionSheet(r.n.text, questActions(id, fromList));
}
// The one thing to do next with a task, for the button always to hand on its page (and the
// top 3): { label, attrs, cls }. The rest is a tap away, in its actions.
function primaryAction(n, parents = []) {
  const top = !parents.length,
    q = parents[0] || n,
    d = isDone(n);
  if (d)
    return n.children.length
      ? { label: 'Reopen task', attrs: `data-reopen="${n.id}"`, cls: '' }
      : { label: 'Mark not done', attrs: `data-toggle="${n.id}"`, cls: '' };
  if (S.timer && topOf(S.timer.q) === q)
    return S.timer.left != null
      ? { label: 'Resume focus', attrs: 'data-pause="1"', cls: 'blue' }
      : { label: 'Back to focus', attrs: 'data-zen="1"', cls: 'blue' };
  // (a scheduled task is marked done, or rescheduled; it isn't worked on in a focus session)
  if (q.scheduled)
    return !n.children.length
      ? { label: 'Mark done', attrs: `data-toggle="${n.id}"`, cls: 'green' }
      : top
        ? { label: 'Reschedule', attrs: `data-schedset="${n.id}"`, cls: 'blue' }
        : null;
  if (q.resume && placeFits(q, n))
    return { label: 'Resume work', attrs: `data-resume="${q.id}"`, cls: 'green' };
  if (top && needsNext(n)) return { label: 'Finish task', attrs: `data-finish="${n.id}"`, cls: 'green' };
  // (only waiting: what's waited on first, a follow-up if one is due, else the reply)
  if (top && onlyWaiting(n)) {
    const w = waitingSteps(n).sort((a, b) => (a.wait.due || '9').localeCompare(b.wait.due || '9'))[0];
    return waitBucket(w.wait) === 'chase'
      ? { label: 'Follow up: ' + w.text, attrs: `data-chase="${w.id}"`, cls: 'blue' }
      : { label: 'Reply received: ' + w.text, attrs: `data-waitclear="${w.id}"`, cls: 'blue' };
  }
  const t = focusLeaf(n);
  if (!t) return null;
  return {
    label: t === n ? 'Focus on this' : 'Focus: ' + t.text,
    attrs: `data-zen="1" data-q="${t.id}"`,
    cls: 'blue',
  };
}
const actionBtn = (p, extra = '') =>
  p ? `<button class="btn ${p.cls}${extra ? ' ' + extra : ''}" ${p.attrs}>${esc(p.label)}</button>` : '';
