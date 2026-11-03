/* quick actions: one pattern for the things you do with a quest, offered from Today's rows (the
   ⋯ on each), a quest's page and the top 3. A sheet at the bottom of the screen lists only the
   actions that fit the quest as it is now; each acts through the usual click handler. */
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
// The quest or step the next focus session on `n` would be on: its next step, or itself.
const focusLeaf = n => (n.children.length ? nextLeaf(n) : n);
// What can be done with a quest (or a step) right now. `fromList`: opened from Today's list,
// where opening the quest is an action too.
function questActions(id, fromList) {
  const r = find(id);
  if (!r) return [];
  const n = r.n,
    top = !r.parents.length,
    q = r.parents[0] || n, // (a saved place and the top 3 are the quest's, step or not)
    d = isDone(n),
    a = [],
    act = (label, attrs, cls, hint) => a.push({ label, attrs, cls, hint });
  if (fromList) act('Open', `data-open="${id}"`);
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
  else if (top && needsNext(n)) act('Finish quest', `data-finish="${id}"`);
  else if (top && d) act('Reopen quest', `data-reopen="${id}"`);
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
// The one thing to do next with a quest, for the button always to hand on its page (and the
// top 3): { label, attrs, cls }. The rest is a tap away, in its actions.
function primaryAction(n, parents = []) {
  const top = !parents.length,
    q = parents[0] || n,
    d = isDone(n);
  if (d)
    return n.children.length
      ? { label: 'Reopen quest', attrs: `data-reopen="${n.id}"`, cls: '' }
      : { label: 'Mark not done', attrs: `data-toggle="${n.id}"`, cls: '' };
  if (S.timer && topOf(S.timer.q) === q)
    return S.timer.left != null
      ? { label: 'Resume focus', attrs: 'data-pause="1"', cls: 'blue' }
      : { label: 'Back to focus', attrs: 'data-zen="1"', cls: 'blue' };
  if (q.resume && placeFits(q, n))
    return { label: 'Resume work', attrs: `data-resume="${q.id}"`, cls: 'green' };
  if (top && needsNext(n)) return { label: 'Finish quest', attrs: `data-finish="${n.id}"`, cls: 'green' };
  if (top && onlyWaiting(n)) return { label: 'Review waiting', attrs: 'data-goto="waiting"', cls: 'blue' };
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
