/* notes: one shared space for jotting things down, synced across devices (handy for moving
   text from one device to another). Saved as you type. */
let notesTimer = null,
  notesOverride = false, // typed after being told the notes changed elsewhere: replace them
  notesDirty = false, // typed here and not saved yet
  notesBase = null; // the synced text the box last showed, to spot changes from elsewhere
function renderNotes() {
  const cur = $('#notesin');
  if (cur && cur.value === (S.notes || '')) {
    // Same text either way (say typed the same on both): nothing to choose between.
    notesBase = cur.value;
    notesDirty = false;
  }
  // Don't redraw under someone typing, or over text typed here and not saved yet. If the notes
  // changed on another device meanwhile, say so and offer to show them, rather than quietly
  // overwriting them on the next save.
  if (cur && (document.activeElement === cur || notesDirty)) {
    const st = $('#notesstate');
    if (st && notesChanged() && !$('#notesload'))
      st.innerHTML =
        'Changed on another device. <button class="linkbtn" id="notesload">Show those notes</button> (or keep typing to replace them)';
    return;
  }
  notesBase = S.notes || '';
  setHTML(
    $('#v-notes'),
    `<h2>Notes</h2><textarea class="fld notes" id="notesin" placeholder="Type here. It's saved as you go and appears on your other devices." aria-label="Notes">${esc(notesBase)}</textarea><p class="hint" id="notesstate">${notesBase ? 'Saved' : ''}</p>`,
  );
}
const notesChanged = () => (S.notes || '') !== notesBase; // changed elsewhere since shown here
function saveNotes(v) {
  clearTimeout(notesTimer);
  if (!notesDirty) return; // nothing typed: never overwrite notes that changed elsewhere
  // Changed elsewhere and not yet chosen to replace them: keep both, the prompt is showing.
  if (notesChanged() && !notesOverride) return;
  notesDirty = false;
  notesOverride = false;
  if (v === S.notes) return;
  S.notes = notesBase = v;
  save();
}
function typedNotes(v) {
  clearTimeout(notesTimer);
  notesDirty = true;
  // Typing on with the "changed on another device" prompt showing means: replace them.
  if ($('#notesload')) notesOverride = true;
  const st = $('#notesstate');
  if (st && !notesChanged()) st.textContent = 'Saving…';
  notesTimer = setTimeout(() => {
    saveNotes(v);
    if (st && !notesDirty) st.textContent = 'Saved';
  }, 600);
}
function loadNotes() {
  clearTimeout(notesTimer);
  notesDirty = false;
  notesOverride = false;
  const box = $('#notesin');
  if (box) box.value = S.notes || '';
  notesBase = S.notes || '';
  const st = $('#notesstate');
  if (st) st.textContent = 'Showing the latest notes';
}
