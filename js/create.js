/* Phase 2: one way to make new things, and Knowledge in two views. The Knowledge tab shows
   either Reference (articles to read: categories, search, the scratchpad) or Processes (things to
   follow, run or repeat: processes, guides, desktop automations, and whatever is under way). The
   "+ New" sheet asks what you need to do and opens the editor that fits; an ordinary task still
   goes through the Inbox, as everything captured does. No new kind of record: a process is a
   workflow definition, a guide an article with steps, an automation a flow. */
let kbView = 'ref'; // 'ref' or 'proc' (this device's choice for the session)
const KB_VIEWS = [
  ['ref', 'Reference'],
  ['proc', 'Processes'],
];
function kbTabs() {
  return `<div class="kbtabs"><div class="chips viewsw" role="group" aria-label="Knowledge view">${KB_VIEWS.map(([k, l]) => `<button class="chip" data-kbview="${k}" aria-pressed="${kbView === k}">${l}</button>`).join('')}</div><button class="btn sm newbtn" data-newsheet="1" aria-haspopup="dialog">+ New</button></div>`;
}
// Processes: what's under way first (one tap to continue), then the processes and guides you can
// follow again, then the desktop automations. A guide is an article with steps: listed here
// because it's followed, read under Reference because it's an article. Same record, no copy.
function kbProcesses() {
  const runs = S.wruns.filter(r => !WRUN_OVER.includes(r.status)).sort((a, b) => b.at - a.at),
    pruns = S.runs.filter(r => !r.fin && procOf(r.art)).sort((a, b) => b.at - a.at),
    ws = S.workflows.filter(w => !w.archived).sort((a, b) => byName(a.name, b.name)),
    guides = S.kb.filter(a => a.steps && a.steps.length).sort((a, b) => byName(a.title, b.title)),
    arch = S.workflows.filter(w => w.archived).length;
  let h = '';
  if (runs.length || pruns.length)
    h += `<section class="kbsec"><h2 class="kbhead" id="wfhead">In progress <small>${runs.length + pruns.length}</small></h2><div class="list box">${runs
      .map(
        r =>
          `<div class="row"><button class="open" data-wfopen="${r.id}"><span>${esc(r.name)}</span><small><span class="wst w-${r.status}">${runWord(r)}</span>${runStage(r) ? ' · ' + esc(runStage(r).title) : ''} · ${esc(whenLabel(r.at))}</small></button><button class="btn sm ${r.status === 'failed' ? 'pink' : 'green'}" data-wfopen="${r.id}">${r.status === 'failed' ? 'Fix' : r.status === 'ready' ? 'Start' : 'Continue'}</button></div>`,
      )
      .join('')}${pruns
      .map(r => {
        const a = procOf(r.art);
        return `<div class="row"><button class="open" data-runopen="${r.id}"><span>${esc(a.title)}</span><small>Guide · ${esc(runLine(r))} · ${esc(whenLabel(r.at))}</small></button><button class="btn sm green" data-runopen="${r.id}">Continue</button></div>`;
      })
      .join('')}</div></section>`;
  h += `<section class="kbsec"><div class="sechead"><h2 class="kbhead"${runs.length || pruns.length ? '' : ' id="wfhead"'}>Processes</h2><button class="linkbtn" data-newproc="1">+ New process</button></div>`;
  h += ws.length
    ? `<div class="list box">${ws.map(processRow).join('')}</div>`
    : '<p class="hint kbempty">A process is a checklist you can run again, with an automation, a guide, a check, a wait or a decision on any step that needs one. <button class="linkbtn" data-newproc="1">Make your first one</button>, from an example or from scratch.</p>';
  if (arch) h += `<p class="hint">${plural(arch, 'archived process')} (restore from Settings > Backup).</p>`;
  h += '</section>';
  h += `<section class="kbsec"><div class="sechead"><h2 class="kbhead">Guides</h2><button class="linkbtn" data-newguide="1">+ New guide</button></div>`;
  h += guides.length
    ? `<div class="list box">${guides
        .map(a => {
          const o = openRunFor(a.id, '');
          return `<div class="row"><button class="open" data-kbart="${a.id}"><span>${esc(a.title)}</span><small>Guide · ${plural(a.steps.length, 'step')}${o ? ' · ' + esc(runLine(o)) : ''}</small></button><button class="btn sm ${o ? 'green' : 'blue'}" data-runstart="${a.id}">${o ? 'Continue' : 'Follow'}</button></div>`;
        })
        .join('')}</div>`
    : '<p class="hint kbempty">A guide is a reference article with steps to follow one at a time. Add steps to any article to make one.</p>';
  h += '</section>';
  h += `<section class="kbsec">${kbFlows()}</section>`;
  return h;
}
// One process in the list: its name opens its overview (what it's for, where it stands, start or
// continue); the button on the right is that one action.
function processRow(w) {
  const o = wfOpenRun(w.id),
    runs = wfRuns(w.id),
    last = runs.find(r => r.fin);
  return `<div class="row"><button class="open" data-wfview="${w.id}"><span>${esc(w.name)}</span><small>${plural(w.stages.length, 'step')}${w.days.length || w.monthDay ? ' · repeats ' + esc(repLabel({ days: w.days, monthDay: w.monthDay })) : ''}${o ? ` · <span class="wst w-${o.status}">${runWord(o)}</span>` : last ? ' · last ' + WRUN_WORD[last.status].toLowerCase() + ' ' + esc(dayLabel(fmt(new Date(last.fin)))) : ''}</small></button><button class="btn sm ${o ? (o.status === 'failed' ? 'pink' : 'green') : 'blue'}" data-wfstart="${w.id}">${o ? (o.status === 'failed' ? 'Fix' : o.status === 'ready' ? 'Start' : 'Continue') : 'Start'}</button></div>`;
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
    kbView = 'ref';
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
