/* nav & events */
let view = 'today';
// Only what can be seen is redrawn: the header, the view that's showing (and whatever covers
// it). Other views are drawn when they're opened (see go), so a change or a sync doesn't redraw
// every tab each time.
function renderAll() {
  renderHeader();
  renderView();
  syncRinging();
  renderZen();
}
function renderView(v = view) {
  if (v === 'review') {
    renderReview();
    if (reviewSub === 'log') renderLog();
    return;
  }
  const r = {
    today: renderToday,
    inbox: renderInbox,
    focus: renderFocus,
    waiting: renderWaiting,
    notes: renderNotes,
    knowledge: renderKnowledge,
    search: renderSearch,
    account: renderAccount,
    ops: renderOps,
  }[v];
  if (r) r();
}
// Fade whichever edge of the tab strip has more tabs beyond it.
function fadeTabs() {
  const t = $('#tabs');
  t.classList.toggle('more-left', t.scrollLeft > 6);
  t.classList.toggle('more-right', t.scrollLeft + t.clientWidth < t.scrollWidth - 6);
}
$('#tabs').addEventListener('scroll', fadeTabs, { passive: true });
window.addEventListener('resize', fadeTabs);
// History lives under the Review tab; Focus has no tab (the header opens it).
function go(v) {
  if (v === 'log') {
    reviewSub = v;
    v = 'review';
  }
  // Leaving the Inbox leaves triage, except to write an article from an item (see triage.js).
  if (triage && v !== 'inbox' && !(triage.ref && kbEdit && kbEdit.fromInbox)) triage = null;
  if (v !== 'waiting') waitMark = ''; // (a deep link's mark on a waiting item lasts a visit)
  if (v === 'account') setSub = null; // (the Settings tab opens its index; openSettings goes on to a group)
  keepDrafts();
  view = v;
  if (v !== 'today') $('#ptitle').hidden = true;
  if (imgShown || kbImgShown) closeImgs();
  renderHeader();
  document.querySelectorAll('nav button[data-v]').forEach(x => {
    if (x.dataset.v === v) x.setAttribute('aria-current', 'page');
    else x.removeAttribute('aria-current');
  });
  [
    'today',
    'inbox',
    'waiting',
    'notes',
    'knowledge',
    'search',
    'review',
    'focus',
    'log',
    'account',
    'ops',
  ].forEach(k => ($('#v-' + k).hidden = k !== v && !(v === 'review' && k === reviewSub)));
  renderView(v); // (drawn now: while hidden it wasn't kept up to date)
  restoreDrafts();
  // Keep the current tab visible when the tab bar is scrolled sideways.
  const tab = document.querySelector(`nav [data-v="${v}"]`);
  // (only when it's off screen: asking always makes the browser lay out the whole page first)
  if (tab) {
    const r = tab.getBoundingClientRect(),
      s = $('#tabs').getBoundingClientRect();
    if (r.left < s.left || r.right > s.right) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  fadeTabs();
  window.scrollTo(0, 0);
}
/* Release G: where a task's page was opened from, so back (and its ‹ crumb) returns there:
   another view (Waiting, Forecast, Search, the Command Centre) with its scroll position, or
   Today's list where it was scrolled to. */
let returnTo = null, // { depth, name, ...placeHere() }: the view a task's page was opened from
  listY = 0, // (where Today's list was scrolled to when a task was opened from it)
  listAt = null; // ({ id, top }: the task opened, and where its row was on the screen)
const RETURN_NAME = {
  waiting: 'Waiting',
  review: 'Review',
  search: 'Search',
  ops: 'Command Centre',
  inbox: 'Inbox',
  knowledge: 'Knowledge', // (Release H: a process run's or a guide's "For:" link; named in returnTo)
};
/* Release H: the same for a link to another view that isn't a task's page (an article, a process,
   the Inbox or an Upcoming task from Search; Upcoming from the Waiting Centre or the forecast;
   Settings from a process run): back returns to where it was followed from, while the page it
   landed on is still showing (known by placeSig). A tab is a fresh start, as for returnTo. */
let viewFrom = null;
// What Knowledge is showing (an article, a guide being followed, a process run and where its ‹
// goes), so it can be put back as it was.
const kbPlace = () => ({
  kbArt,
  kbRun,
  wfOpen,
  wfView,
  wfFrom,
  wfFromY,
  kbView,
  kbCatOpen,
  kbReturn,
  kbRunBack,
  kbRunBackWf,
});
// Which page is showing, as far as going back is concerned.
function placeSig() {
  const on = v => view === v;
  return JSON.stringify([
    view,
    on('today') ? path : '',
    on('knowledge') ? [kbArt, kbRun, wfOpen, wfView, !!kbEdit, !!wfEdit] : '',
    on('account') ? setSub : '',
    on('inbox') ? !!triage : '',
    on('review') ? reviewSub : '',
  ]);
}
// Where the page is now, for back to put back: the view, its sub-page, the scroll, Today's path,
// what Knowledge and Settings show, and the control the keyboard was on.
function placeHere(opener = document.activeElement) {
  return {
    view,
    sub: reviewSub,
    y: window.scrollY,
    path: [...path],
    kb: kbPlace(),
    set: view === 'account' ? setSub : null,
    opener: opener && opener.closest && !opener.closest('#sheet') ? focusSel(opener) : '',
    was: placeSig(),
  };
}
// After following a link from `f` (placeHere, taken before it): back now returns there.
function landed(f) {
  if (!f || f.view === view) return;
  f.sig = placeSig();
  if (f.sig !== f.was) viewFrom = f;
}
// Back to a place kept by placeHere (returnTo or viewFrom), with only what's still there.
function goPlace(r) {
  if (r.kb) {
    const k = r.kb;
    kbArt = k.kbArt && S.kb.some(a => a.id === k.kbArt) ? k.kbArt : null;
    kbRun = k.kbRun && S.runs.some(x => x.id === k.kbRun) ? k.kbRun : null;
    wfOpen = k.wfOpen && wrunById(k.wfOpen) ? k.wfOpen : null;
    wfView = k.wfView && wfById(k.wfView) ? k.wfView : null;
    wfFrom = wfOpen ? k.wfFrom : null;
    wfFromY = k.wfFromY || 0;
    kbView = k.kbView;
    kbCatOpen = k.kbCatOpen;
    kbReturn = k.kbReturn;
    kbRunBack = k.kbRunBack;
    kbRunBackWf = k.kbRunBackWf;
    kbImgShown = null;
  }
  // (Today's path as it was under that view where it matters: Today itself, or a guide opened from
  // a task, whose ‹ goes back to it)
  path = r.view === 'today' || (r.kb && r.kb.kbReturn) ? r.path || [] : [];
  if (r.view === 'review') reviewSub = r.sub;
  go(r.view);
  if (r.view === 'account' && r.set) openSettings(r.set);
  window.scrollTo(0, r.y);
  refocus(r.opener);
}
function backFrom() {
  const f = viewFrom;
  viewFrom = null;
  keepDrafts();
  goPlace(f);
}
// The keyboard back on the control that was opened (Release H), without moving the page: the one
// on the screen, if it's shown twice (a task in Top 3 and on the list, say).
function refocus(sel, scope = $('#v-' + view)) {
  if (!sel || !scope) return;
  let all;
  try {
    all = [...scope.querySelectorAll(sel)].filter(e => e.getClientRects().length);
  } catch (e) {
    return;
  }
  const f =
    all.find(e => {
      const r = e.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    }) || all[0];
  if (f) f.focus({ preventScroll: true });
}
// An Upcoming task (from the forecast, Search or the Waiting Centre): Today's list, with Upcoming
// open at it (as the q route shows one: routes.js). Back returns to where it was opened from.
function showUpcoming(id) {
  const from = placeHere(),
    l = id && find(id, S.later),
    top = l && (l.parents[0] || l.n);
  path = [];
  go('today');
  const u = $('#upd');
  if (u) u.open = panels.upd = true;
  const row = top && $(`#upd [data-upid="${CSS.escape(top.id)}"]`);
  if (row) {
    row.classList.add('marked'); // (until the next redraw)
    row.scrollIntoView({ block: 'center' });
    const b = row.querySelector('[data-now]');
    if (b) b.focus({ preventScroll: true });
    if (!undoSnap) toast('On Upcoming: ' + top.text, false, 3000);
  } else if (u) u.scrollIntoView({ block: 'start' });
  landed(from);
}
// Settings (a group, a section of it) from a link elsewhere: back returns there.
function settingsFrom(group, sec) {
  const from = view !== 'account' && placeHere();
  openSettings(group, sec);
  landed(from);
}
// Words typed into a box and left (going to another view or task) come back with it: kept per
// box, view and task, so one task's half-typed step never turns up on another's page.
const drafts = {};
const draftKey = id => `${id}|${view}${view === 'today' ? '|' + path.join('/') : ''}`;
function keepDrafts() {
  // (never a password)
  COMPOSE.filter(id => id !== 'apass').forEach(id => {
    const e = document.getElementById(id);
    if (e && e.offsetParent !== null) drafts[draftKey(id)] = e.value;
  });
}
function restoreDrafts() {
  COMPOSE.forEach(id => {
    const e = document.getElementById(id),
      v = drafts[draftKey(id)];
    if (e && !e.value && v) e.value = v;
  });
}
function openPath(p) {
  if (!path.length && p.length && view === 'today') {
    listY = window.scrollY;
    const row = document.querySelector(`#v-today .list .row[data-qid="${CSS.escape(p[0])}"]`);
    listAt = row ? { id: p[0], top: row.getBoundingClientRect().top } : null;
  }
  keepDrafts();
  // (up a level: the keyboard goes back to the step, or the task, that was open)
  const left = p.length < path.length && p.every((id, i) => path[i] === id) ? path[p.length] : '';
  path = p;
  reorder = false;
  // (up from a step to a level still under the page it was opened from: back still returns there)
  if (returnTo && p.length < returnTo.depth) {
    if (p.length) returnTo.depth = p.length;
    else returnTo = null;
  }
  renderToday();
  renderHeader(); // (its action is quieter on a task's page: see header.js)
  restoreDrafts();
  window.scrollTo(0, p.length ? 0 : listY);
  // (back on the list: the task's row where it was on the screen, whatever the rows above it
  // measure now that they're drawn afresh)
  let row = null;
  if (!p.length && listAt) {
    row = document.querySelector(`#v-today .list .row[data-qid="${CSS.escape(listAt.id)}"]`);
    // (kept on the screen, should it be shorter now: the phone turned meanwhile, say)
    if (row)
      window.scrollBy(
        0,
        row.getBoundingClientRect().top -
          Math.max(0, Math.min(listAt.top, innerHeight - row.offsetHeight - 72)),
      );
    listAt = null;
  }
  if (left && view === 'today') {
    const f = row && row.querySelector(`[data-open="${CSS.escape(left)}"]`);
    if (f) f.focus({ preventScroll: true });
    else refocus(`[data-open="${CSS.escape(left)}"]`, $('#v-today'));
  }
}
// Back from a task's page opened from another view: to that view, where it was.
function returnBack() {
  const r = returnTo;
  returnTo = null;
  keepDrafts(); // (the task page's words, kept under its own path before it's left)
  goPlace(r);
}
const atReturn = () => returnTo && view === 'today' && path.length === returnTo.depth;
document.querySelectorAll('nav button[data-v]').forEach(
  b =>
    (b.onclick = () => {
      if (!window.appReady) return; // (not started yet)
      returnTo = viewFrom = null; // (a tab is a fresh start: back no longer leads to where a task came from)
      if (b.dataset.v === 'today' && view === 'today' && path.length) {
        openPath([]);
      }
      go(b.dataset.v);
    }),
);

document.addEventListener('submit', e => {
  e.preventDefault();
  if (!window.appReady) return;
  const f = e.target;
  if (f.id === 'sform') {
    const v = $('#sin').value.trim();
    if (!v) return;
    const r = find(f.dataset.parent);
    if (!r) return;
    const b = snapshot(),
      p = r.n;
    p.children.push(fix({ id: uid(), text: v }));
    p.done = false; // (it was finished before it had steps: with one to do, it isn't now)
    settle(b);
    $('#sin').focus();
  }
  if (f.dataset.subfor) {
    const id = f.dataset.subfor,
      v = f.querySelector('input').value.trim(),
      it = S.inbox.find(x => x.id === id);
    if (!v || !it) return;
    // (its waiting details stay on the item until it goes to Today)
    it.node = it.node || fix({ id: uid(), text: it.text, tag: it.tag || '', project: it.project || '' });
    it.node.children.push(fix({ id: uid(), text: v }));
    it.node.done = false;
    save();
    renderAll();
    const nf = document.querySelector(`[data-subfor="${id}"] input`);
    nf && nf.focus();
  }
  if (f.id === 'resurlform') submitLinkUrl(f.dataset.id);
  if (f.id === 'twform') triageWaiting(f.dataset.id);
  if (f.id === 'fuform') saveFollowUp(f.dataset.id);
  if (f.id === 'pstepform') saveProcStep(f.dataset.id);
  if (f.id === 'wfform') saveWorkflowForm();
  if (f.id === 'wfstageform') saveStageForm(f.dataset.id);
  if (f.id === 'ruleform') saveRuleForm();
  if (f.id === 'authform') signIn();
  if (f.id === 'wform') addWaiting();
  if (f.id === 'kbform') kbSave();
  if (f.id === 'flowform') addFlow();
  if (f.id === 'kbcatform') {
    kbAddCat($('#kbcatin').value, '');
    $('#kbcatin').value = '';
    $('#kbcatin').focus();
  }
  if (f.id === 'tagform') {
    const v = cleanText($('#tagin').value.trim());
    if (!v) return;
    if (S.tags.some(t => t.name === v)) {
      toast('That tag already exists');
      return;
    }
    const used = S.tags.map(t => t.color);
    S.tags.push({
      name: v,
      color: PALETTE.find(c => !used.includes(c)) || PALETTE[S.tags.length % PALETTE.length],
    });
    save();
    renderAll();
    $('#tagin').focus();
  }
  if (f.id === 'iform') {
    const n = capture($('#iin').value);
    if (!n) return;
    $('#iin').focus();
    if (n > 1) toast('Added ' + n + ' items');
  }
});

document.addEventListener('change', e => {
  if (!window.appReady) return;
  const el = e.target;
  if (el.id === 'wstype') return wsShowKind();
  if (el.id === 'rlon' || el.id === 'rldo') return redrawRuleForm();
  if (el.dataset && el.dataset.cap !== undefined) return capChange(el);
  if (el.id === 'fdaypick') {
    forecastDay = el.value;
    return renderReview();
  }
  if (el.dataset && el.dataset.wfact === 'check') return wfClick(el.dataset, el);
  if (el.dataset && el.dataset.flowpass) return setFlowPass(el.dataset.flowpass, el.checked);
  // Committed. (Not a time: those change a part at a time and are still being typed.)
  // Nor the waiting panel's fields before it's set: they're only saved with "Set waiting".
  // Nor an article being written: it's saved with its Save button.
  const waitd = el.closest('#waitd');
  // Already waiting: a changed detail is saved straight away. A date still being entered (the
  // field still has the keyboard, or the picker just closed on it) is saved once it's left,
  // and until then a redraw keeps it as entered.
  if (waitd && waitd.dataset.waitid && el.type === 'date' && document.activeElement === el) return;
  if (
    el.dataset &&
    !el.dataset.atime &&
    (!waitd || waitd.dataset.waitid) &&
    !el.closest('#kbform') &&
    el.id !== 'kbmv'
  )
    delete el.dataset.typed;
  if (waitd && waitd.dataset.waitid) {
    return saveWaitPanel(waitd.dataset.waitid, true);
  }
  // Alarms: time, label and device; this device's name (Settings).
  if (el.dataset.atime) return editAlarm(el.dataset.atime, 'time', el.value);
  if (el.dataset.alabel) return editAlarm(el.dataset.alabel, 'label', el.value);
  if (el.dataset.adev !== undefined) return editAlarm(el.dataset.adev, 'device', el.value);
  if (el.id === 'devname') return renameDevice(el.value);
  if (el.dataset.flowname) {
    const f = S.flows.find(x => x.id === el.dataset.flowname),
      v = cleanText(el.value.trim().slice(0, 60));
    if (f && v && v !== f.name) {
      f.name = v;
      save();
      renderKnowledge();
    }
    return;
  }
  if (el.id === 'kbimgfile') {
    kbAddImages(el.files || []);
    el.value = '';
    return;
  }
  if (el.id === 'nimgfile') {
    addNoteImages(el.files || []);
    el.value = '';
    return;
  }
  if (el.id === 'imp') {
    if (el.files && el.files[0]) importFile(el.files[0]);
    el.value = '';
    return;
  }
  if (el.dataset.sugpick !== undefined) {
    const x = suggest && suggest.items[+el.dataset.sugpick];
    if (x) x.on = el.checked;
    return;
  }
  if (el.dataset.iwait) {
    const it = S.inbox.find(x => x.id === el.dataset.iwait),
      who = el.value.trim();
    if (it) {
      const had = !!it.wait;
      if (who) it.wait = { note: '', due: '', since: today(), ...it.wait, who };
      else delete it.wait;
      // (its history, as the Waiting Centre keeps it)
      if (who && !had) addFollow(it.id, followsFor(it.id).some(f => f.k === 'resolve') ? 'reopen' : 'start');
      if (!who && had) addFollow(it.id, 'resolve');
    }
    save();
    renderAll();
    return;
  }
  // A tag's name field is known by its place in the list; the one it showed is
  // the one renamed (found by name: the list may have changed meanwhile, say on another device).
  if (el.dataset.tagname !== undefined) {
    const i = S.tags.findIndex(t => t.name === el.defaultValue);
    if (i >= 0) renameTag(i, el.value);
    save();
    renderAll();
    return;
  }
  if (el.dataset.schedpick) {
    schedule(el.dataset.kind, el.dataset.schedpick, el.value);
    return;
  }
  if (el.dataset.restart) {
    const n = S.later.find(x => x.id === el.dataset.restart);
    if (n && el.value > today()) {
      n.start = el.value;
      if (n.scheduled) n.scheduled.date = el.value; // (a scheduled one moves with its day)
      S.later.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
      save();
    }
    renderToday();
    return;
  }
  if (el.id === 'fq') {
    S.focusQ = el.value;
    save();
    renderFocus();
    return;
  }
  if (el.id === 'scpick' || el.id === 'scid') {
    if (el.id === 'scpick') shortcutKind = el.value;
    else shortcutId = el.value;
    renderAccount();
    return;
  }
  const fld = el.dataset.field;
  if (!fld) return;
  const r = find(el.dataset.id);
  if (!r) return;
  if (fld === 'text') {
    const v = el.value.trim();
    if (v) {
      r.n.text = v;
      const t = tplFor(r.n);
      if (t) t.text = v;
      save();
      renderAll();
    } else el.value = r.n.text; // a blank name: keep the old one, and show it
    return;
  }
  if (fld === 'month') {
    setRepeat(r.n, t => (t.monthDay = +el.value));
    return;
  }
  if (fld === 'due') {
    r.n.due = el.value;
    save();
    renderAll();
    return;
  }
  if (fld === 'opt') {
    const b = snapshot();
    r.n.opt = el.checked;
    settle(b);
  }
});
// Escape (or the clear button) empties a search box without an input event: its results go too.
document.addEventListener(
  'search',
  e => {
    if (e.target.id === 'sq') typedSearch(e.target.value);
    if (e.target.id === 'kbq') kbSearch(e.target.value);
  },
  true,
);
document.addEventListener('input', e => {
  if (!window.appReady) return;
  const el = e.target;
  if (el.dataset) el.dataset.typed = '1'; // being edited: a background redraw keeps it
  if (el.id === 'notesin') return typedNotes(el.value);
  if (el.id === 'kbq') return kbSearch(el.value);
  if (el.id === 'procq') return procSearch(el.value);
  if (el.id === 'sq') return typedSearch(el.value);
  if (el.id === 'resq') return resourceSearch(el.value, el.dataset.id);
  if (el.closest('#ruleform')) return typedRuleForm();
  if (el.dataset.field === 'summary') {
    const r = find(el.dataset.id);
    if (!r) return;
    const v = cleanText(el.value).slice(0, SUMMARY_MAX);
    if (v.trim()) r.n.summary = v;
    else delete r.n.summary;
    save();
    return;
  }
  if (el.dataset.field !== 'notes') return;
  const r = find(el.dataset.id);
  if (r) {
    r.n.notes = el.value;
    save();
  }
});

document.addEventListener('click', e => {
  if (!window.appReady) return e.preventDefault(); // (not started yet: nothing to act on)
  const sum = e.target.closest && e.target.closest('#alarmd > summary');
  if (sum) toggleAlarmsList(sum.parentElement);
  let b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (waitMark && !b.closest('#sheet')) waitMark = ''; // (seen: the mark goes with the next redraw)
  // A task's quick actions (its ⋯), from a row or tile on a list, or from its page.
  if (d.qact) openQuestActions(d.qact, !b.closest('.qfoot'));
  if (d.saveplace) savePlace(d.saveplace);
  if (d.resume) resumeWork(d.resume);
  if (d.clearplace) clearPlace(d.clearplace);
  top3Click(d);
  if (d.tfindopen) {
    // (open: closes it, and clears its words; closed: opens it)
    todayFindOpen = !(todayFindOpen || todayFind);
    todayFind = '';
    renderToday();
    const f = document.getElementById('tfind');
    if (f) f.focus();
  }
  if (d.tfilter) {
    if (d.tfindclear) todayFind = '';
    setTodayFilter(d.tfilter);
  }
  linkClick(d);
  triageClick(d, b);
  waitClick(d);
  kbRunClick(d, b);
  execClick(d, b);
  // (a process's overview from Search, say: back returns there. Release H)
  const wfFromHere = d.wfview && view !== 'knowledge' && placeHere(b);
  wfClick(d, b);
  landed(wfFromHere);
  ruleClick(d, b);
  forecastClick(d, b);
  insightClick(d);
  opsClick(d, b);
  createClick(d, b);
  if (d.open) {
    const r = find(d.open);
    if (r) {
      const p = [...r.parents.map(p => p.id), r.n.id];
      // (from another view: remembered, to come back to; from a guide or a process run too, back
      // to it. Not a guide's "Back to the task" when it was opened from that task: that's going
      // back, not on.)
      const goingBack =
        view === 'knowledge' && kbReturn && p.length === path.length && p.every((id, i) => path[i] === id);
      const from =
        view !== 'today' && RETURN_NAME[view] && !goingBack
          ? {
              ...placeHere(b),
              depth: p.length,
              name: view !== 'knowledge' ? '' : wfOpen ? 'Process' : kbRun ? 'Guide' : '',
            }
          : null;
      // (a step opened on a task's page that was itself opened from another view: the way back
      // stays, for when the task's page is reached again)
      const deeper =
        view === 'today' &&
        returnTo &&
        path.length >= returnTo.depth &&
        p.length > path.length &&
        path.every((id, i) => p[i] === id);
      const keep = deeper ? returnTo : null;
      openPath(p);
      if (view !== 'today') go('today');
      // (opened from Today itself: back is to Today's list, whatever came before)
      returnTo = from || keep;
      if (from) {
        renderToday();
        restoreDrafts();
      }
    } else if (find(d.open, S.later)) showUpcoming(d.open); // (Release H: the forecast's Upcoming)
  }
  if (d.v && b.closest('header, #v-waiting, #waitsec')) {
    const from = !b.closest('header') && placeHere(b);
    if (d.v === 'today' && b.closest('header')) path = []; // (the list, not an open task)
    if (b.classList.contains('halarm')) alarmsOpen = true; // (the alarms, unfolded)
    go(d.v);
    if (b.classList.contains('halarm') && $('#alarmd')) $('#alarmd').scrollIntoView({ block: 'nearest' });
    landed(from);
  }
  if (b.id === 'searchBtn') openSearch();
  if (d.sart) {
    // (Release H: from Search, say, back returns there; from a task's page or a guide, the
    // article's own ‹ already goes back to them)
    const from = !['today', 'knowledge'].includes(view) && placeHere(b);
    leaveEditor(() => {
      kbRunBack = kbRun; // (opened from a run being followed: the article's ‹ goes back to it)
      kbRun = null;
      kbArt = d.sart;
      kbImgShown = null;
      kbReturn = view === 'today' && path.length > 0; // (opened from a quest: back goes to it)
      go('knowledge');
      renderKnowledge();
      landed(from);
    });
  }
  // An Upcoming item (from the Waiting Centre or Search): Today's list, with Upcoming open at it.
  if (d.goupd) showUpcoming(d.goupd);
  if (d.goto) {
    // (Release H: from Search or the Command Centre, back returns there; not a ‹ Today link,
    // which is itself the way back)
    const from = d.goto !== 'today' && placeHere(b);
    if (d.goto === 'inbox') triage = null; // (the capture box, not a walk under way)
    go(d.goto);
    landed(from);
    if (d.openadd) {
      panels.waddd = true;
      renderWaiting();
      const w = $('#wwhat');
      w && w.focus();
    }
    const i = d.goto === 'inbox' && $('#iin');
    i && i.focus();
  }
  if (d.crumb !== undefined) {
    if (+d.crumb === -1 && atReturn()) returnBack();
    else openPath(path.slice(0, +d.crumb + 1));
  }
  if (d.toggle) {
    const r = find(d.toggle);
    if (!r) return;
    const n = r.n,
      bf = snapshot();
    n.done = !n.done;
    settle(bf);
  }
  if (d.finish) nextAnswer(d.finish, { pick: 'finish' });
  if (d.unsure) nextAnswer(d.unsure, { pick: 'unsure' });
  if (d.reopen) {
    const r = find(d.reopen);
    if (!r || !r.n.done) return;
    const bf = snapshot();
    r.n.done = false;
    settle(bf);
  }
  if (d.del) {
    const r = find(d.del);
    if (!r) return;
    if (!arm(b, r.n.children.length ? 'Delete all?' : 'Delete?')) return;
    withUndo('Deleted ' + r.n.text, () => {
      const bf = snapshot();
      r.arr.splice(r.arr.indexOf(r.n), 1);
      settle(bf);
    });
  }
  // (past the next one shown: Today's list leaves out scheduled and waiting tasks, which keep
  // their places in the order underneath; see moveAmong)
  if (
    (d.up || d.down || d.top) &&
    moveAmong(d.up || d.down || d.top, d.up ? 'up' : d.down ? 'down' : 'top')
  ) {
    const id = d.up || d.down || d.top;
    save();
    renderAll();
    // (the button tapped may now be disabled, at the top or the bottom: the keyboard stays on the
    // moved row, on a move that can still be made)
    if (!document.activeElement || document.activeElement === document.body) {
      const row = document.querySelector(`#v-today [data-qid="${CSS.escape(id)}"]`),
        f = row && (row.querySelector('.mv:not([disabled])') || row.querySelector('.open'));
      if (f) f.focus({ preventScroll: true });
    }
  }
  if (b.id === 'reorder') {
    reorder = !reorder;
    renderToday();
  }
  if (d.rep) {
    const t = S.templates.find(x => x.id === d.rep),
      wd = +d.wd;
    if (!t) return;
    t.days = t.days.includes(wd) ? t.days.filter(x => x !== wd) : [...t.days, wd];
    if (t.auto && !repeats(t)) {
      S.templates = S.templates.filter(x => x !== t);
      S.quests.forEach(q => {
        if (q.tpl === t.id) delete q.tpl;
      });
    }
    save();
    renderAll();
  }
  if (d.rday) {
    const wd = +d.rday,
      r = find(d.id);
    if (r)
      setRepeat(r.n, t => (t.days = t.days.includes(wd) ? t.days.filter(x => x !== wd) : [...t.days, wd]));
  }
  if (d.rpreset) {
    const r = find(d.id),
      k = d.rpreset;
    if (r)
      setRepeat(r.n, t => {
        t.days = k === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : k === 'weekdays' ? [1, 2, 3, 4, 5] : [];
        if (k === 'off') t.monthDay = 0;
      });
  }
  if (d.delnow) {
    const r = find(d.delnow);
    if (r)
      withUndo('Deleted ' + r.n.text, () => {
        const bf = snapshot();
        r.arr.splice(r.arr.indexOf(r.n), 1);
        settle(bf);
      });
  }
  schedClick(d);
  if (d.toinbox) moveToInbox(d.toinbox);
  if (d.sched) schedule(d.kind, d.sched, d.when);
  if (d.now) {
    const i = S.later.findIndex(x => x.id === d.now);
    if (i >= 0) {
      const n = S.later.splice(i, 1)[0];
      delete n.start;
      if (n.scheduled) n.scheduled.date = today(); // (brought to today: it happens today)
      const bf = snapshot();
      S.quests.push(n);
      settle(bf);
      toast('Added to today');
    }
  }
  if (d.dellater) {
    if (!arm(b, 'Delete?')) return;
    withUndo('Deleted', () => {
      S.later = S.later.filter(x => x.id !== d.dellater);
      save();
      renderAll();
    });
  }
  if (d.promote) promoteInbox(d.promote);
  if (d.tview) setTodayView(d.tview);
  if (d.suggest) askSuggest(d.suggest);
  if (d.sumai) askSummary(d.sumai);
  if (d.sumuse) useSummary(d.sumuse);
  if (d.sumclose) {
    sumAI = null;
    renderToday();
  }
  if (d.sugadd) addSuggested(d.sugadd);
  if (d.sugclose) {
    suggest = null;
    renderToday();
  }
  if (d.rsub) {
    reviewSub = d.rsub;
    go(d.rsub === 'log' ? 'log' : 'review');
  }
  if (d.rstep) {
    reviewStep += +d.rstep;
    renderReview();
    window.scrollTo(0, 0);
  }
  if (b.id === 'reviewed') {
    reviewStep = 0;
    S.reviewed = today();
    save();
    renderAll();
    toast('Week reviewed');
  }
  if (b.id === 'copyweek') copyText(weekText());
  if (b.id === 'healthrun') runHealth();
  if (d.steps) {
    if (expanded.has(d.steps)) expanded.delete(d.steps);
    else expanded.add(d.steps);
    renderInbox();
  }
  if (d.delsub) {
    const it = S.inbox.find(x => x.id === d.delsub);
    if (it && it.node)
      withUndo('Removed', () => {
        it.node.children = it.node.children.filter(k => k.id !== d.sub);
        save();
        renderInbox();
      });
  }
  if (b.id === 'mic') toggleMic();
  if (d.clear) clearInbox(d.clear);
  if (d.settag !== undefined) {
    const v = d.settag;
    if (d.kind === 'q') {
      const r = find(d.id);
      if (r) {
        r.n.tag = r.n.tag === v ? '' : v;
        const t = tplFor(r.n);
        if (t) t.tag = r.n.tag;
      }
    } else {
      const it = S.inbox.find(x => x.id === d.id);
      if (it) {
        it.tag = it.tag === v ? '' : v;
        if (it.node) it.node.tag = it.tag;
      }
    }
    save();
    renderAll();
  }
  if (d.look) {
    setLook(d.look, d.val);
    renderAccount();
  }
  if (d.edittags) settingsFrom('tags');
  if (d.deltag) {
    if (!arm(b, 'Delete?')) return;
    withUndo('Tag deleted', () => {
      const name = S.tags[+d.deltag].name;
      S.tags.splice(+d.deltag, 1);
      eachTagged(n => {
        if (n.tag === name) n.tag = '';
      });
      if (S.timer && S.timer.tag === name) S.timer.tag = '';
      save();
      renderAll();
    });
  }
  if (d.range) {
    range = +d.range;
    renderLog();
  }
  if (d.mins) {
    S.mins = +d.mins;
    save();
    renderFocus();
  }
  if (b.id === 'start') startTimer(focusTarget());
  if (d.zstart) startTimer(d.zstart);
  if (d.asknext) askNext(d.asknext);
  if (d.zen) {
    // A paused session on other work: one session at a time, so say so rather than quietly
    // opening that one (save its time and switch, or go back to it).
    const t = S.timer,
      was = t && topOf(t.q),
      to = d.q && find(d.q);
    if (t && t.left != null && to && was && topOf(d.q) !== was) {
      const m = Math.floor((t.mins * 60000 - remaining()) / 60000);
      return sheet(
        {
          title: 'Switch focus?',
          text: `${was.text} has a paused session${m >= 1 ? ` (${m} min)` : ''}. Save its time and focus on ${to.n.text}?`,
          ok: 'Save and switch',
          extra: [['back', 'Back to ' + was.text, 'blue']],
        },
        a => {
          if (a === true) {
            stopAndSave(false);
            if (!find(d.q)) return toast('That task has gone', false, 3000);
            S.focusQ = d.q;
            save();
          }
          setZen(true);
        },
      );
    }
    // Focus on what the header shows, not an older pick.
    if (d.q && !S.timer && S.focusQ !== d.q) {
      S.focusQ = d.q;
      save();
    }
    setZen(true);
  }
  if (b.id === 'zenexit') setZen(false);
  if (b.id === 'plus5' || d.plus5) {
    const t = S.timer;
    if (!t || timerDue()) return;
    t.mins += 5;
    if (t.left != null) t.left += 300000;
    else t.end += 300000;
    save();
    renderFocus();
    renderZen();
  }
  if (b.id === 'stop' || d.discard) {
    if (!arm(b, 'Tap again to discard')) return;
    S.timer = null;
    timeUp = null;
    save();
    renderAll();
  }
  if (b.id === 'stopsave' || d.stop === 'save') stopAndSave(false);
  if (d.tu) answerTimeUp(d.tu);
  if (d.keep) {
    const q = S.quests.find(x => x.id === d.keep);
    if (q) q.kept = today();
    save();
    renderAll();
  }
  if (d.drop) {
    // (Release H: the task and its steps go, so two taps, as "Delete this task" asks)
    const q = S.quests.find(x => x.id === d.drop);
    if (!q || !arm(b, 'Delete?')) return;
    if (q)
      withUndo('Deleted ' + q.text, () => {
        S.quests = S.quests.filter(x => x !== q);
        save();
        renderAll();
      });
  }
  if (d.waitsave) saveWaitPanel(d.waitsave);
  kbClick(d, b);
  if (b.id === 'nimgadd') $('#nimgfile').click();
  if (d.nimg) {
    imgShown = d.nimg;
    renderNoteImgs();
  }
  if (d.nimgclose) {
    imgShown = null;
    renderNoteImgs();
  }
  if (d.delnimg && arm(b, 'Delete?')) deleteNoteImg(d.delnimg);
  if (d.waitclear) withUndo('Back on your list', () => setWaiting(d.waitclear, null));
  if (b.id === 'stopdone' || d.stop === 'done') stopAndSave(true);
  if (d.pause) togglePause();
  if (b.id === 'undo') undo();
  if (b.id === 'impbtn') $('#imp').click();
  if (b.id === 'copylog') copyLog();
  if (b.id === 'hist') loadHistory();
  if (b.id === 'histclear' && arm(b, 'Delete all?')) clearHistory();
  if (d.hist) {
    const r = versions.find(x => String(x.id) === d.hist);
    if (r && r.data && Array.isArray(r.data.quests)) {
      pending = r.data;
      renderAccount();
      window.scrollTo(0, 0);
    }
  }
  if (b.id === 'exp') exportData();
  if (b.id === 'doRestore') {
    // What's current across devices isn't taken from the backup: the notification keys (an old
    // copy would break every device's notifications), the device list and any running session.
    // Nor the notes' pictures when it has none of its own (a previous version leaves them out).
    const keep = { pushKey: S.pushKey, devices: S.devices, timer: S.timer },
      hadCap = S.cap,
      imgs = Array.isArray(pending.noteImgs) ? null : S.noteImgs,
      artImgs = new Map(S.kb.map(a => [a.id, a.imgs])),
      hadArtImgs = new Set(
        (Array.isArray(pending.kb) ? pending.kb : []).filter(a => a && Array.isArray(a.imgs)).map(a => a.id),
      ),
      kept = {
        kb: S.kb,
        kbcats: S.kbcats,
        flows: S.flows,
        follows: S.follows,
        runs: S.runs,
        execs: S.execs,
        workflows: S.workflows,
        wruns: S.wruns,
        rules: S.rules,
        rlog: S.rlog,
        pins: S.pins,
      },
      keptLoose = S.kbimgLoose,
      was = JSON.stringify(S);
    try {
      norm(pending);
    } catch (e) {
      norm(JSON.parse(was));
      pending = null;
      return toast("That backup couldn't be read", false, 3000);
    }
    Object.assign(S, keep);
    if (pending.cap === undefined && hadCap) S.cap = hadCap; // (a copy from before capacity)
    if (imgs) S.noteImgs = imgs;
    // (pictures still waiting for their article: kept too, or they'd be deleted everywhere)
    S.kbimgLoose = [...S.kbimgLoose, ...keptLoose.filter(p => !S.kbimgLoose.some(q => q.id === p.id))];
    // A copy from before the Knowledge tab (or Release B's records) has none of it: what's
    // here stays.
    [
      'kb',
      'kbcats',
      'flows',
      'follows',
      'runs',
      'execs',
      'workflows',
      'wruns',
      'rules',
      'rlog',
      'pins',
    ].forEach(k => {
      if (!Array.isArray(pending[k])) S[k] = kept[k];
    });
    S.kb.forEach(a => {
      if (!hadArtImgs.has(a.id) && artImgs.has(a.id)) a.imgs = artImgs.get(a.id);
    });
    rollover(); // (it may be from another day)
    pending = null;
    path = [];
    save();
    renderAll();
    toast('Backup restored');
    go('today');
  }
  if (b.id === 'noRestore') {
    pending = null;
    renderAccount();
  }
  if (b.id === 'syncBtn') settingsFrom('sync');
  if (b.id === 'signup') signUp();
  if (b.id === 'signout') {
    // Unsent edits go first. Then alarms and alerts stop coming here, and nothing of this
    // account is left for the next.
    syncSettled()
      .then(ok => {
        if (!ok && !confirm("Your latest changes haven't reached the server yet. Sign out anyway?")) throw 0;
        return pushEndpoint && disablePush().then(syncSettled);
      })
      .then(() => {
        unlisten();
        return sb.auth.signOut().then(r => {
          if (r && r.error) throw r.error;
        });
      })
      .then(() => {
        captureToken = '';
        execToken = '';
        pushTest = null;
        health = null;
        try {
          localStorage.removeItem(CAPTURE_KEY);
          localStorage.removeItem(NOTICE_HASH);
          localStorage.removeItem(EXEC_KEY);
        } catch (e) {}
      })
      .then(() => {
        session = null;
        syncStatus = '';
        versions = null;
        renderSyncBadge();
        renderAccount();
      })
      .catch(e => e && toast("Couldn't sign out: " + (e.message || e), false, 4000)); // (0: chose to stay)
  }
  if (b.id === 'syncNow') {
    // (a server check taken to be missing is asked about again: a migration just run counts now)
    if (wrunCas.on === false) wrunCas = { on: null, at: 0 };
    sync();
  }
  if (b.id === 'pushkeys') setupPushKeys();
  if (b.id === 'pushnewkeys' && arm(b, 'Replace keys?')) replacePushKeys();
  if (b.id === 'pushon') enablePush();
  if (b.id === 'pushoff') disablePush();
  if (b.id === 'pushtest') testPush();
  if (b.id === 'capnew') newCaptureToken();
  if (b.id === 'captest') testCapture();
  if (b.id === 'alerttest') testAlert();
  if (b.id === 'alarmadd') addAlarm();
  if (b.id === 'notesload') loadNotes();
  if (d.aon) {
    const a = S.alarms.find(x => x.id === d.aon);
    if (a) setAlarmOn(a, !alarmOn(a));
  }
  if (d.adel) deleteAlarm(d.adel);
  if (d.forgetdev && arm(b, 'Forget?')) forgetDevice(d.forgetdev);
  if (d.adismiss) dismissAlarm(d.adismiss);
  if (d.asnooze) snoozeAlarm(d.asnooze);
  if (d.copy)
    copyText(
      {
        url: captureUrl(),
        alert: alertUrl(),
        key: CFG.supabaseAnonKey,
        token: captureToken,
        vpub: S.pushKey,
        vpriv: newPrivateKey,
        shortcut: shortcutUrl(shortcutKind, shortcutId),
        xtoken: execToken,
        xurl: execReportUrl(),
      }[d.copy],
    );
});

document.addEventListener(
  'toggle',
  e => {
    if (e.target.id && !e.target.dataset.held && !(e.target.id === 'donesec' && findOpened))
      panels[e.target.id] = e.target.open;
  },
  true,
);

// Any picture shown full size (Notes' or an article's) closes.
function closeImgs() {
  imgShown = kbImgShown = null;
  renderNoteImgs();
  renderKnowledge();
}
/* keyboard shortcuts (desktop) */
const KEYS =
  'i or n capture (n on a task: step) · / search · t today · o command centre · l history · s settings · z single-task · p pause · Esc back';
document.addEventListener('keydown', e => {
  if (!window.appReady) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('#v-alarm').hidden) return; // an alarm is ringing: its buttons only
  const el = e.target;
  // A sheet is a dialog: Tab cycles through its own controls, not the page behind it.
  if (e.key === 'Tab' && $('#sheet')) {
    const f = [...$('#sheet').querySelectorAll('button:not([disabled]),input,textarea,select,a[href]')],
      i = f.indexOf(document.activeElement);
    if (!f.length) return;
    if (e.shiftKey ? i <= 0 : i < 0 || i === f.length - 1) {
      e.preventDefault();
      f[e.shiftKey ? f.length - 1 : 0].focus();
    }
    return;
  }
  // (Release H: the keyboard's search key on Find or Search puts the keyboard away, to see what
  // was found)
  if (e.key === 'Enter' && (el.id === 'tfind' || el.id === 'sq')) {
    e.preventDefault();
    return el.blur();
  }
  // Enter in the process editor's step row adds the step (not the form's Save).
  if (e.key === 'Enter' && el.id === 'wfstepin') {
    e.preventDefault();
    return addTypedStep();
  }
  if (el.closest && el.closest('input,textarea,select,[contenteditable]')) {
    if (e.key === 'Escape') el.closest('#sheet') ? sheetBack() : el.blur();
    return;
  }
  if ($('#sheet') && e.key !== 'Escape') return; // a sheet is up: its buttons only
  const k = e.key;
  // During a running session only pause and help work (see focusLocked).
  if (focusLocked() && k !== 'p' && k !== '?') return;
  // Single-task mode covers the page: only its own keys.
  if (zen && !['z', 'Escape', 'p', '?'].includes(k)) return;
  const field = id => {
    const f = $(id);
    if (!f) return false;
    e.preventDefault();
    f.focus();
    return true;
  };
  if (k === 'n' && view === 'today' && path.length && $('#sin')) field('#sin');
  else if (k === 'n' || k === 'i') {
    triage = null; // (the capture box, not a walk under way)
    go('inbox');
    field('#iin');
  } else if (k === 't') {
    if (view === 'today' && path.length) openPath([]);
    go('today');
  } else if (k === '/') {
    e.preventDefault();
    openSearch();
  } else if (k === 'l') go('log');
  else if (k === 'p' && S.timer) {
    const b = $('[data-pause]');
    if (b) b.click();
  } else if (k === '?') toast(KEYS, false, 5000);
  else if (k === 's') go('account');
  else if (k === 'o') go('ops');
  else if (k === 'z') setZen(!zen);
  else if (k === 'Escape') {
    if ($('#sheet')) sheetBack();
    else if (imgShown || kbImgShown) closeImgs();
    else if (zen) setZen(false);
    else if (view === 'today' && path.length) openPath(path.slice(0, -1));
  }
});

