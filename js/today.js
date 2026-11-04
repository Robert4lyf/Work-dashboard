/* today / drill-down */
let path = [],
  reorder = false,
  pending = null;
const panels = {}; // which <details> panels are expanded, so re-renders keep them open
const tick =
  '<svg viewBox="0 0 6 6" shape-rendering="crispEdges" aria-hidden="true"><path fill="#1D2B53" d="M5 1h1v1H5zM4 2h1v1H4zM3 3h1v1H3zM0 3h1v1H0zM1 4h1v1H1zM2 4h1v1H2z"/></svg>';
const chevron =
  '<svg viewBox="0 0 6 6" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M1 0h2v1H1zM2 1h2v1H2zM3 2h2v2H3zM2 4h2v1H2zM1 5h2v1H1z"/></svg>';
const dots =
  '<svg viewBox="0 0 8 2" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M0 0h2v2H0zM3 0h2v2H3zM6 0h2v2H6z"/></svg>';
// A row's (or tile's) ⋯: its quick actions, in a sheet (see actions.js).
const moreBtn = n =>
  `<button class="qmore" data-qact="${n.id}" aria-label="Actions: ${esc(n.text)}" aria-haspopup="dialog">${dots}</button>`;
// A task with a saved place (see resume.js): a quiet mark on its row.
const placeMark = n => (n.resume && !isDone(n) ? '<span class="tag place">Saved place</span>' : '');
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
  // A task with steps opens (its bar, below its name, shows how far it's got); one without is ticked.
  if (kids)
    left = `<button class="meter" data-open="${n.id}" aria-label="Open ${esc(n.text)}">${chevron}</button>`;
  else {
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
    placeMark(n) +
    (nx
      ? 'Next: ' + esc(nx.text)
      : needsNext(n)
        ? '<span class="tag asknext">All ticked: what\'s next?</span>'
        : '');
  const right = reorder
    ? `${d ? '' : `<button class="mv" data-top="${n.id}" aria-label="Move to top" ${i === 0 ? 'disabled' : ''}>Top</button>`}<button class="mv" data-up="${n.id}" aria-label="Move up" ${i === 0 || (d && !isDone(sib[i - 1])) ? 'disabled' : ''}>&#9650;</button><button class="mv" data-down="${n.id}" aria-label="Move down" ${i === len - 1 || (!d && isDone(sib[i + 1])) ? 'disabled' : ''}>&#9660;</button>`
    : moreBtn(n);
  return `<div class="row${d ? ' done' : n.wait || stepWait ? ' waiting' : ''}" data-qid="${n.id}"${kids ? '' : ' data-leaf="1"'}${dragAttr('q:' + n.id)}>${left}<button class="open" data-open="${n.id}"><span>${esc(n.text)}</span>${n.summary ? `<em class="qsum">${esc(n.summary)}</em>` : ''}${meta ? '<small>' + meta + '</small>' : ''}${kids ? stepBar(n) : ''}</button>${right}</div>`;
}
// A task's steps as a bar, a block each: the ticked ones, then the rest in order, the next one
// and any waiting marked. Every one ticked but the task not finished: a last block asks what's next.
function stepBar(n) {
  const req = n.children.filter(c => !c.opt),
    set = req.length ? req : n.children,
    nx = nextLeaf(n),
    done = set.filter(isDone),
    open = set.filter(c => !isDone(c)),
    waiting = open.filter(c => c.wait).length,
    ask = needsNext(n) && !nx; // (an optional step still to do shows as Next instead)
  const blocks = [
    ...done.map(() => 's-done'),
    ...open.map(c => (c === nx ? 's-next' : c.wait ? 's-wait' : '')),
  ];
  if (ask) blocks.push('s-ask');
  const label =
    `${done.length} of ${set.length} steps done` +
    (waiting ? `, ${waiting} waiting` : '') +
    (ask ? ", what's next?" : '');
  // (a <b>, not a <span>: the task's name is the row's span)
  return `<b class="stepbar${blocks.length > 15 ? ' many' : ''}" role="img" aria-label="${label}">${blocks.map(b => `<i${b ? ` class="${b}"` : ''}></i>`).join('')}</b>`;
}
// A section title, with the Reorder switch beside it when the list has something to reorder (and,
// for Today's tasks, the List / Board switch).
function listHead(title, ns, views) {
  const sw = views
    ? `<span class="viewsw" role="group" aria-label="Show as">${['list', 'board'].map(v => `<button class="chip" data-tview="${v}" aria-pressed="${todayView === v}">${v === 'list' ? 'List' : 'Board'}</button>`).join('')}</span>`
    : '';
  return `<div class="sechead"><h2>${title}</h2>${sw}${ns.length > 1 ? `<button class="linkbtn" id="reorder">${reorder ? 'Done' : 'Reorder'}</button>` : ''}</div>`;
}
/* Today as a board: a lane per stage, a tile per task. The choice is this device's own. */
const TVIEW = 'dashboard-today-view';
let todayView = (() => {
  try {
    return localStorage.getItem(TVIEW) === 'board' ? 'board' : 'list';
  } catch (e) {
    return 'list';
  }
})();
function setTodayView(v) {
  todayView = v === 'board' ? 'board' : 'list';
  reorder = false; // (the board has no Reorder: its lanes keep the list's order)
  try {
    localStorage.setItem(TVIEW, todayView);
  } catch (e) {}
  renderToday();
}
const LANES = [
  ['doing', 'In progress'],
  ['ask', "What's next?"],
  ['todo', 'Not started'],
  ['wait', 'Waiting'],
  ['done', 'Done today'],
];
function laneOf(n) {
  if (isDone(n)) return 'done';
  if (n.children.length && needsNext(n) && !nextLeaf(n)) return 'ask';
  if (showsWaiting(n)) return 'wait';
  return n.children.some(isDone) ? 'doing' : 'todo';
}
function tile(n) {
  const kids = n.children.length,
    d = isDone(n),
    nx = kids && !d ? nextLeaf(n) : null,
    meta =
      tagBadge(n.tag) +
      (!d && !n.wait ? stepWaitBadge(n) : '') +
      waitBadge(n) +
      dueTag(n) +
      placeMark(n) +
      (nx ? `<span class="qtnext">Next: ${esc(nx.text)}</span>` : '');
  return `<div class="qtile${d ? ' done' : ''}" data-qid="${n.id}">${kids ? '' : `<button class="check" data-toggle="${n.id}" aria-pressed="${d}" aria-label="Mark done: ${esc(n.text)}">${tick}</button>`}<button class="qtopen" data-open="${n.id}"><span>${esc(n.text)}</span>${n.summary ? `<em class="qsum">${esc(n.summary)}</em>` : ''}${meta ? `<small>${meta}</small>` : ''}${kids ? stepBar(n) : ''}</button>${moreBtn(n)}</div>`;
}
function board(ns) {
  const by = {};
  ns.forEach(n => (by[laneOf(n)] = by[laneOf(n)] || []).push(n));
  return `<div class="board">${LANES.filter(([k]) => by[k])
    .map(
      ([k, name]) =>
        `<section class="blane" data-lane="${k}" aria-label="${name}"><h3>${name} <small>${by[k].length}</small></h3><div class="lanetiles">${by[k].map(tile).join('')}</div></section>`,
    )
    .join('')}</div>`;
}
// One card, one row per task. Waiting ones show below the rest (above finished ones); their
// place in the real order is kept, so they move back up when the wait is over.
// (A task's steps keep their order, waiting or not: it's the order they're done in. Only
// finished ones go last.)
const listRank = (n, steps) => (isDone(n) ? 2 : !steps && showsWaiting(n) ? 1 : 0);
function list(ns, doneApart, steps) {
  const rank = new Map(ns.map(n => [n, listRank(n, steps)])),
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
  // (each lane of the board keeps where it was scrolled to across a redraw)
  const laneX = {};
  $('#v-today')
    .querySelectorAll('.blane')
    .forEach(l => (laneX[l.dataset.lane] = l.querySelector('.lanetiles').scrollLeft));
  drawToday();
  for (const k in laneX) {
    const l = $(`#v-today .blane[data-lane="${k}"] .lanetiles`);
    if (l) l.scrollLeft = laneX[k];
  }
}
function drawToday() {
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
  // 1. What needs attention (one line, opening to the items); 2. the Top 3; 3. Today's work.
  let h = renderAttention() + renderTop3() + renderCarried();
  const asBoard = todayView === 'board' && qs.length;
  h += listHead("Today's tasks", asBoard ? [] : qs, qs.length > 0);
  h += asBoard ? board(qs) : list(qs, true);
  // New work comes in through the Inbox; Today is what you've chosen from it.
  if (!qs.length)
    h +=
      '<div class="slot">Nothing on Today. <button class="linkbtn" data-goto="inbox">Capture in the Inbox</button>, then move items here.</div>';
  // 4. The rest, folded: deadlines on steps coming up, what's waited on elsewhere, later work,
  // repeats, flows and alarms. (Overdue and due-today work is in Needs attention.)
  const soon = dueSoon().filter(s => s.t.length > 1 && s.n.due > today());
  let more = '';
  if (soon.length)
    more += `<details id="soond"${panels.soond ? ' open' : ''}><summary>Steps due soon <small>${soon.length}</small></summary><div class="soon">${soon
      .map(
        ({ n, t }) =>
          `<button class="soonrow" data-open="${n.id}"><span>${esc(t.join(' / '))}</span>${dueTag(n)}</button>`,
      )
      .join('')}</div></details>`;
  more += renderWaitingSection() + renderUpcoming();
  const reps = S.templates.filter(repeats);
  if (reps.length) {
    more += `<details id="repd"${panels.repd ? ' open' : ''}><summary>Repeating tasks <small>${reps.length}</small></summary>`;
    reps.forEach(t => {
      more += `<div class="rep"><span>${esc(t.text)}${t.monthDay ? ` <small class="hint">(also monthly on the ${ord(t.monthDay)})</small>` : ''}</span><div class="days">`;
      WEEK.forEach(
        i =>
          (more += `<button class="day" data-rep="${t.id}" data-wd="${i}" aria-pressed="${t.days.includes(i)}" aria-label="${WD[i]}">${WD[i].slice(0, 2)}</button>`),
      );
      more += '</div></div>';
    });
    more += '</details>';
  }
  more += quickActions() + renderAlarms();
  if (more) h += `<section class="todaymore" aria-label="More on Today">${more}</section>`;
  setHTML($('#v-today'), h);
}
// Flows (Power Automate Desktop) as a strip of chips: things you do, so they live on Today.
function quickActions() {
  if (!S.flows.length) return '';
  const flows = [...S.flows].sort((a, b) => byName(a.name, b.name));
  return `<details id="flowsd"${panels.flowsd ? ' open' : ''}><summary>Desktop automations <small>${flows.length}</small></summary><div class="flows chips">${flows.map(f => `<a class="chip" href="${esc(f.url)}" data-flow="${f.id}" title="${f.last ? 'Last used ' + esc(whenLabel(f.last)) : 'Not used yet'}">&#9654; ${esc(f.name)}${flowStatus(f)}</a>`).join('')}</div></details>`;
}
// Things being waited on that aren't on Today's list (in the Inbox, or on Upcoming), folded away
// under it; tasks on the list already say so themselves. The chip at the top opens the full view.
function renderWaitingSection() {
  const all = waitingSorted().filter(x => x.inbox || x.start);
  if (!all.length) return '';
  return `<details id="waitsec"${panels.waitsec ? ' open' : ''}><summary>Also waiting on others <small>${all.length}</small></summary>${waitingRows(all)}<button class="linkbtn" data-goto="waiting">Open Waiting</button></details>`;
}

