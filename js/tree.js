/* tree helpers */
function isDone(n) {
  if (!n.children.length) return n.done;
  const req = n.children.filter(c => !c.opt);
  return (req.length ? req : n.children).every(isDone);
}
function frac(n) {
  if (!n.children.length) return isDone(n) ? 1 : 0;
  const req = n.children.filter(c => !c.opt),
    set = req.length ? req : n.children;
  return set.reduce((a, c) => a + frac(c), 0) / set.length;
}
function find(id, arr = S.quests, parents = []) {
  for (const n of arr) {
    if (n.id === id) return { n, arr, parents };
    const r = find(id, n.children, [...parents, n]);
    if (r) return r;
  }
  return null;
}
function ids(n, out = []) {
  out.push(n.id);
  n.children.forEach(c => ids(c, out));
  return out;
}
function count(n) {
  return n.children.reduce((a, c) => a + 1 + count(c), 0);
}
function nextLeaf(n) {
  for (const c of n.children) {
    if (isDone(c) || c.wait) continue;
    if (!c.children.length) return c;
    const r = nextLeaf(c);
    if (r) return r;
  }
  return null;
}
function snapshot() {
  const m = new Map();
  (function w(ns, trail) {
    ns.forEach(n => {
      m.set(n.id, { done: isDone(n), top: !trail.length, text: n.text, trail, kids: n.children.length });
      w(n.children, [...trail, n.text]);
    });
  })(S.quests, []);
  return m;
}
// Finished quests sink below open ones at every level; open ones keep their order,
// so the top open quest is always "Next up".
function sinkDone(ns) {
  const open = ns.filter(n => !isDone(n)),
    done = ns.filter(isDone);
  ns.splice(0, ns.length, ...open, ...done);
  ns.forEach(n => sinkDone(n.children));
}
function settle(before) {
  sinkDone(S.quests);
  const after = snapshot();
  let gain = 0;
  after.forEach((v, id) => {
    if (!before.has(id)) return;
    const was = before.get(id).done;
    const pts = v.top ? 30 : 10;
    // (done because its open steps were removed, not finished: no points, no log)
    if (v.done && !was && v.kids < before.get(id).kids) return;
    if (v.done && !was) {
      gain += pts;
      S.log.push({ id, d: today(), text: v.text, trail: v.trail, p: projectOf(id) });
    }
    if (!v.done && was) {
      gain -= pts;
      S.log = S.log.filter(x => !(x.id === id && x.d === today()));
    }
  });
  if (gain) {
    addXP(gain);
    if (gain > 0) beep([659, 988]);
  }
  // (only on finishing the last one: deleting the rest isn't clearing the stage)
  if (gain > 0 && S.quests.length && S.quests.every(isDone) && S.bonusDay !== today()) {
    S.bonusDay = today();
    addXP(50);
    toast('Stage clear!');
    beep([523, 659, 784, 1047, 784, 1047]);
  }
  save();
  renderAll();
}
const spent = n => {
  const set = new Set(ids(n));
  return S.sessions.filter(s => set.has(s.q)).reduce((a, s) => a + s.mins, 0);
};
function dueSoon() {
  const out = [],
    lim = shift(today(), 3);
  (function w(ns, trail) {
    ns.forEach(n => {
      if (isDone(n)) return;
      const t = [...trail, n.text];
      if (n.due && n.due <= lim) out.push({ n, t });
      w(n.children, t);
    });
  })(S.quests, []);
  return out.sort((a, b) => (a.n.due < b.n.due ? -1 : a.n.due > b.n.due ? 1 : 0)).slice(0, 5);
}
const strip = n => ({
  text: n.text,
  tag: n.tag,
  project: n.project,
  opt: n.opt,
  notes: n.notes,
  children: n.children.filter(c => !c.wait).map(strip), // (waiting is this time's, not every time's)
});
const inst = t =>
  fix({
    id: uid(),
    text: t.text,
    tag: t.tag,
    project: t.project,
    opt: t.opt,
    notes: t.notes,
    children: t.children.map(inst),
  });

