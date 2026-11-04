// Release G performance datasets: deterministic saved data at four sizes, built in the page the
// way app.setState builds it (`s` is the saved data; dates are relative to the page's today(),
// and the page's shift() is used). Everything the generator needs is inside perfFill, because
// only its source goes to the page. A seeded random number generator makes every run the same.
// No pictures: those live in IndexedDB on their own.
//
//   const { datasets } = require('./perf/data');
//   await app.setState(datasets.busy);          // in a Playwright test
//   page.evaluate(`(${datasets.heavy})(s)`)     // or as source, with `s` in scope
//
// Sizes (what is generated; the app's own limits then prune some on load: executions are kept to
// the newest 150, finished workflow runs to the newest 120, the log to 120 days):
//   typical  25 tasks, a few waiting, scheduled and overdue, a Top 3
//   busy     100 tasks
//   heavy    300 tasks on Today, 1,000 finished in the log, 300 articles, 60 workflows with 400
//            runs, 500 automation executions with event histories, 400 waiting items and 400
//            follow-ups
//   extreme  heavy x2
const SIZES = {
  typical: {
    tasks: 25,
    later: 4,
    inbox: 6,
    waiting: 6,
    follows: 8,
    scheduled: 3,
    overdue: 3,
    log: 60,
    kb: 15,
    kbcats: 4,
    workflows: 4,
    wruns: 10,
    execs: 20,
    flows: 4,
    runs: 3,
    sessions: 40,
    interrupts: 10,
    rules: 2,
    rlog: 10,
    templates: 2,
  },
  busy: {
    tasks: 100,
    later: 12,
    inbox: 15,
    waiting: 40,
    follows: 60,
    scheduled: 8,
    overdue: 10,
    log: 250,
    kb: 60,
    kbcats: 8,
    workflows: 15,
    wruns: 80,
    execs: 100,
    flows: 10,
    runs: 10,
    sessions: 150,
    interrupts: 40,
    rules: 8,
    rlog: 60,
    templates: 4,
  },
  heavy: {
    tasks: 300,
    later: 40,
    inbox: 40,
    waiting: 400,
    follows: 400,
    scheduled: 20,
    overdue: 30,
    log: 1000,
    kb: 300,
    kbcats: 20,
    workflows: 60,
    wruns: 400,
    execs: 500,
    flows: 20,
    runs: 40,
    sessions: 600,
    interrupts: 120,
    rules: 20,
    rlog: 250,
    templates: 8,
  },
};
SIZES.extreme = Object.fromEntries(Object.entries(SIZES.heavy).map(([k, v]) => [k, v * 2]));
SIZES.extreme.scheduled = 30; // (a day only holds so many meetings)

