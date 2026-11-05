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
   skipped|failed, at, note, exec, run, wait, pick, occ, fid } }, status, fin, err, ack, log, rev,
   occ, fid, fails }.
   (Release G) rev: the run's revision, one higher on every change the server accepts (absent
   reads as 0; see pushRuns in sync.js). fid: the current failure's id, unique on every device
   (failOcc): 'x' + the attempt for an automation's reported failure (the same wherever it's
   folded in), else 'f' + a new id. occ: how many times the run has failed (only a count to show).
   fails: the last few failures, kept after a retry. ack: the failure acknowledged (its id; 1 from
   a copy of the app from before). */
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
      if (Number.isInteger(+o.occ) && +o.occ > 0) st[k].occ = +o.occ;
      if (typeof o.fid === 'string' && OCC_RE.test(o.fid)) st[k].fid = o.fid;
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
    ...(typeof r.ack === 'string' && OCC_RE.test(r.ack) ? { ack: r.ack } : r.ack ? { ack: 1 } : {}),
    ...(r.byRule ? { byRule: 1 } : {}),
    // (only once there is one, so a run from before reads the same and isn't sent again)
    // (the server's range: a revision it can't take is read as none)
    ...(Number.isInteger(+r.rev) && +r.rev > 0 && +r.rev < REV_MAX ? { rev: +r.rev } : {}),
    ...(Number.isInteger(+r.occ) && +r.occ > 0 ? { occ: +r.occ } : {}),
    ...(typeof r.fid === 'string' && OCC_RE.test(r.fid) ? { fid: r.fid } : {}),
    ...(Array.isArray(r.fails) && r.fails.length ? { fails: cleanFails(r.fails, ids) } : {}),
    log: (Array.isArray(r.log) ? r.log : [])
      .filter(l => l && typeof l === 'object' && Number.isFinite(+l.t) && typeof l.k === 'string')
      .map(l => ({ t: +l.t, k: l.k.slice(0, 20), m: txt(l.m, 200) }))
      .slice(-WF_LOG_MAX),
  };
}
// A run's past failures (the newest WF_FAILS): which step, when, what went wrong, the attempt.
const WF_FAILS = 12,
  OCC_RE = /^[\w.:-]{1,48}$/,
  REV_MAX = 999999999; // (supabase/release-g-runs.sql: revisions stay below this)
