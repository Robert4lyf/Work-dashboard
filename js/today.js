/* today / drill-down */
let path = [],
  reorder = false,
  pending = null;
const panels = {}; // which <details> panels are expanded, so re-renders keep them open
const tick =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const chevron =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>';
const dots =
  '<svg viewBox="0 0 24 6" aria-hidden="true"><circle cx="3" cy="3" r="2.4" fill="currentColor"/><circle cx="12" cy="3" r="2.4" fill="currentColor"/><circle cx="21" cy="3" r="2.4" fill="currentColor"/></svg>';
// A row's ⋯: its quick actions, in a sheet (see actions.js).
const moreBtn = n =>
  `<button class="qmore" data-qact="${n.id}" aria-label="Actions: ${esc(n.text)}" aria-haspopup="dialog">${dots}</button>`;
function dueTag(n) {
  if (!n.due || isDone(n)) return '';
  const t = today(),
    cls = n.due < t ? 'late' : n.due === t ? 'now' : 'due';
  return `<span class="tag ${cls}">${n.due < t ? 'Overdue' : n.due === t ? 'Due today' : 'Due ' + niceDate(n.due)}</span>`;
}
// A task's own deadline aside, a step overdue or due today says so on the task's card.
function stepDueTag(n) {
  if (isDone(n) || (n.due && n.due <= today())) return '';
  const t = today(),
    ds = n.children.filter(c => !isDone(c) && c.due && c.due <= t).map(c => c.due);
  if (!ds.length) return '';
  return ds.some(d => d < t)
    ? '<span class="tag late">Step overdue</span>'
    : '<span class="tag now">Step due today</span>';
}
// A step's row on its task's page: its tick, its name (which opens the step's own page) and its
// ⋯, or the move buttons while reordering. (A step has no steps of its own: see flatSteps.)
function row(n, i, len, sib) {
  const d = isDone(n),
    meta =
      tagBadge(n.tag) + waitBadge(n) + (n.opt ? '<span class="tag opt">Optional</span>' : '') + dueTag(n);
  const right = reorder
    ? `${d ? '' : `<button class="mv" data-top="${n.id}" aria-label="Move to top: ${esc(n.text)}" ${i === 0 ? 'disabled' : ''}>Top</button>`}<button class="mv" data-up="${n.id}" aria-label="Move up: ${esc(n.text)}" ${i === 0 || (d && !isDone(sib[i - 1])) ? 'disabled' : ''}>&#9650;</button><button class="mv" data-down="${n.id}" aria-label="Move down: ${esc(n.text)}" ${i === len - 1 || (!d && isDone(sib[i + 1])) ? 'disabled' : ''}>&#9660;</button>`
    : moreBtn(n);
  return withHash(
    `<div class="row${d ? ' done' : n.wait ? ' waiting' : ''}" data-qid="${n.id}"${dragAttr('q:' + n.id)}><button class="check" data-toggle="${n.id}" aria-pressed="${d}" aria-label="Mark done: ${esc(n.text)}">${tick}</button><button class="open" data-open="${n.id}"><span>${esc(n.text)}</span>${meta ? '<small>' + meta + '</small>' : ''}</button>${right}</div>`,
  );
}
// A section title, with the Reorder switch beside it when the list has something to reorder.
function listHead(title, ns) {
  return `<div class="sechead"><h2>${title}</h2>${ns.length > 1 ? `<button class="linkbtn" id="reorder">${reorder ? 'Done' : 'Reorder'}</button>` : ''}</div>`;
}
// A task's steps, a row each, in the order they're done in; finished ones go last (not while
// reordering: that shows the order as it is).
const listRank = n => (isDone(n) ? 2 : 0);
function list(ns) {
  const shown = reorder ? ns : [...ns].sort((a, b) => listRank(a) - listRank(b));
  return shown.length
    ? `<div class="list box">${shown.map((c, i) => row(c, i, ns.length, ns)).join('')}</div>`
    : '';
}
// Up, down or to the top among its siblings.
function moveAmong(id, how) {
  const r = find(id);
  if (!r) return false;
  const arr = r.arr,
    k = arr.indexOf(r.n),
    to = how === 'top' ? arr[0] : how === 'up' ? arr[k - 1] : arr[k + 1];
  if (!to || to === r.n) return false;
  arr.splice(arr.indexOf(r.n), 1);
  arr.splice(arr.indexOf(to) + (how === 'down' ? 1 : 0), 0, r.n);
  return true;
}
function renderToday() {
  // (a wide window, the board beside this page: a change made on the board draws the page as a
  // change from elsewhere is drawn, so a step half typed here isn't lost to a tick over there)
  if (splitBeside()) inBackground(drawToday);
  else drawToday();
  syncSplit(); // (the task whose page this was may have gone: see desk.js)
  splitBoard(); // (a wide window: the board beside a project's page, see desk.js)
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
  // (a task gone from under its page: where it was opened from no longer applies)
  if (ok.length < path.length && typeof returnTo !== 'undefined') returnTo = null;
  path = ok;
  if (path.length) return renderNode(find(path[path.length - 1]));
  // No task's page: the Upcoming page, or back to Projects (a task gone from under its page).
  if (projectUtility === 'upcoming')
    setHTML(
      $('#v-today'),
      `<div class="crumbs"><button data-goto="projects">&lsaquo; Projects</button></div>${renderUpcoming()}`,
    );
  else if (view === 'today') go('projects');
}
// Flows (Power Automate Desktop) as a strip of chips, for Knowledge's Processes.
function quickActions() {
  if (!S.flows.length) return '';
  const flows = [...S.flows].sort((a, b) => byName(a.name, b.name));
  return `<div class="flows chips">${flows.map(f => `<a class="chip" href="${esc(f.url)}" data-flow="${f.id}" title="${f.last ? 'Last used ' + esc(whenLabel(f.last)) : 'Not used yet'}">&#9654; ${esc(f.name)}${flowStatus(f)}</a>`).join('')}</div>`;
}
// (a summary just written in a one-line box: three lines once left, so none of it is cut off)
document.addEventListener('focusout', e => {
  if (e.target.id === 'fsum' && e.target.value.trim()) e.target.rows = 3;
});
/* carried over: tasks on Projects for STALE days or more get a decision in the weekly review */
const STALE = 3;
const ageOf = n => (n.since ? daysBetween(n.since, today()) : 0);
// (Not one only waiting on others: every step left is waiting.)
const onlyWaiting = q => q.children.length > 0 && !isDone(q) && !nextLeaf(q) && !needsNext(q);
// (nor a scheduled one: it's waiting for its day, not being put off)
const carried = () =>
  S.quests.filter(
    q => !isDone(q) && !q.wait && !q.scheduled && !onlyWaiting(q) && ageOf(q) >= STALE && q.kept !== today(),
  );
