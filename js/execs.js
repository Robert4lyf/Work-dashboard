/* automation execution tracking: tapping a flow's button records an execution (S.execs, kind
   'exec': { id, flow, q, at, status, msg, upd, ref, ev: [{ i, t, s, m }], ack }) as "requested".
   The flow (or a script) then reports what happened through cockpit_exec_report (see
   supabase-setup.sql) with the execution token; those reports are rows the app pulls during
   sync and folds in here, in order, by their row id: the same on every device, so the records
   agree. A tap is never a result: an execution not reported on stays unconfirmed. */
const EXEC_KEY = 'dashboard-exec-token';
const EXEC_STATUS = ['requested', 'running', 'succeeded', 'failed', 'cancelled'];
const EXEC_TERMINAL = ['succeeded', 'failed', 'cancelled'];
const EXEC_STALE = 24 * 3600e3; // requested or running for this long with no word: unconfirmed
const EXEC_KEEP = 150, // executions kept (the newest)
  EXEC_EVENTS = 12; // reports kept per execution
let execToken = '';
try {
  execToken = localStorage.getItem(EXEC_KEY) || '';
} catch (e) {}
const execReportUrl = () => rpcUrl('cockpit_exec_report');
function normExecs() {
  S.track = !!S.track;
  S.execs = (Array.isArray(S.execs) ? S.execs : [])
    .filter(x => x && typeof x === 'object' && okRef(x.id) && okRef(x.flow) && Number.isFinite(+x.at))
    .map(x => ({
      id: x.id,
      flow: x.flow,
      q: okRef(x.q) ? x.q : '',
      at: +x.at,
      status: EXEC_STATUS.includes(x.status) ? x.status : 'requested',
      msg: cleanText(typeof x.msg === 'string' ? x.msg : '').slice(0, 300),
      upd: Number.isFinite(+x.upd) ? +x.upd : +x.at,
      ref: typeof x.ref === 'string' ? x.ref.slice(0, 60) : '',
      ev: (Array.isArray(x.ev) ? x.ev : [])
        .filter(e => e && Number.isFinite(+e.i) && EXEC_STATUS.includes(e.s))
        .map(e => ({
          i: +e.i,
          t: Number.isFinite(+e.t) ? +e.t : 0,
          s: e.s,
          m: cleanText(typeof e.m === 'string' ? e.m : '').slice(0, 300),
        }))
        .slice(-EXEC_EVENTS),
      ...(x.ack ? { ack: 1 } : {}),
      ...(x.unreq ? { unreq: 1 } : {}),
    }));
  pruneExecs();
}
function pruneExecs() {
  S.execs.sort((a, b) => a.at - b.at);
  if (S.execs.length > EXEC_KEEP) S.execs = S.execs.slice(-EXEC_KEEP);
}
// Tapping a flow's button: an execution, requested (only while tracking is set up; otherwise
// the tap is just remembered on the flow, as before).
function startExec(flowId, q) {
  if (!S.track || !S.flows.some(f => f.id === flowId)) return null;
  const x = {
    id: uid(),
    flow: flowId,
    q: okRef(q) ? q : '',
    at: Date.now(),
    status: 'requested',
    msg: '',
    upd: Date.now(),
    ref: '',
    ev: [],
  };
  S.execs.push(x);
  pruneExecs();
  return x;
}
// Unconfirmed: requested or running, and nothing heard for a day.
const execStale = x => !EXEC_TERMINAL.includes(x.status) && Date.now() - x.upd > EXEC_STALE;
const execState = x => (execStale(x) ? 'unconfirmed' : x.status);
const EXEC_GLYPH = {
  requested: '…',
  running: '…',
  succeeded: '✓',
  failed: '✗',
  cancelled: '–',
  unconfirmed: '?',
};
const EXEC_WORD = {
  requested: 'Launched, no word yet',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  unconfirmed: 'Unconfirmed',
};
// One line about an execution: "Succeeded Today 09:20" / "Failed Today 09:20: message".
function execLine(x) {
  const st = execState(x),
    when = x.status === 'requested' ? x.at : x.upd;
  return `<span class="xst x-${st}">${EXEC_GLYPH[st]} ${EXEC_WORD[st]}</span> ${esc(whenLabel(when))}${x.msg ? ': ' + esc(x.msg) : ''}`;
}
// The newest execution of a flow (for a task, if given; since a time, if given). `exact`:
// only executions with that task (none, when q is empty), rather than any.
function latestExec(flow, q, since = 0, exact = false) {
  return (
    S.execs
      .filter(x => x.flow === flow && (exact ? x.q === (q || '') : !q || x.q === q) && x.at >= since)
      .sort((a, b) => b.at - a.at)[0] || null
  );
}
// Failures not yet acknowledged (shown on Today as one chip).
const execFailures = () => S.execs.filter(x => x.status === 'failed' && !x.ack);

