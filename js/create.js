/* Phase 2: one way to make new things, and Knowledge in two views. The Knowledge tab shows
   either Reference (articles to read: categories, search, the scratchpad) or Processes (things to
   follow, run or repeat: processes, guides, desktop automations, and whatever is under way). The
   "+ New" sheet asks what you need to do and opens the editor that fits; an ordinary task still
   goes through the Inbox, as everything captured does. No new kind of record: a process is a
   workflow definition, a guide an article with steps, an automation a flow. */
let kbView = 'ref'; // 'ref' or 'proc' (this device's choice for the session)
/* a line of help where it solves a real confusion, shown until dismissed (this device remembers) */
const HINTS_KEY = 'dashboard-hints';
function hintsOff() {
  try {
    return JSON.parse(localStorage.getItem(HINTS_KEY) || '[]');
  } catch (e) {
    return [];
  }
}
function hintBox(key, text) {
  if (hintsOff().includes(key)) return '';
  return `<div class="hintbox" data-hint="${key}"><span>${text}</span><button class="x" type="button" data-hintoff="${key}" aria-label="Dismiss this tip">×</button></div>`;
}
function hintOff(key) {
  try {
    localStorage.setItem(HINTS_KEY, JSON.stringify([...new Set([...hintsOff(), key])]));
  } catch (e) {}
  document.querySelectorAll(`[data-hint="${key}"]`).forEach(el => el.remove());
  // (the keyboard was on the tip's ×: on to the first field of what the tip was about)
  const next = $('#rlname') || $('#wfname') || $('[data-fspan][aria-pressed="true"]');
  if (next) next.focus({ preventScroll: true });
}
const KB_VIEWS = [
  ['ref', 'Reference'],
  ['proc', 'Processes'],
];
function kbTabs() {
  // (Release G: the page's heading, for screen readers: the tabs say which view is open)
  return `<h2 class="sr">Knowledge</h2><div class="kbtabs"><div class="chips viewsw" role="group" aria-label="Knowledge view">${KB_VIEWS.map(([k, l]) => `<button class="chip" data-kbview="${k}" aria-pressed="${kbView === k}">${l}</button>`).join('')}</div><button class="btn sm newbtn" data-newsheet="1" aria-haspopup="dialog" aria-label="New: a task, a process, an article or a desktop automation">+ New</button></div>`;
}
// Processes: what needs you first (failed runs), then what's under way (one tap to continue),
// then the processes and guides you can follow again, then the desktop automations. A guide is an
// article with steps: listed here because it's followed, read under Reference because it's an
// article. Same record, no copy. A guide being followed as a step of a process run (its run's q
// is 'wr-' + that run's id) shows through that run, not as work of its own.
function kbActivity() {
  const open = S.wruns.filter(r => !WRUN_OVER.includes(r.status)),
    failed = open.filter(r => r.status === 'failed').sort((a, b) => !!a.ack - !!b.ack || b.at - a.at),
    going = open.filter(r => r.status !== 'failed').sort((a, b) => b.at - a.at),
    pruns = S.runs.filter(r => !r.fin && procOf(r.art) && !guideParent(r)).sort((a, b) => b.at - a.at);
  return { failed, going, pruns };
}
// One process run in the activity lists: its state in words, its step, and the one action.
function activityRow(r) {
  const s = runStage(r),
    pr = s && s.type === 'procedure' && r.live.run && S.runs.find(x => x.id === r.live.run),
    act =
      r.status === 'failed'
        ? 'Fix'
        : r.status === 'ready'
          ? 'Start'
          : r.status === 'paused'
            ? 'Resume'
            : 'Continue',
    word = r.status === 'failed' && r.ack ? 'Failed · acknowledged' : runWord(r);
  return `<div class="row"><button class="open" data-wfopen="${r.id}"><span>${esc(r.name)}</span><small><span class="wst w-${r.status}">${word}</span>${s ? ' · ' + esc(s.title) : ''}${pr ? ' (guide: ' + esc(runLine(pr)) + ')' : ''}${r.status === 'failed' && r.err ? ' · ' + esc(r.err) : ''} · ${esc(whenLabel(r.at))}</small></button><button class="btn sm ${r.status === 'failed' ? 'pink' : 'green'}" data-wfopen="${r.id}" aria-label="${act}: ${esc(r.name)}">${act}</button></div>`;
}
/* finding a process or guide: a name search and a status filter, over this view only (global
   search still finds everything). Nothing stored changes; the choice lasts the session. */
