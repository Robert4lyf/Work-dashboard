/* waiting: a subquest (or an Inbox item) can wait on someone, n.wait = { who, note (what for),
   due (when to chase next), since (when asked), expect (when a reply was promised), last (the
   latest follow-up) }. A quest itself doesn't: it shows as waiting through its steps. Waiting
   steps aren't "Next up"; the Waiting Centre lists them all, by urgency or by person.
   Follow-ups are records of their own (S.follows, kind 'follow': { id, n, t, d, k, note }),
   appended and never edited, so the quest's row stays small and two devices adding one each
   keep both. k: start, chase (a follow-up), expect (a new promised date), resolve, reopen. */
const FOLLOW_KINDS = ['start', 'chase', 'expect', 'resolve', 'reopen'];
const FOLLOW_MAX = 200; // characters in a follow-up's note
// Open items waiting on someone among `ns` and their open steps, with the path to each.
function openWaiting(ns, trail = [], out = []) {
  ns.forEach(n => {
    if (isDone(n)) return;
    if (n.wait) out.push({ n, trail });
    openWaiting(n.children, [...trail, n.text], out);
  });
  return out;
}
function waitingNodes() {
  const out = openWaiting(S.quests);
  // Upcoming quests and quests back in the Inbox: their waiting steps too.
  S.later.forEach(n => openWaiting([n]).forEach(x => out.push({ ...x, start: n.start })));
  S.inbox.forEach(i => {
    if (i.wait) out.push({ n: i, trail: [], inbox: true });
    if (i.node) openWaiting(i.node.children, [i.text]).forEach(x => out.push({ ...x, inbox: true }));
  });
  return out;
}
// A step, quest or Inbox item by id, wherever it is (Today, Upcoming, or in the Inbox).
function findWaitable(id) {
  const it = S.inbox.find(x => x.id === id);
  return (
    find(id) ||
    find(id, S.later) ||
    find(id, S.inbox.map(i => i.node).filter(Boolean)) || { n: it, parents: [] }
  );
}
const chaseDue = () => waitingNodes().filter(x => x.n.wait.due && x.n.wait.due <= today()).length;
function chaseTag(w) {
  const t = today();
  if (w.due) {
    const cls = w.due < t ? 'late' : w.due === t ? 'now' : 'due';
    return `<span class="tag ${cls}">${w.due < t ? 'Chase now' : w.due === t ? 'Chase today' : 'Chase ' + niceDate(w.due)}</span>`;
  }
  if (w.expect && w.expect < t) return '<span class="tag late">Reply overdue</span>';
  return '';
}
const waitBadge = n =>
  n.wait ? `<span class="tag wait">Waiting${n.wait.who ? ' on ' + esc(n.wait.who) : ''}</span>` : '';
// Open steps somewhere under a quest that are waiting on someone.
function waitingSteps(n) {
  return openWaiting(n.children).map(x => x.n);
}
// Waiting on someone, itself or through one of its steps (such rows show dark orange).
const showsWaiting = n => !isDone(n) && !!(n.wait || waitingSteps(n).length);
// A quest with a waiting step shows as waiting too, naming who (or how many steps).
function stepWaitBadge(n) {
  const ws = waitingSteps(n);
  if (!ws.length) return '';
  const who = [...new Set(ws.map(c => c.wait.who).filter(Boolean))];
  return `<span class="tag wait">${ws.length > 1 ? ws.length + ' waiting' : 'Waiting'}${who.length === 1 ? ' on ' + esc(who[0]) : ''}</span>`;
}

