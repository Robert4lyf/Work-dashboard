/* notes: one shared space for jotting things down, synced across devices (handy for moving
   text from one device to another). Saved as you type. */
let notesTimer = null,
  notesDirty = false, // typed here and not saved yet
  notesBase = null; // the synced text the box last showed, to spot changes from elsewhere
function renderNotes() {
  const cur = $('#notesin');
  // Don't redraw under someone typing. If the notes changed on another device meanwhile, say
  // so and offer to show them, rather than quietly overwriting them on the next save.
  if (cur && document.activeElement === cur) {
    const st = $('#notesstate');
    if (st && S.notes !== notesBase && S.notes !== cur.value)
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
function saveNotes(v) {
  clearTimeout(notesTimer);
  if (!notesDirty) return; // nothing typed: never overwrite notes that changed elsewhere
  notesDirty = false;
  if (v === S.notes) return;
  S.notes = notesBase = v;
  save();
}
function typedNotes(v) {
  clearTimeout(notesTimer);
  notesDirty = true;
  const st = $('#notesstate');
  if (st) st.textContent = 'Saving…';
  notesTimer = setTimeout(() => {
    saveNotes(v);
    if (st) st.textContent = 'Saved';
  }, 600);
}
function loadNotes() {
  clearTimeout(notesTimer);
  notesDirty = false;
  const box = $('#notesin');
  if (box) box.value = S.notes || '';
  notesBase = S.notes || '';
  const st = $('#notesstate');
  if (st) st.textContent = 'Showing the latest notes';
}
