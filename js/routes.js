/* deep links: a URL with a hash route opens a place in the app from a shortcut, a bookmark, an
   Android automation (Automate, Tasker, HTTP Shortcuts, an NFC card through one of them) or
   another app. Opening a link only navigates: nothing is changed, ticked, started or sent.
     #/today            Today (the list, with the top 3)
     #/inbox            the Inbox
     #/inbox/triage     Process inbox
     #/q/<id>           a quest or a step (on Today; one on Upcoming or in the Inbox is shown there)
     #/kb/<id>          a Knowledge article (a procedure shows its steps)
     #/kb/<id>/run      a procedure, started or resumed
     #/waiting          the Waiting Centre
     #/waiting/<id>     one waiting item, marked
     #/focus            the Focus tab (no session is started or changed)
     #/continue         the work most recently left: the newest saved place, else what's next
     #/review           the weekly review
     #/workflows        the workflows (Knowledge)
     #/ops              the Command Centre
     #/wrun/<id>        one workflow run (opened, never started or moved on)
   Followed at start once the saved copy is in; a target not here yet (a quest made on another
   device) is looked for again after the first sync. The hash is cleared once followed, so a
   reload or the back gesture doesn't replay it. Ids go through the same checks as everything
   else from outside; anything unknown is refused with a plain message. Opening a link never
   ticks, launches or sends anything; #/inbox/triage begins the walk and #/kb/<id>/run starts or
   resumes a run (a record of its own), which is what those places do on arrival. */
const ROUTES = [
  'today',
  'inbox',
  'triage',
  'q',
  'kb',
  'run',
  'waiting',
  'focus',
  'continue',
  'review',
  'workflows',
  'wrun',
  'ops',
];
let pendingRoute = null, // a route whose target isn't here yet, tried again after a sync
  routeGiveUp = null,
  launchRoute = '', // the route the app was opened at (taken off the address at once: see events.js)
  waitMark = ''; // the waiting item a link pointed at, marked in the list once
