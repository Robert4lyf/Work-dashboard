/* header */
// The first unfinished step of the first unfinished quest, in list order.
function nextStep() {
  for (const q of S.quests) {
    if (isDone(q) || q.wait) continue;
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
      h = `<button class="check" data-toggle="${nx.n.id}" aria-label="Mark done: ${esc(nx.n.text)}">${tick}</button><button class="go" data-open="${nx.n.id}"><small>Next up${nx.n !== nx.q ? ' in ' + esc(nx.q.text) : ''}</small><b>${esc(nx.n.text)}</b></button><button class="btn sm zenbtn" data-zen="1">Focus</button>`;
    else
      h = `<button class="go" data-v="today"><small>Next up</small><b>${S.quests.length ? 'All done for today' : 'Nothing planned yet'}</b></button>`;
  }
  $('#hnow').innerHTML = h;
  const qs = S.quests,
    done = qs.filter(isDone).length,
    p = qs.length ? Math.round((done / qs.length) * 100) : 0;
  $('#hfill').style.width = p + '%';
  $('#hprog').setAttribute('aria-valuenow', p);
  // One quiet line of stats; anything needing attention is on Today and in tab badges.
  const focus = Object.values(S.daily[today()] || {}).reduce((a, b) => a + b, 0);
  let st = `<button data-v="today">${done}/${qs.length} done</button><button data-v="focus">${hm(focus)} focus</button>`;
  const ms = meetingStatus();
  if (ms) st += `<button data-v="today">${ms}</button>`;
  $('#hstats').innerHTML = st;
  const b = $('#inboxBadge');
  b.hidden = !S.inbox.length;
  b.textContent = S.inbox.length;
  const w = $('#waitBadge'),
    ch = chaseDue();
  w.hidden = !ch;
  w.textContent = ch || '';
  $('#reviewDot').hidden = !reviewDue();
  renderSyncBadge();
}
