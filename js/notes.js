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
  // Already showing these notes (and no prompt about others): nothing to redraw. (A redraw would
  // also rebuild the pictures, which are large.)
  if (cur && cur.value === (S.notes || '') && !$('#notesload')) return;
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
  notesOverride = false;
  if (v === S.notes) return (notesDirty = false);
  S.notes = notesBase = v;
  save();
  notesDirty = !localSaved; // (not saved on this device: still to do, and not "Saved")
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
    else if (st && !localSaved) st.textContent = 'Not saved: this device is out of storage';
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
  // All of them together (characters). Everything is kept in the browser's local storage, which
  // Chrome holds to about 5 million characters: this leaves room for the rest.
  IMG_TOTAL = 3.5e6;
const okImg = src =>
  typeof src === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src);
let imgBusy = 0,
  imgShown = null; // the picture shown full size
function renderNoteImgs() {
  const el = $('#noteimgs');
  if (!el) return;
  const imgs = S.noteImgs,
    // (pictures make this big: it's left alone when none of it changed, as while typing notes)
    key = [imgs.map(m => m.id).join(), imgBusy, imgShown].join('|');
  if (el.dataset.shown === key) return;
  el.dataset.shown = key;
  let h = `<div class="sechead"><h2>Pictures</h2><button class="btn sm" id="nimgadd">Add picture</button></div><input type="file" id="nimgfile" accept="image/*" multiple hidden aria-hidden="true">`;
  h += imgs.length
    ? `<div class="nimgs">${imgs
        .map(
          (m, i) =>
            `<div class="nimg"><button class="nimgopen" data-nimg="${m.id}" aria-label="Show picture ${i + 1} full size"><img src="${m.src}" alt="Picture ${i + 1}"></button><button class="dellink" data-delnimg="${m.id}" aria-label="Delete picture ${i + 1}">Delete</button></div>`,
        )
        .join('')}</div>`
    : `<p class="hint">${imgBusy ? 'Adding…' : 'Paste a picture into the notes, or add one from a file.'}</p>`;
  const m = imgShown && imgs.find(x => x.id === imgShown);
  if (m)
    h += `<div class="nimgfull" role="dialog" aria-label="Picture"><button class="nimgclose" data-nimgclose="1" aria-label="Close"><img src="${m.src}" alt="Picture, full size"></button><div class="acts"><button class="btn" data-nimgclose="1">Close</button><button class="btn pink" data-delnimg="${m.id}">Delete</button></div></div>`;
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
// Room is shared by every picture (the notes' and the articles', and any in an article being
// written), and kept well inside what a phone's browser lets a page store.
function imgUsed() {
  const len = list => (list || []).reduce((t, m) => t + m.src.length, 0);
  let used = len(S.noteImgs) + S.kb.reduce((t, a) => t + len(a.imgs), 0);
  if (typeof kbEdit !== 'undefined' && kbEdit && kbEdit.imgs) {
    const saved = new Set(
      ((kbEdit.id && S.kb.find(a => a.id === kbEdit.id)) || { imgs: [] }).imgs.map(m => m.id),
    );
    used += len(kbEdit.imgs.filter(m => !saved.has(m.id)));
  }
  return used;
}
// Picture files in, shrunk ones out (as far as there's room).
async function readImages(files) {
  files = [...files].filter(f => f && /^image\//.test(f.type));
  const r = { srcs: [], full: false, bad: false };
  let used = imgUsed();
  for (const f of files) {
    let src;
    try {
      src = await shrinkImage(f);
    } catch (e) {
      r.bad = true;
      continue;
    }
    if (!okImg(src)) {
      r.bad = true;
      continue;
    }
    if (used + src.length > IMG_TOTAL) {
      r.full = true;
      break;
    }
    used += src.length;
    r.srcs.push(src);
  }
  return r;
}
function imageToast(r) {
  const n = r.srcs.length;
  if (r.full) toast('No room for more pictures: delete some first', false, 4000);
  else if (r.bad) toast("That picture couldn't be read", false, 3000);
  else if (n) toast(n > 1 ? `${n} pictures added` : 'Picture added');
}
async function addNoteImages(files) {
  if (![...files].some(f => f && /^image\//.test(f.type))) return;
  imgBusy++;
  renderNoteImgs();
  const r = await readImages(files);
  imgBusy--;
  r.srcs.forEach(src => S.noteImgs.push({ id: uid(), src, at: Date.now() }));
  if (r.srcs.length) save();
  renderNoteImgs();
  imageToast(r);
}
function deleteNoteImg(id) {
  withUndo('Picture deleted', () => {
    S.noteImgs = S.noteImgs.filter(m => m.id !== id);
    if (imgShown === id) imgShown = null;
    save();
    renderNoteImgs();
  });
}
// Pasting a picture into the notes, or into an article being written, adds it below (text pastes
// as usual).
document.addEventListener('paste', e => {
  const kb = view === 'knowledge' && kbEdit && e.target.closest && e.target.closest('#kbform');
  if ((view !== 'notes' && !kb) || !e.clipboardData) return;
  const files = [...(e.clipboardData.items || [])]
    .filter(i => i.kind === 'file' && /^image\//.test(i.type))
    .map(i => i.getAsFile())
    .filter(Boolean);
  // Copied text often comes with a picture of itself (cells from a spreadsheet, say): then
  // it's the text that's meant.
  if (!files.length || e.clipboardData.getData('text/plain').trim()) return;
  e.preventDefault();
  if (kb) kbAddImages(files);
  else addNoteImages(files);
});