// What needs attention: one line at the top of Today, saying how many and of what kind, that
// opens to the items themselves (the same list as the Command Centre's, so the counts agree).
// Failures needing intervention are shown under it straight away (one tap to the failed stage);
// the rest are folded in it. Beside it, the way to the Command Centre. Opening it acknowledges
// nothing.
function renderAttention() {
  const items = attentionItems(),
    cc = '<button class="linkbtn attcc" data-goto="ops">Command Centre &rsaquo;</button>';
  if (!items.length) return `<div class="attn attnone"><span>Nothing needs attention</span>${cc}</div>`;
  const fails = items.filter(i => i.sev === 0),
    rest = items.filter(i => i.sev > 0);
  const sum = `<b>Needs attention <span class="attn-n">${items.length}</span></b><small>${attentionCounts(items)}</small>`;
  return `<div class="attn">${
    rest.length
      ? `<details id="attd" class="attsum sev${items[0].sev}"${panels.attd ? ' open' : ''}><summary>${sum}</summary><div class="attlist box">${rest.map(attentionRow).join('')}</div></details>`
      : `<div id="attd" class="attsum sev0"><div class="attsumline">${sum}</div></div>`
  }${fails.length ? `<div class="attlist box attfail">${fails.map(attentionRow).join('')}</div>` : ''}${cc}</div>`;
}

