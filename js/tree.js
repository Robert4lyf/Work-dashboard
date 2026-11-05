/* tree helpers */
// A task with steps is finished when you say so (its own done), with every step that counts
// ticked. Ticking its last step doesn't finish it: more steps often turn up, so it asks what's next.
// (Except a repeating one: a checklist done the same way each time, finished by its last tick.)
function isDone(n) {
  if (!n.children.length) return n.done;
  return (!!n.done || repeats(tplFor(n))) && stepsDone(n);
}
function stepsDone(n) {
  const req = n.children.filter(c => !c.opt);
  return (req.length ? req : n.children).every(isDone);
}
// Every step ticked, but not finished: what's next (another step, or finish it)?
const needsNext = n => n.children.length > 0 && stepsDone(n) && !isDone(n);
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
      m.set(n.id, {
        done: isDone(n),
        ready: needsNext(n),
        top: !trail.length,
        text: n.text,
        trail,
        kids: n.children.length,
      });
      w(n.children, [...trail, n.text]);
    });
  })(S.quests, []);
  return m;
}
// Finished tasks sink below open ones at every level; open ones keep their order,
// so the top open task is always "Next up".
function sinkDone(ns) {
  const open = ns.filter(n => !isDone(n)),
    done = ns.filter(isDone);
  ns.splice(0, ns.length, ...open, ...done);
  ns.forEach(n => sinkDone(n.children));
}
function settle(before) {
  // A finished task with a step to do again (added, or un-ticked) isn't finished any more:
  // ticking that step asks what's next, rather than finishing it again.
  // One left asking what's next is marked so, so it isn't taken for one finished before this
  // version (see norm).
  [...S.quests, ...S.later].forEach(q => {
    if (q.done && q.children.length && !stepsDone(q)) q.done = false;
    if (needsNext(q)) q.asked = 1;
  });
  dropDonePlaces(); // (a finished task has nothing to come back to)
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
      {
        const rr = find(id) || find(id, S.later),
          est = rr ? effEst(rr.n) : 0;
        // (with its estimate and the focus time on it, for the comparison in Review)
        S.log.push({
          id,
          d: today(),
          text: v.text,
          trail: v.trail,
          p: projectOf(id),
          ...(est ? { est, m: spent(rr.n) } : {}),
        });
        emitEvent({
          k: 'quest_done',
          key: 'quest:' + id + ':done:' + today(),
          id,
          text: v.text,
          top: !!v.top,
          p: projectOf(id),
          byRule: !!(rr && rr.n.byRule),
        });
      }
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
  // A task's last step just ticked here (not one removed): ask what's next.
  let ask = null;
  after.forEach((v, id) => {
    const b = before.get(id);
    if (v.top && v.ready && b && !b.ready && !b.done && v.kids === b.kids) ask = ask || id;
  });
  save();
  renderAll();
  if (ask && S.quests.some(q => q.id === ask)) askNext(ask);
}
// The last step's ticked: add the next one, add a reminder to work it out, or finish the task.
// (Closed without an answer, the task stays on Today asking, until you add a step or finish it.)
function askNext(id) {
  const r = find(id);
  if (!r) return;
  sheet(
    {
      title: "What's next?",
      text: `Every step of "${r.n.text}" is ticked. It stays open until you finish it.`,
      label: 'Next step',
      ok: 'Add step',
      cancel: 'Later',
      extra: [
        ['unsure', 'Not sure yet'],
        ['finish', 'Finish task', 'blue'],
      ],
    },
    a => nextAnswer(id, a),
  );
}
const UNSURE = 'Work out the next step';
function nextAnswer(id, a) {
  const r = find(id);
  if (!r || !needsNext(r.n)) return; // (changed meanwhile, here or on another device)
  const bf = snapshot();
  if (a && a.pick === 'finish') r.n.done = true;
  else {
    const text = a && a.pick === 'unsure' ? UNSURE : typeof a === 'string' ? cleanText(a) : '';
    if (!text) return;
    r.n.children.push(fix({ id: uid(), text }));
  }
  settle(bf);
  if (r.n.done) toast('Finished: ' + r.n.text);
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
// (Its resources repeat with it: a weekly report needs its procedure every week. A saved place
// doesn't: that's this time's, like waiting.)
const strip = n => ({
  text: n.text,
  tag: n.tag,
  project: n.project,
  opt: n.opt,
  notes: n.notes,
  ...(n.links ? { links: n.links } : {}),
  ...(n.est ? { est: n.est } : {}),
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
    ...(t.links ? { links: t.links.map(l => ({ ...l })) } : {}),
    ...(t.est ? { est: t.est } : {}),
    children: t.children.map(inst),
  });

/* repeating quests: a task repeats through a template linked by n.tpl */
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
// Change how a task repeats. The repeat copies the task as it is now, steps included.
function setRepeat(n, fn) {
  const bf = snapshot(); // (a repeating task with every step ticked is finished: see isDone)
  let t = tplFor(n) || S.templates.find(x => x.auto && x.text === n.text); // (never a saved one)
  if (!t) {
    t = { id: uid(), days: [], monthDay: 0, auto: true };
    S.templates.push(t);
  }
  n.tpl = t.id;
  Object.assign(t, strip(n));
  if (!n.links) delete t.links; // (assigning can't take a key away)
  if (!n.est) delete t.est;
  fn(t);
  if (t.auto && !repeats(t)) {
    S.templates = S.templates.filter(x => x !== t);
    delete n.tpl;
  }
  settle(bf);
}

/* a small panel at the bottom of the screen, for a one-line answer or a yes/no, in place of the
   browser's own pop-ups. One at a time; Escape, the back gesture or the backdrop close it.
   (popSheet, in actions.js, mounts other panels the same way: a list of actions, a picker.) */
let sheetCb = null,
  sheetOpener = null; // the control that opened it: the keyboard goes back there on closing
// extra: more answers, as [key, label, class] buttons (answering { pick: key }).
// multiline: a few lines of text rather than one (a note).
function sheet(
  {
    title,
    label,
    value = '',
    ok = 'OK',
    cancel = 'Cancel',
    danger = false,
    text = '',
    extra = [],
    multiline = false,
    maxlength = 120,
    placeholder = '',
  },
  cb,
) {
  popSheet(
    `<form id="sheetform"><h2 id="sheettitle">${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${
      label !== undefined
        ? `<label class="f" for="sheetin">${esc(label)}</label>` +
          (multiline
            ? `<textarea class="fld" id="sheetin" maxlength="${maxlength}" rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
            : `<input class="fld" id="sheetin" maxlength="${maxlength}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`)
        : ''
    }<div class="acts"><button class="btn ${danger ? 'pink' : 'green'}" id="sheetok">${esc(ok)}</button><button class="btn" type="button" data-sheetclose="1">${esc(cancel)}</button></div>${
      extra.length
        ? `<div class="acts">${extra.map(([k, l, c]) => `<button class="btn ${c || ''}" type="button" data-sheetans="${esc(k)}">${esc(l)}</button>`).join('')}</div>`
        : ''
    }</form>`,
    { labelledBy: 'sheettitle' },
  );
  sheetCb = cb;
  const i = $('#sheetin');
  if (i) {
    i.focus();
    if (!multiline) i.select();
    else i.setSelectionRange(i.value.length, i.value.length);
  } else $('#sheetok').focus();
}
// Any panel at the bottom of the screen: `html` goes inside the box. Buttons in it act through
// the usual click handler by their data attributes; the sheet closes first (see below).
function popSheet(html, { labelledBy = '', label = '' } = {}) {
  closeSheet();
  // (by its data attributes too: the action may have redrawn the page, replacing the control)
  sheetOpener = { el: document.activeElement, sel: focusSel(document.activeElement) };
  const el = document.createElement('div');
  el.id = 'sheet';
  el.innerHTML = `<div class="sheetback" data-sheetclose="1"></div><div class="sheetbox box" role="dialog" aria-modal="true"${labelledBy ? ` aria-labelledby="${labelledBy}"` : ''}${label ? ` aria-label="${esc(label)}"` : ''}>${html}</div>`;
  document.body.appendChild(el);
  // (Release G: the page behind is out of reach while a sheet is up, for a screen reader too, not
  // only for the pointer)
  sheetInert(true);
  const f = el.querySelector('[autofocus], .qact, input, textarea, select, button');
  if (f) f.focus();
}
const SHEET_BEHIND = ['.wrap', 'nav', '#v-zen'];
function sheetInert(on) {
  // (not while an alarm rings: that keeps the page out of reach itself)
  if (!on && !$('#v-alarm').hidden) return;
  SHEET_BEHIND.forEach(s => {
    const e = $(s);
    if (e) e.inert = on;
  });
}
function closeSheet(answer) {
  const el = $('#sheet'),
    cb = sheetCb,
    back = sheetOpener;
  sheetCb = null;
  sheetOpener = null;
  if (el) {
    el.remove();
    sheetInert(false);
    // The keyboard goes back to what opened it, if that's still on the page (and nothing else
    // has it: the action may have moved it on).
    const f =
      back && (back.el && back.el.isConnected ? back.el : back.sel && document.querySelector(back.sel));
    if (f && (!document.activeElement || document.activeElement === document.body))
      f.focus({ preventScroll: true });
  }
  if (cb && answer !== undefined) cb(answer);
}
document.addEventListener('submit', e => {
  if (e.target.id !== 'sheetform') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const i = $('#sheetin');
  closeSheet(i ? i.value.trim() : true);
});
/* Release H: a sheet with words typed into it (a rule, a follow-up's note, a step, a web link) and
   not saved isn't closed by the back gesture or a tap beside it without asking: back asks, in the
   sheet itself, and a second back (or Discard) closes it; a tap beside it asks the same and leaves
   it up. Its own Cancel still closes it. Nothing typed: it closes as before. */
const sheetField = el =>
  el.matches('textarea, input') &&
  !el.matches('[type=search], [type=checkbox], [type=radio], [type=date], [type=time], [type=file]');
document.addEventListener(
  'input',
  e => {
    const s = e.target.closest && e.target.closest('#sheet');
    if (s && sheetField(e.target)) s.dataset.typed = '1';
  },
  true,
);
function sheetTyped() {
  const s = $('#sheet');
  return (
    !!s &&
    s.dataset.typed === '1' &&
    [...s.querySelectorAll('input, textarea')].some(i => sheetField(i) && i.value.trim())
  );
}
// Back (or Escape) on a sheet.
function sheetBack() {
  if (!sheetTyped() || $('#sheetwarn')) return closeSheet();
  askDiscard();
}
function askDiscard() {
  const box = $('#sheet .sheetbox');
  if (!box) return closeSheet();
  if (!$('#sheetwarn'))
    box.insertAdjacentHTML(
      'beforeend',
      '<div class="sheetwarn" id="sheetwarn" role="alert"><p>Discard what you typed?</p><div class="acts"><button class="btn pink" type="button" data-sheetdiscard="1">Discard</button><button class="btn" type="button" data-sheetkeep="1">Keep editing</button></div></div>',
    );
  const w = $('#sheetwarn');
  w.scrollIntoView({ block: 'nearest' });
  w.querySelector('[data-sheetkeep]').focus({ preventScroll: true });
}
document.addEventListener(
  'click',
  e => {
    const t = e.target.closest ? e.target : null;
    if (t && t.closest('[data-sheetdiscard]')) {
      e.stopImmediatePropagation();
      return closeSheet();
    }
    if (t && t.closest('[data-sheetkeep]')) {
      e.stopImmediatePropagation();
      $('#sheetwarn').remove();
      const f = [...$('#sheet').querySelectorAll('input, textarea')].find(
        i => sheetField(i) && i.value.trim(),
      );
      if (f) f.focus();
      return;
    }
    if (t && t.closest('.sheetback') && sheetTyped()) {
      e.stopImmediatePropagation();
      return askDiscard();
    }
    if (e.target.closest && e.target.closest('[data-sheetclose]')) {
      e.stopImmediatePropagation();
      closeSheet();
    }
    const ans = e.target.closest && e.target.closest('[data-sheetans]');
    if (ans) {
      e.stopImmediatePropagation();
      closeSheet({ pick: ans.dataset.sheetans });
    }
    // An action chosen from a sheet (see actionSheet): the sheet goes, then the click handler
    // runs the action as it would from anywhere else. (A control marked data-stay keeps it up.)
    const act = e.target.closest && e.target.closest('#sheet .qact:not([data-stay])');
    if (act) closeSheet();
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
  'wwhat',
  'wfrom',
  'wchase',
  'kbcatin',
  'flowname',
  'flowurl',
  'twho',
  'tdue',
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
  // (not data-typed, nor an armed button's own marks: the redrawn control won't have them yet)
  const ds = [...a.attributes].filter(
    x => x.name.startsWith('data-') && !['data-typed', 'data-orig', 'data-armat', 'data-h'].includes(x.name),
  );
  if (ds.length) return a.tagName + ds.map(x => `[${x.name}="${CSS.escape(x.value)}"]`).join('');
  // (a folded section's summary: by its section's id)
  const d = a.parentElement;
  return a.tagName === 'SUMMARY' && d && d.id ? `#${CSS.escape(d.id)} > summary` : '';
}
/* Release H: Today drawn again in place. The new markup is laid over what's there: what reads
   the same is left alone (not taken out and put back, so not laid out again, and the keyboard, a
   half-typed word, an open panel and an Android keyboard's composing on it stay as they are); what
   changed is replaced. Children are matched by their task's id (or their id), else by kind in
   order. A row carries a fingerprint of its markup (data-h): the same fingerprint, the row is
   kept whole; a different one, it's replaced whole. No framework: the markup stays the one source
   of what's shown, and a view is still drawn from scratch whenever it isn't Today. */