// Fills `s` (the saved data, as app.setState hands it over) with a dataset of size `n`.
function perfFill(s, n) {
  // Seeded (mulberry32): the same dataset on every run.
  let seed = 0x5eed1234;
  const rnd = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1)),
    pick = a => a[Math.floor(rnd() * a.length)],
    chance = p => rnd() < p,
    t = today(),
    now = Date.now(),
    H = 3600e3,
    D = 864e5;
  const VERBS = [
    'Draft',
    'Review',
    'Send',
    'Check',
    'Update',
    'Prepare',
    'Agree',
    'Book',
    'Chase',
    'Finalise',
    'Reconcile',
    'Upload',
    'Approve',
    'Summarise',
    'Schedule',
    'Confirm',
    'Collect',
    'File',
  ];
  const THINGS = [
    'the Q4 budget report',
    'supplier contract renewal',
    'team rota for December',
    'client onboarding pack',
    'office move floor plan',
    'hiring pack for the analyst role',
    'website copy for the services page',
    'training plan',
    'audit evidence folder',
    'board pack appendix',
    'expense claims',
    'policy update on remote working',
    'newsletter',
    'customer data clean-up',
    'quarterly survey results',
    'Walsingham sale completion',
    'Fletcher Way lease',
    'Filbert Close maintenance quote',
    'finance queries from Megan',
    'VAT return',
    'payroll changes',
    'IT access requests',
    'health and safety checklist',
    'risk register',
    'project status update',
    'invoice batch 14',
    'vendor due diligence',
    'marketing calendar',
    'induction schedule',
    'monthly KPIs',
  ];
  const PEOPLE = ['Emily', 'Laura', 'Sam', 'Priya', 'Tom', 'IT', 'Finance', 'Legal', 'HR', 'the landlord'];
  const WORDS =
    'the a figures report draft supplier meeting agreed numbers checked totals before after month quarter team client contract notes follow review sent waiting reply approval sheet folder copy final version budget risk change request access invoice payment schedule plan update issue next steps owner deadline summary details attached shared drive spreadsheet row column column totals variance explained signed off pending outstanding'.split(
      ' ',
    );
  const sentence = (a, b) => {
    const w = [];
    for (let i = int(a, b); i > 0; i--) w.push(pick(WORDS));
    const x = w.join(' ');
    return x.charAt(0).toUpperCase() + x.slice(1) + '.';
  };
  const para = (a, b) => {
    const out = [];
    for (let i = int(a, b); i > 0; i--) out.push(sentence(8, 22));
    return out.join(' ');
  };
  const title = () => pick(VERBS) + ' ' + pick(THINGS);
  const TAGS = ['Design', 'Meetings', 'Admin', 'Delivery', ''];
  const leaf = (id, text, extra = {}) => ({ id, text, done: false, children: [], ...extra });

  // Tasks on Today, each with steps (a few without), some steps done.
  s.quests = [];
  for (let i = 0; i < n.tasks; i++) {
    const id = 'pq' + i,
      kids = chance(0.12) ? 0 : int(2, 7),
      children = [];
    for (let j = 0; j < kids; j++)
      children.push(
        leaf(id + 's' + j, pick(VERBS) + ' ' + pick(WORDS) + ' ' + pick(WORDS), {
          done: chance(0.35),
          ...(chance(0.08) ? { notes: para(1, 3) } : {}),
          ...(chance(0.05) ? { due: shift(t, int(-3, 6)) } : {}),
        }),
      );
    const q = {
      id,
      text: title() + (chance(0.3) ? ' (' + pick(PEOPLE) + ')' : ''),
      done: kids === 0 ? chance(0.1) : false,
      children,
      tag: pick(TAGS),
      since: shift(t, -int(0, 9)),
      ...(chance(0.3) ? { summary: para(1, 2).slice(0, 220) } : {}),
      ...(chance(0.2) ? { notes: para(2, 8) } : {}),
      ...(chance(0.25) ? { est: pick([15, 30, 45, 60, 90, 120]) } : {}),
      ...(chance(0.12) ? { due: shift(t, int(1, 14)) } : {}),
    };
    if (chance(0.05))
      q.resume = {
        note: sentence(6, 14),
        at: now - int(1, 30) * H,
        step: children.length ? children[0].id : '',
      };
    s.quests.push(q);
  }
  // Overdue and due today; scheduled meetings (today with times, a couple on earlier days).
  for (let i = 0; i < n.overdue; i++) s.quests[(i * 7 + 3) % n.tasks].due = shift(t, -int(0, 5));
  for (let i = 0; i < n.scheduled; i++) {
    const q = s.quests[(i * 11 + 5) % n.tasks];
    q.scheduled =
      i % 6 === 5
        ? { date: shift(t, -1) }
        : { date: t, ...(i % 3 ? { time: pad(8 + (i % 10)) + ':' + pick(['00', '15', '30', '45']) } : {}) };
  }

  // Waiting items: steps waiting on someone (on Today's tasks, on Upcoming), and Inbox items.
  const wait = () => ({
    who: pick(PEOPLE),
    note: '',
    due: shift(t, int(-4, 5)),
    since: shift(t, -int(1, 20)),
    ...(chance(0.4) ? { expect: shift(t, int(-3, 4)) } : {}),
    ...(chance(0.3) ? { last: shift(t, -int(0, 6)) } : {}),
  });
  const waitIds = [];
  const onToday = Math.round(n.waiting * 0.7),
    inInbox = Math.round(n.waiting * 0.2),
    onLater = n.waiting - onToday - inInbox;
  for (let i = 0; i < onToday; i++) {
    const q = s.quests[(i * 13 + 1) % n.tasks],
      id = q.id + 'w' + i;
    q.children.push(leaf(id, 'Hear back on ' + pick(THINGS), { wait: wait() }));
    waitIds.push(id);
  }
  s.later = [];
  for (let i = 0; i < n.later; i++)
    s.later.push({
      id: 'pl' + i,
      text: title(),
      done: false,
      start: shift(t, int(1, 30)),
      tag: pick(TAGS),
      children: [leaf('pl' + i + 'a', 'Draft'), leaf('pl' + i + 'b', 'Send')],
    });
  for (let i = 0; i < onLater; i++) {
    const l = s.later[i % s.later.length],
      id = l.id + 'w' + i;
    l.children.push(leaf(id, 'Hear back from ' + pick(PEOPLE), { wait: wait() }));
    waitIds.push(id);
  }
  s.later.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  s.inbox = [];
  for (let i = 0; i < n.inbox; i++) s.inbox.push({ id: 'pi' + i, text: sentence(3, 9).slice(0, -1) });
  for (let i = 0; i < inInbox; i++) {
    const id = 'piw' + i;
    s.inbox.push({ id, text: 'Reply from ' + pick(PEOPLE) + ' on ' + pick(THINGS), wait: wait() });
    waitIds.push(id);
  }
  // Follow-ups on the waiting items (started, chased, expected...).
  s.follows = [];
  for (let i = 0; i < n.follows; i++) {
    const at = now - int(0, 60) * D - int(0, 23) * H;
    s.follows.push({
      id: 'pf' + i,
      n: waitIds[i % waitIds.length],
      t: at,
      d: fmt(new Date(at)),
      k: pick(['start', 'chase', 'chase', 'expect', 'resolve', 'reopen']),
      note: chance(0.6) ? sentence(4, 16) : '',
    });
  }
  s.follows.sort((a, b) => a.t - b.t);
  s.top3 = { day: t, ids: [s.quests[0].id, s.quests[4].id, s.quests[9 % n.tasks].id] };

  // Finished tasks over the last 110 days (History, Review, Insights).
  s.log = [];
  for (let i = 0; i < n.log; i++) {
    const d = shift(t, -Math.floor((i / n.log) * 110));
    s.log.push({
      id: 'pd' + i,
      d,
      text: title(),
      trail: chance(0.6) ? [title()] : [],
      p: '',
      ...(chance(0.3) ? { est: pick([15, 30, 60]), m: int(5, 90) } : {}),
    });
  }
  s.log.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  // Focus sessions and interruptions (Insights, Forecast).
  s.sessions = [];
  for (let i = 0; i < n.sessions; i++)
    s.sessions.push({
      tag: pick(TAGS) || 'Admin',
      mins: pick([15, 25, 25, 45]),
      t: now - Math.floor((i / n.sessions) * 90 * D) - int(0, 8) * H,
      q: chance(0.7) ? s.quests[i % n.tasks].id : null,
      p: '',
      tid: 'pt' + i,
    });
  s.sessions.sort((a, b) => a.t - b.t);
  s.interrupts = [];
  for (let i = 0; i < n.interrupts; i++)
    s.interrupts.push({ id: 'pn' + i, t: now - int(0, 80) * D - int(0, 8) * H, text: sentence(2, 6) });
  s.interrupts.sort((a, b) => a.t - b.t);

  // Repeating tasks (templates).
  s.templates = [];
  for (let i = 0; i < n.templates; i++)
    s.templates.push({
      id: 'ptp' + i,
      text: pick(['Daily check-in', 'Inbox zero', 'Timesheet', 'Weekly report', 'Backup check']) + ' ' + i,
      children: [],
      days: [1, 2, 3, 4, 5].filter(() => chance(0.6)),
      monthDay: 0,
    });

  // Knowledge: categories, articles (some guides with steps), flows.
  s.kbcats = [];
  for (let i = 0; i < n.kbcats; i++)
    s.kbcats.push({
      id: 'pc' + i,
      name: pick(['Finance', 'IT', 'HR', 'Facilities', 'Sales', 'Legal', 'Ops', 'Projects']) + ' ' + i,
      parent: i >= 4 && chance(0.5) ? 'pc' + (i % 4) : '',
    });
  s.flows = [];
  for (let i = 0; i < n.flows; i++)
    s.flows.push({
      id: 'pw' + i,
      name:
        pick(['Export report', 'Tidy downloads', 'Backup', 'Invoice import', 'Sync CRM', 'Payroll file']) +
        ' ' +
        i,
      url: 'ms-powerautomate:/console/flow/run?workflowName=perf' + i,
      last: chance(0.6) ? now - int(1, 200) * H : 0,
    });
  s.kb = [];
  for (let i = 0; i < n.kb; i++) {
    const guide = chance(0.35),
      a = {
        id: 'pk' + i,
        cat: 'pc' + (i % n.kbcats),
        title: (guide ? 'How to ' : '') + pick(VERBS).toLowerCase() + ' ' + pick(THINGS),
        body: para(3, 25),
        edited: now - int(1, 400) * H,
        imgs: [],
      };
    if (guide) {
      a.steps = [];
      for (let j = int(3, 10); j > 0; j--)
        a.steps.push({
          id: a.id + 'g' + j,
          title: pick(VERBS) + ' ' + pick(WORDS) + ' ' + pick(WORDS),
          ...(chance(0.5) ? { text: para(1, 3) } : {}),
          ...(chance(0.15) ? { verify: true } : {}),
          ...(chance(0.1) ? { flow: 'pw' + (j % n.flows) } : {}),
        });
    }
    s.kb.push(a);
  }
  const guides = s.kb.filter(a => a.steps);
  s.runs = [];
  for (let i = 0; i < n.runs && guides.length; i++) {
    const g = guides[i % guides.length],
      at = now - int(0, 40) * D,
      fin = chance(0.6);
    s.runs.push({
      id: 'pr' + i,
      art: g.id,
      q: '',
      started: at,
      at: at + H,
      done: g.steps.slice(0, fin ? g.steps.length : 1).map(x => x.id),
      cur: '',
      fin: fin ? at + 2 * H : 0,
    });
  }

  // Automation executions with event histories (some failed, some still running).
  s.track = true;
  s.execs = [];
  for (let i = 0; i < n.execs; i++) {
    const at = now - Math.floor(((n.execs - i) / n.execs) * 30 * D),
      st = pick(['succeeded', 'succeeded', 'succeeded', 'failed', 'cancelled', 'running', 'requested']),
      ev = [];
    const steps = st === 'requested' ? 0 : int(2, 12);
    for (let j = 0; j < steps; j++)
      ev.push({
        i: i * 20 + j,
        t: at + j * 60e3,
        s: j === steps - 1 ? st : 'running',
        m: chance(0.5) ? sentence(3, 12) : '',
      });
    s.execs.push({
      id: 'px' + i,
      flow: 'pw' + (i % n.flows),
      q: '',
      at,
      status: st,
      msg: st === 'failed' ? pick(['Timed out logging in', 'Folder not found', 'Login page changed']) : '',
      upd: at + steps * 60e3,
      ref: '',
      ev,
      ...(st === 'failed' && chance(0.5) ? { ack: 1 } : {}),
    });
  }

  // Workflows (processes) and their runs, failures among them.
  const TYPES = ['manual', 'manual', 'procedure', 'flow', 'verify', 'wait', 'decide'];
  s.workflows = [];
  for (let i = 0; i < n.workflows; i++) {
    const stages = [];
    for (let j = int(3, 9); j > 0; j--) {
      const type = pick(TYPES),
        st = { id: 'pv' + i + 'm' + j, type, title: pick(VERBS) + ' ' + pick(THINGS) };
      if (chance(0.4)) st.text = para(1, 2);
      if (type === 'procedure' && guides.length) st.kb = guides[(i + j) % guides.length].id;
      if (type === 'flow') st.flow = 'pw' + ((i + j) % n.flows);
      if (type === 'verify') st.checks = ['Totals agree', 'Exceptions noted', 'Signed off'];
      if (type === 'wait') st.who = pick(PEOPLE);
      if (type === 'decide') st.choices = [{ label: 'Yes' }, { label: 'No' }];
      stages.push(st);
    }
    s.workflows.push({
      id: 'pv' + i,
      name:
        pick(['Month-end close', 'New starter onboarding', 'Supplier set-up', 'Quarterly audit']) + ' ' + i,
      desc: sentence(8, 20),
      stages,
      days: i % 7 === 0 ? [1] : [],
      ver: 1,
      at: now - int(10, 200) * D,
    });
  }
  s.wruns = [];
  for (let i = 0; i < n.wruns; i++) {
    const w = s.workflows[i % n.workflows],
      def = w.stages,
      started = now - Math.floor(((n.wruns - i) / n.wruns) * 120 * D),
      status = pick([
        'succeeded',
        'succeeded',
        'succeeded',
        'failed',
        'failed',
        'cancelled',
        'awaiting_user',
        'paused',
      ]),
      fin = ['succeeded', 'failed', 'cancelled'].includes(status),
      upto = fin && status === 'succeeded' ? def.length : int(0, def.length - 1),
      st = {},
      log = [];
    for (let j = 0; j < upto; j++) st[def[j].id] = { o: 'done', at: started + j * H };
    if (status === 'failed')
      st[def[upto].id] = { o: 'failed', at: started + upto * H, note: 'Timed out logging in' };
    for (let j = 0; j < Math.min(upto + 2, 12); j++)
      log.push({ t: started + j * H, k: 'done', m: sentence(2, 6) });
    s.wruns.push({
      id: 'pu' + i,
      wf: w.id,
      ver: 1,
      name: w.name,
      q: '',
      def,
      started,
      at: started + upto * H,
      cur: status === 'succeeded' ? '' : def[Math.min(upto, def.length - 1)].id,
      st,
      live: {},
      status,
      fin: fin ? started + (upto + 1) * H : 0,
      err: status === 'failed' ? def[upto].title + ': Timed out logging in' : '',
      log,
    });
  }

  // Rules and their log.
  s.rules = [];
  for (let i = 0; i < n.rules; i++)
    s.rules.push({
      id: 'pz' + i,
      name: 'Chase a failed export ' + i,
      on: { k: 'exec_failed', flow: 'pw' + (i % n.flows) },
      do: { k: 'inbox', text: 'Check the export' },
      enabled: true,
    });
  s.rlog = [];
  for (let i = 0; i < n.rlog; i++)
    s.rlog.push({
      id: 'py' + i,
      r: 'pz' + (i % n.rules),
      t: now - int(0, 80) * D,
      k: 'exec_failed',
      key: 'exec:px' + i,
      out: 'done',
      m: 'Added an Inbox item',
    });
  s.rlog.sort((a, b) => a.t - b.t);
  s.notes = para(5, 15);
}

// A dataset as setState takes it (a function whose source runs in the page with `s` in scope).
const dataset = name => {
  if (!SIZES[name]) throw new Error('No dataset ' + name);
  return { toString: () => `function (s) { (${perfFill})(s, ${JSON.stringify(SIZES[name])}); }` };
};
const datasets = Object.fromEntries(Object.keys(SIZES).map(k => [k, dataset(k)]));
module.exports = { SIZES, perfFill, dataset, datasets };
