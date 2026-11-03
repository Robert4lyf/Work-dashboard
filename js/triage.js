/* guided inbox triage ("Process inbox"): the Inbox's items one at a time, each with its details
   and one decision: Today, Later, Waiting, Reference (an article in Knowledge), Delete or Skip.
   Optional: the Inbox itself stays as it is, and leaving the tab leaves triage (except to write
   the article). Nothing is counted or copied: the progress is worked out from what's left. */
let triage = null; // { seen: ids shown, skipped: ids passed over, decided: ids kept (waiting), cur, pane, ref }
function startTriage() {
  if (!S.inbox.length) return toast('The Inbox is empty');
  triage = { seen: new Set(), skipped: new Set(), decided: new Set(), cur: null, pane: '', ref: null };
  renderInbox();
  window.scrollTo(0, 0);
}
function exitTriage() {
  triage = null;
  renderInbox();
}
// The item being decided on: the one shown last if it's still here, else the next not yet
// passed over (an item arriving from another device joins the end; one removed there is gone).
function triageItem() {
  S.inbox.forEach(i => triage.seen.add(i.id));
  let it = triage.cur && S.inbox.find(x => x.id === triage.cur);
  if (!it) {
    it = S.inbox.find(x => !triage.skipped.has(x.id) && !triage.decided.has(x.id)) || null;
    triage.cur = it ? it.id : null;
    triage.pane = '';
  }
  return it;
}
function renderTriage() {
  const it = triageItem(),
    seen = [...triage.seen],
    processed = seen.filter(id => !S.inbox.some(x => x.id === id) || triage.decided.has(id)).length,
    skipped = seen.filter(id => triage.skipped.has(id) && S.inbox.some(x => x.id === id)).length;
  let h = `<div class="sechead"><h2>Process inbox</h2><button class="linkbtn" data-triageexit="1">Exit</button></div><p class="hint tprog" aria-live="polite">${processed} of ${seen.length} processed${skipped ? `, ${skipped} skipped` : ''}</p>`;
  if (!it) {
    h += `<div class="empty">${skipped ? 'Nothing left but the skipped ones.' : S.inbox.length ? "All processed. What's left is waiting on others." : 'Inbox empty.'}</div><div class="acts tdone">${
      skipped ? '<button class="btn blue" data-triageagain="1">Go through the skipped ones</button>' : ''
    }<button class="btn" data-triageexit="1">Back to the Inbox</button></div>`;
    return h;
  }
  const n = it.node,
    kids = n ? n.children : [],
    notes =
      n && typeof n.notes === 'string' && n.notes.trim() && n.notes.trim() !== String(it.text).trim()
        ? n.notes
        : '';
  h += `<div class="tcard box"><p class="ttitle">${esc(it.text)}</p><p class="tmeta">${tagBadge(it.tag)}${waitBadge(it)}${n ? stepWaitBadge(n) : ''}${
    it.wait && it.wait.due ? chaseTag(it.wait) : ''
  }</p>${notes ? `<div class="tnotes">${kbLinkify(notes)}</div>` : ''}${
    kids.length
      ? `<ul class="subs tsubs">${kids.map(k => `<li><span>${esc(k.text)}</span>${k.wait ? waitBadge(k) : ''}</li>`).join('')}</ul>`
      : ''
  }</div>`;
  if (triage.pane === 'later') h += `<div class="tpane box">${laterPicker('i', it.id)}</div>`;
  if (triage.pane === 'waiting')
    h += `<form class="tpane box" id="twform" data-id="${it.id}"><label class="f" for="twho">Waiting on whom</label><input class="fld" id="twho" maxlength="60" value="${esc((it.wait && it.wait.who) || '')}" list="wholist" autocomplete="off" required><label class="f" for="tdue">Chase on <small class="hint">(optional)</small></label><input class="fld" type="date" id="tdue" value="${esc((it.wait && it.wait.due) || '')}">${whoList()}<div class="acts"><button class="btn blue">Set waiting</button><button class="btn" type="button" data-tdo="close">Cancel</button></div></form>`;
  // (each decision names the item it was drawn for: a redraw meanwhile mustn't retarget a tap)
  const b = (k, l, c = '') =>
    `<button class="btn ${c}" data-tdo="${k}" data-id="${it.id}" aria-pressed="${triage.pane === k}">${l}</button>`;
  h += `<div class="tacts" role="group" aria-label="Decide">${b('today', 'Today', 'blue')}${b('later', 'Later')}${b('waiting', 'Waiting')}${b('ref', 'Reference')}${b('delete', 'Delete')}${b('skip', 'Skip')}</div>`;
  return h;
}
function triageWaiting(id) {
  const it = S.inbox.find(x => x.id === id),
    who = cleanText($('#twho').value.trim()).slice(0, 60),
    due = $('#tdue').value || '';
  if (!it || !who) return;
  const was = it.wait || {};
  it.wait = { who, note: was.note || '', due: cleanDay(due), since: was.since || today() };
  triage.decided.add(id);
  triage.cur = null;
  save();
  renderAll();
  toast('Waiting on ' + who);
}
// Reference: the item becomes an article, written in Knowledge's editor with the item's details
// filled in. The item stays in the Inbox until the article is saved (see kbSave); cancelling
// comes back here with it untouched.
function triageReference(id) {
  const it = S.inbox.find(x => x.id === id);
  if (!it) return;
  // An article already being written (for another item, or on its own) is only left on purpose.
  if (kbEdit && kbEdit.fromInbox !== id) return leaveEditor(() => triageReference(id));
  const n = it.node,
    lines = [];
  if (n && n.notes && n.notes.trim() && n.notes.trim() !== String(it.text).trim()) lines.push(n.notes.trim());
  if (n && n.children.length) lines.push(n.children.map(k => '- ' + k.text).join('\n'));
  if (it.wait && it.wait.who)
    lines.push('Waiting on ' + it.wait.who + (it.wait.due ? ', chase ' + niceDate(it.wait.due) : ''));
  const first = kbKids('')[0];
  kbEdit = {
    cat: first ? first.id : '',
    title: String(it.text).slice(0, 200),
    body: lines.join('\n\n').slice(0, KB_BODY),
    imgs: [],
    fromInbox: id,
  };
  triage.ref = id;
  kbArt = null;
  kbImgShown = null;
  go('knowledge');
  window.scrollTo(0, 0);
  const t = $('#kbt');
  t && t.focus();
}
// Back from the editor (saved or not): the next item, or the same one.
function triageReturn(saved) {
  if (!triage) return;
  if (saved) triage.cur = null;
  triage.ref = null;
  go('inbox');
}
function triageClick(d, b) {
  if (d.triagestart) return startTriage();
  if (d.triageexit) return exitTriage();
  if (d.triageagain) {
    triage.skipped.clear();
    triage.cur = null;
    return renderInbox();
  }
  if (!triage) return;
  if (d.sched && d.kind === 'i' && triage.cur === d.sched) triage.cur = null; // (moves on once scheduled)
  if (!d.tdo) return;
  const it = triageItem();
  if (!it || (d.id && d.id !== it.id)) return renderInbox(); // (the item shown went meanwhile)
  const id = it.id;
  if (d.tdo === 'today') {
    triage.cur = null;
    return promoteInbox(id);
  }
  if (d.tdo === 'delete') {
    triage.cur = null;
    return clearInbox(id);
  }
  if (d.tdo === 'skip') {
    triage.skipped.add(id);
    triage.cur = null;
    return renderInbox();
  }
  if (d.tdo === 'ref') return triageReference(id);
  // Later and Waiting unfold their choices under the item; tapping again folds them.
  triage.pane = d.tdo === 'close' || triage.pane === d.tdo ? '' : d.tdo;
  renderInbox();
  // (the choices unfold under the item, above the decision bar: brought into view)
  const pane = $('#v-inbox .tpane');
  if (pane) pane.scrollIntoView({ block: 'center' });
  const f = $('#twho');
  if (f) f.focus({ preventScroll: true });
}
