/* header */
// The first unfinished step of the first unfinished quest, in list order.
function nextStep() {
  for (const q of S.quests) {
    if (isDone(q)) continue;
    const n = q.children.length ? nextLeaf(q) : q;
    if (n) return { n, q };
  }
  return null;
}
function renderHeader() {
  let h;
  if (S.timer && view !== 'focus' && !onBoard()) {
    const t = S.timer,
      paused = t.left != null;
    h = `<button class="go" data-v="focus"><span class="clk" id="hclock">${mmss(remaining())}</span><small>${paused ? 'Paused · ' : ''}${esc(timerLabel(t))}</small></button><button class="btn ${paused ? 'green' : 'blue'}" data-pause="1">${paused ? 'Resume' : 'Pause'}</button>`;
  } else {
    const nx = nextStep();
    if (nx)
      h = `<button class="check" data-toggle="${nx.n.id}" aria-label="Mark done: ${esc(nx.n.text)}">${tick}</button><button class="go" data-open="${nx.n.id}"><small>Next up${nx.n !== nx.q ? ' in ' + esc(nx.q.text) : ''}</small><b>${esc(nx.n.text)}</b></button>`;
    else
      h = `<button class="go" data-v="today"><small>Next up</small><b>${S.quests.length ? 'All done for today' : 'Nothing planned yet'}</b></button>`;
  }
  $('#hnow').innerHTML = h;
  const qs = S.quests,
    done = qs.filter(isDone).length,
    p = qs.length ? Math.round((done / qs.length) * 100) : 0;
  $('#hfill').style.width = p + '%';
  $('#hprog').setAttribute('aria-valuenow', p);
  const t = today();
  let late = 0,
    due = 0;
  (function w(ns) {
    ns.forEach(n => {
      if (isDone(n)) return;
      if (n.due && n.due < t) late++;
      else if (n.due === t) due++;
      w(n.children);
    });
  })(qs);
  const focus = Object.values(S.daily[t] || {}).reduce((a, b) => a + b, 0);
  let st = `<button data-v="today">${done}/${qs.length} done</button><button data-v="focus">${hm(focus)} focus</button><button class="pill" data-zen="1">Single-task</button>`;
  const ms = meetingStatus();
  if (ms) st += `<button data-v="today">${ms}</button>`;
  if (late) st += `<button class="warn" data-v="today">${late} overdue</button>`;
  if (due)
    st += `<button class="warn" data-v="today" style="background:var(--orange)">${due} due today</button>`;
  const pd = promisesDue();
  if (pd) st += `<button class="warn" data-v="promises">${pd} promise${pd === 1 ? '' : 's'} due</button>`;
  $('#hstats').innerHTML = st;
  const b = $('#inboxBadge');
  b.hidden = !S.inbox.length;
  b.textContent = S.inbox.length;
  renderSyncBadge();
}
