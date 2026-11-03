/* header */
// The first unfinished step of the first unfinished quest, in list order. Quests with a waiting
// step come last, as they're listed on Today.
function nextStep() {
  const free = [],
    blocked = [];
  S.quests.forEach(q => !isDone(q) && !q.wait && (showsWaiting(q) ? blocked : free).push(q));
  for (const q of [...free, ...blocked]) {
    const n = q.children.length ? nextLeaf(q) : q;
    if (n) return { n, q };
  }
  return null;
}
// What to work on next, by one rule, so the header, Focus, single-task mode and the checklists
// agree (a running session is shown instead, by the header itself): a place saved today or
// yesterday (the newest), else the first Top 3 quest with a step to do, else the first step in
// list order. Nothing is reordered, chosen or started by it. `why` says which: 'place', 'top3'
// (with its rank) or 'list'.
function recommend() {
  const since = shift(today(), -1),
    placed = S.quests
      .filter(q => q.resume && !isDone(q) && fmt(new Date(q.resume.at)) >= since)
      .sort((a, b) => b.resume.at - a.resume.at)[0];
  if (placed) {
    const st = placeStep(placed),
      n = st && !isDone(st) && !st.wait ? st : focusLeaf(placed);
    if (n) return { n, q: placed, why: 'place' };
  }
  const ids = top3Ids();
  for (let i = 0; i < ids.length; i++) {
    const q = S.quests.find(x => x.id === ids[i]);
    if (!q || isDone(q) || q.wait) continue;
    const n = q.children.length ? nextLeaf(q) : q;
    if (n) return { n, q, why: 'top3', rank: i + 1 };
  }
  const nx = nextStep();
  return nx ? { ...nx, why: 'list' } : null;
}
function renderHeader() {
  // The next step on a line of its own; what you can do about it on the row below, with search
  // and sync.
  let h,
    acts = '';
  if (S.timer && view !== 'focus') {
    const t = S.timer,
      paused = t.left != null;
    h = `<button class="go" data-v="focus"><span class="clk" id="hclock">${mmss(remaining())}</span><small>${paused ? 'Paused · ' : ''}${esc(timerLabel(t))}</small></button>`;
    acts = `<button class="btn sm ${paused ? 'green' : 'blue'}" data-pause="1">${paused ? 'Resume' : 'Pause'}</button>`;
  } else {
    const nx = recommend(),
      ask = !nx && S.quests.find(q => needsNext(q) && !q.wait); // (every step ticked: what's next?)
    if (ask) {
      h = `<button class="go" data-open="${ask.id}"><small>Every step ticked in ${esc(ask.text)}</small><b>What's next?</b></button>`;
    } else if (nx && nx.why === 'place') {
      // Where work stopped: picking it up opens the saved place, in single-task mode.
      h = `<button class="go" data-open="${nx.q.id}"><small>Pick up where you left off · ${esc(nx.q.text)}</small><b>${esc(nx.n.text)}</b></button>`;
      acts = `<button class="btn sm green" data-resume="${nx.q.id}">Resume</button>`;
    } else if (nx) {
      const label = nx.why === 'top3' ? `Top 3 priority ${nx.rank}` : 'Next task',
        where = nx.n !== nx.q ? ' · ' + esc(nx.q.text) : '';
      h = `<button class="check" data-toggle="${nx.n.id}" aria-pressed="false" aria-label="Mark done: ${esc(nx.n.text)}">${tick}</button><button class="go" data-open="${nx.n.id}"><small>${label}${where}</small><b>${esc(nx.n.text)}</b></button>`;
      acts = `<button class="btn sm zenbtn" data-zen="1" data-q="${nx.n.id}">Focus</button>`;
    } else
      h = `<button class="go" data-v="today"><small>Next task</small><b>${S.quests.length ? 'All done for today' : 'Nothing planned yet'}</b></button>`;
  }
  setIfChanged($('#hnow'), h); // unchanged: left alone, keeping keyboard focus
  setIfChanged($('#hact'), acts);
  const qs = S.quests,
    done = qs.filter(isDone).length,
    p = qs.length ? Math.round((done / qs.length) * 100) : 0;
  $('#hfill').style.width = p + '%';
  $('#hprog').setAttribute('aria-valuenow', p);
  // One quiet line of stats; anything needing attention is on Today and in tab badges.
  const focus = Object.values(S.daily[today()] || {}).reduce((a, b) => a + b, 0);
  let st = focus ? `<button data-v="focus">${hm(focus)} focus</button>` : '';
  const na = nextAlarm();
  if (na)
    st += `<button data-v="today" class="halarm">Alarm ${na.snooze ? hhmmOf(na.snooze) : na.time}</button>`;
  setIfChanged($('#hstats'), st);
  const b = $('#inboxBadge');
  b.hidden = !S.inbox.length;
  b.textContent = S.inbox.length;
  $('#waitBadge').hidden = true; // (the chase count is Today's chip now)
  $('#reviewDot').hidden = !reviewDue();
  renderSyncBadge();
}
const shown = new WeakMap();
function setIfChanged(el, html) {
  if (shown.get(el) === html) return;
  shown.set(el, html);
  // The keyboard stays on the same control (say the tick, after ticking) if it's still there.
  const a = document.activeElement,
    sel = a && el.contains(a) ? focusSel(a) : '';
  el.innerHTML = html;
  const f = sel && el.querySelector(sel);
  if (f) f.focus({ preventScroll: true });
  // (after the user's own action only: a sync's redraw mustn't move the keyboard to another tick)
  else if (sel && !background) (el.querySelector('button') || el).focus({ preventScroll: true });
}
