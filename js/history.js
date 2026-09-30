/* done log */
function logDays(since) {
  return [...new Set(S.log.filter(x => x.d >= since).map(x => x.d))].sort().reverse();
}
// A day's finished items grouped under their quests, in the order they were first finished:
// [{ title, done (the quest itself finished that day), steps: [text] }].
function logGroups(d) {
  const out = [],
    by = {};
  S.log
    .filter(x => x.d === d)
    .forEach(x => {
      const title = x.trail.length ? x.trail[0] : x.text;
      let g = by[title];
      if (!g) out.push((g = by[title] = { title, done: false, steps: [] }));
      if (x.trail.length) g.steps.push([...x.trail.slice(1), x.text].join(' / '));
      else g.done = true;
    });
  return out;
}
function logText() {
  return logDays(shift(today(), -6))
    .map(
      d =>
        dayLabel(d) +
        '\n' +
        logGroups(d)
          .map(g => '- ' + g.title + g.steps.map(s => '\n  - ' + s).join(''))
          .join('\n'),
    )
    .join('\n\n');
}
function renderLog() {
  let h = '<h2>History</h2>' + renderStats();
  const days = logDays(shift(today(), -13));
  h +=
    '<div class="sechead"><h2>Done</h2>' +
    (days.length ? '<button class="linkbtn" id="copylog">Copy last 7 days</button>' : '') +
    '</div>';
  if (!days.length) {
    h += '<div class="empty">Nothing finished yet.</div>';
    setHTML($('#v-log'), h);
    return;
  }
  days.forEach(d => {
    const f = Object.values(S.daily[d] || {}).reduce((a, b) => a + b, 0);
    h += `<div class="logday box"><h2><span>${dayLabel(d)}</span>${f ? `<small>${hm(f)} focus</small>` : ''}</h2><ul>`;
    // Each quest, with the steps finished that day under it (a quest not yet finished is muted).
    logGroups(d).forEach(
      g =>
        (h += `<li class="${g.done ? '' : 'open'}">${esc(g.title)}${g.steps.length ? `<ul>${g.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</li>`),
    );
    h += '</ul></div>';
  });
  setHTML($('#v-log'), h);
}
function copyLog() {
  const txt = logText();
  if (!txt) {
    toast('Nothing in the last 7 days');
    return;
  }
  const fail = () => toast("Couldn't copy on this device");
  try {
    navigator.clipboard.writeText(txt).then(() => toast('Copied'), fail);
  } catch (e) {
    fail();
  }
}
