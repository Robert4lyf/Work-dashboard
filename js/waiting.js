/* waiting: a quest or step can wait on someone, n.wait = { who, note, due (when to chase), since }.
   It stays on Today with a "Waiting" tag, but isn't "Next up"; the Waiting tab lists them all. */
function waitingNodes() {
  const out = [];
  (function w(ns, trail) {
    ns.forEach(n => {
      if (isDone(n)) return;
      if (n.wait) out.push({ n, trail });
      w(n.children, [...trail, n.text]);
    });
  })(S.quests, []);
  S.later.forEach(n => n.wait && out.push({ n, trail: [], start: n.start }));
  S.inbox.forEach(i => i.wait && out.push({ n: i, trail: [], inbox: true }));
  return out;
}
const chaseDue = () => waitingNodes().filter(x => x.n.wait.due && x.n.wait.due <= today()).length;
function chaseTag(w) {
  if (!w.due) return '';
  const t = today(),
    cls = w.due < t ? 'late' : w.due === t ? 'now' : 'due';
  return `<span class="tag ${cls}">${w.due < t ? 'Chase now' : w.due === t ? 'Chase today' : 'Chase ' + niceDate(w.due)}</span>`;
}
const waitBadge = n =>
  n.wait ? `<span class="tag wait">Waiting${n.wait.who ? ' on ' + esc(n.wait.who) : ''}</span>` : '';
// Open steps somewhere under a quest that are waiting on someone.
function waitingSteps(n) {
  const out = [];
  (function w(ns) {
    ns.forEach(c => {
      if (isDone(c)) return;
      if (c.wait) out.push(c);
      w(c.children);
    });
  })(n.children);
  return out;
}
// A quest with a waiting step shows as waiting too, naming who (or how many steps).
function stepWaitBadge(n) {
  const ws = waitingSteps(n);
  if (!ws.length) return '';
  const who = [...new Set(ws.map(c => c.wait.who).filter(Boolean))];
  return `<span class="tag wait">${ws.length > 1 ? ws.length + ' steps waiting' : 'Step waiting'}${who.length === 1 ? ' on ' + esc(who[0]) : ''}</span>`;
}
// On a quest's page: set it waiting, change the details, or stop waiting.
function waitPanel(n) {
  const w = n.wait || {};
  return `<details id="waitd"${panels.waitd || n.wait ? ' open' : ''}><summary>${n.wait ? 'Waiting' + (w.who ? ' on ' + esc(w.who) : '') : 'Waiting on someone?'}</summary>
    <label class="f" for="wwho">Who</label><input class="fld" id="wwho" maxlength="60" value="${esc(w.who || '')}" list="wholist" autocomplete="off">
    <label class="f" for="wnote">For what</label><input class="fld" id="wnote" maxlength="160" value="${esc(w.note || '')}" autocomplete="off">
    <label class="f" for="wdue">Chase on</label><input class="fld" type="date" id="wdue" value="${w.due || ''}">
    ${whoList()}<div class="acts"><button class="btn blue" data-waitsave="${n.id}">${n.wait ? 'Save' : 'Set waiting'}</button>${n.wait ? `<button class="btn green" data-waitclear="${n.id}">Got it</button>` : ''}</div></details>`;
}
function whoList() {
  const people = [
    ...new Set(
      waitingNodes()
        .map(x => x.n.wait.who)
        .filter(Boolean),
    ),
  ];
  return `<datalist id="wholist">${people.map(w => `<option value="${esc(w)}">`).join('')}</datalist>`;
}
function setWaiting(id, w) {
  const r = find(id) || { n: S.later.find(x => x.id === id) || S.inbox.find(x => x.id === id) };
  if (!r.n) return;
  if (w) r.n.wait = { since: (r.n.wait && r.n.wait.since) || today(), ...w };
  else delete r.n.wait;
  save();
  renderAll();
}
function renderWaiting() {
  const all = waitingNodes().sort((a, b) =>
    (a.n.wait.due || '9') < (b.n.wait.due || '9')
      ? -1
      : (a.n.wait.due || '9') > (b.n.wait.due || '9')
        ? 1
        : 0,
  );
  let h = `<h2>Waiting</h2><form class="pform box" id="wform">
    <input class="fld" id="wwhat" maxlength="120" placeholder="What you're waiting for" aria-label="What" autocomplete="off">
    <div class="prow2"><input class="fld" id="wfrom" maxlength="60" placeholder="From whom" aria-label="From whom" list="wholist2" autocomplete="off"><input class="fld" type="date" id="wchase" aria-label="Chase on (optional)"></div>
    ${whoList().replace('wholist', 'wholist2')}<button class="btn">Add</button></form>`;
  if (!all.length) h += '<div class="empty">Nothing to chase.</div>';
  else {
    h += '<div class="list box">';
    all.forEach(({ n, trail, start, inbox }) => {
      const w = n.wait,
        meta = [
          w.who ? 'from ' + esc(w.who) : '',
          w.note ? esc(w.note) : '',
          trail.length ? 'in ' + esc(trail.join(' / ')) : '',
          start ? 'on Upcoming, ' + dayLabel(start) : '',
          inbox ? 'in Inbox' : '',
        ]
          .filter(Boolean)
          .join(' · ');
      h += `<div class="row">${(n.children && n.children.length) || start || inbox ? '' : `<button class="check" data-toggle="${n.id}" aria-label="Done: ${esc(n.text)}">${tick}</button>`}<button class="open"${inbox ? ' data-v="inbox"' : ` data-open="${n.id}"`}><span>${esc(n.text)}</span><small>${meta} ${chaseTag(w)}</small></button><button class="btn sm" data-waitclear="${n.id}">Got it</button></div>`;
    });
    h += '</div>';
  }
  setHTML($('#v-waiting'), h);
}
// The add box on the Waiting tab: an Inbox item that is already waiting.
function addWaiting() {
  const what = $('#wwhat').value.trim();
  if (!what) return;
  S.inbox.unshift({
    id: uid(),
    text: what,
    wait: { who: $('#wfrom').value.trim(), note: '', due: $('#wchase').value || '', since: today() },
  });
  save();
  renderAll();
  toast('Added to Inbox');
  $('#wwhat').focus();
}
