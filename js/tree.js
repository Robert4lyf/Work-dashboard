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
    if (isDone(c)) continue;
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
      m.set(n.id, { done: isDone(n), top: !trail.length, text: n.text, trail });
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
  if (S.quests.length && S.quests.every(isDone) && S.bonusDay !== today()) {
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
  children: n.children.map(strip),
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
  let t = tplFor(n) || S.templates.find(x => x.text === n.text);
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
  tt = setTimeout(
    () => {
      t.classList.remove('show', 'act');
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
// Redraws triggered in the background (sync, calendar, the timer ending) must not wipe what
// the user is typing or move their cursor. Views set their HTML through setHTML for that.
let background = false;
const COMPOSE = [
  'qin',
  'sin',
  'iin',
  'tagin',
  'projin',
  'calin',
  'aemail',
  'apass',
  'leftin',
  'whyin',
  'pwhat',
  'pwho',
];
function inBackground(fn) {
  const was = background;
  background = true;
  try {
    return fn();
  } finally {
    background = was;
  }
}
function setHTML(el, html) {
  if (!background) {
    el.innerHTML = html;
    return;
  }
  const a = document.activeElement,
    fid = a && a.id && el.contains(a) ? a.id : '',
    sel = fid && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null,
    typed = {};
  COMPOSE.forEach(id => {
    const i = el.querySelector('#' + id);
    if (i && i.value) typed[id] = i.value;
  });
  el.innerHTML = html;
  for (const id in typed) {
    const i = el.querySelector('#' + id);
    if (i) i.value = typed[id];
  }
  const f = fid && el.querySelector('#' + CSS.escape(fid));
  if (f) {
    f.focus();
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