/* carried over: tasks on Today for STALE days or more get a decision each morning */
const STALE = 3;
const ageOf = n => (n.since ? daysBetween(n.since, today()) : 0);
// (Not one only waiting on others: every step left is waiting.)
const onlyWaiting = q => q.children.length > 0 && !isDone(q) && !nextLeaf(q) && !needsNext(q);
const carried = () =>
  S.quests.filter(q => !isDone(q) && !q.wait && !onlyWaiting(q) && ageOf(q) >= STALE && q.kept !== today());
function renderCarried() {
  // One line, folded: open it to decide on each (the weekly review asks too).
  const qs = carried();
  return qs.length
    ? `<details id="carrd" class="carried box"${panels.carrd ? ' open' : ''}><summary>${plural(qs.length, 'task')} carried over <small>for a while: keep, move or drop</small></summary>${carriedRows(qs)}</details>`
    : '';
}
// A carried-over task with its decisions (also used by the weekly review).
function carriedRows(qs) {
  const b = (attrs, label) => `<button class="chip" ${attrs}>${label}</button>`;
  return qs
    .map(
      q =>
        `<div class="crow"><p>${esc(q.text)} <small>${ageOf(q)} days</small></p><div class="chips">${b(`data-keep="${q.id}"`, 'Keep')}${b(`data-sched="${q.id}" data-kind="q" data-when="${shift(today(), 1)}"`, 'Tomorrow')}${b(`data-sched="${q.id}" data-kind="q" data-when="${nextMonday()}"`, 'Next week')}${b(`data-toinbox="${q.id}"`, 'Inbox')}${b(`data-drop="${q.id}"`, 'Drop')}</div></div>`,
    )
    .join('');
}

