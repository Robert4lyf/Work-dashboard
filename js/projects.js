// The home screen calls each top-level task a project. The old project metadata is
// still used for history and sync, independently of this view.
let projectStepFor = '',
  projectsDoneOpen = false;
const PROJECT_STEP_LIMIT = 3;

function projectCheck(n, label) {
  const done = isDone(n);
  return `<button class="check${done ? ' project-checked' : ''}" type="button" data-toggle="${n.id}" aria-pressed="${done}" aria-label="${label}: ${esc(n.text)}">${tick}</button>`;
}

function projectCard(q) {
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
  return `<article class="project-card" data-qid="${q.id}" aria-labelledby="project-title-${q.id}">
    <div class="project-card-heading">
      ${!kids.length && mayTick ? projectCheck(q, done ? 'Mark not done' : 'Mark done') : ''}
      <h2 id="project-title-${q.id}"><button class="project-open" ${detail}><span>${esc(q.text)}</span>${chevron}</button></h2>
    </div>
    ${meta.length ? `<div class="project-meta">${meta.map(item => `<span>${item}</span>`).join('')}</div>` : ''}
    ${steps ? `<ul class="project-steps">${steps}</ul>` : ''}
    <div class="project-actions">
      <button class="linkbtn" data-project-add="${q.id}" aria-expanded="${projectStepFor === q.id}" aria-label="Add step to ${esc(q.text)}">+ Add step</button>
      ${!upcoming && remaining ? `<button class="linkbtn" ${detail} aria-label="Show all steps for ${esc(q.text)}">${remaining} more ${remaining === 1 ? 'step' : 'steps'}</button>` : ''}
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
  const grid = qs => `<div class="project-grid">${qs.map(projectCard).join('')}</div>`;
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
  if (!d.projectAdd) return;
  projectStepFor = projectStepFor === d.projectAdd ? '' : d.projectAdd;
  renderProjects();
  if (projectStepFor) document.getElementById('project-step-' + projectStepFor).focus();
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