/* Release H: where you were (the view, a task's page, a process run or an article open), kept
   for this tab, so a reload, or Android discarding the page in the background, opens there
   again. Only for this tab (sessionStorage): opening the app afresh starts on Today. A deep link
   (or a share, or a shortcut) wins; anything gone meanwhile falls back to Today. */
const PLACE_KEY = 'cockpit.place';
const PLACE_VIEWS = ['today', 'inbox', 'waiting', 'notes', 'knowledge', 'search', 'review', 'ops', 'focus'];
function keepPlace() {
  try {
    sessionStorage.setItem(
      PLACE_KEY,
      JSON.stringify({
        view,
        path,
        sub: reviewSub,
        q: view === 'search' ? searchQ : '',
        kb: view === 'knowledge' ? { wfOpen, wfFrom, wfView, kbArt, kbRun, kbView } : null,
      }),
    );
  } catch (e) {}
}
function takePlace() {
  let p = null;
  try {
    p = JSON.parse(sessionStorage.getItem(PLACE_KEY) || 'null');
    sessionStorage.removeItem(PLACE_KEY);
  } catch (e) {}
  // (opened at a deep link, a share or an app-icon shortcut: that's where to go)
  if (launchRoute || location.hash.startsWith('#/') || location.search.length > 1) return;
  if (!p || typeof p !== 'object' || !PLACE_VIEWS.includes(p.view)) return;
  const ids = Array.isArray(p.path) ? p.path.filter(x => typeof x === 'string' && okRef(x)) : [];
  // (the task's page only if it's all still there; else Today's list)
  const r = ids.length && find(ids[ids.length - 1]);
  path = r && [...r.parents.map(x => x.id), r.n.id].join('/') === ids.join('/') ? ids : [];
  if (p.view === 'review' && ['week', 'forecast', 'insights', 'log'].includes(p.sub)) reviewSub = p.sub;
  const k = p.kb;
  if (p.view === 'knowledge' && k && typeof k === 'object') {
    if (typeof k.wfOpen === 'string' && k.wfOpen) {
      // (a run gone meanwhile: Today, rather than a page that isn't there)
      if (!wrunById(k.wfOpen)) {
        path = [];
        return (view = 'today');
      }
      wfOpen = k.wfOpen;
      wfFrom = PLACE_VIEWS.includes(k.wfFrom) ? k.wfFrom : null;
    }
    if (typeof k.wfView === 'string' && wfById(k.wfView)) wfView = k.wfView;
    if (typeof k.kbArt === 'string' && S.kb.some(a => a.id === k.kbArt)) kbArt = k.kbArt;
    const run = typeof k.kbRun === 'string' && !wfOpen && S.runs.find(x => x.id === k.kbRun);
    if (run && S.kb.some(a => a.id === run.art)) {
      kbRun = run.id;
      kbArt = run.art;
    }
    if (k.kbView === 'proc' || k.kbView === 'ref') kbView = k.kbView;
  }
  if (p.view === 'search' && typeof p.q === 'string') searchQ = p.q.slice(0, 200);
  view = p.view;
}
// Leaving (closing, switching app): notes typed in the last moment are saved now, not after
// the typing pause.
const saveNotesNow = () => notesDirty && $('#notesin') && saveNotes($('#notesin').value);
window.addEventListener('pagehide', () => {
  if (!window.appReady) return;
  saveNotesNow();
  keepKbDraft();
  keepPlace();
});
document.addEventListener('visibilitychange', () => {
  if (!window.appReady) return; // (not started yet: nothing to save or redraw)
  if (document.hidden) {
    saveNotesNow();
    keepKbDraft();
    keepPlace();
    // (leaving the app doesn't take the keyboard off a field: a date picked just before is saved)
    const a = document.activeElement,
      wd = a && a.type === 'date' && a.closest('#waitd[data-waitid]');
    if (wd) saveWaitPanel(wd.dataset.waitid, true);
  }
  if (!document.hidden) {
    const started = rolloverLocal(); // (a sync, when signed in)
    // A session another device already stopped mustn't be finished here too: hear from the
    // server first when possible.
    if (timerDue() && started) {
      const held = holdDue();
      syncDone().finally(() => releaseHeld(held));
    } else if (timerDue() && !holdTimer) finishTimer(true);
    else inBackground(renderAll); // (keeps anything being typed)
    if (!started) sync();
    verifyPush();
  }
});
window.addEventListener('online', () => window.appReady && sync());
window.addEventListener('offline', () => {
  if (session) setSync('offline');
});
setInterval(() => {
  if (document.hidden || !window.appReady) return;
  // Midnight with the app open: the new day starts here too, not only on coming back to it.
  if (S.day !== today()) {
    rolloverLocal();
    inBackground(renderAll);
  }
  sync();
  // Keeps the free time on Today current (not under a "Delete?" waiting for its second tap).
  if (!$('#v-today .armed')) inBackground(renderToday);
  renderHeader(); // and the next alarm
}, 60000);