/* upcoming: top-level tasks scheduled for a later day (S.later, each with a start date) */
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
    h += `<div class="uprow"><div class="uptxt">${esc(n.text)} ${tagBadge(n.tag)}${c ? `<span class="tag opt">${c} step${c === 1 ? '' : 's'}</span>` : ''}</div>
      <input type="date" class="fld" data-restart="${n.id}" value="${n.start}" min="${shift(today(), 1)}" aria-label="Start date for ${esc(n.text)}">
      <button class="btn" data-now="${n.id}">Today</button><button class="x" data-dellater="${n.id}" aria-label="Delete ${esc(n.text)}">×</button></div>`;
  });
  return h + '</details>';
}
// Move a top-level task ('q') or inbox item ('i') to Upcoming.
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
    top = !parents.length,
    q = parents[0] || n; // (the quest: a step's page shares its resources and saved place)
  let h = `<div class="crumbs" role="navigation" aria-label="Breadcrumb"><button data-crumb="-1">&lsaquo; Today</button>`;
  parents.forEach((p, i) => (h += `<span>/</span><button data-crumb="${i}">${esc(p.text)}</button>`));
  // The facts: what's set on this task, each a tap to change. First what you're here for: how
  // far it's got and what's next.
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
      (!d && !n.wait && kids ? stepWaitBadge(n) : '') +
      (m ? `<span class="tag est">Focus ${hm(m)}</span>` : '') +
      (!d
        ? `<button class="tag estpick" data-estpick="${n.id}">${effEst(n) ? 'Estimate ' + esc(estLabel(n)) : '+ Estimate'}</button>`
        : '');
  if (meta) h += `<div class="factsrow">${meta}</div>`;
  // The next step (the first to do, in order), or where it stands.
  const nx = !d && kids ? nextLeaf(n) : null;
  if (nx) h += `<p class="qnext"><small>Next</small><b>${esc(nx.text)}</b></p>`;
  else if (d) h += `<p class="qnext"><b>${kids ? 'Finished' : 'Done'}</b></p>`;
  else if (kids && needsNext(n))
    h += `<p class="qnext"><small>Next</small><b>Every step is ticked: what's next?</b></p>`;
  else if (kids && onlyWaiting(n))
    h += `<p class="qnext"><small>Next</small><b>Nothing until you hear back</b></p>`;
  // Where you left off (the task's; on a step's page, when it's this step or no step).
  if (q.resume && !isDone(q) && placeFits(q, n)) h += placeCard(q);
  // Its summary, under its name: where it's at, written by you (or drafted by Claude, on asking).
  if (top)
    h += `<label class="f" for="fsum">Summary and updates <small class="hint">(optional)</small></label><textarea class="fld fsum" id="fsum" data-field="summary" data-id="${n.id}" maxlength="${SUMMARY_MAX}" rows="4" placeholder="Where it's at, in a line or two">${esc(n.summary || '')}</textarea>${summaryBox(n)}`;
  // Its tag, folded to the one it has (tap to change).
  if (top)
    h += `<details id="tagd" class="tagd"${panels.tagd ? ' open' : ''}><summary>Tag: ${n.tag ? tagBadge(n.tag) : '<span class="hint">none</span>'}</summary>${tagPicker('q', n.id, n.tag)}</details>`;
  h += waitPanel(n, top);
  h += '</div>';
  // Every step ticked: what's next? (Add it below, or finish the task.)
  if (top && needsNext(n))
    h += `<div class="ask box nextask"><p><b>Every step is ticked.</b> What's next? Add it below, or finish the task.</p><div class="acts"><button class="btn green" data-finish="${n.id}">Finish task</button><button class="btn" data-unsure="${n.id}">Not sure yet</button></div></div>`;
  // What the work needs: articles, flows, web pages (see links.js). A step shares its task's.
  h += top ? renderLinks(n) + questWorkflows(n.id) : renderInheritedLinks(q);
  // The steps come first: they're what you work through. (A task has steps; a step doesn't.)
  if (top) {
    h += listHead('Steps', n.children);
    h += list(n.children, false, true);
    h += `<form class="addrow" id="sform" data-parent="${n.id}"><input id="sin" maxlength="120" placeholder="Add a step" aria-label="New step" autocomplete="off"><button class="btn">Add</button></form>`;
    h += suggestBox(n);
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
  h += `<div class="links"><button class="linkbtn" data-toinbox="${n.id}">Move to inbox</button><button class="dellink" data-del="${n.id}">Delete this task</button></div>`;
  h += '</details>';
  // Always to hand: the one thing to do next (see primaryAction), a tick for a step or a task
  // without steps, and the rest of its actions.
  const pa = primaryAction(n, parents);
  h += '<div class="qfoot acts">';
  // (the tick beside Focus; with another primary action it's in the actions, a tap away)
  if (!kids && !d && (!pa || pa.attrs.startsWith('data-zen')))
    h += `<button class="btn green" data-toggle="${n.id}">Mark done</button>`;
  h += actionBtn(pa);
  h += `<button class="btn qmore" data-qact="${n.id}" aria-label="More actions" aria-haspopup="dialog">${dots}</button></div>`;
  setHTML($('#v-today'), h);
}

