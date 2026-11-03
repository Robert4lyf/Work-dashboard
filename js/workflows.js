/* executable workflows (Release C): a workflow is a reusable definition (S.workflows, kind
   'workflow'): ordered stages of a few kinds. Running it makes a run (S.wruns, kind 'wrun') with
   its own copy of the stages (so a definition edited later never reinterprets a run under way),
   one current stage, an outcome per stage, and a status. A flow stage links to one execution
   attempt (Release B) and advances only on its verified result; a procedure stage to one
   procedure run; a waiting stage to one waiting item. The rules of movement are in the pure
   functions below (no page), the page just shows them.
   Stage: { id, type: manual|procedure|flow|verify|wait|decide, title, text, kb, flow, checks:
   [..], who, choices: [{ label, next (stage id or '') }], skip (may be skipped) }.
   Run: { id, wf, ver, name, q, def: [stages], started, at, cur, st: { [stage id]: { o: done|
   skipped|failed, at, note, exec, run, wait, pick, checks } }, status, fin, err, ack, log }. */
const WF_TYPES = ['manual', 'procedure', 'flow', 'verify', 'wait', 'decide'];
const WF_TYPE_NAME = {
  manual: 'Manual step',
  procedure: 'Knowledge procedure',
  flow: 'Automation (flow)',
  verify: 'Verification',
  wait: 'Waiting on someone',
  decide: 'Decision',
};
const WRUN_STATUS = [
  'ready',
  'running',
  'awaiting_user',
  'awaiting_automation',
  'waiting',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
];
const WRUN_WORD = {
  ready: 'Ready to start',
  running: 'Running',
  awaiting_user: 'Your turn',
  awaiting_automation: 'Waiting for the flow',
  waiting: 'Waiting on someone',
  paused: 'Paused',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const WRUN_FINAL = ['succeeded', 'failed', 'cancelled'], // not under way
  WRUN_OVER = ['succeeded', 'cancelled']; // over for good (a failed run can still be retried)
const WF_STAGES_MAX = 30,
  WF_LOG_MAX = 40,
  WRUNS_KEEP = 120,
  WRUNS_DAYS = 180;
let wfOpen = null, // the run being followed (its id), shown in the Knowledge view
  wfEdit = null; // the definition being edited: { id (none for a new one), ...fields }
const txt = (v, max) =>
  cleanText(typeof v === 'string' ? v : '')
    .trim()
    .slice(0, max);
function cleanStage(s) {
  if (!s || typeof s !== 'object' || !okRef(s.id) || !WF_TYPES.includes(s.type)) return null;
  const x = { id: s.id, type: s.type, title: txt(s.title, 120) || WF_TYPE_NAME[s.type] };
  const text = txt(s.text, 1000);
  if (text) x.text = text;
  if (s.type === 'procedure' && okRef(s.kb)) x.kb = s.kb;
  if (s.type === 'flow' && okRef(s.flow)) x.flow = s.flow;
  if (s.type === 'verify')
    x.checks = (Array.isArray(s.checks) ? s.checks : [])
      .map(c => txt(c, 160))
      .filter(Boolean)
      .slice(0, 12);
  if (s.type === 'wait') x.who = txt(s.who, 60);
  if (s.type === 'decide')
    x.choices = (Array.isArray(s.choices) ? s.choices : [])
      .map(c =>
        c && typeof c === 'object' ? { label: txt(c.label, 60), next: okRef(c.next) ? c.next : '' } : null,
      )
      .filter(c => c && c.label)
      .slice(0, 6);
  if (s.skip) x.skip = true;
  return x;
}
function cleanWorkflow(w) {
  if (!w || typeof w !== 'object' || !okRef(w.id)) return null;
  const stages = (Array.isArray(w.stages) ? w.stages : []).map(cleanStage).filter(Boolean),
    seen = new Set(),
    uniq = stages.filter(s => !seen.has(s.id) && seen.add(s.id)).slice(0, WF_STAGES_MAX);
  return {
    id: w.id,
    name: txt(w.name, 120) || 'Workflow',
    desc: txt(w.desc, 600),
    stages: uniq,
    kb: okRef(w.kb) ? w.kb : '',
    q: okRef(w.q) ? w.q : '',
    days: (Array.isArray(w.days) ? w.days : [])
      .map(Number)
      .filter(d => d >= 0 && d <= 6 && Number.isInteger(d)),
    monthDay: Number.isInteger(+w.monthDay) && +w.monthDay > 0 && +w.monthDay <= 31 ? +w.monthDay : 0,
    ver: Number.isInteger(+w.ver) && +w.ver > 0 ? +w.ver : 1,
    archived: !!w.archived,
    at: Number.isFinite(+w.at) ? +w.at : 0,
  };
}
function cleanRun(r) {
  if (!r || typeof r !== 'object' || !okRef(r.id) || !okRef(r.wf) || !Number.isFinite(+r.started))
    return null;
  const def = (Array.isArray(r.def) ? r.def : []).map(cleanStage).filter(Boolean),
    ids = new Set(def.map(s => s.id)),
    st = {};
  if (r.st && typeof r.st === 'object')
    for (const k in r.st) {
      const o = r.st[k];
      if (!ids.has(k) || !o || typeof o !== 'object' || !['done', 'skipped', 'failed'].includes(o.o))
        continue;
      st[k] = { o: o.o, at: Number.isFinite(+o.at) ? +o.at : 0 };
      if (typeof o.note === 'string' && o.note) st[k].note = txt(o.note, 300);
      if (okRef(o.exec)) st[k].exec = o.exec;
      if (okRef(o.run)) st[k].run = o.run;
      if (okRef(o.wait)) st[k].wait = o.wait;
      if (Number.isInteger(+o.pick) && +o.pick >= 0) st[k].pick = +o.pick;
    }
  // What the current stage holds while it's under way (its launch, its procedure run, its item).
  const live = {};
  if (r.live && typeof r.live === 'object') {
    if (okRef(r.live.exec)) live.exec = r.live.exec;
    if (okRef(r.live.run)) live.run = r.live.run;
    if (okRef(r.live.wait)) live.wait = r.live.wait;
    if (Array.isArray(r.live.checks)) live.checks = r.live.checks.map(Boolean).slice(0, 12);
    if (Number.isFinite(+r.live.tries)) live.tries = +r.live.tries;
    if (Number.isFinite(+r.live.launched)) live.launched = +r.live.launched;
  }
  return {
    id: r.id,
    wf: r.wf,
    ver: Number.isInteger(+r.ver) && +r.ver > 0 ? +r.ver : 1,
    name: txt(r.name, 120) || 'Workflow',
    q: okRef(r.q) ? r.q : '',
    def,
    started: +r.started,
    at: Number.isFinite(+r.at) ? +r.at : +r.started,
    cur: okRef(r.cur) && ids.has(r.cur) ? r.cur : '',
    st,
    live,
    status: WRUN_STATUS.includes(r.status) ? r.status : 'ready',
    fin: Number.isFinite(+r.fin) && +r.fin > 0 ? +r.fin : 0,
    err: txt(r.err, 300),
    ...(r.ack ? { ack: 1 } : {}),
    ...(r.byRule ? { byRule: 1 } : {}),
    log: (Array.isArray(r.log) ? r.log : [])
      .filter(l => l && typeof l === 'object' && Number.isFinite(+l.t) && typeof l.k === 'string')
      .map(l => ({ t: +l.t, k: l.k.slice(0, 20), m: txt(l.m, 200) }))
      .slice(-WF_LOG_MAX),
  };
}
function normWorkflows() {
  S.workflows = (Array.isArray(S.workflows) ? S.workflows : []).map(cleanWorkflow).filter(Boolean);
  S.wruns = (Array.isArray(S.wruns) ? S.wruns : []).map(cleanRun).filter(Boolean);
  pruneRuns2();
}
// Finished runs older than WRUNS_DAYS go, and all but the newest WRUNS_KEEP finished ones;
// unfinished runs stay (an open failure is never erased in silence).
function pruneRuns2() {
  const cut = Date.now() - WRUNS_DAYS * 864e5;
  S.wruns = S.wruns.filter(r => !r.fin || r.fin > cut);
  const fin = S.wruns.filter(r => r.fin).sort((a, b) => b.fin - a.fin);
  if (fin.length > WRUNS_KEEP) {
    const drop = new Set(fin.slice(WRUNS_KEEP).map(r => r.id));
    S.wruns = S.wruns.filter(r => !drop.has(r.id));
  }
}
const wfById = id => S.workflows.find(w => w.id === id) || null;
const wrunById = id => S.wruns.find(r => r.id === id) || null;
const runStage = r => r.def.find(s => s.id === r.cur) || null;
const runLog = (r, k, m = '') => {
  r.log.push({ t: Date.now(), k, m: txt(m, 200) });
  if (r.log.length > WF_LOG_MAX) r.log = r.log.slice(-WF_LOG_MAX);
  r.at = Date.now();
};
/* the pure rules of movement. Each returns '' when done, or why not. */
// Where a run stands, from its current stage and what that stage holds.
function settleRun(r) {
  if (WRUN_FINAL.includes(r.status) || r.status === 'paused' || r.status === 'ready') return;
  const s = runStage(r);
  if (!s) {
    r.status = 'succeeded';
    r.fin = r.fin || Date.now();
    return;
  }
  if (s.type === 'flow') {
    const x = r.live.exec && S.execs.find(e => e.id === r.live.exec);
    r.status =
      x && !EXEC_TERMINAL.includes(x.status) && !execStale(x) ? 'awaiting_automation' : 'awaiting_user';
  } else if (s.type === 'wait') {
    const w = r.live.wait && findWaitable(r.live.wait);
    r.status = w && w.n && w.n.wait ? 'waiting' : 'awaiting_user';
  } else r.status = 'awaiting_user';
}
// A run from a definition: its own copy of the stages. `id` names a recurrence's run the same
// on every device (wf id + day); `prepared` leaves it ready rather than running.
function makeRun(w, { q = '', id = '', prepared = false, byRule = false } = {}) {
  const r = {
    id: id || uid(),
    wf: w.id,
    ver: w.ver,
    name: w.name,
    q: q || w.q || '',
    def: w.stages.map(s => ({
      ...s,
      ...(s.checks ? { checks: [...s.checks] } : {}),
      ...(s.choices ? { choices: s.choices.map(c => ({ ...c })) } : {}),
    })),
    started: Date.now(),
    at: Date.now(),
    cur: w.stages.length ? w.stages[0].id : '',
    st: {},
    live: {},
    status: prepared ? 'ready' : 'running',
    fin: 0,
    err: '',
    log: [],
    ...(byRule ? { byRule: 1 } : {}),
  };
  runLog(r, prepared ? 'prepared' : 'started');
  if (!prepared) settleRun(r);
  return r;
}
function beginRun(r) {
  if (r.status !== 'ready') return 'not ready';
  r.status = 'running';
  r.started = Date.now();
  runLog(r, 'started');
  settleRun(r);
  return '';
}
// The next stage after `s`: a decision's chosen branch, else the one after it in order.
function nextStageId(r, s, pick) {
  if (
    s.type === 'decide' &&
    s.choices &&
    s.choices[pick] &&
    s.choices[pick].next &&
    r.def.some(x => x.id === s.choices[pick].next)
  )
    return s.choices[pick].next;
  const i = r.def.findIndex(x => x.id === s.id);
  return i >= 0 && i + 1 < r.def.length ? r.def[i + 1].id : '';
}
// The current stage is done (or skipped): kept with what it held, and the run moves on.
function completeStage(r, sid, { o = 'done', note = '', pick } = {}) {
  if (WRUN_OVER.includes(r.status)) return 'the run is over';
  if (r.status === 'failed' && o !== 'skipped') return 'retry it first';
  if (r.status === 'paused') return 'the run is paused';
  if (r.status === 'ready') return 'the run has not started';
  const s = runStage(r);
  if (!s || s.id !== sid) return 'not the current stage';
  if (o === 'skipped' && !s.skip) return "this stage can't be skipped";
  if (s.type === 'decide' && o === 'done' && !(s.choices || [])[pick]) return 'choose first';
  const out = { o, at: Date.now() };
  if (note) out.note = txt(note, 300);
  if (r.live.exec) out.exec = r.live.exec;
  if (r.live.run) out.run = r.live.run;
  if (r.live.wait) out.wait = r.live.wait;
  if (s.type === 'decide' && o === 'done') out.pick = pick;
  r.st[sid] = out;
  r.live = {};
  r.err = '';
  runLog(r, o, note || (s.type === 'decide' && o === 'done' ? (s.choices[pick] || {}).label : ''));
  const next = nextStageId(r, s, pick);
  r.cur = next;
  if (!next) {
    r.status = 'succeeded';
    r.fin = Date.now();
    runLog(r, 'succeeded');
  } else {
    r.status = 'running';
    settleRun(r);
  }
  return '';
}
function failStage(r, sid, err) {
  if (WRUN_FINAL.includes(r.status) || r.status === 'paused') return 'the run is over or paused';
  const s = runStage(r);
  if (!s || s.id !== sid) return 'not the current stage';
  r.status = 'failed';
  r.err = txt(err, 300) || 'Failed';
  r.st[sid] = { o: 'failed', at: Date.now(), note: r.err, ...(r.live.exec ? { exec: r.live.exec } : {}) };
  runLog(r, 'failed', r.err);
  return '';
}
// Try the current stage again: a fresh attempt (a flow stage needs a new launch; the old
// execution stays in the log). The failure is kept in the log, not repeated on its own.
function retryStage(r, sid) {
  if (r.status !== 'failed' && r.status !== 'awaiting_user' && r.status !== 'awaiting_automation')
    return 'nothing to retry';
  const s = runStage(r);
  if (!s || s.id !== sid) return 'not the current stage';
  const tries = (r.live.tries || 0) + 1;
  delete r.st[sid];
  r.live = { tries };
  r.err = '';
  r.status = 'running';
  runLog(r, 'retry', 'attempt ' + (tries + 1));
  settleRun(r);
  return '';
}
function pauseRun(r) {
  if (WRUN_FINAL.includes(r.status) || r.status === 'paused' || r.status === 'ready') return 'cannot pause';
  r.status = 'paused';
  runLog(r, 'paused');
  return '';
}
function resumeRun(r) {
  if (r.status !== 'paused') return 'not paused';
  r.status = 'running';
  runLog(r, 'resumed');
  settleRun(r);
  return '';
}
function cancelRun(r, why = '') {
  if (WRUN_OVER.includes(r.status)) return 'the run is over';
  r.status = 'cancelled';
  r.fin = Date.now();
  r.err = txt(why, 300);
  runLog(r, 'cancelled', why);
  return '';
}
/* what the world tells a run: a flow's verified result, a procedure finished, a reply received.
   Deterministic on every device: the same records lead to the same run. */
function onWorkflowEvent(ev) {
  if (ev.k === 'exec_succeeded' || ev.k === 'exec_failed' || ev.k === 'exec_cancelled') {
    S.wruns.forEach(r => {
      const s = runStage(r);
      if (!s || s.type !== 'flow' || r.live.exec !== ev.exec) return;
      if (ev.k === 'exec_succeeded') {
        if (completeStage(r, s.id, { note: ev.msg ? 'Flow: ' + ev.msg : '' }) === '') emitRun(r);
      } else if (!WRUN_FINAL.includes(r.status) && r.status !== 'paused') {
        failStage(
          r,
          s.id,
          (ev.k === 'exec_cancelled' ? 'Flow cancelled' : 'Flow failed') + (ev.msg ? ': ' + ev.msg : ''),
        );
        emitRun(r);
      }
    });
  }
  if (ev.k === 'proc_finished')
    S.wruns.forEach(r => {
      const s = runStage(r);
      if (s && s.type === 'procedure' && r.live.run === ev.run && completeStage(r, s.id, {}) === '')
        emitRun(r);
    });
  if (ev.k === 'wait_resolved')
    S.wruns.forEach(r => {
      const s = runStage(r);
      if (s && s.type === 'wait' && r.live.wait === ev.node && completeStage(r, s.id, {}) === '') emitRun(r);
    });
}
// A run that just ended tells the rules (once per outcome: the key names it).
function emitRun(r) {
  if (r.status === 'succeeded')
    emitEvent({
      k: 'wrun_succeeded',
      key: 'wrun:' + r.id + ':succeeded',
      wrun: r.id,
      wf: r.wf,
      name: r.name,
    });
  if (r.status === 'failed')
    // (named by the stage and the attempt, not the time: the same on every device)
    emitEvent({
      k: 'wrun_failed',
      key: 'wrun:' + r.id + ':failed:' + r.cur + ':' + (r.live.tries || 0),
      wrun: r.id,
      wf: r.wf,
      name: r.name,
      err: r.err,
    });
}
// A recurring workflow's run for today, made the same on every device (id = workflow + day),
// ready to start; called from the day's reset.
function rolloverWorkflows(d) {
  const [y, m, dd] = d.split('-').map(Number),
    wd = new Date(y, m - 1, dd).getDay(),
    end = new Date(y, m, 0).getDate();
  S.workflows.forEach(w => {
    if (w.archived || !w.stages.length) return;
    const hit =
      w.days.includes(wd) || (w.monthDay && (w.monthDay === dd || (w.monthDay > end && dd === end)));
    if (!hit) return;
    const id = w.id + '-' + d;
    if (S.wruns.some(r => r.id === id) || (sync2.gone && sync2.gone['wrun:' + id])) return;
    S.wruns.push(makeRun(w, { id, prepared: true }));
    emitEvent({ k: 'wf_due', key: 'wfdue:' + id, wf: w.id, wrun: id, name: w.name });
  });
}
/* actions from the page */
function startWorkflow(wfId, q = '') {
  const w = wfById(wfId);
  if (!w || !w.stages.length) return toast('That workflow has no stages yet', false, 3000);
  // A run already under way for it (same quest): that one, not a second.
  const open = S.wruns.find(
    r => r.wf === wfId && (r.q || '') === (q || w.q || '') && !WRUN_OVER.includes(r.status),
  );
  if (open) {
    if (open.status === 'ready') beginRun(open);
    save();
    return openWorkflowRun(open.id);
  }
  const r = makeRun(w, { q });
  S.wruns.push(r);
  save();
  openWorkflowRun(r.id);
}
function openWorkflowRun(id) {
  if (!wrunById(id)) return toast('That run is gone', false, 3000);
  wfOpen = id;
  kbRun = null;
  kbArt = null;
  kbEdit = null;
  if (view !== 'knowledge') go('knowledge');
  else renderKnowledge();
  window.scrollTo(0, 0);
}
// A stage's "Launch" for a flow (the tap on its button): the execution, when tracked, is the
// stage's own attempt; untracked, the launch is noted and the result is yours to confirm.
function wfLaunched(wrunId, stageId, x) {
  const r = wrunById(wrunId),
    s = r && runStage(r);
  if (!s || s.id !== stageId || s.type !== 'flow' || WRUN_FINAL.includes(r.status) || r.status === 'paused')
    return;
  if (x) r.live.exec = x.id;
  else r.live.launched = Date.now();
  runLog(r, 'launched', x ? '' : 'untracked');
  settleRun(r);
}
// The waiting item a waiting stage asks for: an Inbox item waiting on `who`, named for the stage,
// the same on every device (run + stage).
function stageWaitItem(r, s) {
  const id = keyId('w:' + r.id + ':' + s.id);
  let it = S.inbox.find(x => x.id === id);
  if (!it) {
    it = {
      id,
      text: (s.title + (r.name ? ' (' + r.name + ')' : '')).slice(0, 200),
      wait: { who: s.who || '', note: '', due: shift(today(), 2), since: today() },
    };
    S.inbox.unshift(it);
    addFollow(id, 'start');
  }
  r.live.wait = id;
  return it;
}
function wfClick(d, b) {
  if (d.wfstart) return startWorkflow(d.wfstart, d.q || '');
  if (d.wfopen) return openWorkflowRun(d.wfopen);
  if (d.wfback) {
    wfOpen = null;
    renderKnowledge();
    window.scrollTo(0, 0);
    return;
  }
  const r = d.wrun && wrunById(d.wrun);
  if (d.wrun && !r) return toast('That run is gone', false, 3000);
  if (!r) return wfEditClick(d, b);
  const s = runStage(r);
  let why = '';
  if (d.wfact === 'begin') why = beginRun(r);
  else if (d.wfact === 'done') {
    if (s && s.type === 'verify' && !(r.live.checks || []).filter(Boolean).length && s.checks.length)
      why = 'tick each check first';
    else if (s && s.type === 'verify' && s.checks.some((c, i) => !(r.live.checks || [])[i]))
      why = 'tick each check first';
    else why = completeStage(r, s ? s.id : '');
  } else if (d.wfact === 'pick') why = completeStage(r, s ? s.id : '', { pick: +d.pick });
  else if (d.wfact === 'skip')
    return sheet(
      { title: 'Skip this stage?', label: 'Why', ok: 'Skip', placeholder: 'Done by hand already' },
      v => {
        const why2 = completeStage(r, s ? s.id : '', { o: 'skipped', note: v || 'skipped' });
        if (why2) toast("Couldn't skip: " + why2, false, 3000);
        save();
        renderKnowledge();
      },
    );
  else if (d.wfact === 'fail')
    return sheet({ title: 'What went wrong?', label: 'Error', ok: 'Mark failed', danger: true }, v => {
      const why2 = failStage(r, s ? s.id : '', v || 'Failed');
      if (why2) toast(why2, false, 3000);
      else emitRun(r);
      save();
      renderKnowledge();
    });
  else if (d.wfact === 'retry') {
    if (s && s.type === 'flow' && r.st[s.id] && r.st[s.id].exec)
      return sheet(
        {
          title: 'Launch the flow again?',
          text: 'The last attempt may already have done its work. Only retry if you have checked that it is safe to run again.',
          ok: 'Retry',
          danger: true,
        },
        () => {
          retryStage(r, s.id);
          save();
          renderKnowledge();
        },
      );
    why = retryStage(r, s ? s.id : '');
  } else if (d.wfact === 'pause') why = pauseRun(r);
  else if (d.wfact === 'resume') why = resumeRun(r);
  else if (d.wfact === 'cancel')
    return sheet(
      {
        title: 'Cancel this run?',
        text: 'Its stages so far are kept in the history.',
        ok: 'Cancel the run',
        cancel: 'Keep going',
        danger: true,
      },
      () => {
        cancelRun(r, 'cancelled by you');
        emitRun(r);
        save();
        renderKnowledge();
      },
    );
  else if (d.wfact === 'ack') {
    r.ack = 1;
    save();
    renderAll();
    return;
  } else if (d.wfact === 'inbox') {
    const text = ('Workflow failed: ' + r.name).slice(0, 200);
    S.inbox.unshift({ id: uid(), text, node: fix({ id: uid(), text, notes: runSummary(r) }) });
    r.ack = 1;
    save();
    renderAll();
    return toast('Added to inbox');
  } else if (d.wfact === 'copy') return copyText(runSummary(r));
  else if (d.wfact === 'check') {
    const i = +d.i;
    r.live.checks = r.live.checks || [];
    r.live.checks[i] = !r.live.checks[i];
    save();
    return renderKnowledge();
  } else if (d.wfact === 'confirmflow') {
    // Tracking off, or no word after a day: the result, confirmed by you (and said so).
    if (d.ok === 'yes') why = completeStage(r, s ? s.id : '', { note: 'Result confirmed by hand' });
    else why = failStage(r, s ? s.id : '', 'Failed (confirmed by hand)');
    if (!why) emitRun(r);
  } else if (d.wfact === 'procedure') {
    if (!s || s.type !== 'procedure' || !procOf(s.kb)) return toast('That procedure is gone', false, 3000);
    const pr = openRunFor(s.kb, 'wr-' + r.id) || null;
    if (!pr) {
      const nr = {
        id: uid(),
        art: s.kb,
        q: 'wr-' + r.id,
        started: Date.now(),
        at: Date.now(),
        done: [],
        cur: '',
        fin: 0,
      };
      S.runs.push(nr);
      r.live.run = nr.id;
    } else r.live.run = pr.id;
    runLog(r, 'procedure');
    save();
    kbRun = r.live.run;
    kbArt = s.kb;
    wfOpen = null;
    kbRunBackWf = r.id;
    renderKnowledge();
    return window.scrollTo(0, 0);
  } else if (d.wfact === 'waititem') {
    if (!s || s.type !== 'wait') return;
    stageWaitItem(r, s);
    settleRun(r);
    runLog(r, 'waiting', s.who || '');
    save();
    return renderKnowledge();
  } else if (d.wfact === 'received') {
    // The reply came (the item's been cleared elsewhere, or you say so): the stage is done.
    const it = r.live.wait && findWaitable(r.live.wait);
    if (it && it.n && it.n.wait)
      setWaiting(r.live.wait, null); // (emits wait_resolved: the run moves on there)
    else why = completeStage(r, s ? s.id : '', { note: 'received' });
  }
  if (why) toast("Couldn't: " + why, false, 3000);
  if (r.status === 'succeeded' || r.status === 'failed') emitRun(r);
  save();
  renderKnowledge();
  if (r.status === 'succeeded') toast('Workflow succeeded');
}
let kbRunBackWf = null; // a procedure opened from a workflow run: its ‹ goes back to the run
function runSummary(r) {
  return [
    `Workflow: ${r.name} (${r.wf} v${r.ver})`,
    `Run: ${r.id}${r.q ? ' · quest ' + r.q : ''}`,
    `Started: ${new Date(r.started).toLocaleString()}`,
    `Status: ${WRUN_WORD[r.status]}${r.err ? ': ' + r.err : ''}`,
    ...r.def.map(
      s =>
        `  ${r.st[s.id] ? r.st[s.id].o : s.id === r.cur ? 'current' : 'pending'}: ${s.title}${r.st[s.id] && r.st[s.id].note ? ' (' + r.st[s.id].note + ')' : ''}`,
    ),
    'Log:',
    ...r.log.map(l => `  ${new Date(l.t).toLocaleString()} ${l.k}${l.m ? ': ' + l.m : ''}`),
  ].join('\n');
}
/* the page: a run, its current stage first */
function runProgressOf(r) {
  const done = r.def.filter(s => r.st[s.id] && r.st[s.id].o !== 'failed').length;
  return { done, total: r.def.length };
}
function wfRunView(r) {
  const s = runStage(r),
    p = runProgressOf(r),
    i = s ? r.def.indexOf(s) : r.def.length,
    q = r.q && (find(r.q) || find(r.q, S.later)),
    final = WRUN_OVER.includes(r.status);
  let h = `<button class="linkbtn" data-wfback="1">‹ Workflows</button>${q ? `<p class="hint kbtrail">For: <button class="linkbtn" data-open="${q.n.id}">${esc(q.n.text)}</button></p>` : ''}
    <h2 class="kbtitle">${esc(r.name)}</h2><div class="prog"><div style="width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%"></div></div>
    <p class="hint runprog"><span class="wst w-${r.status}">${WRUN_WORD[r.status]}</span>${s ? ` · stage ${i + 1} of ${p.total}` : ''}${!navigator.onLine && r.status === 'awaiting_automation' ? ' · offline: as last synced' : ''}</p>`;
  if (r.err && r.status === 'failed')
    h += `<div class="ask box werr"><p><b>Failed.</b> ${esc(r.err)}</p></div>`;
  if (r.status === 'ready')
    h += `<div class="pstep box"><h3>Ready to start</h3>${r.def.length ? `<p class="ptext">First: ${esc(r.def[0].title)}</p>` : ''}<div class="acts"><button class="btn green" data-wrun="${r.id}" data-wfact="begin">Start</button><button class="btn" data-wrun="${r.id}" data-wfact="cancel">Cancel</button></div></div>`;
  else if (r.status === 'paused')
    h += `<div class="pstep box"><h3>Paused</h3>${s ? `<p class="ptext">At: ${esc(s.title)}</p>` : ''}<div class="acts"><button class="btn green" data-wrun="${r.id}" data-wfact="resume">Resume</button><button class="btn" data-wrun="${r.id}" data-wfact="cancel">Cancel</button></div></div>`;
  else if (final)
    h += `<div class="pstep box done"><h3>${WRUN_WORD[r.status]}${r.fin ? ' · ' + esc(whenLabel(r.fin)) : ''}</h3><div class="acts">${r.status === 'failed' && !r.ack ? `<button class="btn" data-wrun="${r.id}" data-wfact="ack">Acknowledge</button>` : ''}${r.status === 'failed' ? `<button class="btn" data-wrun="${r.id}" data-wfact="inbox">Add to the Inbox</button>` : ''}<button class="btn" data-wrun="${r.id}" data-wfact="copy">Copy summary</button>${q ? `<button class="btn blue" data-open="${q.n.id}">Back to the quest</button>` : ''}</div></div>`;
  else if (s) h += stageCard(r, s, i);
  // Every stage, with its outcome.
  h += `<ol class="plist runlist wlist">${r.def
    .map((st, j) => {
      const o = r.st[st.id];
      return `<li class="${o ? o.o : st === s ? 'cur' : ''}"><span class="pjump"><small>${WF_TYPE_NAME[st.type]}</small>${o ? (o.o === 'done' ? '✓ ' : o.o === 'skipped' ? '↷ ' : '✗ ') : st === s ? '▶ ' : ''}${esc(st.title)}${o && o.note ? ` <small>· ${esc(o.note)}</small>` : ''}</span></li>`;
    })
    .join('')}</ol>`;
  if (!final && r.status !== 'ready')
    h += `<div class="links"><button class="linkbtn" data-wrun="${r.id}" data-wfact="${r.status === 'paused' ? 'resume' : 'pause'}">${r.status === 'paused' ? 'Resume' : 'Pause'}</button><button class="linkbtn" data-wrun="${r.id}" data-wfact="cancel">Cancel the run</button><button class="linkbtn" data-wrun="${r.id}" data-wfact="copy">Copy summary</button></div>`;
  if (r.log.length)
    h += `<details id="wlogd"${panels.wlogd ? ' open' : ''}><summary>What happened <small>${r.log.length}</small></summary><ul class="flist">${r.log
      .slice()
      .reverse()
      .map(
        l =>
          `<li><small>${esc(whenLabel(l.t))}</small><span><b>${esc(l.k)}</b>${l.m ? ': ' + esc(l.m) : ''}</span></li>`,
      )
      .join('')}</ul></details>`;
  return h;
}
// The current stage: what to do, and the one action that moves it on.
function stageCard(r, s, i) {
  const id = r.id,
    b = (act, label, cls = '', extra = '') =>
      `<button class="btn ${cls}" data-wrun="${id}" data-wfact="${act}" ${extra}>${label}</button>`;
  let body = s.text ? `<p class="ptext">${kbLinkify(s.text)}</p>` : '',
    acts = '';
  const failed = r.status === 'failed';
  if (failed) {
    acts = `${b('retry', 'Retry', 'green')}${s.skip ? b('skip', 'Skip') : ''}${b('cancel', 'Cancel')}${r.ack ? '' : b('ack', 'Acknowledge')}${b('inbox', 'Inbox item')}`;
  } else if (s.type === 'manual')
    acts = `${b('done', 'Done, next', 'green')}${s.skip ? b('skip', 'Skip') : ''}${b('fail', "Couldn't")}`;
  else if (s.type === 'verify') {
    const ticks = r.live.checks || [];
    body += `<div class="wchecks">${(s.checks || [])
      .map(
        (c, j) =>
          `<label class="optbox"><input type="checkbox" data-wrun="${id}" data-wfact="check" data-i="${j}"${ticks[j] ? ' checked' : ''}>${esc(c)}</label>`,
      )
      .join('')}</div>`;
    const all = s.checks.every((c, j) => ticks[j]);
    acts = `${b('done', 'Verified, next', 'green', all ? '' : 'disabled')}${s.skip ? b('skip', 'Skip') : ''}${b('fail', 'Not right')}`;
  } else if (s.type === 'decide')
    acts =
      (s.choices || [])
        .map(
          (c, j) =>
            `<button class="btn blue" data-wrun="${id}" data-wfact="pick" data-pick="${j}">${esc(c.label)}</button>`,
        )
        .join('') + (s.skip ? b('skip', 'Skip') : '');
  else if (s.type === 'procedure') {
    const a = procOf(s.kb),
      pr = r.live.run && S.runs.find(x => x.id === r.live.run);
    body += a
      ? `<p class="hint">Procedure: ${esc(a.title)}${pr ? ' · ' + esc(runLine(pr)) : ''}</p>`
      : '<p class="hint"><span class="tag gone">Procedure removed</span> Finish this stage by hand, or skip it.</p>';
    acts = `${a ? b('procedure', pr ? 'Resume procedure' : 'Start procedure', 'blue') : ''}${pr && pr.fin ? b('done', 'Done, next', 'green') : ''}${s.skip || !a ? b('skip', 'Skip') : ''}`;
  } else if (s.type === 'flow') {
    const f = S.flows.find(x => x.id === s.flow),
      x = r.live.exec && S.execs.find(e => e.id === r.live.exec);
    if (!f) {
      body +=
        '<p class="hint"><span class="tag gone">Flow removed</span> Confirm the result by hand, or skip.</p>';
      acts = `${b('confirmflow', 'It succeeded', 'green', 'data-ok="yes"')}${b('confirmflow', 'It failed', '', 'data-ok="no"')}${s.skip ? b('skip', 'Skip') : ''}`;
    } else if (x && !EXEC_TERMINAL.includes(x.status) && !execStale(x)) {
      body += `<p class="hint xline">${execLine(x)}</p><p class="hint">The stage moves on when the flow reports its result.${S.track ? '' : ''}</p>`;
      acts = `${b('confirmflow', 'It succeeded (checked by hand)', '', 'data-ok="yes"')}${b('confirmflow', 'It failed', '', 'data-ok="no"')}`;
    } else {
      if (x) body += `<p class="hint xline">${execLine(x)}</p>`;
      body += S.track
        ? '<p class="hint">Launch the flow; the stage moves on when its result is reported.</p>'
        : '<p class="hint">Execution tracking is off (Settings > Flows and automations): launch the flow, then confirm its result yourself.</p>';
      acts = `<a class="btn blue" href="${esc(f.url)}" data-flow="${f.id}" data-wrun="${id}" data-wstage="${s.id}"${r.q ? ` data-q="${r.q}"` : ''}>&#9654; Launch ${esc(f.name)}</a>${
        x || !S.track
          ? `${b('confirmflow', 'It succeeded (checked by hand)', '', 'data-ok="yes"')}${b('confirmflow', 'It failed', '', 'data-ok="no"')}`
          : ''
      }${s.skip ? b('skip', 'Skip') : ''}`;
    }
  } else if (s.type === 'wait') {
    const it = r.live.wait && findWaitable(r.live.wait);
    if (it && it.n && it.n.wait)
      body += `<p class="hint">Waiting on ${esc(it.n.wait.who || 'someone')} · <button class="linkbtn" data-goto="waiting">Waiting Centre</button></p>`;
    else if (r.live.wait) body += '<p class="hint">The waiting item was cleared.</p>';
    acts = `${it && it.n && it.n.wait ? b('received', 'Reply received', 'green') : r.live.wait ? b('received', 'Received, next', 'green') : b('waititem', 'Start waiting' + (s.who ? ' on ' + esc(s.who) : ''), 'blue')}${s.skip ? b('skip', 'Skip') : ''}`;
  }
  return `<div class="pstep box${failed ? ' failed' : ''}"><p class="pnum">${i + 1}</p><h3>${esc(s.title)}</h3><p class="hint ptype">${WF_TYPE_NAME[s.type]}</p>${body}<div class="acts wacts">${acts}</div></div>`;
}
/* definitions: the list under Knowledge, and the editor (a stage list) */
const WF_TEMPLATES = [
  {
    name: 'Weekly report',
    desc: 'Prepare, run the report flow, check the output, send.',
    stages: [
      ['manual', 'Prepare', 'Check the period and the source data.'],
      ['flow', 'Run the report flow', ''],
      [
        'verify',
        'Check the output',
        '',
        ['Right reporting period', 'File generated and complete', 'Destination correct'],
      ],
      ['manual', 'Send and file', ''],
    ],
  },
  {
    name: 'Month-end checklist',
    desc: 'Prepare, reconcile by hand, review, get approval, close.',
    stages: [
      ['manual', 'Prepare', 'Gather statements and the month’s figures.'],
      ['manual', 'Reconcile', ''],
      ['verify', 'Review', '', ['Totals agree', 'Exceptions noted']],
      ['wait', 'Approval', '', [], 'Approver'],
      ['manual', 'Close the month', ''],
    ],
  },
  {
    name: 'Approval process',
    desc: 'Prepare the request, wait, follow up, act on the answer.',
    stages: [
      ['manual', 'Prepare the request', ''],
      ['wait', 'Waiting for the answer', '', [], ''],
      [
        'decide',
        'Outcome',
        '',
        [],
        '',
        [
          ['Approved', ''],
          ['Rejected: rework', ''],
        ],
      ],
      ['manual', 'Act on it', ''],
    ],
  },
  {
    name: 'Manual process',
    desc: 'Read the instructions, do the work, check it.',
    stages: [
      ['manual', 'Read the instructions', ''],
      ['manual', 'Do it', ''],
      ['verify', 'Check', '', ['Result as expected']],
    ],
  },
];
function templateToWorkflow(t) {
  const w = {
    id: uid(),
    name: t.name,
    desc: t.desc,
    stages: [],
    days: [],
    monthDay: 0,
    ver: 1,
    archived: false,
    at: Date.now(),
    kb: '',
    q: '',
  };
  w.stages = t.stages.map(([type, title, text, checks, who, choices]) => {
    const s = { id: uid(), type, title, text: text || '' };
    if (type === 'verify') s.checks = checks || [];
    if (type === 'wait') s.who = who || '';
    if (type === 'decide') s.choices = (choices || []).map(([label, next]) => ({ label, next: next || '' }));
    if (type === 'manual' || type === 'verify') s.skip = true;
    return s;
  });
  return w;
}
const wfRuns = id => S.wruns.filter(r => r.wf === id).sort((a, b) => b.started - a.started);
const wfOpenRun = id => S.wruns.find(r => r.wf === id && !WRUN_OVER.includes(r.status)) || null;
function kbWorkflows() {
  const ws = S.workflows.filter(w => !w.archived).sort((a, b) => byName(a.name, b.name)),
    arch = S.workflows.filter(w => w.archived).length,
    open = S.wruns.filter(r => !WRUN_OVER.includes(r.status)).sort((a, b) => b.at - a.at);
  let h = `<h2 class="kbhead">Workflows</h2>`;
  if (open.length)
    h += `<div class="list box">${open
      .map(
        r =>
          `<div class="row"><button class="open" data-wfopen="${r.id}"><span>${esc(r.name)}</span><small><span class="wst w-${r.status}">${WRUN_WORD[r.status]}</span>${runStage(r) ? ' · ' + esc(runStage(r).title) : ''} · ${esc(whenLabel(r.at))}</small></button></div>`,
      )
      .join('')}</div>`;
  h += ws.length
    ? `<div class="list box">${ws
        .map(w => {
          const o = wfOpenRun(w.id),
            runs = wfRuns(w.id),
            last = runs.find(r => r.fin);
          return `<div class="row"><button class="open" data-wfedit="${w.id}"><span>${esc(w.name)}</span><small>${plural(w.stages.length, 'stage')}${w.days.length || w.monthDay ? ' · repeats ' + esc(repLabel({ days: w.days, monthDay: w.monthDay })) : ''}${last ? ' · last ' + WRUN_WORD[last.status].toLowerCase() + ' ' + esc(dayLabel(fmt(new Date(last.fin)))) : ''}</small></button><button class="btn sm ${o ? 'green' : 'blue'}" data-wfstart="${w.id}">${o ? 'Resume' : 'Start'}</button></div>`;
        })
        .join('')}</div>`
    : '<p class="hint">A workflow is a reusable process: manual steps, procedures, flows, checks and waits, run one stage at a time. Start from a template or build your own.</p>';
  h += `<div class="chips resadd"><button class="chip" data-wfnew="1">+ Workflow</button>${WF_TEMPLATES.map((t, i) => `<button class="chip" data-wftpl="${i}">+ ${esc(t.name)}</button>`).join('')}</div>`;
  if (arch) h += `<p class="hint">${plural(arch, 'archived workflow')} (shown in Settings > Backup).</p>`;
  return h;
}
function wfEditor() {
  const w = wfEdit,
    st = (k, l, p) => `<button class="chip" data-wfpreset="${k}" aria-pressed="${p}">${l}</button>`;
  let h = `<h2>${w.id ? 'Edit workflow' : 'New workflow'}</h2><form id="wfform">
    <label class="f" for="wfname">Name</label><input class="fld" id="wfname" maxlength="120" value="${esc(w.name || '')}" autocomplete="off" required>
    <label class="f" for="wfdesc">What it is for <small class="hint">(optional)</small></label><textarea class="fld" id="wfdesc" rows="2" maxlength="600">${esc(w.desc || '')}</textarea>
    <div class="sechead kbimghead"><h2>Stages</h2><button class="btn sm" type="button" id="wfstageadd">Add stage</button></div><div id="wfstages">${wfStagesList()}</div>
    <details id="wfrep"${w.days.length || w.monthDay ? ' open' : ''}><summary>Repeat: ${w.days.length || w.monthDay ? esc(repLabel({ days: w.days, monthDay: w.monthDay })) : 'off'}</summary>
      <p class="hint">On its days a run is made ready for you (never started on its own).</p>
      <div class="chips" style="margin-bottom:10px">${st('weekdays', 'Weekdays', repLabel({ days: w.days, monthDay: 0 }) === 'Weekdays')}${st('off', 'Off', !w.days.length && !w.monthDay)}</div>
      <div class="days">${WEEK.map(i => `<button class="day" type="button" data-wfday="${i}" aria-pressed="${w.days.includes(i)}" aria-label="${WD[i]}">${WD[i].slice(0, 2)}</button>`).join('')}</div>
      <label class="f" for="wfmonth">Also monthly, on day</label><select class="fld" id="wfmonth"><option value="0">Not monthly</option>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}"${w.monthDay === i + 1 ? ' selected' : ''}>${ord(i + 1)}</option>`).join('')}</select>
    </details>
    <div class="acts"><button class="btn green">Save</button><button class="btn" type="button" data-wfcancel="1">Cancel</button></div>${
      w.id
        ? `<div class="links"><button class="linkbtn" type="button" data-wfdup="${w.id}">Duplicate</button><button class="dellink" type="button" data-wfarchive="${w.id}">${w.archived ? 'Unarchive' : 'Archive'}</button></div>`
        : ''
    }</form>`;
  return h;
}
function wfStagesList() {
  const ss = wfEdit.stages;
  if (!ss.length) return '<p class="hint">No stages yet.</p>';
  return `<ol class="plist editlist">${ss
    .map(
      (s, i) =>
        `<li><button class="pjump" type="button" data-wfstage="${s.id}">${esc(s.title)} <small>· ${WF_TYPE_NAME[s.type]}</small></button><span class="pmv"><button class="mv" type="button" data-wfup="${s.id}" aria-label="Move up"${i === 0 ? ' disabled' : ''}>&#9650;</button><button class="mv" type="button" data-wfdown="${s.id}" aria-label="Move down"${i === ss.length - 1 ? ' disabled' : ''}>&#9660;</button><button class="x" type="button" data-wfdel="${s.id}" aria-label="Remove stage: ${esc(s.title)}">×</button></span></li>`,
    )
    .join('')}</ol>`;
}
function wfRenderStages() {
  const el = $('#wfstages');
  if (el && wfEdit) el.innerHTML = wfStagesList();
}
function openStageForm(id) {
  if (!wfEdit) return;
  const s = wfEdit.stages.find(x => x.id === id) || { id: '', type: 'manual', title: '', text: '' },
    opt = (list, cur, none) =>
      `<option value=""${cur ? '' : ' selected'}>${none}</option>` +
      list.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join(''),
    others = wfEdit.stages.filter(x => x.id !== s.id).map(x => [x.id, x.title]);
  popSheet(
    `<form id="wfstageform" data-id="${s.id}"><h2 id="sheettitle">${s.id ? 'Edit stage' : 'New stage'}</h2>
    <label class="f" for="wstype">Kind</label><select class="fld" id="wstype">${WF_TYPES.map(t => `<option value="${t}"${t === s.type ? ' selected' : ''}>${WF_TYPE_NAME[t]}</option>`).join('')}</select>
    <label class="f" for="wstitle">Stage</label><input class="fld" id="wstitle" maxlength="120" value="${esc(s.title)}" autocomplete="off" required>
    <label class="f" for="wstext">Instructions <small class="hint">(optional)</small></label><textarea class="fld" id="wstext" rows="2" maxlength="1000">${esc(s.text || '')}</textarea>
    <div data-for="procedure"><label class="f" for="wskb">Procedure</label><select class="fld" id="wskb">${opt(
      S.kb.filter(a => a.steps && a.steps.length).map(a => [a.id, a.title]),
      s.kb,
      'Choose',
    )}</select></div>
    <div data-for="flow"><label class="f" for="wsflow">Flow</label><select class="fld" id="wsflow">${opt(
      S.flows.map(f => [f.id, f.name]),
      s.flow,
      'Choose',
    )}</select></div>
    <div data-for="verify"><label class="f" for="wschecks">Checks, one per line</label><textarea class="fld" id="wschecks" rows="3" maxlength="2000">${esc((s.checks || []).join('\n'))}</textarea></div>
    <div data-for="wait"><label class="f" for="wswho">Waiting on whom</label><input class="fld" id="wswho" maxlength="60" value="${esc(s.who || '')}" list="wholist" autocomplete="off">${whoList()}</div>
    <div data-for="decide"><label class="f" for="wschoices">Choices, one per line <small class="hint">(add " -> stage" to jump)</small></label><textarea class="fld" id="wschoices" rows="3" maxlength="1000">${esc((s.choices || []).map(c => c.label + (c.next ? ' -> ' + ((wfEdit.stages.find(x => x.id === c.next) || {}).title || '') : '')).join('\n'))}</textarea>${others.length ? `<p class="hint">Stages: ${others.map(([, t]) => esc(t)).join(' · ')}</p>` : ''}</div>
    <label class="optbox"><input type="checkbox" id="wsskip"${s.skip ? ' checked' : ''}>May be skipped (with a reason)</label>
    <div class="acts"><button class="btn green" id="sheetok">${s.id ? 'Save stage' : 'Add stage'}</button><button class="btn" type="button" data-sheetclose="1">Cancel</button></div></form>`,
    { labelledBy: 'sheettitle' },
  );
  wsShowKind();
  $('#wstitle').focus();
}
function wsShowKind() {
  const t = $('#wstype') && $('#wstype').value;
  document.querySelectorAll('#wfstageform [data-for]').forEach(d => (d.hidden = d.dataset.for !== t));
}
function saveStageForm(id) {
  if (!wfEdit) return closeSheet();
  const type = $('#wstype').value,
    title = txt($('#wstitle').value, 120);
  if (!WF_TYPES.includes(type) || !title) return;
  const s = { id: id || uid(), type, title, text: txt($('#wstext').value, 1000), skip: $('#wsskip').checked };
  if (type === 'procedure') s.kb = $('#wskb').value;
  if (type === 'flow') s.flow = $('#wsflow').value;
  if (type === 'verify')
    s.checks = $('#wschecks')
      .value.split('\n')
      .map(c => c.trim())
      .filter(Boolean);
  if (type === 'wait') s.who = txt($('#wswho').value, 60);
  if (type === 'decide')
    s.choices = $('#wschoices')
      .value.split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        const m = /^(.*?)\s*->\s*(.+)$/.exec(l),
          label = m ? m[1].trim() : l,
          target =
            m &&
            wfEdit.stages.find(x => x.title.toLowerCase() === m[2].trim().toLowerCase() && x.id !== s.id);
        return { label, next: target ? target.id : '' };
      });
  if ((type === 'procedure' && !s.kb) || (type === 'flow' && !s.flow))
    return toast('Choose which one', false, 3000);
  if (type === 'verify' && !s.checks.length) return toast('Add at least one check', false, 3000);
  if (type === 'decide' && !s.choices.length) return toast('Add at least one choice', false, 3000);
  const i = wfEdit.stages.findIndex(x => x.id === id);
  if (i >= 0) wfEdit.stages[i] = s;
  else {
    if (wfEdit.stages.length >= WF_STAGES_MAX) return toast(`At most ${WF_STAGES_MAX} stages`, false, 3000);
    wfEdit.stages.push(s);
  }
  closeSheet();
  wfRenderStages();
}
function saveWorkflowForm() {
  if (!wfEdit) return;
  const name = txt($('#wfname').value, 120);
  if (!name) return;
  const w = cleanWorkflow({
    ...wfEdit,
    id: wfEdit.id || uid(),
    name,
    desc: txt($('#wfdesc').value, 600),
    monthDay: +$('#wfmonth').value,
    at: Date.now(),
  });
  const cur = wfById(w.id);
  if (cur) {
    // A changed definition is a new version; runs under way keep their own copy.
    const changed = JSON.stringify(cur.stages) !== JSON.stringify(w.stages) || cur.name !== w.name;
    w.ver = cur.ver + (changed ? 1 : 0);
    Object.assign(cur, w);
  } else S.workflows.push(w);
  wfEdit = null;
  save();
  renderKnowledge();
  toast('Workflow saved');
}
function wfEditClick(d, b) {
  if (d.wfnew) {
    wfEdit = { id: '', name: '', desc: '', stages: [], days: [], monthDay: 0, ver: 1, archived: false };
    renderKnowledge();
    window.scrollTo(0, 0);
    $('#wfname').focus();
    return;
  }
  if (d.wftpl !== undefined) {
    const t = WF_TEMPLATES[+d.wftpl];
    if (!t) return;
    wfEdit = { ...templateToWorkflow(t), id: '' };
    renderKnowledge();
    window.scrollTo(0, 0);
    return;
  }
  if (d.wfedit) {
    const w = wfById(d.wfedit);
    if (!w) return;
    wfEdit = JSON.parse(JSON.stringify(w));
    renderKnowledge();
    window.scrollTo(0, 0);
    return;
  }
  if (d.wfcancel) {
    wfEdit = null;
    return renderKnowledge();
  }
  if (d.wfdup) {
    const w = wfById(d.wfdup);
    if (!w) return;
    const c = cleanWorkflow({
      ...JSON.parse(JSON.stringify(w)),
      id: uid(),
      name: w.name + ' (copy)',
      ver: 1,
      archived: false,
      at: Date.now(),
    });
    c.stages.forEach(s => (s.id = uid()));
    S.workflows.push(c);
    wfEdit = null;
    save();
    renderKnowledge();
    return toast('Duplicated');
  }
  if (d.wfarchive) {
    const w = wfById(d.wfarchive);
    if (!w) return;
    w.archived = !w.archived;
    wfEdit = null;
    save();
    renderKnowledge();
    return toast(w.archived ? 'Archived' : 'Back in the list');
  }
  if (!wfEdit) return;
  if (b && b.id === 'wfstageadd') return openStageForm('');
  if (d.wfstage) return openStageForm(d.wfstage);
  if (d.wfup || d.wfdown) {
    const ss = wfEdit.stages,
      i = ss.findIndex(x => x.id === (d.wfup || d.wfdown)),
      j = d.wfup ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < ss.length) {
      [ss[i], ss[j]] = [ss[j], ss[i]];
      wfRenderStages();
    }
  }
  if (d.wfdel) {
    wfEdit.stages = wfEdit.stages.filter(x => x.id !== d.wfdel);
    wfRenderStages();
  }
  if (d.wfday !== undefined) {
    const wd = +d.wfday;
    wfEdit.days = wfEdit.days.includes(wd) ? wfEdit.days.filter(x => x !== wd) : [...wfEdit.days, wd];
    renderKnowledge();
  }
  if (d.wfpreset) {
    wfEdit.days = d.wfpreset === 'weekdays' ? [1, 2, 3, 4, 5] : [];
    if (d.wfpreset === 'off') wfEdit.monthDay = 0;
    renderKnowledge();
  }
}
// On a quest's page: a workflow linked to it (by the definition's q, or runs for it).
function questWorkflows(qid) {
  const ws = S.workflows.filter(w => !w.archived && w.q === qid),
    runs = S.wruns.filter(r => r.q === qid && !WRUN_OVER.includes(r.status));
  if (!ws.length && !runs.length) return '';
  return `<div class="list box reslist">${runs
    .map(
      r =>
        `<div class="row resrow"><button class="open" data-wfopen="${r.id}"><small>Workflow</small><span>${esc(r.name)}</span></button><span class="procline"><small>${WRUN_WORD[r.status]}${runStage(r) ? ' · ' + esc(runStage(r).title) : ''}</small><button class="btn sm blue" data-wfopen="${r.id}">Open</button></span></div>`,
    )
    .join('')}${ws
    .filter(w => !runs.some(r => r.wf === w.id))
    .map(
      w =>
        `<div class="row resrow"><button class="open" data-wfedit="${w.id}"><small>Workflow</small><span>${esc(w.name)}</span></button><span class="procline"><small>Not running</small><button class="btn sm blue" data-wfstart="${w.id}" data-q="${qid}">Start</button></span></div>`,
    )
    .join('')}</div>`;
}