function parseRoute(hash) {
  const m = /^#\/([a-z]+)(?:\/([^/?#]+))?(?:\/([a-z]+))?\/?$/.exec(String(hash || ''));
  if (!m) return null;
  const [, kind, raw, sub] = m;
  let id = '';
  if (raw !== undefined) {
    try {
      id = decodeURIComponent(raw);
    } catch (e) {
      return null;
    }
  }
  if (kind === 'inbox' && id === 'triage') return { kind: 'triage', id: '' };
  if (id && !okRef(id)) return null;
  if (kind === 'kb' && sub === 'run') return { kind: 'run', id };
  if (sub) return null;
  if (!ROUTES.includes(kind) || kind === 'triage' || kind === 'run') return null;
  if (['q', 'kb', 'wrun'].includes(kind) && !id) return null;
  if (['today', 'inbox', 'focus', 'continue', 'review', 'workflows', 'ops'].includes(kind) && id) return null;
  return { kind, id };
}
// The URL's route, taken and cleared. Returns whether there was one.
function takeRoute() {
  const h = launchRoute || location.hash;
  launchRoute = '';
  if (!h || !h.startsWith('#/')) return false;
  try {
    history.replaceState({ app: 'in' }, '', location.pathname + location.search);
  } catch (e) {}
  const r = parseRoute(h);
  if (!r) {
    toast("That link isn't one the Dashboard knows", false, 3500);
    return true;
  }
  followRoute(r, true);
  return true;
}
// Where a quest or step is: on Today (its path), on Upcoming, or in the Inbox.
function locate(id) {
  const t = find(id);
  if (t) return { where: 'today', r: t };
  const l = find(id, S.later);
  if (l) return { where: 'later', r: l };
  const it = S.inbox.find(x => x.id === id) || S.inbox.find(x => x.node && find(id, [x.node]));
  if (it) return { where: 'inbox', it };
  return null;
}
function followRoute(r, first) {
  if ($('#sheet')) closeSheet();
  if (zen && !focusLocked()) setZen(false);
  const miss = (what, view) => {
    // Not here (yet): signed in, the first sync may bring it, so it's looked for again once
    // that's done (or once it's known there's no session). Otherwise say so, and open the list.
    if (first && deferStart && !lastSync && (!authSeen || session) && navigator.onLine) {
      pendingRoute = r;
      clearTimeout(routeGiveUp);
      routeGiveUp = setTimeout(() => pendingRoute && retryRoute(true), 20000);
      return;
    }
    pendingRoute = null;
    toast(`That ${what} isn't here: deleted, or not synced to this device yet`, false, 4000);
    if (view) go(view);
  };
  switch (r.kind) {
    case 'today':
      path = [];
      go('today');
      return;
    case 'inbox':
      triage = null;
      go('inbox');
      return;
    case 'triage':
      go('inbox');
      if (S.inbox.length) startTriage();
      else toast('The Inbox is empty');
      return;
    case 'q': {
      const at = locate(r.id);
      if (!at) return miss('quest', 'today');
      if (at.where === 'today') {
        openPath([...at.r.parents.map(p => p.id), at.r.n.id]);
        go('today');
      } else if (at.where === 'later') {
        path = [];
        go('today');
        const u = $('#upd');
        if (u) u.open = panels.upd = true;
        toast('On Upcoming: ' + at.r.n.text, false, 3000);
      } else {
        triage = null;
        expanded.add(at.it.id);
        go('inbox');
      }
      return;
    }
    case 'kb':
    case 'run': {
      const a = S.kb.find(x => x.id === r.id);
      if (!a) return miss('article', 'knowledge');
      // An article being written is only left on purpose.
      return leaveEditor(() => {
        kbArt = a.id;
        kbImgShown = null;
        kbReturn = false;
        go('knowledge');
        if (r.kind === 'run' && a.steps && a.steps.length) openRun(a.id, '');
        else if (r.kind === 'run') toast('That article has no steps to follow yet', false, 3000);
      });
    }
    case 'waiting': {
      if (r.id) {
        const w = findWaitable(r.id);
        if (!w.n || !w.n.wait) return miss('waiting item', 'waiting');
        waitMark = r.id;
      }
      go('waiting');
      if (r.id) {
        const row = $(`#v-waiting [data-wid="${r.id}"]`);
        if (row) row.scrollIntoView({ block: 'center' });
      }
      return;
    }
    case 'focus':
      go('focus');
      return;
    case 'ops':
      go('ops');
      return;
    case 'workflows':
      return leaveEditor(() => {
        kbArt = kbRun = wfOpen = wfEdit = null;
        kbCatOpen = null;
        go('knowledge');
        const el = $('#wfhead');
        if (el) el.scrollIntoView({ block: 'start' });
      });
    case 'wrun': {
      if (!wrunById(r.id)) return miss('workflow run', 'knowledge');
      return leaveEditor(() => {
        kbArt = kbRun = wfEdit = null;
        openWorkflowRun(r.id);
      });
    }
    case 'review':
      reviewSub = 'week';
      go('review');
      return;
    case 'continue': {
      // The quest with the newest saved place, else the one Next up is in, else Today.
      const placed = S.quests
          .filter(q => q.resume && !isDone(q))
          .sort((a, b) => b.resume.at - a.resume.at)[0],
        nx = !placed && nextStep(),
        q = placed || (nx && nx.q);
      path = q ? [q.id] : [];
      go('today');
      return;
    }
  }
}
// After a sync: the target may have arrived. `last`: no more waiting.
function retryRoute(last) {
  const r = pendingRoute;
  if (!r) return;
  pendingRoute = null;
  clearTimeout(routeGiveUp);
  followRoute(r, !last && !lastSync);
}

