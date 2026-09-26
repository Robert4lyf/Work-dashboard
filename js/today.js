/* today / drill-down */
let path = [],
  reorder = false,
  pending = null;
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
    left = `<button class="meter" data-open="${n.id}" aria-label="${p}% complete" style="background:linear-gradient(to top,var(--green) ${p}%,var(--bg) ${p}%)">${set.filter(isDone).length}/${set.length}</button>`;
  } else {
    left = `<button class="check" data-toggle="${n.id}" aria-pressed="${d}" aria-label="Mark done: ${esc(n.text)}">${tick}</button>`;
  }
  const nx = kids && !d ? nextLeaf(n) : null;
  const rt = tplFor(n);
  const meta =
    tagBadge(n.tag) +
    waitBadge(n) +
    projectBadge(n.project) +
    (n.opt ? '<span class="tag opt">Optional</span>' : '') +
    (repeats(rt) ? `<span class="tag rep">Repeats ${esc(repLabel(rt))}</span>` : '') +
    dueTag(n) +
    (!d && ageOf(n) >= STALE ? `<span class="tag old">${ageOf(n)} days</span>` : '') +
    (nx ? 'Next: ' + esc(nx.text) : '');
  const right = reorder
    ? `${d ? '' : `<button class="mv" data-top="${n.id}" aria-label="Move to top" ${i === 0 ? 'disabled' : ''}>Top</button>`}<button class="mv" data-up="${n.id}" aria-label="Move up" ${i === 0 || (d && !isDone(sib[i - 1])) ? 'disabled' : ''}>&#9650;</button><button class="mv" data-down="${n.id}" aria-label="Move down" ${i === len - 1 || (!d && isDone(sib[i + 1])) ? 'disabled' : ''}>&#9660;</button>`
    : `<button class="x" data-del="${n.id}" aria-label="Delete ${esc(n.text)}">×</button>`;
  return `<div class="row${d ? ' done' : ''}"${dragAttr('q:' + n.id)}>${left}<button class="open" data-open="${n.id}"><span>${esc(n.text)}</span>${meta ? '<small>' + meta + '</small>' : ''}</button>${right}</div>`;
}
// A section title, with the Reorder switch beside it when the list has something to reorder.
function listHead(title, ns) {
  return `<div class="sechead"><h2>${title}</h2>${ns.length > 1 ? `<button class="linkbtn" id="reorder">${reorder ? 'Done' : 'Reorder'}</button>` : ''}</div>`;
}
// One card, one row per quest.
function list(ns) {
  return ns.length
    ? `<div class="list box">${ns.map((c, i) => row(c, i, ns.length, ns)).join('')}</div>`
    : '';
}
function renderToday() {
  $('#v-today')
    .querySelectorAll('details[id]')
    .forEach(d => (panels[d.id] = d.open));
  path = path.filter((id, i) => {
    const r = find(id);
    return r && (i === 0 ? S.quests.includes(r.n) : find(path[i - 1]).n.children.includes(r.n));
  });
  if (path.length) return renderNode(find(path[path.length - 1]));
  const qs = S.quests;
  let h = renderMeetings() + renderCarried();
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
  if (qs.length && qs.every(isDone))
    h += '<div class="clear"><b>Stage clear!</b>Everything on today\'s list is done.</div>';
  h += list(qs);
  const own = S.templates.filter(t => !t.auto);
  if (own.length) {
    h += '<div class="tpls"><span class="hint" style="margin:0">From a template:</span>';
    own.forEach(
      t =>
        (h += `<span class="tchip"><button data-tpl="${t.id}">${esc(t.text)} (${count(t)})</button><button class="tdel" data-deltpl="${t.id}" aria-label="Delete template ${esc(t.text)}">×</button></span>`),
    );
    h += '</div>';
  }
  if (S.templates.length) {
    h += `<details id="repd" style="margin:-4px 0 18px"${panels.repd ? ' open' : ''}><summary>Repeating quests</summary>`;
    S.templates.forEach(t => {
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
  h += renderUpcoming();
  setHTML($('#v-today'), h);
}

/* carried over: quests on Today for STALE days or more get a decision each morning */
const STALE = 3;
const ageOf = n => (n.since ? daysBetween(n.since, today()) : 0);
const carried = () => S.quests.filter(q => !isDone(q) && !q.wait && ageOf(q) >= STALE && q.kept !== today());
function renderCarried() {
  const qs = carried();
  if (!qs.length) return '';
  let h = '<div class="carried box"><h2>Carried over</h2>';
  qs.forEach(q => {
    const b = (attrs, label) => `<button class="chip" ${attrs}>${label}</button>`;
    h += `<div class="crow"><p>${esc(q.text)} <small>${ageOf(q)} days</small></p><div class="chips">${b(`data-keep="${q.id}"`, 'Keep')}${b(`data-sched="${q.id}" data-kind="q" data-when="${shift(today(), 1)}"`, 'Tomorrow')}${b(`data-sched="${q.id}" data-kind="q" data-when="${nextMonday()}"`, 'Next week')}${b(`data-toinbox="${q.id}"`, 'Inbox')}${b(`data-drop="${q.id}"`, 'Drop')}</div></div>`;
  });
  return h + '</div>';
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
    h += `<div class="uprow"><div class="uptxt">${esc(n.text)} ${tagBadge(n.tag)}${projectBadge(n.project)}${c ? `<span class="tag opt">${c} subquest${c === 1 ? '' : 's'}</span>` : ''}</div>
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
  h += `</div><div class="node box"><h1>${esc(n.text)}</h1>${leftNote(n)}${top ? tagPicker('q', n.id, n.tag) + projectPicker('q', n.id, n.project) : ''}`;
  if (kids) {
    const req = n.children.filter(c => !c.opt),
      set = req.length ? req : n.children,
      p = Math.round(frac(n) * 100),
      opt = n.children.length - req.length;
    h += `<div>${set.filter(isDone).length} / ${set.length} complete (${p}%)${req.length && opt ? ' + ' + opt + ' optional' : ''}</div><div class="prog"><div style="width:${p}%"></div></div>`;
  }
  const m = spent(n),
    meta =
      (n.opt ? '<span class="tag opt">Optional</span>' : '') + dueTag(n) + (m ? 'Focus time: ' + hm(m) : '');
  if (meta) h += `<div style="margin-top:8px">${meta}</div>`;
  h += '<div class="acts">';
  if (!kids)
    h += `<button class="btn ${d ? '' : 'green'}" data-toggle="${n.id}">${d ? 'Mark not done' : 'Mark done'}</button>`;
  h += `${d ? '' : `<button class="btn blue" data-focuson="${n.id}">Focus on this</button>`}</div>`;
  h += `<div class="links"><button class="linkbtn" data-savetpl="${n.id}">Save as template</button><button class="linkbtn" data-toinbox="${n.id}">Move to inbox</button><button class="dellink" data-del="${n.id}">Delete this quest</button></div>`;
  h += `<details${n.notes ? ' open' : ''}><summary>Notes and deadline</summary>
    <label class="f" for="fname">Name</label><input class="fld" id="fname" data-field="text" data-id="${n.id}" value="${esc(n.text)}" maxlength="120">
    <label class="f" for="fdue">Deadline</label><input class="fld" type="date" id="fdue" data-field="due" data-id="${n.id}" value="${n.due}">
    <label class="f" for="fnotes">Notes</label><textarea class="fld" id="fnotes" data-field="notes" data-id="${n.id}">${esc(n.notes)}</textarea>
    ${top ? '' : `<label class="optbox"><input type="checkbox" data-field="opt" data-id="${n.id}" ${n.opt ? 'checked' : ''}>Optional</label>`}
    </details>`;
  h += waitPanel(n);
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
    h += laterPicker('q', n.id);
  }
  h += '</div>';
  h += listHead('Subquests', n.children);
  h += list(n.children);
  h += `<form class="addrow" id="sform" data-parent="${n.id}"><input id="sin" maxlength="120" placeholder="Add a subquest" aria-label="New subquest" autocomplete="off"><button class="btn">Add</button></form>
    <label class="optbox" style="margin-top:-4px"><input type="checkbox" id="sopt">Add as optional</label>`;
  setHTML($('#v-today'), h);
}
