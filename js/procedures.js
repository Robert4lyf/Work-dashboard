/* actionable Knowledge: an article can hold ordered steps (a procedure), each with a title,
   notes, and optionally an article, a flow or a web link to use, and whether it needs checking.
   Following it is a run (S.runs, kind 'run': { id, art, q, started, at, done: [step ids], cur,
   fin }): the article is the definition, each run is one time through it, with its own ticks,
   so following it again starts fresh. A run can belong to a quest (q), which then shows how far
   it's got. Runs are small and few: finished ones are kept for a while, then dropped. */
const PROC_STEPS = 60,
  PROC_TITLE = 120,
  PROC_TEXT = 1000,
  RUNS_KEEP = 10, // finished runs kept per article
  RUNS_DAYS = 90;
let kbRun = null; // the run being followed (its id), shown in the Knowledge view
// Called from normKnowledge: an article's steps, only well-formed ones (and none when none).
function cleanSteps(ss) {
  if (!Array.isArray(ss)) return [];
  const out = [],
    seen = new Set();
  for (const s of ss) {
    if (!s || typeof s !== 'object' || !okRef(s.id) || seen.has(s.id)) continue;
    const title = cleanText(typeof s.title === 'string' ? s.title : '')
      .trim()
      .slice(0, PROC_TITLE);
    if (!title) continue;
    seen.add(s.id);
    const x = { id: s.id, title };
    const text = cleanText(typeof s.text === 'string' ? s.text : '')
      .trim()
      .slice(0, PROC_TEXT);
    if (text) x.text = text;
    if (okRef(s.kb)) x.kb = s.kb;
    if (okRef(s.flow)) x.flow = s.flow;
    if (okUrl(s.url)) x.url = s.url;
    if (s.verify) x.verify = true;
    out.push(x);
    if (out.length >= PROC_STEPS) break;
  }
  return out;
}
function normRuns() {
  S.runs = (Array.isArray(S.runs) ? S.runs : [])
    .filter(r => r && typeof r === 'object' && okRef(r.id) && okRef(r.art) && Number.isFinite(+r.started))
    .map(r => ({
      id: r.id,
      art: r.art,
      q: okRef(r.q) ? r.q : '',
      started: +r.started,
      at: Number.isFinite(+r.at) ? +r.at : +r.started,
      done: (Array.isArray(r.done) ? r.done : []).filter(okRef).filter((x, i, a) => a.indexOf(x) === i),
      cur: okRef(r.cur) ? r.cur : '',
      fin: Number.isFinite(+r.fin) && +r.fin > 0 ? +r.fin : 0,
    }));
  pruneRuns();
}
// Finished runs older than RUNS_DAYS go, as do all but the newest RUNS_KEEP per article; an
// unfinished run untouched for RUNS_DAYS goes too. (Every device prunes the same way.)
function pruneRuns() {
  const cut = Date.now() - RUNS_DAYS * 864e5,
    keep = new Set();
  S.runs = S.runs.filter(r => (r.fin ? r.fin > cut : r.at > cut));
  [...S.runs]
    .filter(r => r.fin)
    .sort((a, b) => b.fin - a.fin)
    .forEach(r => {
      const n = [...keep].filter(id => S.runs.find(x => x.id === id).art === r.art).length;
      if (n < RUNS_KEEP) keep.add(r.id);
    });
  S.runs = S.runs.filter(r => !r.fin || keep.has(r.id));
}
const procOf = id => S.kb.find(a => a.id === id && a.steps && a.steps.length) || null;
// The unfinished run of an article (for a quest, or on its own).
const openRunFor = (art, q = '') =>
  S.runs.find(r => r.art === art && (r.q || '') === (q || '') && !r.fin) || null;
