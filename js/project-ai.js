/* Optional Claude actions for signed-in project details. */
const projectAiActions = {
  steps: {
    label: 'Suggest steps (AI)',
    notice: 'This sends the project name and its step names to Claude.',
    consent: 'dashboard-suggest-ok',
  },
  summary: {
    label: 'Summarise (AI)',
    notice:
      'This sends the project name, its current summary and its steps, including their status and who you are waiting on, to Claude.',
    consent: 'dashboard-summary-ok',
  },
};

function projectAiButton(id, mode) {
  if (!sb?.functions || !session?.user?.id) return '';
  return `<button type="button" class="linkbtn project-detail-history" data-project-ai="${mode}" data-id="${id}" aria-haspopup="dialog">${projectAiActions[mode].label}</button>`;
}

function openProjectAi(id, mode) {
  const action = projectAiActions[mode];
  const user = session?.user?.id;
  if (!Object.hasOwn(projectAiActions, mode) || !user || !sb?.functions || path[0] !== id) return;
  const start = () => {
    try {
      localStorage.setItem(action.consent, '1');
    } catch (e) {}
    requestProjectAi(id, mode, user);
  };
  let accepted = false;
  try {
    accepted = localStorage.getItem(action.consent) === '1';
  } catch (e) {}
  if (accepted) return requestProjectAi(id, mode, user);
  sheet(
    {
      title: action.label,
      text: action.notice + ' Only use it if your organisation allows this for work information.',
      ok: 'Continue',
      cancel: 'Cancel',
    },
    start,
  );
}

async function requestProjectAi(id, mode, user) {
  const currentProject = () =>
    session?.user?.id === user && view === 'today' && path.length === 1 && path[0] === id
      ? S.quests.find(q => q.id === id)
      : null;
  const project = currentProject();
  if (!project || !sb?.functions) return;
  const summary = mode === 'summary';
  const body = summary
    ? {
        mode,
        quest: project.text,
        summary: project.summary || '',
        steps: project.children.map(n => ({
          text: n.text,
          done: isDone(n),
          waiting: !isDone(n) && n.wait ? n.wait.who || 'someone' : '',
        })),
      }
    : { quest: project.text, steps: project.children.map(n => n.text) };
  const title = projectAiActions[mode].label;
  const close = label => `<button type="button" class="btn sm" data-sheetclose="1">${label}</button>`;
  popSheet(`<h2 id="sheettitle">${title}</h2><p role="status">Asking Claude…</p>${close('Cancel')}`, {
    labelledBy: 'sheettitle',
  });
  const dialog = $('#sheet .sheetbox');
  const show = (html, button = 'Cancel') => {
    dialog.innerHTML = `<h2 id="sheettitle">${title}</h2>${html}${close(button)}`;
    dialog.querySelector('input, button').focus();
  };
  let data;
  try {
    const reply = await sb.functions.invoke('suggest-steps', { body });
    if (
      reply.error ||
      (summary ? typeof reply.data?.summary !== 'string' : !Array.isArray(reply.data?.steps))
    )
      throw new Error('Invalid response');
    data = reply.data;
  } catch (e) {
    if (dialog.isConnected && !currentProject()) return closeSheet();
    if (dialog.isConnected)
      show(
        navigator.onLine
          ? '<p>Couldn’t get a response from Claude. Try again or check the suggest-steps logs in Supabase.</p>'
          : '<p>Connect to the internet and try again.</p>',
        'Close',
      );
    return;
  }
  if (!dialog.isConnected) return;
  const latest = currentProject();
  if (!latest) return closeSheet();
  if (summary) {
    const draft = cleanText(data.summary).trim().slice(0, SUMMARY_MAX);
    if (!draft) return show('<p>Claude had no summary to suggest.</p>', 'Close');
    show(
      `<p class="project-ai-summary">${esc(draft)}</p><div class="acts">
      <button class="btn sm green" type="button" data-ai-summary="replace">${latest.summary ? 'Replace summary' : 'Use summary'}</button>
      ${latest.summary ? '<button class="btn sm" type="button" data-ai-summary="append">Add to summary</button>' : ''}</div><p role="status" data-ai-message></p>`,
    );
    dialog.addEventListener('click', e => {
      const choice = e.target.closest('[data-ai-summary]')?.dataset.aiSummary;
      if (!choice) return;
      const q = currentProject();
      if (!q) return closeSheet();
      const combined = choice === 'append' && q.summary ? q.summary + '\n' + draft : draft;
      if (combined.length > SUMMARY_MAX) {
        dialog.querySelector('[data-ai-message]').textContent = 'The combined summary is too long to save.';
        return;
      }
      q.summary = combined;
      closeSheet();
      save();
      renderAll();
      toast('Summary saved');
    });
    return;
  }
  const stepKey = s => s.trim().toLowerCase();
  const newSteps = (texts, q) => {
    const seen = new Set(q.children.map(n => stepKey(n.text)));
    return texts.filter(text => {
      const key = stepKey(text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const steps = newSteps(
    data.steps.filter(t => typeof t === 'string').map(t => cleanText(t).trim().slice(0, 120)),
    latest,
  ).slice(0, 8);
  if (!steps.length) return show('<p>Claude had no new steps to suggest.</p>', 'Close');
  show(
    `<p class="hint">Choose which steps to add.</p>${steps
      .map(
        (text, i) => `<label class="optbox"><input type="checkbox" value="${i}" checked>${esc(text)}</label>`,
      )
      .join(
        '',
      )}<div class="acts"><button class="btn sm green" type="button" data-ai-add>Add selected steps</button></div>`,
  );
  const add = dialog.querySelector('[data-ai-add]');
  const selected = () => [...dialog.querySelectorAll('input:checked')].map(input => steps[+input.value]);
  dialog.addEventListener('change', () => (add.disabled = !selected().length));
  add.onclick = () => {
    const q = currentProject();
    if (!q) return closeSheet();
    const picked = newSteps(selected(), q);
    closeSheet();
    if (!picked.length) return toast('These steps are already on the project');
    const before = snapshot();
    q.children.push(...picked.map(text => fix({ id: uid(), text })));
    q.done = false;
    settle(before);
    toast('Added ' + plural(picked.length, 'step'));
  };
}
