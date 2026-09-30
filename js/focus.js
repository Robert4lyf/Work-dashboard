/* focus */
const mmss = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
};
const hm = m => (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm');
const remaining = () => (S.timer.left != null ? S.timer.left : S.timer.end - Date.now());
const timerDue = () => !!S.timer && S.timer.left == null && Date.now() >= S.timer.end;
const tagColor = name => {
  const t = S.tags.find(x => x.name === name);
  return t ? t.color : '#C2C3C7';
};
let range = 7;
const tagBadge = name =>
  name ? `<span class="tag" style="background:${tagColor(name)}">${esc(name)}</span>` : '';
function tagPicker(kind, id, cur) {
  let h = '<div class="chips tagpick">';
  S.tags.forEach(
    t =>
      (h += `<button class="chip" style="--c:${t.color}" data-settag="${esc(t.name)}" data-kind="${kind}" data-id="${id}" aria-pressed="${cur === t.name}">${esc(t.name)}</button>`),
  );
  return h + '<button class="linkbtn" data-edittags="1">Edit tags</button></div>';
}
const topOf = id => {
  const r = id && find(id);
  return r ? r.parents[0] || r.n : null;
};
const timerLabel = t => {
  const q = t.q && find(t.q);
  return [t.tag, q && q.n.text].filter(Boolean).join(': ');
};
// What the next session is for: the quest picked here, else the header's "Next up".
function focusTarget() {
  if (S.focusQ === 'none') return null;
  if (S.focusQ && find(S.focusQ) && !isDone(find(S.focusQ).n)) return S.focusQ;
  const nx = nextStep();
  return nx ? nx.n.id : null;
}
// The id of a session already due when the server is being asked whether it was stopped
// elsewhere: only that one waits (a session running out meanwhile still rings).
let holdTimer = '';
const holdDue = () => (holdTimer = timerDue() ? S.timer.id || 'held' : '');
// Once the answer is in (or it took too long): finish it, quietly, if it's still there.
function releaseHeld(id) {
  if (!id || holdTimer !== id) return;
  holdTimer = '';
  if (timerDue()) finishTimer(true);
}
function startTimer(q, mins = S.mins) {
  const top = topOf(q);
  leftFor = null; // (the last session's "where did you leave it?" is past)
  timeUp = null;
  askNotify();
  beep([440]);
  S.timer = { id: uid(), end: Date.now() + mins * 60000, tag: top ? top.tag : '', mins, q };
  save();
  zen = true; // a focus session opens in single-task mode
  renderAll();
  window.scrollTo(0, 0);
}

/* single-task mode: a full-screen view of just the current step and the timer */
let zen = false;
function zenTarget() {
  const id = S.timer ? S.timer.q : focusTarget(),
    r = id && find(id);
  if (!r || S.timer || !r.n.children.length) return r;
  const leaf = nextLeaf(r.n);
  return leaf ? find(leaf.id) : r;
}
// A running (not paused) session holds you in single-task mode: pause or log an
// to get back to the rest of the app.
const focusLocked = () => !!(S.timer && S.timer.left == null);
function renderZen() {
  if (focusLocked()) zen = true;
  document.body.classList.toggle('zen', zen);
  const el = $('#v-zen');
  el.hidden = !zen;
  if (!zen) return;
  const t = S.timer,
    r = zenTarget(),
    leaf = r && !r.n.children.length && !r.n.done;
  let h = focusLocked()
    ? '<div class="zbody">'
    : '<button class="linkbtn zx" id="zenexit">Exit single-task</button><div class="zbody">';
  if (!r) h += '<p class="zt">Nothing left to do.</p>';
  else {
    const trail = r.parents.map(p => p.text).join(' / ');
    h += `${trail ? `<p class="ztrail">${esc(trail)}</p>` : ''}<p class="zt">${esc(r.n.text)}</p>${leftNote(r.n)}`;
  }
  h += afterPrompts();
  if (t) {
    h += `<div class="zclock" id="zclock">${mmss(remaining())}</div>
      <div class="acts"><button class="btn ${t.left != null ? 'green' : 'blue'}" data-pause="1">${t.left != null ? 'Resume' : 'Pause'}</button><button class="btn" data-plus5="1">+5 min</button></div>
      <div class="acts"><button class="btn" data-stop="save">Stop and save</button>${leaf ? '<button class="btn green" data-stop="done">Done</button>' : ''}</div>
      <button class="dellink" data-discard="1" style="align-self:center">Discard this session</button>`;
  } else if (r && !timeUpShown()) {
    h += `<div class="acts"><button class="btn blue" data-zstart="${r.n.id}">Start ${+S.mins} min</button>${leaf ? `<button class="btn green" data-toggle="${r.n.id}">Done</button>` : ''}</div>`;
  }
  setHTML(el, h + '</div>'); // a background redraw keeps what's being typed
}
function setZen(on) {
  if (!on && focusLocked()) return;
  zen = on;
  renderZen();
  renderFocus(); // the note and interruption prompts show in whichever view is open
  window.scrollTo(0, 0);
}

function renderFocus() {
  let h = '<h2>Focus</h2>';
  if (!zen) h += afterPrompts();
  if (S.timer) {
    const t = S.timer,
      q = t.q && find(t.q),
      paused = t.left != null,
      leaf = q && !q.n.children.length && !q.n.done;
    h += `<div class="clock box" id="clock">${mmss(remaining())}<small>${paused ? 'Paused · ' : ''}${esc(timerLabel(t)) || 'Focus'}</small></div>`;
    h += `<div class="acts" style="margin-top:0"><button class="btn ${paused ? 'green' : 'blue'}" data-pause="1" style="flex:1">${paused ? 'Resume' : 'Pause'}</button><button class="btn" id="plus5" style="flex:1">+5 min</button></div>`;
    h += `<div class="acts"><button class="btn" id="stopsave" style="flex:1">Stop and save</button>${leaf ? '<button class="btn green" id="stopdone" style="flex:1">Done</button>' : ''}</div><button class="dellink" id="stop">Discard this session</button>`;
  } else {
    const cur = focusTarget(),
      opts = [];
    (function w(ns, trail) {
      ns.forEach(n => {
        if (isDone(n)) return;
        const tr = [...trail, n.text];
        opts.push([n.id, tr.join(' / ')]);
        w(n.children, tr);
      });
    })(S.quests, []);
    const top = topOf(cur);
    h += `<label class="f" for="fq" style="margin-top:0">Working on ${top ? tagBadge(top.tag) : ''}</label><select class="fld" id="fq"><option value="none"${cur ? '' : ' selected'}>Nothing specific</option>${opts.map(([id, l]) => `<option value="${id}"${id === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${cur ? leftNote(find(cur).n) : ''}`;
    h += '<div class="chips" style="margin-top:14px">';
    [15, 25, 45].forEach(
      m => (h += `<button class="chip" data-mins="${m}" aria-pressed="${S.mins === m}">${m} min</button>`),
    );
    h += `</div><button class="btn green" id="start" style="width:100%">Start ${+S.mins} min</button>`;
  }
  setHTML($('#v-focus'), h);
}
function renderStats() {
  const since = shift(today(), -(range - 1)),
    tot = {};
  let sum = 0;
  for (const d in S.daily)
    if (d >= since)
      for (const t in S.daily[d]) {
        tot[t] = (tot[t] || 0) + S.daily[d][t];
        sum += S.daily[d][t];
      }
  const rows = Object.keys(tot)
    .filter(k => tot[k] > 0)
    .map(k => [k || 'Untagged', k ? tagColor(k) : 'var(--muted)', tot[k]])
    .sort((a, b) => b[2] - a[2]);
  const max = Math.max(1, ...rows.map(r => r[2]));
  let h = '<div class="bars box" style="margin:0 0 22px"><div class="chips rng">';
  [
    [7, 'Week'],
    [30, 'Month'],
    [365, 'Year'],
  ].forEach(
    ([n, l]) => (h += `<button class="chip" data-range="${n}" aria-pressed="${range === n}">${l}</button>`),
  );
  h += `</div><h2>Focus, last ${range} days: ${hm(sum)}</h2>`;
  if (sum) h += `<p class="hint" style="margin:0">About ${hm(Math.round(sum / range))} a day</p>`;
  rows.forEach(([t, c, m]) => {
    h += `<div class="bar"><span>${esc(t)}</span><div class="track"><div style="width:${(m / max) * 100}%;background:${c}"></div></div><span>${hm(m)}</span></div>`;
  });
  return h + '</div>';
}
function logSession(tag, mins, t, q, tid) {
  const p = projectOf(q);
  // tid: the timer's id, so the same session ended on two devices is one record, not two.
  S.sessions.push({ tag, mins, t, q: q || null, p, ...(tid ? { tid } : {}) });
  addDaily(fmt(new Date(t)), tag, mins);
  addPDaily(fmt(new Date(t)), p, mins);
}
function finishTimer(silent) {
  const t = S.timer;
  S.timer = null;
  leftFor = t.q;
  timeUp = { q: t.q }; // done, more time, or stop: asked (see afterPrompts)
  S.focusQ = null;
  logSession(t.tag, t.mins, t.end, t.q, t.id);
  addXP(20);
  save();
  if (!silent) {
    beep([523, 659, 784, 1047]);
    try {
      navigator.vibrate && navigator.vibrate([200, 100, 200]);
    } catch (e) {}
    if (document.hidden)
      if (!pushEndpoint)
        // Devices with push notifications on get the server's notification instead.
        notify('Focus session done', t.mins + ' min' + (timerLabel(t) ? ' · ' + timerLabel(t) : ''));
  }
  renderAll();
}
function stopAndSave(done) {
  const t = S.timer;
  if (!t) return;
  const m = Math.floor((t.mins * 60000 - remaining()) / 60000);
  S.timer = null;
  S.focusQ = null;
  if (m >= 1) {
    logSession(t.tag, m, t.left != null && t.pausedAt ? t.pausedAt : Date.now(), t.q, t.id);
    addXP(Math.max(1, Math.round((20 * m) / t.mins)));
  }
  const r = done && t.q && find(t.q);
  if (!done) leftFor = t.q;
  if (r) {
    const bf = snapshot();
    r.n.done = true;
    settle(bf);
  } else {
    save();
    renderAll();
  }
  if (m < 1 && !r) toast('Under a minute, nothing saved');
}
/* "where did I leave it?": after a session stops, one line for next time, shown on that step */
let leftFor = null, // the step whose session just stopped
  timeUp = null, // a session that ran out: { q }, until you say what next
  pauseAsk = null; // a pause waiting to be explained: { t, q }
function leftNote(n) {
  return n && n.left
    ? `<div class="leftnote"><span>You left off:</span> ${esc(n.left.text)} <small>${dayLabel(n.left.d)}</small><button class="x" data-clearleft="${n.id}" aria-label="Clear note">×</button></div>`
    : '';
}
// Whether the time's-up question is showing (for the session's step, if it had one).
function timeUpShown() {
  if (!timeUp || S.timer) return false;
  const r = timeUp.q && find(timeUp.q);
  return !timeUp.q || !!(r && !isDone(r.n));
}
function afterPrompts() {
  let h = '';
  if (timeUpShown()) {
    const r = timeUp.q && find(timeUp.q),
      leaf = r && !r.n.children.length;
    return `<div class="ask box timeup" id="timeup"><p class="tuh">Time's up${r ? ': ' + esc(r.n.text) : ''}</p><div class="acts">${leaf ? '<button class="btn green" data-tu="done">Done</button>' : ''}<button class="btn blue" data-tu="5">+5 min</button><button class="btn blue" data-tu="15">+15 min</button></div><button type="button" class="linkbtn" data-tu="stop">Stop for now</button></div>`;
  }
  const r = leftFor && find(leftFor);
  if (r && !isDone(r.n))
    h += `<form class="ask box" id="leftform"><label for="leftin">Where did you leave it?</label><div class="addrow"><input id="leftin" maxlength="160" placeholder="Next step, or what you were thinking" autocomplete="off"><button class="btn">Save</button></div><button type="button" class="linkbtn" id="leftskip">Skip</button></form>`;
  if (pauseAsk && S.timer && S.timer.left != null) {
    const chips = recentWhys()
      .map(w => `<button type="button" class="chip" data-why="${esc(w)}">${esc(w)}</button>`)
      .join('');
    h += `<form class="ask box" id="whyform"><label for="whyin">What paused you?</label><div class="chips"><button type="button" class="chip" id="whyskip">Just a break</button>${chips}</div><div class="addrow"><input id="whyin" maxlength="60" placeholder="Interrupted? A call, a message, someone…" autocomplete="off"><button class="btn">Save</button></div></form>`;
  }
  return h;
}
function saveLeft(text) {
  const r = leftFor && find(leftFor);
  leftFor = null;
  if (r && text) r.n.left = { text, d: today() };
  save();
  renderAll();
}
// The answer to "time's up": tick the step off, carry on for a few more minutes, or stop (and
// say where you left it).
function answerTimeUp(a) {
  const tu = timeUp;
  if (!tu) return;
  timeUp = null;
  if (a === 'stop') return renderAll();
  if (a === 'done') {
    const r = tu.q && find(tu.q);
    leftFor = null;
    if (!r || r.n.children.length) return renderAll();
    const bf = snapshot();
    r.n.done = true;
    return settle(bf);
  }
  startTimer(tu.q, +a);
}
/* pausing: one button. It asks what paused you; naming a cause logs an interruption,
   "Just a break" (or ignoring it) logs nothing. */
function togglePause() {
  const t = S.timer;
  if (!t || timerDue()) return; // (over: it's about to finish)
  if (t.left != null) {
    t.end = Date.now() + t.left;
    delete t.left;
    delete t.pausedAt;
    pauseAsk = null;
  } else {
    t.left = Math.max(0, t.end - Date.now());
    t.pausedAt = Date.now(); // stopped later, the minutes count for when they were done
    pauseAsk = { t: Date.now(), q: t.q || null };
  }
  save();
  renderAll();
}
function saveWhy(why) {
  const a = pauseAsk;
  pauseAsk = null;
  if (a && why) S.interrupts.push({ id: uid(), t: a.t, q: a.q, why });
  save();
  renderAll();
}
// Reasons used before, most frequent first.
function recentWhys() {
  const n = {};
  S.interrupts.forEach(x => x.why && (n[x.why] = (n[x.why] || 0) + 1));
  return Object.keys(n)
    .sort((a, b) => n[b] - n[a])
    .slice(0, 5);
}
function askNotify() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      const p = Notification.requestPermission();
      if (p && p.catch) p.catch(() => {});
    }
  } catch (e) {}
}
function notify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const o = { body, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'cockpit-timer' };
    if (navigator.serviceWorker && navigator.serviceWorker.controller)
      navigator.serviceWorker.ready.then(r => r.showNotification(title, o)).catch(() => {});
    else new Notification(title, o);
  } catch (e) {}
}
// Every quest, inbox item and template, for tag renames and deletes.
function eachTagged(fn) {
  const w = n => {
    fn(n);
    (n.children || []).forEach(w);
  };
  S.quests.forEach(w);
  S.later.forEach(w);
  S.templates.forEach(w);
  S.inbox.forEach(i => {
    fn(i);
    if (i.node) w(i.node);
  });
}
function renameTag(i, v) {
  const old = S.tags[i].name;
  v = cleanText(v.trim());
  if (!v || v === old) return;
  if (S.tags.some(t => t.name === v)) {
    toast('That tag already exists');
    return;
  }
  S.tags[i].name = v;
  eachTagged(n => {
    if (n.tag === old) n.tag = v;
  });
  S.sessions.forEach(x => {
    if (x.tag === old) x.tag = v;
  });
  for (const d in S.oldDaily) {
    const o = S.oldDaily[d];
    if (old in o) {
      o[v] = (o[v] || 0) + o[old];
      delete o[old];
    }
  }
  rebuildTotals();
  if (S.timer && S.timer.tag === old) S.timer.tag = v;
}
// Runs twice a second once the app has loaded (started from events.js).
function timerTick() {
  const t = S.timer;
  if (!t) {
    if (document.title !== TITLE) document.title = TITLE;
    return;
  }
  if (timerDue() && (t.id || 'held') !== holdTimer) return inBackground(() => finishTimer());
  const txt = mmss(remaining());
  document.title = txt + (t.left != null ? ' paused' : '') + ' · ' + TITLE;
  const c = $('#clock');
  if (c) c.firstChild.nodeValue = txt;
  const hc = $('#hclock');
  if (hc) hc.textContent = txt;
  const zc = $('#zclock');
  if (zc) zc.textContent = txt;
}
