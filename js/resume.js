/* interruption recovery: a quest keeps where work on it stopped, q.resume = { note, at, step }:
   what was found and what to do next, when, and the step it was on. Saved from the focus timer
   (pausing it) or from any quest or step, with or without a session. Shown on the quest's page,
   as a mark on its row on Today and in single-task mode, until it's cleared, replaced, or the
   quest is finished. It travels with the quest (to the Inbox or Upcoming and back); a repeat's
   fresh copy never gets it. */
const placeLine = rs => (rs.note || 'Stopped at a step') + ' · ' + whenLabel(rs.at);
// Whether the quest's saved place belongs where `n` is shown: on the quest itself, or on the
// step it points at (not on another step's page).
const placeFits = (q, n) => q === n || !q.resume.step || q.resume.step === n.id;
// The step a saved place points at, if it's still there to do.
function placeStep(q) {
  const rs = q.resume,
    r = rs && rs.step && find(rs.step, q.children);
  return r ? r.n : null;
}
function savePlace(id) {
  const r = find(id);
  if (!r) return;
  const q = r.parents[0] || r.n,
    n = r.n;
  // Saving from a running session pauses it first: that is the interruption. (The session's
  // minutes are kept, as any pause keeps them.)
  if (S.timer && topOf(S.timer.q) === q && S.timer.left == null && !timerDue()) togglePause();
  // The step: the one asked about, else the session's, else (editing the note) the one the place
  // already points at while it's still to do, else the quest's next.
  const cur = q.resume,
    kept = cur && placeStep(q);
  let step = '';
  if (r.parents.length) step = n.id;
  else if (S.timer && topOf(S.timer.q) === q && S.timer.q !== q.id) step = S.timer.q;
  else if (kept && !isDone(kept)) step = kept.id;
  else {
    const nx = nextLeaf(q);
    step = nx ? nx.id : '';
  }
  const at = step && step !== n.id ? find(step) : null;
  sheet(
    {
      title: cur ? 'Update your saved place' : 'Save my place',
      text: 'At: ' + (r.parents.length ? n.text : at ? at.n.text : q.text),
      label: 'Where did you stop, and what should you do next?',
      value: cur ? cur.note : '',
      ok: 'Save',
      multiline: true,
      maxlength: RESUME_MAX,
      placeholder: 'Found a difference in the March totals. Check the supplier credits next.',
    },
    v => {
      const now = find(q.id); // (looked up again: a sync meanwhile may have rebuilt the list)
      if (!now || isDone(now.n)) return toast("That quest's finished: nothing to come back to");
      const note = cleanText(typeof v === 'string' ? v : '')
        .trim()
        .slice(0, RESUME_MAX);
      if (!note && !step) return toast("Write a note first: there's no step to point at");
      // (the time is when you stopped: editing the note alone doesn't move it)
      const was = now.n.resume;
      now.n.resume = { note, at: was && was.note === note && was.step === step ? was.at : Date.now(), step };
      save();
      renderAll();
      toast('Place saved');
    },
  );
}
// Back to the work: single-task mode on the step the place points at (or the quest's next),
// with the note shown there. The place stays until it's cleared: it's yours to read again.
function resumeWork(id) {
  const r = find(id);
  if (!r || !r.n.resume) return;
  const q = r.n;
  if (S.timer && topOf(S.timer.q) !== q)
    return toast('Finish or discard the running session first', false, 3000);
  if (S.timer) {
    if (S.timer.left != null) togglePause();
    setZen(true);
    return;
  }
  const st = placeStep(q),
    target = st && !isDone(st) && !st.wait ? st : focusLeaf(q) || q;
  S.focusQ = target.id;
  save();
  setZen(true);
}
function clearPlace(id) {
  const r = find(id);
  if (!r || !r.n.resume) return;
  withUndo('Saved place cleared', () => {
    delete r.n.resume;
    save();
    renderAll();
  });
}
// The saved place on a quest's page: the note, when, the step, and what to do with it.
function placeCard(q) {
  const rs = q.resume,
    st = placeStep(q),
    stepLine = rs.step
      ? st
        ? isDone(st)
          ? st.text + ' (ticked since)'
          : st.text
        : 'a step since removed'
      : '';
  return `<div class="placebox box" id="placecard"><p class="placehead"><b>Where you left off</b><small>${esc(whenLabel(rs.at))}</small></p>${
    rs.note ? `<p class="placenote">${esc(rs.note)}</p>` : ''
  }${stepLine ? `<p class="hint placestep">At: ${esc(stepLine)}</p>` : ''}<div class="links placeacts"><button class="linkbtn" data-saveplace="${q.id}">Edit the note</button><button class="linkbtn" data-clearplace="${q.id}">Clear</button></div>`;
}
// A finished quest has nothing to come back to (called by settle).
function dropDonePlaces() {
  S.quests.forEach(q => {
    if (q.resume && isDone(q)) delete q.resume;
  });
}