/* reports from the server: pulled after each sync, folded in by row id */
async function pullExecEvents() {
  if (!sb || !session || !sb.from) return;
  let changed = false,
    last = 0;
  try {
    // A first pull on this device starts after the reports already folded into the records
    // it has (from other devices): older ones would only make records of their own again for
    // executions long pruned.
    if (!sync2.execSeq) sync2.execSeq = Math.max(0, ...S.execs.flatMap(x => x.ev.map(e => e.i)));
    const { data, error } = await sb
      .from('cockpit_exec_events')
      .select('id,execution,flow,status,message,run_ref,reported_at')
      .gt('id', sync2.execSeq)
      .order('id')
      .limit(500);
    if (error || !Array.isArray(data)) return; // (the table isn't set up yet, or offline)
    for (const ev of data) {
      if (foldExecEvent(ev)) changed = true;
      last = Math.max(last, Number(ev.id));
    }
  } catch (e) {
    return;
  }
  if (changed) {
    save();
    inBackground(renderAll);
    if (execFailures().length) beep([330, 220]);
  }
  // The cursor moves only once what was folded is saved: a save that failed (no room) leaves
  // the reports to be fetched again.
  if (last && (!changed || localSaved)) {
    sync2.execSeq = Math.max(sync2.execSeq || 0, last);
    saveSyncState();
  }
}
// One report into the records. Returns whether anything changed. The rules: a report already
// folded (by its row id) is skipped; a result (succeeded, failed, cancelled) is final for an
// execution, so an older "running" arriving later doesn't undo it; a result after a result
// takes the later one; a report with no execution gets an execution of its own.
function foldExecEvent(ev) {
  const id = Number(ev.id),
    status = EXEC_STATUS.includes(ev.status) ? ev.status : null,
    t = Date.parse(ev.reported_at) || Date.now(),
    msg = cleanText(typeof ev.message === 'string' ? ev.message : '').slice(0, 300),
    flow = okRef(ev.flow) ? ev.flow : null,
    ref = typeof ev.run_ref === 'string' ? ev.run_ref.slice(0, 60) : '';
  if (!Number.isFinite(id) || !status || !flow) return false;
  if (S.execs.some(x => x.ev.some(e => e.i === id))) return false;
  // Its execution: the one named, else the one an earlier report with the same run_ref went
  // to, else one of its own (named by the row, so every device names it the same).
  let x = okRef(ev.execution) ? S.execs.find(y => y.id === ev.execution) : null;
  if (!x && !okRef(ev.execution) && ref) x = S.execs.find(y => y.flow === flow && y.ref === ref) || null;
  const xid = okRef(ev.execution) ? ev.execution : x ? x.id : 'u' + id;
  if (!x) {
    x = { id: xid, flow, q: '', at: t, status, msg, upd: t, ref: '', ev: [], unreq: 1 };
    S.execs.push(x);
  }
  if (ref && !x.ref) x.ref = ref;
  // (when its current result was reported, if it has one: a later result replaces it, an
  // earlier one, arriving late, doesn't)
  const resAt = Math.max(0, ...x.ev.filter(e => EXEC_TERMINAL.includes(e.s)).map(e => e.t));
  x.ev.push({ i: id, t, s: status, m: msg });
  if (x.ev.length > EXEC_EVENTS) x.ev = x.ev.slice(-EXEC_EVENTS);
  const final = EXEC_TERMINAL.includes(x.status);
  if (!final || (EXEC_TERMINAL.includes(status) && t >= resAt)) {
    x.status = status;
    x.msg = msg;
    x.upd = Math.max(x.upd, t);
    if (status === 'failed') delete x.ack;
    // A result: the workflow stage waiting on this execution moves on, and rules hear of it.
    if (EXEC_TERMINAL.includes(status)) {
      const f = S.flows.find(y => y.id === flow);
      emitEvent({
        k: 'exec_' + status,
        key: 'exec:' + xid + ':' + status + ':' + id,
        exec: xid,
        flow,
        name: f ? f.name : flow,
        msg,
        q: x.q,
      });
    }
  }
  pruneExecs();
  return true;
}

/* the token: made in Settings, kept on this device to show again; S.track (synced) says the
   account tracks executions, so every device records a tap as an execution */