// Start: the pictures kept in IndexedDB are read first (see js/pics.js), then the saved copy,
// and only then does anything draw or sync.
let deferStart = false,
  heldAtStart = '';
function start(pics, kv) {
  // The sync bookkeeping from the store; the saved copy too, if it's there. If not (a first run
  // on this version), both come from localStorage, as before, and move over: they're written to
  // the store, and the localStorage copies go once what was written reads back the same.
  let moving = false;
  if (kv.sync !== null)
    try {
      sync2 = Object.assign({ cursor: 0, synced: {}, dirty: {}, snapAt: 0 }, JSON.parse(kv.sync));
    } catch (e) {}
  else moving = !!picDb;
  load(pics, kv.state);
  if (kv.state === null) moving = !!picDb;
  if (moving) {
    const written = stateJSON();
    writeKV({ state: written, sync: JSON.stringify(sync2) }).then(async ok => {
      if (!ok) return;
      const back = await readKV(picDb);
      if (back.state !== written) return;
      try {
        localStorage.removeItem(KEY);
        localStorage.removeItem(SYNC_KEY);
      } catch (e) {}
    });
  }
  // Signed in and online, the day's reset (and finishing a session that ended while the app was
  // closed) waits for the server's copy: see onAuthStateChange. Otherwise it happens here.
  deferStart = !!sb && navigator.onLine;
  if (!deferStart) rollover();
  if (!deferStart && timerDue()) finishTimer(true);
  else {
    // (the view itself and the header are drawn once, by go() below, not here as well: Release
    // G, half of starting up on a heavy day)
    syncRinging();
    renderZen();
  }
  heldAtStart = deferStart ? holdDue() : '';
  setTimeout(() => releaseHeld(heldAtStart), 20000); // (never held for long, whatever happens)
  // An article left half-written when the app was closed (or Android closed it) comes back.
  takePlace(); // (Release H: where this tab was, after a reload)
  if (restoreKbDraft()) view = 'knowledge';
  go(view);
  receiveShare();
  receiveLaunch();
  takeRoute(); // (a deep link: followed now, or after the first sync if its target isn't here yet)
  setInterval(timerTick, 500);
  setInterval(alarmTick, 1000);
  listenAuth();
  setInterval(prunePics, 60000); // (deleted pictures leave IndexedDB now and then)
  schedulePics(); // (pictures still in the saved copy, from before a reload or an older version)
  // (the app's data, pictures included, isn't cleared by the phone when space runs low)
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  window.appReady = true;
}
openPics().then(async db => {
  picDb = db;
  const [pics, kv] = await Promise.all([readPics(db), readKV(db)]);
  picStored = new Set(pics.keys());
  start(pics, kv);
});
// Android's back gesture: one history entry stands for "in the app". Going back runs the app's
// own back step (close a picture, leave an article or a task's page, back to Today...) and
// puts the entry back; only from Today's list does it leave the app.
function appBack() {
  if (!$('#v-alarm').hidden) return true; // (an alarm is ringing: its buttons only)
  if (imgShown || kbImgShown) return (closeImgs(), true);
  if (zen && !focusLocked()) return (setZen(false), true);
  if ($('#sheet')) return (sheetBack(), true); // (asking first if words were typed into it: tree.js)
  if (view === 'knowledge' && kbEdit) {
    // (an article written from an Inbox item in triage: back goes to that item, untouched)
    leaveEditor(kbEdit.fromInbox && triage ? () => triageReturn(false) : renderKnowledge);
    return true;
  }
  if (view === 'knowledge' && wfEdit) {
    const back = wfEdit.id && wfById(wfEdit.id) ? wfEdit.id : null;
    leaveEditor(() => {
      wfView = back;
      renderKnowledge();
    });
    return true;
  }
  // (a page a link led to from another view, still showing: back there. Release H)
  if (viewFrom && viewFrom.sig === placeSig()) return (backFrom(), true);
  if (view === 'knowledge' && kbRun) {
    kbRunClick({ runback: '1' }, {});
    return true;
  }
  if (view === 'knowledge' && wfOpen) return (closeWorkflowRun(), true);
  if (view === 'knowledge' && kbArt) {
    kbClick({ kbback: '1' }, {});
    return true;
  }
  if (view === 'knowledge' && wfView) {
    wfView = null;
    renderKnowledge();
    return true;
  }
  if (view === 'knowledge' && kbCatOpen) {
    const c = kbCatOpen !== 'lost' && kbCat(kbCatOpen);
    kbCatOpen = (c && c.parent) || null;
    renderKnowledge();
    return true;
  }
  if (atReturn()) return (returnBack(), true);
  if (view === 'today' && path.length) return (openPath(path.slice(0, -1)), true);
  if (view === 'inbox' && triage) return (exitTriage(), true);
  if (view === 'notes') return (go('knowledge'), true); // (where its ‹ link goes)
  if (view === 'account' && setSub) return (openSettings(null), true); // (a group: back to the index)
  if (view !== 'today') return (go('today'), true);
  return false;
}
// (the app puts the page where it belongs on back: the browser's own restoring would undo it)
try {
  history.scrollRestoration = 'manual';
} catch (e) {}
try {
  // (after a reload the entries are already there)
  if (!(history.state && history.state.app === 'in')) {
    // A deep link's route is taken off the address first (kept for takeRoute): the entry under
    // the app's own mustn't carry it, or the back gesture would replay it on the way out.
    if (location.hash.startsWith('#/')) {
      launchRoute = location.hash;
      history.replaceState({ app: 'root' }, '', location.pathname + location.search);
    } else history.replaceState({ app: 'root' }, '');
    history.pushState({ app: 'in' }, '');
  }
} catch (e) {}
window.addEventListener('popstate', () => {
  if (!window.appReady) return;
  // A deep link opened while the app is up (a hash navigation fires this too): not a back step.
  if (location.hash.startsWith('#/')) return takeRoute();
  if (appBack()) history.pushState({ app: 'in' }, '');
  else history.back();
});
// Leaving the notes box saves straight away rather than after the typing pause.
document.addEventListener('focusout', e => {
  const wd = e.target.type === 'date' && e.target.closest && e.target.closest('#waitd[data-waitid]');
  if (wd) return saveWaitPanel(wd.dataset.waitid, true);
  if (e.target.dataset && e.target.dataset.atime) {
    delete e.target.dataset.typed;
    // Once focus has moved on (so the redraw keeps it where it went).
    return setTimeout(leftAlarmTime, 0);
  }
  if (e.target.id !== 'notesin') return;
  // Going to "Show those notes" (by Tab, say) mustn't save over the notes it's about to show.
  if (e.relatedTarget && e.relatedTarget.id === 'notesload') return clearTimeout(notesTimer);
  saveNotes(e.target.value);
  // Once focus has left: shows notes that changed elsewhere meanwhile. Unless what's typed here
  // couldn't be saved over them: that stays, with the choice, until one is made.
  if (!notesDirty) setTimeout(renderNotes, 0);
});
// "Show those notes" mustn't take focus from the box first (that would save over them).
document.addEventListener('mousedown', e => {
  if (e.target.id === 'notesload') e.preventDefault();
});
function listenAuth() {
  if (!sb) return;
  sb.auth.onAuthStateChange((ev, s) => {
    session = s;
    renderSyncBadge();
    inBackground(renderAccount); // even when not on screen, so Settings never shows a stale sign-in form
    if (!s) unlisten(); // signed out, or the session expired: live updates would be dead anyway
    authSeen = true;
    if (ev === 'INITIAL_SESSION' && deferStart) {
      if (!s) {
        rollover();
        releaseHeld(heldAtStart);
        if (timerDue()) finishTimer(true);
        else inBackground(renderAll);
        retryRoute(true); // (no session: a deep link's missing target won't be synced in)
      } else sync().finally(() => releaseHeld(heldAtStart)); // (the sync runs the day's reset)
    }
    if (s && (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION')) {
      askMerge = true; // signing in here: a choice about this device's own data can be put
      if (!(ev === 'INITIAL_SESSION' && deferStart)) setTimeout(sync, 0);
      setTimeout(verifyPush, 3000); // after the first sync has brought the current key
      listen();
    }
  });
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