/* repeating quests: a quest repeats through a template linked by n.tpl */
const repeats = t => !!t && (t.days.length > 0 || t.monthDay > 0);
const tplFor = n => (n.tpl ? S.templates.find(t => t.id === n.tpl) : null);
const ord = n => n + ([11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function repLabel(t) {
  const ds = WEEK.filter(i => t.days.includes(i)),
    p = [];
  if (ds.length === 7) p.push('Daily');
  else if (ds.length === 5 && [1, 2, 3, 4, 5].every(i => ds.includes(i))) p.push('Weekdays');
  else if (ds.length) p.push(ds.map(i => WD[i]).join(' '));
  if (t.monthDay) p.push('Monthly on the ' + ord(t.monthDay));
  return p.join(', ');
}
// Change how a quest repeats. The repeat copies the quest as it is now, subquests included.
function setRepeat(n, fn) {
  let t = tplFor(n) || S.templates.find(x => x.auto && x.text === n.text); // (never a saved one)
  if (!t) {
    t = { id: uid(), days: [], monthDay: 0, auto: true };
    S.templates.push(t);
  }
  n.tpl = t.id;
  Object.assign(t, strip(n));
  fn(t);
  if (t.auto && !repeats(t)) {
    S.templates = S.templates.filter(x => x !== t);
    delete n.tpl;
  }
  save();
  renderAll();
}

/* a small panel at the bottom of the screen, for a one-line answer or a yes/no, in place of the
   browser's own pop-ups. One at a time; Escape, the back gesture or the backdrop close it. */
let sheetCb = null;
function sheet({ title, label, value = '', ok = 'OK', cancel = 'Cancel', danger = false, text = '' }, cb) {
  closeSheet();
  sheetCb = cb;
  const el = document.createElement('div');
  el.id = 'sheet';
  el.innerHTML = `<div class="sheetback" data-sheetclose="1"></div><form class="sheetbox box" id="sheetform" role="dialog" aria-modal="true" aria-labelledby="sheettitle"><h2 id="sheettitle">${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${
    label !== undefined
      ? `<label class="f" for="sheetin">${esc(label)}</label><input class="fld" id="sheetin" maxlength="120" value="${esc(value)}" autocomplete="off">`
      : ''
  }<div class="acts"><button class="btn ${danger ? 'pink' : 'green'}" id="sheetok">${esc(ok)}</button><button class="btn" type="button" data-sheetclose="1">${esc(cancel)}</button></div></form>`;
  document.body.appendChild(el);
  const i = $('#sheetin');
  if (i) {
    i.focus();
    i.select();
  } else $('#sheetok').focus();
}
function closeSheet(answer) {
  const el = $('#sheet'),
    cb = sheetCb;
  sheetCb = null;
  if (el) el.remove();
  if (cb && answer !== undefined) cb(answer);
}
document.addEventListener('submit', e => {
  if (e.target.id !== 'sheetform') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const i = $('#sheetin');
  closeSheet(i ? i.value.trim() : true);
});
document.addEventListener(
  'click',
  e => {
    if (e.target.closest && e.target.closest('[data-sheetclose]')) {
      e.stopImmediatePropagation();
      closeSheet();
    }
  },
  true,
);
/* feedback */
// XP is still counted (and synced) but no longer shown, so it can come back as a setting.
function addXP(n) {
  S.xp = Math.max(0, S.xp + n);
}
let tt,
  undoSnap = null;
function toast(msg, undo, ms) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (undo ? '<button id="undo">Undo</button>' : '');
  t.classList.toggle('act', !!undo);
  t.classList.add('show');
  clearTimeout(tt);
  if (!undo) undoSnap = null; // (a plain message replacing an Undo: that undo is over)
  tt = setTimeout(
    () => {
      t.classList.remove('show', 'act');
      // (no invisible Undo button left for the keyboard to land on; a keyboard on it moves on)
      if (t.contains(document.activeElement))
        ($('#v-' + view) || document.body).focus({ preventScroll: true });
      t.innerHTML = '';
      if (undo) undoSnap = null;
    },
    ms || (undo ? 5000 : 1600),
  );
}
// Run a destructive change and offer to put everything back for a few seconds.
function withUndo(msg, fn) {
  const snap = JSON.stringify(S);
  fn();
  undoSnap = snap;
  toast(msg, true);
}
// Redraws triggered in the background (sync, the timer ending) must not wipe what
// the user is typing or move their cursor. Views set their HTML through setHTML for that.
let background = false;
const COMPOSE = [
  'sin',
  'iin',
  'tagin',
  'projin',
  'aemail',
  'apass',
  'leftin',
  'whyin',
  'wwhat',
  'wfrom',
  'wchase',
  'kbcatin',
  'flowname',
  'flowurl',
];
// (Not the waiting panel's Who and For what: they show the saved details, which a sync may
// have changed; while being typed in, they're kept like any field being edited.)
function inBackground(fn) {
  const was = background;
  background = true;
  try {
    return fn();
  } finally {
    background = was;
  }
}
// Where the keyboard was, as a selector: by id, else by the element's data attributes.
function focusSel(a) {
  if (!a || a === document.body) return '';
  if (a.id) return '#' + CSS.escape(a.id);
  // (not data-typed: the redrawn field won't have it yet)
  const ds = [...a.attributes].filter(x => x.name.startsWith('data-') && x.name !== 'data-typed');
  return ds.length ? a.tagName + ds.map(x => `[${x.name}="${CSS.escape(x.value)}"]`).join('') : '';
}
function setHTML(el, html) {
  if (!background) {
    // A redraw after a tap or key press: the keyboard stays on the same control, or (if it went)
    // in this view, rather than falling back to the top of the page.
    const a = document.activeElement,
      inside = a && el.contains(a),
      sel = inside ? focusSel(a) : '';
    el.innerHTML = html;
    if (inside) {
      let f = (sel && el.querySelector(sel)) || el;
      // (the control may now be folded away, say a quest just ticked into "Done today": the
      // keyboard stays in the view rather than falling to the top of the page)
      if (f !== el && f.closest('details:not([open])')) f = el;
      if (f === el) el.tabIndex = -1;
      f.focus({ preventScroll: true });
    }
    return;
  }
  const a = document.activeElement,
    fid = a && a.id && el.contains(a) ? a.id : '',
    fsel = a && el.contains(a) ? focusSel(a) : '', // (buttons have no id: by their data attributes)
    sel = fid && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null,
    typed = {};
  // Fixed compose boxes, plus any input marked data-keep (e.g. one per project).
  [...COMPOSE, ...[...el.querySelectorAll('input[data-keep][id]')].map(i => i.id)].forEach(id => {
    const i = el.querySelector('#' + CSS.escape(id));
    if (i && i.value) typed[id] = i.value;
  });
  // And whatever field is being edited right now.
  // (only once typed into, so a committed field shows edits synced from elsewhere).
  if (fid && a.dataset.typed && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) typed[fid] = a.value;
  // And any typed into but not yet saved (the waiting panel's, saved together by its button).
  el.querySelectorAll('[data-typed][id]').forEach(i => (typed[i.id] = i.value));
  // (kept as typed after this redraw too, not only this one)
  const wasTyped = new Set(
    Object.keys(typed).filter(id => el.querySelector('#' + CSS.escape(id) + '[data-typed]')),
  );
  // A field without an id (a tag's or a flow's name, say), found again by its data attributes.
  // (only if it's still the same item's field: one found by its place in a list, say a tag's
  // name, could now be another tag's, if one was removed elsewhere meanwhile)
  const typedSel =
      !fid && fsel && a.dataset.typed && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) ? a.value : null,
    typedWas = typedSel !== null ? a.defaultValue : '';
  const opt = $('#sopt') && $('#sopt').checked; // "Add as optional", ticked but not yet added
  el.innerHTML = html;
  if (opt && $('#sopt')) $('#sopt').checked = true;
  for (const id in typed) {
    const i = el.querySelector('#' + CSS.escape(id));
    if (i) i.value = typed[id];
    if (i && wasTyped.has(id)) i.dataset.typed = '1';
  }
  const f = fsel && el.querySelector(fsel);
  if (f && typedSel !== null && f.defaultValue === typedWas) {
    f.value = typedSel;
    f.dataset.typed = '1';
  }
  if (f) {
    f.focus({ preventScroll: true });
    if (sel)
      try {
        f.setSelectionRange(sel[0], sel[1]);
      } catch (e) {}
  }
}
function dropUndo() {
  if (!undoSnap) return;
  undoSnap = null;
  $('#toast').classList.remove('show', 'act');
  $('#toast').innerHTML = '';
}
function undo() {
  const snap = undoSnap;
  dropUndo();
  if (!snap) return;
  norm(JSON.parse(snap));
  save();
  renderAll();
  toast('Undone');
}
let ac;
function beep(notes) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    notes.forEach((f, i) => {
      const o = ac.createOscillator(),
        g = ac.createGain();
      o.type = 'square';
      o.frequency.value = f;
      g.gain.value = 0.06;
      o.connect(g).connect(ac.destination);
      const t = ac.currentTime + i * 0.09;
      o.start(t);
      o.stop(t + 0.08);
    });
  } catch (e) {}
}
function arm(b, label) {
  if (b.classList.contains('armed')) return true;
  b.classList.add('armed');
  b.dataset.orig = b.textContent;
  b.textContent = label;
  setTimeout(() => {
    if (b.isConnected) {
      b.classList.remove('armed');
      b.textContent = b.dataset.orig;
    }
  }, 3000);
  return false;
}
// "1 quest", "2 quests".
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
