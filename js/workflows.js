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
  manual: 'Plain step',
  procedure: 'Follow a guide',
  flow: 'Run a desktop automation',
  verify: 'Check the result',
  wait: 'Wait for someone',
  decide: 'Decide what happens next',
};
const WF_TYPE_HINT = {
  manual: 'You do it, then mark it done.',
  procedure: 'Opens a guide to follow step by step; finishing the guide completes this step.',
  flow: 'Launches a desktop automation when you tap; with result tracking on, the step completes when it reports a result.',
  verify: 'A checklist to tick before the process moves on.',
  wait: 'Makes a waiting item (in the Inbox and the Waiting Centre); the reply completes the step.',
  decide: 'Choices to pick from; each can jump to a later step.',
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
  running: 'In progress',
  awaiting_user: 'Your turn',
  awaiting_automation: 'Waiting for the automation',
  waiting: 'Waiting on someone',
  paused: 'Paused',
  succeeded: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
// The word for a run's state as it stands now: a flow attempt with no word for a day, or a
// result folded in, is yours again, whatever was stored.
function runWord(r) {
  if (r.status === 'awaiting_automation') {
    const x = r.live.exec && S.execs.find(e => e.id === r.live.exec);
    if (!x || EXEC_TERMINAL.includes(x.status) || execStale(x)) return WRUN_WORD.awaiting_user;
  }
  if (r.status === 'waiting' && !stageWaitNode(r)) return WRUN_WORD.awaiting_user;
  return WRUN_WORD[r.status];
}
const WRUN_FINAL = ['succeeded', 'failed', 'cancelled'], // not under way
  WRUN_OVER = ['succeeded', 'cancelled']; // over for good (a failed run can still be retried)
const WF_STAGES_MAX = 30,
  WF_LOG_MAX = 40,
  WRUNS_KEEP = 120,
  WRUNS_DAYS = 180;
let wfView = null, // the process whose overview is shown (its id)
  wfFrom = null, // the page a run was opened from (Today, the Command Centre...): ‹ goes back there
  wfOpen = null, // the run being followed (its id), shown in the Knowledge view
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
    name: txt(w.name, 120) || 'Process',
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
    if (
      r.live.pending &&
      typeof r.live.pending === 'object' &&
      /^exec_(succeeded|failed|cancelled)$/.test(r.live.pending.k)
    )
      live.pending = { k: r.live.pending.k, msg: txt(r.live.pending.msg, 300) };
  }
  return {
    id: r.id,
    wf: r.wf,
    ver: Number.isInteger(+r.ver) && +r.ver > 0 ? +r.ver : 1,
    name: txt(r.name, 120) || 'Process',
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
  reconcileRuns();
}
// A flow stage whose attempt already has a result in the records (the report folded on another
// device, and the execution's row synced here first): the stage moves on from the record, as it
// would have from the report. The same records give the same run on every device.
function reconcileRuns() {
  S.wruns.forEach(r => {
    const s = runStage(r),
      x = s && s.type === 'flow' && r.live.exec && S.execs.find(e => e.id === r.live.exec);
    if (!x || !EXEC_TERMINAL.includes(x.status) || WRUN_FINAL.includes(r.status) || r.status === 'paused')
      return;
    if (r.status === 'ready') return;
    if (x.status === 'succeeded') {
      if (completeStage(r, s.id, { note: x.msg ? 'Automation: ' + x.msg : '', by: 'auto' }) === '')
        emitRun(r);
    } else {
      failStage(
        r,
        s.id,
        (x.status === 'cancelled' ? 'Automation cancelled' : 'Automation failed') +
          (x.msg ? ': ' + x.msg : ''),
      );
      emitRun(r);
    }
  });
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
// The process run a guide run was opened from (a guide followed as a step: its q is 'wr-' + the
// run's id), by id. Such a guide run is that process's work, not work of its own.
// Only while that run is under way on the step following it: a guide run left behind by a
// cancelled or finished run, or one it has moved past, is work of its own again.
function guideParent(pr) {
  const r = /^wr-/.test(pr.q || '') ? wrunById(pr.q.slice(3)) : null;
  return r && !WRUN_OVER.includes(r.status) && r.live.run === pr.id ? r : null;
}
const runStage = r => r.def.find(s => s.id === r.cur) || null;
const runLog = (r, k, m = '') => {
  r.log.push({ t: Date.now(), k, m: txt(m, 200) });
  if (r.log.length > WF_LOG_MAX) r.log = r.log.slice(-WF_LOG_MAX);
  r.at = Date.now();
};
/* the pure rules of movement. Each returns '' when done, or why not. */
// A step's guide or automation was removed: it can only be finished by hand or skipped.
const stageGone = s =>
  (s.type === 'procedure' && !procOf(s.kb)) || (s.type === 'flow' && !S.flows.some(f => f.id === s.flow));
// Skipping is a step's own setting (off unless chosen), or the way past a step whose resource is gone.
const canSkip = s => !!s && (!!s.skip || stageGone(s));
// What a run's state lets you do, as wfact names: the one primary action ('step': the current
// step's own actions lead) and the others. The page offers only these, so nothing it shows is
// refused by the rules above. (Tested against them state by state.)
function runActions(r) {
  const s = runStage(r);
  if (r.status === 'ready') return { primary: 'begin', more: ['cancel'] };
  if (r.status === 'paused') return { primary: 'resume', more: ['cancel', 'copy'] };
  if (r.status === 'failed')
    return {
      primary: s ? 'retry' : '',
      // (Add to the Inbox acknowledges too: once either is done, neither is offered again)
      more: [...(canSkip(s) ? ['skip'] : []), ...(r.ack ? [] : ['inbox', 'ack']), 'cancel', 'copy'],
    };
  if (WRUN_OVER.includes(r.status)) return { primary: '', more: ['copy'] };
  return { primary: 'step', more: ['pause', 'cancel', 'copy'] };
}
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
    const w = stageWaitNode(r);
    r.status = w ? 'waiting' : 'awaiting_user';
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
// Every check of a verification step ticked (one with none has nothing to tick).
const checksDone = (r, s) => (s.checks || []).every((c, i) => (r.live.checks || [])[i]);
// A guide step's guide, followed to its end.
const guideDone = r => {
  const pr = r.live.run && S.runs.find(x => x.id === r.live.run);
  return !!(pr && pr.fin);
};
// An automation step's result is yours to confirm when its automation is gone, result tracking
// is off, or there is an attempt to confirm (as the step's card offers it).
const flowConfirmable = (r, s) =>
  !S.flows.some(f => f.id === s.flow) ||
  !S.track ||
  !!(r.live.exec && S.execs.some(e => e.id === r.live.exec));
const validPick = (s, pick) => Number.isInteger(pick) && pick >= 0 && pick < (s.choices || []).length;
// How each kind of step may be done (`by`): by hand, a choice, the automation's own result or
// your confirmation of it, the guide finished, the reply received. Left out, it is the engine's
// own call; an automation step always says which.
const STAGE_BY = {
  manual: ['hand'],
  verify: ['hand'],
  decide: ['pick'],
  procedure: ['hand', 'guide'],
  flow: ['auto', 'confirm'],
  wait: ['reply'],
};
// The current stage is done (or skipped): kept with what it held, and the run moves on.
function completeStage(r, sid, { o = 'done', note = '', pick, by = '' } = {}) {
  if (WRUN_OVER.includes(r.status)) return 'the run is over';
  if (r.status === 'failed' && o !== 'skipped') return 'retry it first';
  if (r.status === 'paused') return 'the run is paused';
  if (r.status === 'ready') return 'the run has not started';
  const s = runStage(r);
  if (!s || s.id !== sid) return 'not the current step';
  if (o !== 'done' && o !== 'skipped') return 'not an outcome';
  if (o === 'skipped' && !canSkip(s)) return "this step can't be skipped";
  if (o === 'done') {
    if (by ? !STAGE_BY[s.type].includes(by) : s.type === 'flow') return "that isn't how this step is done";
    if (s.type === 'decide' && !validPick(s, pick)) return 'choose first';
    if (s.type !== 'decide' && pick !== undefined) return 'not a decision';
    if (s.type === 'verify' && !checksDone(r, s)) return 'tick each check first';
    if (s.type === 'procedure' && !guideDone(r)) return 'finish the guide first';
    if (s.type === 'flow' && by === 'auto' && !r.live.exec) return 'no attempt to report on';
    if (s.type === 'flow' && by === 'confirm' && !flowConfirmable(r, s)) return 'wait for its result';
    if (s.type === 'wait' && stageWaitNode(r)) return 'still waiting';
  }
  const out = { o, at: Date.now() };
  if (note) out.note = txt(note, 300);
  if (r.live.exec) out.exec = r.live.exec;
  if (r.live.run) out.run = r.live.run;
  if (r.live.wait) out.wait = r.live.wait;
  if (s.type === 'decide' && o === 'done') {
    out.pick = pick;
    if (!out.note) out.note = txt(s.choices[pick].label, 300);
  }
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
  if (r.status === 'ready') return 'the run has not started';
  const s = runStage(r);
  if (!s || s.id !== sid) return 'not the current step';
  r.status = 'failed';
  delete r.ack; // (a new failure is news, whatever was acknowledged before)
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
  if (!s || s.id !== sid) return 'not the current step';
  const tries = (r.live.tries || 0) + 1;
  delete r.st[sid];
  delete r.ack;
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
  const p = r.live.pending,
    s = runStage(r);
  if (p && s && s.type === 'flow') {
    // (the flow's result came while paused: applied now)
    delete r.live.pending;
    if (p.k === 'exec_succeeded')
      completeStage(r, s.id, { note: p.msg ? 'Automation: ' + p.msg : '', by: 'auto' });
    else
      failStage(
        r,
        s.id,
        (p.k === 'exec_cancelled' ? 'Automation cancelled' : 'Automation failed') +
          (p.msg ? ': ' + p.msg : ''),
      );
    emitRun(r);
  }
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
      if (r.status === 'paused') {
        r.live.pending = { k: ev.k, msg: ev.msg || '' }; // (applied on resume)
        return;
      }
      if (ev.k === 'exec_succeeded') {
        if (completeStage(r, s.id, { note: ev.msg ? 'Automation: ' + ev.msg : '', by: 'auto' }) === '')
          emitRun(r);
      } else if (!WRUN_FINAL.includes(r.status)) {
        failStage(
          r,
          s.id,
          (ev.k === 'exec_cancelled' ? 'Automation cancelled' : 'Automation failed') +
            (ev.msg ? ': ' + ev.msg : ''),
        );
        emitRun(r);
      }
    });
  }
  if (ev.k === 'proc_finished')
    S.wruns.forEach(r => {
      const s = runStage(r);
      if (
        s &&
        s.type === 'procedure' &&
        r.live.run === ev.run &&
        completeStage(r, s.id, { by: 'guide' }) === ''
      )
        emitRun(r);
    });
  if (ev.k === 'wait_resolved')
    S.wruns.forEach(r => {
      const s = runStage(r);
      if (s && s.type === 'wait' && ev.node === r.live.wait && completeStage(r, s.id, { by: 'reply' }) === '')
        emitRun(r);
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
      byRule: !!r.byRule,
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
      byRule: !!r.byRule,
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
    // An earlier day's run of it never started: it gives way (kept in the history as cancelled).
    S.wruns.forEach(r => {
      if (r.wf === w.id && r.status === 'ready' && /-\d{4}-\d\d-\d\d$/.test(r.id) && r.id < id)
        cancelRun(r, 'not started that day');
    });
    S.wruns.push(makeRun(w, { id, prepared: true }));
    emitEvent({ k: 'wf_due', key: 'wfdue:' + id, wf: w.id, wrun: id, name: w.name });
  });
}
/* actions from the page */
function startWorkflow(wfId, q = '') {
  const w = wfById(wfId);
  if (!w || !w.stages.length) return toast('That process has no steps yet', false, 3000);
  // A run already under way for it (same task): that one, not a second.
  const open = S.wruns
    .filter(r => r.wf === wfId && (r.q || '') === (q || w.q || '') && !WRUN_OVER.includes(r.status))
    .sort((a, b) => b.started - a.started)[0];
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
// Back from a run: to the page it was opened from, else the workflow list.
function closeWorkflowRun() {
  const from = wfFrom;
  wfOpen = wfFrom = null;
  if (from && from !== 'knowledge') go(from);
  else renderKnowledge();
  window.scrollTo(0, 0);
}
function openWorkflowRun(id) {
  if (!wrunById(id)) return toast('That run is gone', false, 3000);
  leaveEditor(() => {
    wfFrom = view === 'knowledge' ? null : view;
    if (wfOpen !== id) panels.wfmore = false; // (another run's Other options start folded)
    wfOpen = id;
    kbRun = null;
    kbArt = null;
    if (view !== 'knowledge') go('knowledge');
    else renderKnowledge();
    window.scrollTo(0, 0);
  });
}
// A stage's "Launch" for a flow (the tap on its button): the execution, when tracked, is the
// stage's own attempt; untracked, the launch is noted and the result is yours to confirm.
// Whether a Launch drawn for this run's step still fits it: the same step, an automation, the
// run neither finished nor paused.
function wfLaunchFits(wrunId, stageId) {
  const r = wrunById(wrunId),
    s = r && runStage(r);
  return (
    !!s && s.id === stageId && s.type === 'flow' && !WRUN_FINAL.includes(r.status) && r.status !== 'paused'
  );
}
function wfLaunched(wrunId, stageId, x) {
  const r = wrunById(wrunId),
    s = r && runStage(r);
  if (!wfLaunchFits(wrunId, stageId)) return;
  if (x) r.live.exec = x.id;
  else r.live.launched = Date.now();
  runLog(r, 'launched', x ? '' : 'untracked');
  settleRun(r);
}
// The node a waiting stage is waiting through: the Inbox item it made, or (taken to Today) the
// waiting step its details moved to (see rekeyFollows). Null once it isn't waiting any more.
function stageWaitNode(r) {
  if (!r.live.wait) return null;
  const w = findWaitable(r.live.wait);
  return w && w.n && w.n.wait ? w.n : null;
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
  if (d.wfback) return closeWorkflowRun();
  const r = d.wrun && wrunById(d.wrun);
  if (d.wrun && !r) return toast('That run is gone', false, 3000);
  if (!r) return wfEditClick(d, b);
  if (!d.wfact) return;
  if (STAGE_ACTS[d.wfact]) return wfStageClick(r, d);
  const was = r.status;
  let why = '';
  // Only what the run's state allows (a tap on a page drawn before a sync changed the run).
  if (!runAllows(r, d.wfact)) return notNow(r);
  if (d.wfact === 'begin') why = beginRun(r);
  else if (d.wfact === 'pause') why = pauseRun(r);
  else if (d.wfact === 'resume') why = resumeRun(r);
  else if (d.wfact === 'cancel')
    return sheet(
      {
        title: 'Cancel this run?',
        text: 'Its steps so far are kept in the history.',
        ok: 'Cancel the run',
        cancel: 'Keep going',
        danger: true,
      },
      () => {
        const rr = wrunById(r.id); // (the run as it is now: a sync pull may have replaced it)
        if (!rr) return toast('That run is gone', false, 3000);
        if (!runAllows(rr, 'cancel')) return notNow(rr);
        const why2 = cancelRun(rr, 'cancelled by you');
        if (why2) toast("Couldn't cancel: " + why2, false, 3000);
        else emitRun(rr);
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
    const text = ('Process failed: ' + r.name).slice(0, 200);
    S.inbox.unshift({ id: uid(), text, node: fix({ id: uid(), text, notes: runSummary(r) }) });
    r.ack = 1;
    save();
    renderAll();
    return toast('Added to inbox');
  } else if (d.wfact === 'copy') return copyText(runSummary(r));
  wfAfter(r, was, why);
}
// After an action: what went wrong said, an ending told to the rules, the page redrawn.
function wfAfter(r, was, why) {
  if (why) toast("Couldn't: " + why, false, 3000);
  if ((r.status === 'succeeded' || r.status === 'failed') && r.status !== was) emitRun(r);
  save();
  renderKnowledge();
  if (r.status === 'succeeded') toast('Process completed');
}
// The current step's own actions (each drawn with the step's id, data-wstage), and the kinds of
// step each belongs to. The rest act on the run as a whole.
const STAGE_ACTS = {
  done: ['manual', 'verify', 'procedure'],
  pick: ['decide'],
  check: ['verify'],
  fail: ['manual', 'verify'],
  skip: WF_TYPES,
  retry: WF_TYPES,
  confirmflow: ['flow'],
  procedure: ['procedure'],
  waititem: ['wait'],
  received: ['wait'],
};
const MOVED = 'moved';
// Whether a step's action still applies to the run as it is now: the step it was drawn for is
// still the current one, it is that kind of step's action, the run's state allows it, and what
// the step needs first is there. '' when it does; MOVED, 'status' or why not.
function stageActWhy(r, act, sid, d = {}) {
  const s = runStage(r);
  if (!s || !sid || s.id !== sid || !(STAGE_ACTS[act] || []).includes(s.type)) return MOVED;
  if (!runAllows(r, act, sid)) return 'status';
  if (act === 'done' && s.type === 'verify' && !checksDone(r, s)) return 'tick each check first';
  if (act === 'done' && s.type === 'procedure' && !guideDone(r)) return MOVED;
  if (act === 'pick' && !validPick(s, +d.pick)) return MOVED;
  if (act === 'check' && !(Number.isInteger(+d.i) && +d.i >= 0 && +d.i < (s.checks || []).length))
    return MOVED;
  if (act === 'confirmflow' && !flowConfirmable(r, s)) return MOVED;
  if (act === 'waititem' && r.live.wait) return MOVED;
  if (act === 'received' && !r.live.wait) return MOVED;
  return '';
}
// The run, if the step's action still applies to it (checked on the tap, and again when a sheet
// asked about it is answered: the run may have moved on meanwhile); else said so, and redrawn.
function stageRunNow(id, act, sid, d) {
  const r = wrunById(id);
  if (!r) {
    toast('That run is gone', false, 3000);
    renderKnowledge();
    return null;
  }
  const why = stageActWhy(r, act, sid, d);
  if (!why) return r;
  if (why === MOVED) movedOn();
  else if (why === 'status') notNow(r);
  else {
    toast("Couldn't: " + why, false, 3000);
    renderKnowledge();
  }
  return null;
}
function movedOn() {
  toast('That step has moved on', false, 3000);
  renderKnowledge();
}
function wfStageClick(r0, d) {
  const act = d.wfact,
    sid = d.wstage || '',
    r = stageRunNow(r0.id, act, sid, d);
  if (!r) return;
  const s = runStage(r),
    was = r.status;
  let why = '';
  if (act === 'done') why = completeStage(r, sid, { by: 'hand' });
  else if (act === 'pick') why = completeStage(r, sid, { pick: +d.pick, by: 'pick' });
  else if (act === 'skip')
    return sheet(
      { title: 'Skip this step?', label: 'Why', ok: 'Skip', placeholder: 'Done by hand already' },
      v => {
        const rr = stageRunNow(r.id, act, sid, d); // (the run as it is now: a pull may have replaced it)
        if (!rr) return;
        const why2 = completeStage(rr, sid, { o: 'skipped', note: v || 'skipped' });
        if (why2) toast("Couldn't skip: " + why2, false, 3000);
        save();
        renderKnowledge();
      },
    );
  else if (act === 'fail')
    return sheet({ title: 'What went wrong?', label: 'Error', ok: 'Mark failed', danger: true }, v => {
      const rr = stageRunNow(r.id, act, sid, d);
      if (!rr) return;
      const why2 = failStage(rr, sid, v || 'Failed');
      if (why2) toast(why2, false, 3000);
      else emitRun(rr);
      save();
      renderKnowledge();
    });
  else if (act === 'retry') {
    if (s.type === 'flow' && r.st[sid] && r.st[sid].exec)
      return sheet(
        {
          title: 'Launch the automation again?',
          text: 'The last attempt may already have done its work. Only retry if you have checked that it is safe to run again.',
          ok: 'Retry',
          danger: true,
        },
        () => {
          // (another device may have launched it again meanwhile: a retry now would drop that
          // attempt, and its result with it)
          const rr = stageRunNow(r.id, act, sid, d);
          if (!rr) return;
          const why2 = retryStage(rr, sid);
          if (why2) toast("Couldn't: " + why2, false, 3000);
          save();
          renderKnowledge();
        },
      );
    why = retryStage(r, sid);
  } else if (act === 'check') {
    const i = +d.i;
    r.live.checks = r.live.checks || [];
    r.live.checks[i] = !r.live.checks[i];
    save();
    return renderKnowledge();
  } else if (act === 'confirmflow') {
    // Tracking off, or no word after a day: the result, confirmed by you (and said so).
    if (d.ok === 'yes') why = completeStage(r, sid, { note: 'Result confirmed by hand', by: 'confirm' });
    else why = failStage(r, sid, 'Failed (confirmed by hand)');
  } else if (act === 'procedure') {
    if (!procOf(s.kb)) return toast('That guide is gone', false, 3000);
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
  } else if (act === 'waititem') {
    stageWaitItem(r, s);
    settleRun(r);
    runLog(r, 'waiting', s.who || '');
    save();
    return renderKnowledge();
  } else if (act === 'received') {
    // The reply came (the item's been cleared elsewhere, or you say so): the stage is done.
    const wn = stageWaitNode(r);
    if (wn)
      setWaiting(wn.id, null); // (emits wait_resolved: the run moves on there)
    else why = completeStage(r, sid, { note: 'received', by: 'reply' });
  }
  wfAfter(r, was, why);
}
// (actions the run's state decides on its own; the rest, and retry too, belong to its current step)
const RUN_ACTS = ['begin', 'resume', 'retry', 'pause', 'cancel', 'ack', 'inbox', 'copy'];
// Whether the run as it is now allows `act` (and, given `sid`, still on that step): checked on the
// tap, and again when a sheet asked about it is confirmed (another device may have moved it on).
function runAllows(r, act, sid) {
  const can = runActions(r),
    s = runStage(r);
  if (sid !== undefined && (!s || s.id !== sid)) return false;
  if (RUN_ACTS.includes(act)) return act === can.primary || can.more.includes(act);
  if (act === 'skip') return can.more.includes('skip') || (can.primary === 'step' && canSkip(s));
  return can.primary === 'step';
}
function notNow(r) {
  toast(`Not now: the process is ${runWord(r).toLowerCase()}`, false, 3000);
  renderKnowledge();
}
let kbRunBackWf = null; // a procedure opened from a workflow run: its ‹ goes back to the run
function runSummary(r) {
  return [
    `Process: ${r.name} (${r.wf} v${r.ver})`,
    `Run: ${r.id}${r.q ? ' · task ' + r.q : ''}`,
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
  let h = `<button class="linkbtn" data-wfback="1">‹ ${wfFrom === 'today' ? 'Today' : wfFrom === 'ops' ? 'Command Centre' : wfFrom ? 'Back' : wfView && wfById(wfView) ? esc(wfById(wfView).name) : 'Processes'}</button>${q ? `<p class="hint kbtrail">For: <button class="linkbtn" data-open="${q.n.id}">${esc(q.n.text)}</button></p>` : ''}
    <h2 class="kbtitle">${esc(r.name)}</h2><div class="prog"><div style="width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%"></div></div>
    <p class="hint runprog"><span class="wst w-${r.status}">${runWord(r)}</span>${s ? ` · step ${i + 1} of ${p.total}` : ''}${!navigator.onLine && r.status === 'awaiting_automation' ? ' · offline: as last synced' : ''}</p>`;
  const can = runActions(r),
    b = (act, label, cls = '') =>
      `<button class="btn ${cls}" data-wrun="${r.id}" data-wfact="${act}">${label}</button>`;
  if (r.status === 'ready')
    h += `<div class="pstep box"><h3>Ready to start</h3>${r.def.length ? `<p class="ptext">First: ${esc(r.def[0].title)}</p>` : ''}<div class="acts">${b('begin', 'Start', 'green')}${b('cancel', 'Cancel')}</div></div>`;
  else if (r.status === 'paused')
    h += `<div class="pstep box"><h3>Paused</h3>${s ? `<p class="ptext">At: ${esc(s.title)}</p>` : ''}<div class="acts">${b('resume', 'Resume', 'green')}${b('cancel', 'Cancel the run')}</div></div>`;
  else if (final)
    h += `<div class="pstep box done"><h3>${WRUN_WORD[r.status]}${r.fin ? ' · ' + esc(whenLabel(r.fin)) : ''}</h3>${r.err ? `<p class="hint">${esc(r.err)}</p>` : ''}<div class="acts">${b('copy', 'Copy summary')}${q ? `<button class="btn blue" data-open="${q.n.id}">Back to the task</button>` : ''}</div></div>`;
  else if (s) h += stageCard(r, s, i);
  else if (r.status === 'failed')
    // (failed with no step to try again: only its record, and the way out)
    h += `<div class="pstep box failed"><div class="werr"><p><b>Failed.</b> ${esc(r.err || 'Failed')}</p></div><div class="acts">${can.more
      .map(a =>
        b(
          a,
          {
            inbox: 'Add to the Inbox for later',
            ack: 'Acknowledge (stays failed)',
            cancel: 'Cancel the run',
            copy: 'Copy summary',
          }[a] || a,
        ),
      )
      .join('')}</div></div>`;
  // Every stage, with its outcome.
  h += `<ol class="plist runlist wlist">${r.def
    .map((st, j) => {
      const o = r.st[st.id];
      return `<li class="${o ? o.o : st === s ? 'cur' : ''}"><span class="pjump">${st.type !== 'manual' ? `<small>${WF_TYPE_NAME[st.type]}</small>` : ''}${o ? (o.o === 'done' ? '✓ ' : o.o === 'skipped' ? '↷ ' : '✗ ') : st === s ? '▶ ' : ''}${esc(st.title)}${o && o.note ? ` <small>· ${esc(o.note)}</small>` : ''}</span></li>`;
    })
    .join('')}</ol>`;
  // The run's own secondary actions (a failed run keeps them under its Other options instead).
  const foot = {
    pause: 'Pause',
    cancel: 'Cancel the run',
    copy: 'Copy summary',
  };
  if (can.primary === 'step' || r.status === 'paused')
    h += `<div class="links runfoot">${can.more
      .filter(a => foot[a] && !(r.status === 'paused' && a === 'cancel'))
      .map(a => `<button class="linkbtn" data-wrun="${r.id}" data-wfact="${a}">${foot[a]}</button>`)
      .join('')}</div>`;
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
  // (a step's own actions name the step they were drawn for: a tap after the run moved on is refused)
  const id = r.id,
    ws = `data-wstage="${s.id}"`,
    b = (act, label, cls = '', extra = '') =>
      `<button class="btn ${cls}" data-wrun="${id}" data-wfact="${act}"${STAGE_ACTS[act] ? ' ' + ws : ''} ${extra}>${label}</button>`;
  let body = s.text ? `<p class="ptext">${kbLinkify(s.text)}</p>` : '',
    acts = '';
  const failed = r.status === 'failed',
    skip = canSkip(s) ? b('skip', 'Skip') : '';
  let next = '';
  if (failed) {
    // What went wrong first, then the one way forward; the rest under Other options.
    const o = r.st[s.id],
      x = o && o.exec && S.execs.find(e => e.id === o.exec);
    body =
      `<div class="werr"><p><b>This step failed.</b> ${esc(r.err || 'Failed')}</p>${x ? `<p class="hint xline">Last attempt: ${execLine(x)}</p>` : ''}</div>` +
      (s.type === 'flow' && o && o.exec
        ? '<p class="hint wwarn"><b>Check before trying again:</b> the last attempt may already have done some of its work. Trying again launches the automation afresh; the earlier attempt stays in the history.</p>'
        : '') +
      body;
    next = r.ack
      ? 'Acknowledged: it stays failed until it is tried again, skipped or cancelled.'
      : 'Fix the cause, then try the step again.';
    const more = runActions(r).more,
      label = {
        skip: 'Skip this step',
        inbox: 'Add to the Inbox for later',
        ack: 'Acknowledge (stays failed)',
        cancel: 'Cancel the run',
        copy: 'Copy details',
      };
    acts = b('retry', 'Try again', 'green');
    const opts = more.map(a => b(a, label[a])).join('');
    return `<div class="pstep box failed"><p class="pnum">${i + 1}</p><h3>${esc(s.title)}</h3>${s.type !== 'manual' ? `<p class="hint ptype">${WF_TYPE_NAME[s.type]}</p>` : ''}${body}<p class="hint pnext">${next}</p><div class="acts wacts">${acts}</div><details class="moreopts" id="wfmore"${panels.wfmore ? ' open' : ''}><summary>Other options</summary><div class="acts wacts">${opts}</div><p class="hint">Acknowledging only stops the failure being flagged on Today and in the Command Centre; it doesn't fix it.</p></details></div>`;
  } else if (s.type === 'manual') {
    next = 'Marking it done moves the process to the next step.';
    acts = `${b('done', 'Mark done', 'green')}${skip}${b('fail', 'Report a problem')}`;
  } else if (s.type === 'verify') {
    const ticks = r.live.checks || [];
    body += `<div class="wchecks">${(s.checks || [])
      .map(
        (c, j) =>
          `<label class="optbox"><input type="checkbox" data-wrun="${id}" data-wfact="check" ${ws} data-i="${j}"${ticks[j] ? ' checked' : ''}>${esc(c)}</label>`,
      )
      .join('')}</div>`;
    const all = s.checks.every((c, j) => ticks[j]);
    next = all
      ? 'Every check is ticked: Verified moves the process on.'
      : 'Tick every check, then Verified moves the process on.';
    acts = `${b('done', 'Verified', 'green', all ? '' : 'disabled')}${skip}${b('fail', 'Check failed')}`;
  } else if (s.type === 'decide') {
    // (only say a choice changes the way on when one of them does)
    next = (s.choices || []).some(c => c.next && r.def.some(x => x.id === c.next))
      ? 'Your choice decides which step comes next.'
      : 'Your choice is recorded in the history, then the process moves on to the next step.';
    acts =
      (s.choices || [])
        .map(
          (c, j) =>
            `<button class="btn blue" data-wrun="${id}" data-wfact="pick" ${ws} data-pick="${j}">${esc(c.label)}</button>`,
        )
        .join('') + skip;
  } else if (s.type === 'procedure') {
    const a = procOf(s.kb),
      pr = r.live.run && S.runs.find(x => x.id === r.live.run);
    body += a
      ? `<p class="hint">Guide: ${esc(a.title)}${pr ? ' · ' + esc(runLine(pr)) : ''}</p>`
      : '<p class="hint"><span class="tag gone">Guide removed</span> Finish this step by hand, or skip it.</p>';
    next = a ? 'Finishing the guide completes this step.' : '';
    acts = `${a ? b('procedure', pr ? 'Continue the guide' : 'Follow the guide', 'blue') : ''}${pr && pr.fin ? b('done', 'Mark done', 'green') : ''}${skip}`;
  } else if (s.type === 'flow') {
    const f = S.flows.find(x => x.id === s.flow),
      x = r.live.exec && S.execs.find(e => e.id === r.live.exec);
    if (!f) {
      body +=
        '<p class="hint"><span class="tag gone">Automation removed</span> Confirm the result by hand, or skip.</p>';
      acts = `${b('confirmflow', 'It succeeded', 'green', 'data-ok="yes"')}${b('confirmflow', 'It failed', '', 'data-ok="no"')}${skip}`;
    } else if (x && !EXEC_TERMINAL.includes(x.status) && !execStale(x)) {
      body += `<p class="hint xline">${execLine(x)}</p><p class="hint">This step completes on its own when the automation reports its result.</p>`;
      acts = `${b('confirmflow', 'It succeeded (checked by hand)', '', 'data-ok="yes"')}${b('confirmflow', 'It failed', '', 'data-ok="no"')}`;
    } else {
      if (x) body += `<p class="hint xline">${execLine(x)}</p>`;
      body += S.track
        ? '<p class="hint">Launch the automation; this step completes when its result is reported.</p>'
        : '<p class="hint">Result tracking is off (<button class="linkbtn" data-gosec="execsec">Settings: Automations</button>): launch the automation, then confirm its result yourself.</p>';
      acts = `<a class="btn blue" href="${esc(f.url)}" data-flow="${f.id}" data-wrun="${id}" data-wstage="${s.id}"${r.q ? ` data-q="${r.q}"` : ''}>&#9654; Launch ${esc(f.name)}</a>${
        x || !S.track
          ? `${b('confirmflow', 'It succeeded (checked by hand)', '', 'data-ok="yes"')}${b('confirmflow', 'It failed', '', 'data-ok="no"')}`
          : ''
      }${skip}`;
    }
  } else if (s.type === 'wait') {
    const wn = stageWaitNode(r);
    if (wn)
      body += `<p class="hint">Waiting on ${esc(wn.wait.who || 'someone')} · <button class="linkbtn" data-goto="waiting">Waiting Centre</button></p>`;
    else if (r.live.wait) body += '<p class="hint">The waiting item was cleared.</p>';
    next = wn
      ? 'Marking the reply received (here or in Waiting) completes this step.'
      : r.live.wait
        ? ''
        : 'Start waiting makes a waiting item to chase; the reply completes this step.';
    acts = `${wn ? b('received', 'Mark reply received', 'green') : r.live.wait ? b('received', 'Mark reply received', 'green') : b('waititem', 'Start waiting' + (s.who ? ' on ' + esc(s.who) : ''), 'blue')}${skip}`;
  }
  return `<div class="pstep box"><p class="pnum">${i + 1}</p><h3>${esc(s.title)}</h3>${s.type !== 'manual' ? `<p class="hint ptype">${WF_TYPE_NAME[s.type]}</p>` : ''}${body}${next ? `<p class="hint pnext">${next}</p>` : ''}<div class="acts wacts">${acts}</div></div>`;
}
/* definitions: the list under Knowledge, and the editor (a stage list) */
const WF_TEMPLATES = [
  {
    name: 'Simple checklist',
    desc: 'Plain steps, done one after another.',
    stages: [
      ['manual', 'Read the instructions', '', [], '', [], true],
      ['manual', 'Do the work', ''],
      ['manual', 'Tidy up and file it', ''],
    ],
  },
  {
    name: 'Weekly report',
    desc: 'Prepare, run the report automation, check the output, send.',
    stages: [
      ['manual', 'Prepare', 'Check the period and the source data.'],
      ['flow', 'Run the report automation', ''],
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
    name: 'Approval process',
    // (the decision is recorded, not branched on: both answers go on to the same follow-up step,
    // and the template says so rather than suggesting two paths)
    desc: 'Prepare the request, wait for the answer, record the decision and follow it up.',
    stages: [
      ['manual', 'Prepare the request', ''],
      ['wait', 'Waiting for the answer', '', [], 'Approver'],
      [
        'decide',
        'Record the decision',
        'Your answer is kept in the run’s history.',
        [],
        '',
        [
          ['Approved', ''],
          ['Rejected', ''],
        ],
      ],
      [
        'manual',
        'Follow up on the decision',
        'Approved: act on it. Rejected: rework the request, then run this process again.',
      ],
    ],
  },
  {
    name: 'Automation with a check',
    desc: 'Launch a desktop automation, check what it produced, finish by hand.',
    stages: [
      ['flow', 'Run the automation', ''],
      ['verify', 'Check what it produced', '', ['Output present and complete', 'Nothing left behind']],
      ['manual', 'Finish and file', ''],
    ],
  },
  {
    name: 'Month-end process',
    desc: 'Prepare, reconcile, review, get approval, close.',
    stages: [
      ['manual', 'Prepare', 'Gather statements and the month’s figures.'],
      ['manual', 'Reconcile', ''],
      ['verify', 'Review', '', ['Totals agree', 'Exceptions noted']],
      ['wait', 'Approval', '', [], 'Approver'],
      ['manual', 'Close the month', ''],
    ],
  },
];
// The picker: a few worked examples, each previewed before it's used; or a blank one.
function openTemplatePicker() {
  popSheet(
    `<h2 id="sheettitle">New process</h2><p class="hint qahint">Start from an example (you can change every step), or from scratch.</p><div class="qalist newlist">${WF_TEMPLATES.map(
      (t, i) =>
        `<button class="qact" data-wftplpick="${i}" data-stay="1"><b>${esc(t.name)}</b><small>${esc(t.desc)} · ${plural(t.stages.length, 'step')}</small></button>`,
    ).join(
      '',
    )}<button class="qact" data-wfnew="1"><b>From scratch</b><small>A name, then steps as you type them.</small></button></div><div class="acts"><button class="btn" type="button" data-sheetclose="1">Cancel</button></div>`,
    { labelledBy: 'sheettitle' },
  );
}
function openTemplatePreview(i) {
  const t = WF_TEMPLATES[i];
  if (!t) return;
  popSheet(
    `<h2 id="sheettitle">${esc(t.name)}</h2><p class="hint qahint">${esc(t.desc)}</p><ol class="plist wprev tplprev">${t.stages
      .map(
        ([type, title]) =>
          `<li><span class="pjump">${type !== 'manual' ? `<small>${WF_TYPE_NAME[type]}</small>` : ''}${esc(title)}</span></li>`,
      )
      .join(
        '',
      )}</ol><p class="hint">${t.stages.some(([k]) => k === 'flow') ? 'You choose which desktop automation the automation step launches. ' : ''}Every step can be renamed, moved, removed or made smarter after.</p><div class="acts"><button class="btn green" data-wftpl="${i}">Use this example</button><button class="btn" type="button" data-wftplback="1" data-stay="1">Back</button></div>`,
    { labelledBy: 'sheettitle' },
  );
}
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
  // (steps are required unless the example says otherwise: only a step it's sensible to pass over)
  w.stages = t.stages.map(([type, title, text, checks, who, choices, skip]) => {
    const s = { id: uid(), type, title, text: text || '' };
    if (type === 'verify') s.checks = checks || [];
    if (type === 'wait') s.who = who || '';
    if (type === 'decide') s.choices = (choices || []).map(([label, next]) => ({ label, next: next || '' }));
    if (skip) s.skip = true;
    return s;
  });
  return w;
}
const wfRuns = id => S.wruns.filter(r => r.wf === id).sort((a, b) => b.started - a.started);
// (a failed run first: it needs you; else the newest under way)
const wfOpenRun = id =>
  S.wruns
    .filter(r => r.wf === id && !WRUN_OVER.includes(r.status))
    .sort((a, b) => (a.status === 'failed') - (b.status === 'failed') || a.started - b.started)
    .reverse()[0] || null;
/* a process's overview: what it's for, where it stands, and the one thing to do with it (start,
   continue or fix). Editing is a step further: the definition is for changing now and then, the
   overview for using. */
function wfOverview(w) {
  const o = wfOpenRun(w.id),
    runs = wfRuns(w.id),
    past = runs.filter(r => WRUN_OVER.includes(r.status) || (r.status === 'failed' && r !== o)).slice(0, 5),
    kind = s => (s.type === 'manual' ? '' : WF_TYPE_NAME[s.type]);
  let h = `<button class="linkbtn" data-wfback2="1">‹ Processes</button><h2 class="kbtitle">${esc(w.name)}</h2>${w.desc ? `<p class="kbdesc">${esc(w.desc)}</p>` : ''}
    <p class="hint">${plural(w.stages.length, 'step')}${w.days.length || w.monthDay ? ' · repeats ' + esc(repLabel({ days: w.days, monthDay: w.monthDay })) + ' (a run is made ready that day, never started on its own)' : ''}${w.ver > 1 ? ' · version ' + w.ver : ''}</p>`;
  // Where it stands, and the one action.
  if (o) {
    const s = runStage(o);
    h += `<div class="box wfstate w-${o.status}"><p><b>${runWord(o)}</b>${s ? ` · step ${o.def.indexOf(s) + 1} of ${o.def.length}: ${esc(s.title)}` : ''}</p>${o.err ? `<p class="hint">${esc(o.err)}</p>` : ''}<div class="acts"><button class="btn ${o.status === 'failed' ? 'pink' : 'green'}" data-wfopen="${o.id}">${o.status === 'failed' ? 'Fix the failed step' : o.status === 'ready' ? 'Start' : 'Continue'}</button></div></div>`;
  } else
    h += `<div class="box wfstate"><p><b>Not started</b>${past.length ? ` · last run ${WRUN_WORD[past[0].status].toLowerCase()} ${esc(dayLabel(fmt(new Date(past[0].fin || past[0].at))))}` : ''}</p><div class="acts">${w.archived ? `<button class="btn" data-wfarchive="${w.id}">Unarchive to run it</button>` : `<button class="btn green" data-wfstart="${w.id}">Start</button>`}</div></div>`;
  h += `<h3 class="kbsub">Steps</h3>${
    w.stages.length
      ? `<ol class="plist wlist wprev">${w.stages.map(s => `<li><span class="pjump">${kind(s) ? `<small>${kind(s)}</small>` : ''}${esc(s.title)}</span></li>`).join('')}</ol>`
      : '<p class="hint">No steps yet: edit the process to add some.</p>'
  }`;
  if (past.length)
    h += `<h3 class="kbsub">Past runs</h3><div class="list box">${past
      .map(
        r =>
          `<div class="row"><button class="open" data-wfopen="${r.id}"><span>${esc(dayLabel(fmt(new Date(r.fin || r.at))))}</span><small><span class="wst w-${r.status}">${WRUN_WORD[r.status]}</span>${r.err ? ' · ' + esc(r.err) : ''}</small></button></div>`,
      )
      .join('')}</div>`;
  h += `<div class="links wfacts"><button class="linkbtn" data-wfedit="${w.id}">Edit the steps</button><button class="linkbtn" data-wfdup="${w.id}">Duplicate</button><button class="dellink" data-wfarchive="${w.id}">${w.archived ? 'Unarchive' : 'Archive'}</button></div>`;
  return h;
}
function wfEditor() {
  const w = wfEdit,
    st = (k, l, p) =>
      `<button class="chip" type="button" data-wfpreset="${k}" aria-pressed="${p}">${l}</button>`;
  let h = `<h2>${w.id ? 'Edit process' : 'New process'}</h2>${w.id ? '' : hintBox('proc', 'Write the steps as a checklist, one line each. Tap a step later to make it smarter: an automation to launch, a guide to follow, a check, a wait for someone or a decision.')}<form id="wfform">
    <label class="f" for="wfname">Name</label><input class="fld" id="wfname" maxlength="120" value="${esc(w.name || '')}" autocomplete="off" required>
    <label class="f" for="wfdesc">What it is for <small class="hint">(optional)</small></label><textarea class="fld" id="wfdesc" rows="2" maxlength="600">${esc(w.desc || '')}</textarea>
    <div class="sechead kbimghead"><h3>Steps</h3>${w.stages.length ? `<button class="btn sm" type="button" id="wfstageadd">Add with options</button>` : ''}</div><div id="wfstages">${wfStagesList()}</div>
    <div class="addrow wfaddrow"><input class="fld" id="wfstepin" maxlength="120" value="${esc(w.typing || '')}" placeholder="${w.stages.length ? 'Add another step' : 'Type the first step, e.g. Download the report'}" aria-label="New step" autocomplete="off"><button class="btn" type="button" id="wfstepgo" aria-label="Add step">Add</button></div>
    <p class="hint">Each step is a plain one until you make it smarter: tap a step to attach an automation, a guide, a check, a wait or a decision.</p>
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
  if (!ss.length) return '';
  return `<ol class="plist editlist">${ss
    .map(
      (s, i) =>
        `<li><button class="pjump" type="button" data-wfstage="${s.id}" aria-label="Step: ${esc(s.title)}${s.skip ? ' (can be skipped)' : ''}. Change what happens at this step">${esc(s.title)}${s.type !== 'manual' || s.skip ? ` <small>${[s.type !== 'manual' ? WF_TYPE_NAME[s.type] : '', s.skip ? 'can be skipped' : ''].filter(Boolean).join(' · ')}</small>` : ''}</button><span class="pmv"><button class="mv" type="button" data-wfup="${s.id}" aria-label="Move up"${i === 0 ? ' disabled' : ''}>&#9650;</button><button class="mv" type="button" data-wfdown="${s.id}" aria-label="Move down"${i === ss.length - 1 ? ' disabled' : ''}>&#9660;</button><button class="x" type="button" data-wfdel="${s.id}" aria-label="Remove step: ${esc(s.title)}">×</button></span></li>`,
    )
    .join('')}</ol>`;
}
// A plain step, typed in the row under the list (Enter or Add).
function addTypedStep() {
  const i = $('#wfstepin');
  if (!wfEdit || !i) return;
  const title = txt(i.value, 120);
  if (!title) return i.focus();
  if (wfEdit.stages.length >= WF_STAGES_MAX) return toast(`At most ${WF_STAGES_MAX} steps`, false, 3000);
  // (a new step is required: skipping is a choice made on the step, never the default)
  wfEdit.stages.push({ id: uid(), type: 'manual', title, text: '' });
  i.value = '';
  wfRenderStages();
  if (wfEdit.stages.length === 1) {
    readWfForm();
    renderKnowledge(); // (the first step: the row's placeholder and the options button change)
    const n = $('#wfstepin');
    if (n) n.focus();
  } else i.focus();
}
// Has the editor anything worth asking about before it's left?
function wfEditDirty() {
  if (!wfEdit) return false;
  readWfForm();
  if (wfEdit.typing) return true;
  if (!wfEdit.id) return !!(wfEdit.name || wfEdit.desc || wfEdit.stages.length);
  const cur = wfById(wfEdit.id);
  if (!cur) return true;
  const now = cleanWorkflow({ ...wfEdit, id: wfEdit.id, at: cur.at, ver: cur.ver });
  return JSON.stringify(now) !== JSON.stringify(cur);
}
// What's typed in the editor, into the draft (so a redraw shows it).
function readWfForm() {
  if (!wfEdit || !$('#wfform')) return;
  wfEdit.name = $('#wfname').value;
  wfEdit.desc = $('#wfdesc').value;
  wfEdit.monthDay = +$('#wfmonth').value || 0;
  wfEdit.typing = $('#wfstepin') ? $('#wfstepin').value : '';
}
// (`focusId`: the step to leave the keyboard on, else the typed-step row, so a redraw of the list
// doesn't drop focus to the page)
function wfRenderStages(focusId) {
  const el = $('#wfstages');
  if (!el || !wfEdit) return;
  el.innerHTML = wfStagesList();
  const f = (focusId && el.querySelector(`[data-wfstage="${focusId}"]`)) || $('#wfstepin');
  if (f && (!document.activeElement || document.activeElement === document.body))
    f.focus({ preventScroll: true });
}
function openStageForm(id) {
  if (!wfEdit) return;
  const s = wfEdit.stages.find(x => x.id === id) || {
      id: '',
      type: 'manual',
      title: '',
      text: '',
    },
    opt = (list, cur, none) =>
      `<option value=""${cur ? '' : ' selected'}>${none}</option>` +
      list.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join(''),
    others = wfEdit.stages.filter(x => x.id !== s.id).map(x => [x.id, x.title]);
  popSheet(
    `<form id="wfstageform" data-id="${s.id}"><h2 id="sheettitle">${s.id ? 'This step' : 'New step'}</h2>
    <label class="f" for="wstitle">Step</label><input class="fld" id="wstitle" maxlength="120" value="${esc(s.title)}" autocomplete="off" required>
    <label class="f" for="wstext">Instructions <small class="hint">(optional)</small></label><textarea class="fld" id="wstext" rows="2" maxlength="1000">${esc(s.text || '')}</textarea>
    <label class="f" for="wstype">What happens at this step</label><select class="fld" id="wstype">${WF_TYPES.map(t => `<option value="${t}"${t === s.type ? ' selected' : ''}>${WF_TYPE_NAME[t]}</option>`).join('')}</select><p class="hint" id="wskindhint">${WF_TYPE_HINT[s.type]}</p>
    <div data-for="procedure"><label class="f" for="wskb">Guide</label><select class="fld" id="wskb">${opt(
      S.kb.filter(a => a.steps && a.steps.length).map(a => [a.id, a.title]),
      s.kb,
      'Choose',
    )}</select></div>
    <div data-for="flow"><label class="f" for="wsflow">Desktop automation</label><select class="fld" id="wsflow">${opt(
      S.flows.map(f => [f.id, f.name]),
      s.flow,
      'Choose',
    )}</select></div>
    <div data-for="verify"><label class="f" for="wschecks">Checks, one per line</label><textarea class="fld" id="wschecks" rows="3" maxlength="2000">${esc((s.checks || []).join('\n'))}</textarea></div>
    <div data-for="wait"><label class="f" for="wswho">Waiting on whom</label><input class="fld" id="wswho" maxlength="60" value="${esc(s.who || '')}" list="wholist" autocomplete="off">${whoList()}</div>
    <div data-for="decide"><label class="f" for="wschoices">Choices, one per line <small class="hint">(add " -> step" to jump)</small></label><textarea class="fld" id="wschoices" rows="3" maxlength="1000">${esc((s.choices || []).map(c => c.label + (c.next ? ' -> ' + ((wfEdit.stages.find(x => x.id === c.next) || {}).title || '') : '')).join('\n'))}</textarea>${others.length ? `<p class="hint">Steps: ${others.map(([, t]) => esc(t)).join(' · ')}</p>` : ''}</div>
    <details class="wsadv" id="wsadv"${s.skip ? ' open' : ''}><summary>Advanced</summary><label class="optbox"><input type="checkbox" id="wsskip"${s.skip ? ' checked' : ''}>Allow skipping this step (with a reason)</label><p class="hint">Off: the step must be done (or the process cancelled). A step whose guide or automation is removed can always be skipped.</p></details>
    <div class="acts"><button class="btn green" id="sheetok">${s.id ? 'Save step' : 'Add step'}</button><button class="btn" type="button" data-sheetclose="1">Cancel</button></div></form>`,
    { labelledBy: 'sheettitle' },
  );
  wsShowKind();
  $('#wstitle').focus();
}
function wsShowKind() {
  const t = $('#wstype') && $('#wstype').value;
  document.querySelectorAll('#wfstageform [data-for]').forEach(d => (d.hidden = d.dataset.for !== t));
  const hint = $('#wskindhint');
  if (hint && WF_TYPE_HINT[t]) hint.textContent = WF_TYPE_HINT[t];
}
function saveStageForm(id) {
  if (!wfEdit) return closeSheet();
  const type = $('#wstype').value,
    title = txt($('#wstitle').value, 120);
  if (!WF_TYPES.includes(type) || !title) return;
  const s = { id: id || uid(), type, title, text: txt($('#wstext').value, 1000) };
  if ($('#wsskip').checked) s.skip = true; // (stored only when chosen)
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
          named = x => m && x.title.toLowerCase() === m[2].trim().toLowerCase() && x.id !== s.id,
          // (the jump the choice had, kept by id when its step still has that name: two steps
          // can share a name, and the first of them isn't necessarily the one it jumped to)
          was = ((wfEdit.stages.find(x => x.id === id) || {}).choices || []).find(c => c.label === label),
          kept = was && was.next && wfEdit.stages.find(x => x.id === was.next && named(x)),
          target = kept || wfEdit.stages.find(named);
        return { label, next: target ? target.id : '' };
      });
  if (type === 'procedure' && !s.kb) return toast('Choose the guide to follow', false, 3000);
  if (type === 'flow' && !s.flow) return toast('Choose the desktop automation to launch', false, 3000);
  if (type === 'verify' && !s.checks.length) return toast('Add at least one check', false, 3000);
  if (type === 'decide' && !s.choices.length) return toast('Add at least one choice', false, 3000);
  const i = wfEdit.stages.findIndex(x => x.id === id);
  if (i >= 0) wfEdit.stages[i] = s;
  else {
    if (wfEdit.stages.length >= WF_STAGES_MAX) return toast(`At most ${WF_STAGES_MAX} steps`, false, 3000);
    wfEdit.stages.push(s);
  }
  closeSheet();
  wfRenderStages(s.id);
}
function saveWorkflowForm() {
  if (!wfEdit) return;
  if ($('#wfstepin') && $('#wfstepin').value.trim()) addTypedStep(); // (typed, not yet added: it counts)
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
  const missing = w.stages.find(s => (s.type === 'flow' && !s.flow) || (s.type === 'procedure' && !s.kb));
  if (missing)
    return toast(
      `Choose the ${missing.type === 'flow' ? 'automation' : 'guide'} for “${missing.title}”`,
      false,
      3500,
    );
  const cur = wfById(w.id);
  if (cur) {
    // A changed definition is a new version; runs under way keep their own copy.
    const changed = JSON.stringify(cur.stages) !== JSON.stringify(w.stages) || cur.name !== w.name;
    w.ver = cur.ver + (changed ? 1 : 0);
    Object.assign(cur, w);
  } else S.workflows.push(w);
  wfEdit = null;
  wfView = w.id; // (saved: its overview, with Start to hand)
  save();
  renderKnowledge();
  toast('Process saved');
}
function wfEditClick(d, b) {
  if (d.wfnew) {
    if ($('#sheet')) closeSheet();
    wfEdit = { id: '', name: '', desc: '', stages: [], days: [], monthDay: 0, ver: 1, archived: false };
    kbView = 'proc';
    wfView = null;
    if (view !== 'knowledge') go('knowledge');
    else renderKnowledge();
    window.scrollTo(0, 0);
    $('#wfname').focus();
    return;
  }
  if (d.wftplpick !== undefined) return openTemplatePreview(+d.wftplpick);
  if (d.wftplback) return openTemplatePicker();
  if (d.wftpl !== undefined) {
    const t = WF_TEMPLATES[+d.wftpl];
    if (!t) return;
    if ($('#sheet')) closeSheet();
    wfEdit = { ...templateToWorkflow(t), id: '' };
    kbView = 'proc';
    wfView = null;
    if (view !== 'knowledge') go('knowledge');
    else renderKnowledge();
    window.scrollTo(0, 0);
    const n = $('#wfname');
    if (n) n.focus();
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
  if (d.wfview) {
    const w = wfById(d.wfview);
    if (!w) return toast('That process is gone', false, 3000);
    return leaveEditor(() => {
      kbView = 'proc';
      wfView = w.id;
      wfOpen = kbRun = kbArt = kbRunBackWf = null; // (whatever Knowledge was showing gives way)
      if (view !== 'knowledge') go('knowledge');
      else renderKnowledge();
      window.scrollTo(0, 0);
    });
  }
  if (d.wfback2) {
    wfView = null;
    renderKnowledge();
    window.scrollTo(0, 0);
    return;
  }
  if (d.wfcancel) {
    wfView = wfEdit && wfEdit.id && wfById(wfEdit.id) ? wfEdit.id : null;
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
    const ids = new Map(c.stages.map(s => [s.id, uid()]));
    c.stages.forEach(s => {
      s.id = ids.get(s.id);
      (s.choices || []).forEach(ch => (ch.next = ids.get(ch.next) || ''));
    });
    S.workflows.push(c);
    wfEdit = null;
    wfView = c.id; // (the copy, to rename or edit)
    save();
    renderKnowledge();
    return toast('Duplicated');
  }
  if (d.wfarchive) {
    const w = wfById(d.wfarchive);
    if (!w) return;
    w.archived = !w.archived;
    wfEdit = null;
    if (w.archived) wfView = null;
    save();
    renderKnowledge();
    return toast(w.archived ? 'Archived' : 'Back in the list');
  }
  if (!wfEdit) return;
  if (b && b.id === 'wfstageadd') return openStageForm('');
  if (b && b.id === 'wfstepgo') return addTypedStep();
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
  if (d.wfday !== undefined || d.wfpreset) readWfForm();
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
// On a task's page: a workflow linked to it (by the definition's q, or runs for it).
function questWorkflows(qid) {
  const ws = S.workflows.filter(w => !w.archived && w.q === qid),
    runs = S.wruns.filter(r => r.q === qid && !WRUN_OVER.includes(r.status));
  if (!ws.length && !runs.length) return '';
  return `<div class="list box reslist">${runs
    .map(
      r =>
        `<div class="row resrow"><button class="open" data-wfopen="${r.id}"><small>Process</small><span>${esc(r.name)}</span></button><span class="procline"><small>${runWord(r)}${runStage(r) ? ' · ' + esc(runStage(r).title) : ''}</small><button class="btn sm blue" data-wfopen="${r.id}">${WRUN_FINAL.includes(r.status) ? 'Open' : 'Continue process'}</button></span></div>`,
    )
    .join('')}${ws
    .filter(w => !runs.some(r => r.wf === w.id))
    .map(
      w =>
        `<div class="row resrow"><button class="open" data-wfview="${w.id}"><small>Process</small><span>${esc(w.name)}</span></button><span class="procline"><small>Not started</small><button class="btn sm blue" data-wfstart="${w.id}" data-q="${qid}">Start</button></span></div>`,
    )
    .join('')}</div>`;
}
