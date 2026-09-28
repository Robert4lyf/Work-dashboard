/* notes: one shared space for jotting things down, synced across devices (handy for moving
   text from one device to another). Saved as you type. */
let notesTimer = null;
function renderNotes() {
  // Don't redraw under someone typing: their text is newer than whatever arrived.
  const cur = $('#notesin');
  if (cur && document.activeElement === cur) return;
  setHTML(
    $('#v-notes'),
    `<h2>Notes</h2><textarea class="fld notes" id="notesin" placeholder="Type here. It's saved as you go and appears on your other devices." aria-label="Notes">${esc(S.notes || '')}</textarea><p class="hint" id="notesstate">${S.notes ? 'Saved' : ''}</p>`,
  );
}
function typedNotes(v) {
  clearTimeout(notesTimer);
  const st = $('#notesstate');
  if (st) st.textContent = 'Saving…';
  notesTimer = setTimeout(() => {
    S.notes = v;
    save();
    if (st) st.textContent = 'Saved';
  }, 600);
}
