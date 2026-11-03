// A realistic busy day (Phase 1 usability scenarios), built in the page as saved data: 20 quests,
// a Top 3, deadlines (two overdue), two waiting commitments to chase, a workflow that failed on its
// flow stage (one incident: the run and its flow execution), a flow that failed on its own, an
// automation under way, a saved place, and an Inbox. Run through app.setState, so `s` is the data.
// Dates are relative to the page's today().
function busyDay(s) {
  const t = today(),
    now = Date.now(),
    k = (id, text, done, extra = {}) => ({ id, text, done, children: [], ...extra }),
    w = (who, due) => ({ who, note: '', due, since: shift(t, -5) });
  const names = [
    'Walsingham sale',
    'Fletcher Way',
    'Filbert Close',
    'Megan finance queries',
    'Q4 budget report',
    'Team rota',
    'Client onboarding',
    'Vendor contract',
    'Office move',
    'Hiring pack',
    'Website copy',
    'Training plan',
    'Audit prep',
    'Board pack',
    'Expenses',
    'Supplier review',
    'Policy update',
    'Newsletter',
    'Data clean-up',
    'Quarterly survey',
  ];
  s.quests = names.map((text, i) => ({
    id: 'q' + i,
    text,
    children: [
      k('q' + i + 'a', 'Draft', i % 3 === 0),
      k('q' + i + 'b', 'Review', false),
      k('q' + i + 'c', 'Send', false),
    ],
  }));
  s.quests[1].due = shift(t, -2); // overdue
  s.quests[6].children[1].due = shift(t, -1); // an overdue step
  s.quests[2].due = t; // due today
  s.quests[7].due = shift(t, 2); // due soon
  s.quests[10].children[1].due = shift(t, 1); // a step due soon
  s.quests[3].children.push(k('q3w', 'Hear back on figures', false, { wait: w('Emily', shift(t, -1)) }));
  s.quests[8].children.push(k('q8w', 'Floor plan sign-off', false, { wait: w('Laura', t) }));
  s.quests[4].resume = { note: 'Totals checked to row 40; next the notes', at: now - 3600e3, step: 'q4b' };
  s.top3 = { day: t, ids: ['q5', 'q4', 'q9'] };
  s.inbox = ['Call landlord', 'Book train', 'Reply to Sam', 'Check invoice', 'Order toner'].map(
    (text, i) => ({
      id: 'i' + i,
      text,
    }),
  );
  s.flows = [
    { id: 'f1', name: 'Export report', url: 'ms-powerautomate:/console/flow/run?workflowName=export' },
    { id: 'f2', name: 'Tidy downloads', url: 'ms-powerautomate:/console/flow/run?workflowName=tidy' },
    { id: 'f3', name: 'Backup', url: 'ms-powerautomate:/console/flow/run?workflowName=backup' },
  ];
  s.execs = [
    {
      id: 'x1',
      flow: 'f1',
      at: now - 7200e3,
      status: 'failed',
      msg: 'Timed out logging in',
      upd: now - 7000e3,
      ev: [],
    },
    {
      id: 'x2',
      flow: 'f2',
      at: now - 5400e3,
      status: 'failed',
      msg: 'Folder not found',
      upd: now - 5300e3,
      ev: [],
    },
    { id: 'x3', flow: 'f3', at: now - 600e3, status: 'running', msg: '', upd: now - 500e3, ev: [] },
  ];
  const def = [
    { id: 's1', type: 'manual', title: 'Check the figures' },
    { id: 's2', type: 'flow', title: 'Export the report', flow: 'f1' },
    { id: 's3', type: 'manual', title: 'Send it' },
  ];
  s.workflows = [{ id: 'wf1', name: 'Month-end report', stages: def, days: [], ver: 1 }];
  s.wruns = [
    {
      id: 'r1',
      wf: 'wf1',
      ver: 1,
      name: 'Month-end report',
      q: '',
      def,
      started: now - 8000e3,
      at: now - 7000e3,
      cur: 's2',
      st: {
        s1: { o: 'done', at: now - 7500e3 },
        s2: { o: 'failed', at: now - 7000e3, note: 'Timed out logging in', exec: 'x1' },
      },
      status: 'failed',
      err: 'Export the report: Timed out logging in',
    },
    {
      id: 'r2',
      wf: 'wf1',
      ver: 1,
      name: 'Month-end report',
      q: '',
      def,
      started: now - 900e3,
      at: now - 600e3,
      cur: 's2',
      st: { s1: { o: 'done', at: now - 800e3 } },
      live: { exec: 'x3', launched: now - 600e3 },
      status: 'awaiting_automation',
    },
  ];
}
module.exports = { busyDay };
