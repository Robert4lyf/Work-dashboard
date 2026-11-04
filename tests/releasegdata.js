// Release G scenarios. Scenario A, the busy day: the Release E day (20 tasks with steps, two
// failed processes, meetings, waiting) made up to 25 ordinary tasks, four waiting commitments,
// three meetings, a Top 3 and a saved place. Dates relative to the page's today().
const { eDay } = require('./releaseedata');

function gExtra(s) {
  const t = today(),
    k = (id, text, extra = {}) => ({ id, text, done: false, children: [], ...extra }),
    steps = (id, names) => names.map((n, i) => k(`${id}s${i}`, n));
  s.quests.push(
    k('g1', 'Renew parking permit', { due: shift(t, -2) }),
    k('g2', 'Quarterly safeguarding return', { children: steps('g2', ['Gather figures', 'Draft', 'Send']), due: t }),
    k('g3', 'Book room for team away day'),
    k('g4', 'Reply to Harpenden about the boundary query', { children: steps('g4', ['Read the file', 'Reply']) }),
    k('g5', 'Update the risk register'),
    {
      id: 'g6',
      text: 'Contractor invoice query',
      done: false,
      children: [
        k('g6a', 'Ask Accounts for the PO', {
          wait: { who: 'Accounts', note: '', due: shift(t, 2), since: shift(t, -1) },
        }),
      ],
    },
  );
  const open = s.quests.filter(q => !q.done && !q.scheduled && !(q.children || []).every(c => c.wait));
  s.top3 = { day: t, ids: open.slice(0, 3).map(q => q.id) };
}
const gDay = { toString: () => `function (s) { (${eDay})(s); (${gExtra})(s); }` };
module.exports = { gDay };
