/* A computer: more room, a keyboard and a mouse. The sidebar's extra places, the list of keyboard
   shortcuts, moving about with the keyboard, the right-click menu, renaming by a double click,
   and a project's page beside the board. On a phone none of it shows or changes anything. */
const deskMQ = matchMedia('(min-width: 1000px)'); // (the sidebar)
const splitMQ = matchMedia('(min-width: 1240px)'); // (room for the board beside a project's page)
const mouseMQ = matchMedia('(hover: hover) and (pointer: fine)');

/* the sidebar's extra places: views that have no tab on a phone */
const SIDE_ON = {
  ops: () => view === 'ops',
  waiting: () => view === 'waiting',
  focus: () => view === 'focus',
  notes: () => view === 'notes',
  log: () => view === 'review' && reviewSub === 'log',
};
function markSide() {
  document.querySelectorAll('#sidemore [data-side]').forEach(b => {
    const on = SIDE_ON[b.dataset.side];
    if (on && on()) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  // (History is a part of Review: with the sidebar showing it's the one lit, not both)
  const review = document.querySelector('nav [data-v="review"]');
  if (review && view === 'review') {
    if (deskMQ.matches && reviewSub === 'log') review.removeAttribute('aria-current');
    else review.setAttribute('aria-current', 'page');
  }
}
deskMQ.addEventListener('change', () => window.appReady && markSide());
document.addEventListener('click', e => {
  if (!window.appReady) return;
  const b = e.target.closest && e.target.closest('button');
  if (!b) return;
  if (b.dataset.rename) return renameTask(b.dataset.rename);
  if (!b.closest('#sidemore')) return;
  const k = b.dataset.side;
  if (k === 'keys') return openKeys();
  if (!SIDE_ON[k]) return;
  returnTo = viewFrom = null; // (a fresh start, as a tab is)
  go(k);
});

/* the keyboard shortcuts, as a list (the ? key, or the sidebar's link) */
const ON_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
const MOD_KEY = ON_MAC ? '⌘' : 'Ctrl';
const KEY_LIST = [
  [['/', MOD_KEY + ' K'], 'Search everything'],
  [['N', 'I'], 'Capture to the Inbox (on a project’s page, N adds a step)'],
  [['T'], 'Projects'],
  [['O'], 'Command Centre'],
  [['L'], 'History'],
  [['S'], 'Settings'],
  [['Z'], 'Single-task mode'],
  [['P'], 'Pause or resume the timer'],
  [['J', 'K'], 'Next or previous project, step or item (the arrow keys too, once one is selected)'],
  [['Enter'], 'Open what’s selected'],
  [['X'], 'Tick what’s selected'],
  [[MOD_KEY + ' Z'], 'Undo, while Undo is on offer'],
  [['Esc'], 'Back, or close'],
  [['?'], 'This list'],
];
function openKeys() {
  const keys = ks =>
    ks
      .map(k =>
        k
          .split(' ')
          .map(x => `<kbd>${esc(x)}</kbd>`)
          .join(' '),
      )
      .join(' <span class="hint">or</span> ');
  popSheet(
    `<h2 id="sheettitle">Keyboard shortcuts</h2><dl class="keys">${KEY_LIST.map(([ks, what]) => `<div><dt>${keys(ks)}</dt><dd>${esc(what)}</dd></div>`).join('')}</dl><p class="hint">With a mouse: right-click a project or a step for its actions, and double-click the name on its page to rename it.</p><div class="acts"><button class="btn" type="button" data-sheetclose="1">Close</button></div>`,
    { labelledBy: 'sheettitle' },
  );
}

/* Ctrl (or ⌘) with a key: K searches from anywhere; Z takes the Undo on offer. In a field Z is the
   field's own undo, as ever. Returns true when the key was taken. */
function deskChord(e) {
  // (on a Mac it's ⌘: Ctrl+K there deletes to the end of a line in a field)
  if (ON_MAC ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return false;
  if (e.altKey || e.shiftKey || !$('#v-alarm').hidden) return false;
  // (not under a sheet, nor in single-task mode: what they cover isn't to be changed from there)
  if ($('#sheet') || focusLocked() || zen) return false;
  const k = e.key.toLowerCase(),
    el = e.target;
  if (k === 'k') {
    openSearch();
    return true;
  }
  if (k === 'z') {
    if (el.closest && el.closest('input, textarea, select, [contenteditable]')) return false;
    if (!undoSnap) return false;
    undo();
    return true;
  }
  return false;
}

/* moving about with the keyboard: J and K (and the arrow keys, once something in a list has the
   keyboard) go from one project, step or item to the next; Enter opens it, X ticks it. */
const deskShown = e => e.getClientRects().length > 0;
function deskLists() {
  const sels = [];
  if (view === 'search') sels.push('#sres button.srow, #sres .srow a');
  if (view === 'projects' || splitOn()) sels.push('#v-projects .project-open');
  if (view === 'today') sels.push('#v-today .row .open, #v-today .secrow .open, #v-today .t3row .open');
  if (view === 'inbox') sels.push('#v-inbox .ititle');
  return sels.map(s => [...document.querySelectorAll(s)].filter(deskShown)).filter(l => l.length);
}
function deskFocus(el) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest' });
  // (clear of the bar held at the foot of a task's page)
  const foot = $('#v-today:not([hidden]) .qfoot'),
    top = foot && foot.getBoundingClientRect().top,
    r = el.getBoundingClientRect();
  if (foot && $('#v-today').contains(el) && r.bottom > top - 8) window.scrollBy(0, r.bottom - top + 8);
  return true;
}
function deskMove(k) {
  const lists = deskLists(),
    a = document.activeElement,
    arrow = k.startsWith('Arrow');
  let list = lists.find(l => l.includes(a));
  if (!list) {
    // Nothing selected yet: the arrow keys still scroll the page; J and K start at the top (of
    // the steps, with the board beside them), or at the project that's open.
    if (arrow || !lists.length) return false;
    list = splitOn() ? lists[lists.length - 1] : lists[0];
    const onScreen = list.find(e => {
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    });
    return deskFocus(list.find(e => e.closest('.project-current')) || onScreen || list[0]);
  }
  const i = list.indexOf(a),
    grid = a.classList.contains('project-open');
  let to = null;
  if (k === 'j' || (k === 'ArrowRight' && grid)) to = list[i + 1];
  else if (k === 'k' || (k === 'ArrowLeft' && grid)) to = list[i - 1];
  else if (k === 'ArrowDown' || k === 'ArrowUp') {
    // The nearest one in the row below (or above): on the board, the card under this one.
    const c = a.getBoundingClientRect(),
      down = k === 'ArrowDown';
    let best = Infinity;
    list.forEach(e => {
      const r = e.getBoundingClientRect(),
        dy = down ? r.top - c.top : c.top - r.top;
      if (dy < 8) return;
      const score = dy * 10 + Math.abs(r.left - c.left);
      if (score < best) {
        best = score;
        to = e;
      }
    });
    // (up from the first result: back to the search box)
    if (!to && !down && view === 'search' && $('#sq')) to = $('#sq');
  } else return false;
  if (to) deskFocus(to);
  return true; // (at the end of the list: the key is still the list's, the page doesn't jump)
}
// X: the tick of the step, task or project that has the keyboard.
function deskTick() {
  const a = document.activeElement,
    row = a && a.closest && a.closest('#v-today .row, .project-step'),
    card = !row && a && a.closest && a.closest('.project-card'),
    t = row
      ? row.querySelector('[data-toggle]')
      : card && card.querySelector('.project-card-heading [data-toggle]');
  if (!t) return false;
  t.click();
  return true;
}

/* a mouse: right-click a project, a task or a step for its actions (the same list as its ⋯, with
   Rename); double-click the name on its page to rename it. Not for a finger: a long press on a
   phone is the browser's. */
document.addEventListener('contextmenu', e => {
  if (!window.appReady || !e.target.closest) return;
  if (e.pointerType ? e.pointerType !== 'mouse' : !mouseMQ.matches) return;
  if ($('#sheet') || !$('#v-alarm').hidden || zen) return;
  // (a field, a link and selected words keep the browser's own menu: paste, copy, open in a tab)
  if (e.target.closest('input, textarea, select, a[href], [contenteditable]')) return;
  if (String(window.getSelection ? getSelection() : '').trim()) return;
  const el = e.target.closest('#v-projects [data-qid], #v-today [data-qid]');
  if (!el || !find(el.dataset.qid)) return;
  e.preventDefault();
  openTaskMenu(el.dataset.qid);
});
function openTaskMenu(id) {
  const r = find(id);
  if (!r) return;
  const acts = questActions(id, true),
    del = acts.findIndex(a => a.cls === 'del');
  acts.splice(del < 0 ? acts.length : del, 0, { label: 'Rename', attrs: `data-rename="${id}"` });
  actionSheet(r.n.text, acts);
}
function renameTask(id) {
  const r = find(id) || find(id, S.later);
  if (!r) return;
  sheet({ title: 'Rename', label: 'Name', value: r.n.text, ok: 'Save' }, v => {
    const now = find(id) || find(id, S.later);
    if (!now || typeof v !== 'string' || !v || v === now.n.text) return;
    now.n.text = v;
    const t = tplFor(now.n);
    if (t) t.text = v; // (a repeating task's later copies too)
    save();
    renderAll();
  });
}
document.addEventListener('dblclick', e => {
  if (!window.appReady || !mouseMQ.matches || !e.target.closest) return;
  if (!e.target.closest('#v-today .node.facts > h1') || !path.length) return;
  const sel = window.getSelection && getSelection();
  if (sel && sel.removeAllRanges) sel.removeAllRanges(); // (the word the double click picked out)
  renameTask(path[path.length - 1]);
});

/* a wide window: a project's page with the board beside it, so another project is one click
   away. The board is the same one as on Projects, drawn narrow (its cards as a list); each side
   is drawn again whenever the other is, so a tick on either shows on both. */
const splitOn = () =>
  splitMQ.matches && view === 'today' && path.length > 0 && !workListMode && !!find(path[0]);
const splitOpenId = () => (splitOn() ? path[0] : '');
function syncSplit() {
  const on = splitOn();
  document.body.classList.toggle('split', on);
  if (view === 'today') $('#v-projects').hidden = !on;
  return on;
}
// The keyboard is on the board while the same page is still the one open beside it.
const splitBeside = () =>
  splitOn() &&
  $('#v-projects').contains(document.activeElement) &&
  $('#v-today').dataset.page === 'p:' + path.join('/');
let splitDrawing = false;
function splitMirror(draw) {
  if (splitDrawing || !splitOn()) return;
  splitDrawing = true;
  try {
    draw();
  } finally {
    splitDrawing = false;
  }
}
// The open project's card, brought into the part of the board that shows: the board's own box,
// as far as that is in the window (its foot is below the fold until the page is scrolled).
function splitCardAt() {
  const pane = $('#v-projects'),
    card = splitOn() && pane.querySelector('.project-current');
  if (!card || !card.getClientRects().length) return null;
  const p = pane.getBoundingClientRect(),
    c = card.getBoundingClientRect(),
    top = Math.max(p.top, 0),
    bottom = Math.min(p.bottom, innerHeight);
  return { pane, above: top - c.top, below: c.bottom - bottom };
}
function splitReveal() {
  const at = splitCardAt();
  if (!at) return;
  if (at.above > 0) at.pane.scrollTop -= at.above + 12;
  else if (at.below > 0) at.pane.scrollTop += at.below + 12;
}
// The board drawn again beside the page. If the open project's card was showing and the redraw
// moved it out of sight (finished, it goes under Completed today), it's brought back; a board
// scrolled away from it to look at something else is left where it is.
function splitBoard() {
  const at = splitCardAt(),
    shown = !!at && at.above <= 0 && at.below <= 0;
  splitMirror(renderProjects);
  if (shown) splitReveal();
}
splitMQ.addEventListener('change', () => {
  if (!window.appReady) return;
  syncSplit();
  if (view === 'today') {
    inBackground(renderToday);
    splitReveal();
  }
});
