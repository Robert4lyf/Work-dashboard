/* today's top 3: up to three of Today's tasks, chosen each day, shown at the top of Today in
   the order chosen. They point at the tasks themselves (S.top3 = { day, ids, held }: nothing is
   copied, and the list below isn't reordered). A new day starts with none; yesterday's aren't
   carried over. Synced as one small record of its own (see toRecords): the newer choice wins when
   two devices choose at once, and the tasks are untouched either way.

   Release F: a chosen task that's now scheduled, or only waiting, is set aside: still chosen,
   but it doesn't hold one of the three places, so another can be picked. Choosing (or taking
   out) moves the set-aside ones from ids to held. One that can be worked on again takes a free
   place by itself (nothing is pushed out to make room), and keeps it (see settleTop3); with none
   free, Top 3 offers to bring it back, which is yours to do. Finished ones keep their place for
   the day. (held is synced as a record of its own, so a copy of the app from before this, which
   doesn't know it, leaves it alone.) */
const t3Live = q => isDone(q) || canAct(q);
// { active: up to three, in order; aside: chosen, can't be worked on now; back: set aside, can be
// again, waiting for a free place }
function top3State() {
  const t = S.top3 && S.top3.day === today() ? S.top3 : null,
    get = id => S.quests.find(q => q.id === id),
    active = [],
    aside = [],
    back = [];
  if (!t) return { active, aside, back };
  t.ids.forEach(id => {
    const q = get(id);
    if (q) (t3Live(q) ? active : aside).push(q);
  });
  (t.held || []).forEach(id => {
    const q = get(id);
    // (one finished while set aside is simply done: it isn't brought back as a priority)
    if (!q || t.ids.includes(id) || isDone(q)) return;
    (canAct(q) ? back : aside).push(q);
  });
  while (active.length < TOP3_MAX && back.length) active.push(back.shift());
  return { active, aside, back };
}
// One that took a free place by itself keeps it: written down (with whatever was set aside moved
// to held), so a choice coming back later finds the three places taken and is offered back
// rather than pushing it out. Run as the state is saved or taken in from a sync, never while
// drawing. The same rows give the same result on every device.
function settleTop3() {
  const t = S.top3 && S.top3.day === today() ? S.top3 : null;
  if (!t) return;
  const st = top3State();
  if (!st.active.some(q => !t.ids.includes(q.id))) return;
  const held = [...st.aside, ...st.back].map(q => q.id).slice(0, TOP3_HELD);
  S.top3 = { day: t.day, ids: st.active.map(q => q.id), ...(held.length ? { held } : {}) };
}
// The chosen tasks to work on (or done today), in order: what the header, Focus and Forecast rank.
const top3Ids = () => top3State().active.map(q => q.id);
// Chosen at all, set aside or not (its actions offer to take it out).
const inTop3 = id => {
  const st = top3State();
  return [...st.active, ...st.aside, ...st.back].some(q => q.id === id);
};
// Save the three (or fewer) to work on, in order; whatever else was chosen is kept as held.
function setTop3(ids, { drop = [] } = {}) {
  const st = top3State();
  ids = ids.filter((id, i, a) => a.indexOf(id) === i && S.quests.some(q => q.id === id)).slice(0, TOP3_MAX);
  const held = [...st.aside, ...st.back, ...st.active]
    .map(q => q.id)
    .filter(id => !ids.includes(id) && !drop.includes(id) && !isDone(S.quests.find(q => q.id === id)));
  // (a finished one taken out of the three isn't held: it's done)
  const keep = held
    .filter(id => st.aside.some(q => q.id === id) || st.back.some(q => q.id === id))
    .slice(0, TOP3_HELD);
  S.top3 = ids.length || keep.length ? { day: today(), ids, ...(keep.length ? { held: keep } : {}) } : null;
  save();
  renderToday();
}
const top3Text = id => (S.quests.find(q => q.id === id) || {}).text || '';
function toggleTop3(id) {
  const st = top3State(),
    ids = st.active.map(q => q.id),
    q = S.quests.find(x => x.id === id);
  if (!q) return;
  if (ids.includes(id)) {
    setTop3(
      ids.filter(x => x !== id),
      { drop: [id] },
    );
    toast('Removed from Top 3');
  } else if ([...st.aside, ...st.back].includes(q)) {
    setTop3(ids, { drop: [id] });
    toast('Removed from Top 3');
  } else if (!canAct(q))
    toast(`${q.scheduled ? 'Scheduled' : 'Waiting'}: not a priority to work on now`, false, 3000);
  else if (ids.length >= TOP3_MAX) openTop3Picker(`Top 3 is full. Take one out to add ${q.text}.`);
  else {
    setTop3([...ids, id]);
    toast('Added to Top 3');
  }
}
// A compact label of how far a task has got.
function progressLine(n) {
  if (isDone(n)) return 'Done';
  const w = showsWaiting(n) ? stepWaitBadge(n) || waitBadge(n) : '';
  if (!n.children.length) return w || 'To do';
  const req = n.children.filter(c => !c.opt),
    set = req.length ? req : n.children,
    nx = nextLeaf(n);
  return (
    `${set.filter(isDone).length} of ${set.length} steps` +
    (nx ? ' · Next: ' + esc(nx.text) : needsNext(n) ? " · what's next?" : w ? ' · ' + w : '')
  );
}
// The one short action on a top 3 row.
function top3Action(n) {
  if (isDone(n)) return '';
  if (n.resume) return `<button class="btn sm green" data-resume="${n.id}">Resume</button>`;
  if (needsNext(n)) return `<button class="btn sm" data-asknext="${n.id}">What's next?</button>`;
  const t = focusLeaf(n);
  return t ? `<button class="btn sm blue" data-zen="1" data-q="${t.id}">Focus</button>` : '';
}
function renderTop3() {
  const st = top3State(),
    ids = st.active.map(q => q.id),
    open = S.quests.filter(canAct);
  if (!ids.length && !st.aside.length && !st.back.length) {
    // Nothing chosen: one quiet line, only while there's something to choose from.
    return open.length
      ? `<div class="slot top3empty"><span>What matters most today?</span><button class="linkbtn" data-top3pick="1">Pick your Top 3</button></div>`
      : '';
  }
  // (a chosen task now scheduled, or only waiting, isn't a priority to work on: it's set aside,
  // still chosen, without holding a place; it comes back when it can be worked on again)
  const out = st.aside;
  const rows = st.active
    .map((n, i) => {
      const d = isDone(n);
      return `<div class="t3row${d ? ' done' : ''}" data-t3="${n.id}"><span class="t3n" aria-hidden="true">${i + 1}</span><button class="open" data-open="${n.id}"><span>${esc(n.text)}</span><small>${progressLine(n)}</small></button>${d ? `<span class="tag done">Done</span>` : top3Action(n)}</div>`;
    })
    .join('');
  let note = out.length
    ? `<p class="hint t3out">Set aside (${out.some(q => q.scheduled) ? (out.every(q => q.scheduled) ? 'scheduled' : 'scheduled or waiting') : 'waiting'}): ${out.map(q => esc(q.text)).join(', ')}</p>`
    : '';
  // (set aside, workable again, but the three places are taken: bringing it back is your call)
  note += st.back
    .map(
      q =>
        `<p class="hint t3back">${esc(q.text)} can be worked on again. <button class="linkbtn" data-t3back="${q.id}">Bring back</button></p>`,
    )
    .join('');
  return `<section class="top3 box" aria-label="Top 3 today"><div class="sechead"><h2>Top 3</h2><button class="linkbtn" data-top3pick="1">Change</button></div>${rows ? `<div class="t3list">${rows}</div>` : ''}${note}</section>`;
}
/* choosing: a sheet listing Today's open tasks; tap to add or take out, in order; the chosen
   ones can be moved up and down. Each tap is saved as it's made. */
