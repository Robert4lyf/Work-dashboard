// The home screen calls each top-level task a project. The old project metadata is
// still used for history and sync, independently of this view.
let projectStepFor = '',
  projectsDoneOpen = false;
const PROJECT_STEP_LIMIT = 3;
let projectRecord = null;
const projectUpdateDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const projectGripIcon =
  '<svg viewBox="0 0 16 20" aria-hidden="true" fill="currentColor"><circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/><circle cx="5" cy="10" r="1.5"/><circle cx="11" cy="10" r="1.5"/><circle cx="5" cy="16" r="1.5"/><circle cx="11" cy="16" r="1.5"/></svg>';
const PROJECT_FOLDS_KEY = 'dashboard-project-section-folds';
const foldedProjectSections = new Set();
try {
  const saved = JSON.parse(localStorage.getItem(PROJECT_FOLDS_KEY));
  if (Array.isArray(saved)) saved.filter(okRef).forEach(id => foldedProjectSections.add(id));
} catch (e) {}
const openProjectCompleted = new Set();
function saveProjectSectionFolds() {
  try {
    localStorage.setItem(PROJECT_FOLDS_KEY, JSON.stringify([...foldedProjectSections]));
  } catch (e) {}
}
const waitingClock =
  '<span class="project-step-clock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>';

function activeProject() {
  return (
    S.quests.find(q => q.id === S.activeProject && !isDone(q)) ||
    S.later.find(q => q.id === S.activeProject && !isDone(q))
  );
}

function projectCheck(n, label) {
  const done = isDone(n);
  return `<button class="check${done ? ' project-checked' : ''}" type="button" data-toggle="${n.id}" aria-pressed="${done}" aria-label="${label}: ${esc(n.text)}">${tick}</button>`;
}

