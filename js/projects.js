/* projects: long-running work that groups top-level quests (n.project = project id). Progress
   counts finished top-level quests from the log (kept 120 days); focus time comes from S.pdaily. */
const projectOf = id => {
  const top = id && topOf(id);
  return top ? top.project || '' : '';
};
const projectName = id => {
  const p = S.projects.find(x => x.id === id);
  return p ? p.name : '';
};
const projectBadge = id => (projectName(id) ? `<span class="tag proj">${esc(projectName(id))}</span>` : '');
function addPDaily(d, p, mins) {
  if (!p) return;
  const o = (S.pdaily[d] = S.pdaily[d] || {});
  o[p] = (o[p] || 0) + mins;
}
// Project picker for a top-level quest ('q') or an inbox item ('i').
function projectPicker(kind, id, cur) {
  const opts = S.projects
    .filter(p => !p.done || p.id === cur)
    .map(p => `<option value="${p.id}"${p.id === cur ? ' selected' : ''}>${esc(p.name)}</option>`)
    .join('');
  return `<label class="f">Project</label><select class="fld" data-setproject="${id}" data-kind="${kind}"><option value="">No project</option>${opts}<option value="__new">+ New project…</option></select>`;
}
function newProject(name) {
  name = (name || '').trim().slice(0, 40);
  if (!name) return '';
  const p = S.projects.find(x => x.name.toLowerCase() === name.toLowerCase()) || {
    id: uid(),
    name,
    done: false,
  };
  if (!S.projects.includes(p)) S.projects.push(p);
  p.done = false;
  return p.id;
}
function setProject(kind, id, value) {
  const pid = value === '__new' ? newProject(prompt('New project name')) : value;
  if (value === '__new' && !pid) return renderAll();
  if (kind === 'q') {
    const r = find(id);
    if (!r) return;
    r.n.project = pid;
    const t = tplFor(r.n);
    if (t) t.project = pid;
  } else {
    const it = S.inbox.find(x => x.id === id);
    if (!it) return;
    it.project = pid;
    if (it.node) it.node.project = pid;
  }
  save();
  renderAll();
}
// Every place a project can be assigned, open or waiting.
function openInProject(pid) {
  const out = [];
  S.quests.forEach(n => n.project === pid && !isDone(n) && out.push({ n, where: 'today' }));
  S.later.forEach(n => n.project === pid && out.push({ n, where: 'later' }));
  S.inbox.forEach(
    i => (i.project || (i.node && i.node.project)) === pid && out.push({ n: i, where: 'inbox' }),
  );
  return out;
}
/* the Projects tab: set up projects, see where each stands, and add quests to them */
function renderProjectsView() {
  const el = $('#v-projects');
  el.querySelectorAll('details[id]').forEach(d => (panels[d.id] = d.open));
  const loose = S.quests.filter(q => !q.project && !isDone(q));
  const card = p => {
    const i = S.projects.indexOf(p),
      done = S.log.filter(x => x.p === p.id && !x.trail.length).length,
      open = openInProject(p.id),
      total = done + open.length,
      pct = total ? Math.round((done / total) * 100) : 0;
    let mins = 0;
    for (const d in S.pdaily) mins += S.pdaily[d][p.id] || 0;
    let h = `<div class="projcard box"><div class="projhead"><b>${esc(p.name)}</b><small>${done} done · ${open.length} open${mins ? ' · ' + hm(mins) : ''}</small></div><div class="prog"><div style="width:${pct}%"></div></div>`;
    if (open.length) {
      h += '<ul>';
      open.forEach(({ n, where }) => {
        const label =
          where === 'later'
            ? ` <small>${dayLabel(n.start)}</small>`
            : where === 'inbox'
              ? ' <small>inbox</small>'
              : '';
        h +=
          where === 'today'
            ? `<li><button class="linkbtn" data-open="${n.id}">${esc(n.text)}</button>${n.wait ? ' <small>waiting</small>' : ''}</li>`
            : `<li>${esc(n.text)}${label}</li>`;
      });
      h += '</ul>';
    }
    if (!p.done) {
      h += `<form class="addrow" data-projadd="${p.id}"><input id="pa-${p.id}" data-keep maxlength="120" placeholder="Add a quest" aria-label="New quest for ${esc(p.name)}" autocomplete="off"><button class="btn sm">Add</button></form>`;
      if (loose.length)
        h += `<select class="fld" data-projpick="${p.id}" aria-label="Add a quest from Today to ${esc(p.name)}"><option value="">Add a quest from Today…</option>${loose.map(q => `<option value="${q.id}">${esc(q.text)}</option>`).join('')}</select>`;
    }
    return (
      h +
      `<div class="links"><button class="linkbtn" data-projdone="${p.id}">${p.done ? 'Reopen project' : 'Finish project'}</button></div>
      <details id="projm-${p.id}"${panels['projm-' + p.id] ? ' open' : ''}><summary>Rename or delete</summary><div class="tagrow"><input class="fld" data-projname="${i}" value="${esc(p.name)}" maxlength="40" aria-label="Project name"><button class="x" data-delproj="${i}" aria-label="Delete project ${esc(p.name)}">×</button></div></details></div>`
    );
  };
  const active = S.projects.filter(p => !p.done),
    finished = S.projects.filter(p => p.done);
  let h =
    '<h2>Projects</h2><form class="addrow" id="projform"><input id="projin" maxlength="40" placeholder="New project" aria-label="New project" autocomplete="off"><button class="btn">Add</button></form>';
  if (!S.projects.length) h += '<div class="empty">No projects yet.</div>';
  h += active.map(card).join('');
  if (finished.length)
    h += `<details id="projfin" style="margin:0 0 22px"${panels.projfin ? ' open' : ''}><summary>Finished projects (${finished.length})</summary>${finished.map(card).join('')}</details>`;
  setHTML(el, h);
}
// A new quest on Today, straight into a project.
function addToProject(pid, text) {
  const bf = snapshot();
  S.quests.push(fix({ id: uid(), text, project: pid }));
  settle(bf);
  toast('Added to Today');
}
