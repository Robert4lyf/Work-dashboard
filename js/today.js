/* today / drill-down */
let path = [],
  reorder = false,
  pending = null,
  xOpen = null; // the row whose × is showing its two choices
const panels = {}; // which <details> panels are expanded, so re-renders keep them open
const tick =
  '<svg viewBox="0 0 6 6" shape-rendering="crispEdges" aria-hidden="true"><path fill="#1D2B53" d="M5 1h1v1H5zM4 2h1v1H4zM3 3h1v1H3zM0 3h1v1H0zM1 4h1v1H1zM2 4h1v1H2z"/></svg>';
function dueTag(n) {
  if (!n.due || isDone(n)) return '';
  const t = today(),
    cls = n.due < t ? 'late' : n.due === t ? 'now' : 'due';
  return `<span class="tag ${cls}">${n.due < t ? 'Overdue' : n.due === t ? 'Due today' : 'Due ' + niceDate(n.due)}</span>`;
}
function row(n, i, len, sib) {
  const d = isDone(n),
    kids = n.children.length;
  let left;
  if (kids) {
    const req = n.children.filter(c => !c.opt),
      set = req.length ? req : n.children,
      p = Math.round(frac(n) * 100);
    left = `<button class="meter" data-open="${n.id}" aria-label="${esc(n.text)}: ${p}% complete" style="background:linear-gradient(to top,var(--green) ${p}%,var(--meter-track) ${p}%)">${set.filter(isDone).length}/${set.length}</button>`;
  } else {
    left = `<button class="check" data-toggle="${n.id}" aria-pressed="${d}" aria-label="Mark done: ${esc(n.text)}">${tick}</button>`;
  }
  const nx = kids && !d ? nextLeaf(n) : null,
    stepWait = !d && !n.wait ? stepWaitBadge(n) : '';
  const rt = tplFor(n);
  const meta =
    tagBadge(n.tag) +
    waitBadge(n) +
    stepWait +
    (n.opt ? '<span class="tag opt">Optional</span>' : '') +
    (repeats(rt) ? `<span class="tag rep">Repeats ${esc(repLabel(rt))}</span>` : '') +
    dueTag(n) +
    (nx ? 'Next: ' + esc(nx.text) : '');
  const right = reorder
    ? `${d ? '' : `<button class="mv" data-top="${n.id}" aria-label="Move to top" ${i === 0 ? 'disabled' : ''}>Top</button>`}<button class="mv" data-up="${n.id}" aria-label="Move up" ${i === 0 || (d && !isDone(sib[i - 1])) ? 'disabled' : ''}>&#9650;</button><button class="mv" data-down="${n.id}" aria-label="Move down" ${i === len - 1 || (!d && isDone(sib[i + 1])) ? 'disabled' : ''}>&#9660;</button>`
    : xOpen === n.id
      ? `<span class="xchoice"><button class="chip" data-toinbox="${n.id}">Inbox</button><button class="chip del" data-delnow="${n.id}">Delete</button></span>`
      : `<button class="x" data-xopen="${n.id}" aria-label="Remove ${esc(n.text)}">×</button>`;
  return `<div class="row${d ? ' done' : n.wait || stepWait ? ' waiting' : ''}" data-qid="${n.id}"${kids ? '' : ' data-leaf="1"'}${dragAttr('q:' + n.id)}>${left}<button class="open" data-open="${n.id}"><span>${esc(n.text)}</span>${meta ? '<small>' + meta + '</small>' : ''}</button>${right}</div>`;
}
// A section title, with the Reorder switch beside it when the list has something to reorder.
function listHead(title, ns) {
  return `<div class="sechead"><h2>${title}</h2>${ns.length > 1 ? `<button class="linkbtn" id="reorder">${reorder ? 'Done' : 'Reorder'}</button>` : ''}</div>`;
}
// One card, one row per quest. Waiting ones show below the rest (above finished ones); their
// place in the real order is kept, so they move back up when the wait is over.
const listRank = n => (isDone(n) ? 2 : showsWaiting(n) ? 1 : 0);
function list(ns, doneApart) {
  const rank = new Map(ns.map(n => [n, listRank(n)])),
    shown = reorder ? ns : [...ns].sort((a, b) => rank.get(a) - rank.get(b)),
    open = doneApart && !reorder ? shown.filter(n => !isDone(n)) : shown,
    done = doneApart && !reorder ? shown.filter(isDone) : [];
  let h = open.length
    ? `<div class="list box">${open.map((c, i) => row(c, i, ns.length, ns)).join('')}</div>`
    : '';
  // Finished ones, folded away (open it to un-tick a mistake).
  if (done.length)
    h += `<details id="donesec"${panels.donesec ? ' open' : ''}><summary>Done today <small>${done.length}</small></summary><div class="list box">${done.map((c, i) => row(c, i, ns.length, ns)).join('')}</div></details>`;
  return h;
}
function renderToday() {
  $('#v-today')
    .querySelectorAll('details[id]')
    // (the waiting panel is held open on a waiting quest: that isn't a choice to remember)
    .forEach(d => (d.id !== 'waitd' || !d.dataset.held ? (panels[d.id] = d.open) : 0));
  // Down the path as far as it still leads (a level moved or removed elsewhere cuts it there).
  const ok = [];
  let arr = S.quests;
  for (const id of path) {
    const n = arr.find(x => x.id === id);
    if (!n) break;
    ok.push(id);
    arr = n.children;
  }
  path = ok;
  if (path.length) return renderNode(find(path[path.length - 1]));
  const qs = S.quests;
  let h = renderAttention() + quickActions() + renderCarried();
  const soon = dueSoon().filter(s => s.t.length > 1); // top-level quests show their deadline in the list
  if (soon.length) {
    h += '<div class="soon box"><h2>Due soon</h2>';
    soon.forEach(
      ({ n, t }) =>
        (h += `<button class="soonrow" data-open="${n.id}"><span>${esc(t.join(' / '))}</span>${dueTag(n)}</button>`),
    );
    h += '</div>';
  }
  h += listHead("Today's quests", qs);
  h += list(qs, true);
  const reps = S.templates.filter(repeats); // (saved templates from before stay out of sight)
  if (reps.length) {
    h += `<details id="repd" style="margin:-4px 0 18px"${panels.repd ? ' open' : ''}><summary>Repeating quests</summary>`;
    reps.forEach(t => {
      h += `<div class="rep"><span>${esc(t.text)}${t.monthDay ? ` <small class="hint">(also monthly on the ${ord(t.monthDay)})</small>` : ''}</span><div class="days">`;
      WEEK.forEach(
        i =>
          (h += `<button class="day" data-rep="${t.id}" data-wd="${i}" aria-pressed="${t.days.includes(i)}" aria-label="${WD[i]}">${WD[i].slice(0, 2)}</button>`),
      );
      h += '</div></div>';
    });
    h += '</details>';
  }
  // New work comes in through the Inbox; Today is what you've chosen from it.
  if (!qs.length)
    h +=
      '<div class="slot">Nothing on Today. <button class="linkbtn" data-goto="inbox">Capture in the Inbox</button>, then move items here.</div>';
  h += renderWaitingSection() + renderAlarms() + renderUpcoming();
  setHTML($('#v-today'), h);
}
// Flows (Power Automate Desktop) as a strip of chips: things you do, so they live on Today.
function quickActions() {
  if (!S.flows.length) return '';
  const flows = [...S.flows].sort((a, b) => byName(a.name, b.name));
  return `<div class="flows chips">${flows.map(f => `<a class="chip" href="${esc(f.url)}" data-flow="${f.id}" title="${f.last ? 'Last used ' + esc(whenLabel(f.last)) : 'Not used yet'}">&#9654; ${esc(f.name)}</a>`).join('')}</div>`;
}
// Things being waited on that aren't on Today's list (in the Inbox, or on Upcoming), folded away
// under it; quests on the list already say so themselves. The chip at the top opens the full view.
function renderWaitingSection() {
  const all = waitingSorted().filter(x => x.inbox || x.start);
  if (!all.length) return '';
  return `<details id="waitsec"${panels.waitsec ? ' open' : ''}><summary>Also waiting on others <small>${all.length}</small></summary>${waitingRows(all)}<button class="linkbtn" data-goto="waiting">Open Waiting</button></details>`;
}