/* Summarise (AI): the task's name, its steps (ticked, waiting and on whom) and its summary go
   to the suggest-steps Supabase function, which asks Claude for a short plain-English summary of
   what's been done. It's offered as a draft: the summary is yours unless you choose to use it. */
let sumAI = null; // { id, busy, text, error }
const SUMMARY_OK = 'dashboard-summary-ok'; // (this device was told what's sent, once)
function summaryBox(n) {
  if (!sb || !session) return '';
  const s = sumAI && sumAI.id === n.id ? sumAI : null;
  if (!s) return `<button class="linkbtn sumaibtn" data-sumai="${n.id}">Summarise (AI)</button>`;
  if (s.busy) return '<p class="hint sumbusy">Writing a summary…</p>';
  if (s.error)
    return `<div class="suggest sumdraft"><p class="hint">${esc(s.error)}</p><div class="acts"><button class="btn sm" data-sumclose="1">OK</button></div></div>`;
  return `<div class="suggest sumdraft"><p class="hint">Claude's summary:</p><p class="sumtext">${esc(s.text)}</p><div class="acts"><button class="btn sm green" data-sumuse="replace">${n.summary ? 'Replace mine' : 'Use this'}</button>${n.summary ? '<button class="btn sm" data-sumuse="add">Add to mine</button>' : ''}<button class="btn sm" data-sumclose="1">Cancel</button></div></div>`;
}
async function askSummary(id) {
  const r = find(id);
  if (!r || !sb || !session) return;
  let told = false;
  try {
    told = localStorage.getItem(SUMMARY_OK) === '1';
  } catch (e) {}
  if (!told)
    return sheet(
      {
        title: 'Summarise with AI',
        text: "This sends this task's name, its steps (which are ticked or waiting, and on whom) and its summary, and nothing else, to Anthropic's Claude to write a short summary. Only use it if your organisation allows this for work information.",
        ok: 'Continue',
      },
      () => {
        try {
          localStorage.setItem(SUMMARY_OK, '1');
        } catch (e) {}
        askSummary(id);
      },
    );
  sumAI = { id, busy: true };
  renderToday();
  let next;
  try {
    const { data, error } = await sb.functions.invoke('suggest-steps', {
      body: {
        mode: 'summary',
        quest: r.n.text,
        summary: r.n.summary || '',
        steps: r.n.children.map(c => ({
          text: c.text,
          done: isDone(c),
          waiting: !isDone(c) && c.wait ? c.wait.who || 'someone' : '',
        })),
      },
    });
    if (error || !data || typeof data.summary !== 'string') throw error || new Error('no summary');
    const text = cleanText(data.summary.trim()).slice(0, SUMMARY_MAX);
    next = text ? { id, text } : { id, error: 'Claude had nothing to add for this one.' };
  } catch (e) {
    next = {
      id,
      error: navigator.onLine
        ? "Couldn't get a summary. The suggest-steps function may need updating (see the README)."
        : 'A summary needs a connection.',
    };
  }
  if (!sumAI || sumAI.id !== id) return; // (closed, or another asked, meanwhile)
  sumAI = next;
  renderToday();
}
function useSummary(how) {
  const s = sumAI,
    r = s && find(s.id);
  sumAI = null;
  if (r && s.text) {
    const mine = r.n.summary || '';
    r.n.summary = (how === 'add' && mine ? mine + '\n' + s.text : s.text).slice(0, SUMMARY_MAX);
    save();
  }
  renderAll();
}

