// The home screen calls each top-level task a project. The old project metadata is
// still used for history and sync, independently of this view.
let projectStepFor = '',
  projectsDoneOpen = false;
const PROJECT_STEP_LIMIT = 3;
const openProjectHistory = new Set();
const projectUpdateDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

function projectCheck(n, label) {
  const done = isDone(n);
  return `<button class="check${done ? ' project-checked' : ''}" type="button" data-toggle="${n.id}" aria-pressed="${done}" aria-label="${label}: ${esc(n.text)}">${tick}</button>`;
}

function projectHistory(q, updates, open) {
  return `<section class="project-history" id="project-history-${q.id}" aria-label="Project history"${open ? '' : ' hidden'}>
    ${withHash(`<form class="project-update" data-project-update="${q.id}">
      <textarea class="fld" id="project-update-${q.id}" maxlength="${PROJECT_UPDATE_MAX}" rows="2" placeholder="Write an update" aria-label="New project update" required></textarea>
      <button class="btn sm">Add update</button>
    </form>`)}
    ${
      open && updates?.length
        ? `<ol class="project-updates">${updates
            .map(
              u =>
                `<li id="project-entry-${u.id}"><time datetime="${new Date(u.t).toISOString()}">${projectUpdateDate.format(u.t)}</time><p>${esc(u.text)}</p></li>`,
            )
            .join('')}</ol>`
        : ''
    }
  </section>`;
}

function projectCard(q, updates, canReorder) {
  const done = isDone(q),
    upcoming = !!q.start,
    scheduled = isScheduled(q),
    waiting = taskState(q) === 'waiting',
    mayTick = !upcoming && !q.wait && (!scheduled || ['today', 'passed', 'past'].includes(schedStatus(q).k)),
    kids = q.children,
    finished = kids.filter(isDone),
    open = kids.filter(c => !isDone(c)),
    preview = [...open, ...finished].slice(0, PROJECT_STEP_LIMIT),
    status = upcoming && !scheduled ? `Starts ${esc(niceDate(q.start))}` : '',
    meta = [
      status,
      schedTag(q),
      waiting || q.wait ? 'Waiting' : '',
      kids.length ? `${finished.length} of ${kids.length} steps` : '',
      dueTag(q) || stepDueTag(q),
    ].filter(Boolean),
    detail = `${upcoming ? 'data-goupd' : 'data-open'}="${q.id}"`;
  const steps = preview
    .map(n => {
      const checked = isDone(n);
      return `<li class="project-step${checked ? ' project-step-done' : ''}" data-qid="${n.id}">
      ${!n.children.length && mayTick && (!n.wait || checked) ? projectCheck(n, checked ? 'Mark not done' : 'Mark done') : '<span class="project-step-dot" aria-hidden="true"></span>'}
      <span>${esc(n.text)}${n.wait && !checked ? '<small>Waiting</small>' : ''}</span>
    </li>`;
    })
    .join('');
  const remaining = kids.length - preview.length;
  const historyOpen = openProjectHistory.has(q.id);
  return `<article class="project-card" data-qid="${q.id}" aria-labelledby="project-title-${q.id}">
    <div class="project-preview">
      <div class="project-card-heading">
        ${!kids.length && mayTick ? projectCheck(q, done ? 'Mark not done' : 'Mark done') : ''}
        <h2 id="project-title-${q.id}"><button class="project-open" ${detail}><span>${esc(q.text)}</span>${chevron}</button></h2>
        ${canReorder ? `<button class="project-grip" type="button" data-project-reorder="${q.id}" aria-haspopup="dialog" aria-label="Reorder ${esc(q.text)}" title="Drag to reorder or open move options"><svg viewBox="0 0 16 20" aria-hidden="true" fill="currentColor"><circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/><circle cx="5" cy="10" r="1.5"/><circle cx="11" cy="10" r="1.5"/><circle cx="5" cy="16" r="1.5"/><circle cx="11" cy="16" r="1.5"/></svg></button>` : ''}
      </div>
      ${meta.length ? `<div class="project-meta">${meta.map(item => `<span>${item}</span>`).join('')}</div>` : ''}
      ${steps ? `<ul class="project-steps">${steps}</ul>` : ''}
      ${projectHistory(q, updates, historyOpen)}
    </div>
    <div class="project-actions">
      <button class="linkbtn" data-project-add="${q.id}" aria-expanded="${projectStepFor === q.id}" aria-label="Add step to ${esc(q.text)}">+ Add step</button>
      ${!upcoming && remaining ? `<button class="linkbtn" ${detail} aria-label="Show all steps for ${esc(q.text)}">${remaining} more ${remaining === 1 ? 'step' : 'steps'}</button>` : ''}
      <button class="linkbtn" data-project-history="${q.id}" aria-controls="project-history-${q.id}" aria-expanded="${historyOpen}" aria-label="History for ${esc(q.text)}">History</button>
    </div>
    ${
      projectStepFor === q.id
        ? withHash(`<form class="addrow project-add" data-project-step="${q.id}">
      <input id="project-step-${q.id}" maxlength="120" placeholder="New step" aria-label="New step" autocomplete="off" required>
      <button class="btn">Add</button>
    </form>`)
        : ''
    }
  </article>`;
}

