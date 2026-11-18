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

function projectCard(q, updates) {
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
  const grid = qs =>
    `<div class="project-grid">${qs.map(q => projectCard(q, updatesByProject.get(q.id))).join('')}</div>`;
  setHTML(
    el,
    `
    ${active.length ? grid(active) : `<div class="slot">${done.length ? 'Every current project is done.' : 'No current projects.'} <button class="linkbtn" data-goto="inbox">Capture a project in the Inbox</button></div>`}
    ${S.later.length ? `<section class="project-group" aria-labelledby="projects-upcoming"><h2 id="projects-upcoming">Upcoming</h2>${grid(S.later)}</section>` : ''}
    ${done.length ? `<details class="project-group" id="projects-done"${projectsDoneOpen ? ' open' : ''}><summary>Completed today <small>${done.length}</small></summary>${grid(done)}</details>` : ''}
  `,
  );
}

function projectClick(d) {
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