async function newExecToken() {
  const { data, error } = await sb.rpc('cockpit_new_exec_token');
  if (error || typeof data !== 'string')
    return toast("Couldn't create a token. Run the updated supabase-setup.sql", false, 4000);
  execToken = data;
  try {
    localStorage.setItem(EXEC_KEY, data);
  } catch (e) {}
  S.track = true;
  panels.xsetup = true;
  save();
  if (typeof listen === 'function' && !liveExec) listen(); // (reports arrive live from now on)
  renderAccount();
}
async function revokeExecToken() {
  const { error } = await sb.rpc('cockpit_revoke_exec_token');
  if (error) return toast("Couldn't revoke it. Run the updated supabase-setup.sql", false, 4000);
  execToken = '';
  try {
    localStorage.removeItem(EXEC_KEY);
  } catch (e) {}
  S.track = false;
  save();
  renderAccount();
  toast('Token revoked: reports are refused from now on');
}
function renderExecSettings() {
  let h = '<h2 style="margin-top:26px" id="execsec">Automation result tracking</h2>';
  h +=
    '<p class="hint" style="margin:0 0 8px">A desktop automation\'s button can only ask Power Automate Desktop to run it; the app can\'t see what happened. With a tracking token, the automation (or a PowerShell script) reports Running, Succeeded or Failed back, and each attempt shows its real result. The token can do nothing else: it can\'t read or change anything.</p>';
  if (!S.track && !execToken) return h + '<button class="btn" id="xnew">Create execution token</button>';
  if (S.track && !execToken)
    h +=
      '<p class="hint" style="margin:0 0 8px">Tracking is on; the token was made on another device. Make a new one here to see it (the old one stops working).</p>';
  const row = (label, value, id) =>
    `<div class="caprow"><span>${label}</span><code>${esc(value)}</code><button class="linkbtn" data-copy="${id}">Copy</button></div>`;
  h += `<details id="xsetup"${panels.xsetup ? ' open' : ''}><summary>Set up reporting</summary>`;
  if (execToken)
    h +=
      row('Report URL', execReportUrl(), 'xurl') +
      row('apikey header', CFG.supabaseAnonKey, 'key') +
      row('token', execToken, 'xtoken');
  h += S.flows.length
    ? `<p class="hint" style="margin:8px 0 2px">Flow ids (the <code>flow</code> value):</p>${S.flows.map(f => `<div class="caprow"><span>${esc(f.name)}</span><code>${esc(f.id)}</code></div>`).join('')}`
    : '<p class="hint">Add a desktop automation under Knowledge > Processes first.</p>';
  h += `<p class="hint">POST JSON <code>{"token":"…","flow":"<id>","status":"running|succeeded|failed|cancelled","message":"…"}</code> to the report URL with the apikey header. The report is matched to the newest launch of that flow still waiting to hear. Power Automate Desktop and PowerShell examples are in the README.</p>
    <div class="acts"><button class="btn" id="xnew">${execToken ? 'New token' : 'Create token'}</button><button class="btn" id="xrevoke">Revoke</button></div></details>`;
  return h;
}

