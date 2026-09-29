/* notes: one shared space for jotting things down, synced across devices (handy for moving
   text from one device to another). Saved as you type. */
let notesTimer = null,
  notesOverride = false, // typed after being told the notes changed elsewhere: replace them
  notesDirty = false, // typed here and not saved yet
  notesBase = null, // the synced text the box last showed, to spot changes from elsewhere
  notesPromptAt = 0; // when the "changed on another device" prompt appeared
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
  renderNoteImgs(); // (the pictures redraw even while the text is being typed)
  if (cur && (document.activeElement === cur || notesDirty)) {
    const st = $('#notesstate');
    if (st && notesChanged() && !$('#notesload')) {
      notesPromptAt = Date.now();
      st.innerHTML =
        'Changed on another device. <button class="linkbtn" id="notesload">Show those notes</button> (or keep typing to replace them)';
    }
    return;
  }
  notesBase = S.notes || '';
  setHTML(
    $('#v-notes'),
    `<h2>Notes</h2><textarea class="fld notes" id="notesin" placeholder="Type here. It's saved as you go and appears on your other devices." aria-label="Notes">${esc(notesBase)}</textarea><p class="hint" id="notesstate">${notesBase ? 'Saved' : ''}</p><div id="noteimgs"></div>`,
  );
  renderNoteImgs();
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
  // Typing on with the "changed on another device" prompt showing means: replace them (once
  // it's been there long enough to be seen; a keystroke already under way doesn't count).
  if ($('#notesload') && Date.now() - notesPromptAt > 2000) notesOverride = true;
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

/* pictures in the notes: pasted in (or added from a file), shrunk to a sensible size and synced
   like the text. Kept apart from it, below the box: a text box can't show them. */
const IMG_MAX = 1600, // longest side, in pixels
  IMG_TOTAL = 4e6; // all of them together (characters), well inside the device's storage
const okImg = src =>
  typeof src === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src);
let imgBusy = 0,
  imgShown = null; // the picture shown full size
function renderNoteImgs() {
  const el = $('#noteimgs');
  if (!el) return;
  const imgs = S.noteImgs;
  let h = `<div class="sechead"><h2>Pictures</h2><button class="btn sm" id="nimgadd">Add picture</button></div><input type="file" id="nimgfile" accept="image/*" multiple hidden aria-hidden="true">`;
  h += imgs.length
    ? `<div class="nimgs">${imgs
        .map(
          (m, i) =>
            `<div class="nimg"><button class="nimgopen" data-nimg="${m.id}" aria-label="Show picture ${i + 1} full size"><img src="${m.src}" alt="Picture ${i + 1}"></button><button class="x" data-delnimg="${m.id}" aria-label="Delete picture ${i + 1}">×</button></div>`,
        )
        .join('')}</div>`
    : `<p class="hint">${imgBusy ? 'Adding…' : 'Paste a picture into the notes, or add one from a file.'}</p>`;
  const m = imgShown && imgs.find(x => x.id === imgShown);
  if (m)
    h += `<div class="nimgfull" role="dialog" aria-label="Picture"><button class="nimgclose" data-nimgclose="1" aria-label="Close"><img src="${m.src}" alt="Picture, full size"></button></div>`;
  else imgShown = null;
  el.innerHTML = h;
}
// Any size in, a JPEG no bigger than IMG_MAX on its longest side out (PNG if it has see-through parts
// would be nicer, but screenshots and photos are what gets pasted, and JPEG keeps them small).
function shrinkImage(file) {
  return new Promise((ok, fail) => {
    // (read as a data: URL: the page's security policy doesn't allow blob: pictures)
    const rd = new FileReader(),
      im = new Image();
    im.onload = () => {
      const k = Math.min(1, IMG_MAX / Math.max(im.naturalWidth, im.naturalHeight)),
        c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.naturalWidth * k));
      c.height = Math.max(1, Math.round(im.naturalHeight * k));
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; // (see-through parts would turn black in a JPEG)
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(im, 0, 0, c.width, c.height);
      ok(c.toDataURL('image/jpeg', 0.82));
    };
    im.onerror = rd.onerror = () => fail(new Error('not an image'));
    rd.onload = () => (im.src = rd.result);
    rd.readAsDataURL(file);
  });
}
async function addNoteImages(files) {
  files = [...files].filter(f => f && /^image\//.test(f.type));
  if (!files.length) return;
  imgBusy++;
  renderNoteImgs();
  let added = 0,
    full = false,
    bad = false;
  for (const f of files) {
    let src;
    try {
      src = await shrinkImage(f);
    } catch (e) {
      bad = true;
      continue;
    }
    if (!okImg(src)) {
      bad = true;
      continue;
    }
    const used = S.noteImgs.reduce((t, m) => t + m.src.length, 0);
    if (used + src.length > IMG_TOTAL) {
      full = true;
      break;
    }
    S.noteImgs.push({ id: uid(), src, at: Date.now() });
    added++;
  }
  imgBusy--;
  if (added) save();
  renderNoteImgs();
  if (full) toast('No room for more pictures: delete some first', false, 4000);
  else if (bad) toast("That picture couldn't be read", false, 3000);
  else if (added) toast(added > 1 ? `${added} pictures added` : 'Picture added');
}
function deleteNoteImg(id) {
  withUndo('Picture deleted', () => {
    S.noteImgs = S.noteImgs.filter(m => m.id !== id);
    if (imgShown === id) imgShown = null;
    save();
    renderNoteImgs();
  });
}
// Pasting a picture into the notes box adds it below (text pastes as usual).
document.addEventListener('paste', e => {
  if (view !== 'notes' || !e.clipboardData) return;
  const files = [...(e.clipboardData.items || [])]
    .filter(i => i.kind === 'file' && /^image\//.test(i.type))
    .map(i => i.getAsFile())
    .filter(Boolean);
  // Copied text often comes with a picture of itself (cells from a spreadsheet, say): then
  // it's the text that's meant.
  if (!files.length || e.clipboardData.getData('text/plain').trim()) return;
  e.preventDefault();
  addNoteImages(files);
});
