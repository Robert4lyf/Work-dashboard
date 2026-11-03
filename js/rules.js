/* rules (Release C): "when this happens, do that", from short lists of both. A rule runs on the
   device where the event happens, while the app is open: there is no scheduler in the
   background and nothing runs on a server. (A day-of-week rule fires when the app is first
   opened that day; a day it isn't opened is skipped, and said so.) What a rule makes is named
   the same on every device (from the rule and the event), so two devices seeing the same event
   make one thing, and the rule's log (synced) stops the second from doing it again. Things a
   rule made never trigger a rule (no loops), and each rule fires at most RULE_DAY_MAX times a
   day, all rules RULES_DAY_MAX.
   Rule: { id, name, on: { k, ...filter }, do: { k, ...what }, enabled, at }.
   Log: { id (rule + event key), r, t, k, key, out: done|dup|limit|err, m }. */
const RULE_ON = {
  quest_done: 'A task is finished',
  exec_failed: 'A desktop automation reports a failure',
  exec_succeeded: 'A desktop automation reports success',
  wrun_failed: 'A process fails',
  wrun_succeeded: 'A process completes',
  wf_due: 'A recurring process is due',
  proc_finished: 'A guide is finished',
  wait_resolved: 'A waiting item is resolved',
  wait_due: 'A waiting item’s chase date comes',
  day: 'The app is opened on a day of the week',
};
// When each trigger can actually fire: on the device where the event happens, while the app is
// open. Nothing runs in the background or on a server; the day and chase-date triggers check
// when the app is first opened that day.
const RULE_WHEN = {
  quest_done: 'Runs the moment a task is finished, on the device it happens on, while the app is open.',
  exec_failed:
    'Runs when the automation’s report reaches the app (it pulls reports while open), not in the background.',
  exec_succeeded:
    'Runs when the automation’s report reaches the app (it pulls reports while open), not in the background.',
  wrun_failed: 'Runs when the process fails, on the device it happens on, while the app is open.',
  wrun_succeeded: 'Runs when the process completes, on the device it happens on, while the app is open.',
  wf_due:
    'Checks when the app is first opened on a day the process repeats; a day the app isn’t opened is skipped.',
  proc_finished: 'Runs when the guide is finished, on the device it happens on, while the app is open.',
  wait_resolved: 'Runs when the reply is marked received, on the device it happens on.',
  wait_due:
    'Checks when the app is first opened on or after the chase date; it does not run in the background.',
  day: 'Checks when the app is first opened on the chosen days; a day the app isn’t opened is skipped. It never runs in the background.',
};
// Starter rules, each one the engine can really do (nothing here needs a server).
const RULE_TEMPLATES = [
  {
    name: 'When a process fails, add an Inbox item',
    why: 'So a failed run is waiting for you in the Inbox, with the error.',
    on: { k: 'wrun_failed' },
    do: { k: 'inbox', text: 'Look at {name}: {err}' },
  },
  {
    name: 'When an automation fails, flag it in the Inbox',
    why: 'So a failed desktop automation is sorted with the rest of your work.',
    on: { k: 'exec_failed' },
    do: { k: 'inbox', text: 'Check {name}: {err}' },
  },
  {
    name: 'When a reply arrives, add the next step to the Inbox',
    why: 'So resolving a waiting item leaves the follow-on action to sort.',
    on: { k: 'wait_resolved' },
    do: { k: 'inbox', text: 'Next step after {name}' },
  },
  {
    name: 'When a recurring process is due, add a task for it to Today',
    why: 'The run is made ready anyway; this puts the day’s work on the list too.',
    on: { k: 'wf_due' },
    do: { k: 'quest', text: 'Do {name}' },
  },
  {
    name: 'When a chase date comes, add a reminder to the Inbox',
    why: 'So the person to chase is in front of you when you sort the Inbox.',
    on: { k: 'wait_due' },
    do: { k: 'inbox', text: 'Chase {who} about {name}' },
  },
];
function openRuleTemplates() {
  popSheet(
    `<h2 id="sheettitle">New rule</h2><p class="hint qahint">Start from one of these (you can change it), or from scratch. Rules run while the app is open: nothing runs in the background.</p><div class="qalist newlist">${RULE_TEMPLATES.map(
      (t, i) =>
        `<button class="qact" data-ruletpl="${i}"><b>${esc(t.name)}</b><small>${esc(t.why)}</small></button>`,
    ).join(
      '',
    )}<button class="qact" data-rulescratch="1"><b>From scratch</b><small>Choose the trigger and the action yourself.</small></button></div><div class="acts"><button class="btn" type="button" data-sheetclose="1">Cancel</button></div>`,
    { labelledBy: 'sheettitle' },
  );
}
// What the rule would have done, worked out from the records and nothing else: the recent events
// that fit, and the text it would have made for them. Nothing is created, launched or sent.
function rulePreview(r) {
  const cut = Date.now() - 30 * 864e5,
    dcut = shift(today(), -30),
    o = r.on,
    evs = [],
    hit = ev => ruleMatches(r, ev);
  if (o.k === 'quest_done')
    S.log.forEach(
      l =>
        l.d >= dcut &&
        hit({ k: o.k, text: l.text, top: !l.trail.length, p: l.p }) &&
        evs.push({ k: o.k, text: l.text, name: l.text }),
    );
  if (o.k === 'exec_failed' || o.k === 'exec_succeeded')
    S.execs.forEach(x => {
      const f = S.flows.find(y => y.id === x.flow);
      if (x.upd > cut && x.status === o.k.slice(5) && hit({ k: o.k, flow: x.flow }))
        evs.push({ k: o.k, flow: x.flow, name: f ? f.name : x.flow, msg: x.msg, err: x.msg });
    });
  if (o.k === 'wrun_failed' || o.k === 'wrun_succeeded')
    S.wruns.forEach(
      x =>
        x.at > cut &&
        x.status === o.k.slice(5) &&
        hit({ k: o.k, wf: x.wf }) &&
        evs.push({ k: o.k, wf: x.wf, name: x.name, err: x.err }),
    );
  if (o.k === 'wf_due')
    S.wruns.forEach(
      x =>
        x.started > cut &&
        x.id.startsWith(x.wf + '-20') &&
        hit({ k: o.k, wf: x.wf }) &&
        evs.push({ k: o.k, wf: x.wf, name: x.name }),
    );
  if (o.k === 'proc_finished')
    S.runs.forEach(x => {
      const a = procOf(x.art);
      if (x.fin > cut && hit({ k: o.k, art: x.art }))
        evs.push({ k: o.k, art: x.art, name: a ? a.title : 'guide' });
    });
  if (o.k === 'wait_resolved')
    S.follows.forEach(f => {
      if (f.t > cut && f.k === 'resolve') {
        const n = findWaitable(f.n).n;
        evs.push({ k: o.k, node: f.n, name: n ? n.text : 'a waiting item', text: n ? n.text : '' });
      }
    });
  if (o.k === 'wait_due')
    waitingNodes().forEach(
      x =>
        x.n.wait.due &&
        x.n.wait.due <= today() &&
        evs.push({ k: o.k, node: x.n.id, name: x.trail[0] || x.n.text, who: x.n.wait.who }),
    );
  if (o.k === 'day') (o.days || []).forEach(d => evs.push({ k: o.k, wd: d, name: WD[d] }));
  const a = r.do,
    made = ev =>
      a.k === 'note'
        ? 'a log entry'
        : a.k === 'notify'
          ? `a notification: “${ruleFill(a.text, ev) || r.name}”`
          : a.k === 'wrun'
            ? `a run of ${(wfById(a.wf) || {}).name || 'a removed process'}, ready to start`
            : a.k === 'wait'
              ? `a waiting item on ${ruleFill(a.who, ev) || 'someone'}: “${ruleFill(a.text, ev) || r.name}”`
              : `${a.k === 'inbox' ? 'an Inbox item' : 'a task on Today'}: “${ruleFill(a.text, ev) || r.name}”`;
  return {
    n: evs.length,
    samples: evs.slice(0, 3).map(made),
    day: o.k === 'day',
    days: o.k === 'day' ? (o.days || []).map(d => WD[d]) : [],
  };
}
const RULE_DO = {
  inbox: 'Add an Inbox item',
  quest: 'Add a task to Today',
  wait: 'Add a waiting item (Inbox)',
  wrun: 'Prepare a process (ready, not started)',
  notify: 'Show a notification on this device',
  note: 'Only note it in the rule’s log',
};
const RULE_DAY_MAX = 20,
  RULES_DAY_MAX = 60,
  RLOG_KEEP = 300,
  RLOG_DAYS = 90,
  RULES_MAX = 40;