function projectHistoryLog(id) {
  const updates = S.projectUpdates
    .filter(entry => entry.q === id)
    .sort((a, b) => b.t - a.t || byName(b.id, a.id));
  return updates.length
    ? `<ol class="project-updates">${updates.map(entry => `<li tabindex="-1" data-history-entry="${entry.id}"><time datetime="${new Date(entry.t).toISOString()}">${projectUpdateDate.format(entry.t)}</time><p>${esc(entry.text)}</p></li>`).join('')}</ol>`
    : '<p class="hint">No updates yet.</p>';
}
function renderOpenProjectHistory() {
  const form = $('#sheet [data-project-update]');
  if (form) setHTML($('#project-history-entries'), projectHistoryLog(form.dataset.projectUpdate));
}
function revealProjectUpdate(scope, id) {
  if (!okRef(id)) return;
  const entry = scope.querySelector(`[data-history-entry="${id}"]`);
  if (!entry) return;
  entry.scrollIntoView({ block: 'nearest' });
  entry.focus({ preventScroll: true });
}
function projectHistoryDraft(id, value) {
  const key = 'dashboard-history-draft:' + id;
  try {
    if (value === undefined) return sessionStorage.getItem(key) || '';
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch (e) {}
  return '';
}
function openProjectHistory(id, updateId) {
  const project = S.quests.find(item => item.id === id) || S.later.find(item => item.id === id);
  if (!project) return;
  popSheet(
    `<h2 id="sheettitle">Project history</h2><p>${esc(project.text)}</p>
    <form class="project-update" data-project-update="${id}">
      <textarea class="fld" maxlength="${PROJECT_UPDATE_MAX}" rows="2" placeholder="Write an update" aria-label="New project update" required>${esc(projectHistoryDraft(id))}</textarea>
      <button class="btn sm">Add update</button>
    </form>
    <div id="project-history-entries">${projectHistoryLog(id)}</div>
    <button type="button" class="btn sm" data-history-close="1">Close</button>`,
    { labelledBy: 'sheettitle' },
  );
  const input = $('#sheet [data-project-update] textarea');
  input.addEventListener('input', () => projectHistoryDraft(id, input.value));
  revealProjectUpdate($('#sheet'), updateId);
}

function projectWaitLine(n) {
  const { who, due } = n.wait;
  const label = [
    who ? 'Waiting on ' + who : 'Waiting',
    due ? (due < today() ? 'Chase now' : due === today() ? 'Chase today' : 'Chase ' + niceDate(due)) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `<button type="button" class="linkbtn project-wait" data-wact="${n.id}" aria-haspopup="dialog">${esc(label)}</button>`;
}

function projectCard(q, canReorder, isActive = false) {
  const done = isDone(q),
    upcoming = !!q.start,
    scheduled = isScheduled(q),
    waiting = taskState(q) === 'waiting',
    mayTick = !upcoming && !q.wait && (!scheduled || ['today', 'passed', 'past'].includes(schedStatus(q).k)),
    kids = q.children,
    finished = kids.filter(isDone),
    open = kids.filter(c => !isDone(c)),
    next = isActive && !upcoming && kids.length ? actionLeaf(q) : null,
    follow =
      isActive &&
      [q, ...waitingSteps(q)]
        .filter(n => n.wait && !isDone(n))
        .sort((a, b) => (a.wait.due || '9').localeCompare(b.wait.due || '9'))[0],
    priority = [...new Set([next, follow === q ? null : follow].filter(Boolean))],
    preview = [...new Set([...priority, ...open, ...finished])].slice(0, PROJECT_STEP_LIMIT),
    status = upcoming && !scheduled ? `Starts ${esc(niceDate(q.start))}` : '',
    meta = [
      status,
      schedTag(q),
      q.wait && !done ? projectWaitLine(q) : waiting ? 'Waiting' : '',
      kids.length ? `${finished.length} of ${kids.length} steps` : '',
      dueTag(q) || stepDueTag(q),
    ].filter(Boolean),
    detail = `${upcoming ? 'data-upcoming-project' : 'data-open'}="${q.id}"`;
  const steps = preview
    .map(n => {
      const checked = isDone(n);
      return `<li class="project-step${checked ? ' project-step-done' : ''}" data-qid="${n.id}">
      ${!n.children.length && mayTick && (!n.wait || checked) ? projectCheck(n, checked ? 'Mark not done' : 'Mark done') : n.wait && !checked ? waitingClock : '<span class="project-step-dot" aria-hidden="true"></span>'}
      <span class="project-step-name"><span>${n === next ? '<strong class="project-next-label">Next · </strong>' : ''}${esc(n.text)}</span>${n.wait && !checked ? projectWaitLine(n) : ''}</span>
    </li>`;
    })
    .join('');
  const remaining = kids.filter(step => !preview.includes(step)).length;
  return `<article class="project-card" data-qid="${q.id}" aria-labelledby="project-title-${q.id}">
    <div class="project-preview">
      <div class="project-card-heading">
        ${!kids.length && mayTick ? projectCheck(q, done ? 'Mark not done' : 'Mark done') : ''}
        <h2 id="project-title-${q.id}"><button class="project-open" ${detail}><span>${esc(q.text)}</span>${chevron}</button></h2>
        ${q.wait && !kids.length && !done ? waitingClock : ''}
        ${canReorder ? `<button class="project-grip" type="button" data-project-reorder="${q.id}" aria-haspopup="dialog" aria-label="Reorder ${esc(q.text)}" title="Drag to move or open move options">${projectGripIcon}</button>` : ''}
      </div>
      ${meta.length ? `<div class="project-meta">${meta.map(item => `<span>${item}</span>`).join('')}</div>` : ''}
      ${steps ? `<ul class="project-steps">${steps}</ul>` : ''}
    </div>
    <div class="project-actions">
      ${done ? '' : `<button type="button" class="linkbtn project-activate" data-project-activate="${q.id}" aria-label="Make ${esc(q.text)} active" aria-pressed="${isActive}">${isActive ? '✓ Active' : 'Make active'}</button>`}
      <button class="linkbtn" data-project-add="${q.id}" aria-expanded="${projectStepFor === q.id}" aria-label="Add step to ${esc(q.text)}">+ Add step</button>
      ${!upcoming && remaining ? `<button class="linkbtn" ${detail} aria-label="Show all steps for ${esc(q.text)}">${remaining} more ${remaining === 1 ? 'step' : 'steps'}</button>` : ''}
      <button class="linkbtn" data-project-history="${q.id}" aria-haspopup="dialog" aria-label="History for ${esc(q.text)}">History</button>
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

function projectSectionGroups() {
  const groups = [...S.projectSections, { id: UNCATEGORISED, name: 'Uncategorised' }].map(section => ({
    ...section,
    active: [],
    upcoming: [],
    done: [],
  }));
  const byId = new Map(groups.map(section => [section.id, section]));
  const placements = new Map(S.projectPlacements.map(entry => [entry.id, entry.section]));
  const groupFor = q => byId.get(placements.get(q.id)) || byId.get(UNCATEGORISED);
  for (const q of S.quests) groupFor(q)[isDone(q) ? 'done' : 'active'].push(q);
  for (const q of S.later) groupFor(q).upcoming.push(q);
  return groups;
}

function renderProjects() {
  const el = $('#v-projects');
  for (const panel of el.querySelectorAll('[data-project-completed]')) {
    const id = panel.dataset.projectCompleted;
    if (id === UNCATEGORISED) projectsDoneOpen = panel.open;
    else if (panel.open) openProjectCompleted.add(id);
    else openProjectCompleted.delete(id);
  }
  const known = [...S.quests, ...S.later];
  if (!known.some(q => q.id === projectStepFor)) projectStepFor = '';
  const pinned = activeProject();
  const canMoveSections = S.projectSections.length > 0;
  const grid = (qs, canReorder, id = '') =>
    `<div class="project-grid"${id ? ` id="${id}"` : ''}>${qs.map(q => projectCard(q, canReorder)).join('')}</div>`;
  const sections = projectSectionGroups().map(section => {
    const { id, name, colour, done } = section;
    const active = section.active.filter(q => q !== pinned);
    const upcoming = section.upcoming.filter(q => q !== pinned);
    const accent = colour && PROJECT_SECTION_COLOURS[colour];
    const uncategorised = id === UNCATEGORISED;
    const expanded = !foldedProjectSections.has(id);
    const count = active.length + upcoming.length + done.length;
    const completedId = uncategorised ? 'projects-done' : 'projects-done-' + id;
    const completedOpen = uncategorised ? projectsDoneOpen : openProjectCompleted.has(id);
    const upcomingId = 'projects-upcoming-' + id;
    return `<section class="project-board-section" id="project-section-${id}" data-project-section="${id}"${accent ? ` data-colour="${colour}" style="--section-accent:${accent[1]};--section-ink:${accent[2] || '#111'}"` : ''} aria-labelledby="project-section-name-${id}">
      <div class="project-section-head">
        ${!uncategorised && S.projectSections.length > 1 ? `<button type="button" class="project-grip" data-project-section-reorder="${id}" aria-haspopup="dialog" aria-label="Reorder section ${esc(name)}" title="Drag to reorder or open move options">${projectGripIcon}</button>` : ''}
        <h2 id="project-section-name-${id}"><button type="button" class="project-section-toggle" data-project-section-toggle="${id}" aria-expanded="${expanded}" aria-controls="project-section-body-${id}"><span>${esc(name)}</span><small aria-hidden="true">${count}</small></button></h2>
        ${uncategorised ? '' : `<button type="button" class="linkbtn project-section-edit" data-project-section-edit="${id}" aria-label="Edit section ${esc(name)}">Edit</button>`}
      </div>
      <div class="project-section-body" id="project-section-body-${id}"${expanded ? '' : ' hidden'}>
        ${active.length ? grid(active, canMoveSections || active.length > 1, uncategorised ? 'active-project-grid' : '') : ''}
        ${upcoming.length ? `<section class="project-group" aria-labelledby="${upcomingId}"><h3 id="${upcomingId}">Upcoming</h3>${grid(upcoming, canMoveSections)}</section>` : ''}
        ${done.length ? `<details class="project-group" id="${completedId}" data-project-completed="${id}"${completedOpen ? ' open' : ''}><summary>Completed today <small>${done.length}</small></summary>${grid(done, canMoveSections)}</details>` : ''}
        ${count ? '' : `<p class="project-section-empty">${uncategorised && !known.length ? 'No projects yet. <button class="linkbtn" data-goto="inbox">Capture a project in the Inbox</button>.' : 'Drag projects here.'}</p>`}
      </div>
    </section>`;
  });
  setHTML(
    el,
    `<div class="project-board-actions">
      <button type="button" class="linkbtn" data-project-section-add="1" aria-haspopup="dialog">Add section</button>
      <button type="button" class="btn sm green" data-project-new="1" aria-haspopup="dialog">New project</button>
    </div>
    <section class="active-project" aria-labelledby="active-project-title">
      <h2 id="active-project-title">Active Task</h2>
      ${pinned ? `<div class="project-grid">${projectCard(pinned, false, true)}</div>` : '<p class="hint">Choose Make active on a project.</p>'}
    </section>${sections.join('')}`,
  );
}

function projectClick(d, button) {
  if (d.projectNew) return openNewProject();
  if (d.upcomingProject) return openProjectRecord(d.upcomingProject, 'upcoming', button);
  if (d.completedProject) return openProjectRecord(d.completedProject, 'completed', button);
  if (d.projectRecordBack) return backFromProjectRecord();
  if (d.reopenArchived) return reopenArchivedProject(d.reopenArchived);
  if (d.historyClose) return sheetBack();
  if (d.projectActivate) {
    const q = [...S.quests, ...S.later].find(item => item.id === d.projectActivate && !isDone(item));
    if (!q) return;
    const activating = S.activeProject !== q.id;
    S.activeProject = activating ? q.id : '';
    save();
    renderProjects();
    if (activating) $('#active-project-title')?.scrollIntoView({ block: 'nearest' });
    $(`[data-project-activate="${q.id}"]`)?.focus({ preventScroll: activating });
    return;
  }
  if (d.projectSectionAdd || d.projectSectionEdit) {
    editProjectSection(S.projectSections.find(section => section.id === d.projectSectionEdit));
    return;
  }
  if (d.projectSectionDelete) {
    const section = S.projectSections.find(item => item.id === d.projectSectionDelete);
    if (section) {
      closeSheet();
      sheet(
        {
          title: 'Delete ' + section.name + '?',
          text: 'Projects in this section will move to Uncategorised.',
          ok: 'Delete section',
          danger: true,
        },
        yes => {
          if (!yes) return;
          withUndo('Section deleted', () => {
            S.projectSections = S.projectSections.filter(item => item.id !== section.id);
            save();
            renderProjects();
          });
        },
      );
    }
    return;
  }
  if (d.projectSectionToggle) {
    if (!foldedProjectSections.delete(d.projectSectionToggle))
      foldedProjectSections.add(d.projectSectionToggle);
    saveProjectSectionFolds();
    renderProjects();
    return;
  }
  if (d.projectSectionReorder) {
    const at = S.projectSections.findIndex(item => item.id === d.projectSectionReorder);
    if (at < 0) return;
    const actions = [-1, 1]
      .filter(offset => S.projectSections[at + offset])
      .map(offset => ({
        label: offset < 0 ? 'Move section earlier' : 'Move section later',
        attrs: `data-project-section-move="${d.projectSectionReorder}" data-direction="${offset}"`,
      }));
    actionSheet(S.projectSections[at].name, actions, 'You can also drag the handle to reorder.');
    return;
  }
  if (d.projectSectionMove) {
    const at = S.projectSections.findIndex(item => item.id === d.projectSectionMove);
    closeSheet();
    if (at >= 0) moveProjectSection(d.projectSectionMove, S.projectSections[at + Number(d.direction)]?.id);
    return;
  }
  if (d.projectReorder) {
    const location = locateProjectCard(d.projectReorder);
    if (!location) return;
    const { group, cards, at } = location;
    const actions = [];
    if (at > 0 && !cards[at].start)
      actions.push({
        label: 'Move earlier',
        attrs: `data-project-move="${d.projectReorder}" data-direction="-1"`,
      });
    if (at + 1 < cards.length && !cards[at].start)
      actions.push({
        label: 'Move later',
        attrs: `data-project-move="${d.projectReorder}" data-direction="1"`,
      });
    for (const section of projectSectionGroups()) {
      if (section.id === group.id) continue;
      actions.push({
        label: 'Move to ' + section.name,
        attrs: `data-project-place="${d.projectReorder}" data-section="${section.id}"`,
      });
    }
    if (actions.length)
      actionSheet(cards[at].text, actions, 'You can also drag the handle to move this project.');
    return;
  }
  if (d.projectMove) {
    const location = locateProjectCard(d.projectMove);
    closeSheet();
    const target = location?.cards[location.at + Number(d.direction)];
    if (target) moveProject(d.projectMove, location.group.id, target.id);
    return;
  }
  if (d.projectPlace) {
    closeSheet();
    moveProject(d.projectPlace, d.section);
    return;
  }
  if (d.projectHistory) return openProjectHistory(d.projectHistory, d.historyTarget);
  if (!d.projectAdd) return;
  projectStepFor = projectStepFor === d.projectAdd ? '' : d.projectAdd;
  renderProjects();
  if (projectStepFor) document.getElementById('project-step-' + projectStepFor).focus();
}

function editProjectSection(section) {
  const selected = section?.colour || 'blue';
  const colours = Object.entries(PROJECT_SECTION_COLOURS)
    .map(([id, [name]]) => `<option value="${id}"${selected === id ? ' selected' : ''}>${name}</option>`)
    .join('');
  popSheet(
    `<form id="project-section-form" data-section="${section?.id || ''}">
    <h2 id="sheettitle">${section ? 'Edit section' : 'Add section'}</h2>
    <label class="f" for="project-section-name">Section name</label>
    <input class="fld" id="project-section-name" required maxlength="${PROJECT_SECTION_NAME_MAX}" value="${esc(section?.name || '')}">
    <label class="f" for="project-section-colour">Accent colour</label>
    <div class="project-colour-picker">
      <select class="fld" id="project-section-colour">${colours}</select>
      <span id="project-section-swatch" aria-hidden="true" style="background-color:${PROJECT_SECTION_COLOURS[selected][1]}"></span>
    </div>
    <div class="acts">
      <button class="btn green">${section ? 'Save section' : 'Add section'}</button>
      <button type="button" class="btn" data-sheetclose="1">Cancel</button>
      ${section ? `<button type="button" class="linkbtn" data-stay="1" data-project-section-delete="${section.id}">Delete section</button>` : ''}
    </div>
  </form>`,
    { labelledBy: 'sheettitle' },
  );
  const picker = $('#project-section-colour');
  const swatch = $('#project-section-swatch');
  picker.addEventListener('change', () => {
    swatch.style.backgroundColor = PROJECT_SECTION_COLOURS[picker.value][1];
  });
}

function saveProjectSection(form) {
  const input = $('#project-section-name');
  const name = cleanText(input.value).trim();
  const colour = $('#project-section-colour').value;
  if (!name) {
    input.value = '';
    input.reportValidity();
    return;
  }
  if (!Object.hasOwn(PROJECT_SECTION_COLOURS, colour)) return;
  const id = form.dataset.section;
  const existing = S.projectSections.find(section => section.id === id);
  if (id && !existing) return closeSheet();
  if (existing) Object.assign(existing, { name, colour });
  else S.projectSections.push({ id: uid(), name, colour });
  closeSheet();
  save();
  renderProjects();
}

function moveProjectSection(id, targetId) {
  const from = S.projectSections.findIndex(section => section.id === id);
  const to = S.projectSections.findIndex(section => section.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  const [section] = S.projectSections.splice(from, 1);
  S.projectSections.splice(to, 0, section);
  save();
  renderProjects();
  toast(`Section moved to position ${to + 1}`);
}

function locateProjectCard(id, groups = projectSectionGroups()) {
  const pinned = activeProject();
  for (const group of groups) {
    for (const groupCards of [group.active, group.upcoming, group.done]) {
      const cards = groupCards.filter(q => q !== pinned);
      const at = cards.findIndex(q => q.id === id);
      if (at !== -1) return { group, cards, at };
    }
  }
  return null;
}

function moveProject(id, sectionId, targetId) {
  const groups = projectSectionGroups();
  const destination = groups.find(group => group.id === sectionId);
  const source = locateProjectCard(id, groups);
  if (!destination || !source) return;
  const project = source.cards[source.at];
  const changedSection = source.group.id !== sectionId;
  const from = S.quests.indexOf(project);
  const peers = (isDone(project) ? destination.done : destination.active).filter(q => q !== activeProject());
  const target = peers.find(q => q.id === targetId);
  const anchor = target || (changedSection ? peers.at(-1) : null);
  const to = anchor ? S.quests.indexOf(anchor) : -1;
  if (from >= 0 && to >= 0 && from !== to) {
    S.quests.splice(from, 1);
    S.quests.splice(to + (changedSection && !target && from > to ? 1 : 0), 0, project);
  } else if (!changedSection) return;
  if (changedSection) {
    S.projectPlacements = S.projectPlacements.filter(entry => entry.id !== id);
    if (sectionId !== UNCATEGORISED) S.projectPlacements.push({ id, section: sectionId });
  }
  save();
  renderAll();
  toast(changedSection ? 'Moved to ' + destination.name : 'Project reordered');
}

const projectView = $('#v-projects');
let projectDrag = null;
projectView.addEventListener('pointerdown', e => {
  const handle = e.target.closest('[data-project-reorder], [data-project-section-reorder]');
  if (!handle || !e.isPrimary || e.button !== 0 || projectDrag) return;
  const sectionDrag = !!handle.dataset.projectSectionReorder;
  projectDrag = {
    id: handle.dataset.projectSectionReorder || handle.dataset.projectReorder,
    sectionDrag,
    sourceSection: handle.closest('[data-project-section]').dataset.projectSection,
    pointer: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    moving: false,
    frame: 0,
    source: handle.closest(sectionDrag ? '[data-project-section]' : '.project-card'),
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
  const hit = document.elementFromPoint(drag.x, drag.y);
  const section = hit?.closest('#v-projects [data-project-section]');
  const sectionId = section?.dataset.projectSection;
  const card = hit?.closest('.project-card');
  let target = null;
  if (section && drag.sectionDrag && sectionId !== UNCATEGORISED && sectionId !== drag.id)
    target = { element: section.firstElementChild, sectionId };
  if (
    section &&
    !drag.sectionDrag &&
    card?.dataset.qid !== drag.id &&
    (card || sectionId !== drag.sourceSection)
  )
    target = { element: card || section.firstElementChild, sectionId, cardId: card?.dataset.qid };
  if (drag.target?.element !== target?.element) drag.target?.element.classList.remove('project-drop-target');
  drag.target = target;
  target?.element.classList.add('project-drop-target');
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
  drag.target?.element.classList.remove('project-drop-target');
  if (projectView.hasPointerCapture(drag.pointer)) projectView.releasePointerCapture(drag.pointer);
}

document.addEventListener('pointerup', e => {
  if (projectDrag?.pointer !== e.pointerId) return;
  const { id, moving, sectionDrag } = projectDrag;
  projectDrag.x = e.clientX;
  projectDrag.y = e.clientY;
  if (moving) markProjectDrop();
  const target = projectDrag.target;
  cancelProjectDrag();
  if (!target) return;
  if (sectionDrag) moveProjectSection(id, target.sectionId);
  else moveProject(id, target.sectionId, target.cardId);
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
  projectHistoryDraft(q, '');
  save();
  renderOpenProjectHistory();
  if (view === 'project-record') renderProjectRecord();
  input.focus({ preventScroll: true });
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

function openNewProject() {
  popSheet(
    `<form id="new-project-form">
      <h2 id="sheettitle">New project</h2>
      <label class="f" for="new-project-name">Project name</label>
      <input class="fld" id="new-project-name" maxlength="120" required>
      ${
        S.projectSections.length
          ? `<label class="f" for="new-project-section">Section</label>
      <select class="fld" id="new-project-section"><option value="">Uncategorised</option>${S.projectSections.map(section => `<option value="${section.id}">${esc(section.name)}</option>`).join('')}</select>`
          : ''
      }
      <div class="acts"><button class="btn green">Create project</button><button type="button" class="btn" data-sheetclose="1">Cancel</button></div>
    </form>`,
    { labelledBy: 'sheettitle' },
  );
}
function saveNewProject() {
  const input = $('#new-project-name');
  const text = cleanText(input.value).trim();
  if (!text) {
    input.value = '';
    input.reportValidity();
    return;
  }
  const section = S.projectSections.find(item => item.id === $('#new-project-section')?.value);
  const q = fix({ id: uid(), text, since: today() });
  S.quests.unshift(q);
  if (section) S.projectPlacements.push({ id: q.id, section: section.id });
  const sectionId = section?.id || UNCATEGORISED;
  if (foldedProjectSections.delete(sectionId)) saveProjectSectionFolds();
  closeSheet();
  save();
  renderProjects();
  const title = document.getElementById('project-title-' + q.id).querySelector('button');
  title.focus();
  toast('Project created');
}

// Store finished work separately so it can't turn up in the current day's work or repeat rules.
function cleanArchivedProject(n) {
  const cleanNode = item => {
    if (!okRef(item?.id) || typeof item.text !== 'string') return null;
    return {
      ...item,
      text: cleanText(item.text),
      tag: typeof item.tag === 'string' ? item.tag : '',
      notes: typeof item.notes === 'string' ? cleanText(item.notes) : '',
      wait: item.wait && typeof item.wait === 'object' ? { ...item.wait } : undefined,
      children: (Array.isArray(item.children) ? item.children : []).map(cleanNode).filter(Boolean),
    };
  };
  const cleaned = cleanNode(n);
  return cleaned && fix(cleaned);
}
function completedProjectLog() {
  const entries = new Map();
  for (const entry of S.log) {
    if (entry?.trail?.length || !okRef(entry?.id) || !cleanDay(entry.d) || typeof entry.text !== 'string')
      continue;
    const previous = entries.get(entry.id);
    if (!previous || previous.d <= entry.d) entries.set(entry.id, entry);
  }
  return entries;
}

function archivedProjectEntry({ id, d, text }) {
  return { id, d, project: cleanArchivedProject({ id, text, done: true }), fromLog: true };
}
function projectIdsOutsideBoard() {
  return new Set([...S.later, ...S.inbox.map(item => item.node).filter(Boolean)].map(q => q.id));
}
function archiveCompletedProjects() {
  const log = completedProjectLog();
  const archived = new Map(S.completedProjects.map(entry => [entry.id, entry]));
  const placements = new Map(S.projectPlacements.map(entry => [entry.id, entry.section]));
  S.quests = S.quests.filter(q => {
    const date = log.get(q.id)?.d;
    if (!isDone(q) || date === today()) return true;
    const section = placements.get(q.id);
    archived.set(q.id, {
      id: q.id,
      d: date || cleanDay(S.day) || today(),
      project: structuredClone(q),
      completeSnapshot: true,
      ...(section ? { section } : {}),
    });
    return false;
  });
  // Copies from before archiving retain the project name and date in the completion log.
  const live = projectIdsOutsideBoard();
  for (const q of S.quests) live.add(q.id);
  for (const [id, entry] of log)
    if (!live.has(id) && !archived.has(id)) archived.set(id, archivedProjectEntry(entry));
  S.completedProjects = [...archived.values()];
}
function completedProjectEntries() {
  const log = completedProjectLog();
  const entries = new Map(S.completedProjects.map(entry => [entry.id, entry]));
  for (const [id, entry] of log) if (!entries.has(id)) entries.set(id, archivedProjectEntry(entry));
  for (const id of projectIdsOutsideBoard()) entries.delete(id);
  for (const q of S.quests) {
    if (isDone(q)) entries.set(q.id, { id: q.id, d: log.get(q.id)?.d || today(), project: q });
    else entries.delete(q.id);
  }
  return [...entries.values()].sort(
    (a, b) => b.d.localeCompare(a.d) || byName(a.project.text, b.project.text),
  );
}
function completedDate(date) {
  return niceDate(date) + (date.slice(0, 4) === today().slice(0, 4) ? '' : ' ' + date.slice(0, 4));
}
function renderCompletedProjects() {
  const groups = new Map();
  for (const entry of completedProjectEntries()) {
    const month = entry.d.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(entry);
  }
  return `<h2>Completed projects</h2>${
    groups.size
      ? [...groups]
          .map(([month, entries]) => {
            const [year, number] = month.split('-');
            const heading = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
              new Date(Number(year), Number(number) - 1, 1),
            );
            return `<section aria-labelledby="completed-${month}"><h3 id="completed-${month}">${esc(heading)}</h3>
      <div class="box completed-projects">${entries
        .map(
          entry =>
            `<button type="button" class="soonrow" data-completed-project="${entry.id}"><span>${esc(entry.project.text)}</span><time datetime="${entry.d}">${esc(completedDate(entry.d))}</time></button>`,
        )
        .join('')}</div></section>`;
          })
          .join('')
      : '<p class="hint">No completed projects yet.</p>'
  }`;
}
function reopenArchivedProject(id) {
  const live = S.quests.find(q => q.id === id);
  if (live && !isDone(live)) return;
  if (projectIdsOutsideBoard().has(id)) return;
  const entry = completedProjectEntries().find(item => item.id === id);
  if (!entry) return;
  withUndo('Project reopened', () => {
    const q = live || cleanArchivedProject(structuredClone(entry.project));
    const formerSection = entry.section || S.projectPlacements.find(item => item.id === id)?.section;
    const before = live && snapshot();
    q.done = false;
    delete q.start;
    delete q.scheduled;
    // Reopening an occurrence leaves the repeat template and future occurrences alone.
    delete q.tpl;
    if (!live) S.quests.unshift(q);
    S.completedProjects = S.completedProjects.filter(item => item.id !== id);
    S.projectPlacements = S.projectPlacements.filter(item => item.id !== id);
    if (S.projectSections.some(section => section.id === formerSection))
      S.projectPlacements.push({ id, section: formerSection });
    const section = S.projectSections.some(item => item.id === formerSection) ? formerSection : UNCATEGORISED;
    if (foldedProjectSections.delete(section)) saveProjectSectionFolds();
    if (before) settle(before);
    else {
      sinkDone(S.quests);
      save();
    }
    viewFrom = returnTo = null;
    openPath([q.id]);
    go('today');
  });
}
function openProjectRecord(id, kind, button) {
  const from = placeHere(button);
  returnTo = null;
  path = [];
  projectRecord = { id, kind };
  go('project-record');
  landed(from);
  renderProjectRecord();
  revealProjectUpdate($('#v-project-record'), button?.dataset.historyTarget);
}
function backFromProjectRecord() {
  if (viewFrom?.sig === placeSig()) return backFrom();
  if (projectRecord?.kind === 'completed') {
    reviewSub = 'completed';
    go('review');
  } else go('projects');
}
function renderProjectRecord() {
  const completed = projectRecord?.kind === 'completed';
  const entry = completed ? completedProjectEntries().find(entry => entry.id === projectRecord.id) : null;
  const q = completed ? entry?.project : S.later.find(item => item.id === projectRecord?.id);
  const back =
    viewFrom?.sig === placeSig() && viewFrom.view === 'search'
      ? 'Search'
      : completed
        ? 'Completed projects'
        : 'Projects';
  const crumbs = `<div class="crumbs"><button type="button" data-project-record-back="1">&lsaquo; ${back}</button></div>`;
  if (!q) {
    const moved = !completed && S.quests.find(item => item.id === projectRecord?.id);
    setHTML(
      $('#v-project-record'),
      crumbs +
        (moved
          ? `<p>This project is now in Projects.</p><button class="btn sm" data-open="${moved.id}">Open project</button>`
          : '<p class="hint">This project is no longer here.</p>'),
    );
    return;
  }
  const steps = items =>
    items.length
      ? `<ul class="project-record-steps">${items.map(item => `<li><span aria-hidden="true">${item.done ? '✓' : '○'}</span><span class="sr">${item.done ? 'Done: ' : 'Open: '}</span> ${esc(item.text)}${steps(item.children)}</li>`).join('')}</ul>`
      : '';
  const status = completed ? 'Completed ' + completedDate(entry.d) : 'Starts ' + niceDate(q.start);
  const controls = completed
    ? `<button class="btn sm" data-reopen-archived="${q.id}">Reopen project</button>`
    : `<div class="acts"><button class="btn sm green" data-now="${q.id}">Move to Projects now</button>
    <label class="project-record-date">Start date <input class="fld" type="date" data-restart="${q.id}" min="${shift(today(), 1)}" value="${esc(q.start)}"></label>
    <button class="linkbtn" data-project-history="${q.id}" aria-haspopup="dialog">Add history update</button></div>`;
  setHTML(
    $('#v-project-record'),
    `${crumbs}<article class="project-record box">
    <p class="hint">${esc(status)}${!completed && q.scheduled?.time ? ' · ' + esc(q.scheduled.time) : ''}</p>
    <h1>${esc(q.text)}</h1>
    ${
      completed
        ? `
      ${q.summary ? `<p class="project-record-copy">${esc(q.summary)}</p>` : ''}
      ${q.due ? `<p class="hint">Deadline ${esc(completedDate(q.due))}</p>` : ''}
      ${q.children.length ? `<h2>Steps</h2>${steps(q.children)}` : ''}
      ${q.notes ? `<h2>Notes</h2><p class="project-record-copy">${esc(q.notes)}</p>` : ''}
      `
        : renderUpcomingProjectFields(q)
    }
    ${q.links?.length ? renderInheritedLinks(q) : ''}
    ${controls}<h2>History</h2>${projectHistoryLog(q.id)}
    </article>`,
  );
}

function projectEditorFields(
  n,
  [name, due, notes] = ['project-name-' + n.id, 'project-due-' + n.id, 'project-notes-' + n.id],
) {
  return `<label class="f" for="${name}">Name</label><input class="fld" id="${name}" data-field="text" data-id="${n.id}" value="${esc(n.text)}" maxlength="120">
    <label class="f" for="${due}">Deadline</label><input class="fld" type="date" id="${due}" data-field="due" data-id="${n.id}" value="${esc(n.due || '')}">
    <label class="f" for="${notes}">Notes</label><textarea class="fld" id="${notes}" data-field="notes" data-id="${n.id}">${esc(n.notes || '')}</textarea>`;
}
function renderUpcomingProjectFields(q) {
  const renderDetails = (id, title, content) =>
    `<details id="${id}"${document.getElementById(id)?.open ? ' open' : ''}><summary>${esc(title)}</summary>${content}</details>`;
  const editSteps = items =>
    items
      .map(n =>
        renderDetails('edit-upcoming-' + n.id, n.text, projectEditorFields(n) + editSteps(n.children)),
      )
      .join('');
  const fields =
    projectEditorFields(q) +
    `
    <label class="f" for="upcoming-summary">Summary</label><textarea class="fld" id="upcoming-summary" data-field="summary" data-id="${q.id}" maxlength="${SUMMARY_MAX}">${esc(q.summary || '')}</textarea>`;
  return `${renderDetails('upcoming-project-fields-' + q.id, 'Edit project', fields)}<h2>Steps</h2>${editSteps(q.children)}
    <form class="addrow" data-project-step="${q.id}"><input id="upcoming-step" data-keep maxlength="120" placeholder="Add a step" aria-label="New step" required><button class="btn">Add step</button></form>`;
}