/* Suggest steps (AI): the task's name and its steps' names (nothing else) go to the
   suggest-steps Supabase function, which asks Claude for a few next steps. They're offered as a
   list to tick; only the ticked ones are added. Needs sync signed in (the function checks it). */
let suggest = null; // { id, busy, items: [{ text, on }], error }
const SUGGEST_OK = 'dashboard-suggest-ok'; // (this device was told what's sent, once)
function suggestBox(n) {
  if (!sb || !session) return '';
  const s = suggest && suggest.id === n.id ? suggest : null;
  if (!s) return `<button class="linkbtn suggestbtn" data-suggest="${n.id}">Suggest steps (AI)</button>`;
  if (s.busy) return '<p class="hint suggestbusy">Getting suggestions…</p>';
  let h = '<div class="suggest box">';
  if (s.error) h += `<p class="hint">${esc(s.error)}</p>`;
  else
    h +=
      '<p class="hint">Suggested steps: untick any you don\'t want.</p>' +
      s.items
        .map(
          (x, i) =>
            `<label class="optbox"><input type="checkbox" data-sugpick="${i}"${x.on ? ' checked' : ''}>${esc(x.text)}</label>`,
        )
        .join('');
  h += `<div class="acts">${s.error ? '' : `<button class="btn sm green" data-sugadd="${n.id}">Add ticked</button>`}<button class="btn sm" data-sugclose="1">${s.error ? 'OK' : 'Cancel'}</button></div></div>`;
  return h;
}
async function askSuggest(id) {
  const r = find(id);
  if (!r || !sb || !session) return;
  let told = false;
  try {
    told = localStorage.getItem(SUGGEST_OK) === '1';
  } catch (e) {}
  if (!told)
    return sheet(
      {
        title: 'Suggest steps with AI',
        text: "This sends this task's name and its steps' names, and nothing else, to Anthropic's Claude to suggest next steps. Only use it if your organisation allows this for work information.",
        ok: 'Continue',
      },
      () => {
        try {
          localStorage.setItem(SUGGEST_OK, '1');
        } catch (e) {}
        askSuggest(id);
      },
    );
  suggest = { id, busy: true, items: [] };
  renderToday();
  let next;
  try {
    const { data, error } = await sb.functions.invoke('suggest-steps', {
      body: { quest: r.n.text, steps: r.n.children.map(c => c.text) },
    });
    if (error || !data || !Array.isArray(data.steps)) throw error || new Error('no steps');
    const items = data.steps
      .map(t => ({ text: cleanText(String(t)).slice(0, 120), on: true }))
      .filter(x => x.text);
    next = { id, items, error: items.length ? '' : 'No new steps to suggest for this one.' };
  } catch (e) {
    next = {
      id,
      items: [],
      error: navigator.onLine
        ? "Couldn't get suggestions. The suggest-steps function may not be set up yet (see the README)."
        : 'Suggestions need a connection.',
    };
  }
  if (!suggest || suggest.id !== id) return; // (closed, or another asked, meanwhile)
  suggest = next;
  renderToday();
}
function addSuggested(id) {
  const r = find(id),
    s = suggest;
  suggest = null;
  if (!r || !s || s.id !== id) return renderToday();
  const picked = s.items.filter(x => x.on);
  if (!picked.length) return renderToday();
  const bf = snapshot();
  picked.forEach(x => r.n.children.push(fix({ id: uid(), text: x.text })));
  r.n.done = false;
  settle(bf);
  toast('Added ' + plural(picked.length, 'step'));
}
