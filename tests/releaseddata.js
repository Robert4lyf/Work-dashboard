// Release D scenarios, built in the page as saved data (run through app.setState, so `s` is the
// data; dates relative to the page's today()). On top of the busy day (Scenario A: 20 tasks, a
// Top 3, due and overdue work, waiting commitments, an Inbox), Scenario B: one failed workflow,
// one automation that failed on its own, a verified automation result, a paused workflow, a
// running workflow with a guide being followed inside it, a standalone guide run, guides and
// reference articles, two automations with the same name, and a rule.
const { busyDay } = require('./busyday');

function processExtra(s) {
  const now = Date.now(),
    H = 3600e3;
  s.flows.push(
    { id: 'f4', name: 'Export report', url: 'ms-powerautomate:/console/flow/run?workflowName=export2' },
    { id: 'f5', name: 'Invoice import', url: 'ms-powerautomate:/console/flow/run?workflowName=invoices' },
  );
  s.track = true;
  s.execs.push(
    {
      id: 'x4',
      flow: 'f5',
      at: now - 3 * H,
      status: 'succeeded',
      msg: '42 invoices',
      upd: now - 2.9 * H,
      ev: [],
    },
    { id: 'x5', flow: 'f4', at: now - 26 * H, status: 'succeeded', msg: '', upd: now - 25.9 * H, ev: [] },
  );
  s.kbcats = [
    { id: 'c1', name: 'Finance', parent: '' },
    { id: 'c2', name: 'IT', parent: '' },
  ];
  s.kb = [
    {
      id: 'k1',
      cat: 'c1',
      title: 'Month-end close checklist',
      body: 'How the month is closed, who signs off and where the files go.',
      edited: now - 48 * H,
      steps: [
        { id: 'k1a', title: 'Download the bank statements' },
        { id: 'k1b', title: 'Match the payments', text: 'Use the reconciliation sheet.' },
        { id: 'k1c', title: 'File the statements', verify: true },
      ],
    },
    {
      id: 'k2',
      cat: 'c2',
      title: 'Reset a VPN token',
      body: 'Steps for the VPN token portal.',
      edited: now - 72 * H,
      steps: [
        { id: 'k2a', title: 'Open the token portal' },
        { id: 'k2b', title: 'Request a new token' },
      ],
    },
    { id: 'k3', cat: 'c1', title: 'Supplier contacts', body: 'Accounts: 01632 960 001', edited: now - 5 * H },
    {
      id: 'k4',
      cat: 'c2',
      title: 'Printer setup',
      body: 'Add the printer by its address.',
      edited: now - 9 * H,
    },
  ];
  const close = [
    { id: 'm1', type: 'manual', title: 'Gather the statements' },
    { id: 'm2', type: 'procedure', title: 'Follow the close checklist', kb: 'k1' },
    { id: 'm3', type: 'flow', title: 'Import the invoices', flow: 'f5' },
    { id: 'm4', type: 'verify', title: 'Review', checks: ['Totals agree', 'Exceptions noted'] },
    { id: 'm5', type: 'wait', title: 'Approval', who: 'Finance director' },
    { id: 'm6', type: 'manual', title: 'Close the month', skip: true },
  ];
  const onboard = [
    { id: 'o1', type: 'manual', title: 'Send the welcome pack' },
    { id: 'o2', type: 'manual', title: 'Set up accounts' },
    { id: 'o3', type: 'manual', title: 'Book the induction' },
  ];
  s.workflows.push(
    {
      id: 'wf2',
      name: 'Month-end close',
      desc: 'Close the books each month.',
      stages: close,
      days: [],
      ver: 1,
    },
    { id: 'wf3', name: 'New starter onboarding', stages: onboard, days: [1], ver: 1 },
  );
  s.wruns.push(
    {
      id: 'r3',
      wf: 'wf2',
      ver: 1,
      name: 'Month-end close',
      q: '',
      def: close,
      started: now - 2 * H,
      at: now - 0.5 * H,
      cur: 'm2',
      st: { m1: { o: 'done', at: now - H } },
      live: { run: 'p1' },
      status: 'awaiting_user',
    },
    {
      id: 'r4',
      wf: 'wf3',
      ver: 1,
      name: 'New starter onboarding',
      q: '',
      def: onboard,
      started: now - 30 * H,
      at: now - 20 * H,
      cur: 'o2',
      st: { o1: { o: 'done', at: now - 29 * H } },
      status: 'paused',
    },
  );
  s.runs = [
    {
      id: 'p1',
      art: 'k1',
      q: 'wr-r3',
      started: now - 0.6 * H,
      at: now - 0.5 * H,
      done: ['k1a'],
      cur: '',
      fin: 0,
    },
    { id: 'p2', art: 'k2', q: '', started: now - 4 * H, at: now - 4 * H, done: ['k2a'], cur: '', fin: 0 },
  ];
  s.rules = [
    {
      id: 'rl1',
      name: 'Chase a failed export',
      on: { k: 'exec_failed', flow: 'f1' },
      do: { k: 'inbox', text: 'Check the export' },
      on_: true,
    },
  ];
}
// (setState sends a function's source to the page: both parts go, the busy day first)
const processDay = { toString: () => `function (s) { (${busyDay})(s); (${processExtra})(s); }` };
module.exports = { processDay };