/* follow-ups: the history of one waiting item */
const followsFor = id => S.follows.filter(f => f.n === id).sort((a, b) => a.t - b.t);
function addFollow(id, k, note = '') {
  S.follows.push({
    id: uid(),
    n: id,
    t: Date.now(),
    d: today(),
    k,
    note: cleanText(note).trim().slice(0, FOLLOW_MAX),
  });
}
// A waiting item's history goes with it when its wait moves to another node (an Inbox item
// taken to Today waits through a step of its own; a quest moved to the Inbox the other way).
function rekeyFollows(from, to) {
  if (!from || !to || from === to) return;
  S.follows.forEach(f => {
    if (f.n === from) f.n = to;
  });
}
const FOLLOW_LABEL = {
  start: 'Asked',
  chase: 'Followed up',
  expect: 'Reply promised',
  resolve: 'Resolved',
  reopen: 'Reopened',
};
// The history as a short list (the latest first), or nothing.
function followList(id, limit = 6) {
  const fs = followsFor(id).slice().reverse();
  if (!fs.length) return '';
  return `<ul class="flist">${fs
    .slice(0, limit)
    .map(
      f =>
        `<li><small>${esc(dayLabel(f.d))}</small><span><b>${FOLLOW_LABEL[f.k] || f.k}</b>${f.note ? ': ' + esc(f.note) : ''}</span></li>`,
    )
    .join('')}${fs.length > limit ? `<li class="hint">and ${fs.length - limit} earlier</li>` : ''}</ul>`;
}
// On a quest's page: set it waiting, change the details (saved as each is changed), or stop
// waiting. On a quest (top): adds a waiting subquest, named by "For what". With history: the
// follow-ups so far, and a way to record one (or to reopen a resolved item).
function waitPanel(n, top) {
  const w = n.wait || {},
    hist = followList(n.id),
    resolved = !n.wait && !top && followsFor(n.id).some(f => f.k === 'resolve');
  return `<details id="waitd"${panels.waitd || n.wait ? ' open' : ''}${n.wait ? ` data-held="1" data-waitid="${n.id}"` : ''}><summary>${n.wait ? 'Waiting' + (w.who ? ' on ' + esc(w.who) : '') : top ? 'Waiting on someone? Add it as a subquest' : 'Waiting on someone?'}</summary>
    <label class="f" for="wwho">Who</label><input class="fld" id="wwho" maxlength="60" value="${esc(w.who || '')}" list="wholist" autocomplete="off">
    <label class="f" for="wnote">For what</label><input class="fld" id="wnote" maxlength="160" value="${esc(w.note || '')}" autocomplete="off">
    <label class="f" for="wdue">Chase on</label><input class="fld" type="date" id="wdue" value="${w.due || ''}">
    <label class="f" for="wexp">Reply expected by <small class="hint">(optional)</small></label><input class="fld" type="date" id="wexp" value="${w.expect || ''}">
    ${whoList()}<div class="acts">${
      n.wait
        ? `<button class="btn green" data-waitclear="${n.id}">Got it</button><button class="btn" data-chase="${n.id}">Follow up</button><button class="btn sm qmore" data-wact="${n.id}" aria-label="More for this waiting item" aria-haspopup="dialog">${dots}</button>`
        : `<button class="btn blue" data-waitsave="${n.id}">${resolved ? 'Reopen: set waiting again' : 'Set waiting'}</button>`
    }</div>${hist ? `<p class="hint fhead">Follow-ups</p>${hist}` : ''}</details>`;
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
// The waiting panel's fields, as they are now.
// `quiet`: a detail changed on a quest already waiting. Saved without redrawing the panel, which
// would take the field out from under a tap or Tab that's moving on (only its heading and the
// badges change, in place).
function saveWaitPanel(id, quiet) {
  const w = {
    who: $('#wwho').value.trim(),
    note: $('#wnote').value.trim(),
    due: $('#wdue').value || '',
    expect: ($('#wexp') && $('#wexp').value) || '',
  };
  if (!quiet) return setWaiting(id, w);
  const r = findWaitable(id);
  if (!r.n || !r.n.wait) return;
  const was = r.n.wait;
  if (
    was.who === w.who &&
    was.note === w.note &&
    (was.due || '') === w.due &&
    (was.expect || '') === w.expect
  )
    return;
  if ((was.expect || '') !== w.expect && w.expect) addFollow(id, 'expect', 'by ' + niceDate(w.expect));
  r.n.wait = { ...was, ...w };
  if (!w.expect) delete r.n.wait.expect; // (only kept when set: see cleanWait)
  save();
  const sum = $('#waitd > summary');
  if (sum) sum.textContent = 'Waiting' + (w.who ? ' on ' + w.who : '');
  renderHeader();
  inBackground(renderWaiting);
}
function setWaiting(id, w) {
  const r = findWaitable(id);
  if (!r.n) return;
  const bf = snapshot(),
    had = !!r.n.wait;
  if (w) {
    r.n.wait = { since: (r.n.wait && r.n.wait.since) || today(), ...w };
    if (!r.n.wait.expect) delete r.n.wait.expect; // (only kept when set: see cleanWait)
  } else delete r.n.wait;
  // A quest (not an Inbox item) waits through a step: one is added. One that was finished isn't
  // any more (settle takes back its "done"), like adding any other step.
  let stepped = null;
  if (w && !S.inbox.includes(r.n) && !r.parents.length) {
    r.n.done = false;
    stepped = waitToStep(r.n);
    if (stepped) toast('Added a waiting subquest');
  }
  // The history: asked (or asked again), or resolved.
  const target = stepped || r.n;
  if (w && !had)
    addFollow(
      target.id,
      followsFor(target.id).some(f => f.k === 'resolve') ? 'reopen' : 'start',
      w.note || '',
    );
  if (!w && had) addFollow(target.id, 'resolve');
  if (stepped) settle(bf);
  if (r.n.node) delete r.n.node.wait; // an Inbox item's own details are the ones that count
  save();
  renderAll();
}
/* following up: a note and the next chase date, in a sheet; the item stays waiting */
function openFollowUp(id, dateOnly) {
  const r = findWaitable(id);
  if (!r.n || !r.n.wait) return;
  const w = r.n.wait;
  popSheet(
    `<form id="fuform" data-id="${id}"><h2 id="sheettitle">${dateOnly ? 'Next chase date' : 'Record a follow-up'}</h2><p class="hint qahint">${esc(r.n.text)}${w.who ? ' · ' + esc(w.who) : ''}</p>${
      dateOnly
        ? ''
        : `<label class="f" for="funote">What happened</label><textarea class="fld" id="funote" rows="2" maxlength="${FOLLOW_MAX}" placeholder="Emailed Sam, awaiting approval"></textarea>`
    }<div class="prow2"><div><label class="f" for="fudue">Chase again on</label><input class="fld" type="date" id="fudue" value="${esc(w.due && w.due > today() ? w.due : shift(today(), 2))}"></div><div><label class="f" for="fuexp">Reply expected by</label><input class="fld" type="date" id="fuexp" value="${esc(w.expect || '')}"></div></div>
    <div class="acts"><button class="btn green" id="sheetok">Save</button><button class="btn" type="button" data-sheetclose="1">Cancel</button></div></form>`,
    { labelledBy: 'sheettitle' },
  );
  const f = $('#funote') || $('#fudue');
  if (f) f.focus();
}
function saveFollowUp(id) {
  const r = findWaitable(id),
    withNote = !!$('#funote'),
    note = withNote ? $('#funote').value.trim() : '',
    due = cleanDay($('#fudue').value),
    expect = cleanDay($('#fuexp').value);
  closeSheet();
  if (!r.n || !r.n.wait) return toast("That item isn't waiting any more");
  const w = r.n.wait;
  if (withNote) {
    addFollow(id, 'chase', note);
    w.last = today();
  }
  if (expect && expect !== (w.expect || '')) addFollow(id, 'expect', 'by ' + niceDate(expect));
  w.due = due;
  if (expect) w.expect = expect;
  else delete w.expect;
  save();
  renderAll();
  toast(withNote ? 'Follow-up recorded' : 'Chase date changed');
}
// A follow-up message to paste into an email or chat: the ask, the dates, the latest follow-up.
function followMessage(id) {
  const r = findWaitable(id);
  if (!r.n || !r.n.wait) return '';
  const w = r.n.wait,
    quest = r.parents.length ? r.parents[0].text : '',
    last = followsFor(id)
      .filter(f => f.k === 'chase' && f.note)
      .pop(),
    lines = [
      `Hi${w.who ? ' ' + w.who.split(/\s+/)[0] : ''},`,
      '',
      `Following up on: ${r.n.text}${quest ? ' (for ' + quest + ')' : ''}.`,
      [w.since ? 'Asked ' + niceDate(w.since) : '', w.expect ? 'reply expected by ' + niceDate(w.expect) : '']
        .filter(Boolean)
        .join('; ') + (w.since || w.expect ? '.' : ''),
      last ? `Last follow-up ${niceDate(last.d)}: ${last.note}.` : '',
      '',
      'Could you let me know where this stands?',
      '',
      'Thanks',
    ];
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n');
}
// A waiting item's actions, in a sheet (the Waiting Centre's rows and the quest page).
function openWaitActions(id) {
  const r = findWaitable(id);
  if (!r.n || !r.n.wait) return;
  const w = r.n.wait,
    inbox = S.inbox.includes(r.n) || S.inbox.some(i => i.node && find(id, [i.node])),
    upcoming = !inbox && !find(id) && !!find(id, S.later),
    a = [
      {
        label: 'Record a follow-up',
        attrs: `data-chase="${id}"`,
        cls: 'go',
        hint: w.last ? 'Last ' + dayLabel(w.last) : '',
      },
      { label: 'Response received', attrs: `data-waitclear="${id}"`, hint: 'Back on your list' },
      {
        label: 'Change the next chase date',
        attrs: `data-chasedate="${id}"`,
        hint: w.due ? dayLabel(w.due) : 'None set',
      },
      { label: 'Copy a follow-up message', attrs: `data-waitcopy="${id}"` },
    ];
  if (inbox) a.push({ label: 'Open in the Inbox', attrs: 'data-goto="inbox"' });
  else if (upcoming) a.push({ label: 'Open Upcoming', attrs: 'data-goupd="1"' });
  else a.push({ label: 'Open', attrs: `data-open="${id}"` });
  actionSheet(
    r.n.text,
    a,
    [w.who ? 'Waiting on ' + w.who : '', w.since ? 'since ' + niceDate(w.since) : '']
      .filter(Boolean)
      .join(', '),
  );
}
function waitClick(d) {
  if (d.wact) return openWaitActions(d.wact);
  if (d.chase) return openFollowUp(d.chase, false);
  if (d.chasedate) return openFollowUp(d.chasedate, true);
  if (d.waitcopy) {
    const m = followMessage(d.waitcopy);
    if (m) copyText(m);
    return;
  }
  if (d.wview) {
    waitView = d.wview === 'person' ? 'person' : 'urgency';
    renderWaiting();
  }
}

/* the Waiting Centre: everything being waited on, by urgency (what to chase first) or by person */
let waitView = 'urgency';
const waitingSorted = () =>
  waitingNodes().sort((a, b) =>
    (a.n.wait.due || '9') < (b.n.wait.due || '9')
      ? -1
      : (a.n.wait.due || '9') > (b.n.wait.due || '9')
        ? 1
        : 0,
  );
// Plain rules, worst first: overdue or due today to chase; due within 3 days; a reply promised
// (and not yet overdue); chased in the last 2 days; the rest with no date.
function waitBucket(w) {
  const t = today();
  if (w.due && w.due <= t) return 'chase';
  if (w.expect && w.expect < t && !w.due) return 'chase';
  if (w.due && w.due <= shift(t, 3)) return 'soon';
  if (w.expect && w.expect >= t) return 'promised';
  if (w.last && w.last >= shift(t, -2)) return 'recent';
  return w.due ? 'later' : 'nodate';
}
const BUCKETS = [
  ['chase', 'To chase'],
  ['soon', 'Due soon'],
  ['promised', 'Reply promised'],
  ['recent', 'Chased recently'],
  ['later', 'Chase later'],
  ['nodate', 'No chase date'],
];
function renderWaiting() {
  const all = waitingSorted();
  // The add box starts closed, so the tab opens on the list.
  let h = `<button class="linkbtn" data-goto="today">&lsaquo; Today</button><div class="sechead"><h2>Waiting</h2>${
    all.length > 1
      ? `<span class="viewsw" role="group" aria-label="Group by"><button class="chip" data-wview="urgency" aria-pressed="${waitView === 'urgency'}">Urgency</button><button class="chip" data-wview="person" aria-pressed="${waitView === 'person'}">Person</button></span>`
      : ''
  }</div><details id="waddd"${panels.waddd ? ' open' : ''}><summary>Add a waiting item</summary><form class="pform box" id="wform">
    <input class="fld" id="wwhat" maxlength="120" placeholder="What you're waiting for" aria-label="What" autocomplete="off">
    <div class="prow2"><input class="fld" id="wfrom" maxlength="60" placeholder="From whom" aria-label="From whom" list="wholist2" autocomplete="off"><input class="fld" type="date" id="wchase" aria-label="Chase on (optional)"></div>
    ${whoList().replace('wholist', 'wholist2')}<button class="btn">Add</button></form></details>`;
  if (!all.length) h += waitingRows(all);
  else if (waitView === 'person') {
    const by = new Map();
    all.forEach(x => {
      const k = (x.n.wait.who || '').trim().toLowerCase() || '\u0000';
      if (!by.has(k)) by.set(k, { name: x.n.wait.who || 'No one named', items: [] });
      by.get(k).items.push(x);
    });
    [...by.values()]
      .sort((a, b) => b.items.length - a.items.length || byName(a.name, b.name))
      .forEach(g => {
        h += `<h3 class="wgroup">${esc(g.name)} <small>${g.items.length} outstanding</small></h3>${waitingRows(g.items)}`;
      });
  } else {
    BUCKETS.forEach(([k, name]) => {
      const items = all.filter(x => waitBucket(x.n.wait) === k);
      if (items.length)
        h += `<h3 class="wgroup">${name} <small>${items.length}</small></h3>${waitingRows(items)}`;
    });
  }
  setHTML($('#v-waiting'), h);
}
// The list of everything being waited on (the Waiting view, and Today's section).
function waitingRows(all) {
  if (!all.length)
    return '<div class="empty">Nothing to chase. Waiting on someone for something? <button class="linkbtn" data-goto="waiting" data-openadd="1">Add it</button> and it\'s chased for you.</div>';
  let h = '<div class="list box">';
  all.forEach(({ n, trail, start, inbox }) => {
    const w = n.wait,
      meta = [
        w.who ? 'from ' + esc(w.who) : '',
        w.note ? esc(w.note) : '',
        trail.length ? 'in ' + esc(trail.join(' / ')) : '',
        start ? 'on Upcoming, ' + dayLabel(start) : '',
        inbox ? 'in Inbox' : '',
        w.last ? 'followed up ' + dayLabel(w.last) : w.since ? 'asked ' + dayLabel(w.since) : '',
        w.expect && w.expect >= today() ? 'reply by ' + niceDate(w.expect) : '',
      ]
        .filter(Boolean)
        .join(' · ');
    h += `<div class="row${waitMark === n.id ? ' marked' : ''}" data-wid="${n.id}">${(n.children && n.children.length) || start || inbox ? '' : `<button class="check" data-toggle="${n.id}" aria-label="Done: ${esc(n.text)}">${tick}</button>`}<button class="open"${inbox ? ' data-v="inbox"' : start ? ' data-goupd="1"' : ` data-open="${n.id}"`}><span>${esc(n.text)}</span><small>${meta} ${chaseTag(w)}</small></button><button class="btn sm" data-waitclear="${n.id}">Got it</button><button class="qmore" data-wact="${n.id}" aria-label="Actions: ${esc(n.text)}" aria-haspopup="dialog">${dots}</button></div>`;
  });
  return h + '</div>';
}
// The add box on the Waiting tab: an Inbox item that is already waiting.
function addWaiting() {
  const what = $('#wwhat').value.trim();
  if (!what) return;
  const id = uid();
  S.inbox.unshift({
    id,
    text: what,
    wait: { who: $('#wfrom').value.trim(), note: '', due: $('#wchase').value || '', since: today() },
  });
  addFollow(id, 'start');
  save();
  renderAll();
  toast('Added to Inbox');
  $('#wwhat').focus();
}