// What needs attention, as one row of chips at the top of Today (kept out of the header).
function renderAttention() {
  const t = today();
  let late = 0,
    due = 0;
  (function w(ns) {
    ns.forEach(n => {
      if (isDone(n)) return;
      if (n.due && n.due < t) late++;
      else if (n.due === t) due++;
      w(n.children);
    });
  })(S.quests);
  const ch = chaseDue(),
    c = [];
  if (late) c.push(`<span class="chip warn">${late} overdue</span>`);
  if (due) c.push(`<span class="chip due">${due} due today</span>`);
  if (ch) c.push(`<button class="chip" data-goto="waiting">${ch} to chase</button>`);
  if (reviewDue()) c.push('<button class="chip" data-rsub="week">Weekly review</button>');
  return c.length ? `<div class="attn chips">${c.join('')}</div>` : '';
}

/* carried over: quests on Today for STALE days or more get a decision each morning */
const STALE = 3;
const ageOf = n => (n.since ? daysBetween(n.since, today()) : 0);
// (Not one only waiting on others: every step left is waiting.)
const onlyWaiting = q => q.children.length > 0 && !isDone(q) && !nextLeaf(q);
const carried = () =>
  S.quests.filter(q => !isDone(q) && !q.wait && !onlyWaiting(q) && ageOf(q) >= STALE && q.kept !== today());