function renderProjects() {
  const el = $('#v-projects'),
    donePanel = $('#projects-done');
  if (donePanel) projectsDoneOpen = donePanel.open;
  const active = S.quests.filter(q => !isDone(q)),
    done = S.quests.filter(isDone),
    known = [...S.quests, ...S.later];
  if (!known.some(q => q.id === projectStepFor)) projectStepFor = '';
  const updatesByProject = new Map();
  for (const entry of S.projectUpdates) {
    if (!openProjectHistory.has(entry.q)) continue;
    if (!updatesByProject.has(entry.q)) updatesByProject.set(entry.q, []);
    updatesByProject.get(entry.q).push(entry);
  }
  for (const list of updatesByProject.values()) list.sort((a, b) => b.t - a.t || byName(b.id, a.id));
  const grid = (qs, canReorder = false) =>
    `<div class="project-grid"${canReorder ? ' id="active-project-grid"' : ''}>${qs.map(q => projectCard(q, updatesByProject.get(q.id), canReorder)).join('')}</div>`;
  setHTML(
    el,
    `
    ${active.length ? grid(active, active.length > 1) : `<div class="slot">${done.length ? 'Every current project is done.' : 'No current projects.'} <button class="linkbtn" data-goto="inbox">Capture a project in the Inbox</button></div>`}
    ${S.later.length ? `<section class="project-group" aria-labelledby="projects-upcoming"><h2 id="projects-upcoming">Upcoming</h2>${grid(S.later)}</section>` : ''}
    ${done.length ? `<details class="project-group" id="projects-done"${projectsDoneOpen ? ' open' : ''}><summary>Completed today <small>${done.length}</small></summary>${grid(done)}</details>` : ''}
  `,
  );
}

function projectClick(d) {
  if (d.projectReorder) {
    const active = S.quests.filter(q => !isDone(q));
    const at = active.findIndex(q => q.id === d.projectReorder);
    if (at < 0 || active.length < 2) return;
    const actions = [];
    if (at > 0)
      actions.push({
        label: 'Move earlier',
        attrs: `data-project-move="${d.projectReorder}" data-direction="-1"`,
      });
    if (at + 1 < active.length)
      actions.push({
        label: 'Move later',
        attrs: `data-project-move="${d.projectReorder}" data-direction="1"`,
      });
    actionSheet(active[at].text, actions, 'You can also drag the handle to reorder.');
    return;
  }
  if (d.projectMove) {
    const active = S.quests.filter(q => !isDone(q));
    const at = active.findIndex(q => q.id === d.projectMove);
    closeSheet();
    if (at >= 0) moveProject(d.projectMove, active[at + Number(d.direction)]?.id);
    return;
  }
  if (d.projectHistory) {
    const id = d.projectHistory;
    if (!openProjectHistory.delete(id)) openProjectHistory.add(id);
    renderProjects();
    const history = document.getElementById('project-history-' + id);
    if (history) {
      const preview = history.parentElement;
      preview.scrollTop = history.hidden
        ? 0
        : preview.scrollTop + history.getBoundingClientRect().top - preview.getBoundingClientRect().top;
    }
    return;
  }
  if (!d.projectAdd) return;
  projectStepFor = projectStepFor === d.projectAdd ? '' : d.projectAdd;
  renderProjects();
  if (projectStepFor) document.getElementById('project-step-' + projectStepFor).focus();
}

