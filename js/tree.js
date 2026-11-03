/* tree helpers */
// A quest with steps is finished when you say so (its own done), with every step that counts
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
// Finished quests sink below open ones at every level; open ones keep their order,
// so the top open quest is always "Next up".
function sinkDone(ns) {
  const open = ns.filter(n => !isDone(n)),
    done = ns.filter(isDone);
  ns.splice(0, ns.length, ...open, ...done);
  ns.forEach(n => sinkDone(n.children));
}
function settle(before) {
  // A finished quest with a step to do again (added, or un-ticked) isn't finished any more:
  // ticking that step asks what's next, rather than finishing it again.
  // One left asking what's next is marked so, so it isn't taken for one finished before this
  // version (see norm).
  [...S.quests, ...S.later].forEach(q => {
    if (q.done && q.children.length && !stepsDone(q)) q.done = false;
    if (needsNext(q)) q.asked = 1;
  });
  dropDonePlaces(); // (a finished quest has nothing to come back to)
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
  // A quest's last step just ticked here (not one removed): ask what's next.
  let ask = null;
  after.forEach((v, id) => {
    const b = before.get(id);
    if (v.top && v.ready && b && !b.ready && !b.done && v.kids === b.kids) ask = ask || id;
  });
  save();
  renderAll();
  if (ask && S.quests.some(q => q.id === ask)) askNext(ask);
}
// The last step's ticked: add the next one, add a reminder to work it out, or finish the quest.
// (Closed without an answer, the quest stays on Today asking, until you add a step or finish it.)
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
        ['finish', 'Finish quest', 'blue'],
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
  const bf = snapshot(); // (a repeating quest with every step ticked is finished: see isDone)
  let t = tplFor(n) || S.templates.find(x => x.auto && x.text === n.text); // (never a saved one)
  if (!t) {
    t = { id: uid(), days: [], monthDay: 0, auto: true };
    S.templates.push(t);
  }
  n.tpl = t.id;
  Object.assign(t, strip(n));
  if (!n.links) delete t.links; // (assigning can't take a key away)
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
  const f = el.querySelector('[autofocus], .qact, input, textarea, select, button');
  if (f) f.focus();
}
function closeSheet(answer) {
  const el = $('#sheet'),
    cb = sheetCb,
    back = sheetOpener;
  sheetCb = null;
  sheetOpener = null;
  if (el) {
    el.remove();
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
document.addEventListener(
  'click',
  e => {
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
  el.innerHTML = html;
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