/* Settings > Shortcuts: a link for a chosen place, to copy into a shortcut, an automation or an
   NFC action. Only navigation: no link can tick, start or send anything. */
let shortcutKind = 'today',
  shortcutId = '';
const SHORTCUTS = [
  ['today', 'Start work: Today', ''],
  ['continue', 'Continue: where you left off', ''],
  ['triage', 'Process inbox', ''],
  ['inbox', 'Inbox', ''],
  ['waiting', 'Waiting Centre', ''],
  ['q', 'A quest', 'quest'],
  ['kb', 'A Knowledge article', 'article'],
  ['run', 'A procedure, to follow', 'procedure'],
  ['workflows', 'Workflows', ''],
  ['ops', 'Command Centre', ''],
  ['focus', 'Focus', ''],
  ['review', 'Weekly review', ''],
];
function shortcutUrl(kind, id) {
  const base = appUrl();
  if (kind === 'triage') return base + '#/inbox/triage';
  if (kind === 'run') return id ? base + '#/kb/' + encodeURIComponent(id) + '/run' : '';
  if (kind === 'q' || kind === 'kb') return id ? base + '#/' + kind + '/' + encodeURIComponent(id) : '';
  return base + '#/' + kind;
}
function renderShortcuts() {
  const need = (SHORTCUTS.find(s => s[0] === shortcutKind) || [])[2],
    choices =
      need === 'quest'
        ? S.quests.filter(q => !isDone(q)).map(q => [q.id, q.text])
        : need === 'article'
          ? S.kb
              .slice()
              .sort((a, b) => byName(a.title, b.title))
              .map(a => [a.id, a.title])
          : need === 'procedure'
            ? S.kb
                .filter(a => a.steps && a.steps.length)
                .sort((a, b) => byName(a.title, b.title))
                .map(a => [a.id, a.title])
            : null;
  if (choices && !choices.some(([id]) => id === shortcutId)) shortcutId = choices.length ? choices[0][0] : '';
  const url = shortcutUrl(shortcutKind, shortcutId);
  let h = `<h2 style="margin-top:26px" id="shortcutsec">Shortcuts and deep links</h2><p class="hint" style="margin:0 0 8px">A link that opens a place in the Dashboard: for a home-screen shortcut, a bookmark, Automate, Tasker, HTTP Shortcuts, or an NFC card through one of them. Opening a link only navigates; nothing is ticked, started or sent.</p>
    <label class="f" for="scpick">Open</label><select class="fld" id="scpick">${SHORTCUTS.map(([k, l]) => `<option value="${k}"${k === shortcutKind ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  if (choices)
    h += choices.length
      ? `<label class="f" for="scid">Which</label><select class="fld" id="scid">${choices.map(([id, t]) => `<option value="${id}"${id === shortcutId ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`
      : `<p class="hint">Nothing to choose from yet${need === 'procedure' ? ': add steps to an article under Knowledge' : ''}.</p>`;
  if (url)
    h += `<div class="caprow"><span>Link</span><code id="sclink">${esc(url)}</code><button class="linkbtn" data-copy="shortcut">Copy</button></div>`;
  h += `<details id="scand"${panels.scand ? ' open' : ''}><summary>Using it on Android (shortcuts, Tasker, Automate, NFC)</summary><ol class="steps">
    <li><b>Home screen:</b> open the link in Chrome, then menu > Add to Home screen. With the app installed, the link opens inside it.</li>
    <li><b>HTTP Shortcuts / Tasker / Automate:</b> add an action that opens a URL (Tasker: Browse URL; Automate: App start or Open URL) with the link.</li>
    <li><b>NFC card:</b> let Tasker (NFC Tag plugin) or Automate (NFC read block) recognise the card and run that action. The Dashboard itself can't read NFC: the automation app does, and opens the link.</li>
    <li>Capturing a thought or sending an alert from a script is different: those use the capture link under Advanced, not a deep link.</li></ol></details>`;
  return h;
}