/* showing executions */
// The newest execution's state on a flow's chip (Today) and row (Knowledge > Flows).
function flowStatus(f) {
  const x = latestExec(f.id);
  return x
    ? `<small class="xst x-${execState(x)}" title="${esc(EXEC_WORD[execState(x)] + ' ' + whenLabel(x.upd))}">${EXEC_GLYPH[execState(x)]}</small>`
    : '';
}
function flowStatusLine(f) {
  const x = latestExec(f.id);
  if (!x) return S.track ? '<span class="hint">No launches yet</span>' : '';
  return `${execLine(x)} <button class="linkbtn" data-xdet="${x.id}">Attempt details</button>`;
}
// Executions of a flow, newest first, in a sheet.
function openExecHistory(flowId) {
  const f = S.flows.find(x => x.id === flowId),
    xs = S.execs
      .filter(x => x.flow === flowId)
      .sort((a, b) => b.at - a.at)
      .slice(0, 30);
  if (!f) return;
  popSheet(
    `<h2 id="sheettitle">${esc(f.name)}</h2><p class="hint qahint">${xs.length ? plural(xs.length, 'launch') + (S.track ? '' : ' (tracking is off)') : S.track ? 'No launches recorded yet.' : 'Tracking is off: turn it on under Settings > Automations and integrations.'}${
      !navigator.onLine ? ' Offline: as last synced.' : ''
    }</p><div class="qalist">${xs
      .map(
        x =>
          `<button class="qact" type="button" data-xdet="${x.id}">${execLine(x)}${x.q ? `<small>${esc(questName(x.q))}</small>` : ''}</button>`,
      )
      .join(
        '',
      )}</div><div class="acts"><button class="btn" type="button" data-sheetclose="1">Close</button></div>`,
    { labelledBy: 'sheettitle' },
  );
}
const questName = id => {
  const r = find(id) || find(id, S.later);
  return r ? r.n.text : 'a task since removed';
};
function execSummary(x) {
  const f = S.flows.find(y => y.id === x.flow);
  return [
    `Flow: ${f ? f.name : x.flow} (${x.flow})`,
    `Attempt: ${x.id}${x.ref ? ' · run ' + x.ref : ''}`,
    `Launched: ${new Date(x.at).toLocaleString()}`,
    `Status: ${EXEC_WORD[execState(x)]}${x.msg ? ': ' + x.msg : ''}`,
    ...x.ev.map(e => `  ${new Date(e.t).toLocaleString()} ${e.s}${e.m ? ': ' + e.m : ''}`),
  ].join('\n');
}
// One execution: what was reported, when, and what to do about it.
function openExecDetail(id) {
  const x = S.execs.find(y => y.id === id);
  if (!x) return;
  const f = S.flows.find(y => y.id === x.flow),
    st = execState(x);
  popSheet(
    `<h2 id="sheettitle">${esc(f ? f.name : 'Automation ' + x.flow)}</h2><p class="xhead">${execLine(x)}</p><p class="hint qahint">Launched ${esc(whenLabel(x.at))}${x.unreq ? ' (reported by the automation, not launched here)' : ''}${x.q ? ' · for ' + esc(questName(x.q)) : ''}${
      st === 'unconfirmed'
        ? '. Nothing was reported: the automation may not have started, or its report never arrived.'
        : ''
    }${!navigator.onLine ? ' · Offline: as last synced.' : ''}</p>${
      x.ev.length
        ? `<ul class="flist">${x.ev
            .slice()
            .reverse()
            .map(
              e =>
                `<li><small>${esc(whenLabel(e.t))}</small><span><b>${EXEC_WORD[e.s]}</b>${e.m ? ': ' + esc(e.m) : ''}</span></li>`,
            )
            .join('')}</ul>`
        : '<p class="hint">No reports yet.</p>'
    }<div class="qalist">${
      f
        ? `<a class="qact go" href="${esc(f.url)}" data-flow="${f.id}"${x.q ? ` data-q="${x.q}"` : ''}>&#9654; Run again<small>Launches the flow once more</small></a>`
        : ''
    }${x.status === 'failed' ? `<button class="qact" type="button" data-xinbox="${x.id}">Add to the Inbox<small>To look into it later</small></button>` : ''}<button class="qact" type="button" data-xcopy="${x.id}">Copy a summary</button>${
      x.status === 'failed' && !x.ack
        ? `<button class="qact" type="button" data-xack="${x.id}">Acknowledge<small>Keeps the record, clears the flag</small></button>`
        : ''
    }</div><div class="acts"><button class="btn" type="button" data-sheetclose="1">Close</button></div>`,
    { labelledBy: 'sheettitle' },
  );
}
function execClick(d, b) {
  if (d.xhist) return openExecHistory(d.xhist);
  if (d.xdet) return openExecDetail(d.xdet);
  if (d.xcopy) {
    const x = S.execs.find(y => y.id === d.xcopy);
    if (x) copyText(execSummary(x));
    return;
  }
  if (d.xack) {
    const x = S.execs.find(y => y.id === d.xack);
    if (x) {
      x.ack = 1;
      save();
      renderAll();
    }
    return;
  }
  if (d.xinbox) {
    const x = S.execs.find(y => y.id === d.xinbox),
      f = x && S.flows.find(y => y.id === x.flow);
    if (!x) return;
    const text = `Automation failed: ${f ? f.name : x.flow}`;
    S.inbox.unshift({
      id: uid(),
      text: text.slice(0, 200),
      node: fix({ id: uid(), text: text.slice(0, 200), notes: execSummary(x) }),
    });
    x.ack = 1;
    save();
    renderAll();
    toast('Added to inbox');
    return;
  }
  if (b && b.id === 'xnew') {
    if (execToken && !arm(b, 'Replace it?')) return;
    newExecToken();
  }
  if (b && b.id === 'xrevoke' && arm(b, 'Revoke?')) revokeExecToken();
}
