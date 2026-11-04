// Release E scenarios on top of the Release D day (busy day + processes): two meetings today
// (10:30 and 14:00), one tomorrow, a training day with no time, a task waiting on IT with nothing
// else to do, and an untouched ordinary task. Dates relative to the page's today().
const { processDay } = require('./releaseddata');

function eExtra(s) {
  const t = today(),
    k = (id, text, extra = {}) => ({ id, text, done: false, children: [], ...extra });
  s.quests.push(
    k('m1', 'Team meeting', { scheduled: { date: t, time: '10:30' } }),
    k('m2', 'Supplier review call', { scheduled: { date: t, time: '14:00' }, est: 60 }),
    k('m3', 'First-aid training', { scheduled: { date: t } }),
    {
      id: 'b1',
      text: 'Finance system access',
      done: false,
      children: [
        k('b1a', 'IT to grant access', {
          wait: { who: 'IT', note: '', due: t, since: shift(t, -3), expect: shift(t, -1) },
        }),
      ],
    },
  );
  s.later = (s.later || []).concat([
    k('m4', 'Board briefing', { start: shift(t, 1), scheduled: { date: shift(t, 1), time: '09:15' } }),
  ]);
}
const eDay = { toString: () => `function (s) { (${processDay})(s); (${eExtra})(s); }` };
module.exports = { eDay };