// (by view, what page of it is drawn: a different page is drawn from scratch, so nothing of one
// task's page, a field half typed in say, is carried over onto another's)
const PATCHED = { 'v-today': () => 'p:' + path.join('/') };
function withHash(html) {
  let h = 0x811c9dc5;
  for (let i = 0; i < html.length; i++) h = Math.imul(h ^ html.charCodeAt(i), 16777619);
  return html.replace(/^<([a-z0-9]+)/i, `<$1 data-h="${(h >>> 0).toString(36)}.${html.length.toString(36)}"`);
}
const pKey = n =>
  n.nodeType === 1 ? n.getAttribute('data-qid') || n.getAttribute('data-wid') || n.id || null : null;
const pSame = (o, n) =>
  o.nodeType === n.nodeType &&
  (o.nodeType !== 1 ||
    (o.tagName === n.tagName && pKey(o) === pKey(n) && (pKey(o) || o.className === n.className)));
const FORM = /^(INPUT|TEXTAREA|SELECT)$/;
function pAttrs(o, n, skip) {
  for (const { name, value } of n.attributes)
    if (name !== skip && o.getAttribute(name) !== value) o.setAttribute(name, value);
  for (const { name } of [...o.attributes])
    if (name !== skip && !n.hasAttribute(name)) o.removeAttribute(name);
}
const pAttrsSame = (o, n) =>
  o.attributes.length === n.attributes.length &&
  [...n.attributes].every(a => o.getAttribute(a.name) === a.value);