const ruleTxt = (v, max) => txt(v, max);
function cleanRule(r) {
  if (!r || typeof r !== 'object' || !okRef(r.id) || !r.on || !r.do) return null;
  if (!RULE_ON[r.on.k] || !RULE_DO[r.do.k]) return null;
  const on = { k: r.on.k },
    o = r.on,
    d = r.do,
    act = { k: d.k };
  if (typeof o.match === 'string' && o.match.trim()) on.match = ruleTxt(o.match, 80);
  if (o.top) on.top = true;
  if (okRef(o.flow)) on.flow = o.flow;
  if (okRef(o.wf)) on.wf = o.wf;
  if (okRef(o.art)) on.art = o.art;
  if (on.k === 'day')
    on.days = (Array.isArray(o.days) ? o.days : [])
      .map(Number)
      .filter(x => Number.isInteger(x) && x >= 0 && x <= 6);
  if (['inbox', 'quest', 'wait', 'notify', 'note'].includes(act.k)) act.text = ruleTxt(d.text, 160);
  if (act.k === 'wait') {
    act.who = ruleTxt(d.who, 60);
    act.days = Number.isInteger(+d.days) && +d.days >= 0 ? Math.min(+d.days, 60) : 2;
  }
  if (act.k === 'quest' && Number.isFinite(+d.est) && +d.est > 0)
    act.est = Math.min(Math.round(+d.est), 1440);
  if (act.k === 'wrun') act.wf = okRef(d.wf) ? d.wf : '';
  return {
    id: r.id,
    name: ruleTxt(r.name, 80) || 'Rule',
    on,
    do: act,
    enabled: r.enabled !== false,
    at: Number.isFinite(+r.at) ? +r.at : 0,
  };
}
function normRules() {
  S.rules = (Array.isArray(S.rules) ? S.rules : []).map(cleanRule).filter(Boolean).slice(0, RULES_MAX);
  S.rlog = (Array.isArray(S.rlog) ? S.rlog : [])
    .filter(l => l && typeof l === 'object' && okRef(l.id) && okRef(l.r) && Number.isFinite(+l.t))
    .map(l => ({
      id: l.id,
      r: l.r,
      t: +l.t,
      k: ruleTxt(l.k, 20),
      key: ruleTxt(l.key, 80),
      out: ['done', 'dup', 'limit', 'err'].includes(l.out) ? l.out : 'err',
      m: ruleTxt(l.m, 200),
    }));
  pruneRlog();
}
function pruneRlog() {
  const cut = Date.now() - RLOG_DAYS * 864e5;
  S.rlog = S.rlog.filter(l => l.t > cut);
  if (S.rlog.length > RLOG_KEEP) S.rlog = S.rlog.sort((a, b) => a.t - b.t).slice(-RLOG_KEEP);
}
const ruleById = id => S.rules.find(r => r.id === id) || null;
// Does the event fit the rule's trigger?
function ruleMatches(r, ev) {
  const o = r.on;
  if (o.k !== ev.k) return false;
  if (
    o.match &&
    !String(ev.text || ev.name || '')
      .toLowerCase()
      .includes(o.match.toLowerCase())
  )
    return false;
  if (o.top && !ev.top) return false;
  if (o.flow && ev.flow !== o.flow) return false;
  if (o.wf && ev.wf !== o.wf) return false;
  if (o.art && ev.art !== o.art) return false;
  if (o.k === 'day' && !(o.days || []).includes(ev.wd)) return false;
  return true;
}
// The words in a rule's text: {name} (the task, flow or workflow), {err}, {day}, {who}.
function ruleFill(t, ev) {
  const name = ev.name || ev.text || '',
    err = ev.err || ev.msg || '';
  return cleanText(
    String(t || '')
      .replace(/\{name\}/g, name)
      .replace(/\{err\}/g, err)
      .replace(/\{day\}/g, dayLabel(today()))
      .replace(/\{who\}/g, ev.who || ''),
  )
    .trim()
    .slice(0, 200);
}
function onRuleEvent(ev) {
  if (ev.byRule) return; // (made by a rule: never a trigger)
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime(),
    todayLog = S.rlog.filter(l => l.t >= dayStart && l.out === 'done');
  S.rules.forEach(r => {
    if (!r.enabled || !ruleMatches(r, ev)) return;
    const id = keyId('rl:' + r.id + '|' + ev.key);
    if (S.rlog.some(l => l.id === id)) return; // (this event, seen: here or on another device)
    const entry = { id, r: r.id, t: Date.now(), k: ev.k, key: ev.key.slice(0, 80), out: 'done', m: '' };
    if (todayLog.filter(l => l.r === r.id).length >= RULE_DAY_MAX || todayLog.length >= RULES_DAY_MAX) {
      entry.out = 'limit';
      entry.m = 'daily limit reached';
    } else {
      try {
        entry.m = ruleAct(r, ev, id);
        todayLog.push(entry);
      } catch (x) {
        entry.out = 'err';
        entry.m = String((x && x.message) || x).slice(0, 200);
      }
    }
    S.rlog.push(entry);
  });
  pruneRlog();
}
// The one thing a rule does. Returns a word about it for the log. Everything made here is
// named by `id` (the rule and the event), so another device makes the same, not a second.
function ruleAct(r, ev, id) {
  const a = r.do,
    text = ruleFill(a.text, ev) || r.name;
  if (a.k === 'note') return text;
  if (a.k === 'notify') {
    notify(r.name, text);
    return 'notified: ' + text;
  }
  if (a.k === 'inbox') {
    if (S.inbox.some(i => i.id === id) || (sync2.gone && sync2.gone['inbox:' + id])) return 'already there';
    S.inbox.unshift({ id, text, byRule: 1 });
    return 'inbox: ' + text;
  }
  if (a.k === 'wait') {
    if (S.inbox.some(i => i.id === id) || (sync2.gone && sync2.gone['inbox:' + id])) return 'already there';
    S.inbox.unshift({
      id,
      text,
      byRule: 1,
      wait: { who: ruleFill(a.who, ev), note: '', due: shift(today(), a.days), since: today() },
    });
    addFollow(id, 'start');
    return 'waiting on ' + (ruleFill(a.who, ev) || 'someone') + ': ' + text;
  }
  if (a.k === 'quest') {
    if (find(id) || find(id, S.later) || (sync2.gone && sync2.gone['quest:' + id])) return 'already there';
    const q = fix({ id, text, byRule: 1 });
    if (a.est) q.est = a.est;
    S.quests.push(q);
    return 'quest: ' + text;
  }
  if (a.k === 'wrun') {
    const w = wfById(a.wf);
    if (!w || w.archived || !w.stages.length) throw new Error('that process is gone');
    const rid = w.id + '-r' + id;
    if (S.wruns.some(x => x.id === rid) || (sync2.gone && sync2.gone['wrun:' + rid])) return 'already there';
    S.wruns.push(makeRun(w, { id: rid, prepared: true, byRule: true }));
    return 'prepared: ' + w.name;
  }
  throw new Error('unknown action');
}
/* the day's events (from the daily reset): the weekday, and chase dates that have come */
function rolloverRules(d) {
  const [y, m, dd] = d.split('-').map(Number),
    wd = new Date(y, m - 1, dd).getDay();
  emitEvent({ k: 'day', key: 'day:' + d, wd, name: WD[wd] });
  waitingNodes().forEach(x => {
    const w = x.n.wait;
    if (w.due && w.due <= d)
      emitEvent({
        k: 'wait_due',
        key: 'chase:' + x.n.id + ':' + w.due,
        node: x.n.id,
        text: x.n.text,
        who: w.who,
        name: x.trail[0] || x.n.text, // (the task, for a waiting step)
      });
  });
}
/* what a rule would have done: the recent events it would have matched, counted from the records */
function rulePreviewCount(r) {
  const cut = Date.now() - 30 * 864e5,
    dcut = shift(today(), -30),
    o = r.on;
  const hit = ev => ruleMatches(r, ev);
  if (o.k === 'quest_done')
    return S.log.filter(l => l.d >= dcut && hit({ k: o.k, text: l.text, top: !l.trail.length, p: l.p }))
      .length;
  if (o.k === 'exec_failed' || o.k === 'exec_succeeded')
    return S.execs.filter(x => x.upd > cut && x.status === o.k.slice(5) && hit({ k: o.k, flow: x.flow }))
      .length;
  if (o.k === 'wrun_failed' || o.k === 'wrun_succeeded')
    return S.wruns.filter(x => x.at > cut && x.status === o.k.slice(5) && hit({ k: o.k, wf: x.wf })).length;
  if (o.k === 'wf_due')
    return S.wruns.filter(x => x.started > cut && x.id.startsWith(x.wf + '-20') && hit({ k: o.k, wf: x.wf }))
      .length;
  if (o.k === 'proc_finished') return S.runs.filter(x => x.fin > cut && hit({ k: o.k, art: x.art })).length;
  if (o.k === 'wait_resolved') return S.follows.filter(f => f.t > cut && f.k === 'resolve').length;
  if (o.k === 'wait_due') return waitingNodes().filter(x => x.n.wait.due && x.n.wait.due <= today()).length;
  if (o.k === 'day') return (o.days || []).length * 4;
  return 0;
}
const lc = s => s.charAt(0).toLowerCase() + s.slice(1); // (mid-sentence)
const ruleOnLine = r => {
  const o = r.on;
  let s = RULE_ON[o.k];
  if (o.k === 'day') s = 'The app is opened on ' + ((o.days || []).map(d => WD[d]).join(', ') || 'no day');
  const f = [];
  if (o.match) f.push(`named like “${o.match}”`);
  if (o.top) f.push('a top-level task');
  if (o.flow) f.push('automation: ' + ((S.flows.find(x => x.id === o.flow) || {}).name || 'removed'));
  if (o.wf) f.push('process: ' + ((wfById(o.wf) || {}).name || 'removed'));
  if (o.art) f.push('guide: ' + ((S.kb.find(x => x.id === o.art) || {}).title || 'removed'));
  return s + (f.length ? ' (' + f.join(', ') + ')' : '');
};
const ruleDoLine = r => {
  const a = r.do;
  if (a.k === 'wrun') return 'prepare a run of ' + ((wfById(a.wf) || {}).name || 'a removed process');
  if (a.k === 'wait')
    return `add a waiting item on ${a.who || 'someone'}: “${a.text}” (chase in ${plural(a.days, 'day')})`;
  return RULE_DO[a.k].toLowerCase() + (a.text ? `: “${a.text}”` : '');
};
/* Settings: the list, each with its switch and log; the editor sheet */
let ruleEdit = null;
function renderRuleSettings() {
  let h = `<h2 style="margin-top:26px" id="rulesec">Rules</h2><p class="hint">When something happens, do one thing. A rule runs on the device where the thing happens, while Work Dashboard is open: nothing runs in the background or on a server. What a rule makes is named the same on every device, so it isn't made twice.</p>`;
  if (S.rules.length)
    h += `<div class="list box">${S.rules
      .map(r => {
        const logs = S.rlog.filter(l => l.r === r.id).sort((a, b) => b.t - a.t),
          last = logs[0];
        return `<div class="row rulerow${r.enabled ? '' : ' off'}"><button class="open" data-ruleedit="${r.id}"><span>${esc(r.name)}</span><small>When ${esc(lc(ruleOnLine(r)))}, ${esc(ruleDoLine(r))}.</small><small class="rulewhen">${esc(RULE_WHEN[r.on.k])}</small><small>${
          last
            ? `Last ran ${esc(whenLabel(last.t))}: ${last.out === 'done' ? '<span class="ok">ok</span>' : last.out === 'err' ? '<span class="late">error</span>' : esc(last.out)}${last.m ? ' · ' + esc(last.m) : ''}`
            : 'Has not run yet'
        }${logs.length ? ` · ${plural(logs.length, 'time')} in ${RLOG_DAYS} days` : ''}${r.enabled ? '' : ' · off'}</small></button><button class="btn sm ${r.enabled ? 'green' : ''}" data-ruleon="${r.id}" aria-pressed="${r.enabled}" aria-label="${r.enabled ? 'On' : 'Off'}: ${esc(r.name)}">${r.enabled ? 'On' : 'Off'}</button></div>`;
      })
      .join('')}</div>`;
  h += `<div class="acts"><button class="btn" data-rulenew="1">Add rule</button></div>`;
  if (!S.rules.length)
    h += `<p class="hint">Examples: when a process fails, add an Inbox item; when a chase date comes, add a reminder. Add rule shows them.</p>`;
  const log = S.rlog
    .slice()
    .sort((a, b) => b.t - a.t)
    .slice(0, 30);
  if (log.length)
    h += `<details id="rlogd"${panels.rlogd ? ' open' : ''}><summary>Rule log <small>${S.rlog.length}</small></summary><ul class="flist">${log
      .map(
        l =>
          `<li><small>${esc(whenLabel(l.t))}</small><span><b>${esc((ruleById(l.r) || {}).name || 'removed rule')}</b> · ${esc(RULE_ON[l.k] || l.k)} · ${esc(l.out === 'done' ? l.m || 'done' : l.out + (l.m ? ': ' + l.m : ''))}</span></li>`,
      )
      .join('')}</ul></details>`;
  return h;
}
function openRuleEditor(id) {
  const r = id && ruleById(id);
  ruleEdit = r
    ? JSON.parse(JSON.stringify(r))
    : { id: '', name: '', on: { k: 'quest_done' }, do: { k: 'inbox', text: '' }, enabled: true };
  popSheet(ruleForm(), { labelledBy: 'sheettitle' });
  $('#rlname').focus();
}
function ruleForm() {
  const r = ruleEdit,
    o = r.on,
    a = r.do,
    sel = (id, list, cur, none) =>
      `<select class="fld" id="${id}">${none ? `<option value="">${none}</option>` : ''}${list.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`,
    flows = S.flows.map(f => [f.id, f.name]),
    wfs = S.workflows.filter(w => !w.archived).map(w => [w.id, w.name]),
    arts = S.kb.filter(x => x.steps && x.steps.length).map(x => [x.id, x.title]);
  let onFields = '';
  if (o.k === 'quest_done')
    onFields = `<label class="f" for="rlmatch">Only tasks named like <small class="hint">(optional)</small></label><input class="fld" id="rlmatch" maxlength="80" value="${esc(o.match || '')}" autocomplete="off"><label class="optbox"><input type="checkbox" id="rltop"${o.top ? ' checked' : ''}>Only top-level tasks</label>`;
  if (o.k === 'exec_failed' || o.k === 'exec_succeeded')
    onFields = `<label class="f" for="rlflow">Which automation</label>${sel('rlflow', flows, o.flow || '', 'Any automation')}`;
  if (['wrun_failed', 'wrun_succeeded', 'wf_due'].includes(o.k))
    onFields = `<label class="f" for="rlwf">Which process</label>${sel('rlwf', wfs, o.wf || '', 'Any process')}`;
  if (o.k === 'proc_finished')
    onFields = `<label class="f" for="rlart">Which guide</label>${sel('rlart', arts, o.art || '', 'Any guide')}`;
  if (o.k === 'wait_resolved' || o.k === 'wait_due')
    onFields = `<label class="f" for="rlmatch">Only items named like <small class="hint">(optional)</small></label><input class="fld" id="rlmatch" maxlength="80" value="${esc(o.match || '')}" autocomplete="off">`;
  if (o.k === 'day')
    onFields = `<p class="f">Days</p><div class="days">${WEEK.map(i => `<button class="day" type="button" data-rlday="${i}" aria-pressed="${(o.days || []).includes(i)}" aria-label="${WD[i]}">${WD[i].slice(0, 2)}</button>`).join('')}</div><p class="hint">Fires when the app is first opened that day; a day it isn't opened is skipped.</p>`;
  let doFields = '';
  if (['inbox', 'quest', 'wait', 'notify', 'note'].includes(a.k))
    doFields = `<label class="f" for="rltext">Text <small class="hint">({name}, {err}, {day}, {who} are filled in)</small></label><input class="fld" id="rltext" maxlength="160" value="${esc(a.text || '')}" autocomplete="off" placeholder="Check {name}">`;
  if (a.k === 'quest')
    doFields += `<label class="f" for="rlest">Estimate, minutes <small class="hint">(optional)</small></label><input class="fld" id="rlest" type="number" min="0" max="1440" value="${a.est || ''}">`;
  if (a.k === 'wait')
    doFields += `<label class="f" for="rlwho">Waiting on whom</label><input class="fld" id="rlwho" maxlength="60" value="${esc(a.who || '')}" list="wholist" autocomplete="off">${whoList()}<label class="f" for="rldays">Chase after, days</label><input class="fld" id="rldays" type="number" min="0" max="60" value="${a.days === undefined ? 2 : a.days}">`;
  if (a.k === 'wrun')
    doFields = `<label class="f" for="rlwrun">Which process</label>${sel('rlwrun', wfs, a.wf || '', wfs.length ? 'Choose' : 'No processes yet')}`;
  return `<form id="ruleform" data-id="${r.id}"><h2 id="sheettitle">${r.id ? 'Edit rule' : 'New rule'}</h2>
    ${hintBox('rule', 'A rule is one sentence: when this happens, do that. It runs on this device while the app is open, never in the background.')}<label class="f" for="rlname">Name</label><input class="fld" id="rlname" maxlength="80" value="${esc(r.name)}" autocomplete="off" required>
    <label class="f" for="rlon">When</label>${sel('rlon', Object.entries(RULE_ON), o.k)}<p class="hint rlwhen">${esc(RULE_WHEN[o.k])}</p>${onFields}
    <label class="f" for="rldo">Then</label>${sel('rldo', Object.entries(RULE_DO), a.k)}${doFields}
    <p class="hint rlprev">${rulePreviewLine(r)}</p>
    <div class="acts"><button class="btn sm" type="button" data-rulepreview="1" data-stay="1">Preview on recent records</button></div><div id="rldry" class="hint" aria-live="polite"></div>
    <div class="acts"><button class="btn green" id="sheetok">${r.id ? 'Save rule' : 'Add rule'}</button><button class="btn" type="button" data-sheetclose="1">Cancel</button></div>${
      r.id
        ? `<div class="links"><button class="dellink" type="button" data-ruledel="${r.id}">Delete rule</button></div>`
        : ''
    }</form>`;
}
// The editor's fields, read back into the draft (so a change of kind keeps the rest).
function readRuleForm() {
  const r = ruleEdit,
    v = id => ($(id) ? $(id).value : undefined);
  r.name = v('#rlname') ?? r.name;
  const onK = v('#rlon'),
    doK = v('#rldo');
  if (onK && onK !== r.on.k) r.on = { ...r.on, k: onK }; // (details kept: cleanRule keeps what fits)
  if (doK && doK !== r.do.k) r.do = { ...r.do, k: doK };
  if ($('#rlmatch')) r.on.match = v('#rlmatch');
  if ($('#rltop')) r.on.top = $('#rltop').checked;
  if ($('#rlflow')) r.on.flow = v('#rlflow');
  if ($('#rlwf')) r.on.wf = v('#rlwf');
  if ($('#rlart')) r.on.art = v('#rlart');
  if ($('#rltext')) r.do.text = v('#rltext');
  if ($('#rlest')) r.do.est = +v('#rlest') || 0;
  if ($('#rlwho')) r.do.who = v('#rlwho');
  if ($('#rldays')) r.do.days = +v('#rldays');
  if ($('#rlwrun')) r.do.wf = v('#rlwrun');
}
function rulePreviewLine(r) {
  const c = cleanRule({ ...r, id: r.id || 'x' }) || r,
    n = rulePreviewCount(c);
  return `When ${esc(lc(ruleOnLine(c)))}, ${esc(ruleDoLine(c))}.${c.on.k === 'day' ? '' : ` In the last 30 days this would have fired ${plural(n, 'time')}.`}`;
}
// The dry run: what the rule would have made for the recent events that fit. Nothing is made.
function showRulePreview() {
  if (!ruleEdit || !$('#ruleform')) return;
  readRuleForm();
  const c = cleanRule({ ...ruleEdit, id: ruleEdit.id || 'x' });
  const el = $('#rldry');
  if (!el) return;
  if (!c) return (el.textContent = "The rule isn't complete yet: choose what it does.");
  const pv = rulePreview(c);
  el.innerHTML = pv.day
    ? `<p>On ${pv.days.length ? esc(pv.days.join(', ')) : 'no day chosen'}, when the app is first opened that day, it would make ${pv.samples.length ? esc(pv.samples[0]) : 'nothing'}. Nothing was made now.</p>`
    : pv.n
      ? `<p>In the last 30 days it would have fired ${plural(pv.n, 'time')}, making for example:</p><ul class="ilines">${pv.samples.map(s => `<li>${esc(s)}</li>`).join('')}</ul><p>Nothing was made now: this is a preview of the records.</p>`
      : `<p>Nothing in the last 30 days would have fired it. Nothing was made now.</p>`;
}
function typedRuleForm() {
  if (!ruleEdit || !$('#ruleform')) return;
  readRuleForm();
  const p = $('#ruleform .rlprev');
  if (p) p.innerHTML = rulePreviewLine(ruleEdit);
}
function redrawRuleForm() {
  // (the "when it runs" line follows the trigger)
  readRuleForm();
  const f = $('#ruleform');
  if (f) f.outerHTML = ruleForm();
}
function saveRuleForm() {
  if (!ruleEdit) return closeSheet();
  readRuleForm();
  const r = cleanRule({ ...ruleEdit, id: ruleEdit.id || uid(), at: Date.now() });
  if (!r) return toast("That rule isn't complete", false, 3000);
  if (!ruleEdit.name.trim()) return toast('Give the rule a name', false, 3000);
  if (r.do.k === 'wrun' && !r.do.wf) return toast('Choose the process to prepare', false, 3000);
  if (['inbox', 'quest', 'wait'].includes(r.do.k) && !r.do.text) return toast('Say what to add', false, 3000);
  if (r.on.k === 'day' && !r.on.days.length) return toast('Choose at least one day', false, 3000);
  const cur = ruleById(r.id);
  if (cur) Object.assign(cur, r);
  else {
    if (S.rules.length >= RULES_MAX) return toast(`At most ${RULES_MAX} rules`, false, 3000);
    S.rules.push(r);
  }
  ruleEdit = null;
  closeSheet();
  save();
  renderAccount();
  toast('Rule saved');
}
function ruleClick(d, b) {
  if (d.rulenew) return openRuleTemplates();
  if (d.rulescratch) return openRuleEditor('');
  if (d.ruletpl !== undefined) {
    const t = RULE_TEMPLATES[+d.ruletpl];
    if (!t) return;
    ruleEdit = { id: '', name: t.name, on: { ...t.on }, do: { ...t.do }, enabled: true };
    popSheet(ruleForm(), { labelledBy: 'sheettitle' });
    $('#rlname').focus();
    return;
  }
  if (d.rulepreview) return showRulePreview();
  if (d.ruleedit) return openRuleEditor(d.ruleedit);
  if (d.ruleon) {
    const r = ruleById(d.ruleon);
    if (!r) return;
    r.enabled = !r.enabled;
    save();
    renderAccount();
    return toast(r.enabled ? 'Rule on' : 'Rule off');
  }
  if (d.ruledel) {
    const r = ruleById(d.ruledel);
    if (!r) return;
    if (!arm(b, 'Delete it?')) return;
    S.rules = S.rules.filter(x => x.id !== r.id);
    ruleEdit = null;
    closeSheet();
    save();
    renderAccount();
    return toast('Rule deleted');
  }
  if (d.rlday !== undefined && ruleEdit) {
    readRuleForm();
    const wd = +d.rlday,
      ds = ruleEdit.on.days || [];
    ruleEdit.on.days = ds.includes(wd) ? ds.filter(x => x !== wd) : [...ds, wd];
    redrawRuleForm();
  }
}