function openTop3Picker(hint) {
  popSheet(top3PickerHtml(hint), { labelledBy: 'sheettitle' });
}
function top3PickerHtml(hint) {
  const st = top3State(),
    chosen = st.active,
    ids = chosen.map(q => q.id),
    kept = [...st.aside, ...st.back],
    rest = S.quests.filter(q => canAct(q) && !ids.includes(q.id) && !kept.includes(q)),
    // (scheduled ones, and ones only waiting, can't be worked on now: listed, not choosable)
    held = S.quests.filter(q => !isDone(q) && !canAct(q) && !kept.includes(q)),
    full = ids.length >= TOP3_MAX;
  let h = `<h2 id="sheettitle">Top 3 for today</h2><p class="hint qahint">${esc(hint || "Up to three of Today's tasks, most important first. Tap to choose.")}</p><div class="t3pick">`;
  chosen.forEach((q, i) => {
    h += `<div class="t3prow"><button class="qact on" type="button" data-stay="1" data-t3tog="${q.id}" aria-pressed="true"><span class="t3n" aria-hidden="true">${i + 1}</span>${esc(q.text)}</button><button class="mv" type="button" data-stay="1" data-t3up="${q.id}" aria-label="Move up: ${esc(q.text)}"${i === 0 ? ' disabled' : ''}>&#9650;</button><button class="mv" type="button" data-stay="1" data-t3down="${q.id}" aria-label="Move down: ${esc(q.text)}"${i === chosen.length - 1 ? ' disabled' : ''}>&#9660;</button></div>`;
  });
  rest.forEach(q => {
    h += `<div class="t3prow"><button class="qact" type="button" data-stay="1" data-t3tog="${q.id}" aria-pressed="false"${full ? ' disabled' : ''}><span class="t3n" aria-hidden="true"></span>${esc(q.text)}</button></div>`;
  });
  // Chosen but set aside: not holding a place. Each can be taken out of Top 3 altogether.
  kept.forEach(q => {
    const why = canAct(q)
      ? 'can be worked on: take one out to bring it back'
      : q.scheduled
        ? 'scheduled'
        : 'waiting';
    h += `<div class="t3prow t3kept"><span class="t3kname">${esc(q.text)} <small>Set aside · ${why}</small></span><button class="linkbtn" type="button" data-stay="1" data-t3drop="${q.id}" aria-label="Take out of Top 3: ${esc(q.text)}">Take out</button></div>`;
  });
  if (held.length)
    h += `<p class="hint t3held">Not available: ${held.map(q => esc(q.text) + ' (' + (q.scheduled ? 'scheduled' : 'waiting') + ')').join(', ')}.</p>`;
  if (!chosen.length && !rest.length && !kept.length)
    h += '<p class="hint">Nothing on Today to choose from.</p>';
  h += `</div><div class="acts"><button class="btn green" type="button" data-sheetclose="1">Done</button>${ids.length || kept.length ? '<button class="btn" type="button" data-stay="1" data-t3none="1">Clear</button>' : ''}</div>`;
  return h;
}
// Redraw the picker in place after a tap, keeping the keyboard on the same control.
function renderTop3Picker(hint) {
  const box = document.querySelector('#sheet .sheetbox');
  if (!box) return;
  const a = document.activeElement,
    sel = a && box.contains(a) ? focusSel(a) : '';
  box.innerHTML = top3PickerHtml(hint);
  const f = (sel && box.querySelector(sel + ':not([disabled])')) || box.querySelector('.qact, button');
  if (f) f.focus({ preventScroll: true });
}
function top3Click(d) {
  if (d.top3pick) return openTop3Picker();
  if (d.top3) return toggleTop3(d.top3);
  if (d.t3back) return openTop3Picker(`Top 3 is full. Take one out to bring back ${top3Text(d.t3back)}.`);
  if (d.t3drop) {
    // (out of the three as well, if it has taken a place since the picker was drawn)
    setTop3(
      top3Ids().filter(x => x !== d.t3drop),
      { drop: [d.t3drop] },
    );
    return renderTop3Picker();
  }
  if (d.t3tog) {
    const ids = top3Ids(),
      q = S.quests.find(x => x.id === d.t3tog);
    if (ids.includes(d.t3tog))
      setTop3(
        ids.filter(x => x !== d.t3tog),
        { drop: [d.t3tog] },
      );
    // (only what can be worked on now, and only into a free place)
    else if (ids.length < TOP3_MAX && q && canAct(q)) setTop3([...ids, d.t3tog]);
    return renderTop3Picker();
  }
  if (d.t3up || d.t3down) {
    const ids = top3Ids(),
      i = ids.indexOf(d.t3up || d.t3down),
      j = d.t3up ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setTop3(ids);
    return renderTop3Picker();
  }
  if (d.t3none) {
    S.top3 = null;
    save();
    renderToday();
    return renderTop3Picker();
  }
}
