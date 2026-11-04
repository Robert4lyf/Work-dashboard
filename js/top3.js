/* today's top 3: up to three of Today's tasks, chosen each day, shown at the top of Today in
   the order chosen. They point at the tasks themselves (S.top3 = { day, ids }: nothing is
   copied, and the list below isn't reordered). A new day starts with none; yesterday's aren't
   carried over. Synced as one small record of its own (see toRecords): the newer choice wins when
   two devices choose at once, and the tasks are untouched either way. */
// The chosen tasks still on Today, in order (a deleted or moved one simply isn't shown).
const top3Ids = () =>
  (S.top3 && S.top3.day === today() ? S.top3.ids : []).filter(id => S.quests.some(q => q.id === id));
const inTop3 = id => top3Ids().includes(id);
function setTop3(ids) {
  ids = ids.filter(id => S.quests.some(q => q.id === id)).slice(0, TOP3_MAX);
  S.top3 = ids.length ? { day: today(), ids } : null;
  save();
  renderToday();
}
function toggleTop3(id) {
  const ids = top3Ids(),
    q = S.quests.find(x => x.id === id);
  if (!q) return;
  if (ids.includes(id)) {
    setTop3(ids.filter(x => x !== id));
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
  const ids = top3Ids(),
    open = S.quests.filter(canAct);
  if (!ids.length) {
    // Nothing chosen: one quiet line, only while there's something to choose from.
    return open.length
      ? `<div class="slot top3empty"><span>What matters most today?</span><button class="linkbtn" data-top3pick="1">Pick your Top 3</button></div>`
      : '';
  }
  // (a chosen task now scheduled, or only waiting, isn't a priority to work on: it's left out here,
  // still chosen, and comes back when it can be worked on again; nothing takes its place)
  const out = ids
      .map(id => S.quests.find(q => q.id === id))
      .filter(q => ['scheduled', 'waiting'].includes(taskState(q))),
    shown = ids.filter(id => !out.some(q => q.id === id));
  const rows = shown
    .map((id, i) => {
      const n = S.quests.find(q => q.id === id),
        d = isDone(n);
      return `<div class="t3row${d ? ' done' : ''}" data-t3="${n.id}"><span class="t3n" aria-hidden="true">${i + 1}</span><button class="open" data-open="${n.id}"><span>${esc(n.text)}</span><small>${progressLine(n)}</small></button>${d ? `<span class="tag done">Done</span>` : top3Action(n)}</div>`;
    })
    .join('');
  const note = out.length
    ? `<p class="hint t3out">${out.map(q => esc(q.text)).join(', ')} ${out.length === 1 ? 'is' : 'are'} ${out.every(q => q.scheduled) ? 'scheduled' : out.every(q => !q.scheduled) ? 'waiting' : 'scheduled or waiting'}: not shown as ${out.length === 1 ? 'a priority' : 'priorities'} until ${out.length === 1 ? 'it' : 'they'} can be worked on.</p>`
    : '';
  return `<section class="top3 box" aria-label="Top 3 today"><div class="sechead"><h2>Top 3</h2><button class="linkbtn" data-top3pick="1">Change</button></div>${rows ? `<div class="t3list">${rows}</div>` : ''}${note}</section>`;
}
/* choosing: a sheet listing Today's open tasks; tap to add or take out, in order; the chosen
   ones can be moved up and down. Each tap is saved as it's made. */
function openTop3Picker(hint) {
  popSheet(top3PickerHtml(hint), { labelledBy: 'sheettitle' });
}
function top3PickerHtml(hint) {
  const ids = top3Ids(),
    chosen = ids.map(id => S.quests.find(q => q.id === id)),
    rest = S.quests.filter(q => canAct(q) && !ids.includes(q.id)),
    // (scheduled ones, and ones only waiting, can't be worked on now: listed, not choosable)
    held = S.quests.filter(q => !isDone(q) && !canAct(q) && !ids.includes(q.id)),
    full = ids.length >= TOP3_MAX;
  let h = `<h2 id="sheettitle">Top 3 for today</h2><p class="hint qahint">${esc(hint || "Up to three of Today's tasks, most important first. Tap to choose.")}</p><div class="t3pick">`;
  chosen.forEach((q, i) => {
    h += `<div class="t3prow"><button class="qact on" type="button" data-stay="1" data-t3tog="${q.id}" aria-pressed="true"><span class="t3n" aria-hidden="true">${i + 1}</span>${esc(q.text)}</button><button class="mv" type="button" data-stay="1" data-t3up="${q.id}" aria-label="Move up: ${esc(q.text)}"${i === 0 ? ' disabled' : ''}>&#9650;</button><button class="mv" type="button" data-stay="1" data-t3down="${q.id}" aria-label="Move down: ${esc(q.text)}"${i === chosen.length - 1 ? ' disabled' : ''}>&#9660;</button></div>`;
  });
  rest.forEach(q => {
    h += `<div class="t3prow"><button class="qact" type="button" data-stay="1" data-t3tog="${q.id}" aria-pressed="false"${full ? ' disabled' : ''}><span class="t3n" aria-hidden="true"></span>${esc(q.text)}</button></div>`;
  });
  if (held.length)
    h += `<p class="hint t3held">Not offered, as they can't be worked on now: ${held.map(q => esc(q.text) + ' (' + (q.scheduled ? 'scheduled' : 'waiting') + ')').join(', ')}.</p>`;
  if (!chosen.length && !rest.length) h += '<p class="hint">Nothing on Today to choose from.</p>';
  h += `</div><div class="acts"><button class="btn green" type="button" data-sheetclose="1">Done</button>${ids.length ? '<button class="btn" type="button" data-stay="1" data-t3none="1">Clear</button>' : ''}</div>`;
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
  if (d.t3tog) {
    const ids = top3Ids();
    if (ids.includes(d.t3tog)) setTop3(ids.filter(x => x !== d.t3tog));
    else if (ids.length < TOP3_MAX) setTop3([...ids, d.t3tog]);
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
    setTop3([]);
    return renderTop3Picker();
  }
}