// A carried-over task with its decisions.
function carriedRows(qs) {
  const b = (attrs, label) => `<button class="chip" ${attrs}>${label}</button>`;
  return qs
    .map(
      q =>
        `<div class="crow"><p>${esc(q.text)} <small>${ageOf(q)} days</small></p><div class="chips">${b(`data-keep="${q.id}"`, 'Keep')}${b(`data-sched="${q.id}" data-kind="q" data-when="${shift(today(), 1)}"`, 'Tomorrow')}${b(`data-sched="${q.id}" data-kind="q" data-when="${nextMonday()}"`, 'Next week')}${b(`data-toinbox="${q.id}"`, 'Inbox')}${b(`data-drop="${q.id}" aria-label="Delete: ${esc(q.text)}"`, 'Delete')}</div></div>`,
    )
    .join('');
}

/* upcoming: top-level tasks scheduled for a later day (S.later, each with a start date) */
const nextMonday = () => shift(today(), (8 - new Date().getDay()) % 7 || 7);
// `dateOnly`: on a task's page, where tomorrow and next week are in its actions (its ⋯).
function laterPicker(kind, id, dateOnly) {
  const b = (when, label) =>
    `<button class="chip" data-sched="${id}" data-kind="${kind}" data-when="${when}">${label}</button>`;
  return `<div class="later"><span>${dateOnly ? 'Do later, from:' : 'Do later:'}</span>${dateOnly ? '' : b(shift(today(), 1), 'Tomorrow') + b(nextMonday(), 'Next Mon')}<input type="date" class="fld" data-schedpick="${id}" data-kind="${kind}" min="${shift(today(), 1)}" aria-label="Do on a later date"></div>`;
}
function renderUpcoming() {
  if (!S.later.length) return '';
  let h = `<details id="upd"${panels.upd ? ' open' : ''}><summary>Upcoming (${S.later.length})</summary>`;
  S.later.forEach(n => {
    const c = count(n);
    h += `<div class="uprow" data-upid="${n.id}"><div class="uptxt">${esc(n.text)} ${tagBadge(n.tag)}${c ? `<span class="tag opt">${c} step${c === 1 ? '' : 's'}</span>` : ''}${n.scheduled ? ` <button class="linkbtn" data-schedset="${n.id}">Scheduled ${esc(schedWhen(n))}</button>` : ''}</div>
      <input type="date" class="fld" data-restart="${n.id}" value="${n.start}" min="${shift(today(), 1)}" aria-label="Start date for ${esc(n.text)}">
      <button class="btn" data-now="${n.id}">Start now</button><button class="x" data-dellater="${n.id}" aria-label="Delete ${esc(n.text)}">×</button></div>`;
  });
  return h + '</details>';
}
// Move a top-level task ('q') or inbox item ('i') to Upcoming.
function schedule(kind, id, date) {
  if (!date || date <= today()) return;
  // (Release G: with Undo)
  withUndo('On Upcoming until ' + dayLabel(date), () => scheduleNow(kind, id, date));
}
function scheduleNow(kind, id, date) {
  let n;
  if (kind === 'q') {
    const r = find(id);
    if (!r || r.parents.length) return;
    r.arr.splice(r.arr.indexOf(r.n), 1);
    n = r.n;
    // (its own page closes; another project's, open beside the board it was put off from, stays)
    if (path[0] === id) path = [];
  } else {
    const i = S.inbox.findIndex(x => x.id === id);
    if (i < 0) return;
    const it = S.inbox.splice(i, 1)[0];
    n = inboxToNode(it);
  }
  n.start = date;
  if (n.scheduled) n.scheduled.date = date; // (a scheduled one put off moves its day with it)
  delete n.since;
  delete n.kept;
  S.later.push(n);
  S.later.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  save();
  renderAll();
}
function renderNode({ n, parents }) {
  const d = isDone(n),
    kids = n.children.length,
    top = !parents.length,
    q = parents[0] || n; // (the quest: a step's page shares its resources and saved place)
  // (opened from another view: the way back names it)
  const from =
    typeof atReturn === 'function' && atReturn() ? returnTo.name || RETURN_NAME[returnTo.view] : 'Projects';
  let h = `<div class="crumbs" role="navigation" aria-label="Breadcrumb"><button data-crumb="-1">&lsaquo; ${from}</button>`;
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
      (isScheduled(n) && top
        ? `<button class="tag sched schedpick" data-schedset="${n.id}" aria-label="Scheduled ${esc(schedWhen(n))}: change">Scheduled ${esc(schedWhen(n))}</button>`
        : '') +
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
  // The project summary is written by the user.
  if (top)
    h += `<label class="f" for="fsum">Summary <small class="hint">(optional)</small></label><textarea class="fld fsum" id="fsum" data-field="summary" data-id="${n.id}" maxlength="${SUMMARY_MAX}" rows="${n.summary ? 3 : 1}" placeholder="Where it's at, in a line or two">${esc(n.summary || '')}</textarea>`;
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
    h += list(n.children);
    h += `<form class="addrow" id="sform" data-parent="${n.id}"><input id="sin" maxlength="120" placeholder="Add a step" aria-label="New step" autocomplete="off"><button class="btn">Add</button></form>`;
  }
  if (top)
    h += `<button class="linkbtn project-detail-history" aria-haspopup="dialog" data-project-history="${n.id}">History</button>`;
  // Everything else, folded away.
  // (renaming, moving to the Inbox and deleting are in its actions, the ⋯ at the foot)
  h += `<details id="mored" class="more"${panels.mored ? ' open' : ''}><summary>More: notes, deadline${top ? ', do later, repeat' : ''}</summary>`;
  if (top) h += laterPicker('q', n.id, true);
  h += `<details id="fdet"${(panels.fdet ?? !!n.notes) ? ' open' : ''}><summary>Notes and deadline</summary>
    ${projectEditorFields(n, ['', 'fdue', 'fnotes'])}
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