function renderCarried() {
  // One line, folded: open it to decide on each (the weekly review asks too).
  const qs = carried();
  return qs.length
    ? `<details id="carrd" class="carried box"${panels.carrd ? ' open' : ''}><summary>${plural(qs.length, 'quest')} carried over <small>for a while: keep, move or drop</small></summary>${carriedRows(qs)}</details>`
    : '';
}
// A carried-over quest with its decisions (also used by the weekly review).
function carriedRows(qs) {
  const b = (attrs, label) => `<button class="chip" ${attrs}>${label}</button>`;
  return qs
    .map(
      q =>
        `<div class="crow"><p>${esc(q.text)} <small>${ageOf(q)} days</small></p><div class="chips">${b(`data-keep="${q.id}"`, 'Keep')}${b(`data-sched="${q.id}" data-kind="q" data-when="${shift(today(), 1)}"`, 'Tomorrow')}${b(`data-sched="${q.id}" data-kind="q" data-when="${nextMonday()}"`, 'Next week')}${b(`data-toinbox="${q.id}"`, 'Inbox')}${b(`data-drop="${q.id}"`, 'Drop')}</div></div>`,
    )
    .join('');
}

/* upcoming: top-level quests scheduled for a later day (S.later, each with a start date) */
const nextMonday = () => shift(today(), (8 - new Date().getDay()) % 7 || 7);
function laterPicker(kind, id) {
  const b = (when, label) =>
    `<button class="chip" data-sched="${id}" data-kind="${kind}" data-when="${when}">${label}</button>`;
  return `<div class="later"><span>Do later:</span>${b(shift(today(), 1), 'Tomorrow')}${b(nextMonday(), 'Next Mon')}<input type="date" class="fld" data-schedpick="${id}" data-kind="${kind}" min="${shift(today(), 1)}" aria-label="Do on a later date"></div>`;
}
function renderUpcoming() {
  if (!S.later.length) return '';
  let h = `<details id="upd"${panels.upd ? ' open' : ''}><summary>Upcoming (${S.later.length})</summary>`;
  S.later.forEach(n => {
    const c = count(n);
    h += `<div class="uprow"><div class="uptxt">${esc(n.text)} ${tagBadge(n.tag)}${c ? `<span class="tag opt">${c} subquest${c === 1 ? '' : 's'}</span>` : ''}</div>
      <input type="date" class="fld" data-restart="${n.id}" value="${n.start}" min="${shift(today(), 1)}" aria-label="Start date for ${esc(n.text)}">
      <button class="btn" data-now="${n.id}">Today</button><button class="x" data-dellater="${n.id}" aria-label="Delete ${esc(n.text)}">×</button></div>`;
  });
  return h + '</details>';
}
// Move a top-level quest ('q') or inbox item ('i') to Upcoming.
function schedule(kind, id, date) {
  if (!date || date <= today()) return;
  let n;
  if (kind === 'q') {
    const r = find(id);
    if (!r || r.parents.length) return;
    r.arr.splice(r.arr.indexOf(r.n), 1);
    n = r.n;
    path = [];
  } else {
    const i = S.inbox.findIndex(x => x.id === id);
    if (i < 0) return;
    const it = S.inbox.splice(i, 1)[0];
    n = inboxToNode(it);
  }
  n.start = date;
  delete n.since;
  delete n.kept;
  S.later.push(n);
  S.later.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  save();
  renderAll();
  toast('Moved to ' + dayLabel(date));
}
function renderNode({ n, parents }) {
  const d = isDone(n),
    kids = n.children.length,
    top = !parents.length;
  let h = `<div class="crumbs" role="navigation" aria-label="Breadcrumb"><button data-crumb="-1">&lsaquo; Today</button>`;
  parents.forEach((p, i) => (h += `<span>/</span><button data-crumb="${i}">${esc(p.text)}</button>`));
  // The facts: what's set on this quest, each a tap to change.
  h += `</div><div class="node box facts"><h1>${esc(n.text)}</h1>`;
  if (kids) {
    const req = n.children.filter(c => !c.opt),
      set = req.length ? req : n.children,
      p = Math.round(frac(n) * 100),
      opt = n.children.length - req.length;
    h += `<div class="prog"><div style="width:${p}%"></div></div><div class="hint" style="margin:6px 0 0">${set.filter(isDone).length} / ${set.length} complete${req.length && opt ? ' + ' + opt + ' optional' : ''}</div>`;
  }
  const m = spent(n),
    meta =
      (n.opt ? '<span class="tag opt">Optional</span>' : '') +
      dueTag(n) +
      (n.wait ? `<span class="tag wait">Waiting on ${esc(n.wait.who || 'someone')}</span>` : '') +
      (m ? `<span class="tag est">Focus ${hm(m)}</span>` : '');
  if (meta) h += `<div class="factsrow">${meta}</div>`;
  // Its tag, folded to the one it has (tap to change).
  if (top)
    h += `<details id="tagd" class="tagd"${panels.tagd ? ' open' : ''}><summary>Tag: ${n.tag ? tagBadge(n.tag) : '<span class="hint">none</span>'}</summary>${tagPicker('q', n.id, n.tag)}</details>`;
  h += waitPanel(n, top);
  h += '</div>';
  // The steps come first: they're what you work through. (A quest has steps; a step doesn't.)
  if (top) {
    h += listHead('Subquests', n.children);
    h += list(n.children);
    h += `<form class="addrow" id="sform" data-parent="${n.id}"><input id="sin" maxlength="120" placeholder="Add a subquest" aria-label="New subquest" autocomplete="off"><button class="btn">Add</button></form>`;
  }
  // Everything else, folded away.
  h += `<details id="mored" class="more"${panels.mored ? ' open' : ''}><summary>More: notes, deadline, ${top ? 'do later, repeat, ' : ''}move…</summary>`;
  if (top) h += laterPicker('q', n.id);
  h += `<details id="fdet"${(panels.fdet ?? !!n.notes) ? ' open' : ''}><summary>Notes and deadline</summary>
    <label class="f" for="fname">Name</label><input class="fld" id="fname" data-field="text" data-id="${n.id}" value="${esc(n.text)}" maxlength="120">
    <label class="f" for="fdue">Deadline</label><input class="fld" type="date" id="fdue" data-field="due" data-id="${n.id}" value="${n.due}">
    <label class="f" for="fnotes">Notes</label><textarea class="fld" id="fnotes" data-field="notes" data-id="${n.id}">${esc(n.notes)}</textarea>
    ${top ? '' : `<label class="optbox"><input type="checkbox" data-field="opt" data-id="${n.id}" ${n.opt ? 'checked' : ''}>Optional</label>`}
    </details>`;
  if (top) {
    const t = tplFor(n),
      on = repeats(t),
      days = on ? t.days : [],
      md = on ? t.monthDay : 0;
    const preset = (k, l, p) =>
      `<button class="chip" data-rpreset="${k}" data-id="${n.id}" aria-pressed="${p}">${l}</button>`;
    h += `<details id="rptd"${panels.rptd ? ' open' : ''}><summary>Repeat: ${on ? esc(repLabel(t)) : 'off'}</summary>
      <div class="chips" style="margin-bottom:10px">${preset('daily', 'Every day', days.length === 7)}${preset('weekdays', 'Weekdays', repLabel({ days, monthDay: 0 }) === 'Weekdays')}${preset('off', 'Off', !on)}</div>
      <div class="days">${WEEK.map(i => `<button class="day" data-rday="${i}" data-id="${n.id}" aria-pressed="${days.includes(i)}" aria-label="${WD[i]}">${WD[i].slice(0, 2)}</button>`).join('')}</div>
      <label class="f" for="fmonth">Also monthly, on day</label><select class="fld" id="fmonth" data-field="month" data-id="${n.id}"><option value="0">Not monthly</option>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}"${md === i + 1 ? ' selected' : ''}>${ord(i + 1)}${i + 1 > 28 ? ' (or last day)' : ''}</option>`).join('')}</select>
      </details>`;
  }
  h += `<div class="links"><button class="linkbtn" data-toinbox="${n.id}">Move to inbox</button><button class="dellink" data-del="${n.id}">Delete this quest</button></div>`;
  h += '</details>';
  // The two things you do with a quest, always to hand.
  h += '<div class="qfoot acts">';
  if (!kids)
    h += `<button class="btn ${d ? '' : 'green'}" data-toggle="${n.id}">${d ? 'Mark not done' : 'Mark done'}</button>`;
  h += `${d ? '' : `<button class="btn blue" data-focuson="${n.id}">Focus on this</button>`}</div>`;
  setHTML($('#v-today'), h);
}

/* swipes on a phone, on Today's rows: left shows the row's choices (Inbox / Delete), right ticks a
   step off. Touch only: with a mouse, rows are dragged to reorder (see board.js) and the × is there. */
let qswipe = null,
  qswipeClick = false;
$('#v-today').addEventListener('pointerdown', e => {
  qswipeClick = false;
  if (e.pointerType === 'mouse' || reorder) return;
  const el = e.target.closest('.row[data-qid]');
  // (a swipe may start on the row's title or tick: those are buttons too)
  if (!el || e.target.closest('button:not(.open):not(.check):not(.meter), input, select, textarea, form, a'))
    return;
  qswipe = {
    el,
    id: el.dataset.qid,
    leaf: !!el.dataset.leaf,
    x: e.clientX,
    y: e.clientY,
    dx: 0,
    on: false,
    pid: e.pointerId,
  };
});
$('#v-today').addEventListener('pointermove', e => {
  const s = qswipe;
  if (!s || e.pointerId !== s.pid) return;
  const dx = e.clientX - s.x,
    dy = e.clientY - s.y;
  if (!s.on) {
    if (Math.abs(dy) > 12 || Math.abs(dy) > Math.abs(dx)) return (qswipe = null);
    if (Math.abs(dx) < 12) return;
    s.on = true;
    s.el.classList.add('swiping');
  }
  s.dx = dx;
  s.el.style.transform = `translateX(${dx}px)`;
  s.el.dataset.swipe = dx < -SWIPE ? 'more' : dx > SWIPE && s.leaf ? 'done' : '';
});
function endQSwipe() {
  const s = qswipe;
  qswipe = null;
  if (!s || !s.on) return;
  s.el.classList.remove('swiping');
  s.el.style.transform = '';
  delete s.el.dataset.swipe;
  if (s.dx < -SWIPE) {
    xOpen = s.id;
    renderToday();
  } else if (s.dx > SWIPE && s.leaf) {
    const b = s.el.querySelector('[data-toggle]');
    if (b) b.click(); // (before the guard below: this click is meant)
  }
  qswipeClick = true; // (a tap the browser makes of the finger lifting isn't one)
}
document.addEventListener('pointerup', endQSwipe);
document.addEventListener('pointercancel', endQSwipe);
$('#v-today').addEventListener(
  'click',
  e => {
    if (qswipeClick) e.stopPropagation();
    qswipeClick = false;
  },
  true,
);