const runProgress = r => {
  const a = procOf(r.art),
    stepIds = a ? a.steps.map(s => s.id) : [];
  return { done: r.done.filter(id => stepIds.includes(id)).length, total: stepIds.length };
};
// The step a run is on: the one jumped to, else the first not yet done.
function runStep(r) {
  const a = procOf(r.art);
  if (!a) return null;
  return (
    (r.cur && a.steps.find(s => s.id === r.cur && !r.done.includes(s.id))) ||
    a.steps.find(s => !r.done.includes(s.id)) ||
    null
  );
}
// Open a procedure to follow: its unfinished run, or a fresh one. (Nothing is started: a flow
// in a step runs only when its button is tapped.)
function openRun(art, q) {
  const a = procOf(art);
  if (!a) return toast('That article has no steps to follow', false, 3000);
  let r = openRunFor(art, q);
  if (!r) {
    r = { id: uid(), art, q: q || '', started: Date.now(), at: Date.now(), done: [], cur: '', fin: 0 };
    S.runs.push(r);
    save();
  }
  kbRun = r.id;
  kbArt = art;
  kbImgShown = null;
  if (q && view === 'today' && path.length) kbReturn = true; // (the article's ‹ goes back to the quest)
  if (view !== 'knowledge') go('knowledge');
  else renderKnowledge();
  window.scrollTo(0, 0);
}
function runLine(r) {
  const p = runProgress(r);
  return r.fin ? `Done ${dayLabel(fmt(new Date(r.fin)))}` : `${p.done} of ${p.total} steps`;
}
// What a step links to, as buttons (explicit: nothing runs on its own).
function stepActions(s, q) {
  const out = [];
  if (s.kb) {
    const a = S.kb.find(x => x.id === s.kb);
    out.push(
      a
        ? `<button class="btn sm" data-sart="${a.id}">Open: ${esc(a.title)}</button>`
        : '<span class="tag gone">Article removed</span>',
    );
  }
  if (s.flow) {
    const f = S.flows.find(x => x.id === s.flow);
    out.push(
      f
        ? `<a class="btn sm blue" href="${esc(f.url)}" data-flow="${f.id}"${q ? ` data-q="${q}"` : ''}>&#9654; Run: ${esc(f.name)}</a>`
        : '<span class="tag gone">Flow removed</span>',
    );
  }
  if (s.url)
    out.push(
      `<a class="btn sm" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Open: ${esc(hostOf(s.url))}</a>`,
    );
  return out.length ? `<div class="acts pacts">${out.join('')}</div>` : '';
}
// The steps as read in the article (no ticks: those belong to a run).
function procSection(a) {
  const open = openRunFor(a.id, ''),
    runs = S.runs.filter(r => r.art === a.id && r.fin).sort((x, y) => y.fin - x.fin);
  let h = `<div class="sechead pshead"><h2>Procedure <small>${a.steps.length} steps</small></h2><button class="btn sm blue" data-runstart="${a.id}">${open ? 'Resume' : 'Start'}</button></div>`;
  h += `<ol class="plist">${a.steps
    .map(
      s =>
        `<li><b>${esc(s.title)}</b>${s.verify ? ' <span class="tag opt">Check</span>' : ''}${s.text ? `<p>${kbLinkify(s.text)}</p>` : ''}${stepActions(s, '')}</li>`,
    )
    .join('')}</ol>`;
  if (open) h += `<p class="hint">Unfinished: ${runLine(open)}, last ${esc(whenLabel(open.at))}.</p>`;
  if (runs.length)
    h += `<details id="prund"${panels.prund ? ' open' : ''}><summary>Previous runs <small>${runs.length}</small></summary><ul class="flist">${runs
      .map(
        r =>
          `<li><small>${esc(dayLabel(fmt(new Date(r.fin))))}</small><span>${esc(runLine(r))}${r.q ? ' · ' + esc((find(r.q) || find(r.q, S.later) || { n: { text: 'a quest' } }).n.text) : ''}</span></li>`,
      )
      .join('')}</ul></details>`;
  return h;
}
// Following a run: the current step, with its notes and action, then the rest.
function kbRunView(r) {
  const a = procOf(r.art);
  if (!a) {
    kbRun = null;
    return kbIndex() + kbFlows();
  }
  const p = runProgress(r),
    s = runStep(r),
    q = r.q && (find(r.q) || find(r.q, S.later)),
    i = s ? a.steps.indexOf(s) : a.steps.length;
  let h = `<button class="linkbtn" data-runback="1">‹ ${esc(a.title)}</button>${q ? `<p class="hint kbtrail">For: <button class="linkbtn" data-open="${q.n.id}">${esc(q.n.text)}</button></p>` : ''}
    <h2 class="kbtitle">${esc(a.title)}</h2><div class="prog"><div style="width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%"></div></div><p class="hint runprog">${
      s ? `Step ${i + 1} of ${p.total}` : `All ${p.total} steps done`
    }${r.fin ? ' · finished' : ''}</p>`;
  if (s) {
    const xs = s.flow ? latestExec(s.flow, r.q, r.started, true) : null;
    h += `<div class="pstep box"><p class="pnum">${i + 1}</p><h3>${esc(s.title)}</h3>${s.text ? `<p class="ptext">${kbLinkify(s.text)}</p>` : ''}${stepActions(s, r.q)}${xs ? `<p class="hint xline">${execLine(xs)}</p>` : ''}${s.verify ? '<p class="hint pverify">Check the result yourself before moving on.</p>' : ''}
      <div class="acts"><button class="btn" data-runprev="${r.id}"${i === 0 ? ' disabled' : ''}>Back</button><button class="btn green" data-rundone="${r.id}" data-step="${s.id}">${s.verify ? 'Verified, next' : 'Done, next'}</button></div></div>`;
  } else
    h += `<div class="pstep box done"><h3>Every step is done.</h3><div class="acts">${r.fin ? '' : `<button class="btn green" data-runfinish="${r.id}">Finish</button>`}${q ? `<button class="btn blue" data-open="${q.n.id}">Back to the quest</button>` : ''}</div></div>`;
  h += `<ol class="plist runlist">${a.steps
    .map(st => {
      const d = r.done.includes(st.id);
      return `<li class="${d ? 'done' : st === s ? 'cur' : ''}"><button class="pjump" data-runjump="${r.id}" data-step="${st.id}">${d ? '✓ ' : ''}${esc(st.title)}</button>${d && !r.fin ? `<button class="linkbtn" data-rundone="${r.id}" data-step="${st.id}" data-undo="1">Not done</button>` : ''}</li>`;
    })
    .join('')}</ol>`;
  if (!r.fin)
    h += `<div class="links"><button class="linkbtn" data-runfresh="${a.id}" data-q="${r.q}">Start afresh</button></div>`;
  return h;
}
// Steps in the editor: a list with up and down, each opening a small form; kept on kbEdit.steps
// and saved with the article.
function kbRenderSteps() {
  const el = $('#psteps');
  if (el && kbEdit) el.innerHTML = stepsEditList();
}
function stepsEditList() {
  const ss = kbEdit.steps || [];
  if (!ss.length)
    return '<p class="hint">No steps: a plain article. Add steps to make it a procedure to follow.</p>';
  return `<ol class="plist editlist">${ss
    .map(
      (s, i) =>
        `<li><button class="pjump" type="button" data-pstep="${s.id}">${esc(s.title)}${s.kb || s.flow || s.url ? ' <small>· linked</small>' : ''}${s.verify ? ' <small>· check</small>' : ''}</button><span class="pmv"><button class="mv" type="button" data-pup="${s.id}" aria-label="Move up"${i === 0 ? ' disabled' : ''}>&#9650;</button><button class="mv" type="button" data-pdown="${s.id}" aria-label="Move down"${i === ss.length - 1 ? ' disabled' : ''}>&#9660;</button><button class="x" type="button" data-pdel="${s.id}" aria-label="Remove step: ${esc(s.title)}">×</button></span></li>`,
    )
    .join('')}</ol>`;
}
function openProcStep(id) {
  if (!kbEdit) return;
  const s = (kbEdit.steps || []).find(x => x.id === id) || { id: '', title: '', text: '' },
    opt = (list, cur, none) =>
      `<option value=""${cur ? '' : ' selected'}>${none}</option>` +
      list.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  popSheet(
    `<form id="pstepform" data-id="${s.id}"><h2 id="sheettitle">${s.id ? 'Edit step' : 'New step'}</h2>
    <label class="f" for="pstitle">Step</label><input class="fld" id="pstitle" maxlength="${PROC_TITLE}" value="${esc(s.title)}" autocomplete="off" required>
    <label class="f" for="pstext">Notes <small class="hint">(optional)</small></label><textarea class="fld" id="pstext" rows="3" maxlength="${PROC_TEXT}">${esc(s.text || '')}</textarea>
    <label class="f" for="pskb">Article to open</label><select class="fld" id="pskb">${opt(
      S.kb
        .filter(a => !kbEdit.id || a.id !== kbEdit.id)
        .sort((a, b) => byName(a.title, b.title))
        .map(a => [a.id, a.title]),
      s.kb,
      'None',
    )}</select>
    <label class="f" for="psflow">Flow to run</label><select class="fld" id="psflow">${opt(
      [...S.flows].sort((a, b) => byName(a.name, b.name)).map(f => [f.id, f.name]),
      s.flow,
      'None',
    )}</select>
    <label class="f" for="psurl">Web link</label><input class="fld" id="psurl" inputmode="url" maxlength="2000" value="${esc(s.url || '')}" placeholder="https://…" autocomplete="off">
    <label class="optbox"><input type="checkbox" id="psverify"${s.verify ? ' checked' : ''}>Needs checking before moving on</label>
    <div class="acts"><button class="btn green" id="sheetok">${s.id ? 'Save step' : 'Add step'}</button><button class="btn" type="button" data-sheetclose="1">Cancel</button></div></form>`,
    { labelledBy: 'sheettitle' },
  );
  $('#pstitle').focus();
}
function saveProcStep(id) {
  if (!kbEdit) return closeSheet();
  const title = cleanText($('#pstitle').value.trim()).slice(0, PROC_TITLE);
  if (!title) return;
  const urlv = $('#psurl').value.trim(),
    url = urlv ? parseLinkUrl(urlv) : '';
  if (urlv && !url) return toast('Enter a web address starting with http:// or https://', false, 3500);
  const s = {
    id: id || uid(),
    title,
    text: cleanText($('#pstext').value.trim()).slice(0, PROC_TEXT),
    kb: $('#pskb').value,
    flow: $('#psflow').value,
    url,
    verify: $('#psverify').checked,
  };
  kbEdit.steps = kbEdit.steps || [];
  const i = kbEdit.steps.findIndex(x => x.id === id);
  if (i >= 0) kbEdit.steps[i] = s;
  else {
    if (kbEdit.steps.length >= PROC_STEPS) return toast(`At most ${PROC_STEPS} steps`, false, 3000);
    kbEdit.steps.push(s);
  }
  closeSheet();
  kbRenderSteps();
}
function kbRunClick(d, b) {
  if (d.runstart) return openRun(d.runstart, d.q || '');
  if (d.runback) {
    kbRun = null;
    renderKnowledge();
    window.scrollTo(0, 0);
    return;
  }
  const r =
    d.rundone || d.runjump || d.runprev || d.runfinish
      ? S.runs.find(x => x.id === (d.rundone || d.runjump || d.runprev || d.runfinish))
      : null;
  if ((d.rundone || d.runjump || d.runprev || d.runfinish) && !r)
    return toast('That run is gone', false, 3000);
  if (d.rundone) {
    if (d.undo) r.done = r.done.filter(x => x !== d.step);
    else if (!r.done.includes(d.step)) r.done.push(d.step);
    r.cur = '';
    r.at = Date.now();
    save();
    renderKnowledge();
    window.scrollTo(0, 0);
  }
  if (d.runjump) {
    const a = procOf(r.art);
    if (a && a.steps.some(s => s.id === d.step)) {
      r.done = r.done.filter(x => x !== d.step);
      r.cur = d.step;
      r.at = Date.now();
      save();
      renderKnowledge();
      window.scrollTo(0, 0);
    }
  }
  if (d.runprev) {
    const a = procOf(r.art),
      s = runStep(r),
      i = s ? a.steps.indexOf(s) : a.steps.length;
    if (i > 0) {
      const prev = a.steps[i - 1];
      r.done = r.done.filter(x => x !== prev.id);
      r.cur = prev.id;
      r.at = Date.now();
      save();
      renderKnowledge();
    }
  }
  if (d.runfinish) {
    r.fin = r.at = Date.now();
    r.cur = '';
    save();
    renderKnowledge();
    toast('Procedure finished');
  }
  if (d.runfresh) {
    const old = openRunFor(d.runfresh, d.q || '');
    if (old) {
      old.fin = old.at = Date.now(); // (kept as a run, abandoned where it was)
      save();
    }
    kbRun = null;
    openRun(d.runfresh, d.q || '');
  }
  // The editor's steps.
  if (b && b.id === 'pstepadd') openProcStep('');
  if (d.pstep) openProcStep(d.pstep);
  if (d.pup || d.pdown) {
    const ss = kbEdit.steps,
      i = ss.findIndex(x => x.id === (d.pup || d.pdown)),
      j = d.pup ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < ss.length) {
      [ss[i], ss[j]] = [ss[j], ss[i]];
      kbRenderSteps();
    }
  }
  if (d.pdel && kbEdit) {
    kbEdit.steps = (kbEdit.steps || []).filter(x => x.id !== d.pdel);
    kbRenderSteps();
  }
}
// On a quest's page: a linked procedure's progress and a way in.
function procLinkLine(artId, qid) {
  const a = procOf(artId);
  if (!a) return '';
  const r = openRunFor(artId, qid),
    last = !r && S.runs.filter(x => x.art === artId && x.q === qid && x.fin).sort((x, y) => y.fin - x.fin)[0];
  return `<span class="procline"><small>${r ? esc(runLine(r)) : last ? esc(runLine(last)) : 'Not started'}</small><button class="btn sm blue" data-runstart="${artId}" data-q="${qid}">${r ? 'Resume' : 'Start'}</button></span>`;
}