function cleanFails(l, ids) {
  return l
    .filter(f => f && typeof f === 'object' && Number.isInteger(+f.occ) && +f.occ > 0 && ids.has(f.sid))
    .map(f => ({
      occ: +f.occ,
      sid: f.sid,
      at: Number.isFinite(+f.at) ? +f.at : 0,
      err: txt(f.err, 300),
      ...(okRef(f.exec) ? { exec: f.exec } : {}),
      ...(typeof f.fid === 'string' && OCC_RE.test(f.fid) ? { fid: f.fid } : {}),
    }))
    .slice(-WF_FAILS);
}
function normWorkflows() {
  S.workflows = (Array.isArray(S.workflows) ? S.workflows : []).map(cleanWorkflow).filter(Boolean);
  S.wruns = (Array.isArray(S.wruns) ? S.wruns : []).map(cleanRun).filter(Boolean);
  // (a conflict outlives its run only as long as the run is here: see wfConflict)
  S.wconflicts = cleanConflicts(S.wconflicts).filter(c => S.wruns.some(r => r.id === c.run));
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
      if (
        completeStage(r, s.id, { note: x.msg ? 'Automation: ' + x.msg : '', by: 'auto', exec: x.id }) === ''
      )
        emitRun(r);
    } else if (
      failStage(
        r,
        s.id,
        (x.status === 'cancelled' ? 'Automation cancelled' : 'Automation failed') +
          (x.msg ? ': ' + x.msg : ''),
        { exec: x.id },
      ) === ''
    )
      emitRun(r);
  });
}
// Finished runs older than WRUNS_DAYS go, and all but the newest WRUNS_KEEP finished ones;
// unfinished runs stay (an open failure is never erased in silence).
function pruneRuns2() {
  const cut = Date.now() - WRUNS_DAYS * 864e5,
    // (nor a run with a conflict still to settle here: see wfConflict)
    held = r => (S.wconflicts || []).some(c => c.run === r.id);
  S.wruns = S.wruns.filter(r => !r.fin || r.fin > cut || held(r));
  const fin = S.wruns.filter(r => r.fin && !held(r)).sort((a, b) => b.fin - a.fin);
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
  return wfTx(r, { a: 'begin' }, () => {
    if (r.status !== 'ready') return 'not ready';
    r.status = 'running';
    r.started = Date.now();
    runLog(r, 'started');
    settleRun(r);
    return '';
  });
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
// (`exec`: the automation attempt whose result this is; refused once the step has another)
function completeStage(r, sid, opts = {}) {
  return wfTx(
    r,
    {
      a: 'done',
      sid,
      o: opts.o,
      note: opts.note,
      pick: opts.pick,
      by: opts.by,
      x: opts.exec,
      occ: failOcc(r) || undefined,
      eng: opts.by === 'auto' ? 1 : undefined,
    },
    () => doComplete(r, sid, opts),
  );
}
function doComplete(r, sid, { o = 'done', note = '', pick, by = '', exec = '' } = {}) {
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
    if (exec && r.live.exec !== exec) return 'that attempt has changed';
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
  if (by !== 'auto') asideExec(r.live.exec); // (done another way: that attempt no longer counts)
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
// (`exec`: the automation attempt that reported it, as for completeStage)
function failStage(r, sid, err, { exec = '' } = {}) {
  return wfTx(r, { a: 'fail', sid, err, x: exec || undefined, eng: exec ? 1 : undefined }, () => {
    if (WRUN_FINAL.includes(r.status) || r.status === 'paused') return 'the run is over or paused';
    if (r.status === 'ready') return 'the run has not started';
    const s = runStage(r);
    if (!s || s.id !== sid) return 'not the current step';
    if (exec && r.live.exec !== exec) return 'that attempt has changed';
    r.status = 'failed';
    delete r.ack; // (a new failure is news, whatever was acknowledged before)
    r.err = txt(err, 300) || 'Failed';
    // Each failure has an id of its own, the same on every device that makes it and never one
    // another device makes for another failure: what Acknowledge and Add to the Inbox are bound
    // to. (An automation's reported failure: its attempt, which fails once; else a new id.)
    r.occ = (r.occ || 0) + 1;
    r.fid = exec ? 'x' + exec : 'f' + uid();
    const at = Date.now();
    r.st[sid] = {
      o: 'failed',
      at,
      note: r.err,
      occ: r.occ,
      fid: r.fid,
      ...(r.live.exec ? { exec: r.live.exec } : {}),
    };
    r.fails = [
      ...(r.fails || []),
      { occ: r.occ, fid: r.fid, sid, at, err: r.err, ...(r.live.exec ? { exec: r.live.exec } : {}) },
    ].slice(-WF_FAILS);
    runLog(r, 'failed', r.err);
    return '';
  });
}
// An automation attempt the step no longer waits for (a retry, a new launch, or the step done or
// the run cancelled another way): set aside, on its own record (synced), so it's no longer flagged
// as waiting, and its results, if they still come, never move the run (they're about that attempt,
// and the step waits for another one, or none). Nothing is cancelled on the computer it runs on.
function asideExec(xid) {
  const x = !wfDry && xid && S.execs.find(e => e.id === xid);
  if (!x || EXEC_TERMINAL.includes(x.status) || x.aside) return;
  x.aside = 1;
  x.ack = 1;
  if (wfDepth) wfAside.push(x.id); // (noted with the change: undone if the server refuses it)
}
// The failure a failed run is in, by its id ('' when it isn't failed). A failure from before
// these ids is named by its time.
function failOcc(r) {
  if (!r || r.status !== 'failed') return '';
  return r.fid || (r.occ ? String(r.occ) : 't' + (((r.st || {})[r.cur] || {}).at || r.at || 0));
}
// Try the current stage again: a fresh attempt (a flow stage needs a new launch; the old
// execution stays in the log). The failure is kept in the log, not repeated on its own.
function retryStage(r, sid) {
  return wfTx(r, { a: 'retry', sid, occ: failOcc(r) || undefined }, () => {
    if (r.status !== 'failed' && r.status !== 'awaiting_user' && r.status !== 'awaiting_automation')
      return 'nothing to retry';
    const s = runStage(r);
    if (!s || s.id !== sid) return 'not the current step';
    const tries = (r.live.tries || 0) + 1;
    delete r.st[sid]; // (the failure stays in r.fails and the log)
    delete r.ack;
    asideExec(r.live.exec);
    r.live = { tries };
    r.err = '';
    r.status = 'running';
    runLog(r, 'retry', 'attempt ' + (tries + 1));
    settleRun(r);
    return '';
  });
}
function pauseRun(r) {
  return wfTx(r, { a: 'pause' }, () => {
    if (WRUN_FINAL.includes(r.status) || r.status === 'paused' || r.status === 'ready') return 'cannot pause';
    r.status = 'paused';
    runLog(r, 'paused');
    return '';
  });
}
function resumeRun(r) {
  return wfTx(r, { a: 'resume' }, () => doResume(r));
}
function doResume(r) {
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
// (`eng`: the day's tidy-up, made the same on every device, rather than your choice)
function cancelRun(r, why = '', { eng = false } = {}) {
  return wfTx(r, { a: 'cancel', why, eng: eng ? 1 : undefined }, () => {
    if (WRUN_OVER.includes(r.status)) return 'the run is over';
    asideExec(r.live.exec);
    r.status = 'cancelled';
    r.fin = Date.now();
    r.err = txt(why, 300);
    runLog(r, 'cancelled', why);
    return '';
  });
}
/* Release G: what this device did to a run, until the server has it. Each change above (and the
   few below) is noted in the run's journal (sync2.wjour, this device's own bookkeeping) with what
   it was asked: that is what "Apply mine on top" does again on another device's version of the
   run after a conflict (see pushRuns in sync.js), each step checked again by the same rules. Moves
   every device makes alike from the same records (an automation's result, the day's tidy-up) are
   marked `eng`. A change that changes nothing isn't noted, and a change made inside another
   (a result applied on Resume) is part of that one. */
const WJOUR_MAX = 40;
let wfDepth = 0,
  wfDry = false, // (trying the journal out on a copy: nothing noted, told to the rules or made)
  wfAside = []; // (the attempts the change under way set aside, noted with it as `ax`)
function wfTx(r, e, fn) {
  if (wfDepth) return fn();
  const before = JSON.stringify(r);
  wfDepth++;
  wfAside = [];
  let why;
  try {
    why = fn();
  } finally {
    wfDepth--;
  }
  if (why === '' && !wfDry && JSON.stringify(r) !== before) {
    journalRun(r.id, wfAside.length ? { ...e, ax: wfAside.slice() } : e);
    (sync2.wjh = sync2.wjh || {})[r.id] = recHash('wrun:' + r.id, r); // (explained: see wrunSeen)
  }
  return why;
}
// Each entry has its number (q, rising on this device), so what a change sent held is known
// however the journal was trimmed since (see acceptedRun).
function journalRun(id, e) {
  const j = (sync2.wjour = sync2.wjour || {}),
    l = (j[id] = j[id] || []),
    x = {};
  for (const k in e) if (e[k] !== undefined && e[k] !== '') x[k] = e[k];
  x.q = sync2.wjq = (sync2.wjq || 0) + 1;
  l.push(x);
  // (too long to play back whole: the oldest go, and the mark, numbered as the last of them, says so)
  if (l.length > WJOUR_MAX) {
    const gone = l.splice(0, l.length - WJOUR_MAX + 1);
    l.unshift({ a: 'cut', q: gone[gone.length - 1].q || 0 });
  }
}
// From markDirty: a run as it is now (hash `h`; `clean`: as last synced). A change to a run that
// came through none of the transitions above (a backup restored, say) is noted too, as a
// 'replace': it can't be done again step by step, and a conflict over it is never settled on its
// own. (sync2.wjh: each run's hash as last explained, by a transition, a sync, or taking a row.)
function wrunSeen(k, h, clean) {
  const id = k.slice(5),
    w = (sync2.wjh = sync2.wjh || {});
  if (!clean && id in w && w[id] !== h) journalRun(id, { a: 'replace' });
  w[id] = h;
}
function checkStage(r, sid, i, v) {
  return wfTx(r, { a: 'check', sid, i, v: !!v }, () => {
    const s = runStage(r);
    if (!s || s.id !== sid || s.type !== 'verify' || !runAllows(r, 'check', sid))
      return 'that step has moved on';
    if (!(Number.isInteger(i) && i >= 0 && i < (s.checks || []).length)) return 'no such check';
    r.live.checks = r.live.checks || [];
    r.live.checks[i] = !!v;
    return '';
  });
}
function linkGuide(r, sid, prId) {
  return wfTx(r, { a: 'guide', sid, run: prId }, () => {
    const s = runStage(r);
    if (!s || s.id !== sid || s.type !== 'procedure' || !runAllows(r, 'procedure', sid))
      return 'that step has moved on';
    if (!okRef(prId)) return 'no such guide run';
    r.live.run = prId;
    runLog(r, 'procedure');
    return '';
  });
}
function waitStage(r, sid) {
  return wfTx(r, { a: 'wait', sid }, () => {
    const s = runStage(r);
    if (!s || s.id !== sid || s.type !== 'wait' || !runAllows(r, 'waititem', sid))
      return 'that step has moved on';
    if (r.live.wait) return 'already waiting';
    stageWaitItem(r, s);
    settleRun(r);
    runLog(r, 'waiting', s.who || '');
    return '';
  });
}
function ackRun(r, occ) {
  return wfTx(r, { a: 'ack', occ }, () => {
    if (r.status !== 'failed' || !occ || failOcc(r) !== occ) return 'that failure has changed';
    r.ack = occ;
    return '';
  });
}
// (a waiting item taken to Today waits through its step now: see rekeyFollows)
function rekeyRunWait(r, from, to) {
  return wfTx(r, { a: 'rekey', from, to }, () => {
    if (!r.live || r.live.wait !== from || !okRef(to)) return 'not waiting through that';
    r.live.wait = to;
    return '';
  });
}
// This device's whole version of a run in place of the server's (its revision stays the server's,
// the base of the change).
function replaceRun(r, mine) {
  return wfTx(r, { a: 'replace' }, () => {
    const keep = r.rev,
      m = cleanRun(JSON.parse(JSON.stringify(mine)));
    if (!m || m.id !== r.id) return 'not this run';
    Object.keys(r).forEach(k => delete r[k]);
    Object.assign(r, m, keep ? { rev: keep } : {});
    if (!keep) delete r.rev;
    return '';
  });
}
function noteRun(r, k, m) {
  return wfTx(r, { a: 'note', k, m }, () => {
    runLog(r, k, m);
    return '';
  });
}
// One noted change, done again to `r` (another version of the same run): '' when it applied.
// A launch is only the record of the tap made here: nothing is opened or launched again.
function replayEntry(r, e) {
  const str = v => (typeof v === 'string' ? v : ''),
    sid = str(e.sid);
  if ((e.a === 'done' || e.a === 'retry') && e.occ && failOcc(r) !== e.occ) return 'that failure has changed';
  switch (e.a) {
    case 'begin':
      return beginRun(r);
    case 'done':
      return completeStage(r, sid, {
        o: e.o === 'skipped' ? 'skipped' : 'done',
        note: str(e.note),
        ...(Number.isInteger(e.pick) ? { pick: e.pick } : {}),
        by: str(e.by),
        exec: okRef(e.x) ? e.x : '',
      });
    case 'fail':
      return failStage(r, sid, str(e.err), { exec: okRef(e.x) ? e.x : '' });
    case 'retry':
      return retryStage(r, sid);
    case 'pause':
      return pauseRun(r);
    case 'resume':
      return resumeRun(r);
    case 'cancel':
      return cancelRun(r, str(e.why), { eng: !!e.eng });
    case 'check':
      return checkStage(r, sid, e.i, e.v);
    case 'launch':
      return launchStage(r, sid, okRef(e.x) ? e.x : '');
    case 'guide':
      return linkGuide(r, sid, str(e.run));
    case 'wait':
      return waitStage(r, sid);
    case 'ack':
      return r.ack === e.occ ? '' : ackRun(r, str(e.occ));
    case 'rekey':
      return rekeyRunWait(r, str(e.from), str(e.to));
    case 'note':
      return noteRun(r, str(e.k).slice(0, 20) || 'note', str(e.m));
    case 'cut':
      return 'too many changes to replay';
    case 'replace':
      return 'replaced as a whole'; // (see conflictWhy: then the whole of this device's version is)
  }
  return 'not something that can be applied again';
}

/* conflicts: a change to a run that the server refused because the run had changed on another
   device first. This device's version and its journal are kept (S.wconflicts: on this device
   only, and in its backups) until you choose: keep the server's (what this device did is written
   into the run's history, not applied) or apply this device's changes on top of the server's,
   checked again step by step. A refusal that loses nothing is settled on its own (see
   conflictSettles). */
const WCONF_MAX = 20;
function cleanConflicts(l) {
  return (Array.isArray(l) ? l : [])
    .filter(c => c && typeof c === 'object' && okRef(c.id) && okRef(c.run))
    .map(c => ({
      id: c.id,
      run: c.run,
      at: Number.isFinite(+c.at) ? +c.at : 0,
      base: Number.isInteger(+c.base) ? +c.base : 0,
      srev: Number.isInteger(+c.srev) ? +c.srev : 0,
      ...(c.gone ? { gone: 1 } : {}), // (Release H: deleted on the server, still here)
      mine: (c.mine && cleanRun(c.mine)) || null,
      jour: (Array.isArray(c.jour) ? c.jour : [])
        .filter(e => e && typeof e === 'object' && typeof e.a === 'string')
        .slice(-WJOUR_MAX),
    }))
    .slice(-WCONF_MAX);
}
// Whether a refused change loses nothing by the server's version standing: a run tidied away (on
// either side), the same automation result or day's tidy-up made there too, an acknowledgement
// already there, a run only made ready (a repeat's run, made on each device), or nothing noted
// and no history the server hasn't got. Notes alone are written again on the server's version.
function conflictSettles(mine, theirs, base, jour) {
  const t = theirs && cleanRun(theirs);
  if (!mine) return true; // (deleted here: the server's run comes back, nothing of this device's lost)
  // Deleted on the server (Release H): settled only for a run that is over here too and that this
  // device didn't change but for notes or what every device does alike (a finished run tidied
  // away). One still under way here, or finished by this device, is a choice to make: the other
  // device may have deleted it, or restored a backup without it, while this one worked on it.
  if (!t) return WRUN_OVER.includes(mine.status) && jour.every(e => e.a === 'note' || e.eng);
  // (an automation's result: the server's run still waits for that attempt, so it takes the
  // result itself, or already has it; a success the server's run has set aside, by a retry made
  // there, is news, and so is a failure where the server's step has that attempt done, a result
  // confirmed by hand there: Release H)
  const same = (e, o) => (e.a === 'done' ? o.o === 'done' : e.a === 'fail' ? o.o === 'failed' : true);
  const held = e =>
    !e.x ||
    t.live.exec === e.x ||
    Object.values(t.st).some(o => o.exec === e.x && same(e, o)) ||
    (e.a !== 'done' && (t.fails || []).some(f => f.exec === e.x));
  if (jour.some(e => e.a !== 'note' && !(e.eng && held(e)) && !(e.a === 'ack' && t.ack === e.occ)))
    return false;
  if (jour.length) return true;
  const seen = new Set(t.log.map(l => l.t + '|' + l.k)),
    known = l => seen.has(l.t + '|' + l.k);
  // A run new here (base 0) that the server has too: only a run made ready on each device (a
  // repeat's run) settles; one this device did anything with doesn't, journal or not.
  if (base === 0)
    return (
      mine.status === 'ready' &&
      !Object.keys(mine.st).length &&
      mine.log.every(l => l.k === 'prepared' || known(l))
    );
  return mine.log.every(known);
}
// From sync: the server refused this device's change to run `id` (`mine`: this device's version,
// null if it was deleted here) and has `theirs` (null: deleted there) at revision `srev`. Kept as a
// conflict unless it settles; returns the notes to write again on the server's version.
function wfConflict(id, mine, theirs, base, srev, jour) {
  if (conflictSettles(mine, theirs, base, jour)) return jour.filter(e => e.a === 'note');
  S.wconflicts.push({
    id: uid(),
    run: id,
    at: Date.now(),
    base,
    srev,
    // (deleted on the server: this device keeps the run, unsent, until you choose; see putRun)
    ...(theirs ? {} : { gone: 1 }),
    mine: JSON.parse(JSON.stringify(mine)),
    jour: jour.map(e => ({ ...e })),
  });
  // (too many: the oldest goes, after what it held is written into its run's history)
  while (S.wconflicts.length > WCONF_MAX) {
    const old = S.wconflicts.shift(),
      r = wrunById(old.run);
    if (r) noteRun(r, 'conflict', 'not applied from this device (too many conflicts): ' + jourSummary(old));
  }
  if (!(wfOpen === id && view === 'knowledge'))
    toast(
      theirs
        ? `“${mine.name}” changed on another device too: open it to choose`
        : `“${mine.name}” was deleted on another device after it changed here: open it to choose`,
      false,
      5000,
    );
  return [];
}
// (Release H) The attempts a refused change set aside (its journal's `ax`), back as they were
// where the server's run still holds them: it waits for that attempt, or took its result. So the
// server's run and the attempt's own record agree again. ('Apply mine on top' sets them aside
// again, if it applies.) Returns whether any changed.
function undoAside(jour, theirs) {
  const t = theirs && cleanRun(theirs);
  if (!t) return false;
  const holds = x =>
    t.live.exec === x.id ||
    (EXEC_TERMINAL.includes(x.status) && Object.values(t.st).some(o => o.exec === x.id && o.o !== 'skipped'));
  let changed = false;
  jour.forEach(e =>
    (Array.isArray(e.ax) ? e.ax : []).forEach(id => {
      const x = S.execs.find(y => y.id === id);
      if (!x || !x.aside || !holds(x)) return;
      delete x.aside;
      if (!EXEC_TERMINAL.includes(x.status)) delete x.ack; // (set with the aside; a failure's own stays)
      changed = true;
    }),
  );
  return changed;
}
// (Release H) The server's run differs from the base of this device's refused change only by the
// day's tidy-up: never started, cancelled as "not started that day", one revision on. This
// device's work then goes on top (its whole version, as it was refused).
function tidiedOnly(r, c) {
  const last = r.log[r.log.length - 1] || {};
  return (
    !!c.mine &&
    !c.gone &&
    r.status === 'cancelled' &&
    (r.rev || 0) === c.base + 1 &&
    !Object.keys(r.st).length &&
    !r.log.some(l => l.k === 'started') &&
    last.k === 'cancelled' &&
    r.err === 'not started that day'
  );
}
// Whether this device's changes still apply on top of the run as it is now ('' when they do):
// tried out on a copy, by the same rules.
function conflictWhy(r, c) {
  if (!r) return 'the run is gone';
  // (replaced as a whole here, a backup restored say: the whole of this device's version, or not;
  // the same for a run deleted on the server and kept here, and one only tidied away there)
  if (c.gone || c.jour.some(e => e.a === 'replace') || tidiedOnly(r, c))
    return c.mine ? '' : 'nothing to apply';
  const copy = JSON.parse(JSON.stringify(r));
  wfDry = true;
  try {
    for (const e of c.jour) {
      const why = replayEntry(copy, e);
      if (why) return why;
    }
  } finally {
    wfDry = false;
  }
  return '';
}
// One noted change in words, for the conflict and the run's history.
function jourWords(e, def) {
  const st = id => {
      const s = def.find(x => x.id === id);
      return s ? `“${s.title}”` : 'a step';
    },
    s = def.find(x => x.id === e.sid);
  switch (e.a) {
    case 'begin':
      return 'started it';
    case 'done':
      if (e.o === 'skipped') return 'skipped ' + st(e.sid);
      if (e.by === 'auto') return st(e.sid) + ' done by the automation';
      if (Number.isInteger(e.pick) && s && s.choices && s.choices[e.pick])
        return `chose “${s.choices[e.pick].label}” at ${st(e.sid)}`;
      return 'marked ' + st(e.sid) + ' done';
    case 'fail':
      return st(e.sid) + ' failed' + (e.err ? ': ' + e.err : '');
    case 'retry':
      return 'tried ' + st(e.sid) + ' again';
    case 'pause':
      return 'paused it';
    case 'resume':
      return 'resumed it';
    case 'cancel':
      return 'cancelled it';
    case 'check':
      return `${e.v ? 'ticked' : 'unticked'} “${((s && s.checks) || [])[e.i] || 'a check'}”`;
    case 'launch':
      return 'launched ' + st(e.sid);
    case 'guide':
      return 'opened the guide for ' + st(e.sid);
    case 'wait':
      return 'started waiting at ' + st(e.sid);
    case 'ack':
      return 'acknowledged the failure';
    case 'cut':
      return '…';
    case 'replace':
      return 'replaced it (restored from a backup, say)';
  }
  return '';
}
const jourSummary = c => {
  const w = c.jour.map(e => jourWords(e, (c.mine || {}).def || [])).filter(Boolean);
  return w.length ? w.join(', ') : 'no steps';
};
// What the server's version has: its state, and its steps' outcomes where they differ from this
// device's.
function theirsWords(r, c) {
  if (c.gone) return 'Deleted on another device';
  if (tidiedOnly(r, c)) return 'Cancelled by the day’s tidy-up (never started there)';
  const s = runStage(r),
    mine = c.mine || { st: {} },
    diff = r.def
      .filter(x => r.st[x.id] && (r.st[x.id] || {}).o !== (mine.st[x.id] || {}).o)
      .map(x => `“${x.title}” ${r.st[x.id].o}`);
  return `${runWord(r)}${s ? ` at “${s.title}”` : ''}${diff.length ? ' · ' + diff.join(', ') : ''}`;
}
// On the run's page: each conflict, what each side did, and the two ways out.
function wfConflictBox(r) {
  return S.wconflicts
    .filter(c => c.run === r.id)
    .map(c => {
      const why = conflictWhy(r, c),
        btn = (k, label, cls = '') =>
          `<button class="btn ${cls}" data-wconf="${c.id}" data-wcact="${k}">${label}</button>`;
      return `<div class="box wconf"><p><b>Conflict:</b> changed on another device too.</p><p class="hint"><b>This device:</b> ${esc(jourSummary(c))}.</p><p class="hint"><b>Server:</b> ${esc(theirsWords(r, c))}.</p><div class="acts">${btn('keep', 'Keep the server’s')}${why ? '' : btn('mine', 'Apply mine on top', 'blue')}</div>${why ? `<p class="hint">Mine can’t be applied: ${esc(why)}.</p>` : ''}</div>`;
    })
    .join('');
}
function wfConflictClick(d) {
  const c = S.wconflicts.find(x => x.id === d.wconf),
    r = c && wrunById(c.run);
  if (!c) return renderKnowledge();
  const drop = () => (S.wconflicts = S.wconflicts.filter(x => x !== c));
  if (d.wcact === 'keep') {
    // (deleted there: deleted here too, as the server has it)
    if (c.gone) {
      drop();
      wrunForget(c.run);
      if (wfOpen === c.run) wfOpen = null;
      save();
      if (typeof wrunRecheck === 'function') wrunRecheck(c.run);
      toast('Deleted, as on the other device', false, 3000);
      return renderKnowledge();
    }
    if (r) noteRun(r, 'conflict', 'kept the server’s; not applied from this device: ' + jourSummary(c));
    drop();
    save();
    return renderKnowledge();
  }
  if (d.wcact !== 'mine') return;
  // (checked again now: a sync may have moved the run on since the page was drawn)
  const why = conflictWhy(r, c);
  if (why) {
    toast("Can't apply yours: " + why, false, 3000);
    return renderKnowledge();
  }
  const was = r.status;
  // (deleted there: this device's version, as it is here, goes back on top of the deletion)
  if (c.gone)
    noteRun(r, 'conflict', 'kept this device’s after it was deleted on another device: ' + jourSummary(c));
  else {
    if (c.jour.some(e => e.a === 'replace') || tidiedOnly(r, c)) replaceRun(r, c.mine);
    else c.jour.forEach(e => replayEntry(r, e));
    noteRun(r, 'conflict', 'applied this device’s on top: ' + jourSummary(c));
  }
  drop();
  reconcileRuns(); // (an attempt recorded again whose result is in: taken now)
  wfAfter(r, was, '');
}
// Where a run's last change stands, when it syncs: saved here and not yet taken by the server,
// taken (synced), or refused for a newer change made elsewhere ('': not syncing).
// (Release H) Synced, it also says whether the server checks the run's changes ('checked'), doesn't
// ('unchecked': the newer edit wins), has its check only in part ('partial'), or isn't known yet.
function wsyncState(r) {
  if (typeof sb === 'undefined' || !sb || !session) return '';
  if (S.wconflicts.some(c => c.run === r.id)) return 'conflict';
  if (wrunParked('wrun:' + r.id)) return 'refused';
  if (sync2.dirty['wrun:' + r.id]) return syncStatus === 'error' ? 'failed' : 'pending';
  if (wrunCas.on === true) return wrunCas.guard === false ? 'partial' : 'checked';
  if (wrunCas.on === false) return wrunCas.guard ? 'partial' : 'unchecked';
  return 'synced';
}
const WSYNC_WORD = {
  pending: 'Saved on this device, not yet synced',
  checked: 'Synced, checked by the server',
  unchecked: 'Synced, but the server’s check isn’t installed: the newer edit wins',
  partial: 'Synced, but the server’s check is only partly installed (Settings > Health check)',
  synced: 'Synced',
  conflict: 'Conflict: needs your choice',
  refused: 'Not synced',
  failed: 'Not synced: the last sync failed',
};
// (Release H) Said by an automation's Launch and a Try again while the server doesn't check run
// changes (synced or not yet): nothing is blocked (offline work goes on), but you should know.
const wunprot = r =>
  wsyncState(r) && wrunCas.on === false && !wrunCas.guard
    ? '<p class="hint wunprot">Not protected: if another device changes this run before it syncs, the newer edit overwrites this run’s progress.</p>'
    : '';
// A run the server refused as it is (see park in sync.js): why, and the way out.
function wsyncRefused(r) {
  const b = wrunParked('wrun:' + r.id);
  return b
    ? `<div class="box wconf"><p><b>Not synced:</b> ${esc(b.msg)}.</p><div class="acts"><button class="btn" data-wtake="${r.id}">Use the server’s</button></div></div>`
    : '';
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
        if (
          completeStage(r, s.id, {
            note: ev.msg ? 'Automation: ' + ev.msg : '',
            by: 'auto',
            exec: ev.exec,
          }) === ''
        )
          emitRun(r);
      } else if (
        !WRUN_FINAL.includes(r.status) &&
        failStage(
          r,
          s.id,
          (ev.k === 'exec_cancelled' ? 'Automation cancelled' : 'Automation failed') +
            (ev.msg ? ': ' + ev.msg : ''),
          { exec: ev.exec },
        ) === ''
      )
        emitRun(r);
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
  if (wfDry) return; // (a change only being tried out, see conflictWhy)
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
    // Not one this device has a change of its own to, still to reach the server, or a conflict
    // about (Release H): that work may yet start it.
    S.wruns.forEach(r => {
      if (
        r.wf === w.id &&
        r.status === 'ready' &&
        /-\d{4}-\d\d-\d\d$/.test(r.id) &&
        r.id < id &&
        !wrunUnsent(r.id)
      )
        cancelRun(r, 'not started that day', { eng: true });
    });
    S.wruns.push(makeRun(w, { id, prepared: true }));
    emitEvent({ k: 'wf_due', key: 'wfdue:' + id, wf: w.id, wrun: id, name: w.name });
  });
}
// Whether this device has a change of its own to a run not yet taken by the server: noted in its
// journal, being sent, or refused and waiting on a choice.
const wrunUnsent = id =>
  !!(
    ((sync2.wjour || {})[id] || []).length ||
    (sync2.wop || {})['wrun:' + id] ||
    S.wconflicts.some(c => c.run === id)
  );
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
// Back from a run: to the page it was opened from, else the workflow list. (Release H: where it
// was scrolled to, with the keyboard on the control that opened the run.)
let wfFromY = 0;
function closeWorkflowRun() {
  const from = wfFrom,
    id = wfOpen;
  wfOpen = wfFrom = null;
  if (from && from !== 'knowledge') go(from);
  else renderKnowledge();
  window.scrollTo(0, wfFromY);
  wfFromY = 0;
  if (id) refocus(`[data-wfopen="${CSS.escape(id)}"]`);
}
function openWorkflowRun(id) {
  if (!wrunById(id)) return toast('That run is gone', false, 3000);
  leaveEditor(() => {
    if (wfOpen !== id) wfFromY = window.scrollY;
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
  const r = wrunById(wrunId);
  if (r && wfLaunchFits(wrunId, stageId)) launchStage(r, stageId, x ? x.id : '');
}
// The step's attempt recorded (the tap itself opened the automation: nothing here launches it).
function launchStage(r, sid, xid) {
  return wfTx(r, { a: 'launch', sid, x: xid || undefined }, () => {
    const s = runStage(r);
    if (!s || s.id !== sid || s.type !== 'flow' || WRUN_FINAL.includes(r.status) || r.status === 'paused')
      return 'that step has moved on';
    // (an attempt still under way there: this one can't take its place)
    const cur = r.live.exec && r.live.exec !== xid && S.execs.find(e => e.id === r.live.exec);
    if (cur && !EXEC_TERMINAL.includes(cur.status) && !execStale(cur)) return 'another attempt is under way';
    if (r.live.exec !== xid) asideExec(r.live.exec);
    if (xid) r.live.exec = xid;
    else r.live.launched = Date.now();
    runLog(r, 'launched', xid ? '' : 'untracked');
    settleRun(r);
    return '';
  });
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
  if (!it && !wfDry) {
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
  if (d.wconf) return wfConflictClick(d);
  if (d.wtake) return wrunTakeServer('wrun:' + d.wtake);
  const r = d.wrun && wrunById(d.wrun);
  if (d.wrun && !r) return toast('That run is gone', false, 3000);
  if (!r) return wfEditClick(d, b);
  if (!d.wfact) return;
  if (STAGE_ACTS[d.wfact]) return wfStageClick(r, d);
  // (bound to the failure they were drawn for: a newer one is news, not acknowledged unseen)
  if (d.wfact === 'ack' || d.wfact === 'inbox') return wfFailAct(r, d.wfact, d.wocc || '');
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
  else if (d.wfact === 'copy') return copyText(runSummary(r));
  wfAfter(r, was, why);
}
// Acknowledge, or Add to the Inbox (which acknowledges too), for the failure `occ`: refused if the
// run has failed again since (or isn't failed any more). The Inbox item is that failure's, named
// by the run and the failure, so it is made once however often it's asked for, on any device.
function wfFailAct(r, act, occ) {
  if (r.status !== 'failed' || !occ || occ !== failOcc(r)) {
    toast('That failure has changed', false, 3000);
    return renderKnowledge();
  }
  const added = act === 'inbox' && failInboxItem(r, occ);
  ackRun(r, occ);
  save();
  renderAll();
  if (act === 'inbox') toast(added ? 'Added to the Inbox' : 'Already in the Inbox');
}
function failInboxItem(r, occ) {
  const id = keyId('wfail:' + r.id + ':' + occ),
    nid = id + 'n';
  if (S.inbox.some(i => i.id === id) || [S.quests, S.later].some(l => find(id, l) || find(nid, l)))
    return false;
  const s = runStage(r),
    f = (r.fails || []).find(x => (x.fid || String(x.occ)) === occ),
    x = f && f.exec && S.execs.find(e => e.id === f.exec),
    text = ('Process failed: ' + r.name + (s ? ' · ' + s.title : '')).slice(0, 200),
    url = location.href.split('#')[0] + '#/wrun/' + r.id,
    notes = [
      `Step: ${s ? s.title : 'none'}`,
      `Failed: ${new Date((f && f.at) || r.at).toLocaleString()}${f ? ' (failure ' + f.occ + ' of this run)' : ''}`,
      `Error: ${(f && f.err) || r.err || 'Failed'}`,
      ...(x ? [`Attempt: ${x.id} · ${EXEC_WORD[execState(x)]}${x.msg ? ': ' + x.msg : ''}`] : []),
      `Run: ${url}`,
      '',
      runSummary(r),
    ].join('\n');
  const node = fix({ id: nid, text, notes });
  if (okUrl(url)) node.links = [{ id: keyId('wfl:' + id), kind: 'url', url, label: 'The process run' }];
  S.inbox.unshift({ id, text, node });
  return true;
}
// After an action: what went wrong said, an ending told to the rules, the page redrawn.
function wfAfter(r, was, why) {
  if (why) toast("Couldn't: " + why, false, 3000);
  if ((r.status === 'succeeded' || r.status === 'failed') && r.status !== was) emitRun(r);
  save();
  renderKnowledge();
  if (r.status === 'succeeded')
    toast(
      !navigator.onLine && wsyncState(r) === 'pending'
        ? 'Completed on this device; not synced yet'
        : 'Process completed',
    );
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
    checkStage(r, sid, i, !(r.live.checks || [])[i]);
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
      linkGuide(r, sid, nr.id);
    } else linkGuide(r, sid, pr.id);
    save();
    kbRun = r.live.run;
    kbArt = s.kb;
    wfOpen = null;
    kbRunBackWf = r.id;
    renderKnowledge();
    return window.scrollTo(0, 0);
  } else if (act === 'waititem') {
    waitStage(r, sid);
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
    final = WRUN_OVER.includes(r.status),
    ws = wsyncState(r);
  let h = `<button class="linkbtn" data-wfback="1">‹ ${wfFrom === 'today' ? 'Today' : wfFrom === 'ops' ? 'Command Centre' : wfFrom ? 'Back' : wfView && wfById(wfView) ? esc(wfById(wfView).name) : 'Processes'}</button>${q ? `<p class="hint kbtrail">For: <button class="linkbtn" data-open="${q.n.id}">${esc(q.n.text)}</button></p>` : ''}
    <h2 class="kbtitle">${esc(r.name)}</h2><div class="prog"><div style="width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%"></div></div>
    <p class="hint runprog"><span class="wst w-${r.status}">${runWord(r)}</span>${s ? ` · step ${i + 1} of ${p.total}` : ''}${!navigator.onLine && r.status === 'awaiting_automation' ? ' · offline: as last synced' : ''}${ws ? ` · <span class="wsync ws-${ws}">${WSYNC_WORD[ws]}</span>` : ''}</p>${wfConflictBox(r)}${ws === 'refused' ? wsyncRefused(r) : ''}`;
  const can = runActions(r),
    b = (act, label, cls = '', extra = '') =>
      `<button class="btn ${cls}" data-wrun="${r.id}" data-wfact="${act}"${extra ? ' ' + extra : ''}>${label}</button>`;
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
          '',
          a === 'inbox' || a === 'ack' ? `data-wocc="${failOcc(r)}"` : '',
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
    const opts = more
      .map(a => b(a, label[a], '', a === 'inbox' || a === 'ack' ? `data-wocc="${failOcc(r)}"` : ''))
      .join('');
    return `<div class="pstep box failed"><p class="pnum">${i + 1}</p><h3>${esc(s.title)}</h3>${s.type !== 'manual' ? `<p class="hint ptype">${WF_TYPE_NAME[s.type]}</p>` : ''}${body}<p class="hint pnext">${next}</p>${wunprot(r)}<div class="acts wacts">${acts}</div><details class="moreopts" id="wfmore"${panels.wfmore ? ' open' : ''}><summary>Other options</summary><div class="acts wacts">${opts}</div><p class="hint">Acknowledging only stops the failure being flagged on Today and in the Command Centre; it doesn't fix it.</p></details></div>`;
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
      body += `<p class="hint xline">${execLine(x)}</p><p class="hint">This step completes on its own when the automation reports its result.</p>${strayLine(f, x)}`;
      acts = `${b('confirmflow', 'It succeeded (checked by hand)', '', 'data-ok="yes"')}${b('confirmflow', 'It failed', '', 'data-ok="no"')}`;
    } else {
      if (x) body += `<p class="hint xline">${execLine(x)}</p>${strayLine(f, x)}`;
      body += S.track
        ? '<p class="hint">Launch the automation; this step completes when its result is reported.</p>'
        : '<p class="hint">Result tracking is off (<button class="linkbtn" data-gosec="execsec">Settings: Automations</button>): launch the automation, then confirm its result yourself.</p>';
      acts = `<a class="btn blue" href="${esc(f.url)}" data-flow="${f.id}" data-wrun="${id}" data-wstage="${s.id}"${r.q ? ` data-q="${r.q}"` : ''}>&#9654; Launch ${esc(f.name)}</a>${
        x || !S.track
          ? `${b('confirmflow', 'It succeeded (checked by hand)', '', 'data-ok="yes"')}${b('confirmflow', 'It failed', '', 'data-ok="no"')}`
          : ''
      }${skip}`;
      body += wunprot(r);
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
// (Release H) A result reported for this flow since the attempt `x` was launched that named no
// attempt and couldn't be paired (two launches waiting, say): never taken as this one's. Said, so
// you can check and confirm the step yourself.
function strayLine(f, x) {
  const y = S.execs
    .filter(e => e.unreq && e.flow === f.id && e.at >= x.at && EXEC_TERMINAL.includes(e.status))
    .sort((a, b) => b.at - a.at)[0];
  return y
    ? `<p class="hint wstray">A result came for this automation that names no attempt (${execLine(y)}), so it wasn’t taken as this one’s. Check what happened, then confirm the step yourself.</p>`
    : '';
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