function moveProject(id, targetId) {
  const from = S.quests.findIndex(q => q.id === id && !isDone(q));
  const to = S.quests.findIndex(q => q.id === targetId && !isDone(q));
  if (from < 0 || to < 0 || from === to) return;
  const [project] = S.quests.splice(from, 1);
  S.quests.splice(to, 0, project);
  save();
  renderAll();
  toast(`Moved to position ${S.quests.slice(0, to + 1).filter(q => !isDone(q)).length}`);
}

const projectView = $('#v-projects');
let projectDrag = null;
projectView.addEventListener('pointerdown', e => {
  const handle = e.target.closest('[data-project-reorder]');
  if (!handle || !e.isPrimary || e.button !== 0 || projectDrag) return;
  projectDrag = {
    id: handle.dataset.projectReorder,
    pointer: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    moving: false,
    frame: 0,
    source: handle.closest('.project-card'),
    target: null,
  };
});
document.addEventListener('pointermove', e => {
  if (projectDrag?.pointer !== e.pointerId) return;
  if (!projectDrag.moving) {
    if (Math.hypot(e.clientX - projectDrag.x, e.clientY - projectDrag.y) < 8) return;
    projectView.setPointerCapture(e.pointerId);
    projectDrag.moving = true;
    projectDrag.source.classList.add('project-dragging');
    projectDrag.frame = requestAnimationFrame(scrollProjectDrag);
  }
  projectDrag.x = e.clientX;
  projectDrag.y = e.clientY;
  markProjectDrop();
});

function markProjectDrop() {
  const drag = projectDrag;
  const target = document.elementFromPoint(drag.x, drag.y)?.closest('#active-project-grid > .project-card');
  drag.target?.classList.remove('project-drop-target');
  drag.target = target && target.dataset.qid !== drag.id ? target : null;
  drag.target?.classList.add('project-drop-target');
}

function scrollProjectDrag() {
  const drag = projectDrag;
  const edge = 90;
  const y = drag.y;
  if (y < edge || y > innerHeight - edge) {
    window.scrollBy(0, y < edge ? -10 : 10);
    markProjectDrop();
  }
  drag.frame = requestAnimationFrame(scrollProjectDrag);
}

function cancelProjectDrag() {
  const drag = projectDrag;
  if (!drag) return;
  projectDrag = null;
  cancelAnimationFrame(drag.frame);
  drag.source.classList.remove('project-dragging');
  drag.target?.classList.remove('project-drop-target');
  if (projectView.hasPointerCapture(drag.pointer)) projectView.releasePointerCapture(drag.pointer);
}

document.addEventListener('pointerup', e => {
  if (projectDrag?.pointer !== e.pointerId) return;
  const { id, moving } = projectDrag;
  projectDrag.x = e.clientX;
  projectDrag.y = e.clientY;
  if (moving) markProjectDrop();
  const targetId = projectDrag.target?.dataset.qid;
  cancelProjectDrag();
  if (targetId) moveProject(id, targetId);
});
document.addEventListener('pointercancel', e => {
  if (projectDrag?.pointer === e.pointerId) cancelProjectDrag();
});
projectView.addEventListener('lostpointercapture', e => {
  // On touch, transferring implicit capture from the handle to the view also fires this event.
  if (e.target === projectView && projectDrag?.pointer === e.pointerId) cancelProjectDrag();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !projectDrag?.moving) return;
  e.stopImmediatePropagation();
  cancelProjectDrag();
});
window.addEventListener('blur', cancelProjectDrag);

function addProjectUpdate(form) {
  const q = form.dataset.projectUpdate;
  if (!S.quests.some(n => n.id === q) && !S.later.some(n => n.id === q)) return;
  const input = form.querySelector('textarea');
  const text = cleanText(input.value.slice(0, PROJECT_UPDATE_MAX)).trim();
  if (!text) return;
  S.projectUpdates.push({ id: uid(), q, t: Date.now(), text });
  input.value = '';
  save();
  renderProjects();
  toast('Update added');
}

const projectOf = id => {
  const top = id && topOf(id);
  return top ? top.project || '' : '';
};
function addPDaily(d, p, mins) {
  if (!p) return;
  const o = (S.pdaily[d] = S.pdaily[d] || {});
  o[p] = (o[p] || 0) + mins;
}