let procFind = { q: '', f: '' };
const PROC_FILTERS = [
  ['', 'All'],
  ['going', 'Under way'],
  ['failed', 'Failed'],
  ['idle', 'Not started'],
];
// Where a process or guide stands, for the filter: a failed run first (it needs you), then one
// under way, else not started.
function procState(w) {
  const open = S.wruns.filter(r => r.wf === w.id && !WRUN_OVER.includes(r.status));
  return open.some(r => r.status === 'failed') ? 'failed' : open.length ? 'going' : 'idle';
}
const guideState = a => (S.runs.some(r => r.art === a.id && !r.fin && !guideParent(r)) ? 'going' : 'idle');
const procFinding = () => !!(procFind.q.trim() || procFind.f);
function procResults() {
  const q = procFind.q.trim().toLowerCase(),
    f = procFind.f,
    hit = s => !q || s.toLowerCase().includes(q),
    // (archived processes only when looked for: by name or by state, and said so)
    ws = S.workflows
      .filter(w => hit(w.name) && (!f || procState(w) === f) && (!w.archived || q || f))
      .sort((a, b) => !!a.archived - !!b.archived || byName(a.name, b.name)),
    gs = S.kb
      .filter(a => a.steps && a.steps.length && hit(a.title) && (!f || guideState(a) === f))
      .sort((a, b) => byName(a.title, b.title)),
    n = ws.length + gs.length;
  if (!n)
    return `<p class="hint procnone">Nothing ${q ? `called “${esc(procFind.q.trim())}”` : 'here'}${f ? ' that is ' + PROC_FILTERS.find(x => x[0] === f)[1].toLowerCase() : ''}. <button class="linkbtn" data-procclear="1">Show everything</button></p>`;
  return `<p class="hint procfound">${n} ${n === 1 ? 'match' : 'matches'}${ws.some(w => w.archived) ? ', archived ones included' : ''}</p><div class="list box">${ws
    .map(w =>
      w.archived
        ? `<div class="row"><button class="open" data-wfview="${w.id}"><span>${esc(w.name)}</span><small>Process · archived · ${plural(w.stages.length, 'step')}</small></button><button class="btn sm" data-wfview="${w.id}" aria-label="Open: ${esc(w.name)}">Open</button></div>`
        : processRow(w),
    )
    .join('')}${gs.map(guideRow).join('')}</div>`;
}
function procSearch(v) {
  procFind.q = v;
  const res = $('#procres'),
    all = $('#procall');
  if (res) res.innerHTML = procFinding() ? procResults() : '';
  if (all) all.hidden = procFinding();
}
function procFindBar() {
  return `<div class="procfind" role="search"><input type="search" class="fld" id="procq" value="${esc(procFind.q)}" placeholder="Find a process or guide" aria-label="Find a process or guide" autocomplete="off" enterkeyhint="search"><div class="chips procf" role="group" aria-label="Show">${PROC_FILTERS.map(([k, l]) => `<button class="chip" data-procf="${k}" aria-pressed="${procFind.f === k}">${l}</button>`).join('')}</div></div><div id="procres" aria-live="polite">${procFinding() ? procResults() : ''}</div>`;
}
// One guide in a list: its name opens the article; the button follows (or continues) it.
function guideRow(a) {
  const o = openRunFor(a.id, '');
  return `<div class="row"><button class="open" data-kbart="${a.id}"><span>${esc(a.title)}</span><small>Guide · ${plural(a.steps.length, 'step')}${o ? ' · ' + esc(runLine(o)) : ''}</small></button><button class="btn sm ${o ? 'green' : 'blue'}" data-runstart="${a.id}" aria-label="${o ? 'Continue' : 'Follow'} the guide: ${esc(a.title)}">${o ? 'Continue' : 'Follow'}</button></div>`;
}
function kbProcesses() {
  const { failed, going, pruns } = kbActivity(),
    ws = S.workflows.filter(w => !w.archived).sort((a, b) => byName(a.name, b.name)),
    guides = S.kb.filter(a => a.steps && a.steps.length).sort((a, b) => byName(a.title, b.title)),
    arch = S.workflows.filter(w => w.archived).length,
    busy = going.length + pruns.length;
  // (the search only once there's enough to search through)
  let h = ws.length + guides.length + arch >= 4 ? procFindBar() : '';
  h += `<div id="procall"${procFinding() && h ? ' hidden' : ''}>`;
  if (failed.length)
    h += `<section class="kbsec" aria-labelledby="wfattn"><h2 class="kbhead" id="wfattn">Needs attention <small>${failed.length}</small></h2><div class="list box attnlist">${failed.map(activityRow).join('')}</div></section>`;
  if (busy)
    h += `<section class="kbsec" aria-labelledby="wfhead"><h2 class="kbhead" id="wfhead">In progress <small>${busy}</small></h2><div class="list box">${going
      .map(activityRow)
      .join('')}${pruns
      .map(r => {
        const a = procOf(r.art);
        return `<div class="row"><button class="open" data-runopen="${r.id}"><span>${esc(a.title)}</span><small>Guide · ${esc(runLine(r))} · ${esc(whenLabel(r.at))}</small></button><button class="btn sm green" data-runopen="${r.id}" aria-label="Continue the guide: ${esc(a.title)}">Continue</button></div>`;
      })
      .join('')}</div></section>`;
  h += `<section class="kbsec" aria-labelledby="${busy ? 'wfprocs' : 'wfhead'}"><div class="sechead"><h2 class="kbhead" id="${busy ? 'wfprocs' : 'wfhead'}">Processes</h2><button class="linkbtn" data-newproc="1">+ New process</button></div>`;
  h += ws.length
    ? `<div class="list box">${ws.map(processRow).join('')}</div>`
    : '<p class="hint kbempty">A process is a checklist you can run again, with an automation, a guide, a check, a wait or a decision on any step that needs one. <button class="linkbtn" data-newproc="1">Make your first one</button>, from an example or from scratch.</p>';
  if (arch)
    h += `<details id="wfarchd"${panels.wfarchd ? ' open' : ''}><summary>Archived <small>${arch}</small></summary><div class="list box">${S.workflows
      .filter(w => w.archived)
      .sort((a, b) => byName(a.name, b.name))
      .map(
        w =>
          `<div class="row"><button class="open" data-wfview="${w.id}"><span>${esc(w.name)}</span><small>${plural(w.stages.length, 'step')} · archived</small></button><button class="btn sm" data-wfarchive="${w.id}">Unarchive</button></div>`,
      )
      .join('')}</div></details>`;
  h += '</section>';
  h += `<section class="kbsec" aria-labelledby="wfguides"><div class="sechead"><h2 class="kbhead" id="wfguides">Guides</h2><button class="linkbtn" data-newguide="1">+ New guide</button></div>`;
  h += guides.length
    ? `<div class="list box">${guides.map(guideRow).join('')}</div>`
    : '<p class="hint kbempty">A guide is a reference article with steps to follow one at a time. Add steps to any article to make one.</p>';
  h += '</section>';
  h += `<section class="kbsec" aria-label="Desktop automations">${kbFlows()}</section></div>`;
  return h;
}
// One process in the list: its name opens its overview (what it's for, where it stands, start or
// continue); the button on the right is that one action.
function processRow(w) {
  const o = wfOpenRun(w.id),
    runs = wfRuns(w.id),
    last = runs.find(r => r.fin);
  return `<div class="row"><button class="open" data-wfview="${w.id}"><span>${esc(w.name)}</span><small>${plural(w.stages.length, 'step')}${w.days.length || w.monthDay ? ' · repeats ' + esc(repLabel({ days: w.days, monthDay: w.monthDay })) : ''}${o ? ` · <span class="wst w-${o.status}">${runWord(o)}</span>` : last ? ' · last ' + WRUN_WORD[last.status].toLowerCase() + ' ' + esc(dayLabel(fmt(new Date(last.fin)))) : ''}</small></button><button class="btn sm ${o ? (o.status === 'failed' ? 'pink' : 'green') : 'blue'}" ${o && o.status === 'failed' ? `data-wfopen="${o.id}"` : `data-wfstart="${w.id}"`} aria-label="${o ? (o.status === 'failed' ? 'Fix' : o.status === 'ready' ? 'Start' : 'Continue') : 'Start'}: ${esc(w.name)}">${o ? (o.status === 'failed' ? 'Fix' : o.status === 'ready' ? 'Start' : 'Continue') : 'Start'}</button></div>`;
}
/* "+ New": what do you need to do? One sheet, four answers, each opening the editor that fits. */
function openNewSheet() {
  const cat = kbCatOpen && kbCatOpen !== 'lost' && kbCat(kbCatOpen) ? kbCatOpen : '';
  popSheet(
    `<h2 id="sheettitle">What do you need to do?</h2><div class="qalist newlist">
      <button class="qact" data-newkind="task"><b>Finish something</b><small>A task. It goes to the Inbox first, to sort into Today when you're ready.</small></button>
      <button class="qact" data-newkind="process"><b>Do something again and again</b><small>A process: a checklist you can run each time, with automations, checks or waits on the steps that need them.</small></button>
      <button class="qact" data-newkind="article" data-cat="${cat}"><b>Keep information</b><small>A reference article: how-tos, contacts, links. Add steps to make it a guide you can follow.</small></button>
      <button class="qact" data-newkind="flow"><b>Launch a desktop automation</b><small>A Power Automate Desktop flow, as a button you tap when you want it to run.</small></button>
    </div><div class="acts"><button class="btn" type="button" data-sheetclose="1">Cancel</button></div>`,
    { labelledBy: 'sheettitle' },
  );
}
function createClick(d, b) {
  if (d.hintoff) return hintOff(d.hintoff);
  if (d.gosec) return openSettings(SET_SEC[d.gosec] || null, d.gosec);
  if (d.setgo) return openSettings(d.setgo);
  if (d.setback) return openSettings(null);
  if (d.procf !== undefined) {
    procFind.f = procFind.f === d.procf ? '' : d.procf;
    return renderKnowledge();
  }
  if (d.procclear) {
    procFind = { q: '', f: '' };
    renderKnowledge();
    const q = $('#procq');
    if (q) q.focus();
    return;
  }
  if (d.kbview) {
    kbView = d.kbview;
    kbMoving = null;
    renderKnowledge();
    window.scrollTo(0, 0);
    return;
  }
  if (d.newsheet) return openNewSheet();
  if (d.newkind === 'task') {
    triage = null;
    go('inbox');
    const i = $('#iin');
    if (i) i.focus();
    return;
  }
  if (d.newkind === 'process' || d.newproc) return openProcessStart();
  if (d.newkind === 'article' || d.newguide) {
    kbEdit = { cat: d.cat || '' };
    if (d.newguide) kbEdit.guide = true; // (the editor opens with the steps section to hand)
    kbImgShown = null;
    if (!d.newguide) kbView = 'ref';
    if (view !== 'knowledge') go('knowledge');
    else renderKnowledge();
    window.scrollTo(0, 0);
    const t = $('#kbt');
    if (t) t.focus();
    return;
  }
  if (d.newkind === 'flow') {
    kbView = 'proc';
    panels.kbflows = true;
    if (view !== 'knowledge') go('knowledge');
    else renderKnowledge();
    const f = $('#flowname');
    if (f) {
      f.scrollIntoView({ block: 'center' });
      f.focus();
    }
  }
}
// A new process: pick an example (previewed) or start from scratch.
function openProcessStart() {
  openTemplatePicker();
}