// The node to stand where `o` was: `o` itself, brought up to date, or `n` in its place.
function pUpdate(o, n) {
  if (o.nodeType !== 1) {
    if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
    return o;
  }
  const h = n.getAttribute('data-h');
  if (h !== null) return o.getAttribute('data-h') === h ? o : pResolve(n);
  if (FORM.test(o.tagName)) {
    // (the field being typed in stays exactly as it is: its words, its place in them, and its own
    // marks, such as data-typed, which says it's to be saved when left; any other field changed
    // is new)
    if (o === document.activeElement) return o;
    return pAttrsSame(o, n) && o.innerHTML === n.innerHTML ? o : pResolve(n);
  }
  pAttrs(o, n);
  pChildren(o, n);
  return o;
}
function pChildren(from, to) {
  const olds = [...from.childNodes],
    byKey = new Map(),
    used = new Set(),
    out = [];
  olds.forEach(o => {
    const k = pKey(o);
    if (k && !byKey.has(k)) byKey.set(k, o);
  });
  let pos = 0;
  for (const n of [...to.childNodes]) {
    const kept = n.nodeType === 1 && pKeep.get(n.getAttribute('data-pkeep'));
    if (kept) {
      used.add(kept);
      out.push(kept);
      continue;
    }
    const k = pKey(n);
    let o = null;
    if (k) {
      o = byKey.get(k);
      if (o && (used.has(o) || !pSame(o, n))) o = null;
    } else {
      // (the next of the same kind not yet used, looking a few ahead past any taken out)
      for (let i = pos, seen = 0; i < olds.length && seen < 4; i++) {
        const c = olds[i];
        if (used.has(c) || pKey(c)) continue;
        seen++;
        if (pSame(c, n)) {
          o = c;
          pos = i + 1;
          break;
        }
      }
    }
    const put = o ? pUpdate(o, n) : pResolve(n);
    if (put === o) used.add(o);
    out.push(put);
  }
  olds.forEach(o => used.has(o) || o.remove());
  let ref = from.firstChild;
  for (const n of out) {
    if (n === ref) ref = ref.nextSibling;
    else from.insertBefore(n, ref);
  }
}
// (a fingerprint also gives its markup's length, so a part that reads the same as one already
// on the page is cut from the new markup before it's read in, and the one there is kept: on a big
// day most of Today is neither read in again nor compared)
let pKeep = new Map();
function patchHTML(el, html) {
  pKeep = new Map();
  el.querySelectorAll('[data-h]').forEach(e => pKeep.set(e.getAttribute('data-h'), e));
  const re = /<([a-z0-9]+) data-h="([0-9a-z]+\.([0-9a-z]+))"/g;
  let cut = '',
    pos = 0,
    m;
  while ((m = re.exec(html))) {
    if (!pKeep.has(m[2])) continue; // (changed: looked into, for parts inside it that haven't)
    const end = m.index + parseInt(m[3], 36) + (m[0].length - m[1].length - 1);
    if (html[end - 1] !== '>') continue;
    cut += html.slice(pos, m.index) + `<${m[1]} data-pkeep="${m[2]}"></${m[1]}>`;
    pos = re.lastIndex = end;
  }
  const t = document.createElement('template');
  t.innerHTML = pos ? cut + html.slice(pos) : html;
  pChildren(el, t.content);
  pKeep = new Map();
}
// (a new part put in: the parts kept from the page put back in it where they were cut)
function pResolve(n) {
  if (n.nodeType === 1)
    // (data-pkeep: the patch's own name; data-keep is a button's, Carried over's Keep)
    n.querySelectorAll('[data-pkeep]').forEach(
      k => pKeep.has(k.dataset.pkeep) && k.replaceWith(pKeep.get(k.dataset.pkeep)),
    );
  return n;
}
function putHTML(el, html) {
  const page = PATCHED[el.id] && PATCHED[el.id]();
  if (page && el.dataset.page === page) return patchHTML(el, html);
  el.innerHTML = html;
  if (page) el.dataset.page = page;
}
function setHTML(el, html) {
  if (!background) {
    // A redraw after a tap or key press: the keyboard stays on the same control, or (if it went)
    // in this view, rather than falling back to the top of the page.
    const a = document.activeElement,
      inside = a && el.contains(a),
      sel = inside ? focusSel(a) : '';
    putHTML(el, html);
    // (kept by the patch: it keeps the keyboard; if it was moved, as a row moved up is, moving
    // it took the keyboard off it, so it's given back)
    if (inside && a.isConnected && el.contains(a)) {
      if (document.activeElement !== a) a.focus({ preventScroll: true });
      return;
    }
    if (inside) {
      let f = (sel && el.querySelector(sel)) || el;
      // (the control may now be folded away, say a task just ticked into "Done today": the
      // keyboard stays in the view rather than falling to the top of the page)
      if (f !== el && f.closest('details:not([open])')) f = el;
      // (a view laid out as its children alone, as Today in two columns, can't hold the keyboard:
      // its first part does)
      if (f === el) {
        if (getComputedStyle(el).display === 'contents' && el.firstElementChild) f = el.firstElementChild;
        f.tabIndex = -1;
      }
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
  // A two-tap confirmation half done (Delete?, Revoke?): still armed after a sync's redraw, for the
  // rest of its time, so the second tap does what the first asked.
  // (only the same item's: its row must read the same, since some buttons are keyed by their place
  // in a list, and a tag removed elsewhere meanwhile would put another tag's × in its place)
  const rowOf = b =>
    b.parentElement
      ? [...b.parentElement.children]
          .filter(c => c !== b)
          .map(c => c.outerHTML)
          .join('')
      : '';
  const armed = [...el.querySelectorAll('.armed')]
    .map(b => ({
      sel: focusSel(b),
      row: rowOf(b),
      label: b.textContent,
      orig: b.dataset.orig,
      at: +b.dataset.armat || 0,
    }))
    .filter(x => x.sel);
  putHTML(el, html);
  // (the field being typed in, kept by the patch, is left exactly as it is: putting its words and
  // place back would break an Android keyboard's composing)
  const kept = a && a !== document.body && a.isConnected && el.contains(a);
  if (kept && document.activeElement !== a) {
    a.focus({ preventScroll: true });
    if (sel)
      try {
        a.setSelectionRange(sel[0], sel[1]);
      } catch (e) {}
  }
  armed.forEach(x => {
    const b = el.querySelector(x.sel);
    if (b && b.textContent === x.orig && rowOf(b) === x.row) armAgain(b, x.label, x.orig, x.at);
  });
  for (const id in typed) {
    const i = el.querySelector('#' + CSS.escape(id));
    if (i && i.value !== typed[id]) i.value = typed[id];
    if (i && wasTyped.has(id)) i.dataset.typed = '1';
  }
  const f = !kept && fsel && el.querySelector(fsel);
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
const ARM_MS = 3000;
function arm(b, label) {
  if (b.classList.contains('armed')) return true;
  armAgain(b, label, b.textContent, Date.now());
  return false;
}
// (also a redrawn button, armed `at` before: for what's left of its time)
function armAgain(b, label, orig, at) {
  const left = ARM_MS - (Date.now() - at);
  if (left <= 0) return;
  b.classList.add('armed');
  b.dataset.orig = orig;
  b.dataset.armat = at;
  b.textContent = label;
  setTimeout(() => {
    if (b.isConnected && b.classList.contains('armed')) {
      b.classList.remove('armed');
      b.textContent = b.dataset.orig;
      delete b.dataset.armat;
    }
  }, left);
}
// "1 task", "2 tasks".
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
